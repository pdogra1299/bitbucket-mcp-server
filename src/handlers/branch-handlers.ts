import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BitbucketApiClient } from '../utils/api-client.js';
import {
  isListBranchesArgs,
  isDeleteBranchArgs,
  isGetBranchArgs,
  isListBranchCommitsArgs,
  isGetCommitDetailArgs
} from '../types/guards.js';
import { DiffParser } from '../utils/diff-parser.js';
import { minimatch } from 'minimatch';
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
      search,
      include_build_status = false
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
          // Filter by author name
          commits = commits.filter(c =>
            c.author.name === author ||
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

      // Fetch build status if requested (Server only)
      if (include_build_status && this.apiClient.getIsServer() && commits.length > 0) {
        try {
          // Extract commit hashes (use full hash, not abbreviated)
          const commitIds = commits.map(c => c.hash);

          // Fetch build summaries for all commits
          const buildSummaries = await this.apiClient.getBuildSummaries(
            workspace,
            repository,
            commitIds
          );

          // Merge build status into commits
          commits = commits.map(commit => {
            const buildData = buildSummaries[commit.hash];
            if (buildData) {
              return {
                ...commit,
                build_status: {
                  successful: buildData.successful || 0,
                  failed: buildData.failed || 0,
                  in_progress: buildData.inProgress || 0,
                  unknown: buildData.unknown || 0
                }
              };
            }
            return commit;
          });
        } catch (error) {
          // Gracefully degrade - log error but don't fail the entire request
          console.error('Failed to fetch build status:', error);
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
      if (include_build_status) filtersApplied.include_build_status = include_build_status;

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

  async handleGetCommitDetail(args: any) {
    if (!isGetCommitDetailArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for get_commit_detail'
      );
    }

    const {
      workspace,
      repository,
      commit_id,
      context_lines = 3,
      include_patterns,
      exclude_patterns,
      file_path
    } = args;

    try {
      if (this.apiClient.getIsServer()) {
        let apiPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/commits/${commit_id}/diff`;
        const params: any = { contextLines: context_lines };

        if (file_path) {
          apiPath = `${apiPath}/${file_path}`;
        }

        const jsonResponse = await this.apiClient.makeRequest<any>(
          'get', apiPath, undefined,
          { params, headers: { 'Accept': 'application/json' } }
        );

        const structured = this.transformServerCommitDiff(jsonResponse, commit_id, include_patterns, exclude_patterns, file_path);

        return {
          content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
        };
      } else {
        // Bitbucket Cloud: GET /repositories/{workspace}/{repo}/diff/{commit_id}
        let apiPath = `/repositories/${workspace}/${repository}/diff/${commit_id}`;
        const params: any = { context: context_lines };

        if (file_path) {
          params.path = file_path;
        }

        const rawDiff = await this.apiClient.makeRequest<string>(
          'get', apiPath, undefined,
          { params, headers: { 'Accept': 'text/plain' } }
        );

        const needsFiltering = file_path || include_patterns || exclude_patterns;

        if (!needsFiltering) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ commit_id, diff: rawDiff }, null, 2) }],
          };
        }

        const diffParser = new DiffParser();
        const sections = diffParser.parseDiffIntoSections(rawDiff);
        const filteredResult = diffParser.filterSections(sections, {
          includePatterns: include_patterns,
          excludePatterns: exclude_patterns,
          filePath: file_path
        });
        const filteredDiff = diffParser.reconstructDiff(filteredResult.sections);

        const response: any = { commit_id, diff: filteredDiff };

        if (filteredResult.metadata.excludedFiles > 0 || file_path || include_patterns || exclude_patterns) {
          response.filter_metadata = {
            total_files: filteredResult.metadata.totalFiles,
            included_files: filteredResult.metadata.includedFiles,
            excluded_files: filteredResult.metadata.excludedFiles,
            filters_applied: {} as any
          };
          if (filteredResult.metadata.excludedFileList.length > 0) {
            response.filter_metadata.excluded_file_list = filteredResult.metadata.excludedFileList;
          }
          if (file_path) response.filter_metadata.filters_applied.file_path = file_path;
          if (include_patterns) response.filter_metadata.filters_applied.include_patterns = include_patterns;
          if (exclude_patterns) response.filter_metadata.filters_applied.exclude_patterns = exclude_patterns;
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
        };
      }
    } catch (error) {
      return this.apiClient.handleApiError(error, `getting diff for commit ${commit_id} in ${workspace}/${repository}`);
    }
  }

  private transformServerCommitDiff(
    response: any,
    commitId: string,
    includePatterns?: string[],
    excludePatterns?: string[],
    filePath?: string
  ) {
    const allDiffs = response.diffs || [];
    const excludedFileList: string[] = [];

    let filteredDiffs = allDiffs;

    if (filePath) {
      filteredDiffs = allDiffs.filter((diff: any) => {
        const destPath = diff.destination?.toString;
        const srcPath = diff.source?.toString;
        const matches = destPath === filePath || srcPath === filePath;
        if (!matches) excludedFileList.push(destPath || srcPath);
        return matches;
      });
    } else {
      if (excludePatterns && excludePatterns.length > 0) {
        filteredDiffs = filteredDiffs.filter((diff: any) => {
          const fp = diff.destination?.toString || diff.source?.toString;
          const shouldExclude = excludePatterns.some(p => minimatch(fp, p, { matchBase: true }));
          if (shouldExclude) excludedFileList.push(fp);
          return !shouldExclude;
        });
      }
      if (includePatterns && includePatterns.length > 0) {
        filteredDiffs = filteredDiffs.filter((diff: any) => {
          const fp = diff.destination?.toString || diff.source?.toString;
          const shouldInclude = includePatterns.some(p => minimatch(fp, p, { matchBase: true }));
          if (!shouldInclude) excludedFileList.push(fp);
          return shouldInclude;
        });
      }
    }

    const files = filteredDiffs.map((diff: any) => {
      const destPath = diff.destination?.toString;
      const srcPath = diff.source?.toString;

      let status: 'added' | 'deleted' | 'modified' | 'renamed' = 'modified';
      if (!srcPath || srcPath === '/dev/null') {
        status = 'added';
      } else if (!destPath || destPath === '/dev/null') {
        status = 'deleted';
      } else if (srcPath !== destPath) {
        status = 'renamed';
      }

      const hunks = (diff.hunks || []).map((hunk: any) => {
        const lines: any[] = [];
        for (const segment of (hunk.segments || [])) {
          const lineType = segment.type as 'ADDED' | 'REMOVED' | 'CONTEXT';
          for (const line of (segment.lines || [])) {
            lines.push({
              source_line: line.source,
              destination_line: line.destination,
              type: lineType,
              content: line.line
            });
          }
        }
        return {
          context: hunk.context || '',
          source_start: hunk.sourceLine,
          source_span: hunk.sourceSpan,
          destination_start: hunk.destinationLine,
          destination_span: hunk.destinationSpan,
          lines
        };
      });

      return {
        file_path: destPath || srcPath,
        old_path: (srcPath && srcPath !== destPath) ? srcPath : null,
        status,
        hunks
      };
    });

    const result: any = {
      commit_id: commitId,
      files,
      summary: {
        total_files: allDiffs.length,
        files_included: files.length,
        files_excluded: excludedFileList.length
      }
    };

    if (filePath || includePatterns || excludePatterns) {
      result.filter_metadata = { filters_applied: {} as any };
      if (filePath) result.filter_metadata.filters_applied.file_path = filePath;
      if (includePatterns) result.filter_metadata.filters_applied.include_patterns = includePatterns;
      if (excludePatterns) result.filter_metadata.filters_applied.exclude_patterns = excludePatterns;
      if (excludedFileList.length > 0) result.filter_metadata.excluded_file_list = excludedFileList;
    }

    return result;
  }
}
