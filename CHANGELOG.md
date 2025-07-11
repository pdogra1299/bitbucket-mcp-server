# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.10.0] - 2025-07-03

### Added
- **New `list_branch_commits` tool for retrieving commit history**:
  - List all commits in a specific branch with detailed information
  - Advanced filtering options:
    - `since` and `until` parameters for date range filtering (ISO date strings)
    - `author` parameter to filter by author email/username
    - `include_merge_commits` parameter to include/exclude merge commits (default: true)
    - `search` parameter to search in commit messages
  - Returns branch head information and paginated commit list
  - Each commit includes hash, message, author details, date, parents, and merge status
  - Supports both Bitbucket Server and Cloud APIs with appropriate parameter mapping
  - Useful for reviewing commit history, tracking changes, and analyzing branch activity

- **New `list_pr_commits` tool for pull request commits**:
  - List all commits that are part of a specific pull request
  - Returns PR title and paginated commit list
  - Simpler than branch commits - focused specifically on PR changes
  - Each commit includes same detailed information as branch commits
  - Supports pagination with `limit` and `start` parameters
  - Useful for reviewing all changes in a PR before merging

### Changed
- Added new TypeScript interfaces for commit types:
  - `BitbucketServerCommit` and `BitbucketCloudCommit` for API responses
  - `FormattedCommit` for consistent commit representation
- Added formatter functions `formatServerCommit` and `formatCloudCommit` for unified output
- Enhanced type guards with `isListBranchCommitsArgs` and `isListPrCommitsArgs`

## [0.9.1] - 2025-01-27

### Fixed
- **Fixed `update_pull_request` reviewer preservation**:
  - When updating a PR without specifying reviewers, existing reviewers are now preserved
  - Previously, omitting the `reviewers` parameter would clear all reviewers
  - Now properly includes existing reviewers in the API request when not explicitly updating them
  - When updating reviewers, approval status is preserved for existing reviewers
  - This prevents accidentally removing reviewers when only updating PR title or description

### Changed
- Updated tool documentation to clarify reviewer behavior in `update_pull_request`
- Enhanced README with detailed explanation of reviewer handling

## [0.9.0] - 2025-01-26

### Added
- **Code snippet support in `add_comment` tool**:
  - Added `code_snippet` parameter to find line numbers automatically using code text
  - Added `search_context` parameter with `before` and `after` arrays to disambiguate multiple matches
  - Added `match_strategy` parameter with options:
    - `"strict"` (default): Fails with detailed error when multiple matches found
    - `"best"`: Auto-selects the highest confidence match
  - Returns detailed error with all occurrences when multiple matches found in strict mode
  - Particularly useful for AI-powered code review tools that analyze diffs
- Created comprehensive line matching algorithm that:
  - Parses diffs to find exact code snippets
  - Calculates confidence scores based on context matching
  - Handles added, removed, and context lines appropriately

### Changed
- Enhanced `add_comment` tool to resolve line numbers from code snippets when `line_number` is not provided
- Improved error messages to include preview and suggestions for resolving ambiguous matches

## [0.8.0] - 2025-01-26

### Added
- **Code suggestions support in `add_comment` tool**:
  - Added `suggestion` parameter to add code suggestions in comments
  - Added `suggestion_end_line` parameter for multi-line suggestions
  - Suggestions are formatted using GitHub-style markdown ````suggestion` blocks
  - Works with both single-line and multi-line code replacements
  - Requires `file_path` and `line_number` to be specified when using suggestions
  - Compatible with both Bitbucket Cloud and Server
- Created `suggestion-formatter.ts` utility for formatting suggestion comments

### Changed
- Enhanced `add_comment` tool to validate suggestion requirements
- Updated tool response to indicate when a comment contains a suggestion

## [0.7.0] - 2025-01-26

### Added
- **Enhanced `get_pull_request_diff` with filtering capabilities**:
  - Added `include_patterns` parameter to filter diff by file patterns (whitelist)
  - Added `exclude_patterns` parameter to exclude files from diff (blacklist)
  - Added `file_path` parameter to get diff for a specific file only
  - Patterns support standard glob syntax (e.g., `*.js`, `src/**/*.res`, `node_modules/**`)
  - Response includes filtering metadata showing total files, included/excluded counts, and excluded file list
- Added `minimatch` dependency for glob pattern matching
- Created `DiffParser` utility class for parsing and filtering unified diff format

### Changed
- Modified `get_pull_request_diff` tool to support optional filtering without breaking existing usage
- Updated tool definition and type guards to include new optional parameters
- Enhanced documentation with comprehensive examples of filtering usage

## [0.6.1] - 2025-01-26

### Added
- Support for nested comment replies in Bitbucket Server
  - Added `replies` field to `FormattedComment` interface to support nested comment threads
  - Comments now include nested replies that are still relevant (not orphaned or resolved)
  - Total and active comment counts now include nested replies

### Changed
- Updated comment fetching logic to handle Bitbucket Server's nested comment structure
  - Server uses `comments` array inside each comment object for replies
  - Cloud continues to use `parent` field for reply relationships
- Improved comment filtering to exclude orphaned inline comments when code has changed

### Fixed
- Fixed missing comment replies in PR details - replies are now properly included in the response

## [0.6.0] - 2025-01-26

### Added
- **Enhanced `get_pull_request` with active comments and file changes**:
  - Fetches and displays active (unresolved) comments that need attention
  - Shows up to 20 most recent active comments with:
    - Comment text, author, and creation date
    - Inline comment details (file path and line number)
    - Comment state (OPEN/RESOLVED for Server)
  - Provides comment counts:
    - `active_comment_count`: Total unresolved comments
    - `total_comment_count`: Total comments including resolved
  - Includes file change statistics:
    - List of all modified files with lines added/removed
    - File status (added, modified, removed, renamed)
    - Summary statistics (total files, lines added/removed)
- Added new TypeScript interfaces for comments and file changes
- Added `FormattedComment` and `FormattedFileChange` types for consistent response format

### Changed
- Modified `handleGetPullRequest` to make parallel API calls for better performance
- Enhanced error handling to gracefully continue if comment/file fetching fails

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
