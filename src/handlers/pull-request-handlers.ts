import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { existsSync } from 'fs';
import { BitbucketApiClient, encodeRepoPath } from '../core/api-client.js';
import {
  formatServerPullRequest,
  formatCloudPullRequest,
  formatServerPrListItem,
  formatCloudPrListItem,
  formatServerCommit,
  formatCloudCommit,
  compactCommit,
} from '../formatting/formatters.js';
import { formatSuggestionComment } from '../formatting/suggestion-formatter.js';
import { appendAttachments, buildAttachmentMarkup } from '../formatting/attachment-formatter.js';
import { DiffParser } from '../formatting/diff-parser.js';
import {
  capDetails,
  compactObject,
  errorContent,
  isoDate,
  jsonContent,
  serverPage,
  textContent,
  truncateMarked,
} from '../formatting/respond.js';
import type {
  BitbucketCloudComment,
  BitbucketServerActivity,
  CodeMatch,
  FormattedComment,
  FormattedCommit,
  ToolResponse,
} from '../types/index.js';
import {
  isGetPullRequestArgs,
  isListPullRequestsArgs,
  isCreatePullRequestArgs,
  isUpdatePullRequestArgs,
  isAddCommentArgs,
  isMergePullRequestArgs,
  isListPrCommitsArgs,
  isDeclinePullRequestArgs,
  isManageCommentArgs,
  AttachmentInput,
} from '../tools/guards.js';

// Pull-request tools. v3 call budget (Server):
//   get_pull_request     1 call (metadata) … 3-4 with includes — merge info
//                        now comes from the PR resource (properties.mergeCommit
//                        + closedDate); merged_by is extracted from the same
//                        activities page that serves comments (no extra call).
//   list_pull_requests   1 call (+ cross-repo dashboard mode when repository omitted)
//   create/update/merge/decline: 1 call when `version` is supplied (2 otherwise),
//                        with one refetch-and-retry on 409 version conflicts.
//   add_comment          1 call (+1 single-FILE diff when resolving code_snippet)
//   manage_comment       1 call with `version` (2 otherwise) — replaces
//                        delete_comment + all PR-task mutation tools (DC tasks
//                        ARE comments with severity=BLOCKER).

export class PullRequestHandlers {
  constructor(
    private apiClient: BitbucketApiClient,
    private baseUrl: string
  ) {}

  private get cfg() {
    return this.apiClient.getConfig();
  }

  private serverPrPath(workspace: string, repository: string, id?: number): string {
    return `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests${id !== undefined ? `/${id}` : ''}`;
  }

  private cloudPrPath(workspace: string, repository: string, id?: number): string {
    return `/repositories/${workspace}/${repository}/pullrequests${id !== undefined ? `/${id}` : ''}`;
  }

  // ── Attachments (upload + embed) ───────────────────────────────────────────

  private async uploadMarkups(
    workspace: string,
    repository: string,
    attachments: AttachmentInput[]
  ): Promise<string[]> {
    if (!this.apiClient.getIsServer()) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Attachments are only supported on Bitbucket Server / Data Center (Cloud has no public attachment API).'
      );
    }
    const markups: string[] = [];
    for (const item of attachments) {
      const filePath = typeof item === 'string' ? item : item.file_path;
      const altText = typeof item === 'string' ? undefined : item.alt_text;
      const render = typeof item === 'string' ? 'auto' : item.render || 'auto';
      if (!filePath) throw new McpError(ErrorCode.InvalidParams, 'Each attachment requires a file_path');
      if (!existsSync(filePath)) throw new McpError(ErrorCode.InvalidParams, `Attachment file not found: ${filePath}`);
      const uploaded = await this.apiClient.uploadAttachment(workspace, repository, filePath);
      if (!uploaded.ref) {
        throw new McpError(ErrorCode.InternalError, `Attachment "${uploaded.name}" uploaded but no reference returned`);
      }
      markups.push(buildAttachmentMarkup(uploaded.ref, altText || uploaded.name, render));
    }
    return markups;
  }

  private async uploadAndEmbed(
    workspace: string,
    repository: string,
    body: string,
    attachments?: AttachmentInput[]
  ): Promise<string> {
    if (!attachments || attachments.length === 0) return body;
    return appendAttachments(body, await this.uploadMarkups(workspace, repository, attachments));
  }

  // ── get_pull_request ───────────────────────────────────────────────────────

  async handleGetPullRequest(args: any): Promise<ToolResponse> {
    if (!isGetPullRequestArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for get_pull_request');
    }
    const { workspace, repository, pull_request_id } = args;
    const includeComments = args.include_comments !== false;
    const includeFileChanges = args.include_file_changes !== false;
    const includeTasks = args.include_tasks === true;
    const commentLimit =
      typeof args.comment_limit === 'number' && args.comment_limit > 0
        ? Math.floor(args.comment_limit)
        : this.cfg.output.commentDefaultLimit;

    try {
      const isServer = this.apiClient.getIsServer();
      const prPath = isServer
        ? this.serverPrPath(workspace, repository, pull_request_id)
        : this.cloudPrPath(workspace, repository, pull_request_id);
      const pr = await this.apiClient.makeRequest<any>('get', prPath);

      const result: Record<string, unknown> = isServer
        ? formatServerPullRequest(pr, this.baseUrl)
        : formatCloudPullRequest(pr);
      const warnings: string[] = [];

      if (isServer) {
        if (includeComments) {
          const { comments, activeCount, totalCount, mergedBy, mergedAt, truncated } =
            await this.fetchServerActivities(workspace, repository, pull_request_id, commentLimit, pr.state === 'MERGED');
          result.active_comments = comments;
          result.active_comment_count = activeCount;
          result.total_comment_count = totalCount;
          if (mergedBy) result.merged_by = mergedBy;
          if (mergedAt && !result.closed_on) result.merged_on = mergedAt;
          if (truncated) {
            warnings.push(
              `COMMENTS_TRUNCATED: activity pages hit the ${this.cfg.pagination.activitiesMaxPages}-page cap; counts cover only the fetched pages.`
            );
          }
        } else if (pr.state === 'MERGED') {
          // Merge author/time live only in the activity stream — fetch one
          // small page so metadata-only reads don't silently lose them.
          const mergeInfo = await this.fetchMergeInfoSmall(workspace, repository, pull_request_id);
          if (mergeInfo.mergedBy) result.merged_by = mergeInfo.mergedBy;
          if (mergeInfo.mergedAt && !result.closed_on) result.merged_on = mergeInfo.mergedAt;
        }
        if (includeFileChanges) {
          const changes = await this.fetchServerFileChanges(workspace, repository, pull_request_id);
          result.file_changes = changes.files;
          result.file_change_count = changes.files.length;
          if (changes.truncated) {
            warnings.push('FILE_CHANGES_TRUNCATED: the changes endpoint is single-page; the list is capped by the server.');
          }
        }
        if (includeTasks) {
          result.tasks = await this.fetchServerTasks(workspace, repository, pull_request_id);
        }
      } else {
        if (includeComments) {
          const { comments, activeCount, totalCount, truncated } = await this.fetchCloudComments(
            workspace, repository, pull_request_id, commentLimit
          );
          result.active_comments = comments;
          result.active_comment_count = activeCount;
          result.total_comment_count = totalCount;
          if (truncated) warnings.push('COMMENTS_TRUNCATED: comment pages hit the page-walk cap; counts cover fetched pages only.');
        }
        if (includeFileChanges) {
          const { files, truncated } = await this.fetchCloudFileChanges(workspace, repository, pull_request_id);
          result.file_changes = files;
          result.file_change_count = files.length;
          if (truncated) warnings.push('FILE_CHANGES_TRUNCATED: diffstat pages hit the page-walk cap.');
        }
      }

      if (warnings.length > 0) result.warnings = warnings;
      return jsonContent(result);
    } catch (error) {
      return this.apiClient.handleApiError(error, `getting pull request ${pull_request_id} in ${workspace}/${repository}`) as ToolResponse;
    }
  }

  /** One small activities page just for merge author/time (merged PRs, comments off). */
  private async fetchMergeInfoSmall(
    workspace: string,
    repository: string,
    pullRequestId: number
  ): Promise<{ mergedBy?: string; mergedAt?: string }> {
    try {
      const response = await this.apiClient.makeRequest<any>(
        'get',
        `${this.serverPrPath(workspace, repository, pullRequestId)}/activities`,
        undefined,
        { params: { limit: this.cfg.pagination.branchLookupLimit } }
      );
      const mergeActivity: any = (response.values || []).find((a: any) => a.action === 'MERGED');
      return mergeActivity
        ? { mergedBy: mergeActivity.user?.displayName, mergedAt: isoDate(mergeActivity.createdDate) }
        : {};
    } catch {
      return {}; // enrichment only — never fail the PR read for it
    }
  }

  /**
   * ONE paginated activities walk serves both the comment tree and (for
   * merged PRs) merged-by extraction — the MERGED activity is in the stream.
   */
  private async fetchServerActivities(
    workspace: string,
    repository: string,
    pullRequestId: number,
    commentLimit: number,
    wantMergeInfo: boolean
  ): Promise<{
    comments: FormattedComment[];
    activeCount: number;
    totalCount: number;
    mergedBy?: string;
    mergedAt?: string;
    truncated: boolean;
  }> {
    const { pagination, output } = this.cfg;
    const apiPath = `${this.serverPrPath(workspace, repository, pullRequestId)}/activities`;

    const activities: BitbucketServerActivity[] = [];
    let start = 0;
    let truncated = false;
    for (let page = 0; page < pagination.activitiesMaxPages; page++) {
      const response = await this.apiClient.makeRequest<any>('get', apiPath, undefined, {
        params: { limit: pagination.activitiesPageLimit, start },
      });
      activities.push(...(response.values || []));
      if (!serverPage(response).hasMore) break;
      if (page === pagination.activitiesMaxPages - 1) {
        truncated = true;
        break;
      }
      start = typeof response.nextPageStart === 'number' ? response.nextPageStart : start + (response.values?.length ?? 0);
    }

    let mergedBy: string | undefined;
    let mergedAt: string | undefined;
    if (wantMergeInfo) {
      const mergeActivity: any = activities.find((a: any) => a.action === 'MERGED');
      if (mergeActivity) {
        mergedBy = mergeActivity.user?.displayName;
        mergedAt = isoDate(mergeActivity.createdDate);
      }
    }

    const truncateText = (text: string) => truncateMarked(text, output.commentTextMax);
    const processNested = (comment: any, anchor: any): FormattedComment => {
      const formatted: FormattedComment = {
        id: comment.id,
        author: comment.author.displayName,
        text: truncateText(comment.text),
        created_on: isoDate(comment.createdDate) ?? '',
        is_inline: !!anchor,
        file_path: anchor?.path,
        line_number: anchor?.line,
        state: comment.state,
      };
      (formatted as any).version = comment.version;
      if (comment.severity === 'BLOCKER') (formatted as any).is_task = true;
      if (comment.comments?.length > 0) {
        formatted.replies = comment.comments
          .filter((reply: any) => reply.state !== 'RESOLVED' && !(anchor && anchor.orphaned === true))
          .map((reply: any) => processNested(reply, anchor));
      }
      return formatted;
    };
    const countAll = (comment: any): number =>
      1 + (comment.comments ?? []).reduce((sum: number, r: any) => sum + countAll(r), 0);
    const countActive = (comment: any, anchor: any): number => {
      let count = comment.state !== 'RESOLVED' && !(anchor && anchor.orphaned === true) ? 1 : 0;
      count += (comment.comments ?? []).reduce((sum: number, r: any) => sum + countActive(r, anchor), 0);
      return count;
    };

    const commentActivities = activities.filter((a: any) => a.action === 'COMMENTED' && a.comment);
    const totalCount = commentActivities.reduce((sum: number, a: any) => sum + countAll(a.comment), 0);
    const activeCount = commentActivities.reduce((sum: number, a: any) => sum + countActive(a.comment, a.commentAnchor), 0);
    const comments = commentActivities
      .filter((a: any) => a.comment.state !== 'RESOLVED' && !(a.commentAnchor && a.commentAnchor.orphaned === true))
      .map((a: any) => processNested(a.comment, a.commentAnchor))
      .slice(0, commentLimit);

    return { comments, activeCount, totalCount, mergedBy, mergedAt, truncated };
  }

  private async fetchServerFileChanges(
    workspace: string,
    repository: string,
    pullRequestId: number
  ): Promise<{ files: Array<Record<string, unknown>>; truncated: boolean }> {
    const response = await this.apiClient.makeRequest<any>(
      'get',
      `${this.serverPrPath(workspace, repository, pullRequestId)}/changes`,
      undefined,
      { params: { limit: this.cfg.pagination.changesLimit, withComments: false } }
    );
    const files = (response.values || []).map((change: any) =>
      compactObject({
        path: change.path?.toString,
        status: ({ ADD: 'added', DELETE: 'removed', MOVE: 'renamed', RENAME: 'renamed' } as any)[change.type] ?? 'modified',
        old_path: change.srcPath?.toString,
      })
    );
    // PR /changes is single-page by design: start is ignored and results are
    // truncated to min(limit, server cap) — surface it, never page.
    return { files, truncated: response.isLastPage === false };
  }

  private async fetchServerTasks(workspace: string, repository: string, pullRequestId: number): Promise<unknown[]> {
    try {
      const apiPath = `${this.serverPrPath(workspace, repository, pullRequestId)}/blocker-comments`;
      const values: any[] = [];
      let start = 0;
      let truncated = false;
      for (let page = 0; page < this.cfg.pagination.activitiesMaxPages; page++) {
        const response = await this.apiClient.makeRequest<any>('get', apiPath, undefined, {
          params: { limit: this.cfg.pagination.activitiesPageLimit, start },
        });
        values.push(...(response.values || []));
        if (response.isLastPage !== false) break;
        if (page === this.cfg.pagination.activitiesMaxPages - 1) {
          truncated = true;
          break;
        }
        start = typeof response.nextPageStart === 'number' ? response.nextPageStart : start + (response.values?.length ?? 0);
      }
      const tasks: unknown[] = values.map((t: any) =>
        compactObject({
          id: t.id,
          version: t.version,
          text: truncateMarked(t.text ?? '', this.cfg.output.commentTextMax),
          author: t.author?.displayName || t.author?.name,
          state: t.state || 'OPEN',
          created_on: isoDate(t.createdDate),
        })
      );
      if (truncated) tasks.push({ warning: 'TASKS_TRUNCATED: more task pages exist beyond the page-walk cap.' });
      return tasks;
    } catch (error: any) {
      if (error?.status === 404) {
        // Pre-7.2 instance: blocker-comments absent. Extremely unlikely on
        // supported DC, but degrade honestly rather than failing the tool.
        return [{ warning: 'blocker-comments endpoint unavailable on this instance; tasks not listed' }];
      }
      throw error;
    }
  }

  /** Follow Cloud `next` cursors up to a bounded page count. */
  private async fetchCloudPages(firstPath: string, params: any): Promise<{ values: any[]; truncated: boolean }> {
    const values: any[] = [];
    let url: string | null = firstPath;
    let reqParams: any | undefined = params;
    for (let page = 0; page < this.cfg.pagination.activitiesMaxPages && url; page++) {
      const response: any = await this.apiClient.makeRequest<any>('get', url, undefined, reqParams ? { params: reqParams } : undefined);
      values.push(...(response.values || []));
      url = response.next || null; // absolute URL; axios overrides baseURL
      reqParams = undefined;
      if (!url) return { values, truncated: false };
    }
    return { values, truncated: url !== null };
  }

  private async fetchCloudComments(
    workspace: string,
    repository: string,
    pullRequestId: number,
    commentLimit: number
  ): Promise<{ comments: FormattedComment[]; activeCount: number; totalCount: number; truncated: boolean }> {
    const { values, truncated } = await this.fetchCloudPages(
      `${this.cloudPrPath(workspace, repository, pullRequestId)}/comments`,
      { pagelen: this.cfg.pagination.cloudCommentsPageLen }
    );
    const all = values as BitbucketCloudComment[];
    const active = all.filter(c => !c.deleted && !c.resolved);
    const comments = active.slice(0, commentLimit).map(c => ({
      id: c.id,
      author: c.user.display_name,
      text: truncateMarked(c.content.raw, this.cfg.output.commentTextMax),
      created_on: c.created_on,
      is_inline: !!c.inline,
      file_path: c.inline?.path,
      line_number: c.inline?.to,
    }));
    return { comments, activeCount: active.length, totalCount: all.length, truncated };
  }

  private async fetchCloudFileChanges(
    workspace: string,
    repository: string,
    pullRequestId: number
  ): Promise<{ files: Array<Record<string, unknown>>; truncated: boolean }> {
    const { values, truncated } = await this.fetchCloudPages(
      `${this.cloudPrPath(workspace, repository, pullRequestId)}/diffstat`,
      { pagelen: this.cfg.pagination.cloudCommentsPageLen }
    );
    // Cloud diffstat: `type` is the entity discriminator ("diffstat"); the
    // real change kind is `status`, and paths live under new/old.
    const files = values.map((stat: any) =>
      compactObject({
        path: stat.new?.path ?? stat.old?.path,
        status: stat.status,
        old_path: stat.status === 'renamed' ? stat.old?.path : undefined,
      })
    );
    return { files, truncated };
  }

  // ── list_pull_requests ─────────────────────────────────────────────────────

  async handleListPullRequests(args: any): Promise<ToolResponse> {
    if (!isListPullRequestsArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for list_pull_requests');
    }
    const { workspace, repository, state = 'OPEN', author, role } = args;
    const limit = args.limit ?? this.cfg.pagination.defaultListLimit;
    const start = args.start ?? 0;

    try {
      // Cross-repo mode (Server): one dashboard call replaces a per-repo fan-out.
      if (this.apiClient.getIsServer() && !repository) {
        if (author) {
          return errorContent(
            'The cross-repo listing is scoped to the authenticated user and cannot filter by author — pass `repository` to filter by author, or use `role` instead.'
          );
        }
        const params: any = { limit, start, order: 'NEWEST' };
        if (state !== 'ALL') params.state = state;
        if (role) params.role = role;
        const response = await this.apiClient.makeRequest<any>('get', '/rest/api/latest/dashboard/pull-requests', undefined, { params });
        const items = (response.values || []).map((pr: any) => ({
          ...formatServerPrListItem(pr),
          repository: `${pr.toRef.repository.project.key}/${pr.toRef.repository.slug}`,
        }));
        return jsonContent(
          compactObject({
            pull_requests: items,
            scope: 'all repositories (dashboard)',
            has_more: serverPage(response).hasMore || undefined,
            next_start: serverPage(response).nextStart,
          })
        );
      }
      if (!repository) {
        return errorContent('repository is required (cross-repo listing is Server-only).');
      }
      if (role) {
        return errorContent('`role` applies to the cross-repo listing only — omit `repository` to use it, or filter by `author` here.');
      }

      let apiPath: string;
      let params: any;
      if (this.apiClient.getIsServer()) {
        apiPath = this.serverPrPath(workspace, repository);
        // DC supports state=ALL natively; omitting the param would default to OPEN.
        params = { state, limit, start };
        if (author) {
          params['role.1'] = 'AUTHOR';
          params['username.1'] = author;
        }
      } else {
        apiPath = this.cloudPrPath(workspace, repository);
        params = {
          // Cloud has no ALL value — repeat the state param for each state.
          state: state === 'ALL' ? ['OPEN', 'MERGED', 'DECLINED'] : state,
          pagelen: limit,
          page: Math.floor(start / limit) + 1,
        };
        // Cloud removed `username` (GDPR); nickname is the queryable field.
        if (author) params['q'] = `author.nickname="${author}"`;
      }

      const response = await this.apiClient.makeRequest<any>('get', apiPath, undefined, {
        params,
        // Cloud's ALL expansion needs repeated bare `state=` params — axios's
        // default array serialization (`state[]=`) is rejected.
        paramsSerializer: (p: any) => {
          const search = new URLSearchParams();
          for (const [k, v] of Object.entries(p)) {
            if (v === undefined || v === null) continue;
            if (Array.isArray(v)) for (const item of v) search.append(k, String(item));
            else search.append(k, String(v));
          }
          return search.toString();
        },
      });
      const isServer = this.apiClient.getIsServer();
      const items = (response.values || []).map((pr: any) =>
        isServer ? formatServerPrListItem(pr) : formatCloudPrListItem(pr)
      );
      const hasMore = isServer ? serverPage(response).hasMore : !!response.next;
      return jsonContent(
        compactObject({
          pull_requests: items,
          total_count: response.size || undefined,
          has_more: hasMore || undefined,
          next_start: hasMore ? (isServer ? response.nextPageStart : start + limit) : undefined,
        })
      );
    } catch (error) {
      return this.apiClient.handleApiError(error, `listing pull requests in ${workspace}/${repository ?? '(all)'}`) as ToolResponse;
    }
  }

  // ── create_pull_request ────────────────────────────────────────────────────

  async handleCreatePullRequest(args: any): Promise<ToolResponse> {
    if (!isCreatePullRequestArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for create_pull_request');
    }
    const { workspace, repository, title, source_branch, destination_branch, description, reviewers, close_source_branch, attachments } = args;

    try {
      const finalDescription = await this.uploadAndEmbed(workspace, repository, description || '', attachments);
      let apiPath: string;
      let requestBody: any;
      if (this.apiClient.getIsServer()) {
        apiPath = this.serverPrPath(workspace, repository);
        const refRepo = { slug: repository, project: { key: workspace } };
        requestBody = {
          title,
          description: finalDescription,
          fromRef: { id: `refs/heads/${source_branch}`, repository: refRepo },
          toRef: { id: `refs/heads/${destination_branch}`, repository: refRepo },
          reviewers: reviewers?.map((r: string) => ({ user: { name: r } })) || [],
        };
      } else {
        apiPath = this.cloudPrPath(workspace, repository);
        requestBody = {
          title,
          description: finalDescription,
          source: { branch: { name: source_branch } },
          destination: { branch: { name: destination_branch } },
          close_source_branch: close_source_branch || false,
          reviewers: reviewers?.map((r: string) => ({ username: r })) || [],
        };
      }
      const pr = await this.apiClient.makeRequest<any>('post', apiPath, requestBody);
      return jsonContent(
        compactObject({
          id: pr.id,
          version: pr.version,
          state: pr.state,
          web_url: this.apiClient.getIsServer()
            ? `${this.baseUrl}/projects/${workspace}/repos/${repository}/pull-requests/${pr.id}`
            : pr.links?.html?.href,
        })
      );
    } catch (error) {
      return this.apiClient.handleApiError(error, `creating pull request in ${workspace}/${repository}`) as ToolResponse;
    }
  }

  // ── update_pull_request ────────────────────────────────────────────────────

  async handleUpdatePullRequest(args: any): Promise<ToolResponse> {
    if (!isUpdatePullRequestArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for update_pull_request');
    }
    const { workspace, repository, pull_request_id, title, description, destination_branch, reviewers, attachments } = args;

    try {
      if (this.apiClient.getIsServer()) {
        const apiPath = this.serverPrPath(workspace, repository, pull_request_id);
        // Skip the read when the caller supplied everything a blind write
        // needs: version + explicit reviewers + (description or no attachments).
        const canSkipRead =
          typeof args.version === 'number' &&
          reviewers !== undefined &&
          (description !== undefined || !attachments?.length);
        const currentPr = canSkipRead ? undefined : await this.apiClient.makeRequest<any>('get', apiPath);

        const requestBody: any = { version: args.version ?? currentPr.version };
        if (title !== undefined) requestBody.title = title;
        const markups = attachments?.length ? await this.uploadMarkups(workspace, repository, attachments) : [];
        if (markups.length > 0 || description !== undefined) {
          const baseDescription = description !== undefined ? description : (currentPr?.description || '');
          requestBody.description = appendAttachments(baseDescription, markups);
        }
        if (destination_branch !== undefined) {
          requestBody.toRef = { id: `refs/heads/${destination_branch}`, repository: { slug: repository, project: { key: workspace } } };
        }
        if (reviewers !== undefined) {
          const existingByName = new Map((currentPr?.reviewers ?? []).map((r: any) => [r.user.name, r]));
          requestBody.reviewers = reviewers.map((username: string) => existingByName.get(username) ?? { user: { name: username } });
        } else {
          requestBody.reviewers = currentPr.reviewers;
        }

        const pr = await this.withVersionRetry(
          () => this.apiClient.makeRequest<any>('put', apiPath, requestBody),
          async () => {
            const fresh = await this.apiClient.makeRequest<any>('get', apiPath);
            requestBody.version = fresh.version;
            if (reviewers === undefined) requestBody.reviewers = fresh.reviewers;
            // Attachments-only edits derived the description from the
            // pre-conflict read — rebuild from the fresh one so the retry
            // doesn't overwrite the concurrent description change.
            if (description === undefined && markups.length > 0) {
              requestBody.description = appendAttachments(fresh.description || '', markups);
            }
          },
          typeof args.version === 'number'
        );
        return jsonContent(compactObject({ id: pr.id, version: pr.version, state: pr.state, title: pr.title }));
      }

      // Cloud
      const apiPath = this.cloudPrPath(workspace, repository, pull_request_id);
      const requestBody: any = {};
      if (title !== undefined) requestBody.title = title;
      if (attachments?.length || description !== undefined) {
        requestBody.description = await this.uploadAndEmbed(workspace, repository, description || '', attachments);
      }
      if (destination_branch !== undefined) requestBody.destination = { branch: { name: destination_branch } };
      if (reviewers !== undefined) requestBody.reviewers = reviewers.map((r: string) => ({ username: r }));
      const pr = await this.apiClient.makeRequest<any>('put', apiPath, requestBody);
      return jsonContent(compactObject({ id: pr.id, state: pr.state, title: pr.title }));
    } catch (error) {
      return this.apiClient.handleApiError(error, `updating pull request ${pull_request_id} in ${workspace}/${repository}`) as ToolResponse;
    }
  }

  /**
   * Run a versioned write. Semantics depend on where the version came from:
   *  - caller-supplied `version` = explicit compare-and-swap — a 409 is
   *    surfaced (silently retrying would clobber the concurrent edit the
   *    caller asked us to detect);
   *  - server-fetched version = convenience — refresh once and retry.
   */
  private async withVersionRetry<T>(
    write: () => Promise<T>,
    refresh: () => Promise<void>,
    callerSuppliedVersion: boolean
  ): Promise<T> {
    try {
      return await write();
    } catch (error: any) {
      if (error?.status === 409) {
        if (callerSuppliedVersion) {
          throw {
            ...error,
            message:
              'Concurrent modification detected: the supplied version is stale. ' +
              'Re-read the entity for its current version, or omit `version` to write against the latest state.',
          };
        }
        await refresh();
        return await write();
      }
      throw error;
    }
  }

  // ── merge / decline ────────────────────────────────────────────────────────

  async handleMergePullRequest(args: any): Promise<ToolResponse> {
    if (!isMergePullRequestArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for merge_pull_request');
    }
    const { workspace, repository, pull_request_id, merge_strategy, close_source_branch, commit_message } = args;

    try {
      if (this.apiClient.getIsServer()) {
        const mergePath = `${this.serverPrPath(workspace, repository, pull_request_id)}/merge`;
        const requestBody: any = {
          version:
            args.version ??
            (await this.apiClient.makeRequest<any>('get', this.serverPrPath(workspace, repository, pull_request_id))).version,
        };
        if (commit_message) requestBody.message = commit_message;
        const result = await this.withVersionRetry(
          () => this.apiClient.makeRequest<any>('post', mergePath, requestBody),
          async () => {
            const fresh = await this.apiClient.makeRequest<any>('get', this.serverPrPath(workspace, repository, pull_request_id));
            requestBody.version = fresh.version;
          },
          typeof args.version === 'number'
        );
        // The target branch just moved — drop its memoized head so snapshot
        // reads immediately see the merged content.
        const targetBranch: string | undefined = result?.toRef?.displayId;
        if (targetBranch) this.apiClient.invalidateRef(workspace, repository, targetBranch);
        this.apiClient.invalidateRef(workspace, repository, undefined);
        return jsonContent(
          compactObject({ merged: true, pull_request_id, merge_commit: result.properties?.mergeCommit?.id, state: result.state })
        );
      }

      const requestBody: any = {};
      // Tool enum uses hyphens; the Cloud API wants underscores.
      if (merge_strategy) requestBody.merge_strategy = merge_strategy.replace(/-/g, '_');
      if (close_source_branch !== undefined) requestBody.close_source_branch = close_source_branch;
      if (commit_message) requestBody.message = commit_message;
      const result = await this.apiClient.makeRequest<any>(
        'post',
        `${this.cloudPrPath(workspace, repository, pull_request_id)}/merge`,
        requestBody
      );
      const cloudTarget: string | undefined = result?.destination?.branch?.name;
      if (cloudTarget) this.apiClient.invalidateRef(workspace, repository, cloudTarget);
      this.apiClient.invalidateRef(workspace, repository, undefined);
      return jsonContent(compactObject({ merged: true, pull_request_id, merge_commit: result.merge_commit?.hash }));
    } catch (error) {
      return this.apiClient.handleApiError(error, `merging pull request ${pull_request_id} in ${workspace}/${repository}`) as ToolResponse;
    }
  }

  async handleDeclinePullRequest(args: any): Promise<ToolResponse> {
    if (!isDeclinePullRequestArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for decline_pull_request');
    }
    const { workspace, repository, pull_request_id, comment } = args;

    try {
      if (this.apiClient.getIsServer()) {
        const declinePath = `${this.serverPrPath(workspace, repository, pull_request_id)}/decline`;
        let version =
          args.version ??
          (await this.apiClient.makeRequest<any>('get', this.serverPrPath(workspace, repository, pull_request_id))).version;
        await this.withVersionRetry(
          () => this.apiClient.makeRequest('post', declinePath, undefined, { params: { version } }),
          async () => {
            const fresh = await this.apiClient.makeRequest<any>('get', this.serverPrPath(workspace, repository, pull_request_id));
            version = fresh.version;
          },
          typeof args.version === 'number'
        );
      } else {
        // Cloud decline takes no version — no read needed.
        await this.apiClient.makeRequest('post', `${this.cloudPrPath(workspace, repository, pull_request_id)}/decline`);
      }

      let commentNote = '';
      if (comment) {
        try {
          const commentResult = await this.handleAddComment({ workspace, repository, pull_request_id, comment_text: comment });
          commentNote = commentResult.isError
            ? ` Comment FAILED: ${String((commentResult.content[0] as any)?.text ?? 'unknown error')}`
            : ' Comment added.';
        } catch (commentError: any) {
          commentNote = ` Comment FAILED: ${commentError?.message ?? commentError}`;
        }
      }
      return textContent(`Pull request #${pull_request_id} declined.${commentNote}`);
    } catch (error: any) {
      if (error?.isAxiosError) {
        return this.apiClient.handleApiError(error, `declining pull request ${pull_request_id} in ${workspace}/${repository}`) as ToolResponse;
      }
      const details = capDetails(error?.response?.data, this.cfg.output.errorDetailsMax);
      return errorContent(`Failed to decline pull request: ${error?.message ?? error}${details ? `\ndetails: ${details}` : ''}`);
    }
  }

  // ── add_comment (comments, replies, inline, suggestions, tasks) ────────────

  async handleAddComment(args: any): Promise<ToolResponse> {
    if (!isAddCommentArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for add_comment');
    }
    let {
      workspace, repository, pull_request_id, comment_text, parent_comment_id,
      file_path, line_number, line_type, suggestion, suggestion_end_line,
      code_snippet, search_context, match_strategy = 'strict', severity, attachments,
    } = args;

    if (code_snippet && !line_number && file_path) {
      const resolved = await this.resolveLineFromCode(
        workspace, repository, pull_request_id, file_path, code_snippet, search_context, match_strategy
      );
      line_number = resolved.line_number;
      line_type = resolved.line_type;
    }
    if (suggestion && (!file_path || !line_number)) {
      throw new McpError(ErrorCode.InvalidParams, 'Suggestions require file_path and line_number');
    }
    const isInline = file_path !== undefined && line_number !== undefined;

    let finalText = comment_text;
    if (suggestion) {
      finalText = formatSuggestionComment(comment_text, suggestion, line_number, suggestion_end_line || line_number);
    }

    try {
      finalText = await this.uploadAndEmbed(workspace, repository, finalText, attachments);

      let apiPath: string;
      let requestBody: any;
      if (this.apiClient.getIsServer()) {
        apiPath = `${this.serverPrPath(workspace, repository, pull_request_id)}/comments`;
        requestBody = { text: finalText };
        if (severity === 'BLOCKER') requestBody.severity = 'BLOCKER';
        if (parent_comment_id !== undefined) requestBody.parent = { id: parent_comment_id };
        if (isInline) {
          requestBody.anchor = {
            line: line_number,
            lineType: line_type || 'CONTEXT',
            fileType: line_type === 'REMOVED' ? 'FROM' : 'TO',
            path: file_path,
            diffType: 'EFFECTIVE',
          };
        }
      } else {
        if (severity === 'BLOCKER') {
          return errorContent('Tasks (severity=BLOCKER) are only supported on Bitbucket Server / Data Center.');
        }
        apiPath = `${this.cloudPrPath(workspace, repository, pull_request_id)}/comments`;
        requestBody = { content: { raw: finalText } };
        if (parent_comment_id !== undefined) requestBody.parent = { id: parent_comment_id };
        if (isInline) requestBody.inline = { to: line_number, path: file_path };
      }

      const comment = await this.apiClient.makeRequest<any>('post', apiPath, requestBody);
      return jsonContent(
        compactObject({
          id: comment.id,
          version: comment.version,
          is_task: severity === 'BLOCKER' || undefined,
          file_path: isInline ? file_path : undefined,
          line_number: isInline ? line_number : undefined,
        })
      );
    } catch (error) {
      return this.apiClient.handleApiError(
        error,
        `adding ${isInline ? 'inline ' : ''}comment to pull request ${pull_request_id} in ${workspace}/${repository}`
      ) as ToolResponse;
    }
  }

  // ── manage_comment (edit/delete/resolve/reopen/convert — comments & tasks) ─

  async handleManageComment(args: any): Promise<ToolResponse> {
    if (!isManageCommentArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for manage_comment');
    }
    const { workspace, repository, pull_request_id, comment_id, action, text } = args;
    const isServer = this.apiClient.getIsServer();

    try {
      if (!isServer) {
        const cloudBase = `${this.cloudPrPath(workspace, repository, pull_request_id)}/comments/${comment_id}`;
        switch (action) {
          case 'delete':
            await this.apiClient.makeRequest('delete', cloudBase);
            return textContent(`Comment #${comment_id} deleted.`);
          case 'edit':
            if (text === undefined) throw new McpError(ErrorCode.InvalidParams, 'edit requires text');
            await this.apiClient.makeRequest('put', cloudBase, { content: { raw: text } });
            return textContent(`Comment #${comment_id} updated.`);
          case 'resolve':
            await this.apiClient.makeRequest('post', `${cloudBase}/resolve`, {});
            return textContent(`#${comment_id} resolved.`);
          case 'reopen':
            await this.apiClient.makeRequest('delete', `${cloudBase}/resolve`);
            return textContent(`#${comment_id} reopened.`);
          default:
            return errorContent(`manage_comment action "${action}" is only supported on Bitbucket Server / Data Center (Cloud has no task severity).`);
        }
      }

      const commentPath = `${this.serverPrPath(workspace, repository, pull_request_id)}/comments/${comment_id}`;
      const callerSuppliedVersion = typeof args.version === 'number';
      const getVersion = async (): Promise<number> =>
        args.version ?? (await this.apiClient.makeRequest<any>('get', commentPath)).version;

      let version = await getVersion();
      const bodyFor = (): any => {
        switch (action) {
          case 'edit':
            if (text === undefined) throw new McpError(ErrorCode.InvalidParams, 'edit requires text');
            return { text, version };
          case 'resolve':
            return { state: 'RESOLVED', version };
          case 'reopen':
            return { state: 'OPEN', version };
          case 'to_task':
            return { severity: 'BLOCKER', version };
          case 'to_comment':
            return { severity: 'NORMAL', version };
          default:
            return undefined;
        }
      };

      if (action === 'delete') {
        await this.withVersionRetry(
          () => this.apiClient.makeRequest('delete', commentPath, undefined, { params: { version } }),
          async () => {
            args.version = undefined;
            version = await getVersion();
          },
          callerSuppliedVersion
        );
        return textContent(`Comment #${comment_id} deleted.`);
      }

      const result = await this.withVersionRetry(
        () => this.apiClient.makeRequest<any>('put', commentPath, bodyFor()),
        async () => {
          args.version = undefined;
          version = await getVersion();
        },
        callerSuppliedVersion
      );
      const messages: Record<string, string> = {
        edit: `Comment #${comment_id} updated (version ${result.version}).`,
        resolve: `#${comment_id} resolved.`,
        reopen: `#${comment_id} reopened.`,
        to_task: `Comment #${comment_id} converted to a task.`,
        to_comment: `Task #${comment_id} converted to a comment.`,
      };
      return textContent(messages[action]);
    } catch (error: any) {
      if (error?.status === 409) {
        return errorContent(
          `Cannot ${action} comment #${comment_id}: ${error?.message?.includes('Concurrent modification') ? error.message : 'it has replies or was modified concurrently.'}`
        );
      }
      return this.apiClient.handleApiError(error, `${action} on comment ${comment_id} in PR ${pull_request_id}`) as ToolResponse;
    }
  }

  // ── list_pr_commits ────────────────────────────────────────────────────────

  async handleListPrCommits(args: any): Promise<ToolResponse> {
    if (!isListPrCommitsArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for list_pr_commits');
    }
    const { workspace, repository, pull_request_id, include_build_status = false } = args;
    const limit = args.limit ?? this.cfg.pagination.defaultListLimit;
    const start = args.start ?? 0;

    try {
      let commits: FormattedCommit[];
      let hasMore: boolean;
      let nextStart: number | undefined;

      if (this.apiClient.getIsServer()) {
        const response = await this.apiClient.makeRequest<any>(
          'get',
          `${this.serverPrPath(workspace, repository, pull_request_id)}/commits`,
          undefined,
          { params: { limit, start } }
        );
        commits = (response.values || []).map(formatServerCommit);
        ({ hasMore, nextStart } = serverPage(response));
      } else {
        const response = await this.apiClient.makeRequest<any>(
          'get',
          `${this.cloudPrPath(workspace, repository, pull_request_id)}/commits`,
          undefined,
          { params: { pagelen: limit, page: Math.floor(start / limit) + 1 } }
        );
        commits = (response.values || []).map(formatCloudCommit);
        hasMore = !!response.next;
        nextStart = hasMore ? start + limit : undefined;
      }

      if (include_build_status && this.apiClient.getIsServer() && commits.length > 0) {
        const summaries = await this.apiClient.getBuildSummaries(workspace, repository, commits.map(c => c.hash));
        commits = commits.map(c => {
          const b = summaries[c.hash];
          return b
            ? { ...c, build_status: { successful: b.successful || 0, failed: b.failed || 0, in_progress: b.inProgress || 0 } }
            : c;
        }) as FormattedCommit[];
      }

      return jsonContent(
        compactObject({
          pull_request_id,
          commits: commits.map(compactCommit),
          has_more: hasMore || undefined,
          next_start: nextStart,
        })
      );
    } catch (error) {
      return this.apiClient.handleApiError(error, `listing commits for pull request ${pull_request_id} in ${workspace}/${repository}`) as ToolResponse;
    }
  }

  // ── code_snippet → line resolution (single-FILE diff, server-side scoped) ──

  private async resolveLineFromCode(
    workspace: string,
    repository: string,
    pullRequestId: number,
    filePath: string,
    codeSnippet: string,
    searchContext?: { before?: string[]; after?: string[] },
    matchStrategy: 'strict' | 'best' = 'strict'
  ): Promise<{ line_number: number; line_type: 'ADDED' | 'REMOVED' | 'CONTEXT' }> {
    try {
      // Fetch only THIS file's diff — the endpoints support a path scope.
      let diffContent: string;
      if (this.apiClient.getIsServer()) {
        diffContent = await this.apiClient.makeRequest<string>(
          'get',
          `${this.serverPrPath(workspace, repository, pullRequestId)}/diff/${encodeRepoPath(filePath)}`,
          undefined,
          { params: { contextLines: 3 }, headers: { Accept: 'text/plain' }, responseType: 'text' }
        );
      } else {
        diffContent = await this.apiClient.makeRequest<string>(
          'get',
          `${this.cloudPrPath(workspace, repository, pullRequestId)}/diff`,
          undefined,
          { params: { context: 3, path: filePath }, headers: { Accept: 'text/plain' }, responseType: 'text' }
        );
      }

      const parser = new DiffParser();
      const sections = parser.parseDiffIntoSections(diffContent);
      const fileSection = sections.find(s => s.filePath === filePath) ?? sections[0];
      if (!fileSection) {
        throw new McpError(ErrorCode.InvalidParams, `File ${filePath} not found in pull request diff`);
      }

      const matches = this.findCodeMatches(fileSection.content, codeSnippet, searchContext);
      if (matches.length === 0) {
        throw new McpError(ErrorCode.InvalidParams, `Code snippet not found in ${filePath}`);
      }
      if (matches.length === 1 || matchStrategy === 'best') {
        const best = matches.sort((a, b) => b.confidence - a.confidence)[0];
        return { line_number: best.line_number, line_type: best.line_type };
      }

      const listed = matches.slice(0, this.cfg.output.snippetMatchListMax);
      throw new McpError(
        ErrorCode.InvalidParams,
        `Code snippet matches ${matches.length} locations in ${filePath}: ` +
          listed.map(m => `line ${m.line_number} (${m.line_type})`).join(', ') +
          (matches.length > listed.length ? ` …and ${matches.length - listed.length} more.` : '') +
          ` Add search_context, use match_strategy:"best", or pass line_number directly.`
      );
    } catch (error) {
      if (error instanceof McpError) throw error;
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to resolve line from code: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private findCodeMatches(
    diffContent: string,
    codeSnippet: string,
    searchContext?: { before?: string[]; after?: string[] }
  ): CodeMatch[] {
    const lines = diffContent.split('\n');
    const matches: CodeMatch[] = [];
    let inHunk = false;
    let currentHunkDestStart = 0;
    let currentHunkSrcStart = 0;
    let destPositionInHunk = 0;
    let srcPositionInHunk = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('@@')) {
        // Counts are optional in git's short form (`@@ -1 +1 @@`).
        const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match) {
          currentHunkSrcStart = parseInt(match[1]);
          currentHunkDestStart = parseInt(match[2]);
          inHunk = true;
          destPositionInHunk = 0;
          srcPositionInHunk = 0;
          continue;
        }
      }
      if (!inHunk) continue;
      if (line === '') {
        inHunk = false;
        continue;
      }
      // "\ No newline at end of file" is metadata, not the end of the hunk.
      if (line.startsWith('\\')) continue;

      let lineType: 'ADDED' | 'REMOVED' | 'CONTEXT';
      let lineContent = '';
      let lineNumber = 0;
      if (line.startsWith('+')) {
        lineType = 'ADDED';
        lineContent = line.substring(1);
        lineNumber = currentHunkDestStart + destPositionInHunk;
        destPositionInHunk++;
      } else if (line.startsWith('-')) {
        lineType = 'REMOVED';
        lineContent = line.substring(1);
        lineNumber = currentHunkSrcStart + srcPositionInHunk;
        srcPositionInHunk++;
      } else if (line.startsWith(' ')) {
        lineType = 'CONTEXT';
        lineContent = line.substring(1);
        lineNumber = currentHunkDestStart + destPositionInHunk;
        destPositionInHunk++;
        srcPositionInHunk++;
      } else {
        inHunk = false;
        continue;
      }

      if (lineContent.trim() === codeSnippet.trim()) {
        matches.push({
          line_number: lineNumber,
          line_type: lineType,
          exact_content: codeSnippet,
          preview: '',
          confidence: this.calculateConfidence(lines, i, searchContext, lineType),
          context: { lines_before: [], lines_after: [] },
        });
      }
    }
    return matches;
  }

  private calculateConfidence(
    lines: string[],
    index: number,
    searchContext?: { before?: string[]; after?: string[] },
    lineType?: 'ADDED' | 'REMOVED' | 'CONTEXT'
  ): number {
    let confidence = 0.5;
    if (!searchContext) return confidence;
    if (searchContext.before) {
      let matched = 0;
      for (let j = 0; j < searchContext.before.length; j++) {
        const contextLine = searchContext.before[searchContext.before.length - 1 - j];
        const checkIndex = index - j - 1;
        if (checkIndex >= 0 && lines[checkIndex].substring(1).trim() === contextLine.trim()) matched++;
      }
      confidence += (matched / searchContext.before.length) * 0.3;
    }
    if (searchContext.after) {
      let matched = 0;
      for (let j = 0; j < searchContext.after.length; j++) {
        const checkIndex = index + j + 1;
        if (checkIndex < lines.length && lines[checkIndex].substring(1).trim() === searchContext.after[j].trim()) matched++;
      }
      confidence += (matched / searchContext.after.length) * 0.3;
    }
    if (lineType === 'ADDED') confidence += 0.1;
    return Math.min(confidence, 1.0);
  }
}
