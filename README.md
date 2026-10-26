# Bitbucket MCP Server

[![npm version](https://badge.fury.io/js/@nexus2520%2Fbitbucket-mcp-server.svg)](https://www.npmjs.com/package/@nexus2520/bitbucket-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MCP server for Bitbucket — built for AI coding agents that need to work with remote repositories **as if they were local clones**: grep-fast code search, windowed file reads, compact token-efficient responses, and a transport layer that never trips Bitbucket's rate limits.

Supports **Bitbucket Server / Data Center** (primary target) and Bitbucket Cloud.

## Why v3

| | v2 | v3 |
|---|---|---|
| Content search in a repo | 1 listing + up to 3,000 file GETs | **1 archive call cold, 0–1 calls warm** |
| Search completeness | silently partial under server throttling | complete, with every cap reported |
| PR diff tokens | per-line JSON (~4× larger) | raw unified diff |
| Read a 100-line window | 2 calls, full file transferred | **1 call, window only** |
| Blame a window of a huge file | up to 100 calls | **1 call** |
| Rate-limit safety | none (burst → 429/403) | client-side pacing sized to DC's limiter |
| Tools | 33 | **25** (~30% less definition context) |

Measured on a live Data Center instance: a repeated content search went from **519 API calls / ~7s** (finding 1 of 8 real matches under burst throttling) to **0 API calls / 24ms** finding all 8. Full design and verified API research: [`REVAMP_PLAN.md`](REVAMP_PLAN.md).

## Tools (25)

### Search (`search`) — Server/DC only
- **`grep`** — search file contents with **full regex, any branch**, like ripgrep on a local clone. One `archive` download per repo+commit, streamed in constant memory, cached in-process, freshness-checked every call (responses carry `as_of <commit>`). Omit `query` for filename-only glob listing. Modes: `content`, `files`, `count`; `glob`, `path`, `context`, `case_insensitive`, `max_results`.
- **`search_code`** — index-backed exact-term search across a whole **project** in one call (default branch only, case-insensitive, no regex, files <512 KiB, ~1000-result window). Best for cross-repo identifier lookups; use `grep` for everything else.
- **`search_repositories`** — find repos by name/description.

### Pull requests (`pr_core`)
- **`get_pull_request`** — metadata + reviewer status + merge info in **1 call**; `include_comments` / `include_file_changes` (default true), `include_tasks`, `comment_limit`. Returns `version` for follow-up mutations.
- **`list_pull_requests`** — repo-scoped; omit `repository` (Server) for **your PRs across all repos** in one call (`role` filter).
- **`create_pull_request`**, **`update_pull_request`**, **`merge_pull_request`**, **`decline_pull_request`** — all mutations accept `version` from a prior read (saves a fetch; auto-refetch + retry once on 409 conflicts).

### Comments & tasks (`pr_comments`)
- **`add_comment`** — general, threaded reply, inline (`file_path` + `line_number`, or `code_snippet` auto-resolution), code `suggestion`, or **task** (`severity: "BLOCKER"`, Server). Attachments upload via the `attachments` param (Server).
- **`manage_comment`** — `edit` / `delete` / `resolve` / `reopen` / `to_task` / `to_comment` on any comment or task, one call with `version`.

### Review (`pr_review`)
- **`get_pull_request_diff`** — raw unified diff text; scope with `file_path` (server-side), `include_patterns`/`exclude_patterns`, `context_lines`, `ignore_whitespace`.
- **`set_review_status`** — `APPROVED` / `NEEDS_WORK` / `UNAPPROVED` (mutually exclusive; one call).

### Commits (`commits`)
- **`list_pr_commits`**, **`list_branch_commits`** (server-side `since`-rev/`merges` filters; bounded page-walk for client-side `author`/`until`/`search`), **`get_commit_detail`** (unified diff, or `detail: "files"` for the changed-file list without bodies).

### Branches (`branches`)
- **`list_branches`**, **`get_branch`** (branch + its PRs), **`delete_branch`** (`expected_head` skips the lookup call).

### Files (`files`)
- **`get_file_content`** — **windowed server-side**: `start_line`/`line_count` transfer only that window (≤5000 lines/call). `full_content` / negative `start_line` for whole-file or tail reads.
- **`get_file_blame`** — commit-span blame for a line window in **1 call** (Server).
- **`list_directory_content`** — paginated, compact.

### Attachments (`attachments`, Server) / Discovery (`discovery`)
- **`manage_attachments`** (`download` capped, `delete`), **`list_projects`**, **`list_repositories`**.

## Output conventions

- Bulk content (diffs, files, grep results) is **plain text**, not JSON-escaped strings; lists are compact JSON without pretty-printing. Dates are ISO-8601.
- Content-derived responses carry `as_of <commit>` so the agent knows exactly which state it saw.
- **Truncation is never silent** — every cap produces an explicit warning with continuation guidance (`next_start`, "narrow the glob", etc.).
- Mutable entities include `version`, so mutations don't need a re-read.

## Installation

Requires **Node.js 22 or newer** (18 and 20 are end-of-life and no longer receive security fixes).

### Using npx (recommended)

```json
{
  "mcpServers": {
    "bitbucket": {
      "command": "npx",
      "args": ["-y", "@nexus2520/bitbucket-mcp-server"],
      "env": {
        "BITBUCKET_USERNAME": "your.username",
        "BITBUCKET_TOKEN": "your-http-access-token",
        "BITBUCKET_BASE_URL": "https://bitbucket.yourcompany.com"
      }
    }
  }
}
```

For Bitbucket Cloud use `BITBUCKET_APP_PASSWORD` instead of `BITBUCKET_TOKEN` (and omit `BITBUCKET_BASE_URL`).

Credential walkthroughs: [Cloud app password](SETUP_GUIDE.md) · [Server/DC HTTP token](SETUP_GUIDE_SERVER.md).

### From source

```bash
git clone https://github.com/pdogra1299/bitbucket-mcp-server.git
cd bitbucket-mcp-server
npm install && npm run build
# point your MCP config at: node <repo>/build/index.js
```

## Configuration

Every numeric policy is environment-tunable — nothing is hard-coded. The full table lives in [`src/config/index.ts`](src/config/index.ts) (`CONFIG_REFERENCE`). The ones that matter most:

| Variable | Default | Purpose |
|---|---|---|
| `BITBUCKET_RATE_LIMIT_RPS` | `5` | Client-side sustained request rate (DC's per-user refill is 5/s). `0` disables pacing — set this if your account has an admin rate-limit exemption |
| `BITBUCKET_RATE_LIMIT_BURST` | `50` | Burst capacity (DC's server bucket is 60) |
| `BITBUCKET_GLOBAL_MAX_CONCURRENCY` | `8` | Max in-flight requests across all tools |
| `BITBUCKET_SNAPSHOT_MAX_MB` | `256` | In-memory grep cache budget. `0` = pure streaming (no retention, still 2 calls per search) |
| `BITBUCKET_SNAPSHOT_MAX_FILE_KB` | `2048` | Files larger than this are scanned but not cached |
| `BITBUCKET_REF_RESOLVE_TTL_MS` | `15000` | Branch→SHA freshness memo; `0` = validate on every single call |
| `BITBUCKET_STREAM_ABORT_MB` | `2048` | Abort archive scans past this many extracted MB (falls back to bounded per-file scan) |
| `BITBUCKET_HTTP_TIMEOUT_MS` | `30000` | Per-request timeout |
| `BITBUCKET_TOOL_GROUPS` | all | Comma-separated groups to expose (validated, enforced at dispatch, fails closed) |
| `BITBUCKET_READ_ONLY` | `false` | Hide **and refuse** every state-changing tool (create/update/merge/decline PR, comments, review status, delete branch, attachment delete) |
| `BITBUCKET_DISABLED_TOOLS` | — | Comma-separated tool names to hide and refuse regardless of group |
| `BITBUCKET_PROTECTED_BRANCHES` | — | Branch names/globs (`main,release/*`; use `release/**` for nested) that `delete_branch` and `merge_pull_request` refuse to touch |
| `BITBUCKET_ATTACHMENT_ROOT` | unset = uploads disabled | The **only** directory attachment uploads may read from (realpath-confined, regular files only) |
| `BITBUCKET_ATTACHMENT_MAX_UPLOAD_MB` / `_DOWNLOAD_MB` | `25` | Size caps for attachment upload / download |
| `BITBUCKET_GREP_TIMEOUT_MS` | `20000` | Wall-clock budget per content scan; exceeding it returns marked PARTIAL results |
| `BITBUCKET_GREP_MAX_SCAN_LINE_CHARS` | `16384` | Lines longer than this are counted and reported, not regex-scanned (bounds per-line regex cost on minified files) |

### The grep engine's guarantees

- **Memory-bounded**: the archive is streamed, never buffered whole; the cache is a hard byte budget with LRU eviction and content-hash dedup across branches. Worst case = budget + a few MB transient.
- **Fresh**: every query re-resolves the branch head; a moved branch can never serve stale results. Merges/deletes made through this server invalidate immediately.
- **Complete**: cache limits never reduce scan coverage — oversized files are still scanned; only true binaries are skipped, and they're counted in the output.

### Rate limiting

All requests flow through a token bucket sized to Bitbucket DC's per-user limiter, so 429s are avoided rather than retried-after. If your instance throttles hard anyway, the error message says exactly what to do — the durable fix is asking a Bitbucket admin for a **rate-limit exemption** for the service account (Admin → Rate limiting → Exemptions), then setting `BITBUCKET_RATE_LIMIT_RPS=0`.

## Security

This server executes tool calls whose arguments come from an LLM, often with a write-capable token. The following controls are built in:

- **Least privilege by configuration.** `BITBUCKET_READ_ONLY=true` removes every mutating tool from both `tools/list` and dispatch — recommended for autonomous agents that only need to read PRs, diffs and code. `BITBUCKET_DISABLED_TOOLS` drops individual tools; `BITBUCKET_PROTECTED_BRANCHES` blocks `delete_branch` / `merge_pull_request` against named branches or globs. Every tool carries MCP `readOnlyHint`/`destructiveHint` annotations so clients can gate confirmations.
- **No request steering.** `workspace`, `repository`, commit ids, attachment ids and file paths are charset-validated and percent-encoded per URL segment, so a value like `PROJ/../../admin` or `repo?limit=1000` can never change the REST route a fixed-verb tool hits.
- **Attachment uploads are opt-in and sandboxed.** Without `BITBUCKET_ATTACHMENT_ROOT` the `attachments` parameter is refused. With it, the real (symlink-resolved) path must stay inside the root, be a regular file, and fit the size cap; every rejection uses one generic message so the tool is not a filesystem existence oracle. Downloads are size-capped too.
- **Regex denial-of-service guard.** Caller regexes (`grep` `query`, `search_code` `regex_filter`) are length-capped, rejected statically when an unbounded quantifier wraps a group with undelimited variable-width repetition (`(a+)+`, `(\w+\s*)*`), probed against adversarial inputs under a vm timeout, and every scan runs against a wall-clock deadline (`BITBUCKET_GREP_TIMEOUT_MS`) with partial results marked, never silent. Lines longer than `BITBUCKET_GREP_MAX_SCAN_LINE_CHARS` are skipped and counted. V8's linear-time regexp fallback is enabled at startup as an extra layer.
- **Credential hygiene.** Transport errors are normalized to status + message + response headers before they reach handlers; error objects are never logged whole, and log lines are scrubbed for `Authorization`-style values. Cloud pagination follows `next` URLs only on the configured origin.
- **Dependency floor.** Node ≥ 22; `npm run audit:prod` must report zero high/critical advisories for the published tree (enforced in CI).

Recommended deployment for an autonomous agent:

```json
"env": {
  "BITBUCKET_READ_ONLY": "true",
  "BITBUCKET_PROTECTED_BRANCHES": "main,release/*"
}
```

Writes (comments, approvals, merges) should then run through a separate, human-confirmed server instance or the hosting application's own approval flow.

## Migrating from v2

Removed tools and their v3 equivalents (same capabilities, fewer tools):

| v2 | v3 |
|---|---|
| `find_in_files` | `grep` with `query` |
| `search_files` | `grep` without `query` (use `glob`) |
| `list_pr_tasks` | `get_pull_request` + `include_tasks: true` |
| `create_pr_task` | `add_comment` + `severity: "BLOCKER"` |
| `update_pr_task` | `manage_comment` `action: "edit"` |
| `delete_pr_task`, `delete_comment` | `manage_comment` `action: "delete"` |
| `set_pr_task_status` | `manage_comment` `action: "resolve"` / `"reopen"` |
| `convert_pr_item` | `manage_comment` `action: "to_task"` / `"to_comment"` |
| `set_pr_approval` | `set_review_status` `status: "APPROVED"` / `"UNAPPROVED"` |

Update Claude Code permission allowlists (`mcp__bitbucket__*`) accordingly. Diff tools now return unified diff text instead of per-line JSON — line numbers come from `@@` headers. Full details in [`CHANGELOG.md`](CHANGELOG.md).

## Development

```bash
npm run build   # tsc → build/
npm test        # build + node --test (unit + snapshot-engine tests)
```

Architecture: `src/config` (all policy) · `src/core` (transport, snapshot engine, caches) · `src/handlers` (tool logic) · `src/tools` (definitions, guards, registry) · `src/formatting` (compact output) · `src/types` (single barrel).

## License

MIT
