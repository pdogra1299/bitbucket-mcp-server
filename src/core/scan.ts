import type { ConfigScanFallback } from '../types/index.js';
import { sleep } from './throttle.js';

// Bounded per-file fan-out scanner — the FALLBACK engine used when the
// archive-based snapshot path is unavailable (Cloud, archive disabled, or
// stream aborted). All limits come from config.scan. 429s are retried per
// file honoring Retry-After; persistent throttling aborts the scan with
// results kept — never silently.

export type ScanFailure = { path: string; error: string; status?: number };

export type ScanOutcome = {
  results: Array<{ path: string; matches: Array<{ line: number; text: string }> }>;
  failures: ScanFailure[];
  rate_limited: boolean;
  /** True when the wall-clock deadline stopped the scan early (results kept). */
  timed_out: boolean;
  /** Lines longer than maxScanLineLength that were not regex-scanned. */
  long_lines_skipped: number;
  /** Files attempted before an early abort (or total when not aborted). */
  aborted_after: number;
};

function statusOf(err: any): number | undefined {
  return err?.response?.status ?? err?.status;
}

function retryAfterMsOf(err: any): number | undefined {
  const headers = err?.headers ?? err?.response?.headers;
  const raw = headers?.['retry-after'];
  if (raw === undefined) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

export async function scanFilesConcurrent(args: {
  files: string[];
  parallelism: number;
  scanConfig: ConfigScanFallback;
  fetchContent: (filePath: string) => Promise<string>;
  contentRe: RegExp;
  filterFn?: (line: string) => boolean;
  /** Epoch-ms wall-clock deadline; the scan stops (results kept, marked) when passed. */
  deadlineAt?: number;
  /** Lines longer than this are counted, not scanned (bounds per-line regex cost). */
  maxScanLineLength?: number;
}): Promise<ScanOutcome> {
  const { files, parallelism, scanConfig, fetchContent, contentRe, filterFn, deadlineAt, maxScanLineLength } = args;
  const lineStats = { longLinesSkipped: 0 };

  const results: ScanOutcome['results'] = [];
  const failures: ScanOutcome['failures'] = [];
  let i = 0;
  let aborted = false;
  let rateLimited = false;
  let timedOut = false;
  const workers: Promise<void>[] = [];
  const workerCount = Math.max(1, Math.min(parallelism, files.length));

  const next = async (): Promise<void> => {
    while (true) {
      if (aborted) return;
      if (deadlineAt !== undefined && Date.now() > deadlineAt) {
        timedOut = true;
        aborted = true;
        return;
      }
      const idx = i++;
      if (idx >= files.length) return;
      const filePath = files[idx];

      let content: string | undefined;
      let lastErr: any;
      for (let attempt = 1; attempt <= scanConfig.rateLimitMaxAttempts; attempt++) {
        try {
          content = await fetchContent(filePath);
          lastErr = undefined;
          break;
        } catch (err: any) {
          lastErr = err;
          if (statusOf(err) !== 429 || attempt === scanConfig.rateLimitMaxAttempts || aborted) break;
          const backoff = retryAfterMsOf(err) ?? scanConfig.rateLimitBaseBackoffMs * 2 ** (attempt - 1);
          await sleep(Math.min(backoff + Math.random() * 250, scanConfig.rateLimitMaxBackoffMs));
        }
      }

      if (lastErr !== undefined) {
        const status = statusOf(lastErr);
        failures.push({ path: filePath, error: lastErr?.message ?? String(lastErr), status });
        if (status === 429) {
          // Still throttled after retries — stop the scan; results so far are kept.
          rateLimited = true;
          aborted = true;
          return;
        }
        continue; // 403 and other per-file failures: skip the file, keep scanning
      }

      const matches = scanContent(content as string, contentRe, filterFn, { maxScanLineLength, stats: lineStats });
      if (matches.length > 0) results.push({ path: filePath, matches });
    }
  };

  for (let w = 0; w < workerCount; w++) workers.push(next());
  await Promise.all(workers);

  results.sort((a, b) => a.path.localeCompare(b.path));
  return {
    results,
    failures,
    rate_limited: rateLimited,
    timed_out: timedOut,
    long_lines_skipped: lineStats.longLinesSkipped,
    aborted_after: Math.min(i, files.length),
  };
}

export function scanContent(
  content: string,
  contentRe: RegExp,
  filterFn?: (line: string) => boolean,
  opts: { maxScanLineLength?: number; stats?: { longLinesSkipped: number } } = {}
): Array<{ line: number; text: string }> {
  const maxLen = opts.maxScanLineLength ?? Infinity;
  const lines = content.split('\n');
  const out: Array<{ line: number; text: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw; // CRLF: keep $-anchored regexes working
    if (line.length > maxLen) {
      if (opts.stats) opts.stats.longLinesSkipped += 1;
      continue;
    }
    if (!contentRe.test(line)) continue;
    if (filterFn && !filterFn(line)) continue;
    out.push({ line: i + 1, text: line });
  }
  return out;
}
