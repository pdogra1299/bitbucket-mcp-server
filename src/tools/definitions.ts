import type { ToolDefinition } from '../types/index.js';

// v3 tool surface: 25 tools (was 33). Descriptions are deliberately terse —
// every definition is context the LLM pays for on each turn.

const W = { type: 'string', description: 'Project key (e.g., PROJ)' };
const R = { type: 'string', description: 'Repository slug' };
const PRID = { type: 'number', description: 'Pull request ID' };
const LIMIT = { type: 'number', description: 'Max results (default 25)' };
const START = { type: 'number', description: 'Pagination start (default 0)' };
const BRANCH = { type: 'string', description: 'Branch (default: default branch)' };
const VERSION = {
  type: 'number',
  description:
    'Entity version from a prior read; supplying it saves a fetch AND makes the write conditional — ' +
    'it fails on concurrent modification instead of overwriting. Omit to write against the latest state (auto-retried once).',
};
const ATTACHMENTS = {
  type: 'array',
  description:
    'Local files to upload & embed (Server/DC only). Item: path string or {file_path, alt_text?, render?: image|link|auto}',
  items: {
    oneOf: [
      { type: 'string' },
      {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
          alt_text: { type: 'string' },
          render: { type: 'string', enum: ['image', 'link', 'auto'] },
        },
        required: ['file_path'],
      },
    ],
  },
};

export const toolDefinitions: ToolDefinition[] = [
  // ── PR core ────────────────────────────────────────────────────────────────
  {
    name: 'get_pull_request',
    description:
      'Get a pull request: metadata, reviewer status, merge info, comments and changed files. ' +
      'Set include_comments/include_file_changes false for a 1-call metadata read; include_tasks lists open/resolved tasks. ' +
      'Response carries `version` for follow-up mutations.',
    group: 'pr_core',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        pull_request_id: PRID,
        include_comments: { type: 'boolean', description: 'Embed active comments (default true)' },
        include_file_changes: { type: 'boolean', description: 'Embed changed-file list (default true)' },
        include_tasks: { type: 'boolean', description: 'Embed PR tasks (Server only, default false)' },
        comment_limit: { type: 'number', description: 'Max comments embedded (default 20)' },
      },
      required: ['workspace', 'repository', 'pull_request_id'],
    },
  },
  {
    name: 'list_pull_requests',
    description:
      'List pull requests in a repository. Omit `repository` (Server only) to list YOUR PRs across all repos in one call (filter with role).',
    group: 'pr_core',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: { type: 'string', description: 'Repository slug; omit for cross-repo dashboard (Server)' },
        state: { type: 'string', enum: ['OPEN', 'MERGED', 'DECLINED', 'ALL'], description: 'Default OPEN' },
        author: { type: 'string', description: 'Filter by author username' },
        role: { type: 'string', enum: ['AUTHOR', 'REVIEWER', 'PARTICIPANT'], description: 'Cross-repo mode only' },
        limit: LIMIT,
        start: START,
      },
      required: ['workspace'],
    },
  },
  {
    name: 'create_pull_request',
    description: 'Create a pull request.',
    group: 'pr_core',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        title: { type: 'string' },
        source_branch: { type: 'string' },
        destination_branch: { type: 'string' },
        description: { type: 'string' },
        reviewers: { type: 'array', items: { type: 'string' }, description: 'Reviewer usernames' },
        close_source_branch: { type: 'boolean' },
        attachments: ATTACHMENTS,
      },
      required: ['workspace', 'repository', 'title', 'source_branch', 'destination_branch'],
    },
  },
  {
    name: 'update_pull_request',
    description:
      'Update a pull request. Reviewers/approvals are preserved unless `reviewers` is passed. Pass `version` (from get/list) to save a fetch.',
    group: 'pr_core',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        pull_request_id: PRID,
        version: VERSION,
        title: { type: 'string' },
        description: { type: 'string' },
        destination_branch: { type: 'string' },
        reviewers: { type: 'array', items: { type: 'string' }, description: 'Replaces reviewer list; approvals preserved' },
        attachments: ATTACHMENTS,
      },
      required: ['workspace', 'repository', 'pull_request_id'],
    },
  },
  {
    name: 'merge_pull_request',
    description: 'Merge a pull request. Pass `version` to save a fetch.',
    group: 'pr_core',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        pull_request_id: PRID,
        version: VERSION,
        merge_strategy: { type: 'string', enum: ['merge-commit', 'squash', 'fast-forward'], description: 'Cloud only' },
        close_source_branch: { type: 'boolean', description: 'Cloud only' },
        commit_message: { type: 'string' },
      },
      required: ['workspace', 'repository', 'pull_request_id'],
    },
  },
  {
    name: 'decline_pull_request',
    description: 'Decline a pull request, optionally with a comment. Pass `version` to save a fetch (Server).',
    group: 'pr_core',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        pull_request_id: PRID,
        version: VERSION,
        comment: { type: 'string', description: 'Reason for declining' },
      },
      required: ['workspace', 'repository', 'pull_request_id'],
    },
  },

  // ── Comments & tasks ───────────────────────────────────────────────────────
  {
    name: 'add_comment',
    description:
      'Add a PR comment: general, threaded reply (parent_comment_id), inline (file_path + line_number), ' +
      'code suggestion (suggestion), or task (severity BLOCKER, Server only). ' +
      'code_snippet auto-resolves line_number from exact diff text when line_number is unknown.',
    group: 'pr_comments',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        pull_request_id: PRID,
        comment_text: { type: 'string' },
        parent_comment_id: { type: 'number', description: 'Reply to this comment' },
        file_path: { type: 'string', description: 'Inline comment file' },
        line_number: { type: 'number', description: 'Inline comment line (or use code_snippet)' },
        line_type: { type: 'string', enum: ['ADDED', 'REMOVED', 'CONTEXT'], description: 'Default CONTEXT' },
        suggestion: { type: 'string', description: 'Replacement code block; needs file_path + line_number' },
        suggestion_end_line: { type: 'number', description: 'Multi-line suggestion end' },
        code_snippet: { type: 'string', description: 'Exact diff line text to locate (whitespace-sensitive)' },
        search_context: {
          type: 'object',
          properties: {
            before: { type: 'array', items: { type: 'string' } },
            after: { type: 'array', items: { type: 'string' } },
          },
          description: 'Disambiguates repeated code_snippet',
        },
        match_strategy: { type: 'string', enum: ['strict', 'best'], description: 'On multiple snippet matches (default strict)' },
        severity: { type: 'string', enum: ['NORMAL', 'BLOCKER'], description: 'BLOCKER creates a task (Server only)' },
        attachments: ATTACHMENTS,
      },
      required: ['workspace', 'repository', 'pull_request_id', 'comment_text'],
    },
  },
  {
    name: 'manage_comment',
    description:
      'Edit/delete/resolve/reopen a PR comment or task, or convert between comment and task (to_task/to_comment are Server-only). ' +
      'Pass `version` (from get_pull_request output) to save a fetch (Server).',
    group: 'pr_comments',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        pull_request_id: PRID,
        comment_id: { type: 'number' },
        action: { type: 'string', enum: ['edit', 'delete', 'resolve', 'reopen', 'to_task', 'to_comment'] },
        text: { type: 'string', description: 'New text (edit only)' },
        version: VERSION,
      },
      required: ['workspace', 'repository', 'pull_request_id', 'comment_id', 'action'],
    },
  },

  // ── Review ─────────────────────────────────────────────────────────────────
  {
    name: 'get_pull_request_diff',
    description:
      'Get a PR diff as raw unified diff text (line numbers derive from @@ headers; +/- prefixes mark ADDED/REMOVED). ' +
      'Scope with file_path (server-side) or include/exclude glob patterns.',
    group: 'pr_review',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        pull_request_id: PRID,
        context_lines: { type: 'number', description: 'Default 3; 0 = minimal' },
        file_path: { type: 'string', description: 'Diff one file only' },
        include_patterns: { type: 'array', items: { type: 'string' }, description: 'Globs to include' },
        exclude_patterns: { type: 'array', items: { type: 'string' }, description: 'Globs to exclude' },
        ignore_whitespace: { type: 'boolean', description: 'Server only' },
      },
      required: ['workspace', 'repository', 'pull_request_id'],
    },
  },
  {
    name: 'set_review_status',
    description:
      'Set YOUR reviewer status on a PR: APPROVED, NEEDS_WORK (request changes), or UNAPPROVED (clear). ' +
      'One call; the three states are mutually exclusive.',
    group: 'pr_review',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        pull_request_id: PRID,
        status: { type: 'string', enum: ['APPROVED', 'NEEDS_WORK', 'UNAPPROVED'] },
        comment: { type: 'string', description: 'Optional explanatory comment' },
      },
      required: ['workspace', 'repository', 'pull_request_id', 'status'],
    },
  },

  // ── Commits ────────────────────────────────────────────────────────────────
  {
    name: 'list_pr_commits',
    description: 'List commits in a pull request.',
    group: 'commits',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        pull_request_id: PRID,
        limit: LIMIT,
        start: START,
        include_build_status: { type: 'boolean', description: 'CI status per commit (Server only)' },
      },
      required: ['workspace', 'repository', 'pull_request_id'],
    },
  },
  {
    name: 'list_branch_commits',
    description:
      'List commits on a branch. since (as a rev) and include_merge_commits filter server-side; ' +
      'author/until/search and date-valued since filter client-side over a bounded page walk (noted when more pages exist).',
    group: 'commits',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        branch_name: { type: 'string' },
        limit: LIMIT,
        start: START,
        since: { type: 'string', description: 'ISO date lower bound, or a commit SHA/ref (exclusive) for a server-side range' },
        until: { type: 'string', description: 'ISO date upper bound' },
        author: { type: 'string' },
        include_merge_commits: { type: 'boolean', description: 'Default true' },
        search: { type: 'string', description: 'Substring in commit message' },
        include_build_status: { type: 'boolean', description: 'Server only' },
      },
      required: ['workspace', 'repository', 'branch_name'],
    },
  },
  {
    name: 'get_commit_detail',
    description:
      'Get a commit diff as raw unified diff text, or detail:"files" for just the changed-file list (no diff bodies).',
    group: 'commits',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        commit_id: { type: 'string', description: 'Commit SHA' },
        detail: { type: 'string', enum: ['diff', 'files'], description: 'Default diff' },
        context_lines: { type: 'number', description: 'Default 3' },
        file_path: { type: 'string', description: 'Diff one file only' },
        include_patterns: { type: 'array', items: { type: 'string' } },
        exclude_patterns: { type: 'array', items: { type: 'string' } },
      },
      required: ['workspace', 'repository', 'commit_id'],
    },
  },

  // ── Branches ───────────────────────────────────────────────────────────────
  {
    name: 'list_branches',
    description: 'List branches (most recently modified first on Server).',
    group: 'branches',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: { workspace: W, repository: R, filter: { type: 'string', description: 'Name filter' }, limit: LIMIT, start: START },
      required: ['workspace', 'repository'],
    },
  },
  {
    name: 'get_branch',
    description: 'Get a branch with its latest commit and open PRs (include_merged_prs adds merged ones).',
    group: 'branches',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        branch_name: { type: 'string' },
        include_merged_prs: { type: 'boolean', description: 'Default false' },
      },
      required: ['workspace', 'repository', 'branch_name'],
    },
  },
  {
    name: 'delete_branch',
    description: 'Delete a branch. Pass expected_head (commit SHA) to skip the lookup call (Server).',
    group: 'branches',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        branch_name: { type: 'string' },
        expected_head: { type: 'string', description: 'Known head SHA (compare-and-swap)' },
      },
      required: ['workspace', 'repository', 'branch_name'],
    },
  },

  // ── Files ──────────────────────────────────────────────────────────────────
  {
    name: 'list_directory_content',
    description: 'List files and directories at a repository path.',
    group: 'files',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: { workspace: W, repository: R, path: { type: 'string', description: 'Default: root' }, branch: BRANCH },
      required: ['workspace', 'repository'],
    },
  },
  {
    name: 'get_file_content',
    description:
      'Read a file. Windowed by default (start_line/line_count fetch ONLY that window server-side; ≤5000 lines per call). ' +
      'full_content=true or negative start_line (tail) fetches the whole file — prefer windows.',
    group: 'files',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        file_path: { type: 'string' },
        branch: BRANCH,
        start_line: { type: 'number', description: '1-based; negative = from end' },
        line_count: { type: 'number' },
        full_content: { type: 'boolean', description: 'Entire file regardless of size' },
      },
      required: ['workspace', 'repository', 'file_path'],
    },
  },
  {
    name: 'get_file_blame',
    description:
      'Per-line blame as commit spans (one call per ≤5000-line window — pass start_line/line_count for big files). ' +
      'Pair commit ids with get_commit_detail. Server only.',
    group: 'files',
    availability: 'server_only',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        file_path: { type: 'string' },
        branch: BRANCH,
        start_line: { type: 'number', description: '1-based window start' },
        line_count: { type: 'number', description: 'Window size' },
      },
      required: ['workspace', 'repository', 'file_path'],
    },
  },

  // ── Search ─────────────────────────────────────────────────────────────────
  {
    name: 'grep',
    description:
      'Search file CONTENTS in a repo with full regex, like ripgrep on a local clone — any branch, no index gaps. ' +
      'One archive fetch per repo+commit, cached in memory and freshness-checked every call (responses show as_of commit). ' +
      'Omit `query` to list files by glob only. Modes: content (matches), files (paths), count. ' +
      'Scope with glob and/or path to keep scans fast. Server only.',
    group: 'search',
    availability: 'server_only',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        query: { type: 'string', description: 'Regex applied per line; omit for filename-only listing' },
        glob: { type: 'string', description: 'Filename filter, e.g. "*.ts" or "src/**"' },
        path: { type: 'string', description: 'Subtree to scan (scopes the archive fetch)' },
        branch: BRANCH,
        mode: { type: 'string', enum: ['content', 'files', 'count'], description: 'Default content' },
        case_insensitive: { type: 'boolean', description: 'Default false' },
        context: { type: 'number', description: 'Context lines around matches (default 0)' },
        max_results: { type: 'number', description: 'Max match lines (default 50)' },
      },
      required: ['workspace', 'repository'],
    },
  },
  {
    name: 'search_code',
    description:
      'Index-backed exact-term code search across a whole PROJECT in one call (default branch only, files <512KiB, ' +
      'punctuation except . and _ ignored, case-insensitive, no regex, max ~1000 results). ' +
      'Best for cross-repo identifier lookups; for one repo, regex, or feature branches use grep.',
    group: 'search',
    availability: 'server_only',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: { type: 'string', description: 'Scope to one repo (optional)' },
        query: { type: 'string', description: 'Term or "phrase"; operators AND OR NOT in CAPS' },
        lang: { type: 'string', description: 'lang: modifier (e.g. java)' },
        ext: { type: 'string', description: 'Extension without dot' },
        path: { type: 'string', description: 'path: modifier' },
        exclude_terms: { type: 'array', items: { type: 'string' }, description: 'Each becomes -term' },
        archived: { type: 'string', enum: ['true', 'false', '*'], description: 'Default false' },
        fork: { type: 'string', enum: ['true', 'false'] },
        regex_filter: { type: 'string', description: 'Client-side regex post-filter on hit lines' },
        limit: LIMIT,
        start: START,
      },
      required: ['workspace', 'query'],
    },
  },
  {
    name: 'search_repositories',
    description: 'Find repositories by name/description across the instance. Server only.',
    group: 'search',
    availability: 'server_only',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        workspace: { type: 'string', description: 'Project key scope' },
        limit: LIMIT,
      },
      required: ['query'],
    },
  },

  // ── Attachments ────────────────────────────────────────────────────────────
  {
    name: 'manage_attachments',
    description:
      'Download or delete a repository attachment by numeric id (Server only). Upload via the attachments param on add_comment/create_pull_request/update_pull_request. No list API exists.',
    group: 'attachments',
    availability: 'server_only',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        action: { type: 'string', enum: ['download', 'delete'] },
        attachment_id: { type: 'string', description: 'Numeric id (trailing number of attachment:N/M)' },
      },
      required: ['workspace', 'repository', 'action', 'attachment_id'],
    },
  },

  // ── Discovery ──────────────────────────────────────────────────────────────
  {
    name: 'list_projects',
    description: 'List accessible projects/workspaces.',
    group: 'discovery',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name filter' },
        permission: { type: 'string', description: 'e.g. PROJECT_READ' },
        limit: LIMIT,
        start: START,
      },
      required: [],
    },
  },
  {
    name: 'list_repositories',
    description: 'List repositories in a project (or all accessible on Server).',
    group: 'discovery',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'Project key (required on Cloud)' },
        name: { type: 'string', description: 'Name filter' },
        permission: { type: 'string', description: 'e.g. REPO_READ' },
        limit: LIMIT,
        start: START,
      },
      required: [],
    },
  },
];
