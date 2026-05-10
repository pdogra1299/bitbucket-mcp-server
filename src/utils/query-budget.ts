// Bitbucket Server search query constraints (from documented syntax):
//  - Max 250 characters total
//  - Max 9 expressions
// We treat each modifier clause (project:, repo:, lang:, ext:, path:, archived:, fork:)
// and each free term / phrase / -term as one expression.

export const MAX_QUERY_LENGTH = 250;
export const MAX_EXPRESSIONS = 9;

export interface QueryClause {
  // The string to render into the query, e.g. `project:PROJ`, `lang:python`, `"foo"`, `-bar`.
  text: string;
  // Whether the clause may be dropped to fit within limits. The free-text term is required;
  // optional clauses include exclude_terms, archived, fork, ext, lang, path, repo (in that drop order).
  required: boolean;
  // For diagnostics: which logical role this clause filled.
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
}

export interface BuiltQuery {
  query: string;
  expression_count: number;
  query_length: number;
  dropped: Array<{ role: QueryClause['role']; text: string; reason: string }>;
}

const DROP_PRIORITY: QueryClause['role'][] = [
  'exclude',
  'archived',
  'fork',
  'ext',
  'lang',
  'path',
  'repo',
];

export function buildQueryFromClauses(clauses: QueryClause[]): BuiltQuery {
  const working = clauses.slice();
  const dropped: BuiltQuery['dropped'] = [];

  const render = () => working.map(c => c.text).filter(Boolean).join(' ').trim();
  const fits = () => render().length <= MAX_QUERY_LENGTH && working.length <= MAX_EXPRESSIONS;

  // Drop one optional clause at a time, in priority order, until the query fits.
  // Avoids dropping all clauses of a role when dropping one would have been enough.
  for (const role of DROP_PRIORITY) {
    while (!fits()) {
      const idx = lastIndexOfRole(working, role);
      if (idx === -1) break; // no more droppable clauses for this role
      const clause = working[idx];
      dropped.push({
        role: clause.role,
        text: clause.text,
        reason: `Exceeds Bitbucket cap (${MAX_QUERY_LENGTH}-char or ${MAX_EXPRESSIONS}-expression).`,
      });
      working.splice(idx, 1);
    }
    if (fits()) break;
  }

  return {
    query: render(),
    expression_count: working.length,
    query_length: render().length,
    dropped,
  };
}

function lastIndexOfRole(clauses: QueryClause[], role: QueryClause['role']): number {
  for (let i = clauses.length - 1; i >= 0; i--) {
    if (clauses[i].role === role && !clauses[i].required) return i;
  }
  return -1;
}

// Quote a free-text term iff it contains whitespace or punctuation that the
// Bitbucket parser would otherwise mis-handle. Bitbucket strips punctuation
// other than `.` and `_` at index time, so quoting only matters for phrases.
export function quoteIfNeeded(term: string): string {
  if (term.length === 0) return term;
  if (/\s/.test(term)) return `"${term.replace(/"/g, '')}"`;
  return term;
}

// Convert snake_case <-> camelCase. Returns the alternate form, or null if there
// is no meaningful alternate (e.g. the input is all lowercase with no underscores).
export function caseVariant(name: string): string | null {
  if (name.includes('_')) {
    // snake_case -> camelCase
    const parts = name.split('_').filter(Boolean);
    if (parts.length < 2) return null;
    const camel = parts[0] + parts.slice(1).map(p => p[0].toUpperCase() + p.slice(1)).join('');
    return camel === name ? null : camel;
  }
  if (/[a-z][A-Z]/.test(name)) {
    // camelCase -> snake_case
    const snake = name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
    return snake === name ? null : snake;
  }
  return null;
}
