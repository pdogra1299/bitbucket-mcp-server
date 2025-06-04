# Bitbucket MCP Server Setup Guide

## Step 1: Find Your Bitbucket Username

1. **Log in to Bitbucket**: Go to https://bitbucket.org and log in with your credentials

2. **Find your username**:
   - After logging in, click on your profile avatar in the top-right corner
   - Click on "Personal settings" or go directly to: https://bitbucket.org/account/settings/
   - Your username will be displayed at the top of the page
   - **Note**: Your username is NOT your email address. It's usually a shorter identifier like "johndoe" or "jdoe123"

## Step 2: Create an App Password

1. **Navigate to App Passwords**:
   - While logged in, go to: https://bitbucket.org/account/settings/app-passwords/
   - Or from your account settings, look for "App passwords" in the left sidebar under "Access management"

2. **Create a new app password**:
   - Click the "Create app password" button
   - Give it a descriptive label like "MCP Server" or "Bitbucket MCP Integration"
   
3. **Select permissions** (IMPORTANT - select these specific permissions):
   - ✅ **Account**: Read
   - ✅ **Repositories**: Read, Write
   - ✅ **Pull requests**: Read, Write
   - You can leave other permissions unchecked

4. **Generate the password**:
   - Click "Create"
   - **IMPORTANT**: Copy the generated password immediately! It will look something like: `ATBBxxxxxxxxxxxxxxxxxxxxx`
   - You won't be able to see this password again after closing the dialog

## Step 3: Find Your Workspace (Optional but Recommended)

Your workspace is the organization or team name in Bitbucket. To find it:

1. Look at any of your repository URLs:
   - Example: `https://bitbucket.org/mycompany/my-repo`
   - In this case, "mycompany" is your workspace

2. Or go to your workspace dashboard:
   - Click on "Workspaces" in the top navigation
   - Your workspaces will be listed there

## Example Credentials

Here's what your credentials should look like:

```
Username: johndoe              # Your Bitbucket username (NOT email)
App Password: ATBB3xXx...      # The generated app password
Workspace: mycompany           # Your organization/workspace name
```

## Common Issues

1. **"Username not found"**: Make sure you're using your Bitbucket username, not your email address
2. **"Invalid app password"**: Ensure you copied the entire app password including the "ATBB" prefix
3. **"Permission denied"**: Check that your app password has the required permissions (Account: Read, Repositories: Read/Write, Pull requests: Read/Write)

## Next Steps

Once you have these credentials, share them with me and I'll configure the MCP server for you. The credentials will be stored securely in your MCP settings configuration.
