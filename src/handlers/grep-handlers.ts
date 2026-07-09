import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { minimatch } from 'minimatch';
import type { GrepFileResult, ToolResponse } from '../types/index.js';
import { BitbucketApiClient, encodeRepoPath } from '../core/api-client.js';
import { RepoSnapshotStore } from '../core/snapshot.js';
import { listRepoFiles } from '../core/file-list.js';
import { scanFilesConcurrent } from '../core/scan.js';
import { renderSearchText } from '../formatting/formatters.js';
import { errorContent, textContent } from '../formatting/respond.js';

// grep — repo content search that behaves like ripgrep on a local clone.
//
// Engines (in preference order):
//   snapshot  — warm in-memory checkout, freshness-validated per call
//   stream    — one archive download, scanned in constant memory
//   fanout    — bounded per-file fetch fallback (archive unavailable)
// Filename-only mode (no `query`) lists paths by glob from the warm snapshot
// or a single /files call — this folds the old search_files tool in.

type GrepArgs = {
  workspace: string;
  repository: string;
  query?: string;
  glob?: string;
  branch?: string;
  path?: string;
  mode?: 'content' | 'files' | 'count';
  case_insensitive?: boolean;
  context?: number;
  max_results?: number;
};

function isGrepArgs(args: any): args is GrepArgs {
  return (
    typeof args === 'object' &&
    args !== null &&
    typeof args.workspace === 'string' &&
    typeof args.repository === 'string' &&
    (args.query === undefined || typeof args.query === 'string') &&
    (args.glob === undefined || typeof args.glob === 'string') &&
    (args.branch === undefined || typeof args.branch === 'string') &&
    (args.path === undefined || typeof args.path === 'string') &&
    (args.mode === undefined || ['content', 'files', 'count'].includes(args.mode)) &&
    (args.context === undefined || typeof args.context === 'number') &&
    (args.max_results === undefined || typeof args.max_results === 'number')
  );
}

export class GrepHandlers {
  constructor(
    private apiClient: BitbucketApiClient,
    private snapshots: RepoSnapshotStore
  ) {}

  async handleGrep(args: any): Promise<ToolResponse> {
    if (!isGrepArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for grep');
    }
    if (!this.apiClient.getIsServer()) {
      return errorContent(
        'grep is only supported on Bitbucket Server / Data Center (archive + raw APIs). ' +
          'On Bitbucket Cloud use get_file_content / list_directory_content.'
      );
    }

    const cfg = this.apiClient.getConfig();
    const { workspace, repository, branch, glob } = args;
    const pathPrefix = args.path?.replace(/^\/+|\/+$/g, '') || undefined;

    // Filename-only mode: no content query → glob listing.
    if (!args.query || args.query.trim() === '') {
      return this.handleFileListing(args, pathPrefix);
    }

    let regex: RegExp;
    try {
      regex = new RegExp(args.query, args.case_insensitive ? 'i' : undefined);
    } catch (e: any) {
      return errorContent(`Invalid regex in query: ${e.message}`);
    }

    const contextLines = Math.min(Math.max(args.context ?? cfg.grep.defaultContext, 0), cfg.grep.maxContext);
    const maxMatches = Math.min(Math.max(args.max_results ?? cfg.grep.defaultMaxMatches, 1), cfg.grep.maxMatchesCap);
    const mode = args.mode ?? 'content';

    // Resolve the ref up front: a bad branch/repo surfaces as a normal API
    // error and never triggers the archive-unavailable fallback.
    let sha: string;
    try {
      sha = await this.apiClient.resolveRef(workspace, repository, branch);
    } catch (error: any) {
      if (error?.isAxiosError || error?.status) {
        return this.apiClient.handleApiError(error, `resolving ${branch ?? 'default branch'} in ${workspace}/${repository}`) as ToolResponse;
      }
      throw error;
    }

    try {
      const outcome = await this.snapshots.grep({
        project: workspace,
        repository,
        ref: sha,
        pathPrefix,
        regex,
        glob,
        maxMatches: mode === 'content' ? maxMatches : 0,
        contextLines: mode === 'content' ? contextLines : 0,
      });
      return this.render(args, mode, maxMatches, {
        sha: outcome.sha,
        engine: outcome.engine,
        results: outcome.results,
        totalMatches: outcome.totalMatches,
        filesScanned: outcome.filesScanned,
        binariesSkipped: outcome.binariesSkipped,
        warnings: outcome.warnings,
      });
    } catch (error: any) {
      // Archive unavailable (disabled, forbidden, or failing) — fall back to
      // the bounded per-file scan so the query still gets answered.
      if (error?.isAxiosError && [400, 401, 403, 404, 405, 501].includes(error.status)) {
        try {
          return await this.grepViaFanout(args, regex, glob, mode, maxMatches, pathPrefix, sha, `archive endpoint returned ${error.status}`);
        } catch (fallbackError: any) {
          if (fallbackError?.isAxiosError) {
            return this.apiClient.handleApiError(fallbackError, `grep (fanout) in ${workspace}/${repository}`) as ToolResponse;
          }
          throw fallbackError;
        }
      }
      if (error?.isAxiosError) {
        return this.apiClient.handleApiError(error, `grep in ${workspace}/${repository}`) as ToolResponse;
      }
      throw error;
    }
  }

  // ── Filename-only listing (replaces search_files) ─────────────────────────

  private async handleFileListing(args: GrepArgs, pathPrefix?: string): Promise<ToolResponse> {
    const cfg = this.apiClient.getConfig();
    const { workspace, repository, branch, glob } = args;
    const maxResults = Math.min(
      Math.max(args.max_results ?? cfg.grep.defaultMaxMatches, 1),
      cfg.grep.maxMatchesCap
    );

    try {
      // Warm snapshot serves the listing after the standard freshness check;
      // otherwise one /files call (server cap fits whole trees in one page).
      const warm = await this.snapshots.listPathsIfWarm(workspace, repository, branch, pathPrefix ?? '');
      let paths: string[];
      let truncatedListing = false;
      let sha: string | undefined = warm?.sha;
      if (warm) {
        paths = warm.paths;
      } else {
        const listing = await listRepoFiles(this.apiClient, workspace, repository, {
          branch,
          path: pathPrefix,
        });
        paths = listing.files;
        truncatedListing = listing.truncated;
      }

      const matched = glob ? paths.filter(p => this.globMatch(p, glob)) : paths;
      const shown = matched.slice(0, maxResults);
      const warnings: string[] = [];
      if (truncatedListing) {
        warnings.push(
          'FILE_LIST_TRUNCATED: the server-side listing hit its pagination cap; unlisted files are not shown. Narrow with `path`.'
        );
      }
      const header =
        `files ${glob ? `matching "${glob}" ` : ''}in ${workspace}/${repository}` +
        `${branch ? ` @ ${branch}` : ''}${sha ? ` (as_of ${sha.slice(0, 12)})` : ''}` +
        ` — ${matched.length} files${matched.length > shown.length ? `, showing ${shown.length}` : ''}`;
      const body = [header, '', ...shown];
      if (matched.length > shown.length) {
        body.push('', `…and ${matched.length - shown.length} more. Raise max_results or narrow the glob.`);
      }
      for (const w of warnings) body.push('', `WARNING: ${w}`);
      return textContent(body.join('\n'));
    } catch (error: any) {
      if (error?.isAxiosError) {
        return this.apiClient.handleApiError(error, `listing files in ${workspace}/${repository}`) as ToolResponse;
      }
      throw error;
    }
  }

  // ── Fan-out fallback ───────────────────────────────────────────────────────

  private async grepViaFanout(
    args: GrepArgs,
    regex: RegExp,
    glob: string | undefined,
    mode: 'content' | 'files' | 'count',
    maxMatches: number,
    pathPrefix: string | undefined,
    sha: string,
    reason: string
  ): Promise<ToolResponse> {
    const cfg = this.apiClient.getConfig();
    const { workspace, repository } = args;

    // Pin the whole scan to the resolved SHA so listing and fetches are
    // consistent and the result carries an as_of commit.
    const listing = await listRepoFiles(this.apiClient, workspace, repository, { branch: sha, path: pathPrefix });
    const candidates = glob ? listing.files.filter(p => this.globMatch(p, glob)) : listing.files;
    const toScan = candidates.slice(0, cfg.scan.maxScanFiles);

    const scan = await scanFilesConcurrent({
      files: toScan,
      parallelism: cfg.scan.defaultParallelism,
      scanConfig: cfg.scan,
      fetchContent: filePath =>
        this.apiClient.makeRequest<string>(
          'get',
          `/rest/api/latest/projects/${workspace}/repos/${repository}/raw/${encodeRepoPath(filePath)}`,
          undefined,
          {
            params: { at: sha },
            responseType: 'text',
            headers: { Accept: 'text/plain' },
          }
        ),
      contentRe: regex,
    });

    const warnings = [`FALLBACK_FANOUT: snapshot engine unavailable (${reason}); scanned ${scan.aborted_after}/${toScan.length} files individually.`];
    if (candidates.length > toScan.length) {
      warnings.push(
        `FILES_TRUNCATED: ${candidates.length} files matched; only the first ${toScan.length} were scanned (BITBUCKET_MAX_SCAN_FILES). Narrow the glob.`
      );
    }
    if (listing.truncated) {
      warnings.push('FILE_LIST_TRUNCATED: file listing hit its pagination cap; coverage is incomplete.');
    }
    if (scan.rate_limited) {
      warnings.push('RATE_LIMITED: Bitbucket kept throttling; the scan stopped early. Results are partial.');
    }
    if (scan.failures.length > 0) {
      const sample = scan.failures.slice(0, 3).map(f => f.path).join(', ');
      warnings.push(`FETCH_FAILURES: ${scan.failures.length} file(s) could not be read (sample: ${sample}).`);
    }

    // Cap displayed match lines across files at maxMatches; totals keep the
    // full counts so the footer reports the truncation honestly.
    let budget = maxMatches;
    const results: GrepFileResult[] = scan.results.map(r => {
      const shown = r.matches.slice(0, Math.max(budget, 0)).map(m => ({
        line: m.line,
        text: m.text.length > cfg.grep.maxLineLength ? m.text.slice(0, cfg.grep.maxLineLength) + '…' : m.text,
      }));
      budget -= shown.length;
      return { path: r.path, matches: shown, count: r.matches.length };
    });
    const totalMatches = scan.results.reduce((acc, r) => acc + r.matches.length, 0);

    return this.render(args, mode, maxMatches, {
      sha,
      engine: 'fanout',
      results,
      totalMatches,
      filesScanned: scan.aborted_after,
      binariesSkipped: 0,
      warnings,
    });
  }

  // ── Rendering (ripgrep-style plain text) ───────────────────────────────────

  private render(
    args: GrepArgs,
    mode: 'content' | 'files' | 'count',
    maxMatches: number,
    outcome: {
      sha: string;
      engine: string;
      results: GrepFileResult[];
      totalMatches: number;
      filesScanned: number;
      binariesSkipped: number;
      warnings: string[];
    }
  ): ToolResponse {
    const { workspace, repository, branch } = args;
    const asOf = outcome.sha ? ` (as_of ${outcome.sha.slice(0, 12)})` : '';
    const shownMatches = outcome.results.reduce((acc, r) => acc + r.matches.length, 0);
    const header =
      `grep /${args.query}/${args.case_insensitive ? 'i' : ''} in ${workspace}/${repository}` +
      `${branch ? ` @ ${branch}` : ''}${asOf} — ${outcome.totalMatches} matches in ` +
      `${outcome.results.length} files (scanned ${outcome.filesScanned} files, engine: ${outcome.engine})`;

    const warnings = [...outcome.warnings];
    if (outcome.binariesSkipped > 0) {
      warnings.push(`BINARIES_SKIPPED: ${outcome.binariesSkipped} binary file(s) were not searched.`);
    }

    if (mode === 'files' || mode === 'count') {
      const all = outcome.results.map(r => (mode === 'count' ? `${r.count ?? r.matches.length}\t${r.path}` : r.path));
      const lines = all.slice(0, maxMatches);
      const body = [header, '', ...lines];
      if (all.length > lines.length) {
        body.push('', `…and ${all.length - lines.length} more files. Raise max_results or narrow the glob.`);
      }
      for (const w of warnings) body.push('', `WARNING: ${w}`);
      return textContent(body.join('\n'));
    }

    // Content mode: files whose match lines were entirely cut by the
    // cross-file budget fold into the footer instead of rendering as bare
    // paths.
    const shownFiles = outcome.results.filter(r => r.matches.length > 0);
    const hiddenFiles = outcome.results.length - shownFiles.length;
    let footer: string | undefined;
    if (outcome.totalMatches > shownMatches) {
      footer =
        `Showing ${shownMatches} of ${outcome.totalMatches} match lines (max_results=${maxMatches})` +
        `${hiddenFiles > 0 ? `; ${hiddenFiles} more matching files not shown` : ''}. ` +
        `Narrow the pattern/glob, or raise max_results.`;
    }
    return textContent(
      renderSearchText({ header, files: shownFiles, warnings, footer })
    );
  }

  private globMatch(path: string, glob: string): boolean {
    if (minimatch(path, glob, { matchBase: true, nocase: true })) return true;
    if (!glob.startsWith('**/') && minimatch(path, `**/${glob}`, { matchBase: true, nocase: true })) return true;
    return false;
  }
}
