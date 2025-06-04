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

class BitbucketMCPServer {
  private server: Server;
  private axiosInstance: AxiosInstance;
  private isServer: boolean;

  constructor() {
    this.isServer = !!BITBUCKET_TOKEN;
    
    this.server = new Server(
      {
        name: 'bitbucket-mcp-server',
        version: '0.1.0',
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
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        case 'get_pull_request':
          return this.handleGetPullRequest(request.params.arguments);
        case 'list_pull_requests':
          return this.handleListPullRequests(request.params.arguments);
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

        console.error(`[DEBUG] Fetching PR from: ${BITBUCKET_BASE_URL}${apiPath}`);
        
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

          console.error(`[DEBUG] API Error: ${status} - ${message}`);
          console.error(`[DEBUG] Full error response:`, error.response?.data);

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
          params['username'] = author;
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

      console.error(`[DEBUG] Listing PRs from: ${BITBUCKET_BASE_URL}${apiPath}`);
      console.error(`[DEBUG] Params:`, params);

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

        console.error(`[DEBUG] API Error: ${status} - ${message}`);
        console.error(`[DEBUG] Full error response:`, error.response?.data);

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

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(`Bitbucket MCP server running on stdio (${this.isServer ? 'Server' : 'Cloud'} mode)`);
  }
}

const server = new BitbucketMCPServer();
server.run().catch(console.error);
