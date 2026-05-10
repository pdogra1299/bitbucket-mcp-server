import { BitbucketApiClient } from '../utils/api-client.js';
import {
  BitbucketServerSearchRequest,
  BitbucketServerSearchResult,
} from '../types/bitbucket.js';
import { buildDenseResponseFromIndex, DenseSearchResponse } from '../utils/formatters.js';
import {
  buildQueryFromClauses,
  caseVariant,
  MAX_EXPRESSIONS,
  MAX_QUERY_LENGTH,
  QueryClause,
  quoteIfNeeded,
} from '../utils/query-budget.js';
import { minimatch } from 'minimatch';

// Match ASCII letters, digits, underscores. Used for word-boundary checks in
// the optional regex_filter post-filter (we do not bake any language knowledge
// into the server — the caller supplies the regex).
function compileRegexFilter(pattern: string | undefined): ((line: string) => boolean) | undefined {
  if (!pattern) return undefined;
  try {
    const re = new RegExp(pattern);
    return (line: string) => re.test(line);
  } catch {
    return undefined;
  }
}

// Bitbucket's text index treats some extension globs (*.py, *.ts) more cheaply
// when expressed via ext: rather than path:. Detects a bare `*.<ext>` pattern.
function extractBareExtension(filePattern: string | undefined): string | null {
  if (!filePattern) return null;
  const m = filePattern.match(/^\*\.([A-Za-z0-9]+)$/);
  return m ? m[1] : null;
}

interface SearchCodeArgs {
  workspace: string;
  repository?: string;
  query: string;
  lang?: string;
  ext?: string;
  path?: string;
  exclude_terms?: string[];
  archived?: 'true' | 'false' | '*';
  fork?: 'true' | 'false';
  regex_filter?: string;
  case_variants?: boolean;
  limit?: number;
  start?: number;
  // Deprecated — accepted for backwards-compatibility, ignored with a warning.
  search_query?: string;
  search_context?: string;
  include_patterns?: string[];
  file_pattern?: string;
}

interface FindInFilesArgs {
  workspace: string;
  repository: string;
  content_query: string;
  filename_pattern?: string;
  branch?: string;
  regex_filter?: string;
  max_files?: number;
  parallelism?: number;
  limit?: number;
}

export class SearchHandlers {
  constructor(
    private apiClient: BitbucketApiClient,
    private baseUrl: string
  ) {}

  // ──────────────────────────────────────────────────────────────────────────
  // search_code — index-backed exact-term search with documented Bitbucket
  // modifiers. Replaces the previous smart-query layer (which was a no-op
  // because Bitbucket strips most punctuation at index time).
  // ──────────────────────────────────────────────────────────────────────────
  async handleSearchCode(args: SearchCodeArgs): Promise<{ content: any[]; isError?: boolean }> {
    try {
      const warnings: string[] = [];

      // Backwards-compatibility: old callers used `search_query`. Accept it,
      // emit a deprecation note, but do not transform like before.
      const rawQuery = (args.query ?? args.search_query ?? '').trim();
      if (!args.workspace || !rawQuery) {
        throw new Error('workspace and query are required');
      }
      if (args.search_query && !args.query) {
        warnings.push('DEPRECATED_PARAM: `search_query` is renamed to `query`. Old name still accepted.');
      }
      if (args.search_context) {
        warnings.push('DEPRECATED_PARAM: `search_context` is removed (its patterns were ignored at index time). Use `regex_filter` for client-side narrowing.');
      }
      if (args.include_patterns && args.include_patterns.length > 0) {
        warnings.push('DEPRECATED_PARAM: `include_patterns` is removed. Use `regex_filter` instead.');
      }

      if (!this.apiClient.getIsServer()) {
        throw new Error('search_code is only supported for Bitbucket Server.');
      }

      const limit = args.limit ?? 25;
      const start = args.start ?? 0;

      // Resolve ext from `file_pattern` shorthand for backwards-compat.
      let resolvedExt = args.ext;
      let resolvedPath = args.path;
      if (!resolvedExt && args.file_pattern) {
        const bareExt = extractBareExtension(args.file_pattern);
        if (bareExt) {
          resolvedExt = bareExt;
          warnings.push('DEPRECATED_PARAM: `file_pattern` is removed. Mapped to `ext` for compatibility.');
        } else if (!resolvedPath) {
          resolvedPath = args.file_pattern;
          warnings.push('DEPRECATED_PARAM: `file_pattern` is removed. Mapped to `path` for compatibility.');
        }
      }

      // Build the canonical query as a list of clauses, then let the budget
      // helper render and (if needed) soft-degrade to fit Bitbucket's caps.
      const clauses: QueryClause[] = [
        { text: `project:${args.workspace}`, role: 'project', required: true },
      ];
      if (args.repository) {
        clauses.push({ text: `repo:${args.repository}`, role: 'repo', required: false });
      }
      if (args.lang) {
        clauses.push({ text: `lang:${args.lang}`, role: 'lang', required: false });
      }
      if (resolvedExt) {
        clauses.push({ text: `ext:${resolvedExt}`, role: 'ext', required: false });
      }
      if (resolvedPath) {
        clauses.push({ text: `path:${resolvedPath}`, role: 'path', required: false });
      }
      if (args.archived) {
        clauses.push({ text: `archived:${args.archived}`, role: 'archived', required: false });
      }
      if (args.fork) {
        clauses.push({ text: `fork:${args.fork}`, role: 'fork', required: false });
      }
      // Free-text term last (required, never dropped).
      clauses.push({ text: quoteIfNeeded(rawQuery), role: 'term', required: true });
      // Exclusions.
      for (const term of args.exclude_terms ?? []) {
        if (term.trim().length === 0) continue;
        clauses.push({ text: `-${quoteIfNeeded(term.trim())}`, role: 'exclude', required: false });
      }

      const built = buildQueryFromClauses(clauses);
      if (built.dropped.length > 0) {
        warnings.push(
          `QUERY_TRUNCATED: dropped ${built.dropped.length} optional clause(s) to fit Bitbucket caps (${MAX_QUERY_LENGTH} chars / ${MAX_EXPRESSIONS} expressions). Dropped: ${built.dropped.map(d => d.role).join(', ')}.`
        );
      }
      if (built.query_length > MAX_QUERY_LENGTH || built.expression_count > MAX_EXPRESSIONS) {
        // Even after dropping all optional clauses, we are still over the cap.
        // Return a structured error rather than a 400 from Bitbucket.
        return this.errorResponse(
          `Query still exceeds Bitbucket caps after dropping optional clauses. ` +
            `length=${built.query_length} (max ${MAX_QUERY_LENGTH}), ` +
            `expressions=${built.expression_count} (max ${MAX_EXPRESSIONS}). ` +
            `Shorten the term itself.`
        );
      }

      const postFilter = compileRegexFilter(args.regex_filter);
      if (args.regex_filter && !postFilter) {
        warnings.push(`INVALID_REGEX: \`regex_filter\` could not be compiled and was ignored.`);
      }

      // Primary call. Track raw hit count so we can distinguish "Bitbucket
      // returned nothing" (probe should fire) from "regex_filter narrowed
      // everything away" (probe should not fire).
      const primary = await this.runIndexedSearch(built.query, start, limit);
      const rawHitCount = countRawHitLines(primary);
      let response = buildDenseResponseFromIndex({
        searchResult: primary,
        query: rawQuery,
        filters: stripUndefined({
          project: args.workspace,
          repo: args.repository,
          lang: args.lang,
          ext: resolvedExt,
          path: resolvedPath,
          archived: args.archived,
          fork: args.fork,
          regex_filter: args.regex_filter,
        }),
        warnings,
        diagnostics: {
          expression_count: built.expression_count,
          query_length: built.query_length,
          dropped_clauses: built.dropped,
        },
        start,
        limit,
        postFilter,
      });

      // Optional snake_case ↔ camelCase fanout. Naming-convention only — we do
      // not introduce language knowledge here.
      let totalRawHits = rawHitCount;
      if (args.case_variants) {
        const variant = caseVariant(rawQuery);
        if (variant) {
          const variantClauses = clauses.map(c =>
            c.role === 'term' ? { ...c, text: quoteIfNeeded(variant) } : c
          );
          const variantBuilt = buildQueryFromClauses(variantClauses);
          if (
            variantBuilt.query_length <= MAX_QUERY_LENGTH &&
            variantBuilt.expression_count <= MAX_EXPRESSIONS
          ) {
            const variantResult = await this.runIndexedSearch(variantBuilt.query, start, limit);
            totalRawHits += countRawHitLines(variantResult);
            response = mergeIndexResponses(response, buildDenseResponseFromIndex({
              searchResult: variantResult,
              query: variant,
              filters: response.filters,
              start,
              limit,
              postFilter,
            }));
          }
        }
      }

      // If the user's regex_filter rejected every hit, tell them — clearer than
      // a misleading INDEX_GAP_LIKELY.
      if (response.total_matches === 0 && totalRawHits > 0 && args.regex_filter) {
        response.warnings.push(
          `REGEX_FILTER_REJECTED_ALL: ${totalRawHits} raw hit(s) returned by Bitbucket but the regex_filter rejected them all. Adjust or drop regex_filter to see them.`
        );
      }

      // Index-reach probe: only fires when Bitbucket itself returned zero
      // (raw count, before regex_filter), and we have a repository to probe.
      if (totalRawHits === 0 && args.repository) {
        const probe = await this.indexReachProbe(args.workspace, args.repository, resolvedExt, resolvedPath);
        if (probe.unavailable) {
          response.warnings.push(
            `PROBE_UNAVAILABLE: index returned 0 hits and the file-list probe could not run (${probe.error}). Cannot tell whether the term is missing or the index has a gap.`
          );
        } else if (probe.matching_files > 0) {
          const langHint = args.lang
            ? ` The 'lang:${args.lang}' filter may not be recognized by Bitbucket — try without lang: or use ext: instead.`
            : '';
          const filteredHint = probe.has_filter
            ? `${probe.matching_files} file(s) match your filters but the index returned no hits.`
            : `Repository has ${probe.matching_files} file(s); the index returned 0 hits for this term.`;
          response.warnings.push(
            `INDEX_GAP_LIKELY: ${filteredHint}${langHint} Switch to find_in_files with the same filters.`
          );
        }
      }

      return this.jsonContent(response);
    } catch (error: any) {
      const msg = error.response?.data?.errors?.[0]?.message || error.message;
      return this.errorResponse(`Failed to search code: ${msg}`, error.response?.data);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // find_in_files — list files by glob, fetch contents in parallel, scan with
  // a user-supplied regex. Works regardless of whether Bitbucket indexes the
  // file's language. Cost is O(matched files); always provide a glob.
  // ──────────────────────────────────────────────────────────────────────────
  async handleFindInFiles(args: FindInFilesArgs): Promise<{ content: any[]; isError?: boolean }> {
    try {
      const {
        workspace,
        repository,
        content_query,
        filename_pattern,
        branch,
        regex_filter,
        max_files = 3000,
        parallelism = 4,
        limit = 25,
      } = args;

      if (!workspace || !repository || !content_query) {
        throw new Error('workspace, repository, and content_query are required');
      }

      let contentRe: RegExp;
      try {
        contentRe = new RegExp(content_query); // no /g — we only use .test()
      } catch (e: any) {
        return this.errorResponse(`Invalid content_query regex: ${e.message}`);
      }
      const filterFn = compileRegexFilter(regex_filter);

      // 1) List files matching the glob using the same logic as search_files.
      const allFiles = await this.listFiles(workspace, repository, branch);
      const candidates = filterFilesByGlob(allFiles, filename_pattern);
      const truncated = candidates.length > max_files;
      const toScan = candidates.slice(0, max_files);

      // 2) Fetch contents with a concurrency cap and scan. Track failures
      // separately so silent-zero results do not mislead the caller.
      const scan = await scanFilesConcurrent({
        files: toScan,
        parallelism,
        fetchContent: (filePath) => this.fetchRawContent(workspace, repository, filePath, branch),
        contentRe,
        filterFn,
      });
      const filesAttempted = scan.aborted_after; // honest count: respects early-abort on rate-limit
      const filesSucceeded = filesAttempted - scan.failures.length;

      // 3) Apply hit limit (across all files), preserving file ordering.
      let totalMatches = 0;
      const limitedFiles: Array<{ path: string; matches: Array<{ line: number; text: string }> }> = [];
      for (const f of scan.results) {
        if (totalMatches >= limit) break;
        const remaining = limit - totalMatches;
        const slice = f.matches.slice(0, remaining);
        if (slice.length === 0) continue;
        limitedFiles.push({ path: f.path, matches: slice });
        totalMatches += slice.length;
      }

      const warningsOut: string[] = [];
      if (truncated) {
        warningsOut.push(
          `FILES_TRUNCATED: ${candidates.length} files matched the glob; only the first ${max_files} were scanned. Narrow filename_pattern.`
        );
      }
      if (truncated && totalMatches === 0) {
        warningsOut.push(
          `POSSIBLE_FALSE_NEGATIVE: scanned only ${toScan.length} of ${candidates.length} files; matches in unscanned files would be missed. ` +
            `Narrow filename_pattern (e.g. add a subdirectory) and retry before concluding the term does not exist.`
        );
      }
      if (scan.rate_limited) {
        warningsOut.push(
          `RATE_LIMITED: Bitbucket returned 429/403 mid-scan and the rest of the file list was not attempted (${filesAttempted}/${toScan.length} files attempted). ` +
            `Wait a minute, then narrow filename_pattern and/or lower parallelism before retrying.`
        );
      } else if (scan.failures.length > 0) {
        const sample = scan.failures.slice(0, 3).map(f => f.path).join(', ');
        warningsOut.push(
          `FETCH_FAILURES: ${scan.failures.length} of ${filesAttempted} files failed to read (network, transient, or binary content). ` +
            `Sample: ${sample}. ` +
            (totalMatches === 0
              ? `Zero matches may be a false negative — narrow filename_pattern or lower parallelism.`
              : `Reported matches are partial; some files were not scanned successfully.`)
        );
      }

      const response: DenseSearchResponse = {
        query: content_query,
        filters: stripUndefined({
          project: workspace,
          repo: repository,
          filename_pattern,
          branch,
          regex_filter,
        }),
        engine: 'find_in_files',
        total_files: limitedFiles.length,
        total_matches: totalMatches,
        files: limitedFiles,
        warnings: warningsOut,
        next_start: null,
        diagnostics: {
          files_scanned: filesSucceeded,
          files_attempted: filesAttempted,
          files_failed: scan.failures.length,
          files_truncated: truncated,
          default_branch_only: !branch,
        },
      };

      return this.jsonContent(response);
    } catch (error: any) {
      const msg = error.response?.data?.errors?.[0]?.message || error.message;
      return this.errorResponse(`Failed to run find_in_files: ${msg}`, error.response?.data);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // search_repositories — unchanged from previous behavior, modernized output.
  // ──────────────────────────────────────────────────────────────────────────
  async handleSearchRepositories(args: any) {
    try {
      const { search_query, query, workspace, limit = 10 } = args;
      const term = (query ?? search_query ?? '').trim();

      if (!term) throw new Error('query is required');
      if (!this.apiClient.getIsServer()) {
        throw new Error('search_repositories is only supported for Bitbucket Server.');
      }

      let q = term;
      if (workspace) q = `project:${workspace} ${q}`;

      const payload: BitbucketServerSearchRequest = {
        query: q,
        entities: { repositories: {} },
        limits: { primary: limit },
      };
      const response = await this.apiClient.makeRequest<BitbucketServerSearchResult>(
        'post',
        `/rest/search/latest/search?avatarSize=64`,
        payload
      );

      const repos = response.repositories?.values ?? [];
      const formatted = repos.map(r => ({
        slug: r.slug,
        name: r.name,
        project: r.project.key,
        project_name: r.project.name,
        description: r.description ?? '',
        public: r.public ?? false,
      }));

      return this.jsonContent({
        query: term,
        filters: { project: workspace },
        total_repositories: formatted.length,
        has_more: response.repositories?.isLastPage === false,
        repositories: formatted,
      });
    } catch (error: any) {
      const msg = error.response?.data?.errors?.[0]?.message || error.message;
      return this.errorResponse(`Failed to search repositories: ${msg}`, error.response?.data);
    }
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async runIndexedSearch(query: string, start: number, limit: number) {
    const payload: BitbucketServerSearchRequest = {
      query,
      entities: { code: { start, limit } },
    };
    return this.apiClient.makeRequest<BitbucketServerSearchResult>(
      'post',
      `/rest/search/latest/search?avatarSize=64`,
      payload
    );
  }

  // Best-effort probe: if the index returned no hits, see whether files match
  // the same ext/path filters at all. If yes, the index has a coverage gap.
  // Distinguishes "probe ran but found no match" from "probe failed to run."
  private async indexReachProbe(
    workspace: string,
    repository: string,
    ext: string | undefined,
    path: string | undefined
  ): Promise<{ matching_files: number; unavailable?: false; has_filter: boolean } | { unavailable: true; error: string; matching_files: 0; has_filter: false }> {
    try {
      const all = await this.listFiles(workspace, repository, undefined);
      const hasFilter = Boolean(ext || path);
      const glob = ext ? `**/*.${ext}` : path ? `${path.replace(/\/$/, '')}/**` : null;
      const matched = glob ? filterFilesByGlob(all, glob) : all;
      return { matching_files: matched.length, has_filter: hasFilter };
    } catch (err: any) {
      return { unavailable: true, error: err?.message ?? String(err), matching_files: 0, has_filter: false };
    }
  }

  private async listFiles(workspace: string, repository: string, branch?: string): Promise<string[]> {
    const apiPath = `/rest/api/latest/projects/${workspace}/repos/${repository}/files`;
    const params: any = { limit: 100000 };
    if (branch) params.at = `refs/heads/${branch}`;
    const resp = await this.apiClient.makeRequest<any>('get', apiPath, undefined, { params });
    if (Array.isArray(resp)) return resp;
    if (resp?.values) return resp.values;
    return [];
  }

  private async fetchRawContent(
    workspace: string,
    repository: string,
    filePath: string,
    branch?: string
  ): Promise<string> {
    const rawPath = `/rest/api/latest/projects/${workspace}/repos/${repository}/raw/${filePath}`;
    const params: any = {};
    if (branch) params.at = `refs/heads/${branch}`;
    return this.apiClient.makeRequest<string>('get', rawPath, undefined, {
      params,
      responseType: 'text',
      headers: { Accept: 'text/plain' },
    });
  }

  private jsonContent(payload: unknown) {
    return {
      content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    };
  }

  private errorResponse(message: string, details?: unknown) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message, details }, null, 2) }],
      isError: true,
    };
  }
}

// ── Module-level helpers (no class state needed) ──────────────────────────────

function filterFilesByGlob(files: string[], pattern?: string): string[] {
  if (!pattern) return files;
  return files.filter(p => {
    if (minimatch(p, pattern, { matchBase: true, nocase: true })) return true;
    if (!pattern.startsWith('**/') && minimatch(p, `**/${pattern}`, { matchBase: true, nocase: true })) return true;
    return false;
  });
}

function mergeIndexResponses(a: DenseSearchResponse, b: DenseSearchResponse): DenseSearchResponse {
  const byPath = new Map<string, Map<number, string>>();
  for (const f of [...a.files, ...b.files]) {
    let lines = byPath.get(f.path);
    if (!lines) {
      lines = new Map();
      byPath.set(f.path, lines);
    }
    for (const m of f.matches) lines.set(m.line, m.text);
  }
  const files = Array.from(byPath.entries()).map(([path, lines]) => ({
    path,
    matches: Array.from(lines.entries())
      .map(([line, text]) => ({ line, text }))
      .sort((x, y) => x.line - y.line),
  }));
  const total_matches = files.reduce((acc, f) => acc + f.matches.length, 0);
  return {
    ...a,
    total_files: files.length,
    total_matches,
    files,
    warnings: [...a.warnings, ...b.warnings],
  };
}

interface ScanOutcome {
  results: Array<{ path: string; matches: Array<{ line: number; text: string }> }>;
  failures: Array<{ path: string; error: string }>;
  rate_limited: boolean;
  aborted_after: number; // number of files attempted before early-abort (or total if not aborted)
}

// Threshold of consecutive 403s before we treat them as rate-limiting rather
// than per-file permission denials. Single 429 always aborts immediately.
const FORBIDDEN_ABORT_THRESHOLD = 3;

function statusOf(err: any): number | undefined {
  return err?.response?.status ?? err?.status;
}

async function scanFilesConcurrent(args: {
  files: string[];
  parallelism: number;
  fetchContent: (filePath: string) => Promise<string>;
  contentRe: RegExp;
  filterFn?: (line: string) => boolean;
}): Promise<ScanOutcome> {
  const { files, parallelism, fetchContent, contentRe, filterFn } = args;

  const results: ScanOutcome['results'] = [];
  const failures: ScanOutcome['failures'] = [];
  let i = 0;
  let aborted = false;
  let rateLimited = false;
  let consecutive403s = 0;
  const workers: Promise<void>[] = [];
  const workerCount = Math.max(1, Math.min(parallelism, files.length));

  const next = async (): Promise<void> => {
    while (true) {
      if (aborted) return;
      const idx = i++;
      if (idx >= files.length) return;
      const filePath = files[idx];
      try {
        const content = await fetchContent(filePath);
        consecutive403s = 0; // a successful read clears the streak
        const matches = scanContent(content, contentRe, filterFn);
        if (matches.length > 0) results.push({ path: filePath, matches });
      } catch (err: any) {
        const status = statusOf(err);
        failures.push({ path: filePath, error: err?.message ?? String(err) });
        if (status === 429) {
          rateLimited = true;
          aborted = true;
          return;
        }
        if (status === 403) {
          consecutive403s++;
          if (consecutive403s >= FORBIDDEN_ABORT_THRESHOLD) {
            rateLimited = true;
            aborted = true;
            return;
          }
        } else {
          consecutive403s = 0;
        }
      }
    }
  };

  for (let w = 0; w < workerCount; w++) workers.push(next());
  await Promise.all(workers);

  results.sort((a, b) => a.path.localeCompare(b.path));
  return { results, failures, rate_limited: rateLimited, aborted_after: Math.min(i, files.length) };
}

function scanContent(
  content: string,
  contentRe: RegExp,
  filterFn?: (line: string) => boolean
): Array<{ line: number; text: string }> {
  const lines = content.split('\n');
  const out: Array<{ line: number; text: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!contentRe.test(line)) continue;
    if (filterFn && !filterFn(line)) continue;
    out.push({ line: i + 1, text: line });
  }
  return out;
}

// Count raw hit lines from a Bitbucket index response (lines marked with <em>).
// Mirrors the formatter's filter so probe decisions stay in sync.
function countRawHitLines(searchResult: BitbucketServerSearchResult): number {
  let n = 0;
  for (const value of searchResult.code?.values ?? []) {
    for (const group of value.hitContexts ?? []) {
      for (const ctx of group) {
        if (/<em>/.test(ctx.text)) n++;
      }
    }
  }
  return n;
}

function stripUndefined<T extends Record<string, any>>(obj: T): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}
