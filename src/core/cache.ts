// Caching primitives: in-flight request coalescing, a TTL memo, and a
// byte-budget LRU used by the snapshot blob store. Pure mechanism — budgets
// and TTLs are supplied by callers from src/config.

/**
 * Coalesce concurrent async calls by key: while a call for `key` is in
 * flight, every additional caller shares its promise. Nothing is cached
 * after settlement — this only removes duplicate concurrent round-trips.
 */
export class InFlightCoalescer {
  private inFlight = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;
    const p = fn().finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, p);
    return p;
  }
}

/** TTL memo for small mutable lookups (ref→SHA, repo metadata). ttlMs 0 disables. */
export class TtlMemo<V> {
  private entries = new Map<string, { at: number; value: V }>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now
  ) {}

  get(key: string): V | undefined {
    if (this.ttlMs <= 0) return undefined;
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (this.now() - hit.at >= this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    if (this.ttlMs <= 0) return;
    // Opportunistic sweep so long-lived processes don't accumulate dead entries.
    if (this.entries.size > 0 && this.entries.size % 64 === 0) {
      const t = this.now();
      for (const [k, v] of this.entries) {
        if (t - v.at >= this.ttlMs) this.entries.delete(k);
      }
    }
    this.entries.set(key, { at: this.now(), value });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

/**
 * Content-addressed blob store with reference counting. Multiple snapshots
 * (e.g. two branches of one repo) share identical file contents, so the
 * second snapshot costs only its delta.
 */
export class BlobStore {
  private blobs = new Map<string, { buf: Buffer; refs: number }>();
  private bytes = 0;

  get totalBytes(): number {
    return this.bytes;
  }

  /** Add a reference to `hash`, storing `buf` when first seen. Returns bytes newly added. */
  retain(hash: string, buf: Buffer): number {
    const existing = this.blobs.get(hash);
    if (existing) {
      existing.refs += 1;
      return 0;
    }
    this.blobs.set(hash, { buf, refs: 1 });
    this.bytes += buf.length;
    return buf.length;
  }

  /** Drop a reference; frees the blob at zero refs. Returns bytes freed. */
  release(hash: string): number {
    const entry = this.blobs.get(hash);
    if (!entry) return 0;
    entry.refs -= 1;
    if (entry.refs <= 0) {
      this.blobs.delete(hash);
      this.bytes -= entry.buf.length;
      return entry.buf.length;
    }
    return 0;
  }

  get(hash: string): Buffer | undefined {
    return this.blobs.get(hash)?.buf;
  }
}

/**
 * LRU keyed registry with byte accounting. Values report their own size;
 * eviction runs oldest-first until the budget is met. Pure structure — the
 * snapshot store supplies budgets and handles blob release via onEvict.
 */
export class ByteBudgetLru<V> {
  private entries = new Map<string, V>();

  constructor(
    private readonly budgetBytes: number,
    private readonly sizeOf: (value: V) => number,
    private readonly onEvict: (key: string, value: V) => void
  ) {}

  get budget(): number {
    return this.budgetBytes;
  }

  get(key: string): V | undefined {
    const v = this.entries.get(key);
    if (v !== undefined) {
      // refresh recency
      this.entries.delete(key);
      this.entries.set(key, v);
    }
    return v;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  usedBytes(): number {
    let total = 0;
    for (const v of this.entries.values()) total += this.sizeOf(v);
    return total;
  }

  set(key: string, value: V): void {
    const prior = this.entries.get(key);
    if (prior !== undefined) {
      this.entries.delete(key);
      this.onEvict(key, prior);
    }
    this.entries.set(key, value);
    this.evictToBudget();
  }

  delete(key: string): void {
    const v = this.entries.get(key);
    if (v !== undefined) {
      this.entries.delete(key);
      this.onEvict(key, v);
    }
  }

  keys(): string[] {
    return [...this.entries.keys()];
  }

  private evictToBudget(): void {
    if (this.budgetBytes <= 0) {
      for (const key of [...this.entries.keys()]) this.delete(key);
      return;
    }
    while (this.usedBytes() > this.budgetBytes && this.entries.size > 0) {
      const oldest = this.entries.keys().next().value as string;
      this.delete(oldest);
    }
  }
}
