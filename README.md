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
- `delete_branch` - Delete branches after merge

#### Branch Management Tools
- `list_branches` - List branches with filtering and pagination
- `delete_branch` - Delete branches (with protection checks)
- `get_branch` - Get detailed branch information including associated PRs

#### File and Directory Tools
- `list_directory_content` - List files and directories in a repository path
- `get_file_content` - Get file content with smart truncation for large files

#### Code Review Tools
- `get_pull_request_diff` - Get the diff/changes for a pull request
- `approve_pull_request` - Approve a pull request
- `unapprove_pull_request` - Remove approval from a pull request
- `request_changes` - Request changes on a pull request
- `remove_requested_changes` - Remove change request from a pull request

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
    "reviewers": ["new.reviewer"]  // Optional - replaces existing reviewers
  }
}
```

### Add Comment

Add general comments, reply to existing comments, or add inline comments on specific lines of code:

```typescript
// General comment
{
  "tool": "add_comment",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123,
    "comment_text": "Great work! Just one small suggestion..."
  }
}

// Reply to an existing comment
{
  "tool": "add_comment",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123,
    "comment_text": "Thanks for the feedback! I've updated the code.",
    "parent_comment_id": 456  // ID of the comment you're replying to
  }
}

// Inline comment on specific code
{
  "tool": "add_comment",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123,
    "comment_text": "This variable should be renamed for clarity",
    "file_path": "src/main.js",
    "line_number": 42,
    "line_type": "ADDED"  // ADDED, REMOVED, or CONTEXT
  }
}
```

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

### Get Pull Request Diff

Get the diff/changes for a pull request with optional filtering capabilities:

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

**Response includes filtering metadata:**
```json
{
  "message": "Pull request diff retrieved successfully",
  "pull_request_id": 123,
  "diff": "..filtered diff content..",
  "filter_metadata": {
    "total_files": 15,
    "included_files": 12,
    "excluded_files": 3,
    "excluded_file_list": ["package-lock.json", "logo.svg", "yarn.lock"],
    "filters_applied": {
      "exclude_patterns": ["*.lock", "*.svg"]
    }
  }
}
```

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
