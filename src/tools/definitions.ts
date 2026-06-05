export type ToolGroup =
  | 'pr_core'
  | 'pr_comments'
  | 'pr_review'
  | 'pr_tasks'
  | 'commits'
  | 'branches'
  | 'files'
  | 'search'
  | 'attachments'
  | 'discovery';

export type ToolAvailability = 'both' | 'server_only';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: object;
  group: ToolGroup;
  availability: ToolAvailability;
}

// Shared parameter definitions — reused across tools to avoid repetition
const W = { type: 'string', description: 'Project key (e.g., PROJ)' };
const R = { type: 'string', description: 'Repository slug (e.g., my-repo)' };
const PRID = { type: 'number', description: 'Pull request ID' };
const TASK_ID = { type: 'number', description: 'Task ID' };
const LIMIT = { type: 'number', description: 'Max results to return (default: 25)' };
const START = { type: 'number', description: 'Pagination start index (default: 0)' };
const BRANCH = { type: 'string', description: 'Branch name (default: default branch)' };
const ATTACHMENTS = {
  type: 'array',
  description:
    'Files to upload and embed in the comment/description. BITBUCKET SERVER / DATA CENTER ONLY ' +
    '(Bitbucket Cloud has no public attachment API and will return an error). Each item is either a ' +
    'local file path string, or an object { file_path, alt_text?, render? } where render is ' +
    '"image" | "link" | "auto" (default "auto": images embed inline, other files as download links).',
  items: {
    oneOf: [
      { type: 'string', description: 'Local file path, e.g. "/tmp/screenshot.png"' },
      {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Local file path' },
          alt_text: { type: 'string', description: 'Alt text / link label (optional, defaults to filename)' },
          render: {
            type: 'string',
            enum: ['image', 'link', 'auto'],
            description: 'How to embed: image (inline), link (download link), or auto (default)',
          },
        },
        required: ['file_path'],
      },
    ],
  },
};

export const toolDefinitions: ToolDefinition[] = [

  // ── PR_CORE ────────────────────────────────────────────────────────────────
  {
    name: 'get_pull_request',
    description: 'Get full details of a pull request including active comments, file changes, reviewer status, and merge commit information',
    group: 'pr_core',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: { workspace: W, repository: R, pull_request_id: PRID },
      required: ['workspace', 'repository', 'pull_request_id'],
    },
  },
  {
    name: 'list_pull_requests',
    description: 'List pull requests for a repository with optional filters',
    group: 'pr_core',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        state: {
          type: 'string',
          description: 'Filter by state: OPEN, MERGED, DECLINED, ALL (default: OPEN)',
          enum: ['OPEN', 'MERGED', 'DECLINED', 'ALL'],
        },
        author: { type: 'string', description: 'Filter by author username (optional)' },
        limit: LIMIT,
        start: START,
      },
      required: ['workspace', 'repository'],
    },
  },
  {
    name: 'create_pull_request',
    description: 'Create a new pull request',
    group: 'pr_core',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        title: { type: 'string', description: 'Pull request title' },
        source_branch: { type: 'string', description: 'Source branch name' },
        destination_branch: { type: 'string', description: 'Destination branch (e.g., main)' },
        description: { type: 'string', description: 'Pull request description (optional)' },
        reviewers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Reviewer usernames (optional)',
        },
        close_source_branch: {
          type: 'boolean',
          description: 'Close source branch after merge (optional, default: false)',
        },
        attachments: ATTACHMENTS,
      },
      required: ['workspace', 'repository', 'title', 'source_branch', 'destination_branch'],
    },
  },
  {
    name: 'update_pull_request',
    description: 'Update an existing pull request. Existing reviewers and their approval status are preserved when not explicitly updating the reviewer list.',
    group: 'pr_core',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        pull_request_id: PRID,
        title: { type: 'string', description: 'New title (optional)' },
        description: { type: 'string', description: 'New description (optional)' },
        destination_branch: { type: 'string', description: 'New destination branch (optional)' },
        reviewers: {
          type: 'array',
          items: { type: 'string' },
          description: 'New reviewer list. Replaces existing reviewers but preserves approval status. Omit to keep existing reviewers (optional)',
        },
        attachments: ATTACHMENTS,
      },
      required: ['workspace', 'repository', 'pull_request_id'],
    },
  },
  {
    name: 'merge_pull_request',
    description: 'Merge a pull request',
    group: 'pr_core',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        pull_request_id: PRID,
        merge_strategy: {
          type: 'string',
          description: 'Merge strategy (optional)',
          enum: ['merge-commit', 'squash', 'fast-forward'],
        },
        close_source_branch: { type: 'boolean', description: 'Close source branch after merge (optional)' },
        commit_message: { type: 'string', description: 'Custom merge commit message (optional)' },
      },
      required: ['workspace', 'repository', 'pull_request_id'],
    },
  },
  {
    name: 'decline_pull_request',
    description: 'Decline/reject a pull request',
    group: 'pr_core',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        pull_request_id: PRID,
        comment: { type: 'string', description: 'Reason for declining (optional)' },
      },
      required: ['workspace', 'repository', 'pull_request_id'],
    },
  },

  // ── PR_COMMENTS ───────────────────────────────────────────────────────────
  {
    name: 'add_comment',
    description: 'Add a comment to a pull request. Supports general comments, threaded replies, inline comments on specific lines, and code suggestions. Use file_path + line_number for inline comments, or code_snippet to auto-detect the line.',
    group: 'pr_comments',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        pull_request_id: PRID,
        comment_text: { type: 'string', description: 'Comment text. For suggestions, this is the explanation before the code block.' },
        parent_comment_id: { type: 'number', description: 'Comment ID to reply to (optional)' },
        file_path: { type: 'string', description: 'File path for inline comment, e.g. "src/index.ts" (optional)' },
        line_number: { type: 'number', description: 'Line number in the file. Use with file_path. Provide this OR code_snippet (optional)' },
        line_type: {
          type: 'string',
          description: 'Line type: ADDED (green), REMOVED (red), CONTEXT (unchanged). Default: CONTEXT',
          enum: ['ADDED', 'REMOVED', 'CONTEXT'],
        },
        suggestion: { type: 'string', description: 'Replacement code for a suggestion block. Requires file_path and line_number (optional)' },
        suggestion_end_line: { type: 'number', description: 'Last line to replace for multi-line suggestions (optional)' },
        code_snippet: { type: 'string', description: 'Exact code text from the diff to auto-detect line number. Must match exactly including whitespace (optional)' },
        search_context: {
          type: 'object',
          properties: {
            before: { type: 'array', items: { type: 'string' }, description: 'Lines before the target to disambiguate' },
            after: { type: 'array', items: { type: 'string' }, description: 'Lines after the target to disambiguate' },
          },
          description: 'Context lines to disambiguate when code_snippet appears multiple times (optional)',
        },
        match_strategy: {
          type: 'string',
          enum: ['strict', 'best'],
          description: 'How to handle multiple code_snippet matches. "strict": error with all matches. "best": auto-pick highest confidence. Default: strict',
        },
        attachments: ATTACHMENTS,
      },
      required: ['workspace', 'repository', 'pull_request_id', 'comment_text'],
    },
  },
  {
    name: 'delete_comment',
    description: 'Delete a comment from a pull request. Comments with replies cannot be deleted.',
    group: 'pr_comments',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        pull_request_id: PRID,
        comment_id: { type: 'number', description: 'Comment ID to delete' },
      },
      required: ['workspace', 'repository', 'pull_request_id', 'comment_id'],
    },
  },

  // ── ATTACHMENTS (server_only) ─────────────────────────────────────────────
  {
    name: 'manage_attachments',
    description:
      'Manage existing repository attachments (Bitbucket Server / Data Center only). ' +
      'action "download": fetch the file bytes by numeric attachment id (returns text inline, or an image as an image block). ' +
      'action "delete": remove an attachment by numeric id (requires REPO_ADMIN). ' +
      'To UPLOAD and embed new files, use the "attachments" parameter on add_comment / create_pull_request / update_pull_request instead — not this tool. ' +
      'There is no "list" action: Bitbucket exposes no attachment-listing API.',
    group: 'attachments',
    availability: 'server_only',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        action: {
          type: 'string',
          enum: ['download', 'delete'],
          description: 'download: fetch the file bytes; delete: remove the attachment (REPO_ADMIN)',
        },
        attachment_id: {
          type: 'string',
          description:
            'Numeric attachment id — the trailing number of an attachment:N/M reference (e.g. "3" from attachment:1/3), or the id returned by an upload.',
        },
      },
      required: ['workspace', 'repository', 'action', 'attachment_id'],
    },
  },

  // ── PR_REVIEW ─────────────────────────────────────────────────────────────
  {
    name: 'get_pull_request_diff',
    description: 'Get the diff for a pull request with structured line-by-line information. Each line has source_line, destination_line, type (ADDED/REMOVED/CONTEXT), and content. For inline comments: use destination_line + ADDED/CONTEXT, or source_line + REMOVED.',
    group: 'pr_review',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        pull_request_id: PRID,
        context_lines: { type: 'number', description: 'Context lines around changes (default: 3)' },
        include_patterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Glob patterns to include, e.g. ["*.ts", "src/**/*.js"] (optional)',
        },
        exclude_patterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Glob patterns to exclude, e.g. ["*.lock", "*.svg"] (optional)',
        },
        file_path: { type: 'string', description: 'Get diff for a specific file only, e.g. "src/index.ts" (optional)' },
      },
      required: ['workspace', 'repository', 'pull_request_id'],
    },
  },
  {
    name: 'set_pr_approval',
    description: 'Approve or remove approval from a pull request',
    group: 'pr_review',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        pull_request_id: PRID,
        approved: { type: 'boolean', description: 'true to approve, false to remove approval' },
      },
      required: ['workspace', 'repository', 'pull_request_id', 'approved'],
    },
  },
  {
    name: 'set_review_status',
    description: 'Request changes on or remove a change request from a pull request',
    group: 'pr_review',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        pull_request_id: PRID,
        request_changes: { type: 'boolean', description: 'true to request changes, false to remove change request' },
        comment: { type: 'string', description: 'Explanation for the review status (optional)' },
      },
      required: ['workspace', 'repository', 'pull_request_id', 'request_changes'],
    },
  },

  // ── PR_TASKS (server_only) ────────────────────────────────────────────────
  {
    name: 'list_pr_tasks',
    description: 'List all tasks on a pull request (Bitbucket Server only)',
    group: 'pr_tasks',
    availability: 'server_only',
    inputSchema: {
      type: 'object',
      properties: { workspace: W, repository: R, pull_request_id: PRID },
      required: ['workspace', 'repository', 'pull_request_id'],
    },
  },
  {
    name: 'create_pr_task',
    description: 'Create a new task on a pull request (Bitbucket Server only)',
    group: 'pr_tasks',
    availability: 'server_only',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        pull_request_id: PRID,
        text: { type: 'string', description: 'Task description' },
      },
      required: ['workspace', 'repository', 'pull_request_id', 'text'],
    },
  },
  {
    name: 'update_pr_task',
    description: 'Update the text of an existing task on a pull request (Bitbucket Server only)',
    group: 'pr_tasks',
    availability: 'server_only',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        pull_request_id: PRID,
        task_id: TASK_ID,
        text: { type: 'string', description: 'New task description' },
      },
      required: ['workspace', 'repository', 'pull_request_id', 'task_id', 'text'],
    },
  },
  {
    name: 'delete_pr_task',
    description: 'Delete a task from a pull request (Bitbucket Server only)',
    group: 'pr_tasks',
    availability: 'server_only',
    inputSchema: {
      type: 'object',
      properties: { workspace: W, repository: R, pull_request_id: PRID, task_id: TASK_ID },
      required: ['workspace', 'repository', 'pull_request_id', 'task_id'],
    },
  },
  {
    name: 'set_pr_task_status',
    description: 'Mark a task as done or reopen it on a pull request (Bitbucket Server only)',
    group: 'pr_tasks',
    availability: 'server_only',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        pull_request_id: PRID,
        task_id: TASK_ID,
        done: { type: 'boolean', description: 'true to mark done, false to reopen' },
      },
      required: ['workspace', 'repository', 'pull_request_id', 'task_id', 'done'],
    },
  },
  {
    name: 'convert_pr_item',
    description: 'Convert a comment to a task or a task back to a comment (Bitbucket Server only)',
    group: 'pr_tasks',
    availability: 'server_only',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        pull_request_id: PRID,
        id: { type: 'number', description: 'Comment ID (when direction is to_task) or Task ID (when direction is to_comment)' },
        direction: {
          type: 'string',
          enum: ['to_task', 'to_comment'],
          description: 'Conversion direction',
        },
      },
      required: ['workspace', 'repository', 'pull_request_id', 'id', 'direction'],
    },
  },

  // ── COMMITS ───────────────────────────────────────────────────────────────
  {
    name: 'list_pr_commits',
    description: 'List all commits in a pull request',
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
        include_build_status: { type: 'boolean', description: 'Include CI/CD build status per commit (Server only, default: false)' },
      },
      required: ['workspace', 'repository', 'pull_request_id'],
    },
  },
  {
    name: 'list_branch_commits',
    description: 'List commits in a branch with optional filters',
    group: 'commits',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        branch_name: { type: 'string', description: 'Branch name' },
        limit: LIMIT,
        start: START,
        since: { type: 'string', description: 'ISO date — only commits after this date (optional)' },
        until: { type: 'string', description: 'ISO date — only commits before this date (optional)' },
        author: { type: 'string', description: 'Filter by author name (optional)' },
        include_merge_commits: { type: 'boolean', description: 'Include merge commits (default: true)' },
        search: { type: 'string', description: 'Search text in commit messages (optional)' },
        include_build_status: { type: 'boolean', description: 'Include CI/CD build status per commit (Server only, default: false)' },
      },
      required: ['workspace', 'repository', 'branch_name'],
    },
  },

  {
    name: 'get_commit_detail',
    description: 'Get the diff for a specific commit with structured line-by-line information. Each line has source_line, destination_line, type (ADDED/REMOVED/CONTEXT), and content.',
    group: 'commits',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        commit_id: { type: 'string', description: 'Commit hash (full or abbreviated SHA)' },
        context_lines: { type: 'number', description: 'Context lines around changes (default: 3)' },
        include_patterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Glob patterns to include, e.g. ["*.ts", "src/**/*.js"] (optional)',
        },
        exclude_patterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Glob patterns to exclude, e.g. ["*.lock", "*.svg"] (optional)',
        },
        file_path: { type: 'string', description: 'Get diff for a specific file only, e.g. "src/index.ts" (optional)' },
      },
      required: ['workspace', 'repository', 'commit_id'],
    },
  },

  // ── BRANCHES ──────────────────────────────────────────────────────────────
  {
    name: 'list_branches',
    description: 'List branches in a repository',
    group: 'branches',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        filter: { type: 'string', description: 'Filter by name pattern (optional)' },
        limit: LIMIT,
        start: START,
      },
      required: ['workspace', 'repository'],
    },
  },
  {
    name: 'get_branch',
    description: 'Get detailed information about a branch including its latest commit and associated pull requests',
    group: 'branches',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        branch_name: { type: 'string', description: 'Branch name' },
        include_merged_prs: { type: 'boolean', description: 'Include merged PRs from this branch (default: false)' },
      },
      required: ['workspace', 'repository', 'branch_name'],
    },
  },
  {
    name: 'delete_branch',
    description: 'Delete a branch',
    group: 'branches',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        branch_name: { type: 'string', description: 'Branch name to delete' },
        force: { type: 'boolean', description: 'Force delete even if not merged (default: false)' },
      },
      required: ['workspace', 'repository', 'branch_name'],
    },
  },

  // ── FILES ─────────────────────────────────────────────────────────────────
  {
    name: 'list_directory_content',
    description: 'List files and directories in a repository path',
    group: 'files',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        path: { type: 'string', description: 'Directory path (default: root, e.g. "src/components")' },
        branch: BRANCH,
      },
      required: ['workspace', 'repository'],
    },
  },
  {
    name: 'get_file_content',
    description: 'Get file content from a repository with smart truncation for large files',
    group: 'files',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        file_path: { type: 'string', description: 'File path, e.g. "src/index.ts"' },
        branch: BRANCH,
        start_line: { type: 'number', description: 'Starting line (1-based, negative = from end) (optional)' },
        line_count: { type: 'number', description: 'Number of lines to return (optional)' },
        full_content: { type: 'boolean', description: 'Return full content regardless of size (default: false)' },
      },
      required: ['workspace', 'repository', 'file_path'],
    },
  },
  {
    name: 'get_file_blame',
    description: 'Get per-line blame for a file — who last modified each line, the commit hash, and author timestamp. Use the returned commit_id with get_commit_detail to see what actually changed. Bitbucket Server only.',
    group: 'files',
    availability: 'server_only',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        file_path: { type: 'string', description: 'File path, e.g. "src/index.ts"' },
        branch: BRANCH,
        start_line: { type: 'number', description: 'Starting line (1-based) to limit output (optional)' },
        line_count: { type: 'number', description: 'Number of lines to return from start_line (optional)' },
        group_by_commit: { type: 'boolean', description: 'Group contiguous lines from the same commit into ranges (default: true)' },
      },
      required: ['workspace', 'repository', 'file_path'],
    },
  },
  {
    name: 'search_files',
    description:
      'Lists files in a repository whose path matches a glob. Filename-only — does NOT search file contents. ' +
      'For content search use search_code (index-backed) or find_in_files (file-fan-out).',
    group: 'files',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        pattern: { type: 'string', description: 'Glob pattern, e.g. "*.ts", "**/*.java", "**/Controller*" (optional, returns all files if omitted)' },
        path: { type: 'string', description: 'Subdirectory to search within (optional)' },
        branch: BRANCH,
        limit: { type: 'number', description: 'Max matching files to return (default: 100)' },
      },
      required: ['workspace', 'repository'],
    },
  },

  // ── SEARCH (server_only) ──────────────────────────────────────────────────
  {
    name: 'search_code',
    description:
      'Index-backed code search across Bitbucket Server. Fast, one API call. ' +
      'USE WHEN: looking for an exact identifier or string in indexed default-branch content. ' +
      'DO NOT USE WHEN: you need regex/wildcards/fuzzy match, the file is >512 KiB, you are searching a feature branch, or the language is not indexed — use find_in_files instead. ' +
      'INDEX QUIRKS: punctuation other than . and _ is stripped at index time (so foo(, foo:, foo= all behave like bare foo); case-insensitive; single-character terms ignored; OR/NOT/parens supported (operators ALL CAPS); implicit AND between terms. ' +
      'LIMITS: 250-char query, max 9 expressions, 512 KiB per file, default branch only. ' +
      'On zero results, response may include warnings: ["INDEX_GAP_LIKELY..."] — switch to find_in_files. ' +
      'Output is dense JSON with only matched lines (no surrounding context).',
    group: 'search',
    availability: 'server_only',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: { type: 'string', description: 'Repo slug. Omit to search all repos in the project.' },
        query: { type: 'string', description: 'Term or phrase. No regex/wildcards/fuzzy. Punctuation other than . and _ is ignored at index time.' },
        lang: { type: 'string', description: 'Bitbucket lang: modifier. One expression covers all extensions for the language; cheaper than ext:.' },
        ext: { type: 'string', description: 'File extension without dot (e.g. tsx). Use when lang is too broad.' },
        path: { type: 'string', description: 'Subpath scope (Bitbucket path: modifier). Use lang/ext for extension filtering.' },
        exclude_terms: {
          type: 'array',
          items: { type: 'string' },
          description: 'Terms to exclude. Each becomes a -term clause; counts toward the 9-expression budget.',
        },
        archived: { type: 'string', enum: ['true', 'false', '*'], description: 'Filter by archive status. Default: only active repos.' },
        fork: { type: 'string', enum: ['true', 'false'], description: 'Filter by fork status.' },
        regex_filter: { type: 'string', description: 'Optional regex applied to returned hit lines as a client-side post-filter. Lets you narrow without spending Bitbucket query budget.' },
        case_variants: { type: 'boolean', description: 'If true, also runs the query with snake_case ↔ camelCase converted and merges results. Costs one extra API call.' },
        limit: { type: 'number', description: 'Max hits returned (default: 25).' },
        start: START,
      },
      required: ['workspace', 'query'],
    },
  },
  {
    name: 'find_in_files',
    description:
      'Content search by listing files and reading them. Slower than search_code (1 + N API calls) but supports full regex and works where the index has gaps. ' +
      'USE WHEN: search_code returned INDEX_GAP_LIKELY, you need real regex, or the language/branch is not indexed. ' +
      'DO NOT USE WHEN: search_code would work — it is far cheaper. ' +
      'ALWAYS provide filename_pattern; without it the tool fans out across the whole repo and is likely to truncate. ' +
      'Same dense JSON output shape as search_code; engine field is "find_in_files".',
    group: 'search',
    availability: 'server_only',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: W,
        repository: R,
        content_query: { type: 'string', description: 'Regex (PCRE-style) applied to each file\'s contents line-by-line. Anchor with ^/$ for line-level patterns.' },
        filename_pattern: { type: 'string', description: 'Glob scoping the file set. Strongly recommended.' },
        branch: BRANCH,
        regex_filter: { type: 'string', description: 'Optional second regex applied to each candidate hit line as a post-filter.' },
        max_files: { type: 'number', description: 'Hard cap on files fetched. Default 3000. If exceeded, response has truncated: true and (on zero matches) a POSSIBLE_FALSE_NEGATIVE warning.' },
        parallelism: { type: 'number', description: 'Concurrent file fetches. Default 4. Higher values risk Bitbucket rate-limiting (429/403); on RATE_LIMITED warning, lower this and narrow filename_pattern.' },
        limit: { type: 'number', description: 'Max total hit lines returned across all files (default: 25).' },
      },
      required: ['workspace', 'repository', 'content_query'],
    },
  },
  {
    name: 'search_repositories',
    description:
      'Find repositories by name, slug, or description across the Bitbucket Server instance. ' +
      'For finding code WITHIN a known repo, use search_code instead.',
    group: 'search',
    availability: 'server_only',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Repository name, slug, or keyword.' },
        workspace: { type: 'string', description: 'Project key to scope the search (optional).' },
        limit: { type: 'number', description: 'Max results (default: 10).' },
      },
      required: ['query'],
    },
  },

  // ── DISCOVERY ─────────────────────────────────────────────────────────────
  {
    name: 'list_projects',
    description: 'List all accessible Bitbucket projects/workspaces with optional filtering',
    group: 'discovery',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Filter by project name (partial match, optional)' },
        permission: { type: 'string', description: 'Filter by permission level, e.g. PROJECT_READ (optional)' },
        limit: LIMIT,
        start: START,
      },
      required: [],
    },
  },
  {
    name: 'list_repositories',
    description: 'List repositories in a project or across all accessible projects',
    group: 'discovery',
    availability: 'both',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'Project key to filter repositories (optional, lists all if omitted)' },
        name: { type: 'string', description: 'Filter by repository name (partial match, optional)' },
        permission: { type: 'string', description: 'Filter by permission level, e.g. REPO_READ (optional)' },
        limit: LIMIT,
        start: START,
      },
      required: [],
    },
  },
];
