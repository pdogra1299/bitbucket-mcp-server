import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BitbucketApiClient } from '../utils/api-client.js';
import {
  isListDirectoryContentArgs,
  isGetFileContentArgs,
  isSearchFilesArgs
} from '../types/guards.js';
import { minimatch } from 'minimatch';
import {
  BitbucketServerDirectoryEntry,
  BitbucketCloudDirectoryEntry,
  BitbucketCloudFileMetadata
} from '../types/bitbucket.js';
import * as path from 'path';

export class FileHandlers {
  // Default lines by file extension
  private readonly DEFAULT_LINES_BY_EXT: Record<string, number> = {
    '.yml': 200, '.yaml': 200, '.json': 200,  // Config files
    '.md': 300, '.txt': 300,                   // Docs
    '.ts': 500, '.js': 500, '.py': 500,       // Code
    '.tsx': 500, '.jsx': 500, '.java': 500,   // More code
    '.log': -100  // Last 100 lines for logs
  };

  constructor(
    private apiClient: BitbucketApiClient,
    private baseUrl: string
  ) {}

  async handleListDirectoryContent(args: any) {
    if (!isListDirectoryContentArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for list_directory_content'
      );
    }

    const { workspace, repository, path: dirPath = '', branch } = args;

    try {
      let apiPath: string;
      let params: any = {};
      let response: any;

      if (this.apiClient.getIsServer()) {
        // Bitbucket Server API
        apiPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/browse`;
        if (dirPath) {
          apiPath += `/${dirPath}`;
        }
        if (branch) {
          params.at = `refs/heads/${branch}`;
        }
        
        response = await this.apiClient.makeRequest<any>('get', apiPath, undefined, { params });
      } else {
        // Bitbucket Cloud API
        const branchOrDefault = branch || 'HEAD';
        apiPath = `/repositories/${workspace}/${repository}/src/${branchOrDefault}`;
        if (dirPath) {
          apiPath += `/${dirPath}`;
        }
        
        response = await this.apiClient.makeRequest<any>('get', apiPath);
      }

      // Format the response
      let contents: any[] = [];
      let actualBranch = branch;

      if (this.apiClient.getIsServer()) {
        // Bitbucket Server response
        const entries = response.children?.values || [];
        contents = entries.map((entry: BitbucketServerDirectoryEntry) => ({
          name: entry.path.name,
          type: entry.type === 'FILE' ? 'file' : 'directory',
          size: entry.size,
          path: dirPath ? `${dirPath}/${entry.path.name}` : entry.path.name
        }));
        
        // Get the actual branch from the response if available
        if (!branch && response.path?.components) {
          // Server returns default branch info in the response
          actualBranch = 'default';
        }
      } else {
        // Bitbucket Cloud response
        const entries = response.values || [];
        contents = entries.map((entry: BitbucketCloudDirectoryEntry) => ({
          name: entry.path.split('/').pop() || entry.path,
          type: entry.type === 'commit_file' ? 'file' : 'directory',
          size: entry.size,
          path: entry.path
        }));
        
        // Cloud returns the branch in the response
        actualBranch = branch || response.commit?.branch || 'main';
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              path: dirPath || '/',
              branch: actualBranch,
              contents,
              total_items: contents.length
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.apiClient.handleApiError(error, `listing directory '${dirPath}' in ${workspace}/${repository}`);
    }
  }

  async handleGetFileContent(args: any) {
    if (!isGetFileContentArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for get_file_content'
      );
    }

    const { workspace, repository, file_path, branch, start_line, line_count, full_content = false } = args;

    try {
      let fileContent: string;
      let fileMetadata: any = {};
      const fileSizeLimit = 1024 * 1024; // 1MB default limit

      if (this.apiClient.getIsServer()) {
        // Bitbucket Server - get file metadata first to check size
        const browsePath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/browse/${file_path}`;
        const browseParams: any = {};
        if (branch) {
          browseParams.at = `refs/heads/${branch}`;
        }
        
        try {
          const metadataResponse = await this.apiClient.makeRequest<any>('get', browsePath, undefined, { params: browseParams });
          fileMetadata = {
            size: metadataResponse.size || 0,
            path: file_path
          };

          // Check file size
          if (!full_content && fileMetadata.size > fileSizeLimit) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    error: 'File too large',
                    file_path,
                    size: fileMetadata.size,
                    size_mb: (fileMetadata.size / (1024 * 1024)).toFixed(2),
                    message: `File exceeds size limit. Use full_content: true to force retrieval or use start_line/line_count for partial content.`
                  }, null, 2),
                },
              ],
              isError: true,
            };
          }
        } catch (e) {
          // If browse fails, continue to try raw endpoint
        }

        // Get raw content
        const rawPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/raw/${file_path}`;
        const rawParams: any = {};
        if (branch) {
          rawParams.at = `refs/heads/${branch}`;
        }
        
        const response = await this.apiClient.makeRequest<any>('get', rawPath, undefined, { 
          params: rawParams,
          responseType: 'text',
          headers: { 'Accept': 'text/plain' }
        });
        
        fileContent = response;
      } else {
        // Bitbucket Cloud - first get metadata
        const branchOrDefault = branch || 'HEAD';
        const metaPath = `/repositories/${workspace}/${repository}/src/${branchOrDefault}/${file_path}`;
        
        const metadataResponse = await this.apiClient.makeRequest<BitbucketCloudFileMetadata>('get', metaPath);
        
        fileMetadata = {
          size: metadataResponse.size,
          encoding: metadataResponse.encoding,
          path: metadataResponse.path,
          commit: metadataResponse.commit
        };

        // Check file size
        if (!full_content && fileMetadata.size > fileSizeLimit) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'File too large',
                  file_path,
                  size: fileMetadata.size,
                  size_mb: (fileMetadata.size / (1024 * 1024)).toFixed(2),
                  message: `File exceeds size limit. Use full_content: true to force retrieval or use start_line/line_count for partial content.`
                }, null, 2),
              },
            ],
            isError: true,
          };
        }

        // Follow the download link to get actual content
        const downloadUrl = metadataResponse.links.download.href;
        const downloadResponse = await this.apiClient.makeRequest<any>('get', downloadUrl, undefined, {
          baseURL: '', // Use full URL
          responseType: 'text',
          headers: { 'Accept': 'text/plain' }
        });
        
        fileContent = downloadResponse;
      }

      // Apply line filtering if requested
      let processedContent = fileContent;
      let lineInfo: any = null;

      if (!full_content || start_line !== undefined || line_count !== undefined) {
        const lines = fileContent.split('\n');
        const totalLines = lines.length;

        // Determine default line count based on file extension
        const ext = path.extname(file_path).toLowerCase();
        const defaultLineCount = this.DEFAULT_LINES_BY_EXT[ext] || 500;
        const shouldUseTail = defaultLineCount < 0;

        // Calculate start and end indices
        let startIdx: number;
        let endIdx: number;

        if (start_line !== undefined) {
          if (start_line < 0) {
            // Negative start_line means from end
            startIdx = Math.max(0, totalLines + start_line);
            endIdx = totalLines;
          } else {
            // 1-based to 0-based index
            startIdx = Math.max(0, start_line - 1);
            endIdx = startIdx + (line_count || Math.abs(defaultLineCount));
          }
        } else if (!full_content && fileMetadata.size > 50 * 1024) {
          // Auto-truncate large files
          if (shouldUseTail) {
            startIdx = Math.max(0, totalLines + defaultLineCount);
            endIdx = totalLines;
          } else {
            startIdx = 0;
            endIdx = Math.abs(defaultLineCount);
          }
        } else {
          // Return full content for small files
          startIdx = 0;
          endIdx = totalLines;
        }

        // Ensure indices are within bounds
        startIdx = Math.max(0, Math.min(startIdx, totalLines));
        endIdx = Math.max(startIdx, Math.min(endIdx, totalLines));

        // Extract the requested lines
        const selectedLines = lines.slice(startIdx, endIdx);
        processedContent = selectedLines.join('\n');

        lineInfo = {
          total_lines: totalLines,
          returned_lines: {
            start: startIdx + 1,
            end: endIdx
          },
          truncated: startIdx > 0 || endIdx < totalLines,
          message: endIdx < totalLines 
            ? `Showing lines ${startIdx + 1}-${endIdx} of ${totalLines}. File size: ${(fileMetadata.size / 1024).toFixed(1)}KB`
            : null
        };
      }

      // Build response
      const response: any = {
        file_path,
        branch: branch || (this.apiClient.getIsServer() ? 'default' : 'main'),
        size: fileMetadata.size || fileContent.length,
        encoding: fileMetadata.encoding || 'utf-8',
        content: processedContent
      };

      if (lineInfo) {
        response.line_info = lineInfo;
      }

      if (fileMetadata.commit) {
        response.last_modified = {
          commit_id: fileMetadata.commit.hash,
          author: fileMetadata.commit.author?.user?.display_name || fileMetadata.commit.author?.raw,
          date: fileMetadata.commit.date,
          message: fileMetadata.commit.message
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    } catch (error: any) {
      // Handle specific not found error
      if (error.status === 404) {
        return {
          content: [
            {
              type: 'text',
              text: `File '${file_path}' not found in ${workspace}/${repository}${branch ? ` on branch '${branch}'` : ''}`,
            },
          ],
          isError: true,
        };
      }
      return this.apiClient.handleApiError(error, `getting file content for '${file_path}' in ${workspace}/${repository}`);
    }
  }

  // Helper method to get default line count based on file extension
  private getDefaultLines(filePath: string, fileSize: number): { full: boolean } | { start: number; count: number } {
    // Small files: return full content
    if (fileSize < 50 * 1024) { // 50KB
      return { full: true };
    }

    const ext = path.extname(filePath).toLowerCase();
    const defaultLines = this.DEFAULT_LINES_BY_EXT[ext] || 500;

    return {
      start: defaultLines < 0 ? defaultLines : 1,
      count: Math.abs(defaultLines)
    };
  }

  async handleSearchFiles(args: any) {
    if (!isSearchFilesArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for search_files'
      );
    }

    const { workspace, repository, pattern, path: searchPath, branch, limit = 100 } = args;

    try {
      let allFiles: string[] = [];

      if (this.apiClient.getIsServer()) {
        // Bitbucket Server API - /files endpoint returns all files recursively
        let apiPath = `/rest/api/latest/projects/${workspace}/repos/${repository}/files`;
        if (searchPath) {
          apiPath += `/${searchPath}`;
        }

        const params: any = {
          limit: 100000 // Fetch all files
        };
        if (branch) {
          params.at = `refs/heads/${branch}`;
        }

        const response = await this.apiClient.makeRequest<any>('get', apiPath, undefined, { params });

        // Server returns array of file paths directly or paginated response
        if (Array.isArray(response)) {
          allFiles = response;
        } else if (response.values) {
          allFiles = response.values;
        }
      } else {
        // Bitbucket Cloud - need to recursively traverse directories
        // For now, use the src endpoint with max_depth
        const branchOrDefault = branch || 'HEAD';
        let apiPath = `/repositories/${workspace}/${repository}/src/${branchOrDefault}`;
        if (searchPath) {
          apiPath += `/${searchPath}`;
        }

        // Cloud requires recursive traversal - fetch with max_depth
        const params: any = {
          max_depth: 10,
          pagelen: 100
        };

        const response = await this.apiClient.makeRequest<any>('get', apiPath, undefined, { params });

        // Extract file paths from Cloud response
        const entries = response.values || [];
        allFiles = entries
          .filter((entry: any) => entry.type === 'commit_file')
          .map((entry: any) => entry.path);
      }

      // Apply pattern filtering if provided (case-insensitive like VS Code's file search)
      let matchedFiles = allFiles;
      if (pattern) {
        matchedFiles = allFiles.filter(filePath => {
          // Try matching with the pattern as-is
          if (minimatch(filePath, pattern, { matchBase: true, nocase: true })) {
            return true;
          }
          // Also try with **/ prefix for convenience
          if (!pattern.startsWith('**/') && minimatch(filePath, `**/${pattern}`, { matchBase: true, nocase: true })) {
            return true;
          }
          return false;
        });
      }

      // Apply limit to results
      const totalMatched = matchedFiles.length;
      const truncated = totalMatched > limit;
      const resultFiles = matchedFiles.slice(0, limit);

      // Build response
      const response = {
        workspace,
        repository,
        branch: branch || 'default',
        search_path: searchPath || '/',
        pattern: pattern || '*',
        files: resultFiles,
        total_files_scanned: allFiles.length,
        total_matched: totalMatched,
        returned: resultFiles.length,
        truncated
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return this.apiClient.handleApiError(error, `searching files in ${workspace}/${repository}`);
    }
  }
}
