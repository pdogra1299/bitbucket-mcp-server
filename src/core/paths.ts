import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

// URL path construction. Every caller-supplied value that becomes part of a
// REST path goes through here, so `/`, `?`, `#`, `%` and dot-segments can
// never re-route a request (the HTTP verb is fixed per tool, so a re-routed
// path aims a write at a different resource under the same credentials).

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * Percent-encode ONE path segment. Rejects (McpError InvalidParams) values
 * that would change the route rather than name a resource: empty strings,
 * `.` / `..`, and control characters. Everything else — including `/`, `?`,
 * `#` and `%` — is encoded so it stays inside this segment.
 */
export function encodeSegment(value: string, label = 'path segment'): string {
  if (typeof value !== 'string' || value.length === 0 || value === '.' || value === '..' || CONTROL_CHARS.test(value)) {
    throw new McpError(ErrorCode.InvalidParams, `Invalid ${label}`);
  }
  return encodeURIComponent(value);
}

/**
 * Percent-encode a repo-relative file path per segment. `.` segments and
 * empty segments are dropped (harmless); `..` segments are rejected because
 * the server would normalize them out of the repo scope.
 */
export function encodeRepoPath(path: string): string {
  const segments = path.split('/').filter(s => s.length > 0 && s !== '.');
  for (const s of segments) {
    if (s === '..' || CONTROL_CHARS.test(s)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid file path: `..` segments and control characters are not allowed');
    }
  }
  return segments.map(encodeURIComponent).join('/');
}

/** True when `candidate` is an absolute URL on the same origin as `baseUrl`. */
export function isSameOrigin(baseUrl: string, candidate: string): boolean {
  try {
    return new URL(candidate).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}
