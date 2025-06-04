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

Add general comments or inline comments on specific lines of code:

```typescript
// General comment
{
  "tool": "add_comment",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123,
    "comment_text": "Great work! Just one small suggestion...",
    "parent_comment_id": 456  // Optional - for replies
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

### Get Pull Request Diff

```typescript
{
  "tool": "get_pull_request_diff",
  "arguments": {
    "workspace": "PROJ",
    "repository": "my-repo",
    "pull_request_id": 123,
    "context_lines": 5  // Optional (default: 3)
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
