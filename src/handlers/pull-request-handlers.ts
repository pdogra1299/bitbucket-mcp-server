import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BitbucketApiClient } from '../utils/api-client.js';
import { formatServerResponse, formatCloudResponse, formatServerCommit, formatCloudCommit } from '../utils/formatters.js';
import { formatSuggestionComment } from '../utils/suggestion-formatter.js';
import { DiffParser } from '../utils/diff-parser.js';
import { 
  BitbucketServerPullRequest, 
  BitbucketCloudPullRequest, 
  BitbucketServerActivity,
  MergeInfo,
  BitbucketCloudComment,
  BitbucketCloudFileChange,
  FormattedComment,
  FormattedFileChange,
  CodeMatch,
  MultipleMatchesError,
  BitbucketServerCommit,
  BitbucketCloudCommit,
  FormattedCommit
} from '../types/bitbucket.js';
import {
  isGetPullRequestArgs,
  isListPullRequestsArgs,
  isCreatePullRequestArgs,
  isUpdatePullRequestArgs,
  isAddCommentArgs,
  isMergePullRequestArgs,
  isListPrCommitsArgs,
  isDeclinePullRequestArgs,
  isDeleteCommentArgs,
  isListPrTasksArgs,
  isCreatePrTaskArgs,
  isUpdatePrTaskArgs,
  isTaskIdArgs,
  isConvertCommentToTaskArgs
} from '../types/guards.js';

export class PullRequestHandlers {
  constructor(
    private apiClient: BitbucketApiClient,
    private baseUrl: string,
    private username: string
  ) {}

  private async getFilteredPullRequestDiff(
    workspace: string,
    repository: string,
    pullRequestId: number,
    filePath: string,
    contextLines: number = 3
  ): Promise<string> {
    let apiPath: string;
    let config: any = {};

    if (this.apiClient.getIsServer()) {
      // Bitbucket Server API
      apiPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pullRequestId}/diff`;
      config.params = { contextLines };
    } else {
      // Bitbucket Cloud API
      apiPath = `/repositories/${workspace}/${repository}/pullrequests/${pullRequestId}/diff`;
      config.params = { context: contextLines };
    }

    config.headers = { 'Accept': 'text/plain' };
    
    const rawDiff = await this.apiClient.makeRequest<string>('get', apiPath, undefined, config);

    const diffParser = new DiffParser();
    const sections = diffParser.parseDiffIntoSections(rawDiff);
    
    const filterOptions = {
      filePath: filePath
    };
    
    const filteredResult = diffParser.filterSections(sections, filterOptions);
    const filteredDiff = diffParser.reconstructDiff(filteredResult.sections);

    return filteredDiff;
  }

  async handleGetPullRequest(args: any) {
    if (!isGetPullRequestArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for get_pull_request'
      );
    }

    const { workspace, repository, pull_request_id } = args;

    try {
      const apiPath = this.apiClient.getIsServer()
        ? `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}`
        : `/repositories/${workspace}/${repository}/pullrequests/${pull_request_id}`;
      
      const pr = await this.apiClient.makeRequest<any>('get', apiPath);

      let mergeInfo: MergeInfo = {};

      if (this.apiClient.getIsServer() && pr.state === 'MERGED') {
        try {
          const activitiesPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}/activities`;
          const activitiesResponse = await this.apiClient.makeRequest<any>('get', activitiesPath, undefined, {
            params: { limit: 100 }
          });
          
          const activities = activitiesResponse.values || [];
          const mergeActivity = activities.find((a: BitbucketServerActivity) => a.action === 'MERGED');
          
          if (mergeActivity) {
            mergeInfo.mergeCommitHash = mergeActivity.commit?.id || null;
            mergeInfo.mergedBy = mergeActivity.user?.displayName || null;
            mergeInfo.mergedAt = new Date(mergeActivity.createdDate).toISOString();
            
            if (mergeActivity.commit?.id) {
              try {
                const commitPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/commits/${mergeActivity.commit.id}`;
                const commitResponse = await this.apiClient.makeRequest<any>('get', commitPath);
                mergeInfo.mergeCommitMessage = commitResponse.message || null;
              } catch (commitError) {
                console.error('Failed to fetch merge commit message:', commitError);
              }
            }
          }
        } catch (activitiesError) {
          console.error('Failed to fetch PR activities:', activitiesError);
        }
      }

      let comments: FormattedComment[] = [];
      let activeCommentCount = 0;
      let totalCommentCount = 0;
      let fileChanges: FormattedFileChange[] = [];
      let fileChangesSummary: any = null;

      try {
        const [commentsResult, fileChangesResult] = await Promise.all([
          this.fetchPullRequestComments(workspace, repository, pull_request_id),
          this.fetchPullRequestFileChanges(workspace, repository, pull_request_id)
        ]);

        comments = commentsResult.comments;
        activeCommentCount = commentsResult.activeCount;
        totalCommentCount = commentsResult.totalCount;
        fileChanges = fileChangesResult.fileChanges;
        fileChangesSummary = fileChangesResult.summary;
      } catch (error) {
        console.error('Failed to fetch additional PR data:', error);
      }

      const formattedResponse = this.apiClient.getIsServer() 
        ? formatServerResponse(pr as BitbucketServerPullRequest, mergeInfo, this.baseUrl)
        : formatCloudResponse(pr as BitbucketCloudPullRequest);

      const enhancedResponse = {
        ...formattedResponse,
        active_comments: comments,
        active_comment_count: activeCommentCount,
        total_comment_count: totalCommentCount,
        file_changes: fileChanges,
        file_changes_summary: fileChangesSummary
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(enhancedResponse, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.apiClient.handleApiError(error, `getting pull request ${pull_request_id} in ${workspace}/${repository}`);
    }
  }

  async handleListPullRequests(args: any) {
    if (!isListPullRequestsArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for list_pull_requests'
      );
    }

    const { workspace, repository, state = 'OPEN', author, limit = 25, start = 0 } = args;

    try {
      let apiPath: string;
      let params: any = {};

      if (this.apiClient.getIsServer()) {
        // Bitbucket Server API
        apiPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests`;
        params = {
          state: state === 'ALL' ? undefined : state,
          limit,
          start,
        };
        if (author) {
          params['role.1'] = 'AUTHOR';
          params['username.1'] = author;
        }
      } else {
        // Bitbucket Cloud API
        apiPath = `/repositories/${workspace}/${repository}/pullrequests`;
        params = {
          state: state === 'ALL' ? undefined : state,
          pagelen: limit,
          page: Math.floor(start / limit) + 1,
        };
        if (author) {
          params['q'] = `author.username="${author}"`;
        }
      }

      const response = await this.apiClient.makeRequest<any>('get', apiPath, undefined, { params });

      let pullRequests: any[] = [];
      let totalCount = 0;
      let nextPageStart = null;

      if (this.apiClient.getIsServer()) {
        pullRequests = (response.values || []).map((pr: BitbucketServerPullRequest) => 
          formatServerResponse(pr, undefined, this.baseUrl)
        );
        totalCount = response.size || 0;
        if (!response.isLastPage && response.nextPageStart !== undefined) {
          nextPageStart = response.nextPageStart;
        }
      } else {
        pullRequests = (response.values || []).map((pr: BitbucketCloudPullRequest) => 
          formatCloudResponse(pr)
        );
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
              pull_requests: pullRequests,
              total_count: totalCount,
              start,
              limit,
              has_more: nextPageStart !== null,
              next_start: nextPageStart,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.apiClient.handleApiError(error, `listing pull requests in ${workspace}/${repository}`);
    }
  }

  async handleCreatePullRequest(args: any) {
    if (!isCreatePullRequestArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for create_pull_request'
      );
    }

    const { workspace, repository, title, source_branch, destination_branch, description, reviewers, close_source_branch } = args;

    try {
      let apiPath: string;
      let requestBody: any;

      if (this.apiClient.getIsServer()) {
        // Bitbucket Server API
        apiPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests`;
        requestBody = {
          title,
          description: description || '',
          fromRef: {
            id: `refs/heads/${source_branch}`,
            repository: {
              slug: repository,
              project: {
                key: workspace
              }
            }
          },
          toRef: {
            id: `refs/heads/${destination_branch}`,
            repository: {
              slug: repository,
              project: {
                key: workspace
              }
            }
          },
          reviewers: reviewers?.map(r => ({ user: { name: r } })) || []
        };
      } else {
        // Bitbucket Cloud API
        apiPath = `/repositories/${workspace}/${repository}/pullrequests`;
        requestBody = {
          title,
          description: description || '',
          source: {
            branch: {
              name: source_branch
            }
          },
          destination: {
            branch: {
              name: destination_branch
            }
          },
          close_source_branch: close_source_branch || false,
          reviewers: reviewers?.map(r => ({ username: r })) || []
        };
      }

      const pr = await this.apiClient.makeRequest<any>('post', apiPath, requestBody);
      
      const formattedResponse = this.apiClient.getIsServer() 
        ? formatServerResponse(pr as BitbucketServerPullRequest, undefined, this.baseUrl)
        : formatCloudResponse(pr as BitbucketCloudPullRequest);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'Pull request created successfully',
              pull_request: formattedResponse
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.apiClient.handleApiError(error, `creating pull request in ${workspace}/${repository}`);
    }
  }

  async handleUpdatePullRequest(args: any) {
    if (!isUpdatePullRequestArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for update_pull_request'
      );
    }

    const { workspace, repository, pull_request_id, title, description, destination_branch, reviewers } = args;

    try {
      let apiPath: string;
      let requestBody: any = {};

      if (this.apiClient.getIsServer()) {
        // Bitbucket Server API
        apiPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}`;
        
        // First get the current PR to get version number and existing data
        const currentPr = await this.apiClient.makeRequest<any>('get', apiPath);
        
        requestBody.version = currentPr.version;
        if (title !== undefined) requestBody.title = title;
        if (description !== undefined) requestBody.description = description;
        if (destination_branch !== undefined) {
          requestBody.toRef = {
            id: `refs/heads/${destination_branch}`,
            repository: {
              slug: repository,
              project: {
                key: workspace
              }
            }
          };
        }
        
        // Handle reviewers: preserve existing ones if not explicitly updating
        if (reviewers !== undefined) {
          // User wants to update reviewers
          // Create a map of existing reviewers for preservation of approval status
          const existingReviewersMap = new Map(
            currentPr.reviewers.map((r: any) => [r.user.name, r])
          );
          
          requestBody.reviewers = reviewers.map(username => {
            const existing = existingReviewersMap.get(username);
            if (existing) {
              // Preserve existing reviewer's full data including approval status
              return existing;
            } else {
              // Add new reviewer (without approval status)
              return { user: { name: username } };
            }
          });
        } else {
          // No reviewers provided - preserve existing reviewers with their full data
          requestBody.reviewers = currentPr.reviewers;
        }
      } else {
        // Bitbucket Cloud API
        apiPath = `/repositories/${workspace}/${repository}/pullrequests/${pull_request_id}`;
        
        if (title !== undefined) requestBody.title = title;
        if (description !== undefined) requestBody.description = description;
        if (destination_branch !== undefined) {
          requestBody.destination = {
            branch: {
              name: destination_branch
            }
          };
        }
        if (reviewers !== undefined) {
          requestBody.reviewers = reviewers.map(r => ({ username: r }));
        }
      }

      const pr = await this.apiClient.makeRequest<any>('put', apiPath, requestBody);
      
      const formattedResponse = this.apiClient.getIsServer() 
        ? formatServerResponse(pr as BitbucketServerPullRequest, undefined, this.baseUrl)
        : formatCloudResponse(pr as BitbucketCloudPullRequest);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'Pull request updated successfully',
              pull_request: formattedResponse
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.apiClient.handleApiError(error, `updating pull request ${pull_request_id} in ${workspace}/${repository}`);
    }
  }

  async handleAddComment(args: any) {
    if (!isAddCommentArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for add_comment'
      );
    }

    let { 
      workspace, 
      repository, 
      pull_request_id, 
      comment_text, 
      parent_comment_id, 
      file_path, 
      line_number, 
      line_type,
      suggestion,
      suggestion_end_line,
      code_snippet,
      search_context,
      match_strategy = 'strict'
    } = args;

    let sequentialPosition: number | undefined;
    if (code_snippet && !line_number && file_path) {
      try {
        const resolved = await this.resolveLineFromCode(
          workspace,
          repository,
          pull_request_id,
          file_path,
          code_snippet,
          search_context,
          match_strategy
        );
        
        line_number = resolved.line_number;
        line_type = resolved.line_type;
        sequentialPosition = resolved.sequential_position;
      } catch (error) {
        throw error;
      }
    }

    if (suggestion && (!file_path || !line_number)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Suggestions require file_path and line_number to be specified'
      );
    }

    const isInlineComment = file_path !== undefined && line_number !== undefined;

    let finalCommentText = comment_text;
    if (suggestion) {
      finalCommentText = formatSuggestionComment(
        comment_text,
        suggestion,
        line_number,
        suggestion_end_line || line_number
      );
    }

    try {
      let apiPath: string;
      let requestBody: any;

      if (this.apiClient.getIsServer()) {
        // Bitbucket Server API
        apiPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}/comments`;
        requestBody = {
          text: finalCommentText
        };
        
        if (parent_comment_id !== undefined) {
          requestBody.parent = { id: parent_comment_id };
        }
        
        if (isInlineComment) {
          requestBody.anchor = {
            line: line_number,
            lineType: line_type || 'CONTEXT', 
            fileType: line_type === 'REMOVED' ? 'FROM' : 'TO',
            path: file_path,
            diffType: 'EFFECTIVE'
          };
          
        }
      } else {
        // Bitbucket Cloud API
        apiPath = `/repositories/${workspace}/${repository}/pullrequests/${pull_request_id}/comments`;
        requestBody = {
          content: {
            raw: finalCommentText
          }
        };
        
        if (parent_comment_id !== undefined) {
          requestBody.parent = { id: parent_comment_id };
        }
        
        if (isInlineComment) {
          requestBody.inline = {
            to: line_number,
            path: file_path
          };
        }
      }

      const comment = await this.apiClient.makeRequest<any>('post', apiPath, requestBody);

      const responseMessage = suggestion 
        ? 'Comment with code suggestion added successfully'
        : (isInlineComment ? 'Inline comment added successfully' : 'Comment added successfully');

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: responseMessage,
              comment: {
                id: comment.id,
                text: this.apiClient.getIsServer() ? comment.text : comment.content.raw,
                author: this.apiClient.getIsServer() ? comment.author.displayName : comment.user.display_name,
                created_on: this.apiClient.getIsServer() ? new Date(comment.createdDate).toLocaleString() : comment.created_on,
                file_path: isInlineComment ? file_path : undefined,
                line_number: isInlineComment ? line_number : undefined,
                line_type: isInlineComment ? (line_type || 'CONTEXT') : undefined,
                has_suggestion: !!suggestion,
                suggestion_lines: suggestion ? (suggestion_end_line ? `${line_number}-${suggestion_end_line}` : `${line_number}`) : undefined
              }
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.apiClient.handleApiError(error, `adding ${isInlineComment ? 'inline ' : ''}comment to pull request ${pull_request_id} in ${workspace}/${repository}`);
    }
  }

  async handleMergePullRequest(args: any) {
    if (!isMergePullRequestArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for merge_pull_request'
      );
    }

    const { workspace, repository, pull_request_id, merge_strategy, close_source_branch, commit_message } = args;

    try {
      let apiPath: string;
      let requestBody: any = {};

      if (this.apiClient.getIsServer()) {
        // Bitbucket Server API
        apiPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}/merge`;
        
        // Get current PR version
        const prPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}`;
        const currentPr = await this.apiClient.makeRequest<any>('get', prPath);
        
        requestBody.version = currentPr.version;
        if (commit_message) {
          requestBody.message = commit_message;
        }
      } else {
        // Bitbucket Cloud API
        apiPath = `/repositories/${workspace}/${repository}/pullrequests/${pull_request_id}/merge`;
        
        if (merge_strategy) {
          requestBody.merge_strategy = merge_strategy;
        }
        if (close_source_branch !== undefined) {
          requestBody.close_source_branch = close_source_branch;
        }
        if (commit_message) {
          requestBody.message = commit_message;
        }
      }

      const result = await this.apiClient.makeRequest<any>('post', apiPath, requestBody);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'Pull request merged successfully',
              merge_commit: this.apiClient.getIsServer() ? result.properties?.mergeCommit : result.merge_commit?.hash,
              pull_request_id
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.apiClient.handleApiError(error, `merging pull request ${pull_request_id} in ${workspace}/${repository}`);
    }
  }

  private async fetchPullRequestComments(
    workspace: string,
    repository: string,
    pullRequestId: number
  ): Promise<{ comments: FormattedComment[]; activeCount: number; totalCount: number }> {
    try {
      let comments: FormattedComment[] = [];
      let activeCount = 0;
      let totalCount = 0;

      if (this.apiClient.getIsServer()) {
        const processNestedComments = (comment: any, anchor: any): FormattedComment => {
          const formattedComment: FormattedComment = {
            id: comment.id,
            author: comment.author.displayName,
            text: comment.text,
            created_on: new Date(comment.createdDate).toISOString(),
            is_inline: !!anchor,
            file_path: anchor?.path,
            line_number: anchor?.line,
            state: comment.state
          };

          if (comment.comments && comment.comments.length > 0) {
            formattedComment.replies = comment.comments
              .filter((reply: any) => {
                if (reply.state === 'RESOLVED') return false;
                if (anchor && anchor.orphaned === true) return false;
                return true;
              })
              .map((reply: any) => processNestedComments(reply, anchor));
          }

          return formattedComment;
        };

        const countAllComments = (comment: any): number => {
          let count = 1;
          if (comment.comments && comment.comments.length > 0) {
            count += comment.comments.reduce((sum: number, reply: any) => sum + countAllComments(reply), 0);
          }
          return count;
        };

        const countActiveComments = (comment: any, anchor: any): number => {
          let count = 0;
          
          if (comment.state !== 'RESOLVED' && (!anchor || anchor.orphaned !== true)) {
            count = 1;
          }
          
          if (comment.comments && comment.comments.length > 0) {
            count += comment.comments.reduce((sum: number, reply: any) => sum + countActiveComments(reply, anchor), 0);
          }
          
          return count;
        };

        const apiPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pullRequestId}/activities`;
        const response = await this.apiClient.makeRequest<any>('get', apiPath, undefined, {
          params: { limit: 1000 }
        });

        const activities = response.values || [];
        
        const commentActivities = activities.filter((a: any) => 
          a.action === 'COMMENTED' && a.comment
        );

        totalCount = commentActivities.reduce((sum: number, activity: any) => {
          return sum + countAllComments(activity.comment);
        }, 0);

        activeCount = commentActivities.reduce((sum: number, activity: any) => {
          return sum + countActiveComments(activity.comment, activity.commentAnchor);
        }, 0);

        const processedComments = commentActivities
          .filter((a: any) => {
            const c = a.comment;
            const anchor = a.commentAnchor;
            
            if (c.state === 'RESOLVED') return false;
            if (anchor && anchor.orphaned === true) return false;
            
            return true;
          })
          .map((a: any) => processNestedComments(a.comment, a.commentAnchor));

        comments = processedComments.slice(0, 20);
      } else {
        const apiPath = `/repositories/${workspace}/${repository}/pullrequests/${pullRequestId}/comments`;
        const response = await this.apiClient.makeRequest<any>('get', apiPath, undefined, {
          params: { pagelen: 100 }
        });

        const allComments = response.values || [];
        totalCount = allComments.length;

        const activeComments = allComments
          .filter((c: BitbucketCloudComment) => !c.deleted && !c.resolved)
          .slice(0, 20);

        activeCount = allComments.filter((c: BitbucketCloudComment) => !c.deleted && !c.resolved).length;

        comments = activeComments.map((c: BitbucketCloudComment) => ({
          id: c.id,
          author: c.user.display_name,
          text: c.content.raw,
          created_on: c.created_on,
          is_inline: !!c.inline,
          file_path: c.inline?.path,
          line_number: c.inline?.to
        }));
      }

      return { comments, activeCount, totalCount };
    } catch (error) {
      console.error('Failed to fetch comments:', error);
      return { comments: [], activeCount: 0, totalCount: 0 };
    }
  }

  private async fetchPullRequestFileChanges(
    workspace: string,
    repository: string,
    pullRequestId: number
  ): Promise<{ fileChanges: FormattedFileChange[]; summary: any }> {
    try {
      let fileChanges: FormattedFileChange[] = [];
      let totalLinesAdded = 0;
      let totalLinesRemoved = 0;

      if (this.apiClient.getIsServer()) {
        const apiPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pullRequestId}/changes`;
        const response = await this.apiClient.makeRequest<any>('get', apiPath, undefined, {
          params: { limit: 1000 }
        });

        const changes = response.values || [];

        fileChanges = changes.map((change: any) => {
          let status: 'added' | 'modified' | 'removed' | 'renamed' = 'modified';
          if (change.type === 'ADD') status = 'added';
          else if (change.type === 'DELETE') status = 'removed';
          else if (change.type === 'MOVE' || change.type === 'RENAME') status = 'renamed';

          return {
            path: change.path.toString,
            status,
            old_path: change.srcPath?.toString
          };
        });
      } else {
        const apiPath = `/repositories/${workspace}/${repository}/pullrequests/${pullRequestId}/diffstat`;
        const response = await this.apiClient.makeRequest<any>('get', apiPath, undefined, {
          params: { pagelen: 100 }
        });

        const diffstats = response.values || [];

        fileChanges = diffstats.map((stat: BitbucketCloudFileChange) => {
          totalLinesAdded += stat.lines_added;
          totalLinesRemoved += stat.lines_removed;

          return {
            path: stat.path,
            status: stat.type,
            old_path: stat.old?.path
          };
        });
      }

      const summary = {
        total_files: fileChanges.length
      };

      return { fileChanges, summary };
    } catch (error) {
      console.error('Failed to fetch file changes:', error);
      return {
        fileChanges: [],
        summary: {
          total_files: 0
        }
      };
    }
  }

  private async resolveLineFromCode(
    workspace: string,
    repository: string,
    pullRequestId: number,
    filePath: string,
    codeSnippet: string,
    searchContext?: { before?: string[]; after?: string[] },
    matchStrategy: 'strict' | 'best' = 'strict'
  ): Promise<{ 
    line_number: number; 
    line_type: 'ADDED' | 'REMOVED' | 'CONTEXT'; 
    sequential_position?: number;
    hunk_info?: any;
    diff_context?: string;
    diff_content_preview?: string;
    calculation_details?: string;
  }> {
    try {
      const diffContent = await this.getFilteredPullRequestDiff(workspace, repository, pullRequestId, filePath);
      
      const parser = new DiffParser();
      const sections = parser.parseDiffIntoSections(diffContent);
      
      let fileSection = sections[0];
      if (!this.apiClient.getIsServer()) {
        fileSection = sections.find(s => s.filePath === filePath) || sections[0];
      }

      if (!fileSection) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `File ${filePath} not found in pull request diff`
        );
      }

      const matches = this.findCodeMatches(
        fileSection.content,
        codeSnippet,
        searchContext
      );
      
      if (matches.length === 0) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Code snippet not found in ${filePath}`
        );
      }

      if (matches.length === 1) {
        return {
          line_number: matches[0].line_number,
          line_type: matches[0].line_type,
          sequential_position: matches[0].sequential_position,
          hunk_info: matches[0].hunk_info,
          diff_context: matches[0].preview,
          diff_content_preview: diffContent.split('\n').slice(0, 50).join('\n'),
          calculation_details: `Direct line number from diff: ${matches[0].line_number}`
        };
      }

      if (matchStrategy === 'best') {
        const best = this.selectBestMatch(matches);
        
        return {
          line_number: best.line_number,
          line_type: best.line_type,
          sequential_position: best.sequential_position,
          hunk_info: best.hunk_info,
          diff_context: best.preview,
          diff_content_preview: diffContent.split('\n').slice(0, 50).join('\n'),
          calculation_details: `Best match selected from ${matches.length} matches, line: ${best.line_number}`
        };
      }

      const error: MultipleMatchesError = {
        code: 'MULTIPLE_MATCHES_FOUND',
        message: `Code snippet '${codeSnippet.substring(0, 50)}...' found in ${matches.length} locations`,
        occurrences: matches.map(m => ({
          line_number: m.line_number,
          file_path: filePath,
          preview: m.preview,
          confidence: m.confidence,
          line_type: m.line_type
        })),
        suggestion: 'To resolve, either:\n1. Add more context to uniquely identify the location\n2. Use match_strategy: \'best\' to auto-select highest confidence match\n3. Use line_number directly'
      };

      throw new McpError(
        ErrorCode.InvalidParams,
        JSON.stringify({ error })
      );
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
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
    let currentDestLine = 0; // Destination file line number
    let currentSrcLine = 0;  // Source file line number
    let inHunk = false;
    let sequentialAddedCount = 0; // Track sequential ADDED lines
    let currentHunkIndex = -1;
    let currentHunkDestStart = 0;
    let currentHunkSrcStart = 0;
    let destPositionInHunk = 0; // Track position in destination file relative to hunk start
    let srcPositionInHunk = 0;  // Track position in source file relative to hunk start

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('@@')) {
        const match = line.match(/@@ -(\d+),\d+ \+(\d+),\d+ @@/);
        if (match) {
          currentHunkSrcStart = parseInt(match[1]);
          currentHunkDestStart = parseInt(match[2]);
          currentSrcLine = currentHunkSrcStart;
          currentDestLine = currentHunkDestStart;
          inHunk = true;
          currentHunkIndex++;
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

      let lineType: 'ADDED' | 'REMOVED' | 'CONTEXT';
      let lineContent = '';
      let lineNumber = 0;

      if (line.startsWith('+')) {
        lineType = 'ADDED';
        lineContent = line.substring(1);
        lineNumber = currentHunkDestStart + destPositionInHunk;
        destPositionInHunk++;
        sequentialAddedCount++;
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
        const confidence = this.calculateConfidence(
          lines,
          i,
          searchContext,
          lineType
        );

        matches.push({
          line_number: lineNumber,
          line_type: lineType,
          exact_content: codeSnippet,
          preview: this.getPreview(lines, i),
          confidence,
          context: this.extractContext(lines, i),
          sequential_position: lineType === 'ADDED' ? sequentialAddedCount : undefined,
          hunk_info: {
            hunk_index: currentHunkIndex,
            destination_start: currentHunkDestStart,
            line_in_hunk: destPositionInHunk
          }
        });
      }

      if (lineType === 'ADDED') {
        currentDestLine++;
      } else if (lineType === 'REMOVED') {
        currentSrcLine++;
      } else if (lineType === 'CONTEXT') {
        currentSrcLine++;
        currentDestLine++;
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
    let confidence = 0.5; // Base confidence

    if (!searchContext) {
      return confidence;
    }

    if (searchContext.before) {
      let matchedBefore = 0;
      for (let j = 0; j < searchContext.before.length; j++) {
        const contextLine = searchContext.before[searchContext.before.length - 1 - j];
        const checkIndex = index - j - 1;
        if (checkIndex >= 0) {
          const checkLine = lines[checkIndex].substring(1);
          if (checkLine.trim() === contextLine.trim()) {
            matchedBefore++;
          }
        }
      }
      confidence += (matchedBefore / searchContext.before.length) * 0.3;
    }

    if (searchContext.after) {
      let matchedAfter = 0;
      for (let j = 0; j < searchContext.after.length; j++) {
        const contextLine = searchContext.after[j];
        const checkIndex = index + j + 1;
        if (checkIndex < lines.length) {
          const checkLine = lines[checkIndex].substring(1);
          if (checkLine.trim() === contextLine.trim()) {
            matchedAfter++;
          }
        }
      }
      confidence += (matchedAfter / searchContext.after.length) * 0.3;
    }

    if (lineType === 'ADDED') {
      confidence += 0.1;
    }

    return Math.min(confidence, 1.0);
  }

  private getPreview(lines: string[], index: number): string {
    const start = Math.max(0, index - 1);
    const end = Math.min(lines.length, index + 2);
    const previewLines = [];

    for (let i = start; i < end; i++) {
      const prefix = i === index ? '> ' : '  ';
      previewLines.push(prefix + lines[i]);
    }

    return previewLines.join('\n');
  }

  private extractContext(lines: string[], index: number): { lines_before: string[]; lines_after: string[] } {
    const linesBefore: string[] = [];
    const linesAfter: string[] = [];

    for (let i = Math.max(0, index - 2); i < index; i++) {
      if (lines[i].match(/^[+\- ]/)) {
        linesBefore.push(lines[i].substring(1));
      }
    }

    for (let i = index + 1; i < Math.min(lines.length, index + 3); i++) {
      if (lines[i].match(/^[+\- ]/)) {
        linesAfter.push(lines[i].substring(1));
      }
    }

    return {
      lines_before: linesBefore,
      lines_after: linesAfter
    };
  }

  private selectBestMatch(matches: CodeMatch[]): CodeMatch {
    return matches.sort((a, b) => b.confidence - a.confidence)[0];
  }

  async handleDeclinePullRequest(args: any) {
    if (!isDeclinePullRequestArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for decline_pull_request'
      );
    }

    const { workspace, repository, pull_request_id, comment } = args;

    try {
      // First get the PR to obtain the current version
      const prPath = this.apiClient.getIsServer()
        ? `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}`
        : `/repositories/${workspace}/${repository}/pullrequests/${pull_request_id}`;

      const pr = await this.apiClient.makeRequest<any>('get', prPath);

      if (this.apiClient.getIsServer()) {
        const version = pr.version;
        const declinePath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}/decline`;

        await this.apiClient.makeRequest('post', declinePath, undefined, {
          params: { version }
        });
      } else {
        // Bitbucket Cloud
        const declinePath = `/repositories/${workspace}/${repository}/pullrequests/${pull_request_id}/decline`;
        await this.apiClient.makeRequest('post', declinePath);
      }

      // Optionally add a comment explaining the decline
      if (comment) {
        await this.handleAddComment({
          workspace,
          repository,
          pull_request_id,
          comment_text: comment
        });
      }

      return {
        content: [{
          type: 'text',
          text: `Pull request #${pull_request_id} has been declined.${comment ? ' Comment added.' : ''}`
        }]
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.errors?.[0]?.message || error.message;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: `Failed to decline pull request: ${errorMessage}`,
            details: error.response?.data
          }, null, 2)
        }],
        isError: true
      };
    }
  }

  async handleDeleteComment(args: any) {
    if (!isDeleteCommentArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for delete_comment'
      );
    }

    const { workspace, repository, pull_request_id, comment_id } = args;

    try {
      if (this.apiClient.getIsServer()) {
        // First get the comment to obtain the current version
        const commentPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}/comments/${comment_id}`;
        const comment = await this.apiClient.makeRequest<any>('get', commentPath);
        const version = comment.version;

        await this.apiClient.makeRequest('delete', commentPath, undefined, {
          params: { version }
        });
      } else {
        // Bitbucket Cloud
        const commentPath = `/repositories/${workspace}/${repository}/pullrequests/${pull_request_id}/comments/${comment_id}`;
        await this.apiClient.makeRequest('delete', commentPath);
      }

      return {
        content: [{
          type: 'text',
          text: `Comment #${comment_id} has been deleted from pull request #${pull_request_id}.`
        }]
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.errors?.[0]?.message || error.message;

      // Handle specific error for comments with replies
      if (error.response?.status === 409) {
        return {
          content: [{
            type: 'text',
            text: 'Cannot delete this comment because it has replies. Delete the replies first.'
          }],
          isError: true
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: `Failed to delete comment: ${errorMessage}`,
            details: error.response?.data
          }, null, 2)
        }],
        isError: true
      };
    }
  }

  async handleListPrCommits(args: any) {
    if (!isListPrCommitsArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for list_pr_commits'
      );
    }

    const { workspace, repository, pull_request_id, limit = 25, start = 0, include_build_status = false } = args;

    try {
      // First get the PR details to include in response
      const prPath = this.apiClient.getIsServer()
        ? `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}`
        : `/repositories/${workspace}/${repository}/pullrequests/${pull_request_id}`;
      
      let prTitle = '';
      try {
        const pr = await this.apiClient.makeRequest<any>('get', prPath);
        prTitle = pr.title;
      } catch (e) {
        // Ignore error, PR title is optional
      }

      let apiPath: string;
      let params: any = {};
      let commits: FormattedCommit[] = [];
      let totalCount = 0;
      let nextPageStart: number | null = null;

      if (this.apiClient.getIsServer()) {
        // Bitbucket Server API
        apiPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}/commits`;
        params = {
          limit,
          start,
          withCounts: true
        };

        const response = await this.apiClient.makeRequest<any>('get', apiPath, undefined, { params });

        // Format commits
        commits = (response.values || []).map((commit: BitbucketServerCommit) => formatServerCommit(commit));

        totalCount = response.size || commits.length;
        if (!response.isLastPage && response.nextPageStart !== undefined) {
          nextPageStart = response.nextPageStart;
        }
      } else {
        // Bitbucket Cloud API
        apiPath = `/repositories/${workspace}/${repository}/pullrequests/${pull_request_id}/commits`;
        params = {
          pagelen: limit,
          page: Math.floor(start / limit) + 1
        };

        const response = await this.apiClient.makeRequest<any>('get', apiPath, undefined, { params });

        // Format commits
        commits = (response.values || []).map((commit: BitbucketCloudCommit) => formatCloudCommit(commit));

        totalCount = response.size || commits.length;
        if (response.next) {
          nextPageStart = start + limit;
        }
      }

      // Fetch build status if requested (Server only)
      if (include_build_status && this.apiClient.getIsServer() && commits.length > 0) {
        try {
          const commitIds = commits.map(c => c.hash);
          const buildSummaries = await this.apiClient.getBuildSummaries(
            workspace,
            repository,
            commitIds
          );

          // Enhance commits with build status
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
          console.error('Failed to fetch build status for PR commits:', error);
          // Graceful degradation - continue without build status
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              pull_request_id,
              pull_request_title: prTitle,
              commits,
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
      return this.apiClient.handleApiError(error, `listing commits for pull request ${pull_request_id} in ${workspace}/${repository}`);
    }
  }

  // PR Task handlers
  async handleListPrTasks(args: any) {
    if (!isListPrTasksArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for list_pr_tasks'
      );
    }

    const { workspace, repository, pull_request_id } = args;

    try {
      if (!this.apiClient.getIsServer()) {
        throw new Error('PR tasks are currently only supported for Bitbucket Server');
      }

      // Get all activities and filter for BLOCKER comments (tasks)
      const apiPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}/activities`;
      const response = await this.apiClient.makeRequest<any>('get', apiPath, undefined, {
        params: { limit: 1000 }
      });

      const activities = response.values || [];

      // Filter for comments with severity BLOCKER (these are tasks)
      const tasks = activities
        .filter((a: any) => a.action === 'COMMENTED' && a.comment?.severity === 'BLOCKER')
        .map((a: any) => ({
          id: a.comment.id,
          text: a.comment.text,
          author: a.comment.author?.displayName || a.comment.author?.name,
          state: a.comment.state || 'OPEN',
          created_on: new Date(a.comment.createdDate).toISOString(),
          is_resolved: a.comment.state === 'RESOLVED'
        }));

      const openTasks = tasks.filter((t: any) => t.state === 'OPEN');
      const resolvedTasks = tasks.filter((t: any) => t.state === 'RESOLVED');

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            pull_request_id,
            tasks,
            summary: {
              total: tasks.length,
              open: openTasks.length,
              resolved: resolvedTasks.length
            }
          }, null, 2)
        }]
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.errors?.[0]?.message || error.message;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: `Failed to list PR tasks: ${errorMessage}`,
            details: error.response?.data
          }, null, 2)
        }],
        isError: true
      };
    }
  }

  async handleCreatePrTask(args: any) {
    if (!isCreatePrTaskArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for create_pr_task'
      );
    }

    const { workspace, repository, pull_request_id, text } = args;

    try {
      if (!this.apiClient.getIsServer()) {
        throw new Error('PR tasks are currently only supported for Bitbucket Server');
      }

      const apiPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}/comments`;
      const requestBody = {
        text: text,
        severity: 'BLOCKER'
      };

      const task = await this.apiClient.makeRequest<any>('post', apiPath, requestBody);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            message: 'Task created successfully',
            task: {
              id: task.id,
              text: task.text,
              author: task.author?.displayName || task.author?.name,
              state: task.state || 'OPEN',
              created_on: new Date(task.createdDate).toISOString()
            }
          }, null, 2)
        }]
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.errors?.[0]?.message || error.message;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: `Failed to create PR task: ${errorMessage}`,
            details: error.response?.data
          }, null, 2)
        }],
        isError: true
      };
    }
  }

  async handleUpdatePrTask(args: any) {
    if (!isUpdatePrTaskArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for update_pr_task'
      );
    }

    const { workspace, repository, pull_request_id, task_id, text } = args;

    try {
      if (!this.apiClient.getIsServer()) {
        throw new Error('PR tasks are currently only supported for Bitbucket Server');
      }

      // First get the current task to get version
      const commentPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}/comments/${task_id}`;
      const comment = await this.apiClient.makeRequest<any>('get', commentPath);

      const requestBody = {
        text: text,
        version: comment.version
      };

      const updatedTask = await this.apiClient.makeRequest<any>('put', commentPath, requestBody);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            message: 'Task updated successfully',
            task: {
              id: updatedTask.id,
              text: updatedTask.text,
              state: updatedTask.state || 'OPEN'
            }
          }, null, 2)
        }]
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.errors?.[0]?.message || error.message;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: `Failed to update PR task: ${errorMessage}`,
            details: error.response?.data
          }, null, 2)
        }],
        isError: true
      };
    }
  }

  async handleMarkPrTaskDone(args: any) {
    if (!isTaskIdArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for mark_pr_task_done'
      );
    }

    const { workspace, repository, pull_request_id, task_id } = args;

    try {
      if (!this.apiClient.getIsServer()) {
        throw new Error('PR tasks are currently only supported for Bitbucket Server');
      }

      const commentPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}/comments/${task_id}`;
      const comment = await this.apiClient.makeRequest<any>('get', commentPath);

      const requestBody = {
        state: 'RESOLVED',
        version: comment.version
      };

      await this.apiClient.makeRequest<any>('put', commentPath, requestBody);

      return {
        content: [{
          type: 'text',
          text: `Task #${task_id} has been marked as done.`
        }]
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.errors?.[0]?.message || error.message;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: `Failed to mark task as done: ${errorMessage}`,
            details: error.response?.data
          }, null, 2)
        }],
        isError: true
      };
    }
  }

  async handleUnmarkPrTaskDone(args: any) {
    if (!isTaskIdArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for unmark_pr_task_done'
      );
    }

    const { workspace, repository, pull_request_id, task_id } = args;

    try {
      if (!this.apiClient.getIsServer()) {
        throw new Error('PR tasks are currently only supported for Bitbucket Server');
      }

      const commentPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}/comments/${task_id}`;
      const comment = await this.apiClient.makeRequest<any>('get', commentPath);

      const requestBody = {
        state: 'OPEN',
        version: comment.version
      };

      await this.apiClient.makeRequest<any>('put', commentPath, requestBody);

      return {
        content: [{
          type: 'text',
          text: `Task #${task_id} has been reopened.`
        }]
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.errors?.[0]?.message || error.message;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: `Failed to reopen task: ${errorMessage}`,
            details: error.response?.data
          }, null, 2)
        }],
        isError: true
      };
    }
  }

  async handleDeletePrTask(args: any) {
    if (!isTaskIdArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for delete_pr_task'
      );
    }

    const { workspace, repository, pull_request_id, task_id } = args;

    // Reuse existing delete comment handler
    return this.handleDeleteComment({
      workspace,
      repository,
      pull_request_id,
      comment_id: task_id
    });
  }

  async handleConvertCommentToTask(args: any) {
    if (!isConvertCommentToTaskArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for convert_comment_to_task'
      );
    }

    const { workspace, repository, pull_request_id, comment_id } = args;

    try {
      if (!this.apiClient.getIsServer()) {
        throw new Error('PR tasks are currently only supported for Bitbucket Server');
      }

      const commentPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}/comments/${comment_id}`;
      const comment = await this.apiClient.makeRequest<any>('get', commentPath);

      const requestBody = {
        severity: 'BLOCKER',
        version: comment.version
      };

      await this.apiClient.makeRequest<any>('put', commentPath, requestBody);

      return {
        content: [{
          type: 'text',
          text: `Comment #${comment_id} has been converted to a task.`
        }]
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.errors?.[0]?.message || error.message;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: `Failed to convert comment to task: ${errorMessage}`,
            details: error.response?.data
          }, null, 2)
        }],
        isError: true
      };
    }
  }

  async handleConvertTaskToComment(args: any) {
    if (!isTaskIdArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for convert_task_to_comment'
      );
    }

    const { workspace, repository, pull_request_id, task_id } = args;

    try {
      if (!this.apiClient.getIsServer()) {
        throw new Error('PR tasks are currently only supported for Bitbucket Server');
      }

      const commentPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}/comments/${task_id}`;
      const comment = await this.apiClient.makeRequest<any>('get', commentPath);

      const requestBody = {
        severity: 'NORMAL',
        version: comment.version
      };

      await this.apiClient.makeRequest<any>('put', commentPath, requestBody);

      return {
        content: [{
          type: 'text',
          text: `Task #${task_id} has been converted to a comment.`
        }]
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.errors?.[0]?.message || error.message;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: `Failed to convert task to comment: ${errorMessage}`,
            details: error.response?.data
          }, null, 2)
        }],
        isError: true
      };
    }
  }
}
