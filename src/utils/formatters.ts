import { 
  BitbucketServerPullRequest, 
  BitbucketCloudPullRequest, 
  MergeInfo,
  BitbucketServerCommit,
  BitbucketCloudCommit,
  FormattedCommit
} from '../types/bitbucket.js';

export function formatServerResponse(
  pr: BitbucketServerPullRequest,
  mergeInfo?: MergeInfo,
  baseUrl?: string
): any {
  const webUrl = `${baseUrl}/projects/${pr.toRef.repository.project.key}/repos/${pr.toRef.repository.slug}/pull-requests/${pr.id}`;
  
  return {
    id: pr.id,
    title: pr.title,
    description: pr.description || 'No description provided',
    state: pr.state,
    is_open: pr.open,
    is_closed: pr.closed,
    author: pr.author.user.displayName,
    author_username: pr.author.user.name,
    author_email: pr.author.user.emailAddress,
    source_branch: pr.fromRef.displayId,
    destination_branch: pr.toRef.displayId,
    source_commit: pr.fromRef.latestCommit,
    destination_commit: pr.toRef.latestCommit,
    reviewers: pr.reviewers.map(r => ({
      name: r.user.displayName,
      approved: r.approved,
      status: r.status,
    })),
    participants: pr.participants.map(p => ({
      name: p.user.displayName,
      role: p.role,
      approved: p.approved,
      status: p.status,
    })),
    created_on: new Date(pr.createdDate).toLocaleString(),
    updated_on: new Date(pr.updatedDate).toLocaleString(),
    web_url: webUrl,
    api_url: pr.links.self[0]?.href || '',
    is_locked: pr.locked,
    // Add merge commit details
    is_merged: pr.state === 'MERGED',
    merge_commit_hash: mergeInfo?.mergeCommitHash || pr.properties?.mergeCommit?.id || null,
    merged_by: mergeInfo?.mergedBy || null,
    merged_at: mergeInfo?.mergedAt || null,
    merge_commit_message: mergeInfo?.mergeCommitMessage || null,
  };
}

export function formatCloudResponse(pr: BitbucketCloudPullRequest): any {
  return {
    id: pr.id,
    title: pr.title,
    description: pr.description || 'No description provided',
    state: pr.state,
    author: pr.author.display_name,
    source_branch: pr.source.branch.name,
    destination_branch: pr.destination.branch.name,
    reviewers: pr.reviewers.map(r => r.display_name),
    participants: pr.participants.map(p => ({
      name: p.user.display_name,
      role: p.role,
      approved: p.approved,
    })),
    created_on: new Date(pr.created_on).toLocaleString(),
    updated_on: new Date(pr.updated_on).toLocaleString(),
    web_url: pr.links.html.href,
    api_url: pr.links.self.href,
    diff_url: pr.links.diff.href,
    is_merged: pr.state === 'MERGED',
    merge_commit_hash: pr.merge_commit?.hash || null,
    merged_by: pr.closed_by?.display_name || null,
    merged_at: pr.state === 'MERGED' ? pr.updated_on : null,
    merge_commit_message: null, // Would need additional API call to get this
    close_source_branch: pr.close_source_branch,
  };
}

export function formatServerCommit(commit: BitbucketServerCommit): FormattedCommit {
  return {
    hash: commit.id,
    abbreviated_hash: commit.displayId,
    message: commit.message,
    author: {
      name: commit.author.name,
      email: commit.author.emailAddress,
    },
    date: new Date(commit.authorTimestamp).toISOString(),
    parents: commit.parents.map(p => p.id),
    is_merge_commit: commit.parents.length > 1,
  };
}

export function formatCloudCommit(commit: BitbucketCloudCommit): FormattedCommit {
  // Parse the author raw string which is in format "Name <email>"
  const authorMatch = commit.author.raw.match(/^(.+?)\s*<(.+?)>$/);
  const authorName = authorMatch ? authorMatch[1] : (commit.author.user?.display_name || commit.author.raw);
  const authorEmail = authorMatch ? authorMatch[2] : '';

  return {
    hash: commit.hash,
    abbreviated_hash: commit.hash.substring(0, 7),
    message: commit.message,
    author: {
      name: authorName,
      email: authorEmail,
    },
    date: commit.date,
    parents: commit.parents.map(p => p.hash),
    is_merge_commit: commit.parents.length > 1,
  };
}
