# Bitbucket MCP Server

[![npm version](https://badge.fury.io/js/@nexus2520%2Fbitbucket-mcp-server.svg)](https://www.npmjs.com/package/@nexus2520/bitbucket-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An MCP (Model Context Protocol) server that provides tools for interacting with the Bitbucket API, supporting both Bitbucket Cloud and Bitbucket Server.

## Features

### Currently Implemented Tools

#### Core PR Lifecycle Tools
- `get_pull_request` - Retrieve detailed information about a pull request
- `list_pull_requests` - List pull requests with filters (state, author, pagination)
- `create_pull_request` - Create new pull requests
- `update_pull_request` - Update PR details (title, description, reviewers, destination branch)
- `add_comment` - Add comments to pull requests (supports replies)
- `merge_pull_request` - Merge pull requests with various strategies
- `list_pr_commits` - List all commits that are part of a pull request
- `delete_branch` - Delete branches after merge

#### Branch Management Tools
- `list_branches` - List branches with filtering and pagination
- `delete_branch` - Delete branches (with protection checks)
- `get_branch` - Get detailed branch information including associated PRs
- `list_branch_commits` - List commits in a branch with advanced filtering

#### File and Directory Tools
- `list_directory_content` - List files and directories in a repository path
- `get_file_content` - Get file content with smart truncation for large files

#### Code Review Tools
- `get_pull_request_diff` - Get the diff/changes for a pull request
- `approve_pull_request` - Approve a pull request
- `unapprove_pull_request` - Remove approval from a pull request
- `request_changes` - Request changes on a pull request
- `remove_requested_changes` - Remove change request from a pull request

#### Search Tools
- `search_code` - Search for code across repositories (currently Bitbucket Server only)
- `search_repositories` - Search for repositories by name or description (Bitbucket Server only)

#### PR Lifecycle Management Tools
- `decline_pull_request` - Decline/reject a pull request
- `delete_comment` - Delete a comment from a pull request

#### PR Task Tools (Bitbucket Server only)
- `list_pr_tasks` - List all tasks (checklist items) on a pull request
- `create_pr_task` - Create a new task on a pull request
- `update_pr_task` - Update the text of an existing task
- `mark_pr_task_done` - Mark a task as done/resolved
- `unmark_pr_task_done` - Reopen a resolved task
- `delete_pr_task` - Delete a task from a pull request
- `convert_comment_to_task` - Convert an existing comment to a task
- `convert_task_to_comment` - Convert a task back to a regular comment

#### Project and Repository Discovery Tools
- `list_projects` - List all accessible Bitbucket projects/workspaces with filtering
- `list_repositories` - List repositories in a project or across all accessible projects

## Installation

### Using npx (Recommended)

The easiest way to use this MCP server is directly with npx:

```json
{
  "mcpServers": {
    "bitbucket": {
      "command": "npx",
      "args": [
        "-y",
        "@nexus2520/bitbucket-mcp-server"
      ],
      "env": {
        "BITBUCKET_USERNAME": "your-username",
        "BITBUCKET_APP_PASSWORD": "your-app-password"
      }
    }
  }
}
```

For Bitbucket Server:
```json
{
  "mcpServers": {
    "bitbucket": {
      "command": "npx",
      "args": [
        "-y",
        "@nexus2520/bitbucket-mcp-server"
      ],
      "env": {
        "BITBUCKET_USERNAME": "your.email@company.com",
        "BITBUCKET_TOKEN": "your-http-access-token",
        "BITBUCKET_BASE_URL": "https://bitbucket.yourcompany.com"
      }
    }
  }
}
```

### From Source

1. Clone or download this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the TypeScript code:
   ```bash
   npm run build
   ```

## Authentication Setup

This server uses Bitbucket App Passwords for authentication.

### Creating an App Password

1. Log in to your Bitbucket account
2. Navigate to: https://bitbucket.org/account/settings/app-passwords/
3. Click "Create app password"
4. Give it a descriptive label (e.g., "MCP Server")
5. Select the following permissions:
   - **Account**: Read
   - **Repositories**: Read, Write
   - **Pull requests**: Read, Write
6. Click "Create"
7. **Important**: Copy the generated password immediately (you won't be able to see it again!)

### Running the Setup Script

```bash
node scripts/setup-auth.js
```

This will guide you through the authentication setup process.

## Configuration

Add the server to your MCP settings file (usually located at `~/.vscode-server/data/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "bitbucket": {
      "command": "node",
      "args": ["/absolute/path/to/bitbucket-mcp-server/build/index.js"],
      "env": {
        "BITBUCKET_USERNAME": "your-username",
        "BITBUCKET_APP_PASSWORD": "your-app-password"
      }
    }
  }
}
```

Replace:
- `/absolute/path/to/bitbucket-mcp-server` with the actual path to this directory
- `your-username` with your Bitbucket username (not email)
- `your-app-password` with the app password you created

For Bitbucket Server, use:
```json
{
  "mcpServers": {
    "bitbucket": {
      "command": "node",
      "args": ["/absolute/path/to/bitbucket-mcp-server/build/index.js"],
      "env": {
        "BITBUCKET_USERNAME": "your.email@company.com",
        "BITBUCKET_TOKEN": "your-http-access-token",
        "BITBUCKET_BASE_URL": "https://bitbucket.yourcompany.com"
      }
    }
  }
}
```

**Important for Bitbucket Server users:**
- Use your full email address as the username (e.g., "john.doe@company.com")
- This is required for approval/review actions to work correctly

## Usage

Once configured, you can use the available tools:

### Get Pull Request

```typescript
{
  "tool": "get_pull_request",
  "arguments": {
    "workspace": "PROJ",  // Required - your project key
    "repository": "my-repo",
    "pull_request_id": 123
  }
}
```

Returns detailed information about the pull request including:
- Title and description
- Author and reviewers
- Source and destination branches
- Approval status
- Links to web UI and diff
- **Merge commit details** (when PR is merged):
  - `merge_commit_hash`: The hash of the merge commit
  - `merged_by`: Who performed the merge
  - `merged_at`: When the merge occurred
  - `merge_commit_message`: The merge commit message
- **Active comments with nested replies** (unresolved comments that need attention):
  - `active_comments`: Array of active comments (up to 20 most recent top-level comments)
    - Comment text and author
    - Creation date
    - Whether it's an inline comment (with file path and line number)
    - **Nested replies** (for Bitbucket Server):
      - `replies`: Array of reply comments with same structure
      - Replies can be nested multiple levels deep
    - **Parent reference** (for Bitbucket Cloud):
      - `parent_id`: ID of the parent comment for replies
  - `active_comment_count`: Total count of unresolved comments (including nested replies)
  - `total_comment_count`: Total count of all comments (including resolved and replies)
- **File changes**:
  - `file_changes`: Array of all files modified in the PR
    - File path
    - Status (added, modified, removed, or renamed)
    - Old path (for renamed files)
  - `file_changes_summary`: Summary statistics
    - Total files changed
- And more...

### Search Code

Search for code across Bitbucket repositories (currently only supported for Bitbucket Server):

```typescript
// Search in a specific repository
{
  "tool": "search_code",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "search_query": "TODO",
    "limit": 50
  }
}

// Search across all repositories in a workspace
{
  "tool": "search_code",
  "arguments": {
    "workspace": "PROJ",
    "search_query": "deprecated",
    "file_pattern": "*.java",  // Optional: filter by file pattern
    "limit": 100
  }
}

// Search with file pattern filtering
{
  "tool": "search_code",
  "arguments": {
    "workspace": "PROJ",
    "repository": "frontend-app",
    "search_query": "useState",
    "file_pattern": "*.tsx",  // Only search in .tsx files
    "start": 0,
    "limit": 25
  }
}
```

Returns search results with:
- File path and name
- Repository and project information
- Matched lines with:
  - Line number
  - Full line content
  - Highlighted segments showing exact matches
- Pagination information

Example response:
```json
{
  "message": "Code search completed successfully",
  "workspace": "PROJ",
  "repository": "my-repo",
  "search_query": "TODO",
  "results": [
    {
      "file_path": "src/utils/helper.js",
      "file_name": "helper.js",
      "repository": "my-repo",
      "project": "PROJ",
      "matches": [
        {
          "line_number": 42,
          "line_content": "    // TODO: Implement error handling",
          "highlighted_segments": [
            { "text": "    // ", "is_match": false },
            { "text": "TODO", "is_match": true },
            { "text": ": Implement error handling", "is_match": false }
          ]
        }
      ]
    }
  ],
  "total_count": 15,
  "start": 0,
  "limit": 50,
  "has_more": false
}
```

**Note**: This tool currently only works with Bitbucket Server. Bitbucket Cloud support is planned for a future release.

### List Pull Requests

```typescript
{
  "tool": "list_pull_requests",
  "arguments": {
    "workspace": "PROJ",  // Required - your project key
    "repository": "my-repo",
    "state": "OPEN",  // Optional: OPEN, MERGED, DECLINED, ALL (default: OPEN)
    "author": "username",  // Optional: filter by author (see note below)
    "limit": 25,  // Optional: max results per page (default: 25)
    "start": 0  // Optional: pagination start index (default: 0)
  }
}
```

Returns a paginated list of pull requests with:
- Array of pull requests with same details as get_pull_request
- Total count of matching PRs
- Pagination info (has_more, next_start)

**Note on Author Filter:**
- For Bitbucket Cloud: Use the username (e.g., "johndoe")
- For Bitbucket Server: Use the full email address (e.g., "john.doe@company.com")

### Create Pull Request

```typescript
{
  "tool": "create_pull_request",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "title": "Add new feature",
    "source_branch": "feature/new-feature",
    "destination_branch": "main",
    "description": "This PR adds a new feature...",  // Optional
    "reviewers": ["john.doe", "jane.smith"],  // Optional
    "close_source_branch": true  // Optional (default: false)
  }
}
```

### Update Pull Request

```typescript
{
  "tool": "update_pull_request",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123,
    "title": "Updated title",  // Optional
    "description": "Updated description",  // Optional
    "destination_branch": "develop",  // Optional
    "reviewers": ["new.reviewer"]  // Optional - see note below
  }
}
```

**Important Note on Reviewers:**
- When updating a PR without specifying the `reviewers` parameter, existing reviewers and their approval status are preserved
- When providing the `reviewers` parameter:
  - The reviewer list is replaced with the new list
  - For reviewers that already exist on the PR, their approval status is preserved
  - New reviewers are added without approval status
- This prevents accidentally removing reviewers when you only want to update the PR description or title

### Add Comment

Add a comment to a pull request, either as a general comment or inline on specific code:

```javascript
// General comment
{
  "tool": "add_comment",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123,
    "comment_text": "Great work on this PR!"
  }
}

// Inline comment on specific line
{
  "tool": "add_comment",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123,
    "comment_text": "Consider extracting this into a separate function",
    "file_path": "src/utils/helpers.js",
    "line_number": 42,
    "line_type": "CONTEXT"  // ADDED, REMOVED, or CONTEXT
  }
}

// Reply to existing comment
{
  "tool": "add_comment",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123,
    "comment_text": "I agree with this suggestion",
    "parent_comment_id": 456
  }
}

// Add comment with code suggestion (single line)
{
  "tool": "add_comment",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123,
    "comment_text": "This variable name could be more descriptive.",
    "file_path": "src/utils/helpers.js",
    "line_number": 42,
    "line_type": "CONTEXT",
    "suggestion": "const userAuthenticationToken = token;"
  }
}

// Add comment with multi-line code suggestion
{
  "tool": "add_comment",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123,
    "comment_text": "This function could be simplified using array methods.",
    "file_path": "src/utils/calculations.js",
    "line_number": 50,
    "suggestion_end_line": 55,
    "line_type": "CONTEXT",
    "suggestion": "function calculateTotal(items) {\n  return items.reduce((sum, item) => sum + item.price, 0);\n}"
  }
}
```

The suggestion feature formats comments using GitHub-style markdown suggestion blocks that Bitbucket can render. When adding a suggestion:
- `suggestion` is required and contains the replacement code
- `file_path` and `line_number` are required when using suggestions
- `suggestion_end_line` is optional and used for multi-line suggestions (defaults to `line_number`)
- The comment will be formatted with a ````suggestion` markdown block that may be applicable in the Bitbucket UI

### Using Code Snippets Instead of Line Numbers

The `add_comment` tool now supports finding line numbers automatically using code snippets. This is especially useful when AI tools analyze diffs and may struggle with exact line numbers:

```javascript
// Add comment using code snippet
{
  "tool": "add_comment",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123,
    "comment_text": "This variable name could be more descriptive",
    "file_path": "src/components/Button.res",
    "code_snippet": "let isDisabled = false",
    "search_context": {
      "before": ["let onClick = () => {"],
      "after": ["setLoading(true)"]
    }
  }
}

// Handle multiple matches with strategy
{
  "tool": "add_comment",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123,
    "comment_text": "Consider extracting this",
    "file_path": "src/utils/helpers.js",
    "code_snippet": "return result;",
    "search_context": {
      "before": ["const result = calculate();"],
      "after": ["}"]
    },
    "match_strategy": "best"  // Auto-select highest confidence match
  }
}
```

**Code Snippet Parameters:**
- `code_snippet`: The exact code line to find (alternative to `line_number`)
- `search_context`: Optional context to disambiguate multiple matches
  - `before`: Array of lines that should appear before the target
  - `after`: Array of lines that should appear after the target
- `match_strategy`: How to handle multiple matches
  - `"strict"` (default): Fail with error showing all matches
  - `"best"`: Auto-select the highest confidence match

**Error Response for Multiple Matches (strict mode):**
```json
{
  "error": {
    "code": "MULTIPLE_MATCHES_FOUND",
    "message": "Code snippet 'return result;' found in 3 locations",
    "occurrences": [
      {
        "line_number": 42,
        "file_path": "src/utils/helpers.js",
        "preview": "  const result = calculate();\n> return result;\n}",
        "confidence": 0.9,
        "line_type": "ADDED"
      },
      // ... more matches
    ],
    "suggestion": "To resolve, either:\n1. Add more context...\n2. Use match_strategy: 'best'...\n3. Use line_number directly"
  }
}
```

This feature is particularly useful for:
- AI-powered code review tools that analyze diffs
- Scripts that automatically add comments based on code patterns
- Avoiding line number confusion in large diffs

**Note on comment replies:**
- Use `parent_comment_id` to reply to any comment (general or inline)
- In `get_pull_request` responses:
  - Bitbucket Server shows replies nested in a `replies` array
  - Bitbucket Cloud shows a `parent_id` field for reply comments
- You can reply to replies, creating nested conversations

**Note on inline comments:**
- `file_path`: The path to the file as shown in the diff
- `line_number`: The line number as shown in the diff
- `line_type`: 
  - `ADDED` - For newly added lines (green in diff)
  - `REMOVED` - For deleted lines (red in diff)
  - `CONTEXT` - For unchanged context lines

#### Add Comment - Complete Usage Guide

The `add_comment` tool supports multiple scenarios. Here's when and how to use each approach:

**1. General PR Comments (No file/line)**
- Use when: Making overall feedback about the PR
- Required params: `comment_text` only
- Example: "LGTM!", "Please update the documentation"

**2. Reply to Existing Comments**
- Use when: Continuing a conversation thread
- Required params: `comment_text`, `parent_comment_id`
- Works for both general and inline comment replies

**3. Inline Comments with Line Number**
- Use when: You know the exact line number from the diff
- Required params: `comment_text`, `file_path`, `line_number`
- Optional: `line_type` (defaults to CONTEXT)

**4. Inline Comments with Code Snippet**
- Use when: You have the code but not the line number (common for AI tools)
- Required params: `comment_text`, `file_path`, `code_snippet`
- The tool will automatically find the line number
- Add `search_context` if the code appears multiple times
- Use `match_strategy: "best"` to auto-select when multiple matches exist

**5. Code Suggestions**
- Use when: Proposing specific code changes
- Required params: `comment_text`, `file_path`, `line_number`, `suggestion`
- For multi-line: also add `suggestion_end_line`
- Creates applicable suggestion blocks in Bitbucket UI

**Decision Flow for AI/Automated Tools:**
```
1. Do you want to suggest code changes?
   → Use suggestion with line_number
   
2. Do you have the exact line number?
   → Use line_number directly
   
3. Do you have the code snippet but not line number?
   → Use code_snippet (add search_context if needed)
   
4. Is it a general comment about the PR?
   → Use comment_text only
   
5. Are you replying to another comment?
   → Add parent_comment_id
```

**Common Pitfalls to Avoid:**
- Don't use both `line_number` and `code_snippet` - pick one
- Suggestions always need `file_path` and `line_number`
- Code snippets must match exactly (including whitespace)
- REMOVED lines reference the source file, ADDED/CONTEXT reference the destination

### Merge Pull Request

```typescript
{
  "tool": "merge_pull_request",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123,
    "merge_strategy": "squash",  // Optional: merge-commit, squash, fast-forward
    "close_source_branch": true,  // Optional
    "commit_message": "Custom merge message"  // Optional
  }
}
```

### List Branches

```typescript
{
  "tool": "list_branches",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "filter": "feature",  // Optional: filter by name pattern
    "limit": 25,  // Optional (default: 25)
    "start": 0  // Optional: for pagination (default: 0)
  }
}
```

Returns a paginated list of branches with:
- Branch name and ID
- Latest commit hash
- Default branch indicator
- Pagination info

### Delete Branch

```typescript
{
  "tool": "delete_branch",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "branch_name": "feature/old-feature",
    "force": false  // Optional (default: false)
  }
}
```

**Note**: Branch deletion requires appropriate permissions. The branch will be permanently deleted.

### Get Branch

```typescript
{
  "tool": "get_branch",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "branch_name": "feature/new-feature",
    "include_merged_prs": false  // Optional (default: false)
  }
}
```

Returns comprehensive branch information including:
- Branch details:
  - Name and ID
  - Latest commit (hash, message, author, date)
  - Default branch indicator
- Open pull requests from this branch:
  - PR title and ID
  - Destination branch
  - Author and reviewers
  - Approval status (approved by, changes requested by, pending)
  - PR URL
- Merged pull requests (if `include_merged_prs` is true):
  - PR title and ID
  - Merge date and who merged it
- Statistics:
  - Total open PRs count
  - Total merged PRs count
  - Days since last commit

This tool is particularly useful for:
- Checking if a branch has open PRs before deletion
- Getting an overview of branch activity
- Understanding PR review status
- Identifying stale branches

### List Branch Commits

Get all commits in a specific branch with advanced filtering options:

```typescript
// Basic usage - get recent commits
{
  "tool": "list_branch_commits",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "branch_name": "feature/new-feature",
    "limit": 50  // Optional (default: 25)
  }
}

// Filter by date range
{
  "tool": "list_branch_commits",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "branch_name": "main",
    "since": "2025-01-01T00:00:00Z",  // ISO date string
    "until": "2025-01-15T23:59:59Z"   // ISO date string
  }
}

// Filter by author
{
  "tool": "list_branch_commits",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "branch_name": "develop",
    "author": "john.doe@company.com",  // Email or username
    "limit": 100
  }
}

// Exclude merge commits
{
  "tool": "list_branch_commits",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "branch_name": "release/v2.0",
    "include_merge_commits": false
  }
}

// Search in commit messages
{
  "tool": "list_branch_commits",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "branch_name": "main",
    "search": "bugfix",  // Search in commit messages
    "limit": 50
  }
}

// Combine multiple filters
{
  "tool": "list_branch_commits",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "branch_name": "develop",
    "author": "jane.smith@company.com",
    "since": "2025-01-01T00:00:00Z",
    "include_merge_commits": false,
    "search": "feature",
    "limit": 100,
    "start": 0  // For pagination
  }
}

// Include CI/CD build status (Bitbucket Server only)
{
  "tool": "list_branch_commits",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "branch_name": "main",
    "include_build_status": true,  // Fetch build status for each commit
    "limit": 50
  }
}
```

**Filter Parameters:**
- `since`: ISO date string - only show commits after this date
- `until`: ISO date string - only show commits before this date
- `author`: Filter by author email/username
- `include_merge_commits`: Boolean to include/exclude merge commits (default: true)
- `search`: Search for text in commit messages
- `include_build_status`: Boolean to include CI/CD build status (default: false, Bitbucket Server only)

Returns detailed commit information:
```json
{
  "branch_name": "feature/new-feature",
  "branch_head": "abc123def456",  // Latest commit hash
  "commits": [
    {
      "hash": "abc123def456",
      "abbreviated_hash": "abc123d",
      "message": "Add new feature implementation",
      "author": {
        "name": "John Doe",
        "email": "john.doe@example.com"
      },
      "date": "2025-01-03T10:30:00Z",
      "parents": ["parent1hash", "parent2hash"],
      "is_merge_commit": false,
      "build_status": {  // Only present when include_build_status is true
        "successful": 5,
        "failed": 0,
        "in_progress": 1,
        "unknown": 0
      }
    }
    // ... more commits
  ],
  "total_count": 150,
  "start": 0,
  "limit": 25,
  "has_more": true,
  "next_start": 25,
  "filters_applied": {
    "author": "john.doe@example.com",
    "since": "2025-01-01",
    "include_merge_commits": false,
    "include_build_status": true
  }
}
```

This tool is particularly useful for:
- Reviewing commit history before releases
- Finding commits by specific authors
- Tracking changes within date ranges
- Searching for specific features or fixes
- Analyzing branch activity patterns
- Monitoring CI/CD build status for commits (Bitbucket Server only)

### List PR Commits

Get all commits that are part of a pull request:

```typescript
// Basic usage
{
  "tool": "list_pr_commits",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123,
    "limit": 50,  // Optional (default: 25)
    "start": 0    // Optional: for pagination
  }
}

// Include CI/CD build status (Bitbucket Server only)
{
  "tool": "list_pr_commits",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123,
    "include_build_status": true,  // Fetch build status for each commit
    "limit": 50
  }
}
```

Returns commit information for the PR:
```json
{
  "pull_request_id": 123,
  "pull_request_title": "Add awesome feature",
  "commits": [
    {
      "hash": "def456ghi789",
      "abbreviated_hash": "def456g",
      "message": "Initial implementation",
      "author": {
        "name": "Jane Smith",
        "email": "jane.smith@example.com"
      },
      "date": "2025-01-02T14:20:00Z",
      "parents": ["parent1hash"],
      "is_merge_commit": false,
      "build_status": {  // Only present when include_build_status is true
        "successful": 3,
        "failed": 0,
        "in_progress": 0,
        "unknown": 0
      }
    }
    // ... more commits
  ],
  "total_count": 5,
  "start": 0,
  "limit": 25,
  "has_more": false
}
```

This tool is particularly useful for:
- Reviewing all changes in a PR before merging
- Understanding the development history of a PR
- Checking commit messages for quality
- Verifying authorship of changes
- Analyzing PR complexity by commit count
- Monitoring CI/CD build status for all PR commits (Bitbucket Server only)

### Get Pull Request Diff

Get the diff/changes for a pull request with structured line-by-line information. Returns files with hunks containing individual lines, each with line numbers and type information for easy inline commenting.

```typescript
// Get full diff (default behavior)
{
  "tool": "get_pull_request_diff",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123,
    "context_lines": 5  // Optional (default: 3)
  }
}

// Exclude specific file types
{
  "tool": "get_pull_request_diff",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123,
    "exclude_patterns": ["*.lock", "*.svg", "node_modules/**", "*.min.js"]
  }
}

// Include only specific file types
{
  "tool": "get_pull_request_diff",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123,
    "include_patterns": ["*.res", "*.resi", "src/**/*.js"]
  }
}

// Get diff for a specific file only
{
  "tool": "get_pull_request_diff",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123,
    "file_path": "src/components/Button.res"
  }
}

// Combine filters
{
  "tool": "get_pull_request_diff",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123,
    "include_patterns": ["src/**/*"],
    "exclude_patterns": ["*.test.js", "*.spec.js"]
  }
}
```

**Filtering Options:**
- `include_patterns`: Array of glob patterns to include (whitelist)
- `exclude_patterns`: Array of glob patterns to exclude (blacklist)
- `file_path`: Get diff for a specific file only
- Patterns support standard glob syntax (e.g., `*.js`, `src/**/*.res`, `!test/**`)

**Structured Response Format (Bitbucket Server):**

The response includes structured line-by-line information with line numbers, making it easy for AI tools to add inline comments:

```json
{
  "message": "Pull request diff retrieved successfully",
  "pull_request_id": 123,
  "from_hash": "abc123...",
  "to_hash": "def456...",
  "files": [
    {
      "file_path": "src/components/Button.res",
      "old_path": null,
      "status": "modified",
      "hunks": [
        {
          "context": "let make = () => {",
          "source_start": 27,
          "source_span": 6,
          "destination_start": 27,
          "destination_span": 7,
          "lines": [
            {
              "source_line": 27,
              "destination_line": 27,
              "type": "CONTEXT",
              "content": "  let onClick = () => {"
            },
            {
              "source_line": 28,
              "destination_line": 28,
              "type": "CONTEXT",
              "content": "    setLoading(true)"
            },
            {
              "source_line": 29,
              "destination_line": 29,
              "type": "REMOVED",
              "content": "    oldFunction()"
            },
            {
              "source_line": 29,
              "destination_line": 29,
              "type": "ADDED",
              "content": "    newFunction()"
            },
            {
              "source_line": 30,
              "destination_line": 30,
              "type": "CONTEXT",
              "content": "  }"
            }
          ]
        }
      ]
    }
  ],
  "summary": {
    "total_files": 15,
    "files_included": 1,
    "files_excluded": 14
  },
  "filter_metadata": {
    "filters_applied": {
      "file_path": "src/components/Button.res"
    },
    "excluded_file_list": ["package-lock.json", "logo.svg"]
  }
}
```

**Line Types and Usage with `add_comment`:**

| Line Type | Description | Use with `add_comment` |
|-----------|-------------|------------------------|
| `ADDED` | New line (green in diff) | Use `destination_line` as `line_number`, `line_type: "ADDED"` |
| `REMOVED` | Deleted line (red in diff) | Use `source_line` as `line_number`, `line_type: "REMOVED"` |
| `CONTEXT` | Unchanged context line | Use `destination_line` as `line_number`, `line_type: "CONTEXT"` |

**Example: Adding an inline comment on an ADDED line:**
```typescript
// From the diff response, we see line 29 was added with content "    newFunction()"
{
  "tool": "add_comment",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123,
    "file_path": "src/components/Button.res",
    "line_number": 29,  // Use destination_line for ADDED
    "line_type": "ADDED",
    "comment_text": "Consider adding error handling here"
  }
}
```

**Note:** Bitbucket Cloud currently returns raw diff format. The structured format is available for Bitbucket Server only.

### Approve Pull Request

```typescript
{
  "tool": "approve_pull_request",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123
  }
}
```

### Request Changes

```typescript
{
  "tool": "request_changes",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123,
    "comment": "Please address the following issues..."  // Optional
  }
}
```

### List Directory Content

```typescript
{
  "tool": "list_directory_content",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "path": "src/components",  // Optional (defaults to root)
    "branch": "main"  // Optional (defaults to default branch)
  }
}
```

Returns directory listing with:
- Path and branch information
- Array of contents with:
  - Name
  - Type (file or directory)
  - Size (for files)
  - Full path
- Total items count

### Get File Content

```typescript
{
  "tool": "get_file_content",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "file_path": "src/index.ts",
    "branch": "main",  // Optional (defaults to default branch)
    "start_line": 1,  // Optional: starting line (1-based, use negative for from end)
    "line_count": 100,  // Optional: number of lines to return
    "full_content": false  // Optional: force full content (default: false)
  }
}
```

**Smart Truncation Features:**
- Automatically truncates large files (>50KB) to prevent token overload
- Default line counts based on file type:
  - Config files (.yml, .json): 200 lines
  - Documentation (.md, .txt): 300 lines
  - Code files (.ts, .js, .py): 500 lines
  - Log files: Last 100 lines
- Use `start_line: -50` to get last 50 lines (tail functionality)
- Files larger than 1MB require explicit `full_content: true` or line parameters

Returns file content with:
- File path and branch
- File size and encoding
- Content (full or truncated based on parameters)
- Line information (if truncated):
  - Total lines in file
  - Range of returned lines
  - Truncation indicator
- Last modified information (commit, author, date)

Example responses:

```json
// Small file - returns full content
{
  "file_path": "package.json",
  "branch": "main",
  "size": 1234,
  "encoding": "utf-8",
  "content": "{\n  \"name\": \"my-project\",\n  ...",
  "last_modified": {
    "commit_id": "abc123",
    "author": "John Doe",
    "date": "2025-01-21T10:00:00Z"
  }
}

// Large file - automatically truncated
{
  "file_path": "src/components/LargeComponent.tsx",
  "branch": "main",
  "size": 125000,
  "encoding": "utf-8",
  "content": "... first 500 lines ...",
  "line_info": {
    "total_lines": 3500,
    "returned_lines": {
      "start": 1,
      "end": 500
    },
    "truncated": true,
    "message": "Showing lines 1-500 of 3500. File size: 122.1KB"
  }
}
```

### List Projects

List all accessible Bitbucket projects (Server) or workspaces (Cloud):

```typescript
// List all accessible projects
{
  "tool": "list_projects",
  "arguments": {
    "limit": 25,  // Optional (default: 25)
    "start": 0    // Optional: for pagination (default: 0)
  }
}

// Filter by project name
{
  "tool": "list_projects",
  "arguments": {
    "name": "backend",  // Partial name match
    "limit": 50
  }
}

// Filter by permission level (Bitbucket Server only)
{
  "tool": "list_projects",
  "arguments": {
    "permission": "PROJECT_WRITE",  // PROJECT_READ, PROJECT_WRITE, PROJECT_ADMIN
    "limit": 100
  }
}
```

**Parameters:**
- `name`: Filter by project/workspace name (partial match, optional)
- `permission`: Filter by permission level (Bitbucket Server only, optional)
  - `PROJECT_READ`: Read access
  - `PROJECT_WRITE`: Write access
  - `PROJECT_ADMIN`: Admin access
- `limit`: Maximum number of projects to return (default: 25)
- `start`: Start index for pagination (default: 0)

Returns project/workspace information:
```json
{
  "projects": [
    {
      "key": "PROJ",
      "id": 1234,
      "name": "My Project",
      "description": "Project description",
      "is_public": false,
      "type": "NORMAL",  // NORMAL or PERSONAL (Server), WORKSPACE (Cloud)
      "url": "https://bitbucket.yourcompany.com/projects/PROJ"
    }
    // ... more projects
  ],
  "total_count": 15,
  "start": 0,
  "limit": 25,
  "has_more": false,
  "next_start": null
}
```

**Note**:
- For Bitbucket Cloud, this returns workspaces (not projects in the traditional sense)
- For Bitbucket Server, this returns both personal and team projects

This tool is particularly useful for:
- Discovering available projects/workspaces for your account
- Finding project keys needed for other API calls
- Identifying projects you have specific permissions on
- Browsing organizational structure

### List Repositories

List repositories within a specific project/workspace or across all accessible repositories:

```typescript
// List all repositories in a workspace/project
{
  "tool": "list_repositories",
  "arguments": {
    "workspace": "PROJ",  // Required for Bitbucket Cloud, optional for Server
    "limit": 25,          // Optional (default: 25)
    "start": 0            // Optional: for pagination (default: 0)
  }
}

// List all accessible repositories (Bitbucket Server only)
{
  "tool": "list_repositories",
  "arguments": {
    "limit": 100
  }
}

// Filter by repository name
{
  "tool": "list_repositories",
  "arguments": {
    "workspace": "PROJ",
    "name": "frontend",  // Partial name match
    "limit": 50
  }
}

// Filter by permission level (Bitbucket Server only)
{
  "tool": "list_repositories",
  "arguments": {
    "workspace": "PROJ",
    "permission": "REPO_WRITE",  // REPO_READ, REPO_WRITE, REPO_ADMIN
    "limit": 100
  }
}
```

**Parameters:**
- `workspace`: Project key (Server) or workspace slug (Cloud)
  - **Required for Bitbucket Cloud**
  - Optional for Bitbucket Server (omit to list all accessible repos)
- `name`: Filter by repository name (partial match, optional)
- `permission`: Filter by permission level (Bitbucket Server only, optional)
  - `REPO_READ`: Read access
  - `REPO_WRITE`: Write access
  - `REPO_ADMIN`: Admin access
- `limit`: Maximum number of repositories to return (default: 25)
- `start`: Start index for pagination (default: 0)

Returns repository information:
```json
{
  "repositories": [
    {
      "slug": "my-repo",
      "id": 5678,
      "name": "My Repository",
      "description": "Repository description",
      "project_key": "PROJ",
      "project_name": "My Project",
      "state": "AVAILABLE",  // AVAILABLE, INITIALISING, INITIALISATION_FAILED (Server)
      "is_public": false,
      "is_forkable": true,
      "clone_urls": {
        "http": "https://bitbucket.yourcompany.com/scm/PROJ/my-repo.git",
        "ssh": "ssh://git@bitbucket.yourcompany.com:7999/PROJ/my-repo.git"
      },
      "url": "https://bitbucket.yourcompany.com/projects/PROJ/repos/my-repo"
    }
    // ... more repositories
  ],
  "total_count": 42,
  "start": 0,
  "limit": 25,
  "has_more": true,
  "next_start": 25,
  "workspace": "PROJ"
}
```

**Important Notes:**
- **Bitbucket Cloud** requires the `workspace` parameter. If omitted, you'll receive an error message
- **Bitbucket Server** allows listing all accessible repos by omitting the `workspace` parameter
- Clone URLs are provided for both HTTP(S) and SSH protocols

This tool is particularly useful for:
- Discovering available repositories in a project/workspace
- Finding repository slugs needed for other API calls
- Identifying repositories you have specific permissions on
- Getting clone URLs for repositories
- Browsing repository structure within an organization

### Search Repositories

Search for repositories by name or description (Bitbucket Server only):

```typescript
// Basic search
{
  "tool": "search_repositories",
  "arguments": {
    "search_query": "backend",
    "limit": 10
  }
}

// Search within a specific project
{
  "tool": "search_repositories",
  "arguments": {
    "search_query": "dashboard",
    "workspace": "PROJ",
    "limit": 25
  }
}
```

Returns repository search results with project association.

### Decline Pull Request

Decline/reject a pull request:

```typescript
{
  "tool": "decline_pull_request",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123,
    "comment": "Closing this PR as the feature is no longer needed"  // Optional
  }
}
```

### Delete Comment

Delete a comment from a pull request:

```typescript
{
  "tool": "delete_comment",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123,
    "comment_id": 456
  }
}
```

**Note**: Comments with replies cannot be deleted. Only the comment author, PR author, or repository admin can delete comments.

### PR Task Management (Bitbucket Server only)

Tasks are checklist items that can be added to pull requests. They help track action items that need to be completed before merging.

#### List PR Tasks

```typescript
{
  "tool": "list_pr_tasks",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123
  }
}
```

Returns all tasks with their status:
```json
{
  "pull_request_id": 123,
  "tasks": [
    {
      "id": 456,
      "text": "Update documentation",
      "author": "John Doe",
      "state": "OPEN",
      "created_on": "2025-01-25T10:00:00Z",
      "is_resolved": false
    }
  ],
  "summary": {
    "total": 3,
    "open": 2,
    "resolved": 1
  }
}
```

#### Create PR Task

```typescript
{
  "tool": "create_pr_task",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123,
    "text": "Add unit tests for the new feature"
  }
}
```

#### Update PR Task

```typescript
{
  "tool": "update_pr_task",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123,
    "task_id": 456,
    "text": "Add unit tests and integration tests"
  }
}
```

#### Mark/Unmark Task as Done

```typescript
// Mark as done
{
  "tool": "mark_pr_task_done",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123,
    "task_id": 456
  }
}

// Reopen task
{
  "tool": "unmark_pr_task_done",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123,
    "task_id": 456
  }
}
```

#### Delete PR Task

```typescript
{
  "tool": "delete_pr_task",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123,
    "task_id": 456
  }
}
```

#### Convert Between Comments and Tasks

```typescript
// Convert a comment to a task
{
  "tool": "convert_comment_to_task",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123,
    "comment_id": 456
  }
}

// Convert a task back to a comment
{
  "tool": "convert_task_to_comment",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123,
    "task_id": 456
  }
}
```

**Note on Tasks:**
- Tasks are implemented as comments with `severity: "BLOCKER"` in Bitbucket Server
- Tasks can be in `OPEN` or `RESOLVED` state
- Only the task creator, PR author, or repository admin can edit text or delete tasks
- Anyone with read access can mark tasks as done/undone

## Development

- `npm run dev` - Watch mode for development
- `npm run build` - Build the TypeScript code
- `npm start` - Run the built server

## Troubleshooting

1. **Authentication errors**: Double-check your username and app password
2. **404 errors**: Verify the workspace, repository slug, and PR ID
3. **Permission errors**: Ensure your app password has the required permissions

## License

MIT
