// Types for index-backed search (search_code / search_repositories) and the
// Bitbucket search-query budget.

export type QueryClause = {
  /** Rendered clause, e.g. `project:PROJ`, `lang:python`, `"foo"`, `-bar`. */
  text: string;
  /** The free-text term is required; modifier clauses may be dropped to fit caps. */
  required: boolean;
  role:
    | 'term'
    | 'project'
    | 'repo'
    | 'lang'
    | 'ext'
    | 'path'
    | 'archived'
    | 'fork'
    | 'exclude';
};

export type BuiltQuery = {
  query: string;
  expression_count: number;
  query_length: number;
  dropped: Array<{ role: QueryClause['role']; text: string; reason: string }>;
};

export type DenseSearchHit = {
  line: number;
  text: string;
};

export type DenseSearchFile = {
  path: string;
  matches: DenseSearchHit[];
};

export type DenseSearchResponse = {
  query: string;
  filters: Record<string, string | boolean | undefined>;
  engine: 'bitbucket_index' | 'find_in_files';
  total_files: number;
  total_matches: number;
  files: DenseSearchFile[];
  warnings: string[];
  next_start: number | null;
  diagnostics: {
    expression_count?: number;
    query_length?: number;
    default_branch_only?: boolean;
    dropped_clauses?: Array<{ role: string; text: string; reason: string }>;
    files_scanned?: number;
    files_attempted?: number;
    files_failed?: number;
    files_permission_denied?: number;
    files_truncated?: boolean;
    parallelism?: number;
  };
};
