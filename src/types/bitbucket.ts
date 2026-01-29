// Bitbucket Server API response types
export interface BitbucketServerPullRequest {
  id: number;
  version: number;
  title: string;
  description?: string;
  state: string;
  open: boolean;
  closed: boolean;
  createdDate: number;
  updatedDate: number;
  fromRef: {
    id: string;
    displayId: string;
    latestCommit: string;
    repository: {
      slug: string;
      name: string;
      project: {
        key: string;
      };
    };
  };
  toRef: {
    id: string;
    displayId: string;
    latestCommit: string;
    repository: {
      slug: string;
      name: string;
      project: {
        key: string;
      };
    };
  };
  locked: boolean;
  author: {
    user: {
      name: string;
      emailAddress: string;
      displayName: string;
    };
    role: string;
    approved: boolean;
    status: string;
  };
  reviewers: Array<{
    user: {
      name: string;
      emailAddress: string;
      displayName: string;
    };
    role: string;
    approved: boolean;
    status: string;
  }>;
  participants: Array<{
    user: {
      name: string;
      emailAddress: string;
      displayName: string;
    };
    role: string;
    approved: boolean;
    status: string;
  }>;
  links: {
    self: Array<{
      href: string;
    }>;
  };
  properties?: {
    mergeCommit?: {
      id: string;
      displayId: string;
    };
  };
  draft?: boolean;
}

// Bitbucket Server Activity types
export interface BitbucketServerActivity {
  id: number;
  createdDate: number;
  user: {
    name: string;
    emailAddress: string;
    displayName: string;
  };
  action: string;
  comment?: any;
  commit?: {
    id: string;
    displayId: string;
    message?: string;
  };
}

// Bitbucket Server Branch types
export interface BitbucketServerBranch {
  id: string;
  displayId: string;
  type: string;
  latestCommit: string;
  latestChangeset: string;
  isDefault: boolean;
  metadata?: {
    "com.atlassian.bitbucket.server.bitbucket-branch:latest-commit-metadata": {
      author: {
        name: string;
        emailAddress: string;
      };
      authorTimestamp: number;
      message: string;
    };
  };
}

// Bitbucket Server Directory Entry
export interface BitbucketServerDirectoryEntry {
  path: {
    name: string;
    toString: string;
  };
  type: 'FILE' | 'DIRECTORY';
  size?: number;
  contentId?: string;
}

// Bitbucket Cloud API response types
export interface BitbucketCloudPullRequest {
  id: number;
  title: string;
  description: string;
  state: string;
  author: {
    display_name: string;
    account_id: string;
  };
  source: {
    branch: {
      name: string;
    };
    repository: {
      full_name: string;
    };
  };
  destination: {
    branch: {
      name: string;
    };
    repository: {
      full_name: string;
    };
  };
  reviewers: Array<{
    display_name: string;
    account_id: string;
  }>;
  participants: Array<{
    user: {
      display_name: string;
      account_id: string;
    };
    role: string;
    approved: boolean;
  }>;
  created_on: string;
  updated_on: string;
  links: {
    html: {
      href: string;
    };
    self: {
      href: string;
    };
    diff: {
      href: string;
    };
  };
  merge_commit?: {
    hash: string;
  };
  close_source_branch: boolean;
  closed_by?: {
    display_name: string;
    account_id: string;
  };
  draft?: boolean;
}

// Bitbucket Cloud Branch types
export interface BitbucketCloudBranch {
  name: string;
  target: {
    hash: string;
    type: string;
    message: string;
    author: {
      raw: string;
      user?: {
        display_name: string;
        account_id: string;
      };
    };
    date: string;
  };
  type: string;
}

// Bitbucket Cloud Directory Entry
export interface BitbucketCloudDirectoryEntry {
  path: string;
  type: 'commit_file' | 'commit_directory';
  size?: number;
  commit?: {
    hash: string;
  };
  links?: {
    self: {
      href: string;
    };
    html: {
      href: string;
    };
  };
}

// Bitbucket Cloud File Metadata
export interface BitbucketCloudFileMetadata {
  path: string;
  size: number;
  encoding?: string;
  mimetype?: string;
  links: {
    self: {
      href: string;
    };
    html: {
      href: string;
    };
    download: {
      href: string;
    };
  };
  commit?: {
    hash: string;
    author?: {
      raw: string;
      user?: {
        display_name: string;
        account_id: string;
      };
    };
    date?: string;
    message?: string;
  };
}

// Merge info type for enhanced PR details
export interface MergeInfo {
  mergeCommitHash?: string;
  mergedBy?: string;
  mergedAt?: string;
  mergeCommitMessage?: string;
}

// Comment types
export interface BitbucketServerComment {
  id: number;
  version: number;
  text: string;
  author: {
    name: string;
    emailAddress: string;
    displayName: string;
  };
  createdDate: number;
  updatedDate: number;
  state?: 'OPEN' | 'RESOLVED';
  anchor?: {
    line: number;
    lineType: string;
    fileType: string;
    path: string;
  };
}

export interface BitbucketCloudComment {
  id: number;
  content: {
    raw: string;
    markup: string;
    html: string;
  };
  user: {
    display_name: string;
    account_id: string;
  };
  created_on: string;
  updated_on: string;
  deleted?: boolean;
  resolved?: boolean;
  inline?: {
    to: number;
    from?: number;
    path: string;
  };
}

// File change types
export interface BitbucketServerFileChange {
  path: {
    toString: string;
  };
  executable: boolean;
  percentUnchanged: number;
  type: string;
  nodeType: string;
  srcPath?: {
    toString: string;
  };
  linesAdded?: number;
  linesRemoved?: number;
}

export interface BitbucketCloudFileChange {
  path: string;
  type: 'added' | 'modified' | 'removed' | 'renamed';
  lines_added: number;
  lines_removed: number;
  old?: {
    path: string;
  };
}

// Formatted comment type for response
export interface FormattedComment {
  id: number;
  author: string;
  text: string;
  created_on: string;
  is_inline: boolean;
  file_path?: string;
  line_number?: number;
  state?: 'OPEN' | 'RESOLVED';
  parent_id?: number;  // For Bitbucket Cloud style replies
  replies?: FormattedComment[];  // For Bitbucket Server nested replies
}

// Formatted file change type for response
export interface FormattedFileChange {
  path: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  old_path?: string;
}

// Types for code snippet matching
export interface CodeMatch {
  line_number: number;
  line_type: 'ADDED' | 'REMOVED' | 'CONTEXT';
  exact_content: string;
  preview: string;
  confidence: number;
  context: {
    lines_before: string[];
    lines_after: string[];
  };
  sequential_position?: number; // Position within diff (for ADDED lines)
  hunk_info?: {
    hunk_index: number;
    destination_start: number;
    line_in_hunk: number;
  };
}

export interface MultipleMatchesError {
  code: 'MULTIPLE_MATCHES_FOUND';
  message: string;
  occurrences: Array<{
    line_number: number;
    file_path: string;
    preview: string;
    confidence: number;
    line_type: 'ADDED' | 'REMOVED' | 'CONTEXT';
  }>;
  suggestion: string;
}

// Commit types
export interface BitbucketServerCommit {
  id: string;
  displayId: string;
  message: string;
  author: {
    name: string;
    emailAddress: string;
  };
  authorTimestamp: number;
  committer?: {
    name: string;
    emailAddress: string;
  };
  committerTimestamp?: number;
  parents: Array<{
    id: string;
    displayId: string;
  }>;
}

export interface BitbucketCloudCommit {
  hash: string;
  message: string;
  author: {
    raw: string;
    user?: {
      display_name: string;
      account_id: string;
    };
  };
  date: string;
  parents: Array<{
    hash: string;
    type: string;
  }>;
  links?: {
    self: {
      href: string;
    };
    html: {
      href: string;
    };
  };
}

export interface FormattedCommit {
  hash: string;
  abbreviated_hash: string;
  message: string;
  author: {
    name: string;
    email: string;
  };
  date: string;
  parents: string[];
  is_merge_commit: boolean;
  build_status?: BuildStatus;
}

// Search types
export interface BitbucketServerSearchRequest {
  query: string;
  entities: {
    code?: {
      start?: number;
      limit?: number;
    };
    commits?: {
      start?: number;
      limit?: number;
    };
    pull_requests?: {
      start?: number;
      limit?: number;
    };
    repositories?: {};
  };
  limits?: {
    primary?: number;
  };
}

export interface BitbucketServerSearchResult {
  scope?: {
    repository?: {
      slug: string;
      name: string;
      project: {
        key: string;
        name: string;
      };
    };
    type: string;
  };
  code?: {
    category: string;
    isLastPage: boolean;
    count: number;
    start: number;
    nextStart?: number;
    values: Array<{
      file: string; // Just the file path as string
      repository: {
        slug: string;
        name: string;
        project: {
          key: string;
          name: string;
        };
      };
      hitContexts: Array<Array<{
        line: number;
        text: string; // HTML-formatted with <em> tags
      }>>;
      pathMatches: Array<any>;
      hitCount: number;
    }>;
  };
  repositories?: {
    category: string;
    isLastPage: boolean;
    count: number;
    start: number;
    nextStart?: number;
    values: Array<{
      slug: string;
      name: string;
      description?: string;
      project: {
        key: string;
        name: string;
      };
      links?: {
        self: Array<{ href: string }>;
        clone?: Array<{ href: string; name: string }>;
      };
      public?: boolean;
      scmId?: string;
    }>;
  };
  query?: {
    substituted: boolean;
  };
}

export interface FormattedSearchResult {
  file_path: string;
  file_name: string;
  repository: string;
  project: string;
  matches: Array<{
    line_number: number;
    line_content: string;
    highlighted_segments: Array<{
      text: string;
      is_match: boolean;
    }>;
  }>;
}

// Build status types for Bitbucket Server
export interface BitbucketServerBuildSummary {
  [commitId: string]: {
    failed?: number;
    inProgress?: number;
    successful?: number;
    unknown?: number;
  };
}

export interface BuildStatus {
  successful: number;
  failed: number;
  in_progress: number;
  unknown: number;
}

// Project and Repository types
export interface BitbucketServerProject {
  key: string;
  id: number;
  name: string;
  description?: string;
  public: boolean;
  type: 'NORMAL' | 'PERSONAL';
  links: {
    self: Array<{
      href: string;
    }>;
  };
}

export interface BitbucketCloudProject {
  key: string;
  uuid: string;
  name: string;
  description?: string;
  is_private: boolean;
  links: {
    html: {
      href: string;
    };
  };
}

export interface BitbucketServerRepository {
  slug: string;
  id: number;
  name: string;
  description?: string;
  hierarchyId: string;
  scmId: string;
  state: 'AVAILABLE' | 'INITIALISING' | 'INITIALISATION_FAILED';
  statusMessage: string;
  forkable: boolean;
  project: {
    key: string;
    id: number;
    name: string;
    public: boolean;
    type: string;
  };
  public: boolean;
  links: {
    clone: Array<{
      href: string;
      name: string;
    }>;
    self: Array<{
      href: string;
    }>;
  };
}

export interface BitbucketCloudRepository {
  slug: string;
  uuid: string;
  name: string;
  full_name: string;
  description?: string;
  scm: string;
  is_private: boolean;
  owner: {
    display_name: string;
    uuid: string;
  };
  project: {
    key: string;
    name: string;
  };
  mainbranch?: {
    name: string;
    type: string;
  };
  links: {
    html: {
      href: string;
    };
    clone: Array<{
      href: string;
      name: string;
    }>;
  };
}
