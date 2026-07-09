import axios, { AxiosInstance } from 'axios';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import FormData from 'form-data';
import { createReadStream } from 'fs';
import { basename } from 'path';
import type { Readable } from 'stream';
import type {
  ApiError,
  ApiRequestOptions,
  BitbucketMcpConfig,
  BitbucketServerBuildSummary,
  UploadedAttachment,
} from '../types/index.js';
import { TokenBucket, Semaphore, sleep, retryAfterMs, backoffMs } from './throttle.js';
import { InFlightCoalescer, TtlMemo } from './cache.js';

// Transport core. Every request from every tool flows through makeRequest,
// which applies: client-side pacing (token bucket sized to Bitbucket DC's
// per-user rate limiter), a global concurrency cap, bounded retries with
// jitter (Retry-After honored opportunistically — DC documents none), and
// in-flight coalescing of identical GETs. All policy numbers come from
// src/config — nothing is hard-coded here.

type HttpMethod = 'get' | 'post' | 'put' | 'delete';

/** Percent-encode a repo file path per segment (spaces, %, #, ? in filenames). */
export function encodeRepoPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export class BitbucketApiClient {
  private axiosInstance: AxiosInstance;
  private isServer: boolean;
  private bucket: TokenBucket;
  private semaphore: Semaphore;
  private archiveSemaphore: Semaphore;
  private coalescer = new InFlightCoalescer();
  private refMemo: TtlMemo<string>;

  constructor(private readonly config: BitbucketMcpConfig) {
    const { auth, http, rateLimit, snapshot } = config;
    this.isServer = !!auth.token;
    this.bucket = new TokenBucket(rateLimit.ratePerSec, rateLimit.burst);
    this.semaphore = new Semaphore(rateLimit.maxConcurrent);
    this.archiveSemaphore = new Semaphore(rateLimit.maxConcurrentArchives);
    this.refMemo = new TtlMemo<string>(snapshot.refResolveTtlMs);

    const axiosConfig: any = {
      baseURL: auth.baseUrl,
      timeout: http.timeoutMs,
      headers: { 'Content-Type': 'application/json' },
      httpAgent: new HttpAgent({ keepAlive: http.keepAlive, maxSockets: http.maxSockets }),
      httpsAgent: new HttpsAgent({ keepAlive: http.keepAlive, maxSockets: http.maxSockets }),
    };
    if (auth.token) {
      axiosConfig.headers['Authorization'] = `Bearer ${auth.token}`;
    } else {
      axiosConfig.auth = { username: auth.username, password: auth.appPassword };
    }
    this.axiosInstance = axios.create(axiosConfig);
  }

  getIsServer(): boolean {
    return this.isServer;
  }

  getConfig(): BitbucketMcpConfig {
    return this.config;
  }

  // ── Request core ───────────────────────────────────────────────────────────

  async makeRequest<T>(
    method: HttpMethod,
    path: string,
    data?: any,
    axiosOpts?: any,
    opts: ApiRequestOptions = {}
  ): Promise<T> {
    if (method === 'get' && axiosOpts?.responseType !== 'stream') {
      const key = this.coalesceKey(path, axiosOpts);
      return this.coalescer.run(key, () => this.requestWithRetry<T>(method, path, data, axiosOpts, opts));
    }
    return this.requestWithRetry<T>(method, path, data, axiosOpts, opts);
  }

  private coalesceKey(path: string, axiosOpts?: any): string {
    const params = axiosOpts?.params ? JSON.stringify(axiosOpts.params) : '';
    const accept = axiosOpts?.headers?.Accept ?? axiosOpts?.headers?.accept ?? '';
    const responseType = axiosOpts?.responseType ?? '';
    return `${path}?${params}#${accept}#${responseType}`;
  }

  private async requestWithRetry<T>(
    method: HttpMethod,
    path: string,
    data: any,
    axiosOpts: any,
    opts: ApiRequestOptions
  ): Promise<T> {
    const { retry } = this.config;
    let waited = 0;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.rawRequest<T>(method, path, data, axiosOpts);
      } catch (error: any) {
        const status: number | undefined = error?.status;
        const isNetworkError = error?.isAxiosError && status === undefined;
        // 429 means the server rejected the request before processing — safe
        // to retry any method. Other retryable statuses / network errors are
        // retried only when the request is idempotent.
        const retryableStatus = status !== undefined && retry.retryStatuses.includes(status);
        const idempotent = method === 'get' || opts.idempotent === true;
        const shouldRetry =
          attempt < retry.maxRetries &&
          ((status === 429) || ((retryableStatus || isNetworkError) && idempotent));
        if (!shouldRetry) throw error;

        const headerMs = retryAfterMs(
          error?.originalError?.response?.headers?.['retry-after']
        );
        const delay = Math.min(
          headerMs ?? backoffMs(attempt + 1, retry.baseDelayMs, retry.maxDelayMs),
          retry.retryAfterCapMs
        );
        if (waited + delay > retry.totalWaitCapMs) throw error;
        waited += delay;
        await sleep(delay);
      }
    }
  }

  private async rawRequest<T>(method: HttpMethod, path: string, data?: any, axiosOpts?: any): Promise<T> {
    await this.bucket.take();
    const release = await this.semaphore.acquire();
    try {
      let response;
      if (method === 'get') {
        response = await this.axiosInstance.get(path, axiosOpts || {});
      } else if (method === 'delete') {
        response = data
          ? await this.axiosInstance.delete(path, { ...axiosOpts, data })
          : await this.axiosInstance.delete(path, axiosOpts || {});
      } else {
        response = await this.axiosInstance[method](path, data, axiosOpts);
      }
      return response.data as T;
    } catch (error) {
      this.throwApiError(error);
    } finally {
      release();
    }
  }

  // Normalize any axios error into the ApiError shape handlers rely on.
  private throwApiError(error: unknown): never {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const respData: any = error.response?.data;
      let message: string = error.message;
      // A stream-typed error body (responseType:'stream' on a non-2xx) must
      // be destroyed, or its keep-alive socket never returns to the pool and
      // the agent eventually deadlocks on maxSockets.
      if (respData && typeof respData.pipe === 'function' && typeof respData.destroy === 'function') {
        respData.destroy();
      } else if (respData && typeof respData === 'object' && !Buffer.isBuffer(respData)) {
        message =
          respData?.errors?.[0]?.message ||
          respData?.error?.message ||
          respData?.message ||
          error.message;
      }
      throw { status, message, isAxiosError: true, originalError: error } as ApiError;
    }
    throw error;
  }

  // ── Error presentation ─────────────────────────────────────────────────────

  handleApiError(error: any, context: string) {
    if (error.isAxiosError) {
      const { status, message } = error as ApiError;
      // Surface Bitbucket's request id so operators can correlate a failure
      // with the exact entry in the DC access logs.
      const arequestid = (error as ApiError).originalError?.response?.headers?.['x-arequestid'];
      const refSuffix = arequestid ? ` [bitbucket-ref: ${arequestid}]` : '';

      if (status === 404) {
        return this.errorContent(`Not found: ${context}`);
      }
      if (status === 401) {
        return this.errorContent(
          `Authentication failed. Please check your ${this.isServer ? 'BITBUCKET_TOKEN' : 'BITBUCKET_USERNAME and BITBUCKET_APP_PASSWORD'}${refSuffix}`
        );
      }
      if (status === 403) {
        return this.errorContent(
          `Permission denied: ${context}. Ensure your credentials have the necessary permissions.${refSuffix}`
        );
      }
      if (status === 429) {
        const retryAfter = (error as ApiError).originalError?.response?.headers?.['retry-after'];
        return this.errorContent(
          `Rate limited by Bitbucket (HTTP 429) even after client-side pacing and retries: ${context}.` +
            `${retryAfter ? ` Retry after ${retryAfter}s.` : ''} ` +
            `Narrow the request (smaller glob/limit) or ask a Bitbucket admin for a rate-limit exemption ` +
            `for this account (Admin → Rate limiting → Exemptions).`
        );
      }
      return this.errorContent(`Bitbucket API error: ${message}${refSuffix}`);
    }
    throw error;
  }

  private errorContent(text: string) {
    return { content: [{ type: 'text', text }], isError: true };
  }

  // ── Ref resolution (freshness contract) ────────────────────────────────────

  /**
   * Resolve a ref (branch/tag) to its current head commit SHA — the freshness
   * check every snapshot read performs. Full 40-hex refs pass through without
   * a network call (immutable). Results are memoized briefly (config
   * snapshot.refResolveTtlMs) and coalesced across concurrent callers.
   */
  async resolveRef(project: string, repository: string, ref?: string): Promise<string> {
    if (ref && /^[0-9a-f]{40}$/i.test(ref)) return ref.toLowerCase();
    const key = `${project}/${repository}@${ref ?? ''}`;
    const memoized = this.refMemo.get(key);
    if (memoized) return memoized;

    const apiPath = this.isServer
      ? `/rest/api/latest/projects/${project}/repos/${repository}/commits`
      : `/repositories/${project}/${repository}/commits${ref ? `/${encodeURIComponent(ref)}` : ''}`;
    const params: any = this.isServer
      ? { limit: 1, ...(ref ? { until: ref } : {}) }
      : { pagelen: 1 };

    const response = await this.makeRequest<any>('get', apiPath, undefined, { params });
    const sha: string | undefined = this.isServer
      ? response?.values?.[0]?.id
      : response?.values?.[0]?.hash;
    if (!sha) {
      throw {
        status: 404,
        message: `Could not resolve ${ref ?? 'default branch'} in ${project}/${repository}`,
        isAxiosError: false,
      } as ApiError;
    }
    this.refMemo.set(key, sha);
    return sha;
  }

  /** Drop a memoized ref resolution (used after pushes the server itself makes). */
  invalidateRef(project: string, repository: string, ref?: string): void {
    this.refMemo.delete(`${project}/${repository}@${ref ?? ''}`);
  }

  // ── Archive streaming (snapshot engine input) ──────────────────────────────

  /**
   * Stream a tar.gz archive of the repository at a commit, optionally scoped
   * to path prefixes. One HTTP request (one rate-limit token) regardless of
   * how many files it contains. Bitbucket Server / Data Center only.
   */
  async streamArchive(
    project: string,
    repository: string,
    opts: { at: string; paths?: string[] }
  ): Promise<{ stream: Readable; release: () => void }> {
    const releaseArchive = await this.archiveSemaphore.acquire();
    try {
      await this.bucket.take();
      const release = await this.semaphore.acquire();
      try {
        const params = new URLSearchParams();
        params.set('format', 'tar.gz');
        params.set('at', opts.at);
        for (const p of opts.paths ?? []) {
          if (p) params.append('path', p);
        }
        const response = await this.axiosInstance.get(
          `/rest/api/latest/projects/${project}/repos/${repository}/archive?${params.toString()}`,
          {
            responseType: 'stream',
            timeout: this.config.http.archiveTimeoutMs,
            headers: { Accept: '*/*' },
          }
        );
        const stream = response.data as Readable;
        let released = false;
        let stallTimer: NodeJS.Timeout | undefined;
        const releaseAll = () => {
          if (released) return;
          released = true;
          if (stallTimer) clearTimeout(stallTimer);
          release();
          releaseArchive();
        };
        // axios's timeout disarms once headers arrive on stream responses —
        // guard mid-body stalls ourselves or a frozen node/proxy leaks one of
        // the (few) archive slots forever.
        const armStall = () => {
          if (stallTimer) clearTimeout(stallTimer);
          stallTimer = setTimeout(() => {
            stream.destroy(new Error(`archive stream stalled (no data for ${this.config.http.archiveStallMs}ms)`));
          }, this.config.http.archiveStallMs);
        };
        armStall();
        stream.on('data', armStall);
        stream.once('close', releaseAll);
        stream.once('error', releaseAll);
        stream.once('end', releaseAll);
        return { stream, release: releaseAll };
      } catch (error) {
        release();
        this.throwApiError(error);
      }
    } catch (error) {
      releaseArchive();
      throw error;
    }
  }

  // ── Attachments (Server/DC only) ───────────────────────────────────────────

  /**
   * Upload a file as a repository attachment. The upload POST is a
   * private/undocumented servlet; some instances reject the /rest/api/1.0
   * path with 404/405, so we fall back to the prefix-less /projects path.
   */
  async uploadAttachment(
    project: string,
    repository: string,
    filePath: string,
    fileName?: string
  ): Promise<UploadedAttachment> {
    const name = fileName || basename(filePath);
    const reqConfig = (form: FormData) => ({
      headers: {
        ...form.getHeaders(),
        'X-Atlassian-Token': 'no-check',
        // The attachment-upload servlet rejects axios's default Accept on
        // some proxies with 405; plain */* matches curl's default.
        Accept: '*/*',
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
    const newForm = () => {
      const form = new FormData();
      form.append('files', createReadStream(filePath), { filename: name });
      return form;
    };

    const primaryPath = `/projects/${project}/repos/${repository}/attachments`;
    const fallbackPath = `/rest/api/1.0/projects/${project}/repos/${repository}/attachments`;

    let data: any;
    try {
      const form = newForm();
      data = await this.pacedPost(primaryPath, form, reqConfig(form));
    } catch (error: any) {
      if (error?.isAxiosError && (error.status === 404 || error.status === 405)) {
        const form = newForm();
        data = await this.pacedPost(fallbackPath, form, reqConfig(form));
      } else {
        throw error;
      }
    }

    // The response wrapper is not byte-stable across versions — parse defensively.
    const att = data?.attachments?.[0] ?? (Array.isArray(data) ? data[0] : data);
    if (!att || (att.id === undefined && !att?.links?.attachment?.href)) {
      throw {
        status: undefined,
        message: 'Attachment uploaded but the response could not be parsed for an id/reference',
        isAxiosError: false,
      } as ApiError;
    }
    const ref: string | undefined = att?.links?.attachment?.href;
    return {
      id: att.id !== undefined ? String(att.id) : '',
      ref: ref || (att.id !== undefined ? `attachment:${att.id}` : ''),
      name: att.name || name,
      url: att?.links?.self?.href || att.url,
    };
  }

  private async pacedPost(path: string, body: any, axiosOpts: any): Promise<any> {
    await this.bucket.take();
    const release = await this.semaphore.acquire();
    try {
      return (await this.axiosInstance.post(path, body, axiosOpts)).data;
    } catch (error) {
      this.throwApiError(error);
    } finally {
      release();
    }
  }

  /** Download an attachment's raw bytes (Server/DC only). */
  async downloadAttachment(
    project: string,
    repository: string,
    attachmentId: string
  ): Promise<{ data: Buffer; contentType: string }> {
    await this.bucket.take();
    const release = await this.semaphore.acquire();
    try {
      const response = await this.axiosInstance.get(
        `/rest/api/1.0/projects/${project}/repos/${repository}/attachments/${attachmentId}`,
        { responseType: 'arraybuffer', headers: { Accept: '*/*' } }
      );
      return {
        data: Buffer.from(response.data),
        contentType: (response.headers['content-type'] as string) || 'application/octet-stream',
      };
    } catch (error) {
      this.throwApiError(error);
    } finally {
      release();
    }
  }

  // ── Build summaries (Server/DC only; one batched call for N commits) ───────

  async getBuildSummaries(
    workspace: string,
    repository: string,
    commitIds: string[]
  ): Promise<BitbucketServerBuildSummary> {
    if (!this.isServer || commitIds.length === 0) return {};
    try {
      return await this.makeRequest<BitbucketServerBuildSummary>(
        'get',
        `/rest/ui/latest/projects/${workspace}/repos/${repository}/build-summaries`,
        undefined,
        {
          params: { commitId: commitIds },
          paramsSerializer: (params: any) => {
            if (params.commitId && Array.isArray(params.commitId)) {
              return params.commitId.map((id: string) => `commitId=${encodeURIComponent(id)}`).join('&');
            }
            return '';
          },
        }
      );
    } catch (error) {
      // Graceful degradation — build status is enrichment, never load-bearing.
      console.error('Failed to fetch build summaries:', error);
      return {};
    }
  }
}
