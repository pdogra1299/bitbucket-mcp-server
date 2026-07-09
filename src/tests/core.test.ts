import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TokenBucket, Semaphore, retryAfterMs, backoffMs } from '../core/throttle.js';
import { BlobStore, ByteBudgetLru, TtlMemo, InFlightCoalescer } from '../core/cache.js';
import { scanContent } from '../core/scan.js';
import { buildQueryFromClauses, quoteIfNeeded } from '../core/query-budget.js';
import { LineScanner } from '../core/snapshot.js';
import { truncateMarked, compactObject, isoDate, isCommitRev, toEpochMillis, serverPage } from '../formatting/respond.js';
import { isPosInt, optNonNegInt } from '../tools/guards.js';

// ── throttle ─────────────────────────────────────────────────────────────────

test('TokenBucket: burst then refill pacing', () => {
  let now = 0;
  const bucket = new TokenBucket(5, 3, () => now);
  assert.equal(bucket.tryTake(), true);
  assert.equal(bucket.tryTake(), true);
  assert.equal(bucket.tryTake(), true);
  assert.equal(bucket.tryTake(), false); // burst exhausted
  assert.ok(bucket.msUntilAvailable() > 0);
  now += 200; // 5/sec → one token per 200ms
  assert.equal(bucket.tryTake(), true);
  assert.equal(bucket.tryTake(), false);
});

test('TokenBucket: ratePerSec 0 disables pacing', () => {
  const bucket = new TokenBucket(0, 1);
  for (let i = 0; i < 100; i++) assert.equal(bucket.tryTake(), true);
});

test('Semaphore: caps concurrency and releases waiters', async () => {
  const sem = new Semaphore(2);
  const r1 = await sem.acquire();
  const r2 = await sem.acquire();
  let third = false;
  const p3 = sem.acquire().then(r => {
    third = true;
    return r;
  });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(third, false);
  r1();
  const r3 = await p3;
  assert.equal(third, true);
  r2();
  r3();
});

test('retryAfterMs: delta-seconds, HTTP-date, garbage', () => {
  assert.equal(retryAfterMs('2'), 2000);
  assert.equal(retryAfterMs(undefined), undefined);
  assert.equal(retryAfterMs('nonsense-date'), undefined);
  const now = Date.now();
  const ms = retryAfterMs(new Date(now + 5000).toUTCString(), () => now);
  assert.ok(ms !== undefined && ms > 3000 && ms <= 5000);
});

test('backoffMs: bounded by cap', () => {
  for (let attempt = 1; attempt < 10; attempt++) {
    const ms = backoffMs(attempt, 1000, 4000, () => 0.999);
    assert.ok(ms <= 4000);
  }
});

// ── cache ────────────────────────────────────────────────────────────────────

test('BlobStore: refcounted dedup', () => {
  const store = new BlobStore();
  const buf = Buffer.from('hello world');
  assert.equal(store.retain('h1', buf), buf.length);
  assert.equal(store.retain('h1', buf), 0); // second ref costs nothing
  assert.equal(store.totalBytes, buf.length);
  assert.equal(store.release('h1'), 0); // still one ref
  assert.equal(store.release('h1'), buf.length); // freed
  assert.equal(store.totalBytes, 0);
  assert.equal(store.get('h1'), undefined);
});

test('ByteBudgetLru: evicts oldest first to fit budget', () => {
  const evicted: string[] = [];
  const lru = new ByteBudgetLru<number>(100, v => v, k => evicted.push(k));
  lru.set('a', 40);
  lru.set('b', 40);
  lru.get('a'); // refresh a — b becomes oldest
  lru.set('c', 40); // 120 > 100 → evict b
  assert.deepEqual(evicted, ['b']);
  assert.ok(lru.has('a') && lru.has('c') && !lru.has('b'));
});

test('ByteBudgetLru: zero budget retains nothing', () => {
  const lru = new ByteBudgetLru<number>(0, v => v, () => {});
  lru.set('a', 1);
  assert.equal(lru.has('a'), false);
});

test('TtlMemo: expires by injected clock; 0 disables', () => {
  let now = 0;
  const memo = new TtlMemo<string>(1000, () => now);
  memo.set('k', 'v');
  assert.equal(memo.get('k'), 'v');
  now = 1001;
  assert.equal(memo.get('k'), undefined);
  const off = new TtlMemo<string>(0);
  off.set('k', 'v');
  assert.equal(off.get('k'), undefined);
});

test('InFlightCoalescer: concurrent same-key calls share one execution', async () => {
  const c = new InFlightCoalescer();
  let calls = 0;
  const fn = () =>
    c.run('key', async () => {
      calls += 1;
      await new Promise(r => setTimeout(r, 20));
      return calls;
    });
  const [a, b] = await Promise.all([fn(), fn()]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  await fn(); // after settlement a new call runs
  assert.equal(calls, 2);
});

// ── scanning ─────────────────────────────────────────────────────────────────

test('scanContent: line numbers and filter', () => {
  const hits = scanContent('foo\nbar\nfoo bar\n', /foo/);
  assert.deepEqual(hits.map(h => h.line), [1, 3]);
  const filtered = scanContent('foo\nbar\nfoo bar\n', /foo/, l => l.includes('bar'));
  assert.deepEqual(filtered.map(h => h.line), [3]);
});

test('scanContent: CRLF lines match $-anchored patterns and drop the \\r', () => {
  const hits = scanContent('foo;\r\nbar\r\n', /foo;$/);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].text, 'foo;');
});

test('LineScanner: chunk boundaries do not split matches', () => {
  const collected: Array<{ line: number; text: string }> = [];
  const scanner = new LineScanner(/needle/, 0, 300, m => collected.push(m));
  scanner.feed('hay\nnee');
  scanner.feed('dle\nhay\n');
  scanner.end();
  assert.equal(scanner.matchCount, 1);
  assert.deepEqual(collected, [{ line: 2, text: 'needle' }]);
});

test('LineScanner: context lines before/after', () => {
  const collected: any[] = [];
  const scanner = new LineScanner(/x/, 1, 300, m => collected.push(m));
  scanner.feed('a\nx\nb\n');
  scanner.end();
  assert.equal(collected.length, 1);
  assert.deepEqual(collected[0].before, [[1, 'a']]);
  assert.deepEqual(collected[0].after, [[3, 'b']]);
});

test('LineScanner: long lines truncated with marker, still counted', () => {
  const collected: any[] = [];
  const scanner = new LineScanner(/z/, 0, 10, m => collected.push(m));
  scanner.feed('z'.repeat(50) + '\n');
  scanner.end();
  assert.equal(collected[0].truncated, true);
  assert.ok(collected[0].text.length <= 11); // 10 + ellipsis
});

// ── query budget ─────────────────────────────────────────────────────────────

test('buildQueryFromClauses: drops optional clauses to fit expression cap', () => {
  const clauses = [
    { text: 'project:P', role: 'project' as const, required: true },
    { text: 'term', role: 'term' as const, required: true },
    ...Array.from({ length: 10 }, (_, i) => ({ text: `-x${i}`, role: 'exclude' as const, required: false })),
  ];
  const built = buildQueryFromClauses(clauses);
  assert.ok(built.expression_count <= 9);
  assert.ok(built.dropped.length >= 3);
  assert.ok(built.query.includes('project:P') && built.query.includes('term'));
});

test('quoteIfNeeded: phrases quoted, terms untouched', () => {
  assert.equal(quoteIfNeeded('foo'), 'foo');
  assert.equal(quoteIfNeeded('foo bar'), '"foo bar"');
});

// ── respond helpers ──────────────────────────────────────────────────────────

test('isCommitRev: hex-lettered SHAs and refs yes; epoch digits and dates no', () => {
  assert.equal(isCommitRev('b919921353e2'), true);
  assert.equal(isCommitRev('refs/heads/main'), true);
  assert.equal(isCommitRev('1751826000'), false); // epoch seconds, not a rev
  assert.equal(isCommitRev('2026-07-09'), false);
  assert.equal(isCommitRev('deadbeef'), true);
});

test('toEpochMillis: ISO, epoch seconds, epoch millis, garbage', () => {
  assert.equal(toEpochMillis('1970-01-01T00:00:01.000Z'), 1000);
  assert.equal(toEpochMillis('1751826000'), 1751826000000); // seconds → ms
  assert.equal(toEpochMillis('1751826000000'), 1751826000000); // already ms
  assert.equal(toEpochMillis('not-a-date'), undefined);
  assert.equal(toEpochMillis(undefined), undefined);
});

test('serverPage: missing isLastPage with nextPageStart still pages', () => {
  assert.deepEqual(serverPage({ isLastPage: false, nextPageStart: 25 }), { hasMore: true, nextStart: 25 });
  assert.deepEqual(serverPage({ isLastPage: true }), { hasMore: false, nextStart: undefined });
  assert.deepEqual(serverPage({ nextPageStart: 50 }), { hasMore: true, nextStart: 50 });
  assert.deepEqual(serverPage({}), { hasMore: false, nextStart: undefined });
});

test('integer guards reject NaN/Infinity/floats/negatives', () => {
  assert.equal(isPosInt(1), true);
  assert.equal(isPosInt(0), false);
  assert.equal(isPosInt(NaN), false);
  assert.equal(isPosInt(Infinity), false);
  assert.equal(isPosInt(1.5), false);
  assert.equal(optNonNegInt(undefined), true);
  assert.equal(optNonNegInt(0), true);
  assert.equal(optNonNegInt(-1), false);
  assert.equal(optNonNegInt(NaN), false);
});

test('truncateMarked marks, compactObject drops empties, isoDate normalizes', () => {
  assert.equal(truncateMarked('abc', 10), 'abc');
  assert.ok(truncateMarked('a'.repeat(20), 10).includes('[truncated 10 chars]'));
  assert.deepEqual(compactObject({ a: 1, b: undefined, c: null, d: '' }), { a: 1 });
  assert.equal(isoDate(0), '1970-01-01T00:00:00.000Z');
  assert.equal(isoDate('not-a-date'), undefined);
});
