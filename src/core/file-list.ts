import type { FileListResult } from '../types/index.js';
import { BitbucketApiClient } from './api-client.js';
import { TtlMemo, InFlightCoalescer } from './cache.js';

// Repository file listing (Bitbucket Server /files endpoint).
//
// The server-side page cap is page.max.directory.recursive.children
// (default 100,000), so on default-configured instances ONE request with
// pagination.filesPageLimit returns the entire tree. Pagination is followed
// only when the instance clamps lower; the safety cap and the TTL cache are
// both config-driven. Concurrent identical listings share one request.

const memoByClient = new WeakMap<BitbucketApiClient, TtlMemo<FileListResult>>();
// Coalescing is client-scoped like the memo: two clients (different hosts or
// credentials) must never share one in-flight fetch for the same repo path.
const coalescerByClient = new WeakMap<BitbucketApiClient, InFlightCoalescer>();

export function clearFileListCache(client?: BitbucketApiClient): void {
  if (client) memoByClient.delete(client);
}

export async function listRepoFiles(
  apiClient: BitbucketApiClient,
  workspace: string,
  repository: string,
  opts: { branch?: string; path?: string } = {}
): Promise<FileListResult> {
  // opts.branch accepts a branch name, tag, or full commit SHA.
  const { pagination } = apiClient.getConfig();
  let memo = memoByClient.get(apiClient);
  if (!memo) {
    memo = new TtlMemo<FileListResult>(pagination.filesListTtlMs);
    memoByClient.set(apiClient, memo);
  }

  let coalescer = coalescerByClient.get(apiClient);
  if (!coalescer) {
    coalescer = new InFlightCoalescer();
    coalescerByClient.set(apiClient, coalescer);
  }

  const key = `${workspace}/${repository}@${opts.branch ?? ''}#${opts.path ?? ''}`;
  const hit = memo.get(key);
  if (hit) return hit;

  return coalescer.run(key, async () => {
    const again = memo!.get(key);
    if (again) return again;

    let apiPath = `/rest/api/latest/projects/${workspace}/repos/${repository}/files`;
    if (opts.path) apiPath += `/${opts.path}`;

    const files: string[] = [];
    let start = 0;
    let truncated = false;
    // The /files endpoint returns paths RELATIVE to the requested directory;
    // re-prefix so every caller sees repo-root-relative paths (matching the
    // snapshot engine's tar paths).
    const prefix = opts.path ? `${opts.path.replace(/\/+$/, '')}/` : '';
    for (let page = 0; page < pagination.filesMaxPages; page++) {
      const params: any = { limit: pagination.filesPageLimit, start };
      if (opts.branch) {
        params.at = /^[0-9a-f]{40}$/i.test(opts.branch) ? opts.branch : `refs/heads/${opts.branch}`;
      }
      const resp = await apiClient.makeRequest<any>('get', apiPath, undefined, { params });

      if (Array.isArray(resp)) {
        // Some versions return a plain array (single page, no wrapper).
        files.push(...resp.map(p => prefix + p));
        break;
      }
      const values: string[] = resp?.values ?? [];
      files.push(...values.map(p => prefix + p));
      if (resp?.isLastPage !== false) break;
      if (page === pagination.filesMaxPages - 1) {
        truncated = true;
        break;
      }
      start = typeof resp?.nextPageStart === 'number' ? resp.nextPageStart : start + values.length;
    }

    const result: FileListResult = { files, truncated };
    memo!.set(key, result);
    return result;
  });
}
