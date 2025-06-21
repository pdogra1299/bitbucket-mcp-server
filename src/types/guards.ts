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
  (args.line_type === undefined || ['ADDED', 'REMOVED', 'CONTEXT'].includes(args.line_type));

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
} =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.workspace === 'string' &&
  typeof args.repository === 'string' &&
  typeof args.pull_request_id === 'number' &&
  (args.context_lines === undefined || typeof args.context_lines === 'number');

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
