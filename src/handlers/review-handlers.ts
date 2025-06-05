import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BitbucketApiClient } from '../utils/api-client.js';
import {
  isGetPullRequestDiffArgs,
  isApprovePullRequestArgs,
  isRequestChangesArgs
} from '../types/guards.js';

export class ReviewHandlers {
  constructor(
    private apiClient: BitbucketApiClient,
    private username: string
  ) {}

  async handleGetPullRequestDiff(args: any) {
    if (!isGetPullRequestDiffArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for get_pull_request_diff'
      );
    }

    const { workspace, repository, pull_request_id, context_lines = 3 } = args;

    try {
      let apiPath: string;
      let config: any = {};

      if (this.apiClient.getIsServer()) {
        // Bitbucket Server API
        apiPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}/diff`;
        config.params = { contextLines: context_lines };
      } else {
        // Bitbucket Cloud API
        apiPath = `/repositories/${workspace}/${repository}/pullrequests/${pull_request_id}/diff`;
        config.params = { context: context_lines };
      }

      // For diff, we want the raw text response
      config.headers = { 'Accept': 'text/plain' };
      
      const diff = await this.apiClient.makeRequest<string>('get', apiPath, undefined, config);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'Pull request diff retrieved successfully',
              pull_request_id,
              diff: diff
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.apiClient.handleApiError(error, `getting diff for pull request ${pull_request_id} in ${workspace}/${repository}`);
    }
  }

  async handleApprovePullRequest(args: any) {
    if (!isApprovePullRequestArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for approve_pull_request'
      );
    }

    const { workspace, repository, pull_request_id } = args;

    try {
      let apiPath: string;

      if (this.apiClient.getIsServer()) {
        // Bitbucket Server API - use participants endpoint
        // Convert email format: @ to _ for the API
        const username = this.username.replace('@', '_');
        apiPath = `/rest/api/latest/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}/participants/${username}`;
        await this.apiClient.makeRequest<any>('put', apiPath, { status: 'APPROVED' });
      } else {
        // Bitbucket Cloud API
        apiPath = `/repositories/${workspace}/${repository}/pullrequests/${pull_request_id}/approve`;
        await this.apiClient.makeRequest<any>('post', apiPath);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'Pull request approved successfully',
              pull_request_id,
              approved_by: this.username
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.apiClient.handleApiError(error, `approving pull request ${pull_request_id} in ${workspace}/${repository}`);
    }
  }

  async handleUnapprovePullRequest(args: any) {
    if (!isApprovePullRequestArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for unapprove_pull_request'
      );
    }

    const { workspace, repository, pull_request_id } = args;

    try {
      let apiPath: string;

      if (this.apiClient.getIsServer()) {
        // Bitbucket Server API - use participants endpoint
        const username = this.username.replace('@', '_');
        apiPath = `/rest/api/latest/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}/participants/${username}`;
        await this.apiClient.makeRequest<any>('put', apiPath, { status: 'UNAPPROVED' });
      } else {
        // Bitbucket Cloud API
        apiPath = `/repositories/${workspace}/${repository}/pullrequests/${pull_request_id}/approve`;
        await this.apiClient.makeRequest<any>('delete', apiPath);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'Pull request approval removed successfully',
              pull_request_id,
              unapproved_by: this.username
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.apiClient.handleApiError(error, `removing approval from pull request ${pull_request_id} in ${workspace}/${repository}`);
    }
  }

  async handleRequestChanges(args: any) {
    if (!isRequestChangesArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for request_changes'
      );
    }

    const { workspace, repository, pull_request_id, comment } = args;

    try {
      if (this.apiClient.getIsServer()) {
        // Bitbucket Server API - use needs-work status
        const username = this.username.replace('@', '_');
        const apiPath = `/rest/api/latest/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}/participants/${username}`;
        await this.apiClient.makeRequest<any>('put', apiPath, { status: 'NEEDS_WORK' });
        
        // Add comment if provided
        if (comment) {
          const commentPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}/comments`;
          await this.apiClient.makeRequest<any>('post', commentPath, { text: comment });
        }
      } else {
        // Bitbucket Cloud API - use request-changes status
        const apiPath = `/repositories/${workspace}/${repository}/pullrequests/${pull_request_id}/request-changes`;
        await this.apiClient.makeRequest<any>('post', apiPath);
        
        // Add comment if provided
        if (comment) {
          const commentPath = `/repositories/${workspace}/${repository}/pullrequests/${pull_request_id}/comments`;
          await this.apiClient.makeRequest<any>('post', commentPath, {
            content: { raw: comment }
          });
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'Changes requested on pull request',
              pull_request_id,
              requested_by: this.username,
              comment: comment || 'No comment provided'
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.apiClient.handleApiError(error, `requesting changes on pull request ${pull_request_id} in ${workspace}/${repository}`);
    }
  }

  async handleRemoveRequestedChanges(args: any) {
    if (!isApprovePullRequestArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for remove_requested_changes'
      );
    }

    const { workspace, repository, pull_request_id } = args;

    try {
      if (this.apiClient.getIsServer()) {
        // Bitbucket Server API - remove needs-work status
        const username = this.username.replace('@', '_');
        const apiPath = `/rest/api/latest/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}/participants/${username}`;
        await this.apiClient.makeRequest<any>('put', apiPath, { status: 'UNAPPROVED' });
      } else {
        // Bitbucket Cloud API
        const apiPath = `/repositories/${workspace}/${repository}/pullrequests/${pull_request_id}/request-changes`;
        await this.apiClient.makeRequest<any>('delete', apiPath);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'Change request removed from pull request',
              pull_request_id,
              removed_by: this.username
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.apiClient.handleApiError(error, `removing change request from pull request ${pull_request_id} in ${workspace}/${repository}`);
    }
  }
}
