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
