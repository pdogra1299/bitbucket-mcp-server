// Types for repository file listings.

export type FileListResult = {
  files: string[];
  /**
   * True when the pagination safety cap stopped the listing before the server
   * reported the last page — callers must surface this, never hide it.
   */
  truncated: boolean;
};
