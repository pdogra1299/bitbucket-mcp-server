import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BitbucketApiClient, encodeRepoPath } from '../core/api-client.js';
import { isGetPullRequestDiffArgs, isManageReviewerArgs, isSetReviewStatusArgs } from '../tools/guards.js';
import { DiffParser } from '../formatting/diff-parser.js';
import { compactObject, errorContent, jsonContent, textContent } from '../formatting/respond.js';
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
//
// manage_reviewer — add/remove a participant, which is the ONLY way to assign
// yourself to a PR you did not author. See the handler for why
// update_pull_request cannot do it.

/** A user-identifier lookup failed; carried separately so the handler can
 *  answer with steering text instead of a rethrown exception. */
class UserResolutionError extends Error {}

type ResolvedUser = { name: string; slug: string };

export class ReviewHandlers {
  private userCache = new Map<string, ResolvedUser>();

  constructor(
    private apiClient: BitbucketApiClient,
    private username: string
  ) {}

  /**
   * Resolve a Server/DC identifier — username, user slug, or e-mail — to its
   * canonical `{ name, slug }`.
   *
   * Two identifiers are in play and they are NOT interchangeable: participant
   * endpoints address a user by **slug in the URL**, while a request body
   * names them by **name**. Deriving either from a configured string by string
   * surgery is what made `set_review_status` fail with a misleading error: an
   * e-mail in BITBUCKET_USERNAME becomes `first.last_example.com`, no such
   * user exists, and Bitbucket answers 403 `You may only update your own
   * status.` — which this server then reports as "Permission denied … check
   * your credentials", sending you after the wrong cause entirely.
   *
   * Measured on Bitbucket DC 8.x: `GET /users/{id}` accepts the username or
   * the slug (either case) but NOT an e-mail; `GET /users?filter=` does match
   * the e-mail. Hence the two steps.
   */
  private async resolveUser(identifier: string): Promise<ResolvedUser> {
    const cached = this.userCache.get(identifier);
    if (cached) return cached;

    let user: any;
    try {
      user = await this.apiClient.makeRequest<any>(
        'get',
        `/rest/api/1.0/users/${encodeURIComponent(identifier)}`
      );
    } catch {
      // Not a username or slug — search. This is the branch that makes an
      // e-mail work, so a wrong-but-plausible BITBUCKET_USERNAME still lands.
      const found = await this.apiClient.makeRequest<any>(
        'get',
        '/rest/api/1.0/users',
        undefined,
        { params: { filter: identifier, limit: 5 } }
      );
      const values: any[] = found?.values ?? [];
      if (values.length === 0) {
        throw new UserResolutionError(
          `No Bitbucket user matches "${identifier}". Set BITBUCKET_USERNAME to your Bitbucket ` +
            `username (not your e-mail) or pass an explicit \`username\`.`
        );
      }
      if (values.length > 1) {
        throw new UserResolutionError(
          `"${identifier}" matches ${values.length} users (${values
            .map(v => v.slug)
            .join(', ')}) — pass an exact username.`
        );
      }
      user = values[0];
    }

    if (!user?.name) {
      throw new UserResolutionError(`Could not resolve "${identifier}" to a Bitbucket user.`);
    }
    const resolved: ResolvedUser = { name: user.name, slug: user.slug ?? user.name };
    // Cache under every spelling we now know, so a mixed-case or e-mail call
    // costs one lookup per process rather than one per tool call.
    for (const key of [identifier, resolved.name, resolved.slug]) this.userCache.set(key, resolved);
    return resolved;
  }

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
      // Resolve rather than derive. The old `replace(/[@+]/g, '_')` guessed the
      // slug from the configured string and silently produced a nonexistent
      // user whenever BITBUCKET_USERNAME held an e-mail. Falls back to that
      // guess if resolution itself is unavailable, so this is never worse.
      let username: string;
      try {
        username = (await this.resolveUser(this.username)).slug;
      } catch {
        username = this.username.replace(/[@+]/g, '_');
      }
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

  /**
   * Add or remove a PR participant (Server/DC).
   *
   * This exists because `update_pull_request` CANNOT assign a reviewer to a PR
   * you did not author: Bitbucket restricts the `reviewers` list on
   * `PUT /pull-requests/{id}` to the PR author or a repo admin, and answers
   * anyone else with `Errors encountered while adding some reviewers` — a
   * message that reads like a bad payload or a missing permission. Measured on
   * DC 8.x against a colleague's PR: that PUT fails with a minimal body and
   * with a full body carrying the untouched title/description, while
   * `POST .../participants` with `role: REVIEWER` succeeds as the same user.
   *
   * Two behaviours worth knowing, both measured:
   *  - `DELETE .../participants/{slug}` returns 204 but only DEMOTES a user who
   *    already holds a review status — they stay listed as PARTICIPANT.
   *  - A `PUT` whose reviewer list already matches returns 200 because it adds
   *    nobody; do not read that no-op as proof the PUT path works.
   */
  async handleManageReviewer(args: any): Promise<ToolResponse> {
    if (!isManageReviewerArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for manage_reviewer');
    }
    const { workspace, repository, pull_request_id, action, username, role = 'REVIEWER' } = args;

    if (!this.apiClient.getIsServer()) {
      return errorContent(
        'manage_reviewer is Server/DC only — Bitbucket Cloud has no participants endpoint. ' +
          'On Cloud, set the reviewer list with update_pull_request.'
      );
    }
    const identifier = username ?? this.username;
    if (!identifier) {
      return errorContent('No user to act on: pass `username`, or set BITBUCKET_USERNAME to default to yourself.');
    }

    try {
      const user = await this.resolveUser(identifier);
      const base = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}/participants`;

      if (action === 'add') {
        // The body names the user by `name`; the URL form below needs `slug`.
        const participant = await this.apiClient.makeRequest<any>('post', base, {
          user: { name: user.name },
          role,
        });
        return jsonContent(
          compactObject({
            pull_request_id,
            user: user.slug,
            role: participant?.role ?? role,
            status: participant?.status,
            approved: participant?.approved,
          })
        );
      }

      await this.apiClient.makeRequest<any>(
        'delete',
        `${base}/${encodeURIComponent(user.slug)}`,
        undefined,
        undefined,
        { idempotent: true }
      );
      return textContent(
        `Removed ${user.slug} as reviewer on PR #${pull_request_id}. ` +
          `If they already had a review status, Bitbucket keeps them listed as PARTICIPANT.`
      );
    } catch (error) {
      if (error instanceof UserResolutionError) return errorContent(error.message);
      return this.apiClient.handleApiError(
        error,
        `${action === 'add' ? 'adding' : 'removing'} reviewer on pull request ${pull_request_id} in ${workspace}/${repository}`
      ) as ToolResponse;
    }
  }
}
