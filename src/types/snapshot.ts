// Types for the RepoSnapshot engine (in-memory virtual checkout) and grep.

export type SnapshotFileEntry = {
  /** Content hash key into the blob store (sha1 of bytes). */
  hash: string;
  size: number;
};

export type SnapshotOmittedFile = {
  path: string;
  size: number;
  /** Why the file is not retained in memory (it WAS still scanned). */
  reason: 'too-large' | 'budget';
};

export type RepoSnapshot = {
  /** Cache key: project/repo@sha#pathPrefix */
  key: string;
  project: string;
  repository: string;
  /** Full commit SHA this snapshot represents. */
  sha: string;
  /** Subtree prefix the archive was scoped to ('' = whole repo). */
  pathPrefix: string;
  /** Retained text files. */
  files: Map<string, SnapshotFileEntry>;
  /** Every path seen during extraction (text + binary + omitted) for glob listings. */
  allPaths: string[];
  /** Binary files seen during extraction (not retained, not scanned). */
  binaryPaths: string[];
  /** Text files scanned but not retained (fetched individually on warm queries). */
  omitted: SnapshotOmittedFile[];
  /** Total retained bytes (sum of unique blob sizes attributed to this snapshot). */
  retainedBytes: number;
  createdAt: number;
  lastUsedAt: number;
};

export type GrepMatch = {
  line: number;
  text: string;
  /** True when the display text was shortened to grep.maxLineLength. */
  truncated?: boolean;
  /** Context lines: [lineNumber, text] pairs, when requested. */
  before?: Array<[number, string]>;
  after?: Array<[number, string]>;
};

export type GrepFileResult = {
  path: string;
  matches: GrepMatch[];
  /** files/count modes: number of matches in this file. */
  count?: number;
};

export type GrepOutcome = {
  /** Commit the scan actually ran against. */
  sha: string;
  filesScanned: number;
  filesMatched: number;
  totalMatches: number;
  results: GrepFileResult[];
  /** Binary files skipped (reported, never silent). */
  binariesSkipped: number;
  /** Non-fatal notes: truncation, fallbacks, retention misses. */
  warnings: string[];
  /** Engine actually used. */
  engine: 'snapshot' | 'stream' | 'fanout';
};

export type ArchiveScanStats = {
  filesSeen: number;
  textFiles: number;
  binaryFiles: number;
  extractedBytes: number;
  aborted: boolean;
};
