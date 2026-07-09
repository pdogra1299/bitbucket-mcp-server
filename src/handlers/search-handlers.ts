import type {
  BitbucketServerSearchRequest,
  BitbucketServerSearchResult,
  DenseSearchResponse,
  QueryClause,
  ToolResponse,
} from '../types/index.js';
import { BitbucketApiClient } from '../core/api-client.js';
import { listRepoFiles } from '../core/file-list.js';
import {
  buildQueryFromClauses,
  MAX_EXPRESSIONS,
  MAX_QUERY_LENGTH,
  quoteIfNeeded,
} from '../core/query-budget.js';
import { buildDenseResponseFromIndex, renderSearchText } from '../formatting/formatters.js';
import { capDetails, errorContent, textContent } from '../formatting/respond.js';
import { minimatch } from 'minimatch';

// Index-backed search tools (Bitbucket Server only).
//
// search_code — one POST to /rest/search/latest/search. v3 changes:
//  * case_variants removed: the index is case-INsensitive per Atlassian docs,
//    so the second query was provably redundant (accepted + warned).
//  * The index-gap probe is a SINGLE first-page file listing (config
//    pagination.probePageLimit) instead of a full up-to-40-page listing.
//  * Pagination stops at the search server's ~1000-result window with
//    steering text instead of a confusing server error.
//  * Output is ripgrep-style text.

function compileRegexFilter(pattern: string | undefined): ((line: string) => boolean) | undefined {
  if (!pattern) return undefined;
  try {
    const re = new RegExp(pattern);
    return (line: string) => re.test(line);
  } catch {
    return undefined;
  }
}

function extractBareExtension(filePattern: string | undefined): string | null {
  if (!filePattern) return null;
  const m = filePattern.match(/^\*\.([A-Za-z0-9]+)$/);
  return m ? m[1] : null;
}

// The search server's OpenSearch index ships with max_result_window=1000;
// paging past it throws QueryInvalidSearchOffsetException. Protocol constant
// of the remote API, not a tunable.
const SEARCH_RESULT_WINDOW = 1000;

type SearchCodeArgs = {
  workspace: string;
  repository?: string;
  query: string;
  lang?: string;
  ext?: string;
  path?: string;
  exclude_terms?: string[];
  archived?: 'true' | 'false' | '*';
  fork?: 'true' | 'false';
  regex_filter?: string;
  limit?: number;
  start?: number;
  // Deprecated — accepted for backwards-compatibility, warned, ignored/mapped.
  case_variants?: boolean;
  search_query?: string;
  search_context?: string;
  include_patterns?: string[];
  file_pattern?: string;
};

export class SearchHandlers {
  constructor(private apiClient: BitbucketApiClient) {}

  async handleSearchCode(args: SearchCodeArgs): Promise<ToolResponse> {
    try {
      const cfg = this.apiClient.getConfig();
      const warnings: string[] = [];

      const rawQuery = (args.query ?? args.search_query ?? '').trim();
      if (!args.workspace || !rawQuery) throw new Error('workspace and query are required');
      if (args.search_query && !args.query) {
        warnings.push('DEPRECATED_PARAM: `search_query` is renamed to `query`.');
      }
      if (args.search_context) {
        warnings.push('DEPRECATED_PARAM: `search_context` is removed. Use `regex_filter`.');
      }
      if (args.include_patterns?.length) {
        warnings.push('DEPRECATED_PARAM: `include_patterns` is removed. Use `regex_filter`.');
      }
      if (args.case_variants) {
        warnings.push('DEPRECATED_PARAM: `case_variants` is removed — Bitbucket code search is case-insensitive, the extra query was redundant.');
      }
      if (!this.apiClient.getIsServer()) {
        throw new Error('search_code is only supported for Bitbucket Server.');
      }

      const limit = args.limit ?? cfg.pagination.defaultListLimit;
      const start = args.start ?? 0;
      if (start + limit > SEARCH_RESULT_WINDOW) {
        return errorContent(
          `Bitbucket's search index cannot page past ~${SEARCH_RESULT_WINDOW} results ` +
            `(requested start=${start}, limit=${limit}). Refine the query (add repo:/path:/ext: filters) instead of paging deeper.`
        );
      }

      let resolvedExt = args.ext;
      let resolvedPath = args.path;
      if (!resolvedExt && args.file_pattern) {
        const bareExt = extractBareExtension(args.file_pattern);
        if (bareExt) {
          resolvedExt = bareExt;
          warnings.push('DEPRECATED_PARAM: `file_pattern` mapped to `ext`.');
        } else if (!resolvedPath) {
          resolvedPath = args.file_pattern;
          warnings.push('DEPRECATED_PARAM: `file_pattern` mapped to `path`.');
        }
      }

      const clauses: QueryClause[] = [{ text: `project:${args.workspace}`, role: 'project', required: true }];
      if (args.repository) clauses.push({ text: `repo:${args.repository}`, role: 'repo', required: false });
      if (args.lang) clauses.push({ text: `lang:${args.lang}`, role: 'lang', required: false });
      if (resolvedExt) clauses.push({ text: `ext:${resolvedExt}`, role: 'ext', required: false });
      if (resolvedPath) clauses.push({ text: `path:${resolvedPath}`, role: 'path', required: false });
      if (args.archived) clauses.push({ text: `archived:${args.archived}`, role: 'archived', required: false });
      if (args.fork) clauses.push({ text: `fork:${args.fork}`, role: 'fork', required: false });
      clauses.push({ text: quoteIfNeeded(rawQuery), role: 'term', required: true });
      for (const term of args.exclude_terms ?? []) {
        if (term.trim().length === 0) continue;
        clauses.push({ text: `-${quoteIfNeeded(term.trim())}`, role: 'exclude', required: false });
      }

      const built = buildQueryFromClauses(clauses);
      if (built.dropped.length > 0) {
        warnings.push(
          `QUERY_TRUNCATED: dropped ${built.dropped.length} optional clause(s) to fit Bitbucket caps ` +
            `(${MAX_QUERY_LENGTH} chars / ${MAX_EXPRESSIONS} expressions): ${built.dropped.map(d => d.role).join(', ')}.`
        );
      }
      if (built.query_length > MAX_QUERY_LENGTH || built.expression_count > MAX_EXPRESSIONS) {
        return errorContent(
          `Query exceeds Bitbucket caps even after dropping optional clauses ` +
            `(length=${built.query_length}/${MAX_QUERY_LENGTH}, expressions=${built.expression_count}/${MAX_EXPRESSIONS}). Shorten the term.`
        );
      }

      const postFilter = compileRegexFilter(args.regex_filter);
      if (args.regex_filter && !postFilter) {
        warnings.push('INVALID_REGEX: `regex_filter` could not be compiled and was ignored.');
      }

      const primary = await this.runIndexedSearch(built.query, start, limit);
      const rawHitCount = countRawHitLines(primary);
      const response = buildDenseResponseFromIndex({
        searchResult: primary,
        query: rawQuery,
        filters: {},
        warnings,
        start,
        limit,
        postFilter,
      });

      if (response.total_matches === 0 && rawHitCount > 0 && args.regex_filter) {
        response.warnings.push(
          `REGEX_FILTER_REJECTED_ALL: ${rawHitCount} raw hit(s) returned but regex_filter rejected them all.`
        );
      }

      // Index-gap probe: fires only on zero raw hits with a repo scope, and
      // costs exactly ONE single-page listing call.
      if (rawHitCount === 0 && args.repository) {
        await this.probeIndexGap(args, resolvedExt, resolvedPath, response, cfg.pagination.probePageLimit);
      }

      return this.renderIndexResponse(args, response, rawQuery, start, limit);
    } catch (error: any) {
      const msg = error.response?.data?.errors?.[0]?.message || error.message;
      const details = capDetails(error.response?.data, this.apiClient.getConfig().output.errorDetailsMax);
      return errorContent(`Failed to search code: ${msg}${details ? `\ndetails: ${details}` : ''}`);
    }
  }

  private async probeIndexGap(
    args: SearchCodeArgs,
    ext: string | undefined,
    path: string | undefined,
    response: DenseSearchResponse,
    probeLimit: number
  ): Promise<void> {
    try {
      // One-page listing (config probePageLimit); a single match is enough
      // to distinguish "term absent" from "index gap". path: filters can
      // carry glob chars — probe only the literal directory prefix.
      const literalPrefix = path
        ? path.split('/').filter(seg => !/[*?[\]]/.test(seg) && seg !== '').join('/')
        : '';
      const probePath = literalPrefix
        ? `/${literalPrefix.split('/').map(encodeURIComponent).join('/')}`
        : '';
      const listing = await this.apiClient.makeRequest<any>(
        'get',
        `/rest/api/latest/projects/${args.workspace}/repos/${args.repository}/files${probePath}`,
        undefined,
        { params: { limit: probeLimit, start: 0 } }
      );
      const values: string[] = Array.isArray(listing) ? listing : listing?.values ?? [];
      const glob = ext ? `**/*.${ext}` : null;
      const matching = glob
        ? values.filter(p => minimatch(p, glob, { matchBase: true, nocase: true }))
        : values;
      if (matching.length > 0) {
        const langHint = args.lang
          ? ` The 'lang:${args.lang}' filter may not be recognized — try ext: instead.`
          : '';
        response.warnings.push(
          `INDEX_GAP_LIKELY: ${matching.length}${listing?.isLastPage === false ? '+' : ''} file(s) match your filters but the index returned 0 hits.${langHint} ` +
            `Switch to grep (archive-backed, works on any branch and unindexed content).`
        );
      }
    } catch (err: any) {
      response.warnings.push(`PROBE_UNAVAILABLE: index returned 0 hits and the probe listing failed (${err?.message ?? err}).`);
    }
  }

  private renderIndexResponse(
    args: SearchCodeArgs,
    response: DenseSearchResponse,
    rawQuery: string,
    start: number,
    limit: number
  ): ToolResponse {
    const scope = args.repository ? `${args.workspace}/${args.repository}` : `project ${args.workspace}`;
    const header =
      `search_code "${rawQuery}" in ${scope} (default branch, index) — ` +
      `${response.total_matches} matching lines in ${response.total_files} files`;
    let footer: string | undefined;
    if (response.next_start !== null) {
      if (response.next_start >= SEARCH_RESULT_WINDOW) {
        footer = `More results exist but the index cannot page past ~${SEARCH_RESULT_WINDOW}; refine the query.`;
      } else {
        // A final partial page is still retrievable up to the window.
        const nextLimit = Math.min(limit, SEARCH_RESULT_WINDOW - response.next_start);
        footer = `More results: re-run with start=${response.next_start}${nextLimit < limit ? ` and limit=${nextLimit} (index window)` : ''}.`;
      }
    }
    return textContent(
      renderSearchText({ header, files: response.files, warnings: response.warnings, footer })
    );
  }

  // ── search_repositories ────────────────────────────────────────────────────

  async handleSearchRepositories(args: any): Promise<ToolResponse> {
    try {
      const cfg = this.apiClient.getConfig();
      const { search_query, query, workspace } = args;
      const limit = args.limit ?? cfg.pagination.defaultListLimit;
      const term = (query ?? search_query ?? '').trim();
      if (!term) throw new Error('query is required');
      if (!this.apiClient.getIsServer()) {
        throw new Error('search_repositories is only supported for Bitbucket Server.');
      }

      let q = term;
      if (workspace) q = `project:${workspace} ${q}`;

      const payload: BitbucketServerSearchRequest = {
        query: q,
        entities: { repositories: {} },
        limits: { primary: limit },
      };
      const response = await this.apiClient.makeRequest<BitbucketServerSearchResult>(
        'post',
        `/rest/search/latest/search?avatarSize=64`,
        payload,
        undefined,
        { idempotent: true }
      );

      const repos = response.repositories?.values ?? [];
      const lines = repos.map(r => {
        const desc = r.description ? ` — ${r.description}` : '';
        return `${r.project.key}/${r.slug}${desc}`;
      });
      const header = `repositories matching "${term}"${workspace ? ` in ${workspace}` : ''} — ${repos.length} found${response.repositories?.isLastPage === false ? ' (more exist; refine the term)' : ''}`;
      return textContent([header, '', ...lines].join('\n'));
    } catch (error: any) {
      const msg = error.response?.data?.errors?.[0]?.message || error.message;
      return errorContent(`Failed to search repositories: ${msg}`);
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async runIndexedSearch(query: string, start: number, limit: number) {
    const payload: BitbucketServerSearchRequest = {
      query,
      entities: { code: { start, limit } },
    };
    // POST, but a pure read — mark idempotent so transient failures retry.
    return this.apiClient.makeRequest<BitbucketServerSearchResult>(
      'post',
      `/rest/search/latest/search?avatarSize=64`,
      payload,
      undefined,
      { idempotent: true }
    );
  }
}

// Count raw hit lines (lines marked with <em>) so probe decisions are based
// on what Bitbucket returned, not on post-filtered output.
function countRawHitLines(searchResult: BitbucketServerSearchResult): number {
  let n = 0;
  for (const value of searchResult.code?.values ?? []) {
    for (const group of value.hitContexts ?? []) {
      for (const ctx of group) {
        if (/<em>/.test(ctx.text)) n++;
      }
    }
  }
  return n;
}
