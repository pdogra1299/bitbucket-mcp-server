import type {
  BitbucketCloudCommit,
  BitbucketCloudPullRequest,
  BitbucketServerCommit,
  BitbucketServerPullRequest,
  BitbucketServerSearchResult,
  DenseSearchFile,
  DenseSearchHit,
  DenseSearchResponse,
  FormattedCommit,
} from '../types/index.js';
import { compactObject, isoDate } from './respond.js';

// Compact entity formatters (REVAMP_PLAN.md Pillar C): ISO dates, no
// derivable/duplicate fields, no explicit nulls, no filler strings. `version`
// is kept on mutable entities so follow-up mutations need no extra GET.

function reviewerLabel(name: string, status?: string, approved?: boolean): string {
  if (status === 'APPROVED' || approved) return `${name} (APPROVED)`;
  if (status === 'NEEDS_WORK') return `${name} (NEEDS_WORK)`;
  return name;
}

/** Full detail format for get_pull_request (Server). */
export function formatServerPullRequest(pr: BitbucketServerPullRequest, baseUrl?: string): Record<string, unknown> {
  const props: any = (pr as any).properties ?? {};
  const webUrl = baseUrl
    ? `${baseUrl}/projects/${pr.toRef.repository.project.key}/repos/${pr.toRef.repository.slug}/pull-requests/${pr.id}`
    : undefined;
  return compactObject({
    id: pr.id,
    version: (pr as any).version,
    title: pr.title,
    description: pr.description || undefined,
    state: pr.state,
    author: pr.author.user.displayName,
    author_username: pr.author.user.name,
    source_branch: pr.fromRef.displayId,
    destination_branch: pr.toRef.displayId,
    source_commit: pr.fromRef.latestCommit,
    reviewers: pr.reviewers.map(r => reviewerLabel(r.user.displayName, r.status, r.approved)),
    created_on: isoDate(pr.createdDate),
    updated_on: isoDate(pr.updatedDate),
    closed_on: isoDate((pr as any).closedDate),
    // Merge info comes free on the PR resource for merged PRs
    // (properties.mergeCommit; absent when the PR was "merged remotely").
    merge_commit: props.mergeCommit?.id,
    comment_count: props.commentCount,
    open_task_count: props.openTaskCount,
    resolved_task_count: props.resolvedTaskCount,
    is_locked: pr.locked || undefined,
    web_url: webUrl,
  });
}

/** Full detail format for get_pull_request (Cloud). */
export function formatCloudPullRequest(pr: BitbucketCloudPullRequest): Record<string, unknown> {
  return compactObject({
    id: pr.id,
    title: pr.title,
    description: pr.description || undefined,
    state: pr.state,
    author: pr.author.display_name,
    source_branch: pr.source.branch.name,
    destination_branch: pr.destination.branch.name,
    reviewers: pr.reviewers.map(r => r.display_name),
    approved_by: pr.participants?.filter(p => p.approved).map(p => p.user.display_name),
    created_on: isoDate(pr.created_on),
    updated_on: isoDate(pr.updated_on),
    merge_commit: pr.merge_commit?.hash,
    merged_by: pr.closed_by?.display_name,
    web_url: pr.links.html.href,
  });
}

/** Slim list item for list_pull_requests (Server). */
export function formatServerPrListItem(pr: BitbucketServerPullRequest): Record<string, unknown> {
  return compactObject({
    id: pr.id,
    version: (pr as any).version,
    title: pr.title,
    state: pr.state,
    author: pr.author.user.displayName,
    source_branch: pr.fromRef.displayId,
    destination_branch: pr.toRef.displayId,
    updated_on: isoDate(pr.updatedDate),
    reviewers: pr.reviewers.map(r => reviewerLabel(r.user.displayName, r.status, r.approved)),
    open_task_count: (pr as any).properties?.openTaskCount,
  });
}

/** Slim list item for list_pull_requests (Cloud). */
export function formatCloudPrListItem(pr: BitbucketCloudPullRequest): Record<string, unknown> {
  return compactObject({
    id: pr.id,
    title: pr.title,
    state: pr.state,
    author: pr.author.display_name,
    source_branch: pr.source.branch.name,
    destination_branch: pr.destination.branch.name,
    updated_on: isoDate(pr.updated_on),
    reviewers: pr.reviewers.map(r => r.display_name),
  });
}

export function formatServerCommit(commit: BitbucketServerCommit): FormattedCommit {
  return {
    hash: commit.id,
    abbreviated_hash: commit.displayId,
    message: commit.message,
    author: { name: commit.author.name },
    date: isoDate(commit.authorTimestamp) ?? '',
    is_merge_commit: commit.parents.length > 1,
  };
}

export function formatCloudCommit(commit: BitbucketCloudCommit): FormattedCommit {
  const authorMatch = commit.author.raw.match(/^(.+?)\s*<(.+?)>$/);
  const authorName = authorMatch ? authorMatch[1] : (commit.author.user?.display_name || commit.author.raw);
  return {
    hash: commit.hash,
    abbreviated_hash: commit.hash.substring(0, 7),
    message: commit.message,
    author: { name: authorName },
    date: commit.date,
    is_merge_commit: commit.parents.length > 1,
  };
}

/** Compact commit rendering for list responses (no derivable fields). */
export function compactCommit(c: FormattedCommit): Record<string, unknown> {
  return compactObject({
    hash: c.hash.slice(0, 12),
    message: c.message,
    author: c.author.name,
    date: c.date,
    is_merge: c.is_merge_commit || undefined,
    build_status: (c as any).build_status,
  });
}

// ── Dense search formatting (search_code) ────────────────────────────────────
// Returns only lines that actually match (Bitbucket marks them with <em>).

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
  return /<em>/.test(htmlText);
}

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

/**
 * Render dense search / grep results as ripgrep-style text — the most
 * token-efficient shape for code-reading agents:
 *
 *   src/foo.ts
 *     12: const apiClient = …
 */
export function renderSearchText(args: {
  header: string;
  files: Array<{ path: string; matches: Array<{ line: number; text: string; before?: Array<[number, string]>; after?: Array<[number, string]> }> }>;
  warnings: string[];
  footer?: string;
}): string {
  const out: string[] = [args.header];
  for (const file of args.files) {
    out.push('', file.path);
    for (const m of file.matches) {
      for (const [ln, text] of m.before ?? []) out.push(`  ${ln}- ${text}`);
      out.push(`  ${m.line}: ${m.text}`);
      for (const [ln, text] of m.after ?? []) out.push(`  ${ln}- ${text}`);
    }
  }
  if (args.footer) out.push('', args.footer);
  for (const w of args.warnings) out.push('', `WARNING: ${w}`);
  return out.join('\n');
}
