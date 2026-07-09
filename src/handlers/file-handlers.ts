import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BitbucketApiClient, encodeRepoPath } from '../core/api-client.js';
import {
  isListDirectoryContentArgs,
  isGetFileContentArgs,
  isGetFileBlameArgs,
} from '../tools/guards.js';
import { errorContent, textContent, isoDate } from '../formatting/respond.js';
import type { ToolResponse } from '../types/index.js';

// Bitbucket DC's page.max.source.length default — lines this long were
// probably server-truncated (protocol constant of the remote, not a tunable).
const SERVER_MAX_SOURCE_LINE_LENGTH = 5000;

// File tools, rebound to the cheapest verified endpoints:
//  * get_file_content — ONE windowed browse call (browse pages over LINES;
//    server clamps at page.max.source.lines=5000). No metadata pre-call, no
//    full-file transfer for windowed reads.
//  * get_file_blame — ONE browse?blame&noContent call per requested window
//    instead of paging the whole file and filtering client-side.
//  * list_directory_content — one browse call, compact text output.

export class FileHandlers {
  constructor(private apiClient: BitbucketApiClient) {}

  // ── list_directory_content ─────────────────────────────────────────────────

  async handleListDirectoryContent(args: any): Promise<ToolResponse> {
    if (!isListDirectoryContentArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for list_directory_content');
    }
    const { workspace, repository, path: dirPath = '', branch } = args;

    const { pagination } = this.apiClient.getConfig();
    try {
      const entries: Array<{ name: string; isDir: boolean }> = [];
      let truncated = false;
      if (this.apiClient.getIsServer()) {
        let apiPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/browse`;
        if (dirPath) apiPath += `/${encodeRepoPath(dirPath)}`;
        let start = 0;
        for (let page = 0; page < pagination.browseMaxPages; page++) {
          const params: any = { limit: pagination.dirPageLimit, start };
          if (branch) params.at = `refs/heads/${branch}`;
          const response = await this.apiClient.makeRequest<any>('get', apiPath, undefined, { params });
          const children = response.children ?? response;
          entries.push(
            ...(children?.values || []).map((e: any) => ({ name: e.path.name, isDir: e.type !== 'FILE' }))
          );
          if (children?.isLastPage !== false) break;
          if (page === pagination.browseMaxPages - 1) {
            truncated = true;
            break;
          }
          start = typeof children.nextPageStart === 'number' ? children.nextPageStart : start + (children.values?.length ?? 0);
        }
      } else {
        const branchOrDefault = branch || 'HEAD';
        let url: string | null = `/repositories/${workspace}/${repository}/src/${branchOrDefault}${dirPath ? `/${dirPath}` : ''}`;
        let params: any | undefined = { pagelen: pagination.dirPageLimit };
        for (let page = 0; page < pagination.browseMaxPages && url; page++) {
          const response: any = await this.apiClient.makeRequest<any>('get', url, undefined, params ? { params } : undefined);
          entries.push(
            ...(response.values || []).map((e: any) => ({
              name: e.path.split('/').pop() || e.path,
              isDir: e.type !== 'commit_file',
            }))
          );
          url = response.next || null;
          params = undefined;
        }
        truncated = url !== null;
      }

      entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
      const header = `${workspace}/${repository}:${dirPath || '/'}${branch ? ` @ ${branch}` : ''} — ${entries.length} entries${truncated ? ' (more exist — listing hit the page cap)' : ''}`;
      const lines = entries.map(e => (e.isDir ? `${e.name}/` : e.name));
      return textContent([header, '', ...lines].join('\n'));
    } catch (error) {
      return this.apiClient.handleApiError(error, `listing directory '${dirPath}' in ${workspace}/${repository}`) as ToolResponse;
    }
  }

  // ── get_file_content ───────────────────────────────────────────────────────

  async handleGetFileContent(args: any): Promise<ToolResponse> {
    if (!isGetFileContentArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for get_file_content');
    }
    const { workspace, repository, file_path, branch, start_line, line_count, full_content = false } = args;
    const { pagination } = this.apiClient.getConfig();

    try {
      // Full content, or tail reads (negative start_line), need the raw file.
      if (full_content || (start_line !== undefined && start_line < 0)) {
        return await this.rawContent(args);
      }

      if (!this.apiClient.getIsServer()) {
        return await this.rawContent(args); // Cloud has no line-windowed read
      }

      // Server: one windowed browse call.
      const startIdx = start_line !== undefined ? Math.max(0, start_line - 1) : 0;
      const requested = line_count ?? pagination.browsePageLines;
      const apiPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/browse/${encodeRepoPath(file_path)}`;
      const params: any = { start: startIdx, limit: Math.min(requested, pagination.browsePageLines) };
      if (branch) params.at = `refs/heads/${branch}`;
      const response = await this.apiClient.makeRequest<any>('get', apiPath, undefined, { params });

      if (!Array.isArray(response?.lines)) {
        // Directory or unexpected shape.
        if (response?.children) {
          return errorContent(`'${file_path}' is a directory — use list_directory_content.`);
        }
        return await this.rawContent(args);
      }

      const lines: string[] = response.lines.map((l: any) => l?.text ?? '');
      const first = startIdx + 1;
      const last = startIdx + lines.length;
      const isLast = response.isLastPage !== false;
      const totalNote = isLast ? `of ${last} lines` : `(more lines exist — continue with start_line=${last + 1})`;
      // Server truncates lines at page.max.source.length (default 5000) with
      // no in-band marker; flag lines at/above that boundary.
      const longLine = lines.some(l => l.length >= SERVER_MAX_SOURCE_LINE_LENGTH);

      const header = `${file_path}${branch ? ` @ ${branch}` : ''} lines ${first}-${last} ${totalNote}`;
      const numbered = lines.map((l, i) => `${first + i}: ${l}`);
      const body = [header, '', ...numbered];
      if (longLine) {
        body.push('', 'NOTE: very long lines may be server-truncated at 5000 chars; use full_content=true for exact bytes.');
      }
      return textContent(body.join('\n'));
    } catch (error: any) {
      if (error.status === 404) {
        return errorContent(`File '${file_path}' not found in ${workspace}/${repository}${branch ? ` on branch '${branch}'` : ''}`);
      }
      return this.apiClient.handleApiError(error, `getting file content for '${file_path}' in ${workspace}/${repository}`) as ToolResponse;
    }
  }

  private async rawContent(args: any): Promise<ToolResponse> {
    const { workspace, repository, file_path, branch, start_line, line_count } = args;
    let raw: string;
    if (this.apiClient.getIsServer()) {
      const params: any = {};
      if (branch) params.at = `refs/heads/${branch}`;
      raw = await this.apiClient.makeRequest<string>(
        'get',
        `/rest/api/1.0/projects/${workspace}/repos/${repository}/raw/${encodeRepoPath(file_path)}`,
        undefined,
        { params, responseType: 'text', headers: { Accept: 'text/plain' } }
      );
    } else {
      const branchOrDefault = branch || 'HEAD';
      raw = await this.apiClient.makeRequest<string>(
        'get',
        `/repositories/${workspace}/${repository}/src/${branchOrDefault}/${file_path}`,
        undefined,
        { responseType: 'text', headers: { Accept: 'text/plain' } }
      );
    }
    const allLines = String(raw).split('\n');
    const total = allLines.length;
    let startIdx = 0;
    let endIdx = total;
    if (start_line !== undefined) {
      startIdx = start_line < 0 ? Math.max(0, total + start_line) : Math.max(0, start_line - 1);
      endIdx = line_count !== undefined ? Math.min(total, startIdx + line_count) : total;
    } else if (line_count !== undefined) {
      endIdx = Math.min(total, line_count);
    }
    let window = allLines.slice(startIdx, endIdx);

    // Whole-file paths (full_content / tail / Cloud) have no server-side
    // window — cap the RETURNED text so one call can't flood the context.
    // Truncation is marked with window guidance, never silent.
    const capBytes = this.apiClient.getConfig().output.fileContentMaxKb * 1024;
    let capNote = '';
    let returned = 0;
    for (let i = 0; i < window.length; i++) {
      returned += window[i].length + 1;
      if (returned > capBytes) {
        const shownEnd = startIdx + i;
        capNote = `\n\n[truncated at ${this.apiClient.getConfig().output.fileContentMaxKb} KB (line ${shownEnd}) — fetch the rest with start_line=${shownEnd + 1}, or raise BITBUCKET_FILE_CONTENT_MAX_KB]`;
        window = window.slice(0, i);
        endIdx = shownEnd;
        break;
      }
    }

    const header = `${file_path}${branch ? ` @ ${branch}` : ''} lines ${startIdx + 1}-${endIdx} of ${total}`;
    const numbered = window.map((l, i) => `${startIdx + 1 + i}: ${l}`);
    return textContent([header, '', ...numbered].join('\n') + capNote);
  }

  // ── get_file_blame ─────────────────────────────────────────────────────────

  async handleGetFileBlame(args: any): Promise<ToolResponse> {
    if (!isGetFileBlameArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for get_file_blame');
    }
    if (!this.apiClient.getIsServer()) {
      return errorContent('get_file_blame is only supported on Bitbucket Server/Data Center (no Cloud blame API).');
    }

    const { workspace, repository, file_path, branch, start_line, line_count } = args;
    const { pagination } = this.apiClient.getConfig();

    try {
      const apiPath = `/rest/api/1.0/projects/${workspace}/repos/${repository}/browse/${encodeRepoPath(file_path)}`;
      const baseParams: any = { blame: 'true', noContent: 'true' };
      if (branch) baseParams.at = `refs/heads/${branch}`;

      // Fetch ONLY the pages covering the requested window (the endpoint
      // pages over lines). Without a window, walk pages up to the safety cap.
      const windowStart = start_line !== undefined ? Math.max(1, start_line) : 1;
      const windowEnd =
        start_line !== undefined && line_count !== undefined
          ? windowStart + line_count - 1
          : line_count !== undefined
            ? line_count
            : undefined;

      const rawEntries: any[] = [];
      let pageStart = windowStart - 1;
      let truncated = false;
      for (let page = 0; page < pagination.browseMaxPages; page++) {
        const remaining = windowEnd !== undefined ? windowEnd - pageStart : pagination.browsePageLines;
        if (remaining <= 0) break;
        const params = { ...baseParams, start: pageStart, limit: Math.min(remaining, pagination.browsePageLines) };
        const response = await this.apiClient.makeRequest<any>('get', apiPath, undefined, { params });

        let pageEntries: any[] = [];
        let hasMore: boolean | undefined;
        let nextStart: number | undefined;
        if (Array.isArray(response)) {
          pageEntries = response;
          hasMore = undefined; // legacy shape: no pagination info (BSERV-8482, pre-7.0)
        } else if (Array.isArray(response?.blame)) {
          pageEntries = response.blame;
          hasMore = response.isLastPage === false;
          nextStart = typeof response.nextPageStart === 'number' ? response.nextPageStart : undefined;
        } else if (Array.isArray(response?.values)) {
          pageEntries = response.values;
          hasMore = response.isLastPage === false;
          nextStart = typeof response.nextPageStart === 'number' ? response.nextPageStart : undefined;
        }
        rawEntries.push(...pageEntries);

        const covered = pageEntries.reduce((acc, e) => acc + (e.spannedLines ?? 1), 0);
        if (pageEntries.length === 0) break;
        if (windowEnd !== undefined && pageStart + covered >= windowEnd) break;
        if (hasMore === false) break;
        if (hasMore === undefined && covered < (params.limit as number)) break;
        if (page === pagination.browseMaxPages - 1) {
          truncated = true;
          break;
        }
        pageStart = nextStart ?? pageStart + covered;
      }

      if (rawEntries.length === 0) {
        return textContent(`blame ${file_path}${branch ? ` @ ${branch}` : ''}: no blame data (file may be empty or binary).`);
      }

      // Normalize spans and clip to the window.
      type Span = { start: number; end: number; commit: string; author: string; date?: string; message?: string };
      let spans: Span[] = rawEntries
        .map((e: any) => {
          const start = e.lineNumber ?? e.line ?? 1;
          const spanned = e.spannedLines ?? 1;
          const commit: string = e.commitDisplayId ?? e.displayCommitHash ?? (e.commitHash ?? e.commitId ?? '').slice(0, 12);
          return {
            start,
            end: start + spanned - 1,
            commit,
            author: e.author?.displayName || e.author?.name || e.displayName || 'unknown',
            date: isoDate(e.authorTimestamp ?? e.committerTimestamp),
            message: typeof e.commitMessage === 'string' ? e.commitMessage.split('\n')[0] : undefined,
          };
        })
        .sort((a, b) => a.start - b.start);

      if (windowEnd !== undefined || start_line !== undefined) {
        const lo = windowStart;
        const hi = windowEnd ?? Number.MAX_SAFE_INTEGER;
        spans = spans
          .filter(s => s.end >= lo && s.start <= hi)
          .map(s => ({ ...s, start: Math.max(s.start, lo), end: Math.min(s.end, hi) }));
      }

      // Dedupe commit metadata into a legend; emit compact span lines.
      const commits = new Map<string, Span>();
      for (const s of spans) {
        if (!commits.has(s.commit)) commits.set(s.commit, s);
      }
      const lastLine = spans.length > 0 ? spans[spans.length - 1].end : 0;
      const header = `blame ${file_path}${branch ? ` @ ${branch}` : ''} lines ${windowStart}-${windowEnd ?? lastLine} — ${commits.size} commits`;
      const legend = [...commits.values()].map(
        s => `  ${s.commit}  ${s.author}  ${s.date ?? ''}  ${s.message ?? ''}`.trimEnd()
      );
      const spanLines = spans.map(s => `  ${s.start === s.end ? s.start : `${s.start}-${s.end}`}: ${s.commit}`);
      const body = [header, 'commits:', ...legend, 'lines:', ...spanLines];
      if (truncated) {
        body.push('', `WARNING: stopped at the ${pagination.browseMaxPages}-page safety cap; later lines are missing. Request a line window.`);
      }
      return textContent(body.join('\n'));
    } catch (error: any) {
      if (error.status === 404) {
        return errorContent(`File '${file_path}' not found in ${workspace}/${repository}${branch ? ` on branch '${branch}'` : ''}`);
      }
      return this.apiClient.handleApiError(error, `getting blame for '${file_path}' in ${workspace}/${repository}`) as ToolResponse;
    }
  }
}
