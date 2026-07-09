import { createHash } from 'crypto';
import { createGunzip } from 'zlib';
import { StringDecoder } from 'string_decoder';
import { extract as tarExtract } from 'tar-stream';
import { minimatch } from 'minimatch';
import type {
  ArchiveScanStats,
  BitbucketMcpConfig,
  GrepFileResult,
  GrepMatch,
  RepoSnapshot,
  SnapshotOmittedFile,
} from '../types/index.js';
import { BitbucketApiClient, encodeRepoPath } from './api-client.js';
import { BlobStore, ByteBudgetLru } from './cache.js';

// RepoSnapshot engine — the in-memory "virtual checkout" behind grep.
//
// Design contract (REVAMP_PLAN.md):
//  * Streaming-first: the archive is NEVER buffered whole; each tar entry is
//    scanned as it flows through and discarded unless retained.
//  * Completeness: retention caps bound only the CACHE, never the SCAN.
//    Oversized text files are still fully scanned (chunked, line-carry);
//    only true binaries are skipped — and counted, never silent.
//  * Freshness: callers resolve ref→SHA per call (BitbucketApiClient
//    .resolveRef); snapshots are keyed by immutable SHA so a stale entry can
//    never be served for a moved branch.
//  * Memory: global byte budget + per-snapshot admission share + LRU
//    eviction + content-addressed blob dedup across branches/snapshots.

export type GrepRequest = {
  project: string;
  repository: string;
  /** Branch/tag/SHA; undefined = default branch. */
  ref?: string;
  /** Scope the archive to this subtree ('' = whole repo). */
  pathPrefix?: string;
  /** Compiled content regex. */
  regex: RegExp;
  /** Glob restricting which files are scanned (matched case-insensitively). */
  glob?: string;
  /** Max match lines collected across all files (counting continues after). */
  maxMatches: number;
  /** Context lines around each match. */
  contextLines: number;
};

export type GrepEngineOutcome = {
  sha: string;
  engine: 'snapshot' | 'stream';
  results: GrepFileResult[];
  totalMatches: number;
  filesScanned: number;
  binariesSkipped: number;
  warnings: string[];
  stats?: ArchiveScanStats;
};

// ── Line scanner: incremental, constant-memory, with context support ────────

type ScannerMatchSink = (match: GrepMatch) => void;

// Exported for unit tests.
export class LineScanner {
  private carry = '';
  private lineNo = 0;
  private ring: Array<[number, string]> = [];
  private pendingAfter: Array<{ match: GrepMatch; remaining: number }> = [];
  matchCount = 0;

  constructor(
    private readonly regex: RegExp,
    private readonly contextLines: number,
    private readonly maxLineLength: number,
    private readonly collect: ScannerMatchSink | null
  ) {}

  feed(chunk: string): void {
    const data = this.carry + chunk;
    const lines = data.split('\n');
    this.carry = lines.pop() ?? '';
    for (const line of lines) this.scanLine(line);
  }

  end(): void {
    if (this.carry.length > 0) this.scanLine(this.carry);
    this.carry = '';
  }

  private scanLine(rawLine: string): void {
    this.lineNo += 1;
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

    // Feed after-context to matches still waiting for trailing lines.
    for (const pending of this.pendingAfter) {
      pending.match.after!.push([this.lineNo, this.display(line)]);
      pending.remaining -= 1;
    }
    this.pendingAfter = this.pendingAfter.filter(p => p.remaining > 0);

    if (this.regex.test(line)) {
      this.matchCount += 1;
      if (this.collect) {
        const match: GrepMatch = { line: this.lineNo, text: this.display(line) };
        if (line.length > this.maxLineLength) match.truncated = true;
        if (this.contextLines > 0) {
          match.before = [...this.ring];
          match.after = [];
          this.pendingAfter.push({ match, remaining: this.contextLines });
        }
        this.collect(match);
      }
    }

    if (this.contextLines > 0) {
      this.ring.push([this.lineNo, this.display(line)]);
      if (this.ring.length > this.contextLines) this.ring.shift();
    }
  }

  private display(line: string): string {
    return line.length > this.maxLineLength ? line.slice(0, this.maxLineLength) + '…' : line;
  }
}

// ── Snapshot store ───────────────────────────────────────────────────────────

export class RepoSnapshotStore {
  private blobs = new BlobStore();
  private lru: ByteBudgetLru<RepoSnapshot>;
  private readonly config: BitbucketMcpConfig;

  constructor(private readonly client: BitbucketApiClient) {
    this.config = client.getConfig();
    const budgetBytes = this.config.snapshot.maxTotalMb * 1024 * 1024;
    this.lru = new ByteBudgetLru<RepoSnapshot>(
      budgetBytes,
      snap => snap.retainedBytes,
      (_key, snap) => {
        for (const entry of snap.files.values()) this.blobs.release(entry.hash);
      }
    );
  }

  get retentionEnabled(): boolean {
    return this.config.snapshot.maxTotalMb > 0;
  }

  /** Cache usage snapshot for diagnostics. */
  usage(): { snapshots: number; retainedBytes: number } {
    return { snapshots: this.lru.keys().length, retainedBytes: this.blobs.totalBytes };
  }

  /**
   * Content grep. Resolves the ref for freshness, serves from a SHA-matched
   * snapshot when warm, otherwise streams the archive (retaining when the
   * budget admits it).
   */
  async grep(req: GrepRequest): Promise<GrepEngineOutcome> {
    const sha = await this.client.resolveRef(req.project, req.repository, req.ref);
    const prefix = req.pathPrefix ?? '';
    const key = `${req.project}/${req.repository}@${sha}#${prefix}`;

    const warm = this.lru.get(key);
    if (warm) {
      warm.lastUsedAt = Date.now();
      return this.grepWarm(warm, req, sha);
    }
    return this.grepStreaming(req, sha, key, prefix);
  }

  // ── Warm path: scan retained blobs; fetch omitted files individually ──────

  private async grepWarm(snap: RepoSnapshot, req: GrepRequest, sha: string): Promise<GrepEngineOutcome> {
    const warnings: string[] = [];
    const results: GrepFileResult[] = [];
    let totalCollected = 0;
    let totalMatches = 0;
    let filesScanned = 0;

    const scanText = (path: string, text: string): void => {
      const collected: GrepMatch[] = [];
      const scanner = new LineScanner(
        req.regex,
        req.contextLines,
        this.config.grep.maxLineLength,
        totalCollected < req.maxMatches
          ? m => {
              if (totalCollected < req.maxMatches) {
                collected.push(m);
                totalCollected += 1;
              }
            }
          : null
      );
      scanner.feed(text);
      scanner.end();
      filesScanned += 1;
      totalMatches += scanner.matchCount;
      if (scanner.matchCount > 0) {
        results.push({ path, matches: collected, count: scanner.matchCount });
      }
    };

    for (const [path, entry] of snap.files) {
      if (!this.globMatch(path, req.glob)) continue;
      const buf = this.blobs.get(entry.hash);
      if (!buf) continue; // defensive: evicted blob
      scanText(path, buf.toString('utf8'));
    }

    // Completeness: files that were scanned during extraction but not
    // retained must still be searched. Small sets are fetched individually;
    // past warmRefetchMax one archive re-stream is cheaper AND complete.
    const omittedMatching = snap.omitted.filter(o => this.globMatch(o.path, req.glob));
    if (omittedMatching.length > this.config.snapshot.warmRefetchMax) {
      return this.grepStreaming(req, sha, snap.key, snap.pathPrefix);
    }
    if (omittedMatching.length > 0) {
      for (const omitted of omittedMatching) {
        try {
          const text = await this.fetchRaw(req.project, req.repository, omitted.path, sha);
          scanText(omitted.path, text);
        } catch {
          // Completeness first: if any uncached file can't be re-fetched,
          // abandon the warm path and re-stream the archive — one request,
          // provably complete — instead of returning a silently partial scan.
          return this.grepStreaming(req, sha, snap.key, snap.pathPrefix);
        }
      }
    }

    if (snap.binaryPaths.length > 0) {
      // Reported by the caller via binariesSkipped; no warning spam here.
    }

    results.sort((a, b) => a.path.localeCompare(b.path));
    return {
      sha,
      engine: 'snapshot',
      results,
      totalMatches,
      filesScanned,
      binariesSkipped: snap.binaryPaths.filter(p => this.globMatch(p, req.glob)).length,
      warnings,
    };
  }

  // ── Cold path: stream the archive, scan everything, retain what fits ──────

  private async grepStreaming(
    req: GrepRequest,
    sha: string,
    key: string,
    prefix: string
  ): Promise<GrepEngineOutcome> {
    const cfg = this.config.snapshot;
    const warnings: string[] = [];
    const results = new Map<string, GrepFileResult>();
    let totalCollected = 0;
    let totalMatches = 0;

    const stats: ArchiveScanStats = { filesSeen: 0, textFiles: 0, binaryFiles: 0, extractedBytes: 0, aborted: false };

    // Retention accumulators (committed only after a successful stream).
    const retain = this.retentionEnabled;
    const admissionCap = Math.floor(this.lru.budget * cfg.maxSnapshotShare);
    const maxRetainedFileBytes = cfg.maxRetainedFileKb * 1024;
    const candidates = new Map<string, Buffer>();
    let candidateBytes = 0;
    const omitted: SnapshotOmittedFile[] = [];
    const allPaths: string[] = [];
    const binaryPaths: string[] = [];
    const abortBytes = cfg.streamAbortMb > 0 ? cfg.streamAbortMb * 1024 * 1024 : Infinity;

    const { stream, release } = await this.client.streamArchive(req.project, req.repository, {
      at: sha,
      paths: prefix ? [prefix] : undefined,
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const gunzip = createGunzip();
        const extractor = tarExtract();
        let settled = false;
        const fail = (err: Error) => {
          if (settled) return;
          settled = true;
          stream.destroy();
          reject(err);
        };
        const succeed = () => {
          if (settled) return;
          settled = true;
          resolve();
        };

        extractor.on('entry', (header, entryStream, next) => {
          if (header.type !== 'file' || !header.name) {
            entryStream.resume();
            entryStream.on('end', next);
            return;
          }
          const path = normalizeTarPath(header.name);
          stats.filesSeen += 1;
          allPaths.push(path);

          const wantScan = this.globMatch(path, req.glob);
          let sniffed = false;
          let isBinary = false;
          let fileBytes = 0;
          let buffered: Buffer[] | null = [];
          let bufferedBytes = 0;
          const collected: GrepMatch[] = [];
          let scanner: LineScanner | null = null;
          // Incremental decode: multi-byte UTF-8 chars can split across tar
          // chunk boundaries; a per-entry StringDecoder keeps them intact.
          let decoder: StringDecoder | null = null;
          const ensureScanner = () => {
            if (!scanner) {
              decoder = new StringDecoder('utf8');
              scanner = new LineScanner(req.regex, req.contextLines, this.config.grep.maxLineLength, m => {
                if (totalCollected < req.maxMatches) {
                  collected.push(m);
                  totalCollected += 1;
                }
              });
            }
            return scanner;
          };

          entryStream.on('data', (chunk: Buffer) => {
            fileBytes += chunk.length;
            stats.extractedBytes += chunk.length;
            if (stats.extractedBytes > abortBytes) {
              stats.aborted = true;
              fail(new ArchiveAbortError(stats.extractedBytes));
              return;
            }
            if (!sniffed) {
              sniffed = true;
              isBinary = chunk.subarray(0, cfg.binarySniffBytes).includes(0);
              if (isBinary) {
                stats.binaryFiles += 1;
                binaryPaths.push(path);
                buffered = null;
              } else {
                stats.textFiles += 1;
              }
            }
            if (isBinary) return; // drain

            // Retention buffering: keep the bytes only while under the
            // per-file cap; past it, scanning continues chunk-by-chunk
            // (glob-filtered — non-matching oversized files are just drained).
            if (buffered) {
              if (fileBytes <= maxRetainedFileBytes) {
                buffered.push(chunk);
                bufferedBytes += chunk.length;
              } else {
                if (wantScan) {
                  const s = ensureScanner();
                  for (const b of buffered) s.feed(decoder!.write(b));
                  s.feed(decoder!.write(chunk));
                }
                buffered = null;
                bufferedBytes = 0;
                return;
              }
            } else if (wantScan) {
              ensureScanner().feed(decoder!.write(chunk));
            }
            // When buffering, scanning happens once at entry end (single pass
            // over the concatenated buffer keeps multi-byte chars intact).
          });

          entryStream.on('end', () => {
            if (!isBinary) {
              if (buffered) {
                const content = Buffer.concat(buffered, bufferedBytes);
                if (wantScan) {
                  const s = ensureScanner();
                  s.feed(content.toString('utf8'));
                  s.end();
                }
                if (retain) {
                  if (candidateBytes + content.length <= admissionCap) {
                    candidates.set(path, content);
                    candidateBytes += content.length;
                  } else {
                    omitted.push({ path, size: fileBytes, reason: 'budget' });
                  }
                }
              } else {
                if (scanner) {
                  const s = scanner as LineScanner;
                  const tail = decoder ? decoder.end() : '';
                  if (tail) s.feed(tail);
                  s.end();
                }
                if (retain) omitted.push({ path, size: fileBytes, reason: 'too-large' });
              }
              if (scanner) {
                const s = scanner as LineScanner;
                totalMatches += s.matchCount;
                if (s.matchCount > 0) {
                  results.set(path, { path, matches: collected, count: s.matchCount });
                }
              }
            }
            next();
          });
          entryStream.on('error', fail);
        });

        extractor.on('finish', succeed);
        extractor.on('error', fail);
        gunzip.on('error', fail);
        stream.on('error', fail);
        stream.pipe(gunzip).pipe(extractor);
      });
    } catch (err) {
      if (err instanceof ArchiveAbortError) {
        warnings.push(
          `SCAN_ABORTED: archive stream exceeded ${cfg.streamAbortMb} MB extracted (BITBUCKET_STREAM_ABORT_MB); ` +
            `matches found so far are returned but coverage is INCOMPLETE. Narrow with a path prefix or raise the cap.`
        );
      } else {
        throw err;
      }
    } finally {
      release();
    }

    // Commit retention only for complete streams (partial snapshots would
    // silently under-report on warm queries — completeness first). A
    // path-only snapshot (zero retained blobs) is still committed: it serves
    // glob listings and keeps the omitted-file bookkeeping for warm queries.
    if (retain && !stats.aborted && stats.filesSeen > 0) {
      const snap: RepoSnapshot = {
        key,
        project: req.project,
        repository: req.repository,
        sha,
        pathPrefix: prefix,
        files: new Map(),
        allPaths,
        binaryPaths,
        omitted,
        retainedBytes: 0,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
      };
      // Budget accounting counts only bytes NEWLY added to the blob store, so
      // branches sharing content genuinely cost just their delta.
      let newBytes = 0;
      for (const [path, buf] of candidates) {
        const hash = sha1(buf);
        newBytes += this.blobs.retain(hash, buf);
        snap.files.set(path, { hash, size: buf.length });
      }
      snap.retainedBytes = newBytes + approxPathBytes(allPaths);
      this.lru.set(key, snap);
    }

    const resultList = [...results.values()].sort((a, b) => a.path.localeCompare(b.path));
    return {
      sha,
      engine: 'stream',
      results: resultList,
      totalMatches,
      filesScanned: stats.textFiles,
      binariesSkipped: stats.binaryFiles,
      warnings,
      stats,
    };
  }

  /**
   * Warm file listing for glob queries: every path the snapshot saw
   * (retained + omitted + binary). Undefined when no fresh snapshot exists.
   */
  async listPathsIfWarm(project: string, repository: string, ref?: string, pathPrefix = ''): Promise<{ sha: string; paths: string[] } | undefined> {
    const sha = await this.client.resolveRef(project, repository, ref);
    const snap = this.lru.get(`${project}/${repository}@${sha}#${pathPrefix}`);
    if (!snap) return undefined;
    snap.lastUsedAt = Date.now();
    return { sha, paths: snap.allPaths };
  }

  private async fetchRaw(project: string, repository: string, filePath: string, atSha: string): Promise<string> {
    return this.client.makeRequest<string>(
      'get',
      `/rest/api/latest/projects/${project}/repos/${repository}/raw/${encodeRepoPath(filePath)}`,
      undefined,
      { params: { at: atSha }, responseType: 'text', headers: { Accept: 'text/plain' } }
    );
  }

  private globMatch(path: string, glob?: string): boolean {
    if (!glob) return true;
    if (minimatch(path, glob, { matchBase: true, nocase: true })) return true;
    if (!glob.startsWith('**/') && minimatch(path, `**/${glob}`, { matchBase: true, nocase: true })) return true;
    return false;
  }
}

class ArchiveAbortError extends Error {
  constructor(public readonly extractedBytes: number) {
    super('archive scan aborted at size cap');
  }
}

function sha1(buf: Buffer): string {
  return createHash('sha1').update(buf).digest('hex');
}

function normalizeTarPath(name: string): string {
  let p = name;
  if (p.startsWith('./')) p = p.slice(2);
  // Guard against absolute/escaping names in hostile archives; we never
  // touch disk, but normalized keys keep lookups consistent.
  while (p.startsWith('/')) p = p.slice(1);
  return p;
}

function approxPathBytes(paths: string[]): number {
  let total = 0;
  for (const p of paths) total += p.length + 16;
  return total;
}
