import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BitbucketApiClient, encodeRepoPath } from '../core/api-client.js';
import { isGetPullRequestDiffArgs, isSetReviewStatusArgs } from '../tools/guards.js';
import { DiffParser } from '../formatting/diff-parser.js';
import { textContent } from '../formatting/respond.js';
import type { ToolResponse } from '../types/index.js';

// Review tools.
//
// get_pull_request_diff — ONE call returning a raw unified diff (Accept:
// text/plain on Server too). The old per-line JSON explosion was ~5-10x more
// tokens with zero extra information: line numbers and ADDED/REMOVED/CONTEXT
// are derivable from @@ hunk headers and +/-/space prefixes.
//
// set_review_status — one tool for the whole reviewer state machine
// (APPROVED / NEEDS_WORK / UNAPPROVED are mutually exclusive values of the
// same participant status; the PUT needs no version).

export class ReviewHandlers {
  constructor(
    private apiClient: BitbucketApiClient,
    private username: string
  ) {}

  async handleGetPullRequestDiff(args: any): Promise<ToolResponse> {
    if (!isGetPullRequestDiffArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for get_pull_request_diff');
    }
    const { workspace, repository, pull_request_id, context_lines = 3, include_patterns, exclude_patterns, file_path } = args;

    try {
      let apiPath: string;
      const reqConfig: any = { headers: { Accept: 'text/plain' }, responseType: 'text' };
      if (this.apiClient.getIsServer()) {
        apiPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}/diff`;
        if (file_path) apiPath += `/${encodeRepoPath(file_path)}`;
        reqConfig.params = { contextLines: context_lines };
        if (args.ignore_whitespace) reqConfig.params.whitespace = 'ignore-all';
      } else {
        apiPath = `/repositories/${workspace}/${repository}/pullrequests/${pull_request_id}/diff`;
        reqConfig.params = { context: context_lines };
        if (file_path) reqConfig.params.path = file_path;
      }

      const rawDiff = await this.apiClient.makeRequest<string>('get', apiPath, undefined, reqConfig);
      return this.renderDiff({
        header: `PR #${pull_request_id} diff`,
        rawDiff: String(rawDiff ?? ''),
        include_patterns,
        exclude_patterns,
        // file_path was applied server-side; no client re-filter needed.
        excludedListMax: this.apiClient.getConfig().output.excludedListMax,
      });
    } catch (error) {
      return this.apiClient.handleApiError(error, `getting diff for pull request ${pull_request_id} in ${workspace}/${repository}`) as ToolResponse;
    }
  }

  /**
   * Shared unified-diff renderer: optional glob filtering, plain-text output,
   * explicit truncation/exclusion notes. Used by PR and commit diffs.
   */
  renderDiff(args: {
    header: string;
    rawDiff: string;
    include_patterns?: string[];
    exclude_patterns?: string[];
    excludedListMax: number;
  }): ToolResponse {
    const { header, rawDiff, include_patterns, exclude_patterns, excludedListMax } = args;

    let body = rawDiff;
    let note = '';
    if ((include_patterns && include_patterns.length > 0) || (exclude_patterns && exclude_patterns.length > 0)) {
      const parser = new DiffParser();
      const sections = parser.parseDiffIntoSections(rawDiff);
      const filtered = parser.filterSections(sections, {
        includePatterns: include_patterns,
        excludePatterns: exclude_patterns,
      });
      body = parser.reconstructDiff(filtered.sections);
      if (filtered.metadata.excludedFiles > 0) {
        const listed = filtered.metadata.excludedFileList.slice(0, excludedListMax);
        note =
          `\n[filtered: ${filtered.metadata.includedFiles}/${filtered.metadata.totalFiles} files shown; ` +
          `excluded ${filtered.metadata.excludedFiles}: ${listed.join(', ')}` +
          `${filtered.metadata.excludedFiles > listed.length ? ` …and ${filtered.metadata.excludedFiles - listed.length} more` : ''}]`;
      }
    }

    const fileCount = (body.match(/^diff --git/gm) ?? []).length;
    const headerLine = `${header} (${fileCount} files)${note}`;
    return textContent(`${headerLine}\n\n${body}`);
  }

  async handleSetReviewStatus(args: any): Promise<ToolResponse> {
    if (!isSetReviewStatusArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for set_review_status');
    }
    const { workspace, repository, pull_request_id, status, comment } = args;

    try {
      const username = this.username.replace(/[@+]/g, '_');
      let statusNote = '';
      if (this.apiClient.getIsServer()) {
        await this.apiClient.makeRequest<any>(
          'put',
          `/rest/api/latest/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}/participants/${username}`,
          { status },
          undefined,
          { idempotent: true }
        );
      } else {
        const base = `/repositories/${workspace}/${repository}/pullrequests/${pull_request_id}`;
        if (status === 'APPROVED') {
          await this.apiClient.makeRequest<any>('post', `${base}/approve`);
        } else if (status === 'NEEDS_WORK') {
          await this.apiClient.makeRequest<any>('post', `${base}/request-changes`);
        } else {
          // UNAPPROVED: clear both possible prior states. Only a 404
          // ("nothing to clear") is expected — anything else is a real error.
          const clear = async (path: string): Promise<boolean> => {
            try {
              await this.apiClient.makeRequest<any>('delete', path);
              return true;
            } catch (e: any) {
              if (e?.status === 404) return false;
              throw e;
            }
          };
          const clearedApproval = await clear(`${base}/approve`);
          const clearedChanges = await clear(`${base}/request-changes`);
          if (!clearedApproval && !clearedChanges) statusNote = ' (there was no prior approval or change-request to clear)';
        }
      }

      if (comment) {
        const commentPath = this.apiClient.getIsServer()
          ? `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}/comments`
          : `/repositories/${workspace}/${repository}/pullrequests/${pull_request_id}/comments`;
        const body = this.apiClient.getIsServer() ? { text: comment } : { content: { raw: comment } };
        await this.apiClient.makeRequest<any>('post', commentPath, body);
      }

      return textContent(`Review status set to ${status} on PR #${pull_request_id}${statusNote}.${comment ? ' Comment added.' : ''}`);
    } catch (error) {
      return this.apiClient.handleApiError(error, `setting review status on pull request ${pull_request_id} in ${workspace}/${repository}`) as ToolResponse;
    }
  }
}
