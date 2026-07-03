import { BitbucketApiClient } from './api-client.js';

export interface FileListResult {
  files: string[];
  // True when the pagination safety cap stopped the listing before the server
  // reported the last page — callers should surface this, never hide it.
  truncated: boolean;
}

// Requested page size. Bitbucket Server clamps this to its own page.max.files
// setting, so the real page can be smaller — which is why we must follow
// isLastPage/nextPageStart instead of trusting one large request.
const PAGE_LIMIT = 25000;
// Safety cap on pages per listing (at most PAGE_LIMIT * MAX_PAGES paths).
const MAX_PAGES = 40;
// Short TTL: long enough that a find_in_files scan and the index-gap probe that
// often follows reuse one listing, short enough to pick up new commits quickly.
const CACHE_TTL_MS = 60_000;

const cache = new Map<string, { at: number; result: FileListResult }>();

export function clearFileListCache(): void {
  cache.clear();
}

/**
 * List every file path in a repository (Bitbucket Server /files endpoint),
 * following pagination and caching the result in memory for a short TTL.
 */
export async function listRepoFiles(
  apiClient: BitbucketApiClient,
  workspace: string,
  repository: string,
  opts: { branch?: string; path?: string } = {}
): Promise<FileListResult> {
  const key = `${workspace}/${repository}@${opts.branch ?? ''}#${opts.path ?? ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result;

  let apiPath = `/rest/api/latest/projects/${workspace}/repos/${repository}/files`;
  if (opts.path) apiPath += `/${opts.path}`;

  const files: string[] = [];
  let start = 0;
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params: any = { limit: PAGE_LIMIT, start };
    if (opts.branch) params.at = `refs/heads/${opts.branch}`;
    const resp = await apiClient.makeRequest<any>('get', apiPath, undefined, { params });

    if (Array.isArray(resp)) {
      // Some versions return a plain array (single page, no wrapper).
      files.push(...resp);
      break;
    }
    const values: string[] = resp?.values ?? [];
    files.push(...values);
    if (resp?.isLastPage !== false) break;
    if (page === MAX_PAGES - 1) {
      truncated = true;
      break;
    }
    start = typeof resp?.nextPageStart === 'number' ? resp.nextPageStart : start + values.length;
  }

  // Evict stale entries so long-lived servers don't accumulate dead listings.
  const now = Date.now();
  for (const [k, v] of cache) {
    if (now - v.at >= CACHE_TTL_MS) cache.delete(k);
  }

  const result: FileListResult = { files, truncated };
  cache.set(key, { at: now, result });
  return result;
}
