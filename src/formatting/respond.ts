import type { ToolResponse } from '../types/index.js';

// Response envelope helpers. Contract for every tool (REVAMP_PLAN.md Pillar C):
//  * no pretty-printed JSON — compact stringify only;
//  * bulk text (diffs, file content, grep results) goes out as plain text
//    blocks, never JSON-escaped strings;
//  * truncation is always marked, never silent;
//  * errors carry actionable steering text via isError.

/** Compact JSON response (no indentation — LLMs parse it fine, ~15-40% smaller). */
export function jsonContent(payload: unknown): ToolResponse {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

/** Plain text response — the preferred shape for bulk content. */
export function textContent(text: string): ToolResponse {
  return { content: [{ type: 'text', text }] };
}

/** Error response with steering text (in-band, visible to the model). */
export function errorContent(message: string): ToolResponse {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Truncate a string with an explicit marker; never trims silently. */
export function truncateMarked(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}… [truncated ${value.length - max} chars]`;
}

/** Serialize unknown error details, capped. */
export function capDetails(details: unknown, max: number): string | undefined {
  if (details === undefined || details === null) return undefined;
  const raw = typeof details === 'string' ? details : safeStringify(details);
  return truncateMarked(raw, max);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** ISO-8601 rendering for epoch-millis or date strings; unambiguous for LLMs. */
export function isoDate(value: number | string | undefined | null): string | undefined {
  if (value === undefined || value === null) return undefined;
  const d = typeof value === 'number' ? new Date(value) : new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * Parse a user-supplied instant: ISO date, epoch seconds, or epoch millis.
 * Returns millis, or undefined when unparseable.
 */
export function toEpochMillis(value: string | undefined): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) {
    const n = Number(value);
    if (!Number.isFinite(n)) return undefined;
    return n < 1e12 ? n * 1000 : n; // seconds vs millis heuristic
  }
  const t = Date.parse(value);
  return Number.isNaN(t) ? undefined : t;
}

/**
 * Whether a `since`-style value names a commit rev rather than a date.
 * Pure digits are treated as epoch dates (a real abbreviated SHA with zero
 * hex letters is astronomically rare; full 40-char SHAs still qualify via
 * length when they contain a letter, and refs/ always qualifies).
 */
export function isCommitRev(value: string): boolean {
  if (value.startsWith('refs/')) return true;
  return /^[0-9a-f]{7,40}$/i.test(value) && /[a-f]/i.test(value);
}

/**
 * Bitbucket Server paged-response cursor. Treats a missing isLastPage as
 * not-last whenever nextPageStart is present, so responses that omit the
 * flag don't silently truncate pagination.
 */
export function serverPage(response: any): { hasMore: boolean; nextStart?: number } {
  const hasMore = response?.isLastPage === false || (response?.isLastPage === undefined && typeof response?.nextPageStart === 'number');
  return { hasMore, nextStart: hasMore ? response?.nextPageStart : undefined };
}

/** Omit undefined/null/empty-string fields from an object literal. */
export function compactObject<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = v;
  }
  return out as Partial<T>;
}
