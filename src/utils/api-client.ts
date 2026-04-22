import axios, { AxiosInstance, AxiosError } from 'axios';
import * as fs from 'fs';
import * as https from 'https';
import { BitbucketServerBuildSummary } from '../types/bitbucket.js';

export interface ApiError {
  status?: number;
  message: string;
  isAxiosError: boolean;
  originalError?: AxiosError;
}

export interface MtlsOptions {
  clientCertPath?: string;
  clientKeyPath?: string;
  caCertPath?: string;
  rejectUnauthorized?: boolean;
}

export class BitbucketApiClient {
  private axiosInstance: AxiosInstance;
  private isServer: boolean;
  private useMtls: boolean;

  constructor(
    baseURL: string,
    username: string,
    password?: string,
    token?: string,
    mtlsOptions?: MtlsOptions
  ) {
    this.useMtls = this.hasMtlsConfig(mtlsOptions);
    // Treat as Bitbucket Server if: token is present, OR mTLS is configured
    // (Bitbucket Cloud doesn't use mTLS, so mTLS implies self-hosted Server).
    this.isServer = !!token || this.useMtls;

    const axiosConfig: any = {
      baseURL,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    // Application-level auth (orthogonal to TLS-layer mTLS):
    // - Bearer token for Bitbucket Server
    // - Basic auth for Bitbucket Cloud
    // - If mTLS is the only auth provided, skip Authorization header
    if (token) {
      axiosConfig.headers['Authorization'] = `Bearer ${token}`;
    } else if (password) {
      axiosConfig.auth = {
        username,
        password,
      };
    }

    // Build HTTPS agent for mTLS if configured
    const httpsAgent = this.buildHttpsAgent(mtlsOptions);
    if (httpsAgent) {
      axiosConfig.httpsAgent = httpsAgent;
    }

    this.axiosInstance = axios.create(axiosConfig);
  }

  private hasMtlsConfig(mtls?: MtlsOptions): boolean {
    if (!mtls) return false;
    return !!(mtls.clientCertPath || mtls.clientKeyPath || mtls.caCertPath);
  }

  private buildHttpsAgent(mtls?: MtlsOptions): https.Agent | null {
    if (!mtls) return null;

    const agentOptions: https.AgentOptions = {};
    let hasAnyOption = false;

    if (mtls.clientCertPath) {
      if (!fs.existsSync(mtls.clientCertPath)) {
        throw new Error(`Client certificate file not found: ${mtls.clientCertPath}`);
      }
      agentOptions.cert = fs.readFileSync(mtls.clientCertPath);
      hasAnyOption = true;
    }

    if (mtls.clientKeyPath) {
      if (!fs.existsSync(mtls.clientKeyPath)) {
        throw new Error(`Client key file not found: ${mtls.clientKeyPath}`);
      }
      agentOptions.key = fs.readFileSync(mtls.clientKeyPath);
      hasAnyOption = true;
    }

    if (mtls.caCertPath) {
      if (!fs.existsSync(mtls.caCertPath)) {
        throw new Error(`CA certificate file not found: ${mtls.caCertPath}`);
      }
      agentOptions.ca = fs.readFileSync(mtls.caCertPath);
      hasAnyOption = true;
    }

    if (mtls.rejectUnauthorized === false) {
      agentOptions.rejectUnauthorized = false;
      hasAnyOption = true;
    }

    // Require both cert and key together when doing client-cert authentication
    if ((agentOptions.cert && !agentOptions.key) || (!agentOptions.cert && agentOptions.key)) {
      throw new Error(
        'mTLS requires both a client certificate (BITBUCKET_TLS_CLIENT_CERT) and a client key (BITBUCKET_TLS_CLIENT_KEY).'
      );
    }

    return hasAnyOption ? new https.Agent(agentOptions) : null;
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
        const authHint = this.useMtls
          ? 'Please verify your client certificate, client key, and CA certificate are correct and trusted by the server. If the server also requires a token, verify BITBUCKET_TOKEN.'
          : this.isServer
          ? 'Please check your BITBUCKET_TOKEN'
          : 'Please check your BITBUCKET_USERNAME and BITBUCKET_APP_PASSWORD';
        return {
          content: [
            {
              type: 'text',
              text: `Authentication failed. ${authHint}`,
            },
          ],
          isError: true,
        };
      } else if (status === 403) {
        return {
          content: [
            {
              type: 'text',
              text: `Permission denied: ${context}. Ensure your credentials have the necessary permissions.`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `Bitbucket API error: ${message}`,
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
