import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BitbucketApiClient } from '../utils/api-client.js';
import {
  isGetPullRequestDiffArgs,
  isApprovePullRequestArgs,
  isRequestChangesArgs
} from '../types/guards.js';
import { DiffParser } from '../utils/diff-parser.js';
import { minimatch } from 'minimatch';

// Interfaces for structured diff response
interface DiffLine {
  source_line: number;
  destination_line: number;
  type: 'ADDED' | 'REMOVED' | 'CONTEXT';
  content: string;
}

interface DiffHunk {
  context: string;
  source_start: number;
  source_span: number;
  destination_start: number;
  destination_span: number;
  lines: DiffLine[];
}

interface DiffFile {
  file_path: string;
  old_path: string | null;
  status: 'added' | 'deleted' | 'modified' | 'renamed';
  hunks: DiffHunk[];
}

interface StructuredDiffResponse {
  message: string;
  pull_request_id: number;
  from_hash: string;
  to_hash: string;
  files: DiffFile[];
  summary: {
    total_files: number;
    files_included: number;
    files_excluded: number;
  };
  filter_metadata?: {
    filters_applied: {
      file_path?: string;
      include_patterns?: string[];
      exclude_patterns?: string[];
    };
    excluded_file_list?: string[];
  };
}

export class ReviewHandlers {
  constructor(
    private apiClient: BitbucketApiClient,
    private username: string
  ) {}

  /**
   * Transform Bitbucket Server JSON diff response to structured format
   */
  private transformBitbucketServerDiff(
    response: any,
    pullRequestId: number,
    includePatterns?: string[],
    excludePatterns?: string[],
    filePath?: string
  ): StructuredDiffResponse {
    const allDiffs = response.diffs || [];
    const excludedFileList: string[] = [];

    // Apply filtering
    let filteredDiffs = allDiffs;

    // File path filter (already handled by API, but double-check)
    if (filePath) {
      filteredDiffs = allDiffs.filter((diff: any) => {
        const destPath = diff.destination?.toString || diff.source?.toString;
        const srcPath = diff.source?.toString;
        const matches = destPath === filePath || srcPath === filePath;
        if (!matches) {
          excludedFileList.push(destPath || srcPath);
        }
        return matches;
      });
    } else {
      // Apply exclude patterns (blacklist)
      if (excludePatterns && excludePatterns.length > 0) {
        filteredDiffs = filteredDiffs.filter((diff: any) => {
          const filePath = diff.destination?.toString || diff.source?.toString;
          const shouldExclude = excludePatterns.some(pattern =>
            minimatch(filePath, pattern, { matchBase: true })
          );
          if (shouldExclude) {
            excludedFileList.push(filePath);
            return false;
          }
          return true;
        });
      }

      // Apply include patterns (whitelist)
      if (includePatterns && includePatterns.length > 0) {
        filteredDiffs = filteredDiffs.filter((diff: any) => {
          const filePath = diff.destination?.toString || diff.source?.toString;
          const shouldInclude = includePatterns.some(pattern =>
            minimatch(filePath, pattern, { matchBase: true })
          );
          if (!shouldInclude) {
            excludedFileList.push(filePath);
            return false;
          }
          return true;
        });
      }
    }

    // Transform diffs to structured format
    const files: DiffFile[] = filteredDiffs.map((diff: any) => {
      const destPath = diff.destination?.toString;
      const srcPath = diff.source?.toString;

      // Determine file status
      let status: 'added' | 'deleted' | 'modified' | 'renamed' = 'modified';
      if (!srcPath || diff.source?.toString === '/dev/null') {
        status = 'added';
      } else if (!destPath || diff.destination?.toString === '/dev/null') {
        status = 'deleted';
      } else if (srcPath !== destPath) {
        status = 'renamed';
      }

      // Transform hunks
      const hunks: DiffHunk[] = (diff.hunks || []).map((hunk: any) => {
        // Flatten segments into lines
        const lines: DiffLine[] = [];
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

    const result: StructuredDiffResponse = {
      message: 'Pull request diff retrieved successfully',
      pull_request_id: pullRequestId,
      from_hash: response.fromHash || '',
      to_hash: response.toHash || '',
      files,
      summary: {
        total_files: allDiffs.length,
        files_included: files.length,
        files_excluded: excludedFileList.length
      }
    };

    // Add filter metadata if any filtering was applied
    if (filePath || includePatterns || excludePatterns) {
      result.filter_metadata = {
        filters_applied: {}
      };
      if (filePath) {
        result.filter_metadata.filters_applied.file_path = filePath;
      }
      if (includePatterns) {
        result.filter_metadata.filters_applied.include_patterns = includePatterns;
      }
      if (excludePatterns) {
        result.filter_metadata.filters_applied.exclude_patterns = excludePatterns;
      }
      if (excludedFileList.length > 0) {
        result.filter_metadata.excluded_file_list = excludedFileList;
      }
    }

    return result;
  }

  async handleGetPullRequestDiff(args: any) {
    if (!isGetPullRequestDiffArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for get_pull_request_diff'
      );
    }

    const {
      workspace,
      repository,
      pull_request_id,
      context_lines = 3,
      include_patterns,
      exclude_patterns,
      file_path
    } = args;

    try {
      let apiPath: string;
      let config: any = {};

      if (this.apiClient.getIsServer()) {
        // Bitbucket Server API - use JSON response for structured data
        apiPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/pull-requests/${pull_request_id}/diff`;

        // If specific file requested, add to path (API supports this natively)
        if (file_path) {
          apiPath = `${apiPath}/${file_path}`;
        }

        config.params = { contextLines: context_lines };
        config.headers = { 'Accept': 'application/json' };

        const jsonResponse = await this.apiClient.makeRequest<any>('get', apiPath, undefined, config);

        // Transform to structured format
        const structuredResponse = this.transformBitbucketServerDiff(
          jsonResponse,
          pull_request_id,
          include_patterns,
          exclude_patterns,
          file_path
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(structuredResponse, null, 2),
            },
          ],
        };
      } else {
        // Bitbucket Cloud API - keep text/plain for now (different API structure)
        apiPath = `/repositories/${workspace}/${repository}/pullrequests/${pull_request_id}/diff`;
        config.params = { context: context_lines };
        config.headers = { 'Accept': 'text/plain' };

        const rawDiff = await this.apiClient.makeRequest<string>('get', apiPath, undefined, config);

        // Check if filtering is needed
        const needsFiltering = file_path || include_patterns || exclude_patterns;

        if (!needsFiltering) {
          // Return raw diff without filtering
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  message: 'Pull request diff retrieved successfully',
                  pull_request_id,
                  diff: rawDiff
                }, null, 2),
              },
            ],
          };
        }

        // Apply filtering for Cloud
        const diffParser = new DiffParser();
        const sections = diffParser.parseDiffIntoSections(rawDiff);

        const filterOptions = {
          includePatterns: include_patterns,
          excludePatterns: exclude_patterns,
          filePath: file_path
        };

        const filteredResult = diffParser.filterSections(sections, filterOptions);
        const filteredDiff = diffParser.reconstructDiff(filteredResult.sections);

        // Build response with filtering metadata
        const response: any = {
          message: 'Pull request diff retrieved successfully',
          pull_request_id,
          diff: filteredDiff
        };

        // Add filter metadata
        if (filteredResult.metadata.excludedFiles > 0 || file_path || include_patterns || exclude_patterns) {
          response.filter_metadata = {
            total_files: filteredResult.metadata.totalFiles,
            included_files: filteredResult.metadata.includedFiles,
            excluded_files: filteredResult.metadata.excludedFiles
          };

          if (filteredResult.metadata.excludedFileList.length > 0) {
            response.filter_metadata.excluded_file_list = filteredResult.metadata.excludedFileList;
          }

          response.filter_metadata.filters_applied = {};
          if (file_path) {
            response.filter_metadata.filters_applied.file_path = file_path;
          }
          if (include_patterns) {
            response.filter_metadata.filters_applied.include_patterns = include_patterns;
          }
          if (exclude_patterns) {
            response.filter_metadata.filters_applied.exclude_patterns = exclude_patterns;
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response, null, 2),
            },
          ],
        };
      }
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
        // Convert email format: @ and + to _ for the API slug format
        const username = this.username.replace(/[@+]/g, '_');
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
        const username = this.username.replace(/[@+]/g, '_');
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
        const username = this.username.replace(/[@+]/g, '_');
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
        const username = this.username.replace(/[@+]/g, '_');
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
