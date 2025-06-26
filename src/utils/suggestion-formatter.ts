/**
 * Formats a comment with a code suggestion in markdown format
 * that Bitbucket can render as an applicable suggestion
 */
export function formatSuggestionComment(
  commentText: string,
  suggestion: string,
  startLine?: number,
  endLine?: number
): string {
  // Add line range info if it's a multi-line suggestion
  const lineInfo = startLine && endLine && endLine > startLine 
    ? ` (lines ${startLine}-${endLine})` 
    : '';
  
  // Format with GitHub-style suggestion markdown
  return `${commentText}${lineInfo}

\`\`\`suggestion
${suggestion}
\`\`\``;
}
