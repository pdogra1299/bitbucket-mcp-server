import axios, { AxiosInstance, AxiosError } from 'axios';
import FormData from 'form-data';
import { createReadStream } from 'fs';
import { basename } from 'path';
import { BitbucketServerBuildSummary } from '../types/bitbucket.js';

export interface ApiError {
  status?: number;
  message: string;
  isAxiosError: boolean;
  originalError?: AxiosError;
}

export interface UploadedAttachment {
  /** Numeric attachment id used by the download/delete endpoints. */
  id: string;
  /** The `attachment:N/M` token used inside Markdown to embed the file. */
  ref: string;
  name: string;
  url?: string;
}

export class BitbucketApiClient {
  private axiosInstance: AxiosInstance;
  private isServer: boolean;

  constructor(
    baseURL: string,
    username: string,
    password?: string,
    token?: string
  ) {
    this.isServer = !!token;
    
    const axiosConfig: any = {
      baseURL,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    // Use token auth for Bitbucket Server, basic auth for Cloud
    if (token) {
      // Bitbucket Server uses Bearer token
      axiosConfig.headers['Authorization'] = `Bearer ${token}`;
    } else {
      // Bitbucket Cloud uses basic auth with app password
      axiosConfig.auth = {
        username,
        password,
      };
    }

    this.axiosInstance = axios.create(axiosConfig);
  }

  async makeRequest<T>(
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
    data?: any,
    config?: any
  ): Promise<T> {
    try {
      let response;
      if (method === 'get') {
        // For GET, config is the second parameter
        response = await this.axiosInstance[method](path, config || {});
      } else if (method === 'delete') {
        // For DELETE, we might need to pass data in config
        if (data) {
          response = await this.axiosInstance[method](path, { ...config, data });
        } else {
          response = await this.axiosInstance[method](path, config || {});
        }
      } else {
        // For POST and PUT, data is second, config is third
        response = await this.axiosInstance[method](path, data, config);
      }
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const message = error.response?.data?.errors?.[0]?.message || 
                       error.response?.data?.error?.message || 
                       error.response?.data?.message ||
                       error.message;

        throw {
          status,
          message,
          isAxiosError: true,
          originalError: error
        } as ApiError;
      }
      throw error;
    }
  }

  handleApiError(error: any, context: string) {
    if (error.isAxiosError) {
      const { status, message } = error as ApiError;

      // Surface Bitbucket's request id so operators can correlate an auth/server
      // failure to the exact entry in the Bitbucket Data Center access logs. The
      // header is present on every DC response but was otherwise dropped here.
      const arequestid = (error as ApiError).originalError?.response?.headers?.['x-arequestid'];
      const refSuffix = arequestid ? ` [bitbucket-ref: ${arequestid}]` : '';

      if (status === 404) {
        return {
          content: [
            {
              type: 'text',
              text: `Not found: ${context}`,
            },
          ],
          isError: true,
        };
      } else if (status === 401) {
        return {
          content: [
            {
              type: 'text',
              text: `Authentication failed. Please check your ${this.isServer ? 'BITBUCKET_TOKEN' : 'BITBUCKET_USERNAME and BITBUCKET_APP_PASSWORD'}${refSuffix}`,
            },
          ],
          isError: true,
        };
      } else if (status === 403) {
        return {
          content: [
            {
              type: 'text',
              text: `Permission denied: ${context}. Ensure your credentials have the necessary permissions.${refSuffix}`,
            },
          ],
          isError: true,
        };
      } else if (status === 429) {
        const retryAfter = (error as ApiError).originalError?.response?.headers?.['retry-after'];
        return {
          content: [
            {
              type: 'text',
              text: `Rate limited by Bitbucket (HTTP 429): ${context}.${retryAfter ? ` Retry after ${retryAfter}s.` : ''} Reduce request frequency or parallelism and retry.`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `Bitbucket API error: ${message}${refSuffix}`,
          },
        ],
        isError: true,
      };
    }
    throw error;
  }

  getIsServer(): boolean {
    return this.isServer;
  }

  // Normalize an error from a raw axios call into the same ApiError shape that
  // makeRequest throws, so handlers' handleApiError() works consistently.
  private throwApiError(error: unknown): never {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const respData: any = error.response?.data;
      let message: string = error.message;
      // respData may be a Buffer for binary (download) responses — guard before reading fields.
      if (respData && typeof respData === 'object' && !Buffer.isBuffer(respData)) {
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

  /**
   * Upload a file as a repository attachment (Bitbucket Server / Data Center only).
   * Returns the numeric id (for download/delete) and the `attachment:N/M` ref (for Markdown embeds).
   *
   * Note: the upload POST is private/undocumented API. Some instances reject the
   * `/rest/api/1.0/...` path with 404/405, so we fall back to the prefix-less
   * `/projects/...` path shown in Atlassian's KB example.
   */
  async uploadAttachment(
    project: string,
    repository: string,
    filePath: string,
    fileName?: string
  ): Promise<UploadedAttachment> {
    const name = fileName || basename(filePath);
    const config = (form: FormData) => ({
      headers: {
        ...form.getHeaders(), // multipart/form-data; boundary=... — overrides the default JSON content-type
        'X-Atlassian-Token': 'no-check',
        // The attachment-upload servlet is picky: axios's default
        // `Accept: application/json, text/plain, */*` is rejected with 405 by some
        // proxies fronting Bitbucket. Plain `*/*` is accepted (matches curl's default).
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

    // The documented upload path is the prefix-less `/projects/.../attachments`
    // (served by a servlet, not the REST plugin). Fall back to the `/rest/api/1.0`
    // form for instances/versions that expose it there instead.
    const primaryPath = `/projects/${project}/repos/${repository}/attachments`;
    const fallbackPath = `/rest/api/1.0/projects/${project}/repos/${repository}/attachments`;

    let data: any;
    try {
      const form = newForm();
      data = (await this.axiosInstance.post(primaryPath, form, config(form))).data;
    } catch (error) {
      if (axios.isAxiosError(error) && (error.response?.status === 404 || error.response?.status === 405)) {
        try {
          const form = newForm();
          data = (await this.axiosInstance.post(fallbackPath, form, config(form))).data;
        } catch (fallbackError) {
          this.throwApiError(fallbackError);
        }
      } else {
        this.throwApiError(error);
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

  /**
   * Download a repository attachment's raw bytes (Bitbucket Server / Data Center only).
   * Uses a per-request arraybuffer response so the binary content and content-type are preserved.
   */
  async downloadAttachment(
    project: string,
    repository: string,
    attachmentId: string
  ): Promise<{ data: Buffer; contentType: string }> {
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
    }
  }

  async getBuildSummaries(
    workspace: string,
    repository: string,
    commitIds: string[]
  ): Promise<BitbucketServerBuildSummary> {
    if (!this.isServer) {
      // Build summaries only available for Bitbucket Server
      return {};
    }

    if (commitIds.length === 0) {
      return {};
    }

    try {
      // Build query string with multiple commitId parameters
      const apiPath = `/rest/ui/latest/projects/${workspace}/repos/${repository}/build-summaries`;

      // Create params with custom serializer for multiple commitId parameters
      const response = await this.makeRequest<BitbucketServerBuildSummary>(
        'get',
        apiPath,
        undefined,
        {
          params: { commitId: commitIds },
          paramsSerializer: (params: any) => {
            // Custom serializer to create multiple commitId= parameters
            if (params.commitId && Array.isArray(params.commitId)) {
              return params.commitId.map((id: string) => `commitId=${encodeURIComponent(id)}`).join('&');
            }
            return '';
          }
        }
      );

      return response;
    } catch (error) {
      // If build-summaries endpoint fails, return empty object (graceful degradation)
      console.error('Failed to fetch build summaries:', error);
      return {};
    }
  }
}
