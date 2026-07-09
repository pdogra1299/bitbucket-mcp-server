import type { AxiosError } from 'axios';

// HTTP-layer types shared by the API client and handlers.

export type ApiError = {
  status?: number;
  message: string;
  isAxiosError: boolean;
  originalError?: AxiosError;
};

export type AttachmentRender = 'image' | 'link' | 'auto';

export type UploadedAttachment = {
  /** Numeric attachment id used by the download/delete endpoints. */
  id: string;
  /** The `attachment:N/M` token used inside Markdown to embed the file. */
  ref: string;
  name: string;
  url?: string;
};

/** Options accepted by BitbucketApiClient.makeRequest beyond the axios config. */
export type ApiRequestOptions = {
  /**
   * Marks a non-GET request as safe to retry on transient failures.
   * GETs are always retry-safe; 429 (request rejected before processing)
   * is retried for every method regardless.
   */
  idempotent?: boolean;
};
