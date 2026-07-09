import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BitbucketApiClient, encodeRepoPath } from '../core/api-client.js';
import {
  isListBranchesArgs,
  isDeleteBranchArgs,
  isGetBranchArgs,
  isListBranchCommitsArgs,
  isGetCommitDetailArgs,
} from '../tools/guards.js';
import { formatServerCommit, formatCloudCommit, compactCommit } from '../formatting/formatters.js';
import { compactObject, errorContent, isCommitRev, isoDate, jsonContent, serverPage, toEpochMillis } from '../formatting/respond.js';
import { ReviewHandlers } from './review-handlers.js';
import type { FormattedCommit, ToolResponse } from '../types/index.js';

// Branch & commit tools. v3 changes:
//  * list_branch_commits — the branch head IS the first commit of the raw
//    first page (until=refs/heads/X): the separate branch lookup is gone.
//    Client-side filters walk a BOUNDED number of server pages and keep
//    pagination working, with an explicit note when the bound stops early.
//  * get_branch — exact lookup with a small boosted page; the merged-PR list
//    stays opt-in.
//  * delete_branch — accepts expected_head to skip the lookup entirely.
//  * get_commit_detail — raw unified diff (text/plain), same renderer as PR
//    diffs; `detail: files` mode returns the changed-file list without any
//    diff bodies (one /changes call).

export class BranchHandlers {
  constructor(
    private apiClient: BitbucketApiClient,
    private baseUrl: string,
    private reviewHandlers: ReviewHandlers
  ) {}

  private get cfg() {
    return this.apiClient.getConfig();
  }

  // ── list_branches ──────────────────────────────────────────────────────────

  async handleListBranches(args: any): Promise<ToolResponse> {
    if (!isListBranchesArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for list_branches');
    }
    const { workspace, repository, filter } = args;
    const limit = args.limit ?? this.cfg.pagination.defaultListLimit;
    const start = args.start ?? 0;

    try {
      let branches: Array<Record<string, unknown>>;
      let hasMore: boolean;
      let nextStart: number | undefined;

      if (this.apiClient.getIsServer()) {
        const response = await this.apiClient.makeRequest<any>(
          'get',
          `/rest/api/latest/projects/${workspace}/repos/${repository}/branches`,
          undefined,
          { params: { limit, start, details: true, orderBy: 'MODIFICATION', ...(filter ? { filterText: filter } : {}) } }
        );
        branches = (response.values || []).map((b: any) =>
          compactObject({
            name: b.displayId,
            latest_commit: b.latestCommit?.slice(0, 12),
            is_default: b.isDefault || undefined,
          })
        );
        ({ hasMore, nextStart } = serverPage(response));
      } else {
        const response = await this.apiClient.makeRequest<any>(
          'get',
          `/repositories/${workspace}/${repository}/refs/branches`,
          undefined,
          { params: { pagelen: limit, page: Math.floor(start / limit) + 1, ...(filter ? { q: `name ~ "${filter}"` } : {}) } }
        );
        branches = (response.values || []).map((b: any) =>
          compactObject({ name: b.name, latest_commit: b.target?.hash?.slice(0, 12) })
        );
        hasMore = !!response.next;
        nextStart = hasMore ? start + limit : undefined;
      }

      return jsonContent(compactObject({ branches, has_more: hasMore || undefined, next_start: nextStart }));
    } catch (error) {
      return this.apiClient.handleApiError(error, `listing branches in ${workspace}/${repository}`) as ToolResponse;
    }
  }

  // ── get_branch ─────────────────────────────────────────────────────────────

  async handleGetBranch(args: any): Promise<ToolResponse> {
    if (!isGetBranchArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for get_branch');
    }
    const { workspace, repository, branch_name, include_merged_prs = false } = args;

    try {
      let branchInfo: Record<string, unknown>;
      if (this.apiClient.getIsServer()) {
        const response = await this.apiClient.makeRequest<any>(
          'get',
          `/rest/api/latest/projects/${workspace}/repos/${repository}/branches`,
          undefined,
          { params: { filterText: branch_name, limit: this.cfg.pagination.branchLookupLimit, details: true, boostMatches: true } }
        );
        const branch = response.values?.find((b: any) => b.displayId === branch_name);
        if (!branch) return errorContent(`Branch '${branch_name}' not found in ${workspace}/${repository}`);
        const meta = branch.metadata?.['com.atlassian.bitbucket.server.bitbucket-branch:latest-commit-metadata'];
        branchInfo = compactObject({
          name: branch.displayId,
          latest_commit: compactObject({
            id: branch.latestCommit,
            message: meta?.message,
            author: meta?.author?.name ?? meta?.author,
            date: isoDate(meta?.authorTimestamp),
          }),
          is_default: branch.isDefault || undefined,
        });
      } else {
        const branch = await this.apiClient.makeRequest<any>(
          'get',
          `/repositories/${workspace}/${repository}/refs/branches/${encodeURIComponent(branch_name)}`
        );
        branchInfo = compactObject({
          name: branch.name,
          latest_commit: compactObject({
            id: branch.target?.hash,
            message: branch.target?.message,
            author: branch.target?.author?.user?.display_name || branch.target?.author?.raw,
            date: branch.target?.date,
          }),
        });
      }

      const prs = await this.fetchBranchPrs(workspace, repository, branch_name, 'OPEN');
      const result: Record<string, unknown> = { branch: branchInfo, open_pull_requests: prs };
      if (include_merged_prs) {
        result.merged_pull_requests = await this.fetchBranchPrs(workspace, repository, branch_name, 'MERGED');
      }
      return jsonContent(result);
    } catch (error: any) {
      if (error?.status === 404) {
        return errorContent(`Branch '${branch_name}' not found in ${workspace}/${repository}`);
      }
      return this.apiClient.handleApiError(error, `getting branch '${branch_name}' in ${workspace}/${repository}`) as ToolResponse;
    }
  }

  private async fetchBranchPrs(
    workspace: string,
    repository: string,
    branchName: string,
    state: 'OPEN' | 'MERGED'
  ): Promise<Array<Record<string, unknown>>> {
    const limit = this.cfg.pagination.branchLookupLimit;
    if (this.apiClient.getIsServer()) {
      const response = await this.apiClient.makeRequest<any>(
        'get',
        `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests`,
        undefined,
        { params: { state, direction: 'OUTGOING', at: `refs/heads/${branchName}`, limit } }
      );
      return (response.values || []).map((pr: any) =>
        compactObject({
          id: pr.id,
          title: pr.title,
          destination_branch: pr.toRef.displayId,
          author: pr.author.user.displayName,
          approvals: pr.reviewers?.filter((r: any) => r.approved).length || undefined,
          needs_work: pr.reviewers?.filter((r: any) => r.status === 'NEEDS_WORK').length || undefined,
          updated_on: isoDate(pr.updatedDate),
        })
      );
    }
    const response = await this.apiClient.makeRequest<any>(
      'get',
      `/repositories/${workspace}/${repository}/pullrequests`,
      undefined,
      { params: { state, q: `source.branch.name="${branchName}"`, pagelen: limit } }
    );
    return (response.values || []).map((pr: any) =>
      compactObject({
        id: pr.id,
        title: pr.title,
        destination_branch: pr.destination?.branch?.name,
        author: pr.author?.display_name,
        updated_on: pr.updated_on,
      })
    );
  }

  // ── delete_branch ──────────────────────────────────────────────────────────

  async handleDeleteBranch(args: any): Promise<ToolResponse> {
    if (!isDeleteBranchArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for delete_branch');
    }
    const { workspace, repository, branch_name, expected_head } = args;

    try {
      if (this.apiClient.getIsServer()) {
        // The branch-utils DELETE takes an endPoint (compare-and-swap head).
        // Caller-supplied expected_head skips the lookup entirely.
        let endPoint = expected_head;
        if (!endPoint) {
          const response = await this.apiClient.makeRequest<any>(
            'get',
            `/rest/api/latest/projects/${workspace}/repos/${repository}/branches`,
            undefined,
            { params: { filterText: branch_name, limit: this.cfg.pagination.branchLookupLimit, boostMatches: true } }
          );
          const branch = response.values?.find((b: any) => b.displayId === branch_name);
          if (!branch) return errorContent(`Branch '${branch_name}' not found`);
          endPoint = branch.latestCommit;
        }
        try {
          await this.apiClient.makeRequest<any>(
            'delete',
            `/rest/branch-utils/latest/projects/${workspace}/repos/${repository}/branches`,
            { name: branch_name, endPoint }
          );
        } catch (deleteError: any) {
          // 204 No Content parses as an "empty response" error in some stacks.
          const ok =
            deleteError.originalError?.response?.status === 204 ||
            deleteError.message?.includes('No content to map');
          if (!ok) throw deleteError;
        }
      } else {
        try {
          await this.apiClient.makeRequest<any>('delete', `/repositories/${workspace}/${repository}/refs/branches/${encodeURIComponent(branch_name)}`);
        } catch (deleteError: any) {
          const ok =
            deleteError.originalError?.response?.status === 204 ||
            deleteError.message?.includes('No content to map');
          if (!ok) throw deleteError;
        }
      }
      // The ref is gone — drop any memoized resolution for it.
      this.apiClient.invalidateRef(workspace, repository, branch_name);
      return jsonContent({ deleted: branch_name });
    } catch (error) {
      return this.apiClient.handleApiError(error, `deleting branch '${branch_name}' in ${workspace}/${repository}`) as ToolResponse;
    }
  }

  // ── list_branch_commits ────────────────────────────────────────────────────

  async handleListBranchCommits(args: any): Promise<ToolResponse> {
    if (!isListBranchCommitsArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for list_branch_commits');
    }
    const {
      workspace, repository, branch_name, since, until, author,
      include_merge_commits = true, search, include_build_status = false,
    } = args;
    const limit = Math.min(args.limit ?? this.cfg.pagination.defaultListLimit, this.cfg.pagination.commitsPageLimit);
    const start = args.start ?? 0;

    try {
      let commits: FormattedCommit[] = [];
      let branchHead: string | undefined;
      let hasMore = false;
      let nextStart: number | undefined;
      let filterNote: string | undefined;

      if (this.apiClient.getIsServer()) {
        // DC's `since` param is a commit/ref (exclusive), NOT a date — pass it
        // through only when it looks like one; dates (ISO or epoch — pure
        // digits are never treated as a rev) filter client-side.
        const sinceIsRev = !!since && isCommitRev(since);
        const sinceDate = since && !sinceIsRev ? since : undefined;
        const hasClientFilter = !!(author || until || search || sinceDate);

        const params: any = { until: `refs/heads/${branch_name}`, limit };
        if (sinceIsRev) params.since = since;
        if (!include_merge_commits) params.merges = 'exclude';

        // Walk a bounded number of pages when filtering client-side. Offsets
        // are positional, so next_start must point at the first UNRETURNED
        // matching commit — never at the server's page boundary past dropped
        // matches.
        const maxPages = hasClientFilter ? this.cfg.pagination.commitsFilterMaxPages : 1;
        let pageStart = start;
        pages: for (let page = 0; page < maxPages; page++) {
          const response = await this.apiClient.makeRequest<any>(
            'get',
            `/rest/api/1.0/projects/${workspace}/repos/${repository}/commits`,
            undefined,
            { params: { ...params, start: pageStart } }
          );
          const raw: any[] = response.values || [];
          if (page === 0 && pageStart === 0 && raw.length > 0) {
            branchHead = raw[0].id; // head = first commit at until=refs/heads/X
          }
          for (let i = 0; i < raw.length; i++) {
            const fc = formatServerCommit(raw[i]);
            if (!this.passesFilters(fc, { author, until, search, since: sinceDate })) continue;
            if (commits.length < limit) {
              commits.push(fc);
            } else {
              hasMore = true;
              nextStart = pageStart + i;
              break pages;
            }
          }
          const serverHasMore = response.isLastPage === false;
          if (!serverHasMore) break;
          const serverNext = typeof response.nextPageStart === 'number' ? response.nextPageStart : pageStart + raw.length;
          if (page === maxPages - 1) {
            hasMore = true;
            nextStart = serverNext;
            if (hasClientFilter) {
              filterNote = `Client-side filters scanned ${maxPages} pages; more pages exist — continue with start=${serverNext}.`;
            }
            break;
          }
          pageStart = serverNext;
        }
      } else {
        const params: any = { pagelen: limit, page: Math.floor(start / limit) + 1 };
        const response = await this.apiClient.makeRequest<any>(
          'get',
          `/repositories/${workspace}/${repository}/commits/${encodeURIComponent(branch_name)}`,
          undefined,
          { params }
        );
        let cloudCommits: FormattedCommit[] = (response.values || []).map(formatCloudCommit);
        if (cloudCommits.length > 0 && start === 0) branchHead = cloudCommits[0].hash;
        if (!include_merge_commits) cloudCommits = cloudCommits.filter(c => !c.is_merge_commit);
        // Cloud's commits collection has no q= filtering — everything client-side.
        cloudCommits = cloudCommits.filter(c => this.passesFilters(c, { author, until, search, since }));
        commits = cloudCommits;
        hasMore = !!response.next;
        nextStart = hasMore ? start + limit : undefined;
        if ((author || until || search || since) && hasMore) {
          filterNote = 'Filters apply per page on Cloud — later pages may contain more matches.';
        }
      }

      if (include_build_status && this.apiClient.getIsServer() && commits.length > 0) {
        const summaries = await this.apiClient.getBuildSummaries(workspace, repository, commits.map(c => c.hash));
        commits = commits.map(c => {
          const b = summaries[c.hash];
          return b
            ? ({ ...c, build_status: { successful: b.successful || 0, failed: b.failed || 0, in_progress: b.inProgress || 0 } } as FormattedCommit)
            : c;
        });
      }

      return jsonContent(
        compactObject({
          branch: branch_name,
          head: branchHead?.slice(0, 12),
          commits: commits.map(compactCommit),
          has_more: hasMore || undefined,
          next_start: nextStart,
          note: filterNote,
        })
      );
    } catch (error) {
      return this.apiClient.handleApiError(error, `listing commits for branch '${branch_name}' in ${workspace}/${repository}`) as ToolResponse;
    }
  }

  private passesFilters(
    c: FormattedCommit,
    filters: { author?: string; until?: string; search?: string; since?: string }
  ): boolean {
    if (filters.author && !c.author.name.toLowerCase().includes(filters.author.toLowerCase())) return false;
    const sinceMs = toEpochMillis(filters.since);
    const untilMs = toEpochMillis(filters.until);
    if (sinceMs !== undefined && new Date(c.date).getTime() < sinceMs) return false;
    if (untilMs !== undefined && new Date(c.date).getTime() > untilMs) return false;
    if (filters.search && !c.message.toLowerCase().includes(filters.search.toLowerCase())) return false;
    return true;
  }

  // ── get_commit_detail ──────────────────────────────────────────────────────

  async handleGetCommitDetail(args: any): Promise<ToolResponse> {
    if (!isGetCommitDetailArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for get_commit_detail');
    }
    const { workspace, repository, commit_id, context_lines = 3, include_patterns, exclude_patterns, file_path, detail } = args;

    try {
      // files mode: changed-file list only — no diff bodies at all.
      if (detail === 'files') {
        if (this.apiClient.getIsServer()) {
          const response = await this.apiClient.makeRequest<any>(
            'get',
            `/rest/api/1.0/projects/${workspace}/repos/${repository}/commits/${commit_id}/changes`,
            undefined,
            { params: { limit: this.cfg.pagination.changesLimit, withComments: false } }
          );
          const files = (response.values || []).map((c: any) =>
            compactObject({
              path: c.path?.toString,
              type: c.type,
              old_path: c.srcPath?.toString,
            })
          );
          return jsonContent(
            compactObject({
              commit: commit_id,
              files,
              truncated: response.isLastPage === false || undefined,
            })
          );
        }
        // Cloud: diffstat gives the same body-less file list.
        const response = await this.apiClient.makeRequest<any>(
          'get',
          `/repositories/${workspace}/${repository}/diffstat/${commit_id}`,
          undefined,
          { params: { pagelen: this.cfg.pagination.cloudCommentsPageLen } }
        );
        const files = (response.values || []).map((s: any) =>
          compactObject({
            path: s.new?.path ?? s.old?.path,
            type: s.status,
            old_path: s.status === 'renamed' ? s.old?.path : undefined,
          })
        );
        return jsonContent(
          compactObject({ commit: commit_id, files, truncated: response.next ? true : undefined })
        );
      }

      let rawDiff: string;
      if (this.apiClient.getIsServer()) {
        let apiPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/commits/${commit_id}/diff`;
        if (file_path) apiPath += `/${encodeRepoPath(file_path)}`;
        rawDiff = await this.apiClient.makeRequest<string>('get', apiPath, undefined, {
          params: { contextLines: context_lines },
          headers: { Accept: 'text/plain' },
          responseType: 'text',
        });
      } else {
        rawDiff = await this.apiClient.makeRequest<string>(
          'get',
          `/repositories/${workspace}/${repository}/diff/${commit_id}`,
          undefined,
          { params: { context: context_lines, ...(file_path ? { path: file_path } : {}) }, headers: { Accept: 'text/plain' }, responseType: 'text' }
        );
      }

      return this.reviewHandlers.renderDiff({
        header: `commit ${commit_id.slice(0, 12)} diff`,
        rawDiff: String(rawDiff ?? ''),
        include_patterns,
        exclude_patterns,
        excludedListMax: this.cfg.output.excludedListMax,
      });
    } catch (error) {
      return this.apiClient.handleApiError(error, `getting diff for commit ${commit_id} in ${workspace}/${repository}`) as ToolResponse;
    }
  }
}
