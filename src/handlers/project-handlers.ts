import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BitbucketApiClient } from '../utils/api-client.js';
import {
  isListProjectsArgs,
  isListRepositoriesArgs
} from '../types/guards.js';
import {
  BitbucketServerProject,
  BitbucketCloudProject,
  BitbucketServerRepository,
  BitbucketCloudRepository
} from '../types/bitbucket.js';

export class ProjectHandlers {
  constructor(
    private apiClient: BitbucketApiClient,
    private baseUrl: string
  ) {}

  async handleListProjects(args: any) {
    if (!isListProjectsArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for list_projects'
      );
    }

    const { name, permission, limit = 25, start = 0 } = args;

    try {
      let apiPath: string;
      let params: any = {};
      let projects: any[] = [];
      let totalCount = 0;
      let nextPageStart: number | null = null;

      if (this.apiClient.getIsServer()) {
        // Bitbucket Server API
        apiPath = `/rest/api/1.0/projects`;
        params = {
          limit,
          start
        };

        if (name) {
          params.name = name;
        }
        if (permission) {
          params.permission = permission;
        }

        const response = await this.apiClient.makeRequest<any>('get', apiPath, undefined, { params });

        // Format projects
        projects = (response.values || []).map((project: BitbucketServerProject) => ({
          key: project.key,
          id: project.id,
          name: project.name,
          description: project.description || '',
          is_public: project.public,
          type: project.type,
          url: `${this.baseUrl}/projects/${project.key}`
        }));

        totalCount = response.size || projects.length;
        if (!response.isLastPage && response.nextPageStart !== undefined) {
          nextPageStart = response.nextPageStart;
        }
      } else {
        // Bitbucket Cloud API
        apiPath = `/workspaces`;
        params = {
          pagelen: limit,
          page: Math.floor(start / limit) + 1
        };

        // Cloud uses workspaces, not projects exactly
        const response = await this.apiClient.makeRequest<any>('get', apiPath, undefined, { params });

        projects = (response.values || []).map((workspace: any) => ({
          key: workspace.slug,
          id: workspace.uuid,
          name: workspace.name,
          description: '',
          is_public: !workspace.is_private,
          type: 'WORKSPACE',
          url: workspace.links.html.href
        }));

        totalCount = response.size || projects.length;
        if (response.next) {
          nextPageStart = start + limit;
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              projects,
              total_count: totalCount,
              start,
              limit,
              has_more: nextPageStart !== null,
              next_start: nextPageStart
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.apiClient.handleApiError(error, 'listing projects');
    }
  }

  async handleListRepositories(args: any) {
    if (!isListRepositoriesArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for list_repositories'
      );
    }

    const { workspace, name, permission, limit = 25, start = 0 } = args;

    try {
      let apiPath: string;
      let params: any = {};
      let repositories: any[] = [];
      let totalCount = 0;
      let nextPageStart: number | null = null;

      if (this.apiClient.getIsServer()) {
        // Bitbucket Server API
        if (workspace) {
          // List repos in a specific project
          apiPath = `/rest/api/1.0/projects/${workspace}/repos`;
        } else {
          // List all accessible repos
          apiPath = `/rest/api/1.0/repos`;
        }

        params = {
          limit,
          start
        };

        if (name) {
          params.name = name;
        }
        if (permission) {
          params.permission = permission;
        }
        if (!workspace && name) {
          // When listing all repos and filtering by name
          params.projectname = name;
        }

        const response = await this.apiClient.makeRequest<any>('get', apiPath, undefined, { params });

        // Format repositories
        repositories = (response.values || []).map((repo: BitbucketServerRepository) => ({
          slug: repo.slug,
          id: repo.id,
          name: repo.name,
          description: repo.description || '',
          project_key: repo.project.key,
          project_name: repo.project.name,
          state: repo.state,
          is_public: repo.public,
          is_forkable: repo.forkable,
          clone_urls: {
            http: repo.links.clone.find(c => c.name === 'http')?.href || '',
            ssh: repo.links.clone.find(c => c.name === 'ssh')?.href || ''
          },
          url: `${this.baseUrl}/projects/${repo.project.key}/repos/${repo.slug}`
        }));

        totalCount = response.size || repositories.length;
        if (!response.isLastPage && response.nextPageStart !== undefined) {
          nextPageStart = response.nextPageStart;
        }
      } else {
        // Bitbucket Cloud API
        if (workspace) {
          // List repos in a specific workspace
          apiPath = `/repositories/${workspace}`;
        } else {
          // Cloud doesn't support listing all repos without workspace
          // We'll return an error message
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'Bitbucket Cloud requires a workspace parameter to list repositories. Please provide a workspace.'
                }, null, 2),
              },
            ],
            isError: true,
          };
        }

        params = {
          pagelen: limit,
          page: Math.floor(start / limit) + 1
        };

        const response = await this.apiClient.makeRequest<any>('get', apiPath, undefined, { params });

        repositories = (response.values || []).map((repo: BitbucketCloudRepository) => ({
          slug: repo.slug,
          id: repo.uuid,
          name: repo.name,
          description: repo.description || '',
          project_key: repo.project?.key || '',
          project_name: repo.project?.name || '',
          state: 'AVAILABLE',
          is_public: !repo.is_private,
          is_forkable: true,
          clone_urls: {
            http: repo.links.clone.find(c => c.name === 'https')?.href || '',
            ssh: repo.links.clone.find(c => c.name === 'ssh')?.href || ''
          },
          url: repo.links.html.href
        }));

        totalCount = response.size || repositories.length;
        if (response.next) {
          nextPageStart = start + limit;
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              repositories,
              total_count: totalCount,
              start,
              limit,
              has_more: nextPageStart !== null,
              next_start: nextPageStart,
              workspace: workspace || 'all'
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.apiClient.handleApiError(error, workspace ? `listing repositories in ${workspace}` : 'listing repositories');
    }
  }
}
