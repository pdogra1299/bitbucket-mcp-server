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
    description: 'Update an existing pull request',
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
          description: 'New list of reviewer usernames/emails (optional)',
        },
      },
      required: ['workspace', 'repository', 'pull_request_id'],
    },
  },
  {
    name: 'add_comment',
    description: 'Add a comment to a pull request (general or inline on specific code)',
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
          description: 'Comment text',
        },
        parent_comment_id: {
          type: 'number',
          description: 'Parent comment ID for replies (optional)',
        },
        file_path: {
          type: 'string',
          description: 'File path for inline comment (optional, e.g., "src/main.js")',
        },
        line_number: {
          type: 'number',
          description: 'Line number for inline comment (optional, required with file_path)',
        },
        line_type: {
          type: 'string',
          description: 'Type of line for inline comment: ADDED, REMOVED, or CONTEXT (optional, default: CONTEXT)',
          enum: ['ADDED', 'REMOVED', 'CONTEXT'],
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
    description: 'Get the diff/changes for a pull request',
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
];
