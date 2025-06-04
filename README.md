# Bitbucket MCP Server

An MCP (Model Context Protocol) server that provides tools for interacting with the Bitbucket API.

## Features

Currently implemented:
- `get_pull_request` - Retrieve detailed information about a pull request
- `list_pull_requests` - List pull requests with filters (state, author, pagination)

Planned features:
- `create_pull_request` - Create new pull requests
- `update_pull_request` - Update PR details
- `merge_pull_request` - Merge pull requests
- `delete_branch` - Delete branches
- And more...

## Installation

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
        "BITBUCKET_USERNAME": "your-username",
        "BITBUCKET_TOKEN": "your-http-access-token",
        "BITBUCKET_BASE_URL": "https://bitbucket.yourcompany.com"
      }
    }
  }
}
```

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
    "author": "username",  // Optional: filter by author
    "limit": 25,  // Optional: max results per page (default: 25)
    "start": 0  // Optional: pagination start index (default: 0)
  }
}
```

Returns a paginated list of pull requests with:
- Array of pull requests with same details as get_pull_request
- Total count of matching PRs
- Pagination info (has_more, next_start)

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
