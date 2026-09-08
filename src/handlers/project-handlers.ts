import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BitbucketApiClient, cloudNameFilter } from '../core/api-client.js';
import { isListProjectsArgs, isListRepositoriesArgs } from '../tools/guards.js';
import { compactObject, errorContent, jsonContent, serverPage } from '../formatting/respond.js';
import type { ToolResponse } from '../types/index.js';

// Discovery tools — single-call listings with compact output.

export class ProjectHandlers {
  constructor(private apiClient: BitbucketApiClient) {}

  private get cfg() {
    return this.apiClient.getConfig();
  }

  async handleListProjects(args: any): Promise<ToolResponse> {
    if (!isListProjectsArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for list_projects');
    }
    const { workspace, name, permission } = args;
    const limit = this.apiClient.clampPageSize(args.limit ?? this.cfg.pagination.defaultListLimit);
    const start = args.start ?? 0;

    try {
      if (this.apiClient.getIsServer()) {
        const response = await this.apiClient.makeRequest<any>('get', '/rest/api/1.0/projects', undefined, {
          params: { limit, start, ...(name ? { name } : {}), ...(permission ? { permission } : {}) },
        });
        const projects = (response.values || []).map((p: any) =>
          compactObject({ key: p.key, name: p.name, description: p.description || undefined })
        );
        return jsonContent(
          compactObject({
            projects,
            has_more: serverPage(response).hasMore || undefined,
            next_start: serverPage(response).nextStart,
          })
        );
      }

      // Cloud keeps projects under a workspace, so listing the CORE/URM/DEPL
      // keys that repositories carry needs one: /workspaces/{ws}/projects.
      // Without a workspace this falls back to listing the workspaces
      // themselves, which an API
      // token without workspace scope answers 404 for, so prefer passing one.
      const apiPath = workspace ? `/workspaces/${workspace}/projects` : '/workspaces';
      // `name` has to go through Cloud's `q` language; there is no name param.
      // `permission` is a Server concept with Server-shaped values, so it is
      // reported as ignored rather than silently dropped.
      const response = await this.apiClient.makeRequest<any>('get', apiPath, undefined, {
        params: {
          pagelen: limit,
          page: Math.floor(start / limit) + 1,
          ...(name ? { q: cloudNameFilter(name) } : {}),
        },
      });
      const projects = (response.values || []).map((v: any) =>
        compactObject({
          key: workspace ? v.key : v.slug,
          name: v.name,
          description: workspace ? v.description || undefined : undefined,
        })
      );
      return jsonContent(
        compactObject({
          projects,
          has_more: !!response.next || undefined,
          next_start: response.next ? start + limit : undefined,
          note: permission ? 'permission filter ignored: Server/DC only' : undefined,
        })
      );
    } catch (error) {
      return this.apiClient.handleApiError(error, 'listing projects') as ToolResponse;
    }
  }

  async handleListRepositories(args: any): Promise<ToolResponse> {
    if (!isListRepositoriesArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for list_repositories');
    }
    const { workspace, name, permission } = args;
    const limit = this.apiClient.clampPageSize(args.limit ?? this.cfg.pagination.defaultListLimit);
    const start = args.start ?? 0;

    try {
      if (this.apiClient.getIsServer()) {
        const apiPath = workspace ? `/rest/api/1.0/projects/${workspace}/repos` : '/rest/api/1.0/repos';
        const params: any = { limit, start };
        if (name) params.name = name;
        if (permission) params.permission = permission;
        const response = await this.apiClient.makeRequest<any>('get', apiPath, undefined, { params });
        const repositories = (response.values || []).map((r: any) =>
          compactObject({
            slug: r.slug,
            name: r.name !== r.slug ? r.name : undefined,
            project: r.project?.key,
            description: r.description || undefined,
          })
        );
        return jsonContent(
          compactObject({
            repositories,
            has_more: serverPage(response).hasMore || undefined,
            next_start: serverPage(response).nextStart,
          })
        );
      }

      if (!workspace) {
        return errorContent('Bitbucket Cloud requires a workspace parameter to list repositories.');
      }
      const response = await this.apiClient.makeRequest<any>('get', `/repositories/${workspace}`, undefined, {
        params: {
          pagelen: limit,
          page: Math.floor(start / limit) + 1,
          ...(name ? { q: cloudNameFilter(name) } : {}),
        },
      });
      const repositories = (response.values || []).map((r: any) =>
        compactObject({
          slug: r.slug,
          name: r.name !== r.slug ? r.name : undefined,
          project: r.project?.key,
          description: r.description || undefined,
        })
      );
      return jsonContent(
        compactObject({
          repositories,
          has_more: !!response.next || undefined,
          next_start: response.next ? start + limit : undefined,
          note: permission ? 'permission filter ignored: Server/DC only' : undefined,
        })
      );
    } catch (error) {
      return this.apiClient.handleApiError(error, workspace ? `listing repositories in ${workspace}` : 'listing repositories') as ToolResponse;
    }
  }
}
