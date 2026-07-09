import type { BitbucketMcpConfig, ToolGroup } from '../types/index.js';

// Central configuration. EVERY numeric or behavioral policy the server
// applies is defined here — call sites never hard-code limits. Each field is
// overridable via environment variables (v2.x used the same variable names,
// so upgrades keep their settings; the string[] lookup exists for future
// renames). CONFIG_REFERENCE at the bottom documents the full set.

export const ALL_TOOL_GROUPS: ToolGroup[] = [
  'pr_core',
  'pr_comments',
  'pr_review',
  'commits',
  'branches',
  'files',
  'search',
  'attachments',
  'discovery',
];

type Env = Record<string, string | undefined>;

function pick(env: Env, names: string[]): string | undefined {
  for (const name of names) {
    const v = env[name];
    if (v !== undefined && v !== '') return v;
  }
  return undefined;
}

function envNum(env: Env, names: string[], fallback: number, opts: { min?: number; max?: number } = {}): number {
  const raw = pick(env, names);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    console.error(`[bitbucket-mcp] Ignoring non-numeric ${names[0]}=${raw}; using default ${fallback}`);
    return fallback;
  }
  if (opts.min !== undefined && n < opts.min) return opts.min;
  if (opts.max !== undefined && n > opts.max) return opts.max;
  return n;
}

function envBool(env: Env, names: string[], fallback: boolean): boolean {
  const raw = pick(env, names);
  if (raw === undefined) return fallback;
  return !['false', '0', 'no', 'off'].includes(raw.toLowerCase());
}

function parseToolGroups(env: Env): string[] | null {
  const raw = pick(env, ['BITBUCKET_TOOL_GROUPS']);
  if (!raw) return null;
  const requested = raw.split(',').map(g => g.trim()).filter(Boolean);
  const valid: string[] = [];
  for (const g of requested) {
    if ((ALL_TOOL_GROUPS as string[]).includes(g)) {
      valid.push(g);
    } else {
      console.error(
        `[bitbucket-mcp] Unknown tool group "${g}" in BITBUCKET_TOOL_GROUPS — valid groups: ${ALL_TOOL_GROUPS.join(', ')}`
      );
    }
  }
  // Fail CLOSED: a restriction that was requested but entirely mistyped must
  // not silently expose everything.
  if (requested.length > 0 && valid.length === 0) {
    console.error('[bitbucket-mcp] BITBUCKET_TOOL_GROUPS contained no valid groups — exposing NO tools.');
    return [];
  }
  return valid;
}

export function loadConfig(env: Env = process.env): BitbucketMcpConfig {
  const maxConcurrent = envNum(env, ['BITBUCKET_GLOBAL_MAX_CONCURRENCY'], 8, { min: 0 });

  return {
    auth: {
      baseUrl: pick(env, ['BITBUCKET_BASE_URL']) ?? 'https://api.bitbucket.org/2.0',
      username: pick(env, ['BITBUCKET_USERNAME']) ?? '',
      appPassword: pick(env, ['BITBUCKET_APP_PASSWORD']),
      token: pick(env, ['BITBUCKET_TOKEN']),
    },
    http: {
      timeoutMs: envNum(env, ['BITBUCKET_HTTP_TIMEOUT_MS'], 30_000, { min: 0 }),
      archiveTimeoutMs: envNum(env, ['BITBUCKET_ARCHIVE_TIMEOUT_MS'], 300_000, { min: 0 }),
      archiveStallMs: envNum(env, ['BITBUCKET_ARCHIVE_STALL_MS'], 60_000, { min: 1_000 }),
      keepAlive: envBool(env, ['BITBUCKET_HTTP_KEEP_ALIVE'], true),
      // maxConcurrent=0 disables the semaphore, not the socket pool — keep a
      // sane pool in that case instead of Math.max(0,1)=1 serializing traffic.
      maxSockets: envNum(env, ['BITBUCKET_HTTP_MAX_SOCKETS'], maxConcurrent > 0 ? maxConcurrent : 8, { min: 1 }),
    },
    rateLimit: {
      ratePerSec: envNum(env, ['BITBUCKET_RATE_LIMIT_RPS'], 5, { min: 0 }),
      burst: envNum(env, ['BITBUCKET_RATE_LIMIT_BURST'], 50, { min: 1 }),
      maxConcurrent,
      maxConcurrentArchives: envNum(env, ['BITBUCKET_MAX_CONCURRENT_ARCHIVES'], 2, { min: 1 }),
    },
    retry: {
      maxRetries: envNum(env, ['BITBUCKET_RETRY_MAX'], 4, { min: 0 }),
      baseDelayMs: envNum(env, ['BITBUCKET_RETRY_BASE_MS'], 1_000, { min: 0 }),
      maxDelayMs: envNum(env, ['BITBUCKET_RETRY_MAX_DELAY_MS'], 15_000, { min: 0 }),
      totalWaitCapMs: envNum(env, ['BITBUCKET_RETRY_TOTAL_WAIT_MS'], 30_000, { min: 0 }),
      retryAfterCapMs: envNum(env, ['BITBUCKET_RETRY_AFTER_CAP_MS'], 60_000, { min: 0 }),
      retryStatuses: (pick(env, ['BITBUCKET_RETRY_STATUSES']) ?? '429,503,408')
        .split(',')
        .map(s => Number(s.trim()))
        .filter(n => Number.isInteger(n) && n >= 100 && n <= 599),
    },
    snapshot: {
      maxTotalMb: envNum(env, ['BITBUCKET_SNAPSHOT_MAX_MB'], 256, { min: 0 }),
      maxSnapshotShare: envNum(env, ['BITBUCKET_SNAPSHOT_MAX_SHARE'], 0.4, { min: 0.05, max: 1 }),
      maxRetainedFileKb: envNum(env, ['BITBUCKET_SNAPSHOT_MAX_FILE_KB'], 2_048, { min: 1 }),
      binarySniffBytes: envNum(env, ['BITBUCKET_BINARY_SNIFF_BYTES'], 8_192, { min: 256 }),
      // Freshness contract: every cache read re-validates the branch head.
      // This memo only dedupes validations within a short burst; 0 = validate
      // on literally every call.
      refResolveTtlMs: envNum(env, ['BITBUCKET_REF_RESOLVE_TTL_MS'], 15_000, { min: 0 }),
      streamAbortMb: envNum(env, ['BITBUCKET_STREAM_ABORT_MB'], 2_048, { min: 0 }),
      warmRefetchMax: envNum(env, ['BITBUCKET_WARM_REFETCH_MAX'], 25, { min: 0 }),
    },
    grep: {
      defaultMaxMatches: envNum(env, ['BITBUCKET_GREP_DEFAULT_MATCHES'], 50, { min: 1 }),
      maxMatchesCap: envNum(env, ['BITBUCKET_GREP_MAX_MATCHES'], 1_000, { min: 1 }),
      defaultContext: envNum(env, ['BITBUCKET_GREP_DEFAULT_CONTEXT'], 0, { min: 0 }),
      maxContext: envNum(env, ['BITBUCKET_GREP_MAX_CONTEXT'], 10, { min: 0 }),
      maxLineLength: envNum(env, ['BITBUCKET_GREP_MAX_LINE_LENGTH'], 300, { min: 40 }),
    },
    scan: {
      defaultParallelism: envNum(env, ['BITBUCKET_DEFAULT_PARALLELISM'], 4, { min: 1 }),
      maxParallelism: envNum(env, ['BITBUCKET_MAX_PARALLELISM'], 20, { min: 1 }),
      maxScanFiles: envNum(env, ['BITBUCKET_MAX_SCAN_FILES'], 3_000, { min: 1 }),
      rateLimitMaxAttempts: envNum(env, ['BITBUCKET_SCAN_429_ATTEMPTS'], 3, { min: 1 }),
      rateLimitBaseBackoffMs: envNum(env, ['BITBUCKET_SCAN_429_BASE_MS'], 2_000, { min: 0 }),
      rateLimitMaxBackoffMs: envNum(env, ['BITBUCKET_SCAN_429_MAX_MS'], 30_000, { min: 0 }),
    },
    pagination: {
      filesPageLimit: envNum(env, ['BITBUCKET_FILES_PAGE_LIMIT'], 100_000, { min: 100 }),
      filesMaxPages: envNum(env, ['BITBUCKET_FILES_MAX_PAGES'], 40, { min: 1 }),
      activitiesPageLimit: envNum(env, ['BITBUCKET_ACTIVITIES_PAGE_LIMIT'], 500, { min: 25 }),
      activitiesMaxPages: envNum(env, ['BITBUCKET_ACTIVITIES_MAX_PAGES'], 5, { min: 1 }),
      browsePageLines: envNum(env, ['BITBUCKET_BROWSE_PAGE_LINES'], 5_000, { min: 100 }),
      browseMaxPages: envNum(env, ['BITBUCKET_BROWSE_MAX_PAGES'], 20, { min: 1 }),
      commitsPageLimit: envNum(env, ['BITBUCKET_COMMITS_PAGE_LIMIT'], 100, { min: 1 }),
      commitsFilterMaxPages: envNum(env, ['BITBUCKET_COMMITS_FILTER_MAX_PAGES'], 5, { min: 1 }),
      changesLimit: envNum(env, ['BITBUCKET_CHANGES_LIMIT'], 1_000, { min: 1 }),
      cloudCommentsPageLen: envNum(env, ['BITBUCKET_CLOUD_COMMENTS_PAGELEN'], 100, { min: 1 }),
      branchLookupLimit: envNum(env, ['BITBUCKET_BRANCH_LOOKUP_LIMIT'], 25, { min: 1 }),
      defaultListLimit: envNum(env, ['BITBUCKET_DEFAULT_LIST_LIMIT'], 25, { min: 1 }),
      probePageLimit: envNum(env, ['BITBUCKET_PROBE_PAGE_LIMIT'], 1_000, { min: 1 }),
      filesListTtlMs: envNum(env, ['BITBUCKET_FILES_LIST_TTL_MS'], 60_000, { min: 0 }),
      dirPageLimit: envNum(env, ['BITBUCKET_DIR_PAGE_LIMIT'], 1_000, { min: 1 }),
    },
    output: {
      commentDefaultLimit: envNum(env, ['BITBUCKET_COMMENT_DEFAULT_LIMIT'], 20, { min: 1 }),
      commentTextMax: envNum(env, ['BITBUCKET_COMMENT_TEXT_MAX'], 2_000, { min: 100 }),
      errorDetailsMax: envNum(env, ['BITBUCKET_ERROR_DETAILS_MAX'], 500, { min: 100 }),
      attachmentTextMaxKb: envNum(env, ['BITBUCKET_ATTACHMENT_TEXT_MAX_KB'], 100, { min: 1 }),
      fileContentMaxKb: envNum(env, ['BITBUCKET_FILE_CONTENT_MAX_KB'], 512, { min: 8 }),
      excludedListMax: envNum(env, ['BITBUCKET_EXCLUDED_LIST_MAX'], 10, { min: 0 }),
      snippetMatchListMax: envNum(env, ['BITBUCKET_SNIPPET_MATCH_LIST_MAX'], 5, { min: 1 }),
    },
    toolGroups: parseToolGroups(env),
  };
}

/**
 * Documentation of every configuration variable (used for README generation
 * and the `config` diagnostics output). Defaults mirror loadConfig().
 */
export const CONFIG_REFERENCE: Array<{ env: string; def: string; description: string }> = [
  { env: 'BITBUCKET_BASE_URL', def: 'https://api.bitbucket.org/2.0', description: 'Bitbucket base URL (Server/DC root or Cloud API root)' },
  { env: 'BITBUCKET_USERNAME', def: '(required)', description: 'Username the credentials belong to' },
  { env: 'BITBUCKET_APP_PASSWORD', def: '—', description: 'Bitbucket Cloud app password (basic auth)' },
  { env: 'BITBUCKET_TOKEN', def: '—', description: 'Bitbucket Server/DC personal access token (bearer)' },
  { env: 'BITBUCKET_HTTP_TIMEOUT_MS', def: '30000', description: 'Per-request timeout for REST calls' },
  { env: 'BITBUCKET_ARCHIVE_TIMEOUT_MS', def: '300000', description: 'Timeout for archive (tar.gz) download streams' },
  { env: 'BITBUCKET_ARCHIVE_STALL_MS', def: '60000', description: 'Destroy an archive stream after this much inactivity' },
  { env: 'BITBUCKET_HTTP_KEEP_ALIVE', def: 'true', description: 'Reuse sockets across requests' },
  { env: 'BITBUCKET_HTTP_MAX_SOCKETS', def: '=concurrency', description: 'Socket pool size' },
  { env: 'BITBUCKET_RATE_LIMIT_RPS', def: '5', description: 'Client-side sustained request rate; 0 disables pacing (exempted account)' },
  { env: 'BITBUCKET_RATE_LIMIT_BURST', def: '50', description: 'Client-side burst capacity (DC default server bucket is 60)' },
  { env: 'BITBUCKET_GLOBAL_MAX_CONCURRENCY', def: '8', description: 'Max concurrent in-flight requests across all tools; 0 disables' },
  { env: 'BITBUCKET_MAX_CONCURRENT_ARCHIVES', def: '2', description: 'Max concurrent archive downloads' },
  { env: 'BITBUCKET_RETRY_MAX', def: '4', description: 'Max retries per request (Atlassian guidance)' },
  { env: 'BITBUCKET_RETRY_BASE_MS', def: '1000', description: 'Exponential backoff base' },
  { env: 'BITBUCKET_RETRY_MAX_DELAY_MS', def: '15000', description: 'Per-attempt backoff cap' },
  { env: 'BITBUCKET_RETRY_TOTAL_WAIT_MS', def: '30000', description: 'Total retry wait budget per request (fail fast for interactive use)' },
  { env: 'BITBUCKET_RETRY_AFTER_CAP_MS', def: '60000', description: 'Sanity clamp on server Retry-After values' },
  { env: 'BITBUCKET_RETRY_STATUSES', def: '429,503,408', description: 'HTTP statuses that trigger retries' },
  { env: 'BITBUCKET_SNAPSHOT_MAX_MB', def: '256', description: 'Total in-memory snapshot cache budget; 0 = pure streaming (no retention)' },
  { env: 'BITBUCKET_SNAPSHOT_MAX_SHARE', def: '0.4', description: 'Max share of the budget one snapshot may take' },
  { env: 'BITBUCKET_SNAPSHOT_MAX_FILE_KB', def: '2048', description: 'Files larger than this are scanned but not cached' },
  { env: 'BITBUCKET_BINARY_SNIFF_BYTES', def: '8192', description: 'Bytes checked for NUL to classify binaries' },
  { env: 'BITBUCKET_REF_RESOLVE_TTL_MS', def: '15000', description: 'Memo TTL for branch→SHA resolution between tool calls; 0 = validate every call' },
  { env: 'BITBUCKET_STREAM_ABORT_MB', def: '2048', description: 'Abort archive stream past this many extracted MB; 0 = unlimited' },
  { env: 'BITBUCKET_WARM_REFETCH_MAX', def: '25', description: 'Max uncached files re-fetched individually on warm grep; above → re-stream archive' },
  { env: 'BITBUCKET_DIR_PAGE_LIMIT', def: '1000', description: 'Directory listing page size' },
  { env: 'BITBUCKET_GREP_DEFAULT_MATCHES', def: '50', description: 'Default max match lines returned by grep' },
  { env: 'BITBUCKET_GREP_MAX_MATCHES', def: '1000', description: 'Cap on caller-requested grep matches' },
  { env: 'BITBUCKET_GREP_DEFAULT_CONTEXT', def: '0', description: 'Default context lines around grep matches' },
  { env: 'BITBUCKET_GREP_MAX_CONTEXT', def: '10', description: 'Max context lines' },
  { env: 'BITBUCKET_GREP_MAX_LINE_LENGTH', def: '300', description: 'Display truncation for match lines (marked when applied)' },
  { env: 'BITBUCKET_DEFAULT_PARALLELISM', def: '4', description: 'Fan-out fallback: concurrent per-file fetches' },
  { env: 'BITBUCKET_MAX_PARALLELISM', def: '20', description: 'Fan-out fallback: parallelism cap' },
  { env: 'BITBUCKET_MAX_SCAN_FILES', def: '3000', description: 'Fan-out fallback: max files fetched per scan' },
  { env: 'BITBUCKET_SCAN_429_ATTEMPTS', def: '3', description: 'Fan-out fallback: per-file attempts on 429' },
  { env: 'BITBUCKET_SCAN_429_BASE_MS', def: '2000', description: 'Fan-out fallback: per-file backoff base' },
  { env: 'BITBUCKET_SCAN_429_MAX_MS', def: '30000', description: 'Fan-out fallback: per-file backoff cap' },
  { env: 'BITBUCKET_FILES_PAGE_LIMIT', def: '100000', description: '/files page size (server default cap is 100k entries)' },
  { env: 'BITBUCKET_FILES_MAX_PAGES', def: '40', description: '/files pagination safety cap' },
  { env: 'BITBUCKET_ACTIVITIES_PAGE_LIMIT', def: '500', description: 'PR activities page size (server clamps at 500)' },
  { env: 'BITBUCKET_ACTIVITIES_MAX_PAGES', def: '5', description: 'PR activities pages before honest truncation warning' },
  { env: 'BITBUCKET_BROWSE_PAGE_LINES', def: '5000', description: 'browse page size in lines (server clamps at 5000)' },
  { env: 'BITBUCKET_BROWSE_MAX_PAGES', def: '20', description: 'browse/blame pagination safety cap' },
  { env: 'BITBUCKET_COMMITS_PAGE_LIMIT', def: '100', description: 'commits page size (server clamps at 100)' },
  { env: 'BITBUCKET_COMMITS_FILTER_MAX_PAGES', def: '5', description: 'Pages walked when filtering commits client-side' },
  { env: 'BITBUCKET_CHANGES_LIMIT', def: '1000', description: 'PR/commit changes limit (server hard cap, non-pageable)' },
  { env: 'BITBUCKET_CLOUD_COMMENTS_PAGELEN', def: '100', description: 'Cloud comments page size' },
  { env: 'BITBUCKET_BRANCH_LOOKUP_LIMIT', def: '25', description: 'Page size for single-branch lookups' },
  { env: 'BITBUCKET_DEFAULT_LIST_LIMIT', def: '25', description: 'Default page size for list tools' },
  { env: 'BITBUCKET_PROBE_PAGE_LIMIT', def: '1000', description: 'Index-gap probe: single-page file listing size' },
  { env: 'BITBUCKET_FILES_LIST_TTL_MS', def: '60000', description: 'TTL for cached repo file listings; 0 disables' },
  { env: 'BITBUCKET_COMMENT_DEFAULT_LIMIT', def: '20', description: 'Default comments embedded in get_pull_request' },
  { env: 'BITBUCKET_COMMENT_TEXT_MAX', def: '2000', description: 'Embedded comment/task body truncation (marked)' },
  { env: 'BITBUCKET_ERROR_DETAILS_MAX', def: '500', description: 'Error details payload cap' },
  { env: 'BITBUCKET_ATTACHMENT_TEXT_MAX_KB', def: '100', description: 'Text attachment download cap (marked)' },
  { env: 'BITBUCKET_FILE_CONTENT_MAX_KB', def: '512', description: 'Whole-file read cap for full_content/tail/Cloud paths (marked, window guidance)' },
  { env: 'BITBUCKET_EXCLUDED_LIST_MAX', def: '10', description: 'Excluded-file paths listed on filtered diffs' },
  { env: 'BITBUCKET_SNIPPET_MATCH_LIST_MAX', def: '5', description: 'Occurrences listed on ambiguous code_snippet' },
  { env: 'BITBUCKET_TOOL_GROUPS', def: '(all)', description: 'Comma-separated tool groups to expose; validated, enforced on call' },
];
