// HTTP-layer types shared by the API client and handlers.

/**
 * Normalized transport error. Deliberately NOT the axios error: that object
 * carries the request config (Authorization header included), so handlers
 * only ever see status, message and response headers.
 */
export type ApiError = {
  status?: number;
  message: string;
  isAxiosError: boolean;
  /** Response headers (lower-cased names) when a response was received. */
  headers?: Record<string, unknown>;
};

/** A local file that passed the attachment-root/size/type checks. */
export type ResolvedLocalFile = {
  /** Real (symlink-resolved) absolute path. */
  path: string;
  size: number;
  /** Device/inode at validation time; the upload re-checks them on the open fd. */
  dev: number;
  ino: number;
  /** Sanitized basename sent as the multipart filename. */
  name: string;
};

export type LocalFileResolution = { ok: true; file: ResolvedLocalFile } | { ok: false; error: string };

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
