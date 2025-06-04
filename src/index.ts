#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import axios, { AxiosInstance } from 'axios';

// Get environment variables
const BITBUCKET_USERNAME = process.env.BITBUCKET_USERNAME;
const BITBUCKET_APP_PASSWORD = process.env.BITBUCKET_APP_PASSWORD;
const BITBUCKET_TOKEN = process.env.BITBUCKET_TOKEN; // For Bitbucket Server
const BITBUCKET_WORKSPACE = process.env.BITBUCKET_WORKSPACE;
const BITBUCKET_BASE_URL = process.env.BITBUCKET_BASE_URL || 'https://api.bitbucket.org/2.0';

// Check for either app password (Cloud) or token (Server)
if (!BITBUCKET_USERNAME || (!BITBUCKET_APP_PASSWORD && !BITBUCKET_TOKEN)) {
  console.error('Error: BITBUCKET_USERNAME and either BITBUCKET_APP_PASSWORD (for Cloud) or BITBUCKET_TOKEN (for Server) are required');
  console.error('Please set these in your MCP settings configuration');
  process.exit(1);
}

// Note: BITBUCKET_WORKSPACE is optional - it should be passed when invoking the tool

// Bitbucket Server API response types
interface BitbucketServerPullRequest {
  id: number;
  version: number;
  title: string;
  description?: string;
  state: string;
  open: boolean;
  closed: boolean;
  createdDate: number;
  updatedDate: number;
  fromRef: {
    id: string;
    displayId: string;
    latestCommit: string;
    repository: {
      slug: string;
      name: string;
      project: {
        key: string;
      };
    };
  };
  toRef: {
    id: string;
    displayId: string;
    latestCommit: string;
    repository: {
      slug: string;
      name: string;
      project: {
        key: string;
      };
    };
  };
  locked: boolean;
  author: {
    user: {
      name: string;
      emailAddress: string;
      displayName: string;
    };
    role: string;
    approved: boolean;
    status: string;
  };
  reviewers: Array<{
    user: {
      name: string;
      emailAddress: string;
      displayName: string;
    };
    role: string;
    approved: boolean;
    status: string;
  }>;
  participants: Array<{
    user: {
      name: string;
      emailAddress: string;
      displayName: string;
    };
    role: string;
    approved: boolean;
    status: string;
  }>;
  links: {
    self: Array<{
      href: string;
    }>;
  };
}

// Bitbucket Cloud API response types (keeping for compatibility)
interface BitbucketCloudPullRequest {
  id: number;
  title: string;
  description: string;
  state: string;
  author: {
    display_name: string;
    account_id: string;
  };
  source: {
    branch: {
      name: string;
    };
    repository: {
      full_name: string;
    };
  };
  destination: {
    branch: {
      name: string;
    };
    repository: {
      full_name: string;
    };
  };
  reviewers: Array<{
    display_name: string;
    account_id: string;
  }>;
  participants: Array<{
    user: {
      display_name: string;
      account_id: string;
    };
    role: string;
    approved: boolean;
  }>;
  created_on: string;
  updated_on: string;
  links: {
    html: {
      href: string;
    };
    self: {
      href: string;
    };
    diff: {
      href: string;
    };
  };
  merge_commit?: {
    hash: string;
  };
  close_source_branch: boolean;
  closed_by?: {
    display_name: string;
    account_id: string;
  };
}

// Type guard for tool arguments
const isGetPullRequestArgs = (
  args: any
): args is { workspace: string; repository: string; pull_request_id: number } =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.workspace === 'string' &&
  typeof args.repository === 'string' &&
  typeof args.pull_request_id === 'number';

const isListPullRequestsArgs = (
  args: any
): args is { 
  workspace: string; 
  repository: string; 
  state?: string; 
  author?: string;
  limit?: number;
  start?: number;
} =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.workspace === 'string' &&
  typeof args.repository === 'string' &&
  (args.state === undefined || typeof args.state === 'string') &&
  (args.author === undefined || typeof args.author === 'string') &&
  (args.limit === undefined || typeof args.limit === 'number') &&
  (args.start === undefined || typeof args.start === 'number');

// Type guards for new tools
const isCreatePullRequestArgs = (
  args: any
): args is {
  workspace: string;
  repository: string;
  title: string;
  source_branch: string;
  destination_branch: string;
  description?: string;
  reviewers?: string[];
  close_source_branch?: boolean;
} =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.workspace === 'string' &&
  typeof args.repository === 'string' &&
  typeof args.title === 'string' &&
  typeof args.source_branch === 'string' &&
  typeof args.destination_branch === 'string' &&
  (args.description === undefined || typeof args.description === 'string') &&
  (args.reviewers === undefined || Array.isArray(args.reviewers)) &&
  (args.close_source_branch === undefined || typeof args.close_source_branch === 'boolean');

const isUpdatePullRequestArgs = (
  args: any
): args is {
  workspace: string;
  repository: string;
  pull_request_id: number;
  title?: string;
  description?: string;
  destination_branch?: string;
  reviewers?: string[];
} =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.workspace === 'string' &&
  typeof args.repository === 'string' &&
  typeof args.pull_request_id === 'number' &&
  (args.title === undefined || typeof args.title === 'string') &&
  (args.description === undefined || typeof args.description === 'string') &&
  (args.destination_branch === undefined || typeof args.destination_branch === 'string') &&
  (args.reviewers === undefined || Array.isArray(args.reviewers));

const isAddCommentArgs = (
  args: any
): args is {
  workspace: string;
  repository: string;
  pull_request_id: number;
  comment_text: string;
  parent_comment_id?: number;
  file_path?: string;
  line_number?: number;
  line_type?: 'ADDED' | 'REMOVED' | 'CONTEXT';
} =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.workspace === 'string' &&
  typeof args.repository === 'string' &&
  typeof args.pull_request_id === 'number' &&
  typeof args.comment_text === 'string' &&
  (args.parent_comment_id === undefined || typeof args.parent_comment_id === 'number') &&
  (args.file_path === undefined || typeof args.file_path === 'string') &&
  (args.line_number === undefined || typeof args.line_number === 'number') &&
  (args.line_type === undefined || ['ADDED', 'REMOVED', 'CONTEXT'].includes(args.line_type));

const isMergePullRequestArgs = (
  args: any
): args is {
  workspace: string;
  repository: string;
  pull_request_id: number;
  merge_strategy?: string;
  close_source_branch?: boolean;
  commit_message?: string;
} =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.workspace === 'string' &&
  typeof args.repository === 'string' &&
  typeof args.pull_request_id === 'number' &&
  (args.merge_strategy === undefined || typeof args.merge_strategy === 'string') &&
  (args.close_source_branch === undefined || typeof args.close_source_branch === 'boolean') &&
  (args.commit_message === undefined || typeof args.commit_message === 'string');

const isDeleteBranchArgs = (
  args: any
): args is {
  workspace: string;
  repository: string;
  branch_name: string;
  force?: boolean;
} =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.workspace === 'string' &&
  typeof args.repository === 'string' &&
  typeof args.branch_name === 'string' &&
  (args.force === undefined || typeof args.force === 'boolean');

const isListBranchesArgs = (
  args: any
): args is {
  workspace: string;
  repository: string;
  filter?: string;
  limit?: number;
  start?: number;
} =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.workspace === 'string' &&
  typeof args.repository === 'string' &&
  (args.filter === undefined || typeof args.filter === 'string') &&
  (args.limit === undefined || typeof args.limit === 'number') &&
  (args.start === undefined || typeof args.start === 'number');

const isGetPullRequestDiffArgs = (
  args: any
): args is {
  workspace: string;
  repository: string;
  pull_request_id: number;
  context_lines?: number;
} =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.workspace === 'string' &&
  typeof args.repository === 'string' &&
  typeof args.pull_request_id === 'number' &&
  (args.context_lines === undefined || typeof args.context_lines === 'number');

const isApprovePullRequestArgs = (
  args: any
): args is {
  workspace: string;
  repository: string;
  pull_request_id: number;
} =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.workspace === 'string' &&
  typeof args.repository === 'string' &&
  typeof args.pull_request_id === 'number';

const isRequestChangesArgs = (
  args: any
): args is {
  workspace: string;
  repository: string;
  pull_request_id: number;
  comment?: string;
} =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.workspace === 'string' &&
  typeof args.repository === 'string' &&
  typeof args.pull_request_id === 'number' &&
  (args.comment === undefined || typeof args.comment === 'string');

class BitbucketMCPServer {
  private server: Server;
  private axiosInstance: AxiosInstance;
  private isServer: boolean;

  constructor() {
    this.isServer = !!BITBUCKET_TOKEN;
    
    this.server = new Server(
      {
        name: 'bitbucket-mcp-server',
        version: '0.2.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Create axios instance with appropriate auth
    const axiosConfig: any = {
      baseURL: BITBUCKET_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    // Use token auth for Bitbucket Server, basic auth for Cloud
    if (BITBUCKET_TOKEN) {
      // Bitbucket Server uses Bearer token
      axiosConfig.headers['Authorization'] = `Bearer ${BITBUCKET_TOKEN}`;
    } else {
      // Bitbucket Cloud uses basic auth with app password
      axiosConfig.auth = {
        username: BITBUCKET_USERNAME!,
        password: BITBUCKET_APP_PASSWORD!,
      };
    }

    this.axiosInstance = axios.create(axiosConfig);

    this.setupToolHandlers();

    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  // Helper method to build API paths
  private buildApiPath(template: string, params: Record<string, string>): string {
    let path = template;
    for (const [key, value] of Object.entries(params)) {
      path = path.replace(`{${key}}`, value);
    }
    return path;
  }

  // Helper method to make API requests with consistent error handling
  private async makeApiRequest<T>(
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
    data?: any,
    config?: any
  ): Promise<T> {
    try {
      const response = await this.axiosInstance[method](path, data, config);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const message = error.response?.data?.errors?.[0]?.message || 
                       error.response?.data?.error?.message || 
                       error.response?.data?.message ||
                       error.message;

        throw {
          status,
          message,
          isAxiosError: true,
          originalError: error
        };
      }
      throw error;
    }
  }

  // Helper method to handle API errors consistently
  private handleApiError(error: any, context: string) {
    if (error.isAxiosError) {
      const { status, message } = error;

      if (status === 404) {
        return {
          content: [
            {
              type: 'text',
              text: `Not found: ${context}`,
            },
          ],
          isError: true,
        };
      } else if (status === 401) {
        return {
          content: [
            {
              type: 'text',
              text: `Authentication failed. Please check your ${this.isServer ? 'BITBUCKET_TOKEN' : 'BITBUCKET_USERNAME and BITBUCKET_APP_PASSWORD'}`,
            },
          ],
          isError: true,
        };
      } else if (status === 403) {
        return {
          content: [
            {
              type: 'text',
              text: `Permission denied: ${context}. Ensure your credentials have the necessary permissions.`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `Bitbucket API error: ${message}`,
          },
        ],
        isError: true,
      };
    }
    throw error;
  }

  private formatServerResponse(pr: BitbucketServerPullRequest): any {
    const webUrl = `${BITBUCKET_BASE_URL}/projects/${pr.toRef.repository.project.key}/repos/${pr.toRef.repository.slug}/pull-requests/${pr.id}`;
    
    return {
      id: pr.id,
      title: pr.title,
      description: pr.description || 'No description provided',
      state: pr.state,
      is_open: pr.open,
      is_closed: pr.closed,
      author: pr.author.user.displayName,
      author_username: pr.author.user.name,
      author_email: pr.author.user.emailAddress,
      source_branch: pr.fromRef.displayId,
      destination_branch: pr.toRef.displayId,
      source_commit: pr.fromRef.latestCommit,
      destination_commit: pr.toRef.latestCommit,
      reviewers: pr.reviewers.map(r => ({
        name: r.user.displayName,
        approved: r.approved,
        status: r.status,
      })),
      participants: pr.participants.map(p => ({
        name: p.user.displayName,
        role: p.role,
        approved: p.approved,
        status: p.status,
      })),
      created_on: new Date(pr.createdDate).toLocaleString(),
      updated_on: new Date(pr.updatedDate).toLocaleString(),
      web_url: webUrl,
      api_url: pr.links.self[0]?.href || '',
      is_locked: pr.locked,
    };
  }

  private formatCloudResponse(pr: BitbucketCloudPullRequest): any {
    return {
      id: pr.id,
      title: pr.title,
      description: pr.description || 'No description provided',
      state: pr.state,
      author: pr.author.display_name,
      source_branch: pr.source.branch.name,
      destination_branch: pr.destination.branch.name,
      reviewers: pr.reviewers.map(r => r.display_name),
      participants: pr.participants.map(p => ({
        name: p.user.display_name,
        role: p.role,
        approved: p.approved,
      })),
      created_on: new Date(pr.created_on).toLocaleString(),
      updated_on: new Date(pr.updated_on).toLocaleString(),
      web_url: pr.links.html.href,
      api_url: pr.links.self.href,
      diff_url: pr.links.diff.href,
      is_merged: pr.state === 'MERGED',
      merge_commit: pr.merge_commit?.hash,
      close_source_branch: pr.close_source_branch,
      closed_by: pr.closed_by?.display_name,
    };
  }

  private setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'get_pull_request',
          description: 'Get details of a Bitbucket pull request',
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
        // Phase 1: Core PR Lifecycle Tools
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
        // Phase 2: Code Review Tools
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
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        case 'get_pull_request':
          return this.handleGetPullRequest(request.params.arguments);
        case 'list_pull_requests':
          return this.handleListPullRequests(request.params.arguments);
        // Phase 1: Core PR Lifecycle Tools
        case 'create_pull_request':
          return this.handleCreatePullRequest(request.params.arguments);
        case 'update_pull_request':
          return this.handleUpdatePullRequest(request.params.arguments);
        case 'add_comment':
          return this.handleAddComment(request.params.arguments);
        case 'merge_pull_request':
          return this.handleMergePullRequest(request.params.arguments);
        case 'list_branches':
          return this.handleListBranches(request.params.arguments);
        case 'delete_branch':
          return this.handleDeleteBranch(request.params.arguments);
        // Phase 2: Code Review Tools
        case 'get_pull_request_diff':
          return this.handleGetPullRequestDiff(request.params.arguments);
        case 'approve_pull_request':
          return this.handleApprovePullRequest(request.params.arguments);
        case 'unapprove_pull_request':
          return this.handleUnapprovePullRequest(request.params.arguments);
        case 'request_changes':
          return this.handleRequestChanges(request.params.arguments);
        case 'remove_requested_changes':
          return this.handleRemoveRequestedChanges(request.params.arguments);
        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
  }

  private async handleGetPullRequest(args: any) {
    if (!isGetPullRequestArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for get_pull_request'
      );
    }

    const { workspace, repository, pull_request_id } = args;

      try {
        // Different API paths for Server vs Cloud
        const apiPath = this.isServer
          ? `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}`  // Server
          : `/repositories/${workspace}/${repository}/pullrequests/${pull_request_id}`;  // Cloud
        
        const response = await this.axiosInstance.get(apiPath);
        const pr = response.data;

        // Format the response based on server type
        const formattedResponse = this.isServer 
          ? this.formatServerResponse(pr as BitbucketServerPullRequest)
          : this.formatCloudResponse(pr as BitbucketCloudPullRequest);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(formattedResponse, null, 2),
            },
          ],
        };
      } catch (error) {
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          const message = error.response?.data?.errors?.[0]?.message || 
                         error.response?.data?.error?.message || 
                         error.response?.data?.message ||
                         error.message;

          if (status === 404) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Pull request not found: ${workspace}/${repository}/pull-requests/${pull_request_id}`,
                },
              ],
              isError: true,
            };
          } else if (status === 401) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Authentication failed. Please check your ${this.isServer ? 'BITBUCKET_TOKEN' : 'BITBUCKET_USERNAME and BITBUCKET_APP_PASSWORD'}`,
                },
              ],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: `Bitbucket API error: ${message}`,
              },
            ],
            isError: true,
          };
        }
        throw error;
      }
  }

  private async handleListPullRequests(args: any) {
    if (!isListPullRequestsArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for list_pull_requests'
      );
    }

    const { workspace, repository, state = 'OPEN', author, limit = 25, start = 0 } = args;

    try {
      let apiPath: string;
      let params: any = {};

      if (this.isServer) {
        // Bitbucket Server API
        apiPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests`;
        params = {
          state: state === 'ALL' ? undefined : state,
          limit,
          start,
        };
        if (author) {
          // Use role.1=AUTHOR and username.1=author to filter by author
          params['role.1'] = 'AUTHOR';
          params['username.1'] = author;
        }
      } else {
        // Bitbucket Cloud API
        apiPath = `/repositories/${workspace}/${repository}/pullrequests`;
        params = {
          state: state === 'ALL' ? undefined : state,
          pagelen: limit,
          page: Math.floor(start / limit) + 1,
        };
        if (author) {
          params['q'] = `author.username="${author}"`;
        }
      }

      const response = await this.axiosInstance.get(apiPath, { params });
      const data = response.data;

      // Format the response
      let pullRequests: any[] = [];
      let totalCount = 0;
      let nextPageStart = null;

      if (this.isServer) {
        // Bitbucket Server response
        pullRequests = (data.values || []).map((pr: BitbucketServerPullRequest) => 
          this.formatServerResponse(pr)
        );
        totalCount = data.size || 0;
        if (!data.isLastPage && data.nextPageStart !== undefined) {
          nextPageStart = data.nextPageStart;
        }
      } else {
        // Bitbucket Cloud response
        pullRequests = (data.values || []).map((pr: BitbucketCloudPullRequest) => 
          this.formatCloudResponse(pr)
        );
        totalCount = data.size || 0;
        if (data.next) {
          nextPageStart = start + limit;
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              pull_requests: pullRequests,
              total_count: totalCount,
              start,
              limit,
              has_more: nextPageStart !== null,
              next_start: nextPageStart,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const message = error.response?.data?.errors?.[0]?.message || 
                       error.response?.data?.error?.message || 
                       error.response?.data?.message ||
                       error.message;

        if (status === 404) {
          return {
            content: [
              {
                type: 'text',
                text: `Repository not found: ${workspace}/${repository}`,
              },
            ],
            isError: true,
          };
        } else if (status === 401) {
          return {
            content: [
              {
                type: 'text',
                text: `Authentication failed. Please check your ${this.isServer ? 'BITBUCKET_TOKEN' : 'BITBUCKET_USERNAME and BITBUCKET_APP_PASSWORD'}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: `Bitbucket API error: ${message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  }

  // Phase 1: Core PR Lifecycle Tools Implementation

  private async handleCreatePullRequest(args: any) {
    if (!isCreatePullRequestArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for create_pull_request'
      );
    }

    const { workspace, repository, title, source_branch, destination_branch, description, reviewers, close_source_branch } = args;

    try {
      let apiPath: string;
      let requestBody: any;

      if (this.isServer) {
        // Bitbucket Server API
        apiPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests`;
        requestBody = {
          title,
          description: description || '',
          fromRef: {
            id: `refs/heads/${source_branch}`,
            repository: {
              slug: repository,
              project: {
                key: workspace
              }
            }
          },
          toRef: {
            id: `refs/heads/${destination_branch}`,
            repository: {
              slug: repository,
              project: {
                key: workspace
              }
            }
          },
          reviewers: reviewers?.map(r => ({ user: { name: r } })) || []
        };
      } else {
        // Bitbucket Cloud API
        apiPath = `/repositories/${workspace}/${repository}/pullrequests`;
        requestBody = {
          title,
          description: description || '',
          source: {
            branch: {
              name: source_branch
            }
          },
          destination: {
            branch: {
              name: destination_branch
            }
          },
          close_source_branch: close_source_branch || false,
          reviewers: reviewers?.map(r => ({ username: r })) || []
        };
      }

      const pr = await this.makeApiRequest<any>('post', apiPath, requestBody);
      
      const formattedResponse = this.isServer 
        ? this.formatServerResponse(pr as BitbucketServerPullRequest)
        : this.formatCloudResponse(pr as BitbucketCloudPullRequest);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'Pull request created successfully',
              pull_request: formattedResponse
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.handleApiError(error, `creating pull request in ${workspace}/${repository}`);
    }
  }

  private async handleUpdatePullRequest(args: any) {
    if (!isUpdatePullRequestArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for update_pull_request'
      );
    }

    const { workspace, repository, pull_request_id, title, description, destination_branch, reviewers } = args;

    try {
      let apiPath: string;
      let requestBody: any = {};

      if (this.isServer) {
        // Bitbucket Server API
        apiPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}`;
        
        // First get the current PR to get version number
        const currentPr = await this.makeApiRequest<any>('get', apiPath);
        
        requestBody.version = currentPr.version;
        if (title !== undefined) requestBody.title = title;
        if (description !== undefined) requestBody.description = description;
        if (destination_branch !== undefined) {
          requestBody.toRef = {
            id: `refs/heads/${destination_branch}`,
            repository: {
              slug: repository,
              project: {
                key: workspace
              }
            }
          };
        }
        if (reviewers !== undefined) {
          requestBody.reviewers = reviewers.map(r => ({ user: { name: r } }));
        }
      } else {
        // Bitbucket Cloud API
        apiPath = `/repositories/${workspace}/${repository}/pullrequests/${pull_request_id}`;
        
        if (title !== undefined) requestBody.title = title;
        if (description !== undefined) requestBody.description = description;
        if (destination_branch !== undefined) {
          requestBody.destination = {
            branch: {
              name: destination_branch
            }
          };
        }
        if (reviewers !== undefined) {
          requestBody.reviewers = reviewers.map(r => ({ username: r }));
        }
      }

      const pr = await this.makeApiRequest<any>('put', apiPath, requestBody);
      
      const formattedResponse = this.isServer 
        ? this.formatServerResponse(pr as BitbucketServerPullRequest)
        : this.formatCloudResponse(pr as BitbucketCloudPullRequest);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'Pull request updated successfully',
              pull_request: formattedResponse
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.handleApiError(error, `updating pull request ${pull_request_id} in ${workspace}/${repository}`);
    }
  }

  private async handleAddComment(args: any) {
    if (!isAddCommentArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for add_comment'
      );
    }

    const { workspace, repository, pull_request_id, comment_text, parent_comment_id, file_path, line_number, line_type } = args;

    // Check if this is an inline comment
    const isInlineComment = file_path !== undefined && line_number !== undefined;

    try {
      let apiPath: string;
      let requestBody: any;

      if (this.isServer) {
        // Bitbucket Server API
        apiPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}/comments`;
        requestBody = {
          text: comment_text
        };
        
        if (parent_comment_id !== undefined) {
          requestBody.parent = { id: parent_comment_id };
        }
        
        // Add inline comment properties for Bitbucket Server
        if (isInlineComment) {
          // For inline comments, we need to specify the anchor
          requestBody.anchor = {
            line: line_number,
            lineType: line_type || 'CONTEXT',
            fileType: line_type === 'REMOVED' ? 'FROM' : 'TO', // FROM for removed lines, TO for added/context
            path: file_path,
            diffType: 'EFFECTIVE' // Required for Bitbucket Server
          };
        }
      } else {
        // Bitbucket Cloud API
        apiPath = `/repositories/${workspace}/${repository}/pullrequests/${pull_request_id}/comments`;
        requestBody = {
          content: {
            raw: comment_text
          }
        };
        
        if (parent_comment_id !== undefined) {
          requestBody.parent = { id: parent_comment_id };
        }
        
        // Add inline comment properties for Bitbucket Cloud
        if (isInlineComment) {
          requestBody.inline = {
            to: line_number,
            path: file_path
          };
        }
      }

      const comment = await this.makeApiRequest<any>('post', apiPath, requestBody);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: isInlineComment ? 'Inline comment added successfully' : 'Comment added successfully',
              comment: {
                id: comment.id,
                text: this.isServer ? comment.text : comment.content.raw,
                author: this.isServer ? comment.author.displayName : comment.user.display_name,
                created_on: this.isServer ? new Date(comment.createdDate).toLocaleString() : comment.created_on,
                file_path: isInlineComment ? file_path : undefined,
                line_number: isInlineComment ? line_number : undefined,
                line_type: isInlineComment ? (line_type || 'CONTEXT') : undefined
              }
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.handleApiError(error, `adding ${isInlineComment ? 'inline ' : ''}comment to pull request ${pull_request_id} in ${workspace}/${repository}`);
    }
  }

  private async handleMergePullRequest(args: any) {
    if (!isMergePullRequestArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for merge_pull_request'
      );
    }

    const { workspace, repository, pull_request_id, merge_strategy, close_source_branch, commit_message } = args;

    try {
      let apiPath: string;
      let requestBody: any = {};

      if (this.isServer) {
        // Bitbucket Server API
        apiPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}/merge`;
        
        // Get current PR version
        const prPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}`;
        const currentPr = await this.makeApiRequest<any>('get', prPath);
        
        requestBody.version = currentPr.version;
        if (commit_message) {
          requestBody.message = commit_message;
        }
      } else {
        // Bitbucket Cloud API
        apiPath = `/repositories/${workspace}/${repository}/pullrequests/${pull_request_id}/merge`;
        
        if (merge_strategy) {
          requestBody.merge_strategy = merge_strategy;
        }
        if (close_source_branch !== undefined) {
          requestBody.close_source_branch = close_source_branch;
        }
        if (commit_message) {
          requestBody.message = commit_message;
        }
      }

      const result = await this.makeApiRequest<any>('post', apiPath, requestBody);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'Pull request merged successfully',
              merge_commit: this.isServer ? result.properties?.mergeCommit : result.merge_commit?.hash,
              pull_request_id
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.handleApiError(error, `merging pull request ${pull_request_id} in ${workspace}/${repository}`);
    }
  }

  private async handleListBranches(args: any) {
    if (!isListBranchesArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for list_branches'
      );
    }

    const { workspace, repository, filter, limit = 25, start = 0 } = args;

    try {
      let apiPath: string;
      let params: any = {};

      if (this.isServer) {
        // Bitbucket Server API
        apiPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/branches`;
        params = {
          limit,
          start,
        };
        if (filter) {
          params.filterText = filter;
        }
      } else {
        // Bitbucket Cloud API
        apiPath = `/repositories/${workspace}/${repository}/refs/branches`;
        params = {
          pagelen: limit,
          page: Math.floor(start / limit) + 1,
        };
        if (filter) {
          params.q = `name ~ "${filter}"`;
        }
      }

      const response = await this.makeApiRequest<any>('get', apiPath, null, { params });
      const data = response;

      // Format the response
      let branches: any[] = [];
      let totalCount = 0;
      let nextPageStart = null;

      if (this.isServer) {
        // Bitbucket Server response
        branches = (data.values || []).map((branch: any) => ({
          name: branch.displayId,
          id: branch.id,
          latest_commit: branch.latestCommit,
          is_default: branch.isDefault || false
        }));
        totalCount = data.size || 0;
        if (!data.isLastPage && data.nextPageStart !== undefined) {
          nextPageStart = data.nextPageStart;
        }
      } else {
        // Bitbucket Cloud response
        branches = (data.values || []).map((branch: any) => ({
          name: branch.name,
          target: branch.target.hash,
          is_default: branch.name === 'main' || branch.name === 'master'
        }));
        totalCount = data.size || 0;
        if (data.next) {
          nextPageStart = start + limit;
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              branches,
              total_count: totalCount,
              start,
              limit,
              has_more: nextPageStart !== null,
              next_start: nextPageStart,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.handleApiError(error, `listing branches in ${workspace}/${repository}`);
    }
  }

  private async handleDeleteBranch(args: any) {
    if (!isDeleteBranchArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for delete_branch'
      );
    }

    const { workspace, repository, branch_name, force } = args;

    try {
      let apiPath: string;

      if (this.isServer) {
        // First, we need to get the branch details to find the latest commit
        const branchesPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/branches`;
        const branchesResponse = await this.makeApiRequest<any>('get', branchesPath, null, {
          params: {
            filterText: branch_name,
            limit: 100
          }
        });
        
        // Find the exact branch
        const branch = branchesResponse.values?.find((b: any) => b.displayId === branch_name);
        if (!branch) {
          throw new Error(`Branch '${branch_name}' not found`);
        }
        
        // Now delete using branch-utils endpoint with correct format
        apiPath = `/rest/branch-utils/latest/projects/${workspace}/repos/${repository}/branches`;
        
        try {
          await this.makeApiRequest<any>('delete', apiPath, {
            name: branch_name,
            endPoint: branch.latestCommit
          });
        } catch (deleteError: any) {
          // If the error is about empty response but status is 204 (No Content), it's successful
          if (deleteError.originalError?.response?.status === 204 || 
              deleteError.message?.includes('No content to map')) {
            // Branch was deleted successfully
          } else {
            throw deleteError;
          }
        }
      } else {
        // Bitbucket Cloud API
        apiPath = `/repositories/${workspace}/${repository}/refs/branches/${branch_name}`;
        try {
          await this.makeApiRequest<any>('delete', apiPath);
        } catch (deleteError: any) {
          // If the error is about empty response but status is 204 (No Content), it's successful
          if (deleteError.originalError?.response?.status === 204 || 
              deleteError.message?.includes('No content to map')) {
            // Branch was deleted successfully
          } else {
            throw deleteError;
          }
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: `Branch '${branch_name}' deleted successfully`,
              branch: branch_name,
              repository: `${workspace}/${repository}`
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.handleApiError(error, `deleting branch '${branch_name}' in ${workspace}/${repository}`);
    }
  }

  // Phase 2: Code Review Tools Implementation

  private async handleGetPullRequestDiff(args: any) {
    if (!isGetPullRequestDiffArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for get_pull_request_diff'
      );
    }

    const { workspace, repository, pull_request_id, context_lines = 3 } = args;

    try {
      let apiPath: string;
      let config: any = {};

      if (this.isServer) {
        // Bitbucket Server API
        apiPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}/diff`;
        config.params = { contextLines: context_lines };
      } else {
        // Bitbucket Cloud API
        apiPath = `/repositories/${workspace}/${repository}/pullrequests/${pull_request_id}/diff`;
        config.params = { context: context_lines };
      }

      // For diff, we want the raw text response
      config.headers = { 'Accept': 'text/plain' };
      
      const diff = await this.makeApiRequest<string>('get', apiPath, null, config);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'Pull request diff retrieved successfully',
              pull_request_id,
              diff: diff
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.handleApiError(error, `getting diff for pull request ${pull_request_id} in ${workspace}/${repository}`);
    }
  }

  private async handleApprovePullRequest(args: any) {
    if (!isApprovePullRequestArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for approve_pull_request'
      );
    }

    const { workspace, repository, pull_request_id } = args;

    try {
      let apiPath: string;

      if (this.isServer) {
        // Bitbucket Server API - use participants endpoint
        // Convert email format: @ to _ for the API
        const username = BITBUCKET_USERNAME!.replace('@', '_');
        apiPath = `/rest/api/latest/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}/participants/${username}`;
        await this.makeApiRequest<any>('put', apiPath, { status: 'APPROVED' });
      } else {
        // Bitbucket Cloud API
        apiPath = `/repositories/${workspace}/${repository}/pullrequests/${pull_request_id}/approve`;
        await this.makeApiRequest<any>('post', apiPath);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'Pull request approved successfully',
              pull_request_id,
              approved_by: BITBUCKET_USERNAME
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.handleApiError(error, `approving pull request ${pull_request_id} in ${workspace}/${repository}`);
    }
  }

  private async handleUnapprovePullRequest(args: any) {
    if (!isApprovePullRequestArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for unapprove_pull_request'
      );
    }

    const { workspace, repository, pull_request_id } = args;

    try {
      let apiPath: string;

      if (this.isServer) {
        // Bitbucket Server API - use participants endpoint
        const username = BITBUCKET_USERNAME!.replace('@', '_');
        apiPath = `/rest/api/latest/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}/participants/${username}`;
        await this.makeApiRequest<any>('put', apiPath, { status: 'UNAPPROVED' });
      } else {
        // Bitbucket Cloud API
        apiPath = `/repositories/${workspace}/${repository}/pullrequests/${pull_request_id}/approve`;
        await this.makeApiRequest<any>('delete', apiPath);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'Pull request approval removed successfully',
              pull_request_id,
              unapproved_by: BITBUCKET_USERNAME
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.handleApiError(error, `removing approval from pull request ${pull_request_id} in ${workspace}/${repository}`);
    }
  }

  private async handleRequestChanges(args: any) {
    if (!isRequestChangesArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for request_changes'
      );
    }

    const { workspace, repository, pull_request_id, comment } = args;

    try {
      if (this.isServer) {
        // Bitbucket Server API - use needs-work status
        const username = BITBUCKET_USERNAME!.replace('@', '_');
        const apiPath = `/rest/api/latest/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}/participants/${username}`;
        await this.makeApiRequest<any>('put', apiPath, { status: 'NEEDS_WORK' });
        
        // Add comment if provided
        if (comment) {
          await this.handleAddComment({
            workspace,
            repository,
            pull_request_id,
            comment_text: comment
          });
        }
      } else {
        // Bitbucket Cloud API - use request-changes status
        const apiPath = `/repositories/${workspace}/${repository}/pullrequests/${pull_request_id}/request-changes`;
        await this.makeApiRequest<any>('post', apiPath);
        
        // Add comment if provided
        if (comment) {
          await this.handleAddComment({
            workspace,
            repository,
            pull_request_id,
            comment_text: comment
          });
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'Changes requested on pull request',
              pull_request_id,
              requested_by: BITBUCKET_USERNAME,
              comment: comment || 'No comment provided'
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.handleApiError(error, `requesting changes on pull request ${pull_request_id} in ${workspace}/${repository}`);
    }
  }

  private async handleRemoveRequestedChanges(args: any) {
    if (!isApprovePullRequestArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for remove_requested_changes'
      );
    }

    const { workspace, repository, pull_request_id } = args;

    try {
      if (this.isServer) {
        // Bitbucket Server API - remove needs-work status
        const username = BITBUCKET_USERNAME!.replace('@', '_');
        const apiPath = `/rest/api/latest/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}/participants/${username}`;
        await this.makeApiRequest<any>('put', apiPath, { status: 'UNAPPROVED' });
      } else {
        // Bitbucket Cloud API
        const apiPath = `/repositories/${workspace}/${repository}/pullrequests/${pull_request_id}/request-changes`;
        await this.makeApiRequest<any>('delete', apiPath);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'Change request removed from pull request',
              pull_request_id,
              removed_by: BITBUCKET_USERNAME
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.handleApiError(error, `removing change request from pull request ${pull_request_id} in ${workspace}/${repository}`);
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(`Bitbucket MCP server running on stdio (${this.isServer ? 'Server' : 'Cloud'} mode)`);
  }
}

const server = new BitbucketMCPServer();
server.run().catch(console.error);
