#!/usr/bin/env node

console.log(`
===========================================
Bitbucket MCP Server - Authentication Setup
===========================================

To use this MCP server, you need to create a Bitbucket App Password.

Follow these steps:

1. Log in to your Bitbucket account
2. Go to: https://bitbucket.org/account/settings/app-passwords/
3. Click "Create app password"
4. Give it a label (e.g., "MCP Server")
5. Select the following permissions:
   - Account: Read
   - Repositories: Read, Write
   - Pull requests: Read, Write
6. Click "Create"
7. Copy the generated app password (you won't be able to see it again!)

You'll need to provide:
- Your Bitbucket username (not email)
- The app password you just created
- Your default workspace/organization (optional)

Example workspace: If your repository URL is:
https://bitbucket.org/mycompany/my-repo
Then your workspace is: mycompany

These will be added to your MCP settings configuration.

Press Enter to continue...
`);

// Wait for user to press Enter
process.stdin.once('data', () => {
  console.log(`
Next steps:
1. The MCP server will be configured with your credentials
2. You'll be able to use the 'get_pull_request' tool
3. More tools can be added later (create_pull_request, list_pull_requests, etc.)

Configuration complete!
`);
  process.exit(0);
});
