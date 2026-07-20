import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  collectEnvFilePaths,
  applyEnvFiles,
  loadEnvFilesFromArgv,
} from '../cli/env-file.js';

test('collectEnvFilePaths: --env-file path and --env-file=path, multiple', () => {
  assert.deepEqual(collectEnvFilePaths(['--env-file', 'a.env']), ['a.env']);
  assert.deepEqual(collectEnvFilePaths(['--env-file=b.env']), ['b.env']);
  assert.deepEqual(
    collectEnvFilePaths(['--env-file', 'a.env', 'other', '--env-file=b.env']),
    ['a.env', 'b.env']
  );
});

test('collectEnvFilePaths: missing path throws', () => {
  assert.throws(() => collectEnvFilePaths(['--env-file']), /Missing path/);
  assert.throws(() => collectEnvFilePaths(['--env-file', '--other']), /Missing path/);
  assert.throws(() => collectEnvFilePaths(['--env-file=']), /Missing path/);
});

test('applyEnvFiles: dotenv parse — comments, export, quotes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-env-'));
  try {
    writeFileSync(
      join(dir, '.env'),
      `# comment
BITBUCKET_USERNAME=alice
export BITBUCKET_TOKEN=secret
QUOTED="hello world"
INLINE=value # trailing comment
`
    );
    const env: Record<string, string | undefined> = {};
    applyEnvFiles(['.env'], env, dir);
    assert.equal(env.BITBUCKET_USERNAME, 'alice');
    assert.equal(env.BITBUCKET_TOKEN, 'secret');
    assert.equal(env.QUOTED, 'hello world');
    assert.equal(env.INLINE, 'value');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('applyEnvFiles: does not override existing env; later file wins for new keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-env-'));
  try {
    writeFileSync(join(dir, 'a.env'), 'A=from-a\nB=from-a\nKEEP=from-file\n');
    writeFileSync(join(dir, 'b.env'), 'B=from-b\nC=from-b\n');
    const env: Record<string, string | undefined> = { KEEP: 'from-env' };
    applyEnvFiles(['a.env', 'b.env'], env, dir);
    assert.equal(env.A, 'from-a');
    assert.equal(env.B, 'from-b');
    assert.equal(env.C, 'from-b');
    assert.equal(env.KEEP, 'from-env');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('applyEnvFiles: missing file throws', () => {
  assert.throws(() => applyEnvFiles(['no-such-file.env'], {}, tmpdir()), /Env file not found/);
});

test('loadEnvFilesFromArgv: end-to-end', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-env-'));
  try {
    writeFileSync(join(dir, '.env'), 'BITBUCKET_USERNAME=bob\nBITBUCKET_TOKEN=tok\n');
    const env: Record<string, string | undefined> = {};
    const loaded = loadEnvFilesFromArgv(['--env-file', '.env'], env, dir);
    assert.deepEqual(loaded, ['.env']);
    assert.equal(env.BITBUCKET_USERNAME, 'bob');
    assert.equal(env.BITBUCKET_TOKEN, 'tok');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
