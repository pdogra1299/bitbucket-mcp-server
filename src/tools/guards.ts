// Runtime argument validation for tool handlers. Guards check required
// fields and types strictly, stay permissive on optionals (schemas advertise
// the contract; guards are the safety net).

export type AttachmentInput =
  | string
  | { file_path: string; alt_text?: string; render?: 'image' | 'link' | 'auto' };

const isObj = (a: any): a is Record<string, unknown> => typeof a === 'object' && a !== null;
const str = (v: unknown): v is string => typeof v === 'string';
const optStr = (v: unknown): boolean => v === undefined || typeof v === 'string';
// Numeric guards are integer-strict: `typeof x === 'number'` would admit
// NaN/Infinity/floats into ids, versions, and limits.
export const isPosInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
const optInt = (v: unknown): boolean => v === undefined || Number.isInteger(v);
const optPosInt = (v: unknown): boolean => v === undefined || isPosInt(v);
export const optNonNegInt = (v: unknown): boolean =>
  v === undefined || (Number.isInteger(v) && (v as number) >= 0);
const optBool = (v: unknown): boolean => v === undefined || typeof v === 'boolean';
const optStrArr = (v: unknown): boolean =>
  v === undefined || (Array.isArray(v) && v.every(x => typeof x === 'string'));

// Identifiers that become URL path segments are charset-validated here, so a
// value like `PROJ/../../admin` or `repo?x=` can never re-route a request.
// Covers DC project keys (PROJ, ~user), Cloud workspace slugs and {uuid}s,
// and repo slugs. `/`, `?`, `#`, `%`, whitespace and control chars are out.
const IDENT = /^[A-Za-z0-9~{._-][A-Za-z0-9._~{}@-]{0,254}$/;
export const isIdent = (v: unknown): v is string =>
  typeof v === 'string' && v !== '.' && v !== '..' && IDENT.test(v);
const optIdent = (v: unknown): boolean => v === undefined || isIdent(v);
/** Abbreviated or full commit hash (SHA-1 or SHA-256 repos). */
export const isCommitId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-fA-F]{7,64}$/.test(v);
/** Bitbucket attachment ids are numeric. */
export const isAttachmentId = (v: unknown): v is string | number =>
  (typeof v === 'string' && /^\d{1,20}$/.test(v)) || isPosInt(v);

function isAttachmentInput(v: unknown): v is AttachmentInput {
  if (typeof v === 'string') return true;
  return isObj(v) && str(v.file_path) && optStr(v.alt_text) &&
    (v.render === undefined || ['image', 'link', 'auto'].includes(v.render as string));
}

const optAttachments = (v: unknown): boolean =>
  v === undefined || (Array.isArray(v) && v.every(isAttachmentInput));

function repoScoped(a: any): boolean {
  return isObj(a) && isIdent(a.workspace) && isIdent(a.repository);
}

// ── Pull requests ────────────────────────────────────────────────────────────

export function isGetPullRequestArgs(a: any): a is {
  workspace: string; repository: string; pull_request_id: number;
  include_comments?: boolean; include_file_changes?: boolean; include_tasks?: boolean;
  comment_limit?: number;
} {
  return repoScoped(a) && isPosInt(a.pull_request_id) &&
    optBool(a.include_comments) && optBool(a.include_file_changes) &&
    optBool(a.include_tasks) && optPosInt(a.comment_limit);
}

export function isListPullRequestsArgs(a: any): a is {
  workspace: string; repository?: string; state?: string; author?: string;
  role?: string; limit?: number; start?: number;
} {
  return isObj(a) && isIdent(a.workspace) && optIdent(a.repository) &&
    (a.state === undefined || ['OPEN', 'MERGED', 'DECLINED', 'ALL'].includes(a.state as string)) &&
    optStr(a.author) &&
    (a.role === undefined || ['AUTHOR', 'REVIEWER', 'PARTICIPANT'].includes(a.role as string)) &&
    optPosInt(a.limit) && optNonNegInt(a.start);
}

export function isCreatePullRequestArgs(a: any): a is {
  workspace: string; repository: string; title: string;
  source_branch: string; destination_branch: string;
  description?: string; reviewers?: string[]; close_source_branch?: boolean;
  attachments?: AttachmentInput[];
} {
  return repoScoped(a) && str(a.title) && str(a.source_branch) && str(a.destination_branch) &&
    optStr(a.description) && optStrArr(a.reviewers) && optBool(a.close_source_branch) &&
    optAttachments(a.attachments);
}

export function isUpdatePullRequestArgs(a: any): a is {
  workspace: string; repository: string; pull_request_id: number; version?: number;
  title?: string; description?: string; destination_branch?: string;
  reviewers?: string[]; attachments?: AttachmentInput[];
} {
  return repoScoped(a) && isPosInt(a.pull_request_id) && optNonNegInt(a.version) &&
    optStr(a.title) && optStr(a.description) && optStr(a.destination_branch) &&
    optStrArr(a.reviewers) && optAttachments(a.attachments);
}

export function isMergePullRequestArgs(a: any): a is {
  workspace: string; repository: string; pull_request_id: number; version?: number;
  merge_strategy?: string; close_source_branch?: boolean; commit_message?: string;
} {
  return repoScoped(a) && isPosInt(a.pull_request_id) && optNonNegInt(a.version) &&
    (a.merge_strategy === undefined || ['merge-commit', 'squash', 'fast-forward'].includes(a.merge_strategy)) &&
    optBool(a.close_source_branch) && optStr(a.commit_message);
}

export function isDeclinePullRequestArgs(a: any): a is {
  workspace: string; repository: string; pull_request_id: number;
  version?: number; comment?: string;
} {
  return repoScoped(a) && isPosInt(a.pull_request_id) &&
    optNonNegInt(a.version) && optStr(a.comment);
}

export function isListPrCommitsArgs(a: any): a is {
  workspace: string; repository: string; pull_request_id: number;
  limit?: number; start?: number; include_build_status?: boolean;
} {
  return repoScoped(a) && isPosInt(a.pull_request_id) &&
    optPosInt(a.limit) && optNonNegInt(a.start) && optBool(a.include_build_status);
}

// ── Comments & tasks ─────────────────────────────────────────────────────────

export function isAddCommentArgs(a: any): a is {
  workspace: string; repository: string; pull_request_id: number; comment_text: string;
  parent_comment_id?: number; file_path?: string; line_number?: number;
  line_type?: 'ADDED' | 'REMOVED' | 'CONTEXT'; suggestion?: string; suggestion_end_line?: number;
  code_snippet?: string; search_context?: { before?: string[]; after?: string[] };
  match_strategy?: 'strict' | 'best'; severity?: 'NORMAL' | 'BLOCKER';
  attachments?: AttachmentInput[];
} {
  return repoScoped(a) && isPosInt(a.pull_request_id) && str(a.comment_text) &&
    optPosInt(a.parent_comment_id) && optStr(a.file_path) && optPosInt(a.line_number) &&
    (a.line_type === undefined || ['ADDED', 'REMOVED', 'CONTEXT'].includes(a.line_type)) &&
    optStr(a.suggestion) && optPosInt(a.suggestion_end_line) && optStr(a.code_snippet) &&
    (a.search_context === undefined ||
      (isObj(a.search_context) && optStrArr(a.search_context.before) && optStrArr(a.search_context.after))) &&
    (a.match_strategy === undefined || ['strict', 'best'].includes(a.match_strategy)) &&
    (a.severity === undefined || ['NORMAL', 'BLOCKER'].includes(a.severity)) &&
    optAttachments(a.attachments);
}

export const MANAGE_COMMENT_ACTIONS = ['edit', 'delete', 'resolve', 'reopen', 'to_task', 'to_comment'] as const;

export function isManageCommentArgs(a: any): a is {
  workspace: string; repository: string; pull_request_id: number; comment_id: number;
  action: (typeof MANAGE_COMMENT_ACTIONS)[number]; text?: string; version?: number;
} {
  return repoScoped(a) && isPosInt(a.pull_request_id) &&
    isPosInt(a.comment_id) &&
    MANAGE_COMMENT_ACTIONS.includes(a.action) &&
    optStr(a.text) && optNonNegInt(a.version);
}

// ── Review ───────────────────────────────────────────────────────────────────

export function isGetPullRequestDiffArgs(a: any): a is {
  workspace: string; repository: string; pull_request_id: number;
  context_lines?: number; include_patterns?: string[]; exclude_patterns?: string[];
  file_path?: string; ignore_whitespace?: boolean;
} {
  return repoScoped(a) && isPosInt(a.pull_request_id) &&
    optNonNegInt(a.context_lines) && optStrArr(a.include_patterns) && optStrArr(a.exclude_patterns) &&
    optStr(a.file_path) && optBool(a.ignore_whitespace);
}

export function isSetReviewStatusArgs(a: any): a is {
  workspace: string; repository: string; pull_request_id: number;
  status: 'APPROVED' | 'NEEDS_WORK' | 'UNAPPROVED'; comment?: string;
} {
  return repoScoped(a) && isPosInt(a.pull_request_id) &&
    ['APPROVED', 'NEEDS_WORK', 'UNAPPROVED'].includes(a.status) && optStr(a.comment);
}

// ── Branches & commits ───────────────────────────────────────────────────────

export function isListBranchesArgs(a: any): a is {
  workspace: string; repository: string; filter?: string; limit?: number; start?: number;
} {
  return repoScoped(a) && optStr(a.filter) && optPosInt(a.limit) && optNonNegInt(a.start);
}

export function isGetBranchArgs(a: any): a is {
  workspace: string; repository: string; branch_name: string; include_merged_prs?: boolean;
} {
  return repoScoped(a) && str(a.branch_name) && optBool(a.include_merged_prs);
}

export function isDeleteBranchArgs(a: any): a is {
  workspace: string; repository: string; branch_name: string; expected_head?: string;
} {
  return repoScoped(a) && str(a.branch_name) && optStr(a.expected_head);
}

export function isListBranchCommitsArgs(a: any): a is {
  workspace: string; repository: string; branch_name: string;
  limit?: number; start?: number; since?: string; until?: string; author?: string;
  include_merge_commits?: boolean; search?: string; include_build_status?: boolean;
} {
  return repoScoped(a) && str(a.branch_name) && optPosInt(a.limit) && optNonNegInt(a.start) &&
    optStr(a.since) && optStr(a.until) && optStr(a.author) &&
    optBool(a.include_merge_commits) && optStr(a.search) && optBool(a.include_build_status);
}

export function isGetCommitDetailArgs(a: any): a is {
  workspace: string; repository: string; commit_id: string;
  context_lines?: number; include_patterns?: string[]; exclude_patterns?: string[];
  file_path?: string; detail?: 'diff' | 'files';
} {
  return repoScoped(a) && isCommitId(a.commit_id) && optNonNegInt(a.context_lines) &&
    optStrArr(a.include_patterns) && optStrArr(a.exclude_patterns) && optStr(a.file_path) &&
    (a.detail === undefined || ['diff', 'files'].includes(a.detail));
}

// ── Files ────────────────────────────────────────────────────────────────────

export function isListDirectoryContentArgs(a: any): a is {
  workspace: string; repository: string; path?: string; branch?: string;
} {
  return repoScoped(a) && optStr(a.path) && optStr(a.branch);
}

export function isGetFileContentArgs(a: any): a is {
  workspace: string; repository: string; file_path: string; branch?: string;
  start_line?: number; line_count?: number; full_content?: boolean;
} {
  return repoScoped(a) && str(a.file_path) && optStr(a.branch) &&
    optInt(a.start_line) && optPosInt(a.line_count) && optBool(a.full_content);
}

export function isGetFileBlameArgs(a: any): a is {
  workspace: string; repository: string; file_path: string; branch?: string;
  start_line?: number; line_count?: number;
} {
  return repoScoped(a) && str(a.file_path) && optStr(a.branch) &&
    optInt(a.start_line) && optPosInt(a.line_count);
}

// ── Discovery ────────────────────────────────────────────────────────────────

export function isListProjectsArgs(a: any): a is {
  workspace?: string; name?: string; permission?: string; limit?: number; start?: number;
} {
  return isObj(a) && optStr(a.workspace) && optStr(a.name) && optStr(a.permission) &&
    optPosInt(a.limit) && optNonNegInt(a.start);
}

export function isListRepositoriesArgs(a: any): a is {
  workspace?: string; name?: string; permission?: string; limit?: number; start?: number;
} {
  return isObj(a) && optIdent(a.workspace) && optStr(a.name) && optStr(a.permission) &&
    optPosInt(a.limit) && optNonNegInt(a.start);
}

// ── Search ───────────────────────────────────────────────────────────────────

export function isSearchCodeArgs(a: any): a is {
  workspace: string; repository?: string; query?: string; lang?: string; ext?: string; path?: string;
  exclude_terms?: string[]; archived?: 'true' | 'false' | '*'; fork?: 'true' | 'false';
  regex_filter?: string; limit?: number; start?: number;
  case_variants?: boolean; search_query?: string; search_context?: string;
  include_patterns?: string[]; file_pattern?: string;
} {
  return isObj(a) && isIdent(a.workspace) && optIdent(a.repository) &&
    optStr(a.query) && optStr(a.search_query) && optStr(a.lang) && optStr(a.ext) && optStr(a.path) &&
    optStrArr(a.exclude_terms) &&
    (a.archived === undefined || ['true', 'false', '*'].includes(a.archived as string)) &&
    (a.fork === undefined || ['true', 'false'].includes(a.fork as string)) &&
    optStr(a.regex_filter) && optPosInt(a.limit) && optNonNegInt(a.start) &&
    optBool(a.case_variants) && optStr(a.search_context) && optStrArr(a.include_patterns) && optStr(a.file_pattern);
}

export function isSearchRepositoriesArgs(a: any): a is {
  query?: string; search_query?: string; workspace?: string; limit?: number;
} {
  return isObj(a) && optStr(a.query) && optStr(a.search_query) && optIdent(a.workspace) && optPosInt(a.limit);
}

// ── grep ─────────────────────────────────────────────────────────────────────

export function isGrepArgs(a: any): a is {
  workspace: string; repository: string; query?: string; glob?: string; branch?: string; path?: string;
  mode?: 'content' | 'files' | 'count'; case_insensitive?: boolean; context?: number; max_results?: number;
} {
  return repoScoped(a) && optStr(a.query) && optStr(a.glob) && optStr(a.branch) && optStr(a.path) &&
    (a.mode === undefined || ['content', 'files', 'count'].includes(a.mode)) &&
    optBool(a.case_insensitive) && optInt(a.context) && optInt(a.max_results);
}

// ── Attachments ──────────────────────────────────────────────────────────────

export function isManageAttachmentsArgs(a: any): a is {
  workspace: string; repository: string; action: 'download' | 'delete'; attachment_id: string | number;
} {
  return repoScoped(a) && ['download', 'delete'].includes(a.action) && isAttachmentId(a.attachment_id);
}
