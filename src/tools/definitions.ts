export const toolDefinitions = [
  {
    name: 'get_pull_request',
    description: 'Get details of a Bitbucket pull request including merge commit information',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: {
          type: 'string',
          description: 'Bitbucket workspace/project key (e.g., "PROJ")',
        },
        repository: {
          type: 'string',
          description: 'Repository slug (e.g., "my-repo")',
        },
        pull_request_id: {
          type: 'number',
          description: 'Pull request ID',
        },
      },
      required: ['workspace', 'repository', 'pull_request_id'],
    },
  },
  {
    name: 'list_pull_requests',
    description: 'List pull requests for a repository with optional filters',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: {
          type: 'string',
          description: 'Bitbucket workspace/project key (e.g., "PROJ")',
        },
        repository: {
          type: 'string',
          description: 'Repository slug (e.g., "my-repo")',
        },
        state: {
          type: 'string',
          description: 'Filter by PR state: OPEN, MERGED, DECLINED, ALL (default: OPEN)',
          enum: ['OPEN', 'MERGED', 'DECLINED', 'ALL'],
        },
        author: {
          type: 'string',
          description: 'Filter by author username',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of PRs to return (default: 25)',
        },
        start: {
          type: 'number',
          description: 'Start index for pagination (default: 0)',
        },
      },
      required: ['workspace', 'repository'],
    },
  },
  {
    name: 'create_pull_request',
    description: 'Create a new pull request',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: {
          type: 'string',
          description: 'Bitbucket workspace/project key (e.g., "PROJ")',
        },
        repository: {
          type: 'string',
          description: 'Repository slug (e.g., "my-repo")',
        },
        title: {
          type: 'string',
          description: 'Title of the pull request',
        },
        source_branch: {
          type: 'string',
          description: 'Source branch name',
        },
        destination_branch: {
          type: 'string',
          description: 'Destination branch name (e.g., "main", "master")',
        },
        description: {
          type: 'string',
          description: 'Description of the pull request (optional)',
        },
        reviewers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of reviewer usernames/emails (optional)',
        },
        close_source_branch: {
          type: 'boolean',
          description: 'Whether to close source branch after merge (optional, default: false)',
        },
      },
      required: ['workspace', 'repository', 'title', 'source_branch', 'destination_branch'],
    },
  },
  {
    name: 'update_pull_request',
    description: 'Update an existing pull request. When updating without specifying reviewers, existing reviewers and their approval status will be preserved.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: {
          type: 'string',
          description: 'Bitbucket workspace/project key (e.g., "PROJ")',
        },
        repository: {
          type: 'string',
          description: 'Repository slug (e.g., "my-repo")',
        },
        pull_request_id: {
          type: 'number',
          description: 'Pull request ID',
        },
        title: {
          type: 'string',
          description: 'New title (optional)',
        },
        description: {
          type: 'string',
          description: 'New description (optional)',
        },
        destination_branch: {
          type: 'string',
          description: 'New destination branch (optional)',
        },
        reviewers: {
          type: 'array',
          items: { type: 'string' },
          description: 'New list of reviewer usernames/emails. If provided, replaces the reviewer list (preserving approval status for existing reviewers). If omitted, existing reviewers are preserved. (optional)',
        },
      },
      required: ['workspace', 'repository', 'pull_request_id'],
    },
  },
  {
    name: 'add_comment',
    description: 'Add a comment to a pull request. Supports: 1) General PR comments, 2) Replies to existing comments, 3) Inline comments on specific code lines (using line_number OR code_snippet), 4) Code suggestions for single or multi-line replacements. For inline comments, you can either provide exact line_number or use code_snippet to auto-detect the line.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: {
          type: 'string',
          description: 'Bitbucket workspace/project key (e.g., "PROJ")',
        },
        repository: {
          type: 'string',
          description: 'Repository slug (e.g., "my-repo")',
        },
        pull_request_id: {
          type: 'number',
          description: 'Pull request ID',
        },
        comment_text: {
          type: 'string',
          description: 'The main comment text. For suggestions, this is the explanation before the code suggestion.',
        },
        parent_comment_id: {
          type: 'number',
          description: 'ID of comment to reply to. Use this to create threaded conversations (optional)',
        },
        file_path: {
          type: 'string',
          description: 'File path for inline comment. Required for inline comments. Example: "src/components/Button.js" (optional)',
        },
        line_number: {
          type: 'number',
          description: 'Exact line number in the file. Use this OR code_snippet, not both. Required with file_path unless using code_snippet (optional)',
        },
        line_type: {
          type: 'string',
          description: 'Type of line: ADDED (green/new lines), REMOVED (red/deleted lines), or CONTEXT (unchanged lines). Default: CONTEXT',
          enum: ['ADDED', 'REMOVED', 'CONTEXT'],
        },
        suggestion: {
          type: 'string',
          description: 'Replacement code for a suggestion. Creates a suggestion block that can be applied in Bitbucket UI. Requires file_path and line_number. For multi-line, include newlines in the string (optional)',
        },
        suggestion_end_line: {
          type: 'number',
          description: 'For multi-line suggestions: the last line number to replace. If not provided, only replaces the single line at line_number (optional)',
        },
        code_snippet: {
          type: 'string',
          description: 'Exact code text from the diff to find and comment on. Use this instead of line_number for auto-detection. Must match exactly including whitespace (optional)',
        },
        search_context: {
          type: 'object',
          properties: {
            before: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of code lines that appear BEFORE the target line. Helps disambiguate when code_snippet appears multiple times',
            },
            after: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of code lines that appear AFTER the target line. Helps disambiguate when code_snippet appears multiple times',
            },
          },
          description: 'Additional context lines to help locate the exact position when using code_snippet. Useful when the same code appears multiple times (optional)',
        },
        match_strategy: {
          type: 'string',
          enum: ['strict', 'best'],
          description: 'How to handle multiple matches when using code_snippet. "strict": fail with detailed error showing all matches. "best": automatically pick the highest confidence match. Default: "strict"',
        },
      },
      required: ['workspace', 'repository', 'pull_request_id', 'comment_text'],
    },
  },
  {
    name: 'merge_pull_request',
    description: 'Merge a pull request',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: {
          type: 'string',
          description: 'Bitbucket workspace/project key (e.g., "PROJ")',
        },
        repository: {
          type: 'string',
          description: 'Repository slug (e.g., "my-repo")',
        },
        pull_request_id: {
          type: 'number',
          description: 'Pull request ID',
        },
        merge_strategy: {
          type: 'string',
          description: 'Merge strategy: merge-commit, squash, fast-forward (optional)',
          enum: ['merge-commit', 'squash', 'fast-forward'],
        },
        close_source_branch: {
          type: 'boolean',
          description: 'Whether to close source branch after merge (optional)',
        },
        commit_message: {
          type: 'string',
          description: 'Custom merge commit message (optional)',
        },
      },
      required: ['workspace', 'repository', 'pull_request_id'],
    },
  },
  {
    name: 'list_branches',
    description: 'List branches in a repository',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: {
          type: 'string',
          description: 'Bitbucket workspace/project key (e.g., "PROJ")',
        },
        repository: {
          type: 'string',
          description: 'Repository slug (e.g., "my-repo")',
        },
        filter: {
          type: 'string',
          description: 'Filter branches by name pattern (optional)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of branches to return (default: 25)',
        },
        start: {
          type: 'number',
          description: 'Start index for pagination (default: 0)',
        },
      },
      required: ['workspace', 'repository'],
    },
  },
  {
    name: 'delete_branch',
    description: 'Delete a branch',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: {
          type: 'string',
          description: 'Bitbucket workspace/project key (e.g., "PROJ")',
        },
        repository: {
          type: 'string',
          description: 'Repository slug (e.g., "my-repo")',
        },
        branch_name: {
          type: 'string',
          description: 'Branch name to delete',
        },
        force: {
          type: 'boolean',
          description: 'Force delete even if branch is not merged (optional, default: false)',
        },
      },
      required: ['workspace', 'repository', 'branch_name'],
    },
  },
  {
    name: 'get_pull_request_diff',
    description: 'Get the diff/changes for a pull request with structured line-by-line information. Returns files with hunks containing individual lines, each with source_line (line number in old file), destination_line (line number in new file), type (ADDED/REMOVED/CONTEXT), and content. For adding inline comments: use destination_line with line_type ADDED or CONTEXT, use source_line with line_type REMOVED.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: {
          type: 'string',
          description: 'Bitbucket workspace/project key (e.g., "PROJ")',
        },
        repository: {
          type: 'string',
          description: 'Repository slug (e.g., "my-repo")',
        },
        pull_request_id: {
          type: 'number',
          description: 'Pull request ID',
        },
        context_lines: {
          type: 'number',
          description: 'Number of context lines around changes (optional, default: 3)',
        },
        include_patterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of glob patterns to include (e.g., ["*.res", "src/**/*.js"]) (optional)',
        },
        exclude_patterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of glob patterns to exclude (e.g., ["*.lock", "*.svg"]) (optional)',
        },
        file_path: {
          type: 'string',
          description: 'Specific file path to get diff for (e.g., "src/index.ts") (optional)',
        },
      },
      required: ['workspace', 'repository', 'pull_request_id'],
    },
  },
  {
    name: 'approve_pull_request',
    description: 'Approve a pull request',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: {
          type: 'string',
          description: 'Bitbucket workspace/project key (e.g., "PROJ")',
        },
        repository: {
          type: 'string',
          description: 'Repository slug (e.g., "my-repo")',
        },
        pull_request_id: {
          type: 'number',
          description: 'Pull request ID',
        },
      },
      required: ['workspace', 'repository', 'pull_request_id'],
    },
  },
  {
    name: 'unapprove_pull_request',
    description: 'Remove approval from a pull request',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: {
          type: 'string',
          description: 'Bitbucket workspace/project key (e.g., "PROJ")',
        },
        repository: {
          type: 'string',
          description: 'Repository slug (e.g., "my-repo")',
        },
        pull_request_id: {
          type: 'number',
          description: 'Pull request ID',
        },
      },
      required: ['workspace', 'repository', 'pull_request_id'],
    },
  },
  {
    name: 'request_changes',
    description: 'Request changes on a pull request',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: {
          type: 'string',
          description: 'Bitbucket workspace/project key (e.g., "PROJ")',
        },
        repository: {
          type: 'string',
          description: 'Repository slug (e.g., "my-repo")',
        },
        pull_request_id: {
          type: 'number',
          description: 'Pull request ID',
        },
        comment: {
          type: 'string',
          description: 'Comment explaining requested changes (optional)',
        },
      },
      required: ['workspace', 'repository', 'pull_request_id'],
    },
  },
  {
    name: 'remove_requested_changes',
    description: 'Remove change request from a pull request',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: {
          type: 'string',
          description: 'Bitbucket workspace/project key (e.g., "PROJ")',
        },
        repository: {
          type: 'string',
          description: 'Repository slug (e.g., "my-repo")',
        },
        pull_request_id: {
          type: 'number',
          description: 'Pull request ID',
        },
      },
      required: ['workspace', 'repository', 'pull_request_id'],
    },
  },
  {
    name: 'get_branch',
    description: 'Get detailed information about a branch including associated pull requests',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: {
          type: 'string',
          description: 'Bitbucket workspace/project key (e.g., "PROJ")',
        },
        repository: {
          type: 'string',
          description: 'Repository slug (e.g., "my-repo")',
        },
        branch_name: {
          type: 'string',
          description: 'Branch name to get details for',
        },
        include_merged_prs: {
          type: 'boolean',
          description: 'Include merged PRs from this branch (default: false)',
        },
      },
      required: ['workspace', 'repository', 'branch_name'],
    },
  },
  {
    name: 'list_directory_content',
    description: 'List files and directories in a repository path',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: {
          type: 'string',
          description: 'Bitbucket workspace/project key (e.g., "PROJ")',
        },
        repository: {
          type: 'string',
          description: 'Repository slug (e.g., "my-repo")',
        },
        path: {
          type: 'string',
          description: 'Directory path (optional, defaults to root, e.g., "src/components")',
        },
        branch: {
          type: 'string',
          description: 'Branch name (optional, defaults to default branch)',
        },
      },
      required: ['workspace', 'repository'],
    },
  },
  {
    name: 'get_file_content',
    description: 'Get file content from a repository with smart truncation for large files',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: {
          type: 'string',
          description: 'Bitbucket workspace/project key (e.g., "PROJ")',
        },
        repository: {
          type: 'string',
          description: 'Repository slug (e.g., "my-repo")',
        },
        file_path: {
          type: 'string',
          description: 'Path to the file (e.g., "src/index.ts")',
        },
        branch: {
          type: 'string',
          description: 'Branch name (optional, defaults to default branch)',
        },
        start_line: {
          type: 'number',
          description: 'Starting line number (1-based). Use negative for lines from end (optional)',
        },
        line_count: {
          type: 'number',
          description: 'Number of lines to return (optional, default varies by file size)',
        },
        full_content: {
          type: 'boolean',
          description: 'Force return full content regardless of size (optional, default: false)',
        },
      },
      required: ['workspace', 'repository', 'file_path'],
    },
  },
  {
    name: 'list_branch_commits',
    description: 'List commits in a branch with detailed information and filtering options',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: {
          type: 'string',
          description: 'Bitbucket workspace/project key (e.g., "PROJ")',
        },
        repository: {
          type: 'string',
          description: 'Repository slug (e.g., "my-repo")',
        },
        branch_name: {
          type: 'string',
          description: 'Branch name to get commits from',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of commits to return (default: 25)',
        },
        start: {
          type: 'number',
          description: 'Start index for pagination (default: 0)',
        },
        since: {
          type: 'string',
          description: 'ISO date string - only show commits after this date (optional)',
        },
        until: {
          type: 'string',
          description: 'ISO date string - only show commits before this date (optional)',
        },
        author: {
          type: 'string',
          description: 'Filter by author email/username (optional)',
        },
        include_merge_commits: {
          type: 'boolean',
          description: 'Include merge commits in results (default: true)',
        },
        search: {
          type: 'string',
          description: 'Search for text in commit messages (optional)',
        },
        include_build_status: {
          type: 'boolean',
          description: 'Include CI/CD build status for each commit (Bitbucket Server only, default: false)',
        },
      },
      required: ['workspace', 'repository', 'branch_name'],
    },
  },
  {
    name: 'list_pr_commits',
    description: 'List all commits that are part of a pull request',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: {
          type: 'string',
          description: 'Bitbucket workspace/project key (e.g., "PROJ")',
        },
        repository: {
          type: 'string',
          description: 'Repository slug (e.g., "my-repo")',
        },
        pull_request_id: {
          type: 'number',
          description: 'Pull request ID',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of commits to return (default: 25)',
        },
        start: {
          type: 'number',
          description: 'Start index for pagination (default: 0)',
        },
        include_build_status: {
          type: 'boolean',
          description: 'Include CI/CD build status for each commit (Bitbucket Server only, default: false)',
        },
      },
      required: ['workspace', 'repository', 'pull_request_id'],
    },
  },
  {
    name: 'search_code',
    description: 'Search for code across Bitbucket repositories with enhanced context-aware search patterns (currently only supported for Bitbucket Server)',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: {
          type: 'string',
          description: 'Bitbucket workspace/project key (e.g., "PROJ")',
        },
        repository: {
          type: 'string',
          description: 'Repository slug to search in (optional, searches all repos if not specified)',
        },
        search_query: {
          type: 'string',
          description: 'The search term or phrase to look for in code (e.g., "variable")',
        },
        search_context: {
          type: 'string',
          enum: ['assignment', 'declaration', 'usage', 'exact', 'any'],
          description: 'Context to search for: assignment (term=value), declaration (defining term), usage (calling/accessing term), exact (quoted match), or any (all patterns)',
        },
        file_pattern: {
          type: 'string',
          description: 'File path pattern to filter results (e.g., "*.java", "src/**/*.ts") (optional)',
        },
        include_patterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional custom search patterns to include (e.g., ["variable =", ".variable"]) (optional)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 25)',
        },
        start: {
          type: 'number',
          description: 'Start index for pagination (default: 0)',
        },
      },
      required: ['workspace', 'search_query'],
    },
  },
  {
    name: 'list_projects',
    description: 'List all accessible Bitbucket projects with optional filtering',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Filter by project name (partial match, optional)',
        },
        permission: {
          type: 'string',
          description: 'Filter by permission level (e.g., PROJECT_READ, PROJECT_WRITE, PROJECT_ADMIN, optional)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of projects to return (default: 25)',
        },
        start: {
          type: 'number',
          description: 'Start index for pagination (default: 0)',
        },
      },
      required: [],
    },
  },
  {
    name: 'list_repositories',
    description: 'List repositories in a project or across all accessible projects',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: {
          type: 'string',
          description: 'Bitbucket workspace/project key to filter repositories (optional, if not provided lists all accessible repos)',
        },
        name: {
          type: 'string',
          description: 'Filter by repository name (partial match, optional)',
        },
        permission: {
          type: 'string',
          description: 'Filter by permission level (e.g., REPO_READ, REPO_WRITE, REPO_ADMIN, optional)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of repositories to return (default: 25)',
        },
        start: {
          type: 'number',
          description: 'Start index for pagination (default: 0)',
        },
      },
      required: [],
    },
  },
];
