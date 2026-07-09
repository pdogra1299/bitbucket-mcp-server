// Pacing primitives. Pure mechanism — all rates/capacities are supplied by
// the caller from src/config; nothing here reads the environment or embeds
// policy numbers.

/**
 * Token bucket: take() resolves when a token is available. Tokens refill
 * continuously at ratePerSec up to burst capacity. ratePerSec <= 0 disables
 * pacing entirely (for rate-limit-exempted service accounts).
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly ratePerSec: number,
    private readonly burst: number,
    private readonly now: () => number = Date.now
  ) {
    this.tokens = burst;
    this.lastRefill = this.now();
  }

  private refill(): void {
    const t = this.now();
    const elapsed = (t - this.lastRefill) / 1000;
    if (elapsed > 0) {
      this.tokens = Math.min(this.burst, this.tokens + elapsed * this.ratePerSec);
      this.lastRefill = t;
    }
  }

  /** Milliseconds until a token would be available (0 = now). */
  msUntilAvailable(): number {
    if (this.ratePerSec <= 0) return 0;
    this.refill();
    if (this.tokens >= 1) return 0;
    return Math.ceil(((1 - this.tokens) / this.ratePerSec) * 1000);
  }

  /** Non-blocking take; true when a token was consumed. */
  tryTake(): boolean {
    if (this.ratePerSec <= 0) return true;
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  async take(): Promise<void> {
    // Loop because multiple waiters can race for the same refilled token.
    while (!this.tryTake()) {
      await sleep(this.msUntilAvailable() + 1);
    }
  }
}

/** Counting semaphore for global in-flight concurrency. max <= 0 disables. */
export class Semaphore {
  private active = 0;
  private waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<() => void> {
    if (this.max <= 0) return () => {};
    if (this.active >= this.max) {
      await new Promise<void>(resolve => this.waiters.push(resolve));
    }
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      const next = this.waiters.shift();
      if (next) next();
    };
  }
}

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Parse a Retry-After header value: delta-seconds or HTTP-date.
 * Returns milliseconds, or undefined when absent/unparseable. Bitbucket DC
 * documents no Retry-After — this is opportunistic (proxies; Jira DC when
 * this module is reused by the sibling jira server).
 */
export function retryAfterMs(headerValue: unknown, now: () => number = Date.now): number | undefined {
  if (headerValue === undefined || headerValue === null) return undefined;
  const raw = String(headerValue).trim();
  if (raw === '') return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(raw);
  if (!Number.isNaN(date)) return Math.max(0, date - now());
  return undefined;
}

/** Full-jitter exponential backoff: uniform(0, min(cap, base * 2^(attempt-1))). */
export function backoffMs(
  attempt: number,
  baseMs: number,
  capMs: number,
  random: () => number = Math.random
): number {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.floor(random() * exp);
}
