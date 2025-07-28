import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BitbucketApiClient } from '../utils/api-client.js';
import {
  isListBranchesArgs,
  isDeleteBranchArgs,
  isCreateBranchArgs,
  isGetBranchArgs,
  isListBranchCommitsArgs
} from '../types/guards.js';
import {
  BitbucketServerBranch,
  BitbucketCloudBranch,
  BitbucketServerCommit,
  BitbucketCloudCommit,
  FormattedCommit
} from '../types/bitbucket.js';
import { formatServerCommit, formatCloudCommit } from '../utils/formatters.js';

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

  async handleListBranchCommits(args: any) {
    if (!isListBranchCommitsArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for list_branch_commits'
      );
    }

    const {
      workspace,
      repository,
      branch_name,
      limit = 25,
      start = 0,
      since,
      until,
      author,
      include_merge_commits = true,
      search
    } = args;

    try {
      let apiPath: string;
      let params: any = {};
      let commits: FormattedCommit[] = [];
      let totalCount = 0;
      let nextPageStart: number | null = null;

      if (this.apiClient.getIsServer()) {
        // Bitbucket Server API
        apiPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/commits`;
        params = {
          until: `refs/heads/${branch_name}`,
          limit,
          start,
          withCounts: true
        };

        // Add filters
        if (since) {
          params.since = since;
        }
        if (!include_merge_commits) {
          params.merges = 'exclude';
        }

        const response = await this.apiClient.makeRequest<any>('get', apiPath, undefined, { params });

        // Format commits
        commits = (response.values || []).map((commit: BitbucketServerCommit) => formatServerCommit(commit));

        // Apply client-side filters for Server API
        if (author) {
          // Filter by author email or name
          commits = commits.filter(c =>
            c.author.email === author ||
            c.author.name === author ||
            c.author.email.toLowerCase() === author.toLowerCase() ||
            c.author.name.toLowerCase() === author.toLowerCase()
          );
        }

        // Filter by date if 'until' is provided (Server API doesn't support 'until' param directly)
        if (until) {
          const untilDate = new Date(until).getTime();
          commits = commits.filter(c => new Date(c.date).getTime() <= untilDate);
        }

        // Filter by message search if provided
        if (search) {
          const searchLower = search.toLowerCase();
          commits = commits.filter(c => c.message.toLowerCase().includes(searchLower));
        }

        // If we applied client-side filters, update the total count
        if (author || until || search) {
          totalCount = commits.length;
          // Can't determine if there are more results when filtering client-side
          nextPageStart = null;
        } else {
          totalCount = response.size || commits.length;
          if (!response.isLastPage && response.nextPageStart !== undefined) {
            nextPageStart = response.nextPageStart;
          }
        }
      } else {
        // Bitbucket Cloud API
        apiPath = `/repositories/${workspace}/${repository}/commits/${encodeURIComponent(branch_name)}`;
        params = {
          pagelen: limit,
          page: Math.floor(start / limit) + 1
        };

        // Build query string for filters
        const queryParts: string[] = [];
        if (author) {
          queryParts.push(`author.raw ~ "${author}"`);
        }
        if (!include_merge_commits) {
          // Cloud API doesn't have direct merge exclusion, we'll filter client-side
        }
        if (queryParts.length > 0) {
          params.q = queryParts.join(' AND ');
        }

        const response = await this.apiClient.makeRequest<any>('get', apiPath, undefined, { params });

        // Format commits
        let cloudCommits = (response.values || []).map((commit: BitbucketCloudCommit) => formatCloudCommit(commit));

        // Apply client-side filters
        if (!include_merge_commits) {
          cloudCommits = cloudCommits.filter((c: FormattedCommit) => !c.is_merge_commit);
        }
        if (since) {
          const sinceDate = new Date(since).getTime();
          cloudCommits = cloudCommits.filter((c: FormattedCommit) => new Date(c.date).getTime() >= sinceDate);
        }
        if (until) {
          const untilDate = new Date(until).getTime();
          cloudCommits = cloudCommits.filter((c: FormattedCommit) => new Date(c.date).getTime() <= untilDate);
        }
        if (search) {
          const searchLower = search.toLowerCase();
          cloudCommits = cloudCommits.filter((c: FormattedCommit) => c.message.toLowerCase().includes(searchLower));
        }

        commits = cloudCommits;
        totalCount = response.size || commits.length;
        if (response.next) {
          nextPageStart = start + limit;
        }
      }

      // Get branch head info
      let branchHead: string | null = null;
      try {
        if (this.apiClient.getIsServer()) {
          const branchesPath = `/rest/api/latest/projects/${workspace}/repos/${repository}/branches`;
          const branchesResponse = await this.apiClient.makeRequest<any>('get', branchesPath, undefined, {
            params: { filterText: branch_name, limit: 1 }
          });
          const branch = branchesResponse.values?.find((b: any) => b.displayId === branch_name);
          branchHead = branch?.latestCommit || null;
        } else {
          const branchPath = `/repositories/${workspace}/${repository}/refs/branches/${encodeURIComponent(branch_name)}`;
          const branch = await this.apiClient.makeRequest<any>('get', branchPath);
          branchHead = branch.target?.hash || null;
        }
      } catch (e) {
        // Ignore error, branch head is optional
      }

      // Build filters applied summary
      const filtersApplied: any = {};
      if (author) filtersApplied.author = author;
      if (since) filtersApplied.since = since;
      if (until) filtersApplied.until = until;
      if (include_merge_commits !== undefined) filtersApplied.include_merge_commits = include_merge_commits;
      if (search) filtersApplied.search = search;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              branch_name,
              branch_head: branchHead,
              commits,
              total_count: totalCount,
              start,
              limit,
              has_more: nextPageStart !== null,
              next_start: nextPageStart,
              filters_applied: filtersApplied
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.apiClient.handleApiError(error, `listing commits for branch '${branch_name}' in ${workspace}/${repository}`);
    }
  }

  async handleCreateBranch(args: any) {
    if (!isCreateBranchArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for create_branch'
      );
    }

    const { workspace, repository, branch_name, start_point } = args;

    try {
      let apiPath: string;
      let requestBody: any;

      if (this.apiClient.getIsServer()) {
        // Bitbucket Server API - using rest/api/latest/projects/{projectKey}/repos/{repositorySlug}/branches
        apiPath = `/rest/api/latest/projects/${workspace}/repos/${repository}/branches`;

        // First, resolve the start_point to a commit hash if it's a branch name
        let startCommitHash = start_point;

        // Check if start_point is a branch name by trying to get branch info
        if (!start_point.match(/^[a-f0-9]{40}$/i)) { // Not a full commit hash
          try {
            const branchesPath = `/rest/api/latest/projects/${workspace}/repos/${repository}/branches`;
            const branchesResponse = await this.apiClient.makeRequest<any>('get', branchesPath, undefined, {
              params: {
                filterText: start_point,
                limit: 100
              }
            });

            const sourceBranch = branchesResponse.values?.find((b: any) => b.displayId === start_point);
            if (sourceBranch && sourceBranch.latestCommit) {
              startCommitHash = sourceBranch.latestCommit;
            }
          } catch (error) {
            // If we can't find the branch, assume start_point is a commit hash or partial hash
          }
        }

        requestBody = {
          name: branch_name,
          startPoint: startCommitHash,
          message: `Create branch ${branch_name} from ${start_point}`
        };
      } else {
        // Bitbucket Cloud API - using /repositories/{workspace}/{repo_slug}/refs/branches
        apiPath = `/repositories/${workspace}/${repository}/refs/branches`;

        // For Cloud API, we need to resolve the start_point to a target object
        let target: any;

        // Check if start_point is a commit hash or branch name
        if (start_point.match(/^[a-f0-9]{7,40}$/i)) {
          // It's a commit hash
          target = { hash: start_point };
        } else {
          // It's likely a branch name, get the target from the branch
          try {
            const branchPath = `/repositories/${workspace}/${repository}/refs/branches/${encodeURIComponent(start_point)}`;
            const branch = await this.apiClient.makeRequest<any>('get', branchPath);
            target = branch.target;
          } catch (error) {
            throw new Error(`Could not find branch or commit '${start_point}' to create branch from`);
          }
        }

        requestBody = {
          name: branch_name,
          target: target
        };
      }

      const response = await this.apiClient.makeRequest<any>('post', apiPath, requestBody);

      // Format the response based on the API
      let createdBranch: any;
      if (this.apiClient.getIsServer()) {
        createdBranch = {
          name: response.displayId,
          id: response.id,
          latest_commit: response.latestCommit,
          is_default: false
        };
      } else {
        createdBranch = {
          name: response.name,
          target: response.target?.hash,
          is_default: false
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: `Branch '${branch_name}' created successfully from '${start_point}'`,
              branch: createdBranch,
              repository: `${workspace}/${repository}`
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.apiClient.handleApiError(error, `creating branch '${branch_name}' from '${start_point}' in ${workspace}/${repository}`);
    }
  }
}
