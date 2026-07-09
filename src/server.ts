import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { BitbucketMcpConfig } from './types/index.js';
import { BitbucketApiClient } from './core/api-client.js';
import { RepoSnapshotStore } from './core/snapshot.js';
import { ToolRegistry } from './tools/registry.js';
import { toolDefinitions } from './tools/definitions.js';
import { PullRequestHandlers } from './handlers/pull-request-handlers.js';
import { BranchHandlers } from './handlers/branch-handlers.js';
import { ReviewHandlers } from './handlers/review-handlers.js';
import { FileHandlers } from './handlers/file-handlers.js';
import { SearchHandlers } from './handlers/search-handlers.js';
import { GrepHandlers } from './handlers/grep-handlers.js';
import { ProjectHandlers } from './handlers/project-handlers.js';
import { AttachmentHandlers } from './handlers/attachment-handlers.js';

export const SERVER_VERSION = '3.0.0';

export class BitbucketMcpServer {
  private server: Server;
  private apiClient: BitbucketApiClient;
  private registry: ToolRegistry;

  constructor(config: BitbucketMcpConfig) {
    this.server = new Server(
      { name: 'bitbucket-mcp-server', version: SERVER_VERSION },
      { capabilities: { tools: {} } }
    );

    this.apiClient = new BitbucketApiClient(config);
    const snapshots = new RepoSnapshotStore(this.apiClient);

    const pullRequests = new PullRequestHandlers(this.apiClient, config.auth.baseUrl);
    const reviews = new ReviewHandlers(this.apiClient, config.auth.username);
    const branches = new BranchHandlers(this.apiClient, config.auth.baseUrl, reviews);
    const files = new FileHandlers(this.apiClient);
    const search = new SearchHandlers(this.apiClient);
    const grep = new GrepHandlers(this.apiClient, snapshots);
    const projects = new ProjectHandlers(this.apiClient);
    const attachments = new AttachmentHandlers(this.apiClient);

    this.registry = new ToolRegistry(this.apiClient.getIsServer(), config.toolGroups);
    const handlers: Record<string, (args: any) => Promise<any>> = {
      get_pull_request: a => pullRequests.handleGetPullRequest(a),
      list_pull_requests: a => pullRequests.handleListPullRequests(a),
      create_pull_request: a => pullRequests.handleCreatePullRequest(a),
      update_pull_request: a => pullRequests.handleUpdatePullRequest(a),
      merge_pull_request: a => pullRequests.handleMergePullRequest(a),
      decline_pull_request: a => pullRequests.handleDeclinePullRequest(a),
      add_comment: a => pullRequests.handleAddComment(a),
      manage_comment: a => pullRequests.handleManageComment(a),
      list_pr_commits: a => pullRequests.handleListPrCommits(a),
      get_pull_request_diff: a => reviews.handleGetPullRequestDiff(a),
      set_review_status: a => reviews.handleSetReviewStatus(a),
      list_branch_commits: a => branches.handleListBranchCommits(a),
      get_commit_detail: a => branches.handleGetCommitDetail(a),
      list_branches: a => branches.handleListBranches(a),
      get_branch: a => branches.handleGetBranch(a),
      delete_branch: a => branches.handleDeleteBranch(a),
      list_directory_content: a => files.handleListDirectoryContent(a),
      get_file_content: a => files.handleGetFileContent(a),
      get_file_blame: a => files.handleGetFileBlame(a),
      grep: a => grep.handleGrep(a),
      search_code: a => search.handleSearchCode(a),
      search_repositories: a => search.handleSearchRepositories(a),
      manage_attachments: a => attachments.handleManageAttachments(a),
      list_projects: a => projects.handleListProjects(a),
      list_repositories: a => projects.handleListRepositories(a),
    };

    for (const definition of toolDefinitions) {
      const handler = handlers[definition.name];
      if (!handler) throw new Error(`No handler wired for tool ${definition.name}`);
      this.registry.register(definition, handler);
    }

    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.registry.listDefinitions(),
    }));
    this.server.setRequestHandler(CallToolRequestSchema, async request =>
      this.registry.dispatch(request.params.name, (request.params.arguments ?? {}) as Record<string, unknown>)
    );

    this.server.onerror = error => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(
      `Bitbucket MCP server v${SERVER_VERSION} running on stdio (${this.apiClient.getIsServer() ? 'Server/DC' : 'Cloud'} mode)`
    );
  }
}
