import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'zlib';
import { Readable } from 'stream';
import { pack as tarPack } from 'tar-stream';
import { RepoSnapshotStore } from '../core/snapshot.js';
import { loadConfig } from '../config/index.js';
import type { BitbucketApiClient } from '../core/api-client.js';

// End-to-end snapshot engine tests over synthetic tar.gz archives and a fake
// API client — no network. Covers: stream scanning, binary skip, retention +
// warm serving, freshness invalidation, and completeness for oversized files.

async function buildArchive(files: Array<{ name: string; content: Buffer | string }>): Promise<Buffer> {
  const p = tarPack();
  for (const f of files) {
    p.entry({ name: f.name }, typeof f.content === 'string' ? Buffer.from(f.content) : f.content);
  }
  p.finalize();
  const chunks: Buffer[] = [];
  for await (const chunk of p as any) chunks.push(chunk as Buffer);
  return gzipSync(Buffer.concat(chunks));
}

type FakeClientState = {
  sha: string;
  archive: Buffer;
  archiveCalls: number;
  rawCalls: string[];
  rawContent: Map<string, string>;
};

function fakeClient(state: FakeClientState, env: Record<string, string> = {}): BitbucketApiClient {
  const config = loadConfig({
    BITBUCKET_USERNAME: 'u',
    BITBUCKET_TOKEN: 't',
    BITBUCKET_BASE_URL: 'http://x',
    BITBUCKET_REF_RESOLVE_TTL_MS: '0', // validate every call in tests
    ...env,
  });
  return {
    getConfig: () => config,
    getIsServer: () => true,
    resolveRef: async () => state.sha,
    streamArchive: async () => {
      state.archiveCalls += 1;
      return { stream: Readable.from(state.archive), release: () => {} };
    },
    makeRequest: async (_m: string, path: string) => {
      state.rawCalls.push(path);
      for (const [name, content] of state.rawContent) {
        if (path.includes(`/raw/${name}`)) return content;
      }
      throw { status: 404, message: 'not found', isAxiosError: true };
    },
  } as unknown as BitbucketApiClient;
}

test('snapshot grep: cold stream scans, warm hit serves with zero archive calls', async () => {
  const archive = await buildArchive([
    { name: 'src/a.ts', content: 'const needle = 1;\nplain line\n' },
    { name: 'src/b.ts', content: 'nothing here\n' },
    { name: 'img/logo.png', content: Buffer.from([0x89, 0x50, 0x00, 0x47, 1, 2, 3]) }, // NUL → binary
  ]);
  const state: FakeClientState = { sha: 'a'.repeat(40), archive, archiveCalls: 0, rawCalls: [], rawContent: new Map() };
  const store = new RepoSnapshotStore(fakeClient(state));

  const cold = await store.grep({
    project: 'P', repository: 'r', regex: /needle/, maxMatches: 50, contextLines: 0,
  });
  assert.equal(cold.engine, 'stream');
  assert.equal(state.archiveCalls, 1);
  assert.equal(cold.totalMatches, 1);
  assert.equal(cold.results[0].path, 'src/a.ts');
  assert.equal(cold.results[0].matches[0].line, 1);
  assert.equal(cold.binariesSkipped, 1);

  const warm = await store.grep({
    project: 'P', repository: 'r', regex: /needle/, maxMatches: 50, contextLines: 0,
  });
  assert.equal(warm.engine, 'snapshot');
  assert.equal(state.archiveCalls, 1); // no second archive download
  assert.equal(warm.totalMatches, 1);
});

test('snapshot grep: freshness — new head SHA triggers a re-fetch', async () => {
  const archive = await buildArchive([{ name: 'f.txt', content: 'v1 needle\n' }]);
  const state: FakeClientState = { sha: 'b'.repeat(40), archive, archiveCalls: 0, rawCalls: [], rawContent: new Map() };
  const store = new RepoSnapshotStore(fakeClient(state));

  await store.grep({ project: 'P', repository: 'r', regex: /needle/, maxMatches: 10, contextLines: 0 });
  assert.equal(state.archiveCalls, 1);

  // Branch moves: new SHA, new content.
  state.sha = 'c'.repeat(40);
  state.archive = await buildArchive([{ name: 'f.txt', content: 'v2 has no match\n' }]);
  const after = await store.grep({ project: 'P', repository: 'r', regex: /needle/, maxMatches: 10, contextLines: 0 });
  assert.equal(state.archiveCalls, 2); // stale snapshot NOT served
  assert.equal(after.totalMatches, 0);
  assert.equal(after.sha, 'c'.repeat(40));
});

test('snapshot grep: oversized text files are scanned during streaming AND re-scanned warm via raw fetch', async () => {
  const bigLine = 'x'.repeat(100) + ' needle\n';
  const bigContent = bigLine + 'filler\n'.repeat(50_000); // ~350KB > 64KB retention cap below
  const archive = await buildArchive([
    { name: 'big.log', content: bigContent },
    { name: 'small.ts', content: 'no match\n' },
  ]);
  const state: FakeClientState = {
    sha: 'd'.repeat(40), archive, archiveCalls: 0, rawCalls: [],
    rawContent: new Map([['big.log', bigContent]]),
  };
  const store = new RepoSnapshotStore(fakeClient(state, { BITBUCKET_SNAPSHOT_MAX_FILE_KB: '64' }));

  const cold = await store.grep({ project: 'P', repository: 'r', regex: /needle/, maxMatches: 10, contextLines: 0 });
  assert.equal(cold.totalMatches, 1, 'oversized file must still be scanned on the cold pass');

  const warm = await store.grep({ project: 'P', repository: 'r', regex: /needle/, maxMatches: 10, contextLines: 0 });
  assert.equal(warm.engine, 'snapshot');
  assert.equal(warm.totalMatches, 1, 'omitted file must be re-fetched and scanned on warm pass');
  assert.ok(state.rawCalls.some(p => p.includes('/raw/big.log')), 'warm pass fetches the uncached file individually');
});

test('snapshot grep: retention disabled (budget 0) always streams', async () => {
  const archive = await buildArchive([{ name: 'f.ts', content: 'needle\n' }]);
  const state: FakeClientState = { sha: 'e'.repeat(40), archive, archiveCalls: 0, rawCalls: [], rawContent: new Map() };
  const store = new RepoSnapshotStore(fakeClient(state, { BITBUCKET_SNAPSHOT_MAX_MB: '0' }));

  const first = await store.grep({ project: 'P', repository: 'r', regex: /needle/, maxMatches: 10, contextLines: 0 });
  // Readable.from can only be consumed once — refresh the buffer stream.
  state.archive = await buildArchive([{ name: 'f.ts', content: 'needle\n' }]);
  const second = await store.grep({ project: 'P', repository: 'r', regex: /needle/, maxMatches: 10, contextLines: 0 });
  assert.equal(first.engine, 'stream');
  assert.equal(second.engine, 'stream');
  assert.equal(state.archiveCalls, 2);
});

test('snapshot glob filter: only matching files scanned; listPathsIfWarm serves all paths', async () => {
  const archive = await buildArchive([
    { name: 'src/a.ts', content: 'needle\n' },
    { name: 'docs/readme.md', content: 'needle\n' },
  ]);
  const state: FakeClientState = { sha: 'f'.repeat(40), archive, archiveCalls: 0, rawCalls: [], rawContent: new Map() };
  const store = new RepoSnapshotStore(fakeClient(state));

  const outcome = await store.grep({
    project: 'P', repository: 'r', regex: /needle/, glob: '*.ts', maxMatches: 10, contextLines: 0,
  });
  assert.equal(outcome.totalMatches, 1);
  assert.equal(outcome.results[0].path, 'src/a.ts');

  const warm = await store.listPathsIfWarm('P', 'r');
  assert.ok(warm);
  assert.deepEqual([...warm!.paths].sort(), ['docs/readme.md', 'src/a.ts']);
});

test('config: env overrides apply and invalid groups are dropped', () => {
  const cfg = loadConfig({
    BITBUCKET_USERNAME: 'u',
    BITBUCKET_TOKEN: 't',
    BITBUCKET_RATE_LIMIT_RPS: '10',
    BITBUCKET_SNAPSHOT_MAX_MB: '512',
    BITBUCKET_TOOL_GROUPS: 'files,bogus_group,search',
  });
  assert.equal(cfg.rateLimit.ratePerSec, 10);
  assert.equal(cfg.snapshot.maxTotalMb, 512);
  assert.deepEqual(cfg.toolGroups, ['files', 'search']);
});
