# Bitbucket MCP Server v3 — Revamp Plan

**Goal:** make browsing/searching a remote Bitbucket Data Center repo feel like working on a local clone — grep-fast, token-compact, minimal API calls — while keeping every current capability. Hard constraint: API-only (no git clone, no on-disk mirrors).

**Method:** every claim below was verified against Atlassian's official OpenAPI specs (8.15–10.3), versioned docs, KBs, and Jira tickets by a 41-agent research workflow (2026-07-09). 29/30 spot-checked claims CONFIRMED; the one UNCLEAR item (code-search response schema) is listed under Empirical Validation.

---

## 1. The facts that shape the design

### Rate limiting (why 429s happen)
- DC rate limiting is a **per-user token bucket: 60 burst, 5 tokens/sec refill, 1 token per authenticated HTTP request** regardless of size, per cluster node. ([docs](https://confluence.atlassian.com/bitbucketserver090/improving-instance-stability-with-rate-limiting-1431769764.html))
- **No Retry-After / X-RateLimit headers are documented for Bitbucket DC** (they're Jira DC only). Blind exponential backoff is the field-proven pattern (Jenkins bitbucket-branch-source does exactly this).
- Separate from the token bucket: `throttle.resource.scm-command` caps **instance-wide** concurrent git-backed requests (browse/diff/blame/commits) at 50 with a 2s wait — high client parallelism hurts even below 5 rps.
- Admins can exempt a service account (Admin → Rate limiting → Exemptions; also via REST `/admin/rate-limit/settings/users`). The README must document this — it's the cheapest fix of all.
- **Design consequence: one 5 MB archive call costs 1 token; 3000 raw-file GETs cost 3000 tokens. Fewer, bigger requests always win.**

### Endpoints we're not using (verified to exist)
| Endpoint | What it gives us | Availability |
|---|---|---|
| `GET .../archive?at=&path=&format=tar.gz` | Whole repo/subtree contents in **1 call**; `path=` repeatable | 8.15–10.3, identical params |
| `GET .../browse/{path}?start&limit` | **Line-windowed file reads server-side** (paged over lines; ≤5000 lines/page) | all versions |
| `GET .../browse/{path}?blame&noContent&start&limit` | **Blame for exactly a line window in 1 call** | all versions (pagination fields fixed in 7.0, BSERV-8482) |
| `GET .../pull-requests/{id}/blocker-comments?states=OPEN&count=` | PR tasks directly, server-filtered | since 7.2 (`/tasks` REMOVED in DC 9.0) |
| PR resource `properties.mergeCommit`, `closedDate`, `commentCount`, `openTaskCount`, `resolvedTaskCount` | Merge info + counts **free with the PR GET** | webhook-payload-documented; absent when PR "merged remotely" |
| `GET /dashboard/pull-requests?role=&state=` | Cross-repo "my PRs" in 1 call | since 6.10 |
| `GET .../last-modified/{path}?at={sha}` | Per-file latest commit for a whole directory in 1 call (pass a resolved SHA, not a branch name) | all versions |
| `GET .../pull-requests/{id}/diff-stats-summary` | files/+lines/−lines totals only | **9.1+ only** — feature-detect |
| `GET .../compare/{commits,changes,diff}` | branch-vs-branch server-side | all versions |
| `Accept: text/plain` on diff endpoints; `contextLines=0` honored; `whitespace=ignore-all`; `withComments=false` | Raw unified diff, minimal | all versions |
| `GET /rest/indexing/latest/status` | search-index backlog in 1 call (cheap index-gap probe) | all versions |
| `GET .../files/{path}?limit=100000` | full recursive file list in **1 call** (server cap `page.max.directory.recursive.children` default 100 000) | all versions |

### Server caps we currently violate (silent data loss today)
- `page.max.pullrequest.activities=500` → our `activities?limit=1000` silently returns ≤500: **comments/tasks can be missed today**.
- `page.max.commits=100` → `limit` above 100 silently clamps.
- `page.max.changes=1000` is a **hard, non-pageable cap**; PR `/changes` is single-page by design (`start` ignored).
- `page.max.source.lines=5000` per browse page; lines >5000 chars are silently truncated (fall back to `raw/` for minified files).
- Code search: **max 1000 results** (`max_result_window`), 250-char query, 9 expressions, case-insensitive index (→ our `case_variants` second call is provably redundant), default branch only, files <512 KiB only, no regex ever (BSERV-11632 open since 2019).
- `raw/{path}`: **no HTTP Range** (BSERV-6888 closed won't-fix), **no ETag/conditional GET documented for DC** → caching must be client-side, keyed on immutable commit SHAs.

### MCP output budget
- Claude Code warns at 10k tokens per tool result, hard-caps at 25k. Design every response for <10k.
- Measured ecosystem numbers: pretty-printed JSON costs ~15–40% extra; consolidating 20→8 tools cut definition context 60%; GitHub MCP: `minimal_output` default true, `detail: none|stats|full_patch`. Anthropic guidance: concise-by-default + `detail` flag, errors as steering text, filter server-side, names over IDs.

---

## 2. Architecture: three pillars

### Pillar A — RepoSnapshot engine (grep like a local clone)
An in-memory "virtual checkout" service behind all read/search tools:

1. **Resolve** branch → head SHA (1 call, memoized 60s per repo+ref).
2. **Fetch** `archive?format=tar.gz&at={sha}[&path={prefix}]` (1 call, streamed).
3. **Extract in memory** entry-by-entry (`tar-stream` over a gunzip stream): skip binaries (NUL sniff in first 8 KB), skip files > per-file cap (default 1 MB), abort if running total exceeds snapshot cap (default 200 MB, env `BITBUCKET_SNAPSHOT_MAX_MB`, `0` disables the engine).
4. **Cache** `{path → Buffer}` in a byte-budget LRU keyed `project/repo@sha#pathPrefix`. SHA-keyed ⇒ immutable ⇒ no staleness, no TTL needed; only the ref→SHA resolution needs the 60s TTL.
5. **Serve** from the warm snapshot with **zero API calls**: grep (full JS regex, any branch), glob/file listing, windowed file reads, directory listing.

Fallback chain when archive is oversized/disabled/errors: (a) re-scope archive to the glob's directory prefix; (b) bounded legacy fan-out (existing `scanFilesConcurrent`, parallelism default lowered to 4, ≤500 files); (c) steering error telling the agent to narrow the glob. Archive fetches are **serialized** (max 2 concurrent streams) because the endpoint's throttle-bucket classification is undocumented — this also bounds peak transient memory.

Cost: cold grep = 2 calls; repeat grep/read/glob in the same repo = 0 calls. Today: 1–40 + up to 3000×(1–3 retries).

#### Freshness contract (decided 2026-07-09: validate on every hit)

- Every content-reading tool call resolves ref → head SHA once at call start (1 cheap `commits?limit=1` call, coalesced within the invocation). Snapshot SHA matches → serve warm; differs → refetch archive and re-cache (blob dedup makes the delta cheap). Explicit full-SHA refs skip validation (immutable).
- Responses carry `as_of: <sha12>` so the agent always knows which commit it saw.
- Net warm cost: 1 call (validation) instead of 0 — correctness over the last token of savings.

#### Completeness contract (decided 2026-07-09: caps never lose data silently)

- Retention caps bound only the **cache**, never the **scan**: text files of any size are regex-scanned in chunked streaming during extraction; files too big to retain are recorded and re-fetched individually on warm queries when the glob matches them.
- Only true binaries are skipped from scanning — and reported ("skipped N binary files").
- Every cap that can trim output (server page clamps, diff `truncated` flags, match limits) surfaces an explicit warning plus continuation guidance. No silent truncation anywhere.

#### Memory architecture (streaming-first; the cache is a bonus, never a requirement)

The engine must survive hundreds of repos × arbitrary branches × parallel queries without growing the process. Four layers, in order:

1. **Stream-scan, don't buffer.** tar is a sequential format and gzip decodes through a 32 KB window — the archive is **never held in memory as a whole**. For a grep, each file entry is regex-scanned as it flows through the stream and its buffer is discarded immediately; only match lines are kept. Peak transient memory per scan ≈ per-file cap (1 MB) + gzip window + IO buffers ≈ **a few MB, independent of repo size**. A 2 GB monorepo greps in the same footprint as a 5 MB repo. Answering the query never requires retaining anything.
2. **Retention is admission-controlled, not automatic.** After (or during) a scan, the extracted text files are retained into the snapshot cache **only if they fit**: global byte budget `BITBUCKET_SNAPSHOT_MAX_MB` (default 256 MB, `0` = pure-streaming mode with zero retention), per-snapshot admission cap (default 40% of budget — one giant repo can't evict everything else), per-file cap 1 MB, binaries skipped. Eviction is LRU by bytes. Buffers live off the V8 heap (Node `Buffer` externals), but they count toward container RSS — the budget is the RSS knob. Worst-case process overhead = budget + (2 concurrent streams × few MB) — **bounded by configuration, never by workload**. A memory watermark (RSS check) additionally pauses admissions under pressure.
3. **Content-addressed blob dedup across branches/snapshots.** Snapshots are stored as `path → contentHash` maps over a refcounted blob store keyed by content hash. Two branches of the same repo share ~95%+ of file contents, so the feature-branch snapshot costs only its delta — this directly defuses the "every branch = another full copy" blowup, and repeat queries across branches stay warm within one budget.
4. **Big-repo policy.** If the stream exceeds the admission cap, the scan still completes (layer 1) — the repo is simply marked "stream-only" for this session (with its observed size memoized) so future greps stream again (2 calls) instead of thrashing the cache. Optional middle tier for medium repos: retain the **compressed** tar.gz bytes (~20–30% of extracted size) and re-stream from memory on warm queries — 0 API calls, ~100–500 MB/s in-memory re-scan, ~4× cheaper residency; decide in Phase 3 benchmarks whether the complexity pays.

**Why this is not "cloning into RAM":** a clone carries full history (all git objects, all revisions) on disk; a snapshot is the text files of **one commit**, minus binaries and >1 MB files — typically 5–20× smaller than a `.git` clone — under a hard evictable budget, and skippable entirely (streaming mode) with no loss of capability, only loss of the 0-call warm path.

**Multi-pod / shared deployments:** today this server is stdio — one process per user session, so the cache holds one user's working set (a handful of repos; 256 MB is ample) and dies with the session. If it's ever deployed as a shared HTTP fleet: do **not** replicate the cache — shard by repo (consistent-hash `project/repo` at the load balancer, the Sourcegraph searcher pattern) so a repo's queries land on the pod that has it warm. And a cache miss is cheap by construction — it costs exactly 2 API calls and a streamed scan, so even a cache-less pod is strictly better than today's fan-out. No Redis/external tier: it would violate the API-only/no-mirror constraint in spirit and isn't needed when misses cost 2 calls.

### Pillar B — cheapest-verified-endpoint rebinding (per-tool table in §3)
Every tool gets rebound to the verified single-call endpoint; decorative and read-before-write calls removed; caller-supplied `version` accepted everywhere with GET-fallback and one retry-on-409.

### Pillar C — compact output contract
- **No `JSON.stringify(…, null, 2)` anywhere** (41 call sites today). Lists → terse line-oriented text or compact JSON; envelopes lose arg echoes, derivable fields, filler messages, locale dates (ISO-8601 only), per-item URLs (one `url_template`), explicit nulls.
- **Diffs are unified diff text** (via `Accept: text/plain`), never per-line JSON objects (today's format is ~5–10× larger; a 500-line PR diff ≈ 25k tokens → ~5k). Line anchoring for `add_comment` still works from `@@` headers — documented in the tool description.
- **grep output is ripgrep-style**: `path` header + `line: text` rows, modes `content|files|count`, optional `-C` context, match lines capped at 300 chars, hard cap with "+N more — narrow the glob" steering.
- **File content is a plain text block** with a one-line header (`src/foo.ts @ main lines 1–500 of 1200`), never a JSON-escaped string.
- `detail`/include flags: concise by default; comment/task bodies truncated with lengths; blame emitted as a `commits` map + spans (`lines 1–15: abc1234`), never per-line objects.
- Errors: `isError:true` with actionable steering ("Rate limited; retrying got 429 again. Narrow the glob or ask your admin for a rate-limit exemption (Admin → Rate limiting)"), details capped at 500 chars, `x-arequestid` kept.

---

## 3. Tool-by-tool plan (calls before → after, Server)

| Tool | Today | After | How |
|---|---|---|---|
| grep (new; replaces `find_in_files` + `search_files`) | 1–40 + ≤3000×3 | **2 cold / 0 warm** | snapshot engine; `query` optional → files-only glob mode |
| `search_code` | 1–2 (+ up to 40-call probe) | **1** (+1 probe max) | drop case-variant (index case-insensitive); probe = 1-page `/files` or `/rest/indexing/latest/status`; stop paging at 1000 |
| `get_file_content` | 2 + full transfer | **1 / 0 warm** | windowed `browse?start&limit`; `raw` only for >5000-char lines or explicit full fetch |
| `get_file_blame` | up to 100 | **1** per ≤5000-line window | `browse?blame&noContent&start&limit`; dedup commits map output |
| `list_directory_content` | 1 | 1 / 0 warm | + optional `last-modified` enrichment (1 call, opt-in) |
| `get_pull_request` | 3–5 | **1** (metadata) / 2–3 (includes) | `properties.mergeCommit`+`closedDate`+counts free; `include=comments/files/tasks/merged_by` flags; comments = 1 activities page (≤500, paginate honestly); tasks = `blocker-comments`; merged_by = activities `limit=25` |
| `list_pull_requests` | 1 | 1 | + cross-repo mode via `/dashboard/pull-requests` when `repository` omitted |
| `update_pull_request` | 2 | **1** with `version` (+reviewers) supplied | 409 → refetch+retry once |
| `merge_pull_request` | 2 | **1** with `version` | same |
| `decline_pull_request` | 2–3 | **1** with `version`; Cloud always 1 | Cloud GET removed |
| `add_comment` | 1–2 | 1–2 | gains `severity=BLOCKER` (absorbs `create_pr_task`); snippet resolution fetches **single-file** diff |
| `manage_comment` (new) | 2 each ×5 tools | **1** with `version` | absorbs delete_comment, update/delete_pr_task, set_pr_task_status, convert_pr_item |
| `set_review_status` | 1–2 ×2 tools | **1** | absorbs `set_pr_approval`; participants PUT needs no version (verified) |
| `get_pull_request_diff` | 1 (huge) | 1 (~5–10× smaller) | `Accept: text/plain`, `contextLines` pass-through, optional `whitespace=ignore-all`, per-file path server-side; surface `truncated` flags |
| `get_commit_detail` | 1 (huge) | 1 | same; `detail: stats|files|full_patch` (stats via `/changes` or 9.1+ `diff-stats-summary`, feature-detected) |
| `list_pr_commits` | 2–3 | **1–2** | drop PR-title fetch; `withCounts` opt-in |
| `list_branch_commits` | 2–3 | **1–2** | head = first commit of page 0; bounded multi-page client filters with honest warning; `merges=exclude` server-side |
| `get_branch` | 2–4 | 2–3 | `boostMatches`, limit 25; Cloud `is_default` cached |
| `delete_branch` | 2 | **1** with `expected_head` | |
| discovery/list tools | 1 | 1 | output slimming only |
| `manage_attachments` | 1 | 1 | text downloads capped at 100 KB |

Tool count: **33 → 25** (definitions ~8.4k → ~5.5–6k tokens; also trim the 872-char attachments blob inlined 3×, and the fattest descriptions). **No legacy aliases** (decided 2026-07-09: clean break, save the tokens — the CHANGELOG carries the v2→v3 mapping table); `pr_tasks` group folds into `pr_comments`; `BITBUCKET_TOOL_GROUPS` gets validation **and CallTool-side enforcement** (previously ListTools-only cosmetics), failing closed when all requested groups are invalid.

## 4. Cross-cutting transport layer (new `api-client` core)

1. **Client-side token bucket**: default 5 req/s sustained, burst 50 (just under the server's 60), env-tunable (`BITBUCKET_RATE_LIMIT_RPS/BURST`), adaptive tighten on observed 429s. Makes 429s mathematically avoidable on default instances.
2. **Global concurrency semaphore** (default 6–8) across all tools — not per-tool.
3. **Retry in `makeRequest`**: 429/503/408/network; honor Retry-After opportunistically (delta-seconds + HTTP-date, clamped at 60s); else full-jitter exponential from 1s, max 4 retries, **total wait cap ~30s** (interactive tool — fail fast with steering, don't grind for minutes); auto-retry idempotent GETs only; circuit breaker after consecutive failures with the admin-exemption hint.
4. **Keep-alive agents** (`maxSockets` = semaphore size), 30s default timeout (archive stream: 120s+).
5. **Caching**: in-flight GET coalescing (concurrent identical GETs share one promise — includes the file-list cache racing the probe); immutable SHA-keyed LRU (commit objects, file content@SHA, diffs@SHA); 60s TTL for ref→SHA, file listings, repo metadata.
6. **Capability map** per baseUrl, probed once (`/rest/api/latest/application-properties` → version): gates `diff-stats-summary` (9.1+), `blocker-comments` (7.2+), archive (probe on first use), search (may be disabled/absent in 10.x-without-search-server).

## 5. Explicit decisions (settled now, not relitigated)
- **DC-first**: Cloud paths keep working (tools stay dual-path where they are today) but the snapshot engine, blocker-comments, browse-windowing are `server_only`. Full Cloud parity (its `fields=` param, documented search API) is a separate future track.
- **Webhooks/SSE: out** — stdio server has no endpoint. Freshness = 60s ref-resolution TTL + "as of" hints.
- **Third-party plugin APIs: out** — can't assume installed.
- **MCP `structuredContent`: no** (spec requires duplicate text serialization). `resource_link`: revisit later. Add `readOnlyHint`/`destructiveHint` annotations.
- **Pretty JSON: dead.** Text-first output.

## 6. Implementation phases
- **Phase 0 — measure**: per-tool upstream-call counter + response-size logging behind a debug env; capture baseline on fixtures. (The plan's numbers become falsifiable.)
- **Phase 1 — transport**: limiter, retry, coalescing, keep-alive, timeout, SHA cache, capability map. No tool-surface change; immediate 429 relief.
- **Phase 2 — rebinding quick wins**: blame window; file-content window; `get_pull_request` flags + `properties.mergeCommit` + `blocker-comments`; kill decorative fetches (PR-title, branch-head, Cloud decline GET); `version` params on all mutations (+ surface `version` in list outputs); probe cheapening; fix the 500-cap activities truncation honestly.
- **Phase 3 — snapshot engine + grep**: archive streaming, LRU, fallbacks; fold `search_files`; wire warm-snapshot serving into file tools.
- **Phase 4 — output compaction**: text diffs, grep format, compact JSON, field trims, `detail` flags, error caps.
- **Phase 5 — consolidation + migration**: 25-tool surface, definitions rewrite, alias routing, groups fix, README (admin exemption recipe), CHANGELOG mapping table, major version bump.
- **Phase 6 — verify**: fixture evals (same questions answerable from slimmer responses), live-instance probe script, before/after metrics table.

## 7. Empirical validation checklist (undocumented bits — probe against a live instance before hardcoding)
1. Code-search response schema (`hitContexts` `{line,text}` with `<em>` markers) — the one UNCLEAR claim; parser must stay defensive.
2. Archive endpoint's throttle bucket (serialize until observed).
3. Blame `&noContent` wrapper shape (page object vs bare array) on 8.x/9.x.
4. `diff-stats-summary` JSON field names (schema empty in the spec).
5. Whether the instance sends Retry-After on 429 (log headers on first occurrence).

Ship these as `scripts/probe-instance.ts` (a "doctor" command).

## 8. Risks & mitigations
- **Huge repos vs archive** → path-scoped archive, byte caps, abort+fallback fan-out, steering errors.
- **Archive disabled/forbidden** → capability probe, fan-out fallback.
- **Search endpoint is internal/undocumented** → defensive parsing, grep as the always-works fallback.
- **Memory pressure** → byte-budget LRU, env kill switch, per-file caps, binary skip.
- **Instance-wide scm-command contention** → serialized archive, low default parallelism in fallback mode.
- **Breaking existing users** → alias routing, group folding documented, major-version signaling.
