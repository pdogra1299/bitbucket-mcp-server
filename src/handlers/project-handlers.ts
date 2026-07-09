import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BitbucketApiClient } from '../core/api-client.js';
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
    const { name, permission } = args;
    const limit = args.limit ?? this.cfg.pagination.defaultListLimit;
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

      const response = await this.apiClient.makeRequest<any>('get', '/workspaces', undefined, {
        params: { pagelen: limit, page: Math.floor(start / limit) + 1 },
      });
      const projects = (response.values || []).map((w: any) => compactObject({ key: w.slug, name: w.name }));
      return jsonContent(
        compactObject({
          projects,
          has_more: !!response.next || undefined,
          next_start: response.next ? start + limit : undefined,
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
    const limit = args.limit ?? this.cfg.pagination.defaultListLimit;
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
        params: { pagelen: limit, page: Math.floor(start / limit) + 1 },
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
        })
      );
    } catch (error) {
      return this.apiClient.handleApiError(error, workspace ? `listing repositories in ${workspace}` : 'listing repositories') as ToolResponse;
    }
  }
}
