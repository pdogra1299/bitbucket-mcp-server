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

// Merge info type for enhanced PR details
export interface MergeInfo {
  mergeCommitHash?: string;
  mergedBy?: string;
  mergedAt?: string;
  mergeCommitMessage?: string;
}
