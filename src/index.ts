#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { BitbucketApiClient } from './utils/api-client.js';
import { PullRequestHandlers } from './handlers/pull-request-handlers.js';
import { BranchHandlers } from './handlers/branch-handlers.js';
import { ReviewHandlers } from './handlers/review-handlers.js';
import { FileHandlers } from './handlers/file-handlers.js';
import { SearchHandlers } from './handlers/search-handlers.js';
import { ProjectHandlers } from './handlers/project-handlers.js';
import { toolDefinitions, ToolGroup } from './tools/definitions.js';

// Get environment variables
const BITBUCKET_USERNAME = process.env.BITBUCKET_USERNAME;
const BITBUCKET_APP_PASSWORD = process.env.BITBUCKET_APP_PASSWORD;
const BITBUCKET_TOKEN = process.env.BITBUCKET_TOKEN; // For Bitbucket Server
const BITBUCKET_BASE_URL = process.env.BITBUCKET_BASE_URL || 'https://api.bitbucket.org/2.0';

// Optional: comma-separated list of tool groups to expose (e.g. "pr_core,pr_review,files")
const BITBUCKET_TOOL_GROUPS = process.env.BITBUCKET_TOOL_GROUPS
  ? new Set<ToolGroup>(process.env.BITBUCKET_TOOL_GROUPS.split(',').map(g => g.trim()) as ToolGroup[])
  : null;

// Check for either app password (Cloud) or token (Server)
if (!BITBUCKET_USERNAME || (!BITBUCKET_APP_PASSWORD && !BITBUCKET_TOKEN)) {
  console.error('Error: BITBUCKET_USERNAME and either BITBUCKET_APP_PASSWORD (for Cloud) or BITBUCKET_TOKEN (for Server) are required');
  console.error('Please set these in your MCP settings configuration');
  process.exit(1);
}

class BitbucketMCPServer {
  private server: Server;
  private apiClient: BitbucketApiClient;
  private pullRequestHandlers: PullRequestHandlers;
  private branchHandlers: BranchHandlers;
  private reviewHandlers: ReviewHandlers;
  private fileHandlers: FileHandlers;
  private searchHandlers: SearchHandlers;
  private projectHandlers: ProjectHandlers;

  constructor() {
    this.server = new Server(
      {
        name: 'bitbucket-mcp-server',
        version: '2.0.1',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Initialize API client
    this.apiClient = new BitbucketApiClient(
      BITBUCKET_BASE_URL,
      BITBUCKET_USERNAME!,
      BITBUCKET_APP_PASSWORD,
      BITBUCKET_TOKEN
    );

    // Initialize handlers
    this.pullRequestHandlers = new PullRequestHandlers(
      this.apiClient,
      BITBUCKET_BASE_URL,
      BITBUCKET_USERNAME!
    );
    this.branchHandlers = new BranchHandlers(this.apiClient, BITBUCKET_BASE_URL);
    this.reviewHandlers = new ReviewHandlers(this.apiClient, BITBUCKET_USERNAME!);
    this.fileHandlers = new FileHandlers(this.apiClient, BITBUCKET_BASE_URL);
    this.searchHandlers = new SearchHandlers(this.apiClient, BITBUCKET_BASE_URL);
    this.projectHandlers = new ProjectHandlers(this.apiClient, BITBUCKET_BASE_URL);

    this.setupToolHandlers();

    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    // List available tools — filter by platform and enabled groups
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const isServer = this.apiClient.getIsServer();
      const tools = toolDefinitions.filter(tool => {
        // Hide server-only tools when running against Bitbucket Cloud
        if (tool.availability === 'server_only' && !isServer) return false;
        // Hide tools not in the enabled groups when BITBUCKET_TOOL_GROUPS is set
        if (BITBUCKET_TOOL_GROUPS && !BITBUCKET_TOOL_GROUPS.has(tool.group)) return false;
        return true;
      });
      // Strip internal metadata before sending to MCP client
      return {
        tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        // Pull Request tools
        case 'get_pull_request':
          return this.pullRequestHandlers.handleGetPullRequest(request.params.arguments);
        case 'list_pull_requests':
          return this.pullRequestHandlers.handleListPullRequests(request.params.arguments);
        case 'create_pull_request':
          return this.pullRequestHandlers.handleCreatePullRequest(request.params.arguments);
        case 'update_pull_request':
          return this.pullRequestHandlers.handleUpdatePullRequest(request.params.arguments);
        case 'add_comment':
          return this.pullRequestHandlers.handleAddComment(request.params.arguments);
        case 'merge_pull_request':
          return this.pullRequestHandlers.handleMergePullRequest(request.params.arguments);
        case 'list_pr_commits':
          return this.pullRequestHandlers.handleListPrCommits(request.params.arguments);
        case 'decline_pull_request':
          return this.pullRequestHandlers.handleDeclinePullRequest(request.params.arguments);
        case 'delete_comment':
          return this.pullRequestHandlers.handleDeleteComment(request.params.arguments);

        // PR Task tools
        case 'list_pr_tasks':
          return this.pullRequestHandlers.handleListPrTasks(request.params.arguments);
        case 'create_pr_task':
          return this.pullRequestHandlers.handleCreatePrTask(request.params.arguments);
        case 'update_pr_task':
          return this.pullRequestHandlers.handleUpdatePrTask(request.params.arguments);
        case 'set_pr_task_status':
          return this.pullRequestHandlers.handleSetPrTaskStatus(request.params.arguments);
        case 'delete_pr_task':
          return this.pullRequestHandlers.handleDeletePrTask(request.params.arguments);
        case 'convert_pr_item':
          return this.pullRequestHandlers.handleConvertPrItem(request.params.arguments);

        // Branch tools
        case 'list_branches':
          return this.branchHandlers.handleListBranches(request.params.arguments);
        case 'delete_branch':
          return this.branchHandlers.handleDeleteBranch(request.params.arguments);
        case 'get_branch':
          return this.branchHandlers.handleGetBranch(request.params.arguments);
        case 'list_branch_commits':
          return this.branchHandlers.handleListBranchCommits(request.params.arguments);
        
        // Code Review tools
        case 'get_pull_request_diff':
          return this.reviewHandlers.handleGetPullRequestDiff(request.params.arguments);
        case 'set_pr_approval':
          return this.reviewHandlers.handleSetPrApproval(request.params.arguments);
        case 'set_review_status':
          return this.reviewHandlers.handleSetReviewStatus(request.params.arguments);
        
        // File tools
        case 'list_directory_content':
          return this.fileHandlers.handleListDirectoryContent(request.params.arguments);
        case 'get_file_content':
          return this.fileHandlers.handleGetFileContent(request.params.arguments);
        case 'search_files':
          return this.fileHandlers.handleSearchFiles(request.params.arguments);
        
        // Search tools
        case 'search_code':
          return this.searchHandlers.handleSearchCode(request.params.arguments);
        case 'search_repositories':
          return this.searchHandlers.handleSearchRepositories(request.params.arguments);

        // Project tools
        case 'list_projects':
          return this.projectHandlers.handleListProjects(request.params.arguments);
        case 'list_repositories':
          return this.projectHandlers.handleListRepositories(request.params.arguments);

        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(`Bitbucket MCP server running on stdio (${this.apiClient.getIsServer() ? 'Server' : 'Cloud'} mode)`);
  }
}

const server = new BitbucketMCPServer();
server.run().catch(console.error);
