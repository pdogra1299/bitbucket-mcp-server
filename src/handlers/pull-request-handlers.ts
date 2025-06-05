import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BitbucketApiClient } from '../utils/api-client.js';
import { formatServerResponse, formatCloudResponse } from '../utils/formatters.js';
import { 
  BitbucketServerPullRequest, 
  BitbucketCloudPullRequest, 
  BitbucketServerActivity,
  MergeInfo 
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

      // Format the response based on server type
      const formattedResponse = this.apiClient.getIsServer() 
        ? formatServerResponse(pr as BitbucketServerPullRequest, mergeInfo, this.baseUrl)
        : formatCloudResponse(pr as BitbucketCloudPullRequest);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(formattedResponse, null, 2),
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
}
