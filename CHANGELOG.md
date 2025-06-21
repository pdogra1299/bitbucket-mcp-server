# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2025-01-21

### Added
- **New file and directory handling tools**:
  - `list_directory_content` - List files and directories in any repository path
    - Shows file/directory type, size, and full paths
    - Supports browsing specific branches
    - Works with both Bitbucket Server and Cloud APIs
  - `get_file_content` - Retrieve file content with smart truncation for large files
    - Automatic smart defaults by file type (config: 200 lines, docs: 300 lines, code: 500 lines)
    - Pagination support with `start_line` and `line_count` parameters
    - Tail functionality using negative `start_line` values (e.g., -50 for last 50 lines)
    - Automatic truncation for files >50KB to prevent token overload
    - Files >1MB require explicit `full_content: true` parameter
    - Returns metadata including file size, encoding, and last modified info
- Added `FileHandlers` class following existing modular architecture patterns
- Added TypeScript interfaces for file/directory entries and metadata
- Added type guards `isListDirectoryContentArgs` and `isGetFileContentArgs`

### Changed
- Enhanced documentation with comprehensive examples for file handling tools

## [0.4.0] - 2025-01-21

### Added
- **New `get_branch` tool for comprehensive branch information**:
  - Returns detailed branch information including name, ID, and latest commit details
  - Lists all open pull requests originating from the branch with approval status
  - Optionally includes merged pull requests when `include_merged_prs` is true
  - Provides useful statistics like PR counts and days since last commit
  - Supports both Bitbucket Server and Cloud APIs
  - Particularly useful for checking if a branch has open PRs before deletion
- Added TypeScript interfaces for `BitbucketServerBranch` and `BitbucketCloudBranch`
- Added type guard `isGetBranchArgs` for input validation

### Changed
- Updated documentation to include the new `get_branch` tool with comprehensive examples

## [0.3.0] - 2025-01-06

### Added
- **Enhanced merge commit details in `get_pull_request`**:
  - Added `merge_commit_hash` field for both Cloud and Server
  - Added `merged_by` field showing who performed the merge
  - Added `merged_at` timestamp for when the merge occurred
  - Added `merge_commit_message` with the merge commit message
  - For Bitbucket Server: Fetches merge details from activities API when PR is merged
  - For Bitbucket Cloud: Extracts merge information from existing response fields

### Changed
- **Major code refactoring for better maintainability**:
  - Split monolithic `index.ts` into modular architecture
  - Created separate handler classes for different tool categories:
    - `PullRequestHandlers` for PR lifecycle operations
    - `BranchHandlers` for branch management
    - `ReviewHandlers` for code review tools
  - Extracted types into dedicated files (`types/bitbucket.ts`, `types/guards.ts`)
  - Created utility modules (`utils/api-client.ts`, `utils/formatters.ts`)
  - Centralized tool definitions in `tools/definitions.ts`
- Improved error handling and API client abstraction
- Better separation of concerns between Cloud and Server implementations

### Fixed
- Improved handling of merge commit information retrieval failures
- Fixed API parameter passing for GET requests across all handlers (was passing config as third parameter instead of fourth)
- Updated Bitbucket Server branch listing to use `/rest/api/latest/` endpoint with proper parameters
- Branch filtering now works correctly with the `filterText` parameter for Bitbucket Server

## [0.2.0] - 2025-06-04

### Added
- Complete implementation of all Bitbucket MCP tools
- Support for both Bitbucket Cloud and Server
- Core PR lifecycle tools:
  - `create_pull_request` - Create new pull requests
  - `update_pull_request` - Update PR details
  - `merge_pull_request` - Merge pull requests
  - `list_branches` - List repository branches
  - `delete_branch` - Delete branches
- Enhanced `add_comment` with inline comment support
- Code review tools:
  - `get_pull_request_diff` - Get PR diff/changes
  - `approve_pull_request` - Approve PRs
  - `unapprove_pull_request` - Remove approval
  - `request_changes` - Request changes on PRs
  - `remove_requested_changes` - Remove change requests
- npm package configuration for easy installation via npx

### Fixed
- Author filter for Bitbucket Server (uses `role.1=AUTHOR` and `username.1=email`)
- Branch deletion handling for 204 No Content responses

### Changed
- Package name to `@nexus2520/bitbucket-mcp-server` for npm publishing

## [0.1.0] - 2025-06-03

### Added
- Initial implementation with basic tools:
  - `get_pull_request` - Get PR details
  - `list_pull_requests` - List PRs with filters
- Support for Bitbucket Cloud with app passwords
- Support for Bitbucket Server with HTTP access tokens
- Authentication setup script
- Comprehensive documentation
