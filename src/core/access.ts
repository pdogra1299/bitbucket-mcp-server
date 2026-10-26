import { minimatch } from 'minimatch';

// Access-policy predicates (config.access). Pure functions; the registry
// enforces read-only/disabled tools, handlers call these for branch-level
// checks that need the resolved target.

/** Strip every `refs/heads/` / `heads/` prefix so alternate spellings cannot dodge the list. */
export function normalizeBranchName(branch: string): string {
  let name = branch;
  while (/^(refs\/)?heads\//.test(name)) name = name.replace(/^(refs\/)?heads\//, '');
  return name;
}

/**
 * True when `branch` matches any protected-branch pattern — exact name or
 * minimatch glob (`release/*` matches one level; use `release/**` for nested).
 */
export function isProtectedBranch(branch: string, patterns: readonly string[]): boolean {
  if (patterns.length === 0) return false;
  const name = normalizeBranchName(branch);
  return patterns.some(p => p === name || minimatch(name, p, { nocase: false, dot: true }));
}
