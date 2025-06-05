import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BitbucketApiClient } from '../utils/api-client.js';
import {
  isListBranchesArgs,
  isDeleteBranchArgs
} from '../types/guards.js';

export class BranchHandlers {
  constructor(
    private apiClient: BitbucketApiClient,
    private baseUrl: string
  ) {}

  async handleListBranches(args: any) {
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

      if (this.apiClient.getIsServer()) {
        // Bitbucket Server API - using latest version for better filtering support
        apiPath = `/rest/api/latest/projects/${workspace}/repos/${repository}/branches`;
        params = {
          limit,
          start,
          details: true,
          orderBy: 'MODIFICATION'
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

      const response = await this.apiClient.makeRequest<any>('get', apiPath, undefined, { params });

      // Format the response
      let branches: any[] = [];
      let totalCount = 0;
      let nextPageStart = null;

      if (this.apiClient.getIsServer()) {
        // Bitbucket Server response
        branches = (response.values || []).map((branch: any) => ({
          name: branch.displayId,
          id: branch.id,
          latest_commit: branch.latestCommit,
          is_default: branch.isDefault || false
        }));
        totalCount = response.size || 0;
        if (!response.isLastPage && response.nextPageStart !== undefined) {
          nextPageStart = response.nextPageStart;
        }
      } else {
        // Bitbucket Cloud response
        branches = (response.values || []).map((branch: any) => ({
          name: branch.name,
          target: branch.target.hash,
          is_default: branch.name === 'main' || branch.name === 'master'
        }));
        totalCount = response.size || 0;
        if (response.next) {
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
              next_start: nextPageStart
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.apiClient.handleApiError(error, `listing branches in ${workspace}/${repository}`);
    }
  }

  async handleDeleteBranch(args: any) {
    if (!isDeleteBranchArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for delete_branch'
      );
    }

    const { workspace, repository, branch_name, force } = args;

    try {
      let apiPath: string;

      if (this.apiClient.getIsServer()) {
        // First, we need to get the branch details to find the latest commit
        const branchesPath = `/rest/api/latest/projects/${workspace}/repos/${repository}/branches`;
        const branchesResponse = await this.apiClient.makeRequest<any>('get', branchesPath, undefined, {
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
          await this.apiClient.makeRequest<any>('delete', apiPath, {
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
          await this.apiClient.makeRequest<any>('delete', apiPath);
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
      return this.apiClient.handleApiError(error, `deleting branch '${branch_name}' in ${workspace}/${repository}`);
    }
  }
}
