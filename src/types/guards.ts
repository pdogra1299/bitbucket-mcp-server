// Type guards for tool arguments
export const isGetPullRequestArgs = (
  args: any
): args is { workspace: string; repository: string; pull_request_id: number } =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.workspace === 'string' &&
  typeof args.repository === 'string' &&
  typeof args.pull_request_id === 'number';

export const isListPullRequestsArgs = (
  args: any
): args is { 
  workspace: string; 
  repository: string; 
  state?: string; 
  author?: string;
  limit?: number;
  start?: number;
} =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.workspace === 'string' &&
  typeof args.repository === 'string' &&
  (args.state === undefined || typeof args.state === 'string') &&
  (args.author === undefined || typeof args.author === 'string') &&
  (args.limit === undefined || typeof args.limit === 'number') &&
  (args.start === undefined || typeof args.start === 'number');

export const isCreatePullRequestArgs = (
  args: any
): args is {
  workspace: string;
  repository: string;
  title: string;
  source_branch: string;
  destination_branch: string;
  description?: string;
  reviewers?: string[];
  close_source_branch?: boolean;
} =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.workspace === 'string' &&
  typeof args.repository === 'string' &&
  typeof args.title === 'string' &&
  typeof args.source_branch === 'string' &&
  typeof args.destination_branch === 'string' &&
  (args.description === undefined || typeof args.description === 'string') &&
  (args.reviewers === undefined || Array.isArray(args.reviewers)) &&
  (args.close_source_branch === undefined || typeof args.close_source_branch === 'boolean');

export const isUpdatePullRequestArgs = (
  args: any
): args is {
  workspace: string;
  repository: string;
  pull_request_id: number;
  title?: string;
  description?: string;
  destination_branch?: string;
  reviewers?: string[];
} =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.workspace === 'string' &&
  typeof args.repository === 'string' &&
  typeof args.pull_request_id === 'number' &&
  (args.title === undefined || typeof args.title === 'string') &&
  (args.description === undefined || typeof args.description === 'string') &&
  (args.destination_branch === undefined || typeof args.destination_branch === 'string') &&
  (args.reviewers === undefined || Array.isArray(args.reviewers));

export const isAddCommentArgs = (
  args: any
): args is {
  workspace: string;
  repository: string;
  pull_request_id: number;
  comment_text: string;
  parent_comment_id?: number;
  file_path?: string;
  line_number?: number;
  line_type?: 'ADDED' | 'REMOVED' | 'CONTEXT';
  suggestion?: string;
  suggestion_end_line?: number;
  code_snippet?: string;
  search_context?: {
    before?: string[];
    after?: string[];
  };
  match_strategy?: 'strict' | 'best';
} =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.workspace === 'string' &&
  typeof args.repository === 'string' &&
  typeof args.pull_request_id === 'number' &&
  typeof args.comment_text === 'string' &&
  (args.parent_comment_id === undefined || typeof args.parent_comment_id === 'number') &&
  (args.file_path === undefined || typeof args.file_path === 'string') &&
  (args.line_number === undefined || typeof args.line_number === 'number') &&
  (args.line_type === undefined || ['ADDED', 'REMOVED', 'CONTEXT'].includes(args.line_type)) &&
  (args.suggestion === undefined || typeof args.suggestion === 'string') &&
  (args.suggestion_end_line === undefined || typeof args.suggestion_end_line === 'number') &&
  (args.code_snippet === undefined || typeof args.code_snippet === 'string') &&
  (args.search_context === undefined || (
    typeof args.search_context === 'object' &&
    (args.search_context.before === undefined || Array.isArray(args.search_context.before)) &&
    (args.search_context.after === undefined || Array.isArray(args.search_context.after))
  )) &&
  (args.match_strategy === undefined || ['strict', 'best'].includes(args.match_strategy));

export const isMergePullRequestArgs = (
  args: any
): args is {
  workspace: string;
  repository: string;
  pull_request_id: number;
  merge_strategy?: string;
  close_source_branch?: boolean;
  commit_message?: string;
} =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.workspace === 'string' &&
  typeof args.repository === 'string' &&
  typeof args.pull_request_id === 'number' &&
  (args.merge_strategy === undefined || typeof args.merge_strategy === 'string') &&
  (args.close_source_branch === undefined || typeof args.close_source_branch === 'boolean') &&
  (args.commit_message === undefined || typeof args.commit_message === 'string');

export const isDeleteBranchArgs = (
  args: any
): args is {
  workspace: string;
  repository: string;
  branch_name: string;
  force?: boolean;
} =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.workspace === 'string' &&
  typeof args.repository === 'string' &&
  typeof args.branch_name === 'string' &&
  (args.force === undefined || typeof args.force === 'boolean');

export const isListBranchesArgs = (
  args: any
): args is {
  workspace: string;
  repository: string;
  filter?: string;
  limit?: number;
  start?: number;
} =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.workspace === 'string' &&
  typeof args.repository === 'string' &&
  (args.filter === undefined || typeof args.filter === 'string') &&
  (args.limit === undefined || typeof args.limit === 'number') &&
  (args.start === undefined || typeof args.start === 'number');

export const isGetPullRequestDiffArgs = (
  args: any
): args is {
  workspace: string;
  repository: string;
  pull_request_id: number;
  context_lines?: number;
  include_patterns?: string[];
  exclude_patterns?: string[];
  file_path?: string;
} =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.workspace === 'string' &&
  typeof args.repository === 'string' &&
  typeof args.pull_request_id === 'number' &&
  (args.context_lines === undefined || typeof args.context_lines === 'number') &&
  (args.include_patterns === undefined || (Array.isArray(args.include_patterns) && args.include_patterns.every((p: any) => typeof p === 'string'))) &&
  (args.exclude_patterns === undefined || (Array.isArray(args.exclude_patterns) && args.exclude_patterns.every((p: any) => typeof p === 'string'))) &&
  (args.file_path === undefined || typeof args.file_path === 'string');

export const isApprovePullRequestArgs = (
  args: any
): args is {
  workspace: string;
  repository: string;
  pull_request_id: number;
} =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.workspace === 'string' &&
  typeof args.repository === 'string' &&
  typeof args.pull_request_id === 'number';

export const isRequestChangesArgs = (
  args: any
): args is {
  workspace: string;
  repository: string;
  pull_request_id: number;
  comment?: string;
} =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.workspace === 'string' &&
  typeof args.repository === 'string' &&
  typeof args.pull_request_id === 'number' &&
  (args.comment === undefined || typeof args.comment === 'string');

export const isGetBranchArgs = (
  args: any
): args is {
  workspace: string;
  repository: string;
  branch_name: string;
  include_merged_prs?: boolean;
} =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.workspace === 'string' &&
  typeof args.repository === 'string' &&
  typeof args.branch_name === 'string' &&
  (args.include_merged_prs === undefined || typeof args.include_merged_prs === 'boolean');

export const isListDirectoryContentArgs = (
  args: any
): args is {
  workspace: string;
  repository: string;
  path?: string;
  branch?: string;
} =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.workspace === 'string' &&
  typeof args.repository === 'string' &&
  (args.path === undefined || typeof args.path === 'string') &&
  (args.branch === undefined || typeof args.branch === 'string');

export const isGetFileContentArgs = (
  args: any
): args is {
  workspace: string;
  repository: string;
  file_path: string;
  branch?: string;
  start_line?: number;
  line_count?: number;
  full_content?: boolean;
} =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.workspace === 'string' &&
  typeof args.repository === 'string' &&
  typeof args.file_path === 'string' &&
  (args.branch === undefined || typeof args.branch === 'string') &&
  (args.start_line === undefined || typeof args.start_line === 'number') &&
  (args.line_count === undefined || typeof args.line_count === 'number') &&
  (args.full_content === undefined || typeof args.full_content === 'boolean');

export const isListBranchCommitsArgs = (
  args: any
): args is {
  workspace: string;
  repository: string;
  branch_name: string;
  limit?: number;
  start?: number;
  since?: string;
  until?: string;
  author?: string;
  include_merge_commits?: boolean;
  search?: string;
  include_build_status?: boolean;
} =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.workspace === 'string' &&
  typeof args.repository === 'string' &&
  typeof args.branch_name === 'string' &&
  (args.limit === undefined || typeof args.limit === 'number') &&
  (args.start === undefined || typeof args.start === 'number') &&
  (args.since === undefined || typeof args.since === 'string') &&
  (args.until === undefined || typeof args.until === 'string') &&
  (args.author === undefined || typeof args.author === 'string') &&
  (args.include_merge_commits === undefined || typeof args.include_merge_commits === 'boolean') &&
  (args.search === undefined || typeof args.search === 'string') &&
  (args.include_build_status === undefined || typeof args.include_build_status === 'boolean');

export const isListPrCommitsArgs = (
  args: any
): args is {
  workspace: string;
  repository: string;
  pull_request_id: number;
  limit?: number;
  start?: number;
  include_build_status?: boolean;
} =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.workspace === 'string' &&
  typeof args.repository === 'string' &&
  typeof args.pull_request_id === 'number' &&
  (args.limit === undefined || typeof args.limit === 'number') &&
  (args.start === undefined || typeof args.start === 'number') &&
  (args.include_build_status === undefined || typeof args.include_build_status === 'boolean');

export const isSearchCodeArgs = (
  args: any
): args is {
  workspace: string;
  repository?: string;
  search_query: string;
  file_pattern?: string;
  limit?: number;
  start?: number;
} =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.workspace === 'string' &&
  typeof args.search_query === 'string' &&
  (args.repository === undefined || typeof args.repository === 'string') &&
  (args.file_pattern === undefined || typeof args.file_pattern === 'string') &&
  (args.limit === undefined || typeof args.limit === 'number') &&
  (args.start === undefined || typeof args.start === 'number');

export const isListProjectsArgs = (
  args: any
): args is {
  name?: string;
  permission?: string;
  limit?: number;
  start?: number;
} =>
  typeof args === 'object' &&
  args !== null &&
  (args.name === undefined || typeof args.name === 'string') &&
  (args.permission === undefined || typeof args.permission === 'string') &&
  (args.limit === undefined || typeof args.limit === 'number') &&
  (args.start === undefined || typeof args.start === 'number');

export const isListRepositoriesArgs = (
  args: any
): args is {
  workspace?: string;
  name?: string;
  permission?: string;
  limit?: number;
  start?: number;
} =>
  typeof args === 'object' &&
  args !== null &&
  (args.workspace === undefined || typeof args.workspace === 'string') &&
  (args.name === undefined || typeof args.name === 'string') &&
  (args.permission === undefined || typeof args.permission === 'string') &&
  (args.limit === undefined || typeof args.limit === 'number') &&
  (args.start === undefined || typeof args.start === 'number');
