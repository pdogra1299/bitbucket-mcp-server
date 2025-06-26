import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BitbucketApiClient } from '../utils/api-client.js';
import { formatServerResponse, formatCloudResponse } from '../utils/formatters.js';
import { 
  BitbucketServerPullRequest, 
  BitbucketCloudPullRequest, 
  BitbucketServerActivity,
  MergeInfo,
  BitbucketCloudComment,
  BitbucketCloudFileChange,
  FormattedComment,
  FormattedFileChange
} from '../types/bitbucket.js';
import {
  isGetPullRequestArgs,
  isListPullRequestsArgs,
  isCreatePullRequestArgs,
  isUpdatePullRequestArgs,
  isAddCommentArgs,
  isMergePullRequestArgs
} from '../types/guards.js';

export class PullRequestHandlers {
  constructor(
    private apiClient: BitbucketApiClient,
    private baseUrl: string,
    private username: string
  ) {}

  async handleGetPullRequest(args: any) {
    if (!isGetPullRequestArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for get_pull_request'
      );
    }

    const { workspace, repository, pull_request_id } = args;

    try {
      // Different API paths for Server vs Cloud
      const apiPath = this.apiClient.getIsServer()
        ? `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}`
        : `/repositories/${workspace}/${repository}/pullrequests/${pull_request_id}`;
      
      const pr = await this.apiClient.makeRequest<any>('get', apiPath);

      let mergeInfo: MergeInfo = {};

      // For Bitbucket Server, fetch additional merge information if PR is merged
      if (this.apiClient.getIsServer() && pr.state === 'MERGED') {
        try {
          // Try to get activities to find merge information
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
            
            // Try to get commit message if we have the hash
            if (mergeActivity.commit?.id) {
              try {
                const commitPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/commits/${mergeActivity.commit.id}`;
                const commitResponse = await this.apiClient.makeRequest<any>('get', commitPath);
                mergeInfo.mergeCommitMessage = commitResponse.message || null;
              } catch (commitError) {
                // If we can't get the commit message, continue without it
                console.error('Failed to fetch merge commit message:', commitError);
              }
            }
          }
        } catch (activitiesError) {
          // If we can't get activities, continue without merge info
          console.error('Failed to fetch PR activities:', activitiesError);
        }
      }

      // Fetch comments and file changes in parallel
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
        // Log error but continue with PR data
        console.error('Failed to fetch additional PR data:', error);
      }

      // Format the response based on server type
      const formattedResponse = this.apiClient.getIsServer() 
        ? formatServerResponse(pr as BitbucketServerPullRequest, mergeInfo, this.baseUrl)
        : formatCloudResponse(pr as BitbucketCloudPullRequest);

      // Add comments and file changes to the response
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

      // Format the response
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
        
        // First get the current PR to get version number
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
        if (reviewers !== undefined) {
          requestBody.reviewers = reviewers.map(r => ({ user: { name: r } }));
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

    const { workspace, repository, pull_request_id, comment_text, parent_comment_id, file_path, line_number, line_type } = args;

    const isInlineComment = file_path !== undefined && line_number !== undefined;

    try {
      let apiPath: string;
      let requestBody: any;

      if (this.apiClient.getIsServer()) {
        // Bitbucket Server API
        apiPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}/comments`;
        requestBody = {
          text: comment_text
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
            raw: comment_text
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

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: isInlineComment ? 'Inline comment added successfully' : 'Comment added successfully',
              comment: {
                id: comment.id,
                text: this.apiClient.getIsServer() ? comment.text : comment.content.raw,
                author: this.apiClient.getIsServer() ? comment.author.displayName : comment.user.display_name,
                created_on: this.apiClient.getIsServer() ? new Date(comment.createdDate).toLocaleString() : comment.created_on,
                file_path: isInlineComment ? file_path : undefined,
                line_number: isInlineComment ? line_number : undefined,
                line_type: isInlineComment ? (line_type || 'CONTEXT') : undefined
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
        // Helper function to process nested comments recursively
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

          // Process nested replies
          if (comment.comments && comment.comments.length > 0) {
            formattedComment.replies = comment.comments
              .filter((reply: any) => {
                // Apply same filters to replies
                if (reply.state === 'RESOLVED') return false;
                if (anchor && anchor.orphaned === true) return false;
                return true;
              })
              .map((reply: any) => processNestedComments(reply, anchor));
          }

          return formattedComment;
        };

        // Helper to count all comments including nested ones
        const countAllComments = (comment: any): number => {
          let count = 1;
          if (comment.comments && comment.comments.length > 0) {
            count += comment.comments.reduce((sum: number, reply: any) => sum + countAllComments(reply), 0);
          }
          return count;
        };

        // Helper to count active comments including nested ones
        const countActiveComments = (comment: any, anchor: any): number => {
          let count = 0;
          
          // Check if this comment is active
          if (comment.state !== 'RESOLVED' && (!anchor || anchor.orphaned !== true)) {
            count = 1;
          }
          
          // Count active nested comments
          if (comment.comments && comment.comments.length > 0) {
            count += comment.comments.reduce((sum: number, reply: any) => sum + countActiveComments(reply, anchor), 0);
          }
          
          return count;
        };

        // Bitbucket Server API - fetch from activities
        const apiPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pullRequestId}/activities`;
        const response = await this.apiClient.makeRequest<any>('get', apiPath, undefined, {
          params: { limit: 1000 }
        });

        const activities = response.values || [];
        
        // Filter for comment activities
        const commentActivities = activities.filter((a: any) => 
          a.action === 'COMMENTED' && a.comment
        );

        // Count all comments including nested ones
        totalCount = commentActivities.reduce((sum: number, activity: any) => {
          return sum + countAllComments(activity.comment);
        }, 0);

        // Count active comments including nested ones
        activeCount = commentActivities.reduce((sum: number, activity: any) => {
          return sum + countActiveComments(activity.comment, activity.commentAnchor);
        }, 0);

        // Process top-level comments and their nested replies
        const processedComments = commentActivities
          .filter((a: any) => {
            const c = a.comment;
            const anchor = a.commentAnchor;
            
            // Skip resolved comments
            if (c.state === 'RESOLVED') return false;
            
            // Skip orphaned inline comments
            if (anchor && anchor.orphaned === true) return false;
            
            return true;
          })
          .map((a: any) => processNestedComments(a.comment, a.commentAnchor));

        // Limit to 20 top-level comments
        comments = processedComments.slice(0, 20);
      } else {
        // Bitbucket Cloud API
        const apiPath = `/repositories/${workspace}/${repository}/pullrequests/${pullRequestId}/comments`;
        const response = await this.apiClient.makeRequest<any>('get', apiPath, undefined, {
          params: { pagelen: 100 }
        });

        const allComments = response.values || [];
        totalCount = allComments.length;

        // Filter for active comments (not deleted or resolved) and limit to 20
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
        // Bitbucket Server API - use changes endpoint
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
        // Bitbucket Cloud API - use diffstat endpoint (has line statistics)
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
}
