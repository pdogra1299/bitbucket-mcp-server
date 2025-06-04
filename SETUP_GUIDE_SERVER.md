# Bitbucket Server MCP Setup Guide

Since you're using Bitbucket Server (self-hosted), you'll need to create an HTTP access token instead of an app password.

## Step 1: Your Username

Your Bitbucket Server username (not email address)

## Step 2: Create an HTTP Access Token

1. **Navigate to HTTP Access Tokens**:
   - You mentioned you can see "HTTP access tokens" in your account settings
   - Click on that option

2. **Create a new token**:
   - Click "Create token" or similar button
   - Give it a descriptive name like "MCP Server Integration"
   - Set an expiration date (or leave it without expiration if allowed)
   - Select the following permissions:
     - **Repository**: Read, Write
     - **Pull request**: Read, Write
     - **Project**: Read (if available)

3. **Generate and copy the token**:
   - Click "Create" or "Generate"
   - **IMPORTANT**: Copy the token immediately! It will look like a long string of random characters
   - You won't be able to see this token again

## Step 3: Find Your Bitbucket Server URL

Your Bitbucket Server URL is the base URL you use to access Bitbucket. For example:
- `https://bitbucket.yourcompany.com`
- `https://git.yourcompany.com`
- `https://bitbucket.internal.company.net`

## Step 4: Find Your Project/Workspace

In Bitbucket Server, repositories are organized by projects. Look at any repository URL:
- Example: `https://bitbucket.company.com/projects/PROJ/repos/my-repo`
- In this case, "PROJ" is your project key

## Example Configuration

For Bitbucket Server, your configuration will look like:

```
Username: your.username
Token: [Your HTTP access token]
Base URL: https://bitbucket.yourcompany.com
Project/Workspace: PROJ (or whatever your project key is)
```

## Next Steps

Once you have:
1. Your username
2. An HTTP access token from the "HTTP access tokens" section
3. Your Bitbucket Server base URL
4. Your project key

You can configure the MCP server for Bitbucket Server.
