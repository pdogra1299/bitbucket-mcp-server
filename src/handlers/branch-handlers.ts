import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BitbucketApiClient } from '../utils/api-client.js';
import {
  isListBranchesArgs,
  isDeleteBranchArgs,
  isGetBranchArgs
} from '../types/guards.js';
import { BitbucketServerBranch, BitbucketCloudBranch } from '../types/bitbucket.js';

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

  async handleGetBranch(args: any) {
    if (!isGetBranchArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for get_branch'
      );
    }

    const { workspace, repository, branch_name, include_merged_prs = false } = args;

    try {
      // Step 1: Get branch details
      let branchInfo: any;
      let branchCommitInfo: any = {};

      if (this.apiClient.getIsServer()) {
        // Bitbucket Server - get branch details
        const branchesPath = `/rest/api/latest/projects/${workspace}/repos/${repository}/branches`;
        const branchesResponse = await this.apiClient.makeRequest<any>('get', branchesPath, undefined, {
          params: {
            filterText: branch_name,
            limit: 100,
            details: true
          }
        });
        
        // Find the exact branch
        const branch = branchesResponse.values?.find((b: BitbucketServerBranch) => b.displayId === branch_name);
        if (!branch) {
          throw new Error(`Branch '${branch_name}' not found`);
        }

        branchInfo = {
          name: branch.displayId,
          id: branch.id,
          latest_commit: {
            id: branch.latestCommit,
            message: branch.metadata?.['com.atlassian.bitbucket.server.bitbucket-branch:latest-commit-metadata']?.message || null,
            author: branch.metadata?.['com.atlassian.bitbucket.server.bitbucket-branch:latest-commit-metadata']?.author || null,
            date: branch.metadata?.['com.atlassian.bitbucket.server.bitbucket-branch:latest-commit-metadata']?.authorTimestamp 
              ? new Date(branch.metadata['com.atlassian.bitbucket.server.bitbucket-branch:latest-commit-metadata'].authorTimestamp).toISOString()
              : null
          },
          is_default: branch.isDefault || false
        };
      } else {
        // Bitbucket Cloud - get branch details
        const branchPath = `/repositories/${workspace}/${repository}/refs/branches/${encodeURIComponent(branch_name)}`;
        const branch = await this.apiClient.makeRequest<BitbucketCloudBranch>('get', branchPath);

        branchInfo = {
          name: branch.name,
          id: `refs/heads/${branch.name}`,
          latest_commit: {
            id: branch.target.hash,
            message: branch.target.message,
            author: branch.target.author.user?.display_name || branch.target.author.raw,
            date: branch.target.date
          },
          is_default: false // Will check this with default branch info
        };

        // Check if this is the default branch
        try {
          const repoPath = `/repositories/${workspace}/${repository}`;
          const repoInfo = await this.apiClient.makeRequest<any>('get', repoPath);
          branchInfo.is_default = branch.name === repoInfo.mainbranch?.name;
        } catch (e) {
          // Ignore error, just assume not default
        }
      }

      // Step 2: Get open PRs from this branch
      let openPRs: any[] = [];
      
      if (this.apiClient.getIsServer()) {
        // Bitbucket Server
        const prPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests`;
        const prResponse = await this.apiClient.makeRequest<any>('get', prPath, undefined, {
          params: {
            state: 'OPEN',
            direction: 'OUTGOING',
            at: `refs/heads/${branch_name}`,
            limit: 100
          }
        });

        openPRs = (prResponse.values || []).map((pr: any) => ({
          id: pr.id,
          title: pr.title,
          destination_branch: pr.toRef.displayId,
          author: pr.author.user.displayName,
          created_on: new Date(pr.createdDate).toISOString(),
          reviewers: pr.reviewers.map((r: any) => r.user.displayName),
          approval_status: {
            approved_by: pr.reviewers.filter((r: any) => r.approved).map((r: any) => r.user.displayName),
            changes_requested_by: pr.reviewers.filter((r: any) => r.status === 'NEEDS_WORK').map((r: any) => r.user.displayName),
            pending: pr.reviewers.filter((r: any) => !r.approved && r.status !== 'NEEDS_WORK').map((r: any) => r.user.displayName)
          },
          url: `${this.baseUrl}/projects/${workspace}/repos/${repository}/pull-requests/${pr.id}`
        }));
      } else {
        // Bitbucket Cloud
        const prPath = `/repositories/${workspace}/${repository}/pullrequests`;
        const prResponse = await this.apiClient.makeRequest<any>('get', prPath, undefined, {
          params: {
            state: 'OPEN',
            q: `source.branch.name="${branch_name}"`,
            pagelen: 50
          }
        });

        openPRs = (prResponse.values || []).map((pr: any) => ({
          id: pr.id,
          title: pr.title,
          destination_branch: pr.destination.branch.name,
          author: pr.author.display_name,
          created_on: pr.created_on,
          reviewers: pr.reviewers.map((r: any) => r.display_name),
          approval_status: {
            approved_by: pr.participants.filter((p: any) => p.approved).map((p: any) => p.user.display_name),
            changes_requested_by: [], // Cloud doesn't have explicit "changes requested" status
            pending: pr.reviewers.filter((r: any) => !pr.participants.find((p: any) => p.user.account_id === r.account_id && p.approved))
              .map((r: any) => r.display_name)
          },
          url: pr.links.html.href
        }));
      }

      // Step 3: Optionally get merged PRs
      let mergedPRs: any[] = [];
      
      if (include_merged_prs) {
        if (this.apiClient.getIsServer()) {
          // Bitbucket Server
          const mergedPrPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests`;
          const mergedPrResponse = await this.apiClient.makeRequest<any>('get', mergedPrPath, undefined, {
            params: {
              state: 'MERGED',
              direction: 'OUTGOING',
              at: `refs/heads/${branch_name}`,
              limit: 25
            }
          });

          mergedPRs = (mergedPrResponse.values || []).map((pr: any) => ({
            id: pr.id,
            title: pr.title,
            merged_at: new Date(pr.updatedDate).toISOString(), // Using updated date as merge date
            merged_by: pr.participants.find((p: any) => p.role === 'PARTICIPANT' && p.approved)?.user.displayName || 'Unknown'
          }));
        } else {
          // Bitbucket Cloud
          const mergedPrPath = `/repositories/${workspace}/${repository}/pullrequests`;
          const mergedPrResponse = await this.apiClient.makeRequest<any>('get', mergedPrPath, undefined, {
            params: {
              state: 'MERGED',
              q: `source.branch.name="${branch_name}"`,
              pagelen: 25
            }
          });

          mergedPRs = (mergedPrResponse.values || []).map((pr: any) => ({
            id: pr.id,
            title: pr.title,
            merged_at: pr.updated_on,
            merged_by: pr.closed_by?.display_name || 'Unknown'
          }));
        }
      }

      // Step 4: Calculate statistics
      const daysSinceLastCommit = branchInfo.latest_commit.date 
        ? Math.floor((Date.now() - new Date(branchInfo.latest_commit.date).getTime()) / (1000 * 60 * 60 * 24))
        : null;

      // Step 5: Format and return combined response
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              branch: branchInfo,
              open_pull_requests: openPRs,
              merged_pull_requests: mergedPRs,
              statistics: {
                total_open_prs: openPRs.length,
                total_merged_prs: mergedPRs.length,
                days_since_last_commit: daysSinceLastCommit
              }
            }, null, 2),
          },
        ],
      };
    } catch (error: any) {
      // Handle specific not found error
      if (error.message?.includes('not found')) {
        return {
          content: [
            {
              type: 'text',
              text: `Branch '${branch_name}' not found in ${workspace}/${repository}`,
            },
          ],
          isError: true,
        };
      }
      return this.apiClient.handleApiError(error, `getting branch '${branch_name}' in ${workspace}/${repository}`);
    }
  }
}
