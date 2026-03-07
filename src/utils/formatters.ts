import {
  BitbucketServerPullRequest,
  BitbucketCloudPullRequest,
  MergeInfo,
  BitbucketServerCommit,
  BitbucketCloudCommit,
  FormattedCommit,
  BitbucketServerSearchResult,
  FormattedSearchResult
} from '../types/bitbucket.js';

// Full detail format for get_pull_request
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
    author: pr.author.user.displayName,
    author_username: pr.author.user.name,
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
    is_locked: pr.locked,
    is_merged: pr.state === 'MERGED',
    merge_commit_hash: mergeInfo?.mergeCommitHash || pr.properties?.mergeCommit?.id || null,
    merged_by: mergeInfo?.mergedBy || null,
    merged_at: mergeInfo?.mergedAt || null,
  };
}

// Full detail format for get_pull_request (Cloud)
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
    is_merged: pr.state === 'MERGED',
    merge_commit_hash: pr.merge_commit?.hash || null,
    merged_by: pr.closed_by?.display_name || null,
    merged_at: pr.state === 'MERGED' ? pr.updated_on : null,
  };
}

// Slim list format for list_pull_requests (Server)
export function formatServerPRListItem(pr: BitbucketServerPullRequest, baseUrl?: string): any {
  const webUrl = `${baseUrl}/projects/${pr.toRef.repository.project.key}/repos/${pr.toRef.repository.slug}/pull-requests/${pr.id}`;
  return {
    id: pr.id,
    title: pr.title,
    state: pr.state,
    author: pr.author.user.displayName,
    author_username: pr.author.user.name,
    source_branch: pr.fromRef.displayId,
    destination_branch: pr.toRef.displayId,
    updated_on: new Date(pr.updatedDate).toLocaleString(),
    web_url: webUrl,
    reviewers: pr.reviewers.map(r => ({ name: r.user.displayName, approved: r.approved })),
  };
}

// Slim list format for list_pull_requests (Cloud)
export function formatCloudPRListItem(pr: BitbucketCloudPullRequest): any {
  return {
    id: pr.id,
    title: pr.title,
    state: pr.state,
    author: pr.author.display_name,
    source_branch: pr.source.branch.name,
    destination_branch: pr.destination.branch.name,
    updated_on: new Date(pr.updated_on).toLocaleString(),
    web_url: pr.links.html.href,
    reviewers: pr.reviewers.map(r => r.display_name),
  };
}

export function formatServerCommit(commit: BitbucketServerCommit): FormattedCommit {
  return {
    hash: commit.id,
    abbreviated_hash: commit.displayId,
    message: commit.message,
    author: {
      name: commit.author.name,
    },
    date: new Date(commit.authorTimestamp).toISOString(),
    is_merge_commit: commit.parents.length > 1,
  };
}

export function formatCloudCommit(commit: BitbucketCloudCommit): FormattedCommit {
  const authorMatch = commit.author.raw.match(/^(.+?)\s*<(.+?)>$/);
  const authorName = authorMatch ? authorMatch[1] : (commit.author.user?.display_name || commit.author.raw);

  return {
    hash: commit.hash,
    abbreviated_hash: commit.hash.substring(0, 7),
    message: commit.message,
    author: {
      name: authorName,
    },
    date: commit.date,
    is_merge_commit: commit.parents.length > 1,
  };
}

export function formatSearchResults(searchResult: BitbucketServerSearchResult): FormattedSearchResult[] {
  const results: FormattedSearchResult[] = [];

  if (!searchResult.code?.values) {
    return results;
  }

  for (const value of searchResult.code.values) {
    const fileName = value.file.split('/').pop() || value.file;

    const formattedResult: FormattedSearchResult = {
      file_path: value.file,
      file_name: fileName,
      repository: value.repository.slug,
      project: value.repository.project.key,
      matches: []
    };

    if (value.hitContexts && value.hitContexts.length > 0) {
      for (const contextGroup of value.hitContexts) {
        for (const lineContext of contextGroup) {
          const { text, segments } = parseHighlightedText(lineContext.text);

          formattedResult.matches.push({
            line_number: lineContext.line,
            line_content: text,
            highlighted_segments: segments
          });
        }
      }
    }

    results.push(formattedResult);
  }

  return results;
}

function parseHighlightedText(htmlText: string): {
  text: string;
  segments: Array<{ text: string; is_match: boolean }>;
} {
  const decodedText = htmlText
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/g, '/');

  const segments: Array<{ text: string; is_match: boolean }> = [];
  let plainText = '';

  const emRegex = /<em>(.*?)<\/em>/g;
  let lastEnd = 0;
  let match;

  while ((match = emRegex.exec(decodedText)) !== null) {
    if (match.index > lastEnd) {
      const beforeText = decodedText.substring(lastEnd, match.index);
      segments.push({ text: beforeText, is_match: false });
      plainText += beforeText;
    }

    const highlightedText = match[1];
    segments.push({ text: highlightedText, is_match: true });
    plainText += highlightedText;

    lastEnd = match.index + match[0].length;
  }

  if (lastEnd < decodedText.length) {
    const remainingText = decodedText.substring(lastEnd);
    segments.push({ text: remainingText, is_match: false });
    plainText += remainingText;
  }

  if (segments.length === 0) {
    segments.push({ text: decodedText, is_match: false });
    plainText = decodedText;
  }

  return { text: plainText, segments };
}

export function formatCodeSearchOutput(searchResult: BitbucketServerSearchResult): string {
  if (!searchResult.code?.values || searchResult.code.values.length === 0) {
    return 'No results found';
  }

  const outputLines: string[] = [];

  for (const value of searchResult.code.values) {
    outputLines.push(`File: ${value.file}`);

    if (value.hitContexts && value.hitContexts.length > 0) {
      for (const contextGroup of value.hitContexts) {
        for (const lineContext of contextGroup) {
          const cleanText = lineContext.text
            .replace(/<em>/g, '')
            .replace(/<\/em>/g, '')
            .replace(/&quot;/g, '"')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&#x2F;/g, '/')
            .replace(/&#x27;/g, "'");

          outputLines.push(`  Line ${lineContext.line}: ${cleanText}`);
        }
      }
    }

    outputLines.push('');
  }

  return outputLines.join('\n').trim();
}
