import axios, { AxiosInstance, AxiosError } from 'axios';

export interface ApiError {
  status?: number;
  message: string;
  isAxiosError: boolean;
  originalError?: AxiosError;
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
              text: `Authentication failed. Please check your ${this.isServer ? 'BITBUCKET_TOKEN' : 'BITBUCKET_USERNAME and BITBUCKET_APP_PASSWORD'}`,
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
}
