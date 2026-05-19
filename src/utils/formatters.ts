import {
  BitbucketServerPullRequest,
  BitbucketCloudPullRequest,
  MergeInfo,
  BitbucketServerCommit,
  BitbucketCloudCommit,
  FormattedCommit,
  BitbucketServerSearchResult,
} from '../types/bitbucket.js';

// Full detail format for get_pull_request
export function formatServerResponse(
  pr: BitbucketServerPullRequest,
  mergeInfo?: MergeInfo,
  baseUrl?: string
): any {
  const webUrl = `${baseUrl}/projects/${pr.toRef.repository.project.key}/repos/${pr.toRef.repository.slug}/pull-requests/${pr.id}`;

  return {
    id: pr.id,
    title: pr.title,
    description: pr.description || 'No description provided',
    state: pr.state,
    author: pr.author.user.displayName,
    author_username: pr.author.user.name,
    source_branch: pr.fromRef.displayId,
    destination_branch: pr.toRef.displayId,
    source_commit: pr.fromRef.latestCommit,
    destination_commit: pr.toRef.latestCommit,
    reviewers: (pr.reviewers || []).map(r => ({
      name: r.user.displayName,
      approved: r.approved,
      status: r.status,
    })),
    participants: (pr.participants || []).map(p => ({
      name: p.user.displayName,
      role: p.role,
      approved: p.approved,
      status: p.status,
    })),
    created_on: new Date(pr.createdDate).toLocaleString(),
    updated_on: new Date(pr.updatedDate).toLocaleString(),
    web_url: webUrl,
    is_locked: pr.locked,
    is_merged: pr.state === 'MERGED',
    merge_commit_hash: mergeInfo?.mergeCommitHash || pr.properties?.mergeCommit?.id || null,
    merged_by: mergeInfo?.mergedBy || null,
    merged_at: mergeInfo?.mergedAt || null,
  };
}

// Full detail format for get_pull_request (Cloud)
export function formatCloudResponse(pr: BitbucketCloudPullRequest): any {
  return {
    id: pr.id,
    title: pr.title,
    description: pr.description || 'No description provided',
    state: pr.state,
    author: pr.author.display_name,
    source_branch: pr.source.branch.name,
    destination_branch: pr.destination.branch.name,
    reviewers: (pr.reviewers || []).map(r => r.display_name),
    participants: (pr.participants || []).map(p => ({
      name: p.user.display_name,
      role: p.role,
      approved: p.approved,
    })),
    created_on: new Date(pr.created_on).toLocaleString(),
    updated_on: new Date(pr.updated_on).toLocaleString(),
    web_url: pr.links.html.href,
    is_merged: pr.state === 'MERGED',
    merge_commit_hash: pr.merge_commit?.hash || null,
    merged_by: pr.closed_by?.display_name || null,
    merged_at: pr.state === 'MERGED' ? pr.updated_on : null,
  };
}

// Slim list format for list_pull_requests (Server)
export function formatServerPRListItem(pr: BitbucketServerPullRequest, baseUrl?: string): any {
  const webUrl = `${baseUrl}/projects/${pr.toRef.repository.project.key}/repos/${pr.toRef.repository.slug}/pull-requests/${pr.id}`;
  return {
    id: pr.id,
    title: pr.title,
    state: pr.state,
    author: pr.author.user.displayName,
    author_username: pr.author.user.name,
    source_branch: pr.fromRef.displayId,
    destination_branch: pr.toRef.displayId,
    updated_on: new Date(pr.updatedDate).toLocaleString(),
    web_url: webUrl,
    reviewers: (pr.reviewers || []).map(r => ({ name: r.user.displayName, approved: r.approved })),
  };
}

// Slim list format for list_pull_requests (Cloud)
export function formatCloudPRListItem(pr: BitbucketCloudPullRequest): any {
  return {
    id: pr.id,
    title: pr.title,
    state: pr.state,
    author: pr.author.display_name,
    source_branch: pr.source.branch.name,
    destination_branch: pr.destination.branch.name,
    updated_on: new Date(pr.updated_on).toLocaleString(),
    web_url: pr.links.html.href,
    reviewers: (pr.reviewers || []).map(r => r.display_name),
  };
}

export function formatServerCommit(commit: BitbucketServerCommit): FormattedCommit {
  return {
    hash: commit.id,
    abbreviated_hash: commit.displayId,
    message: commit.message,
    author: {
      name: commit.author.name,
    },
    date: new Date(commit.authorTimestamp).toISOString(),
    is_merge_commit: (commit.parents || []).length > 1,
  };
}

export function formatCloudCommit(commit: BitbucketCloudCommit): FormattedCommit {
  const authorMatch = commit.author.raw.match(/^(.+?)\s*<(.+?)>$/);
  const authorName = authorMatch ? authorMatch[1] : (commit.author.user?.display_name || commit.author.raw);

  return {
    hash: commit.hash,
    abbreviated_hash: commit.hash.substring(0, 7),
    message: commit.message,
    author: {
      name: authorName,
    },
    date: commit.date,
    is_merge_commit: (commit.parents || []).length > 1,
  };
}

// ── Dense JSON formatter for search_code / find_in_files ────────────────────
// Returns only lines that actually match the query (not surrounding context),
// in a shape designed to be cheap for an LLM to consume.

export interface DenseSearchHit {
  line: number;
  text: string;
}

export interface DenseSearchFile {
  path: string;
  matches: DenseSearchHit[];
}

export interface DenseSearchResponse {
  query: string;
  filters: Record<string, string | boolean | undefined>;
  engine: 'bitbucket_index' | 'find_in_files';
  total_files: number;
  total_matches: number;
  files: DenseSearchFile[];
  warnings: string[];
  next_start: number | null;
  diagnostics: {
    expression_count?: number;
    query_length?: number;
    default_branch_only?: boolean;
    dropped_clauses?: Array<{ role: string; text: string; reason: string }>;
    files_scanned?: number;
    files_attempted?: number;
    files_failed?: number;
    files_truncated?: boolean;
  };
}

const HTML_ENTITIES: Array<[RegExp, string]> = [
  [/<em>/g, ''],
  [/<\/em>/g, ''],
  [/&quot;/g, '"'],
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&amp;/g, '&'],
  [/&#x2F;/g, '/'],
  [/&#x27;/g, "'"],
];

function decodeHitText(s: string): string {
  let out = s;
  for (const [pattern, repl] of HTML_ENTITIES) out = out.replace(pattern, repl);
  return out;
}

function lineContainsMatch(htmlText: string): boolean {
  // Bitbucket marks matched segments with <em>...</em>; if the line lacks <em>,
  // it is surrounding context, not a match line.
  return /<em>/.test(htmlText);
}

// Build the dense response from a Bitbucket search result. Strips surrounding-context
// lines (those without <em> markers) so the output is hit-only.
export function buildDenseResponseFromIndex(args: {
  searchResult: BitbucketServerSearchResult;
  query: string;
  filters: Record<string, string | boolean | undefined>;
  warnings?: string[];
  diagnostics?: DenseSearchResponse['diagnostics'];
  start: number;
  limit: number;
  postFilter?: (line: string) => boolean;
}): DenseSearchResponse {
  const { searchResult, query, filters, warnings = [], diagnostics = {}, start, limit, postFilter } = args;

  const code = searchResult.code;
  const files: DenseSearchFile[] = [];
  let totalMatches = 0;

  if (code?.values) {
    for (const value of code.values) {
      const hits: DenseSearchHit[] = [];
      const seenLines = new Set<number>();
      for (const group of value.hitContexts ?? []) {
        for (const ctx of group) {
          if (!lineContainsMatch(ctx.text)) continue;
          const text = decodeHitText(ctx.text);
          if (postFilter && !postFilter(text)) continue;
          if (seenLines.has(ctx.line)) continue;
          seenLines.add(ctx.line);
          hits.push({ line: ctx.line, text });
        }
      }
      if (hits.length > 0) {
        hits.sort((a, b) => a.line - b.line);
        files.push({ path: value.file, matches: hits });
        totalMatches += hits.length;
      }
    }
  }

  const hasMore = code?.isLastPage === false;
  const nextStart = hasMore ? (code?.nextStart ?? start + limit) : null;

  return {
    query,
    filters,
    engine: 'bitbucket_index',
    total_files: files.length,
    total_matches: totalMatches,
    files,
    warnings,
    next_start: nextStart,
    diagnostics: { default_branch_only: true, ...diagnostics },
  };
}
