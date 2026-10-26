// Log hygiene. Error objects are never logged whole: an axios error carries
// its request config, which includes the Authorization header. Every log
// site goes through summarizeError, which emits status + message only and
// scrubs anything that still looks like a credential.

const CREDENTIAL_PATTERNS: RegExp[] = [
  // "Authorization: Bearer xxx" / "authorization=Basic xxx" in any serialization.
  /(authorization["']?\s*[:=]\s*["']?)(bearer|basic)\s+[^\s"',}]+/gi,
  // Bare scheme + token.
  /\b((?:bearer|basic)\s+)[A-Za-z0-9._~+/=-]{8,}/gi,
  // Query-string style secrets.
  /([?&](?:access_token|token|password|app_password)=)[^&\s"']+/gi,
];

/** Replace anything that looks like a credential with a marker. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of CREDENTIAL_PATTERNS) {
    out = out.replace(pattern, (_m, prefix: string) => `${prefix}[REDACTED]`);
  }
  return out;
}

/**
 * One-line, credential-free description of an error for stderr. Never
 * serializes the object itself — only name, HTTP status, code and message.
 */
export function summarizeError(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { name?: unknown; status?: unknown; code?: unknown; message?: unknown };
    const parts: string[] = [];
    if (typeof e.name === 'string' && e.name !== 'Error' && e.name !== 'Object') parts.push(e.name);
    if (typeof e.status === 'number') parts.push(`HTTP ${e.status}`);
    if (typeof e.code === 'string') parts.push(e.code);
    parts.push(typeof e.message === 'string' && e.message.length > 0 ? e.message : 'unknown error');
    return redactSecrets(parts.join(' '));
  }
  return redactSecrets(String(error));
}
