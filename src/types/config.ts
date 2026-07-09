// Configuration types. Every numeric or behavioral policy the server applies
// lives in one BitbucketMcpConfig object (see src/config/index.ts) — nothing
// is hard-coded at call sites, and every field is overridable via env vars.

export type ConfigAuth = {
  baseUrl: string;
  username: string;
  /** Bitbucket Cloud app password (basic auth). */
  appPassword?: string;
  /** Bitbucket Server / Data Center bearer token. */
  token?: string;
};

export type ConfigHttp = {
  /** Per-request timeout for normal REST calls (ms). */
  timeoutMs: number;
  /** Timeout for archive downloads — long streams (ms). */
  archiveTimeoutMs: number;
  /**
   * Inactivity watchdog for archive streams (ms): the stream is destroyed
   * when no data arrives for this long (axios timeouts stop at headers).
   */
  archiveStallMs: number;
  /** Reuse sockets across requests. */
  keepAlive: boolean;
  /**
   * Socket pool cap. Defaults to rateLimit.maxConcurrent when that cap is
   * enabled; when maxConcurrent is 0 (semaphore disabled) the pool falls
   * back to its own non-zero default — 0 never means a zero-socket pool.
   */
  maxSockets: number;
};

export type ConfigRateLimit = {
  /**
   * Sustained request rate (req/sec). Bitbucket DC's default per-user refill
   * is 5/sec. Set 0 to disable client-side pacing (exempted service account).
   */
  ratePerSec: number;
  /** Burst capacity. DC's default per-user bucket is 60; stay under it. */
  burst: number;
  /** Max concurrent in-flight requests across ALL tools. 0 disables. */
  maxConcurrent: number;
  /** Max concurrent archive downloads (heavyweight streams). */
  maxConcurrentArchives: number;
};

export type ConfigRetry = {
  /** Max retry attempts after the first try. */
  maxRetries: number;
  /** Exponential backoff base (ms). */
  baseDelayMs: number;
  /** Per-attempt backoff cap (ms). */
  maxDelayMs: number;
  /** Total time budget spent waiting across all retries of one request (ms). */
  totalWaitCapMs: number;
  /** Sanity clamp on server-supplied Retry-After (ms). */
  retryAfterCapMs: number;
  /** HTTP statuses that trigger a retry (429 retries any method; others GET-only). */
  retryStatuses: number[];
};

export type ConfigSnapshot = {
  /** Total in-memory budget for repo snapshots (MB). 0 disables retention (pure streaming). */
  maxTotalMb: number;
  /** No single snapshot may exceed this share of the total budget (0..1). */
  maxSnapshotShare: number;
  /**
   * Files larger than this are not RETAINED in the cache (KB). They are still
   * fully SCANNED during streaming, and re-fetched individually on warm
   * queries — retention caps never reduce scan completeness.
   */
  maxRetainedFileKb: number;
  /** Bytes sniffed for NUL to classify a file as binary. */
  binarySniffBytes: number;
  /** TTL for memoizing ref→SHA resolution within a burst of calls (ms). */
  refResolveTtlMs: number;
  /**
   * Abort the archive stream when total EXTRACTED bytes exceed this (MB).
   * The grep then falls back to the bounded per-file scan. 0 = no abort cap.
   */
  streamAbortMb: number;
  /**
   * Warm queries re-fetch at most this many uncached (omitted) files
   * individually; above it, the engine re-streams the archive instead —
   * one request beats N, and coverage stays complete either way.
   */
  warmRefetchMax: number;
};

export type ConfigGrep = {
  /** Default max match lines returned. */
  defaultMaxMatches: number;
  /** Upper bound a caller may request. */
  maxMatchesCap: number;
  /** Default context lines around each match. */
  defaultContext: number;
  /** Max context lines a caller may request. */
  maxContext: number;
  /** Display truncation for a single match line (chars); truncation is marked. */
  maxLineLength: number;
};

export type ConfigScanFallback = {
  /** Concurrent per-file fetches in fan-out fallback mode. */
  defaultParallelism: number;
  /** Cap on caller-requested parallelism. */
  maxParallelism: number;
  /** Max files fetched per fan-out scan. */
  maxScanFiles: number;
  /** Retry attempts per file on 429 during a scan. */
  rateLimitMaxAttempts: number;
  /** Base backoff between per-file 429 retries (ms). */
  rateLimitBaseBackoffMs: number;
  /** Cap on per-file backoff (ms). */
  rateLimitMaxBackoffMs: number;
};

export type ConfigPagination = {
  /** Page size requested from the recursive /files listing. */
  filesPageLimit: number;
  /** Safety cap on /files pages per listing. */
  filesMaxPages: number;
  /** Page size for PR activities (server clamps at page.max.pullrequest.activities=500). */
  activitiesPageLimit: number;
  /** Max activities pages followed before reporting honest truncation. */
  activitiesMaxPages: number;
  /** Lines per browse page (server clamps at page.max.source.lines=5000). */
  browsePageLines: number;
  /** Safety cap on blame/browse pages per request. */
  browseMaxPages: number;
  /** Page size for commit listings (server clamps at page.max.commits=100). */
  commitsPageLimit: number;
  /** Bounded page walk when filtering commits client-side. */
  commitsFilterMaxPages: number;
  /** Limit for PR changes (server hard cap page.max.changes=1000, non-pageable). */
  changesLimit: number;
  /** Page size for Cloud comment listing. */
  cloudCommentsPageLen: number;
  /** Page size when looking up a single branch. */
  branchLookupLimit: number;
  /** Default page size for list tools. */
  defaultListLimit: number;
  /** Page size used when probing whether a repo has any files. */
  probePageLimit: number;
  /** TTL for cached repo file listings (ms); 0 disables the cache. */
  filesListTtlMs: number;
  /** Page size for directory listings (server clamps at page.max.directory.children=1000). */
  dirPageLimit: number;
};

export type ConfigOutput = {
  /** Default number of comments embedded in get_pull_request. */
  commentDefaultLimit: number;
  /** Comment/task body truncation in embedded views (chars); marked when applied. */
  commentTextMax: number;
  /** Error `details` payload cap (chars). */
  errorDetailsMax: number;
  /** Text attachment download cap (KB); marked when applied. */
  attachmentTextMaxKb: number;
  /**
   * Cap on whole-file content returned by full_content / tail / Cloud raw
   * reads (KB); truncation is marked with window guidance, never silent.
   */
  fileContentMaxKb: number;
  /** Max excluded-file paths echoed when diff filters exclude files. */
  excludedListMax: number;
  /** Max occurrences listed on ambiguous code_snippet matches. */
  snippetMatchListMax: number;
};

export type BitbucketMcpConfig = {
  auth: ConfigAuth;
  http: ConfigHttp;
  rateLimit: ConfigRateLimit;
  retry: ConfigRetry;
  snapshot: ConfigSnapshot;
  grep: ConfigGrep;
  scan: ConfigScanFallback;
  pagination: ConfigPagination;
  output: ConfigOutput;
  /** Validated tool-group filter (BITBUCKET_TOOL_GROUPS); null = all groups. */
  toolGroups: string[] | null;
};
