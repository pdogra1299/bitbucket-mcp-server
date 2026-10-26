import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { Readable } from 'node:stream';
import { pack as tarPack } from 'tar-stream';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { encodeRepoPath, encodeSegment, isSameOrigin } from '../core/paths.js';
import { compileSafeRegex, hasNestedUnboundedQuantifier } from '../core/safe-regex.js';
import { resolveAttachmentFile } from '../core/local-files.js';
import { redactSecrets, summarizeError } from '../core/redact.js';
import { isProtectedBranch, normalizeBranchName } from '../core/access.js';
import { scanContent, scanFilesConcurrent } from '../core/scan.js';
import { LineScanner, RepoSnapshotStore } from '../core/snapshot.js';
import { ToolRegistry } from '../tools/registry.js';
import { toolDefinitions } from '../tools/definitions.js';
import { loadConfig } from '../config/index.js';
import {
  isAttachmentId,
  isCommitId,
  isGetPullRequestArgs,
  isGrepArgs,
  isIdent,
  isManageAttachmentsArgs,
  isSearchCodeArgs,
} from '../tools/guards.js';
import type { BitbucketApiClient } from '../core/api-client.js';

// Security regression tests for the hardening release: path-segment
// steering, attachment-path exfiltration, credential leakage in logs, regex
// denial of service, read-only / disabled-tool enforcement, protected
// branches, and cross-origin pagination.

const isInvalidParams = (e: unknown): boolean => e instanceof McpError && e.code === ErrorCode.InvalidParams;

// ── URL path construction ────────────────────────────────────────────────────

test('encodeSegment: route-changing values are rejected or neutralized', () => {
  assert.throws(() => encodeSegment(''), isInvalidParams);
  assert.throws(() => encodeSegment('.'), isInvalidParams);
  assert.throws(() => encodeSegment('..'), isInvalidParams);
  assert.throws(() => encodeSegment('a\nb'), isInvalidParams);
  // Encoded, so they stay inside the segment instead of re-routing.
  assert.equal(encodeSegment('PROJ/../../../../admin/users'), 'PROJ%2F..%2F..%2F..%2F..%2Fadmin%2Fusers');
  assert.equal(encodeSegment('PROJ?limit=1000&x='), 'PROJ%3Flimit%3D1000%26x%3D');
  assert.equal(encodeSegment('PROJ#frag'), 'PROJ%23frag');
  assert.equal(encodeSegment('..%2F..%2Fadmin'), '..%252F..%252Fadmin');
  assert.equal(encodeSegment('{3f2a-uuid}'), '%7B3f2a-uuid%7D');
  assert.equal(encodeSegment('feature/x y'), 'feature%2Fx%20y');
});

test('encodeRepoPath: per-segment encoding, `..` rejected, `.`/empty dropped', () => {
  assert.equal(encodeRepoPath('src/a b/c#d.ts'), 'src/a%20b/c%23d.ts');
  assert.equal(encodeRepoPath('./src//x.ts'), 'src/x.ts');
  assert.throws(() => encodeRepoPath('src/../../etc/passwd'), isInvalidParams);
  assert.throws(() => encodeRepoPath('..'), isInvalidParams);
});

test('isSameOrigin: only same scheme+host+port continuations are followed', () => {
  assert.equal(isSameOrigin('https://api.bitbucket.org/2.0', 'https://api.bitbucket.org/2.0/repositories/x?page=2'), true);
  assert.equal(isSameOrigin('https://api.bitbucket.org/2.0', 'https://evil.example/next'), false);
  assert.equal(isSameOrigin('https://api.bitbucket.org/2.0', 'http://api.bitbucket.org/2.0/x'), false);
  assert.equal(isSameOrigin('https://api.bitbucket.org/2.0', 'not a url'), false);
});

// ── Guards ───────────────────────────────────────────────────────────────────

test('identifier guards: accept Bitbucket keys/slugs, reject path/query metacharacters', () => {
  for (const ok of ['PROJ', 'my-repo', 'my.repo_2', '~john.doe', '~john@corp', '{a1b2-c3d4}', 'Mixed.Case', '.github', '_archive', '-old']) {
    assert.equal(isIdent(ok), true, ok);
  }
  for (const bad of ['', 'PROJ/../admin', 'repo?x=1', 'repo#f', 'a b', 'a%2Fb', '.', '..', 'a\\b', 42, null]) {
    assert.equal(isIdent(bad), false, String(bad));
  }
  assert.equal(isCommitId('deadbeef'), true);
  assert.equal(isCommitId('a'.repeat(40)), true);
  assert.equal(isCommitId('abc'), false);
  assert.equal(isCommitId('deadbeef/../x'), false);
  assert.equal(isAttachmentId('123'), true);
  assert.equal(isAttachmentId(123), true);
  assert.equal(isAttachmentId('123/../../x'), false);
  assert.equal(isAttachmentId('12?a'), false);
});

test('tool guards apply identifier validation to workspace/repository/commit/attachment', () => {
  assert.equal(isGetPullRequestArgs({ workspace: 'PROJ', repository: 'repo', pull_request_id: 1 }), true);
  assert.equal(isGetPullRequestArgs({ workspace: 'PROJ/../../admin', repository: 'repo', pull_request_id: 1 }), false);
  assert.equal(isGetPullRequestArgs({ workspace: 'PROJ', repository: 'repo?limit=1000', pull_request_id: 1 }), false);
  assert.equal(isGrepArgs({ workspace: 'PROJ', repository: 'repo', query: 'x' }), true);
  assert.equal(isGrepArgs({ workspace: 'PROJ#x', repository: 'repo', query: 'x' }), false);
  assert.equal(isSearchCodeArgs({ workspace: 'PROJ', query: 'foo' }), true);
  assert.equal(isSearchCodeArgs({ workspace: 'PROJ', repository: '../x', query: 'foo' }), false);
  assert.equal(isManageAttachmentsArgs({ workspace: 'P', repository: 'r', action: 'delete', attachment_id: '7' }), true);
  assert.equal(isManageAttachmentsArgs({ workspace: 'P', repository: 'r', action: 'delete', attachment_id: '7/../../x' }), false);
});

// ── Regex denial of service ──────────────────────────────────────────────────

test('hasNestedUnboundedQuantifier: flags undelimited variable-width nesting only', () => {
  for (const bad of ['(a+)+$', '(a*)*', '(\\w+\\s*)*', '(?:\\d+)+', '((a)+)+', '(a?)*', '(a+){2,}', '(a{1,3})+', '(a+|b)+', '(\\w+.)+']) {
    assert.equal(hasNestedUnboundedQuantifier(bad), true, bad);
  }
  for (const ok of [
    '(a+)b+', '(a|b)+', '(?:foo|bar)+', '[a-z+]+', '\\(a+\\)+', '(a+)?', '(a+){1}', '(a+){3}', 'a{2,4}b{3}',
    '(?<name>\\w)+', '(?=x+)y+',
    // Common legitimate shapes: iterations are delimited by an unquantified literal, or fixed-width.
    '(\\d{1,3}\\.){3}\\d{1,3}', '\\d+(\\.\\d+)*', 'v\\d+(\\.\\d+){2}', '(\\w+/)+\\w+', '([\\w-]+\\.)+\\w+',
    '[a-z]+(-[a-z]+)*', '(foo|bar\\d+)+', '(a{2})+', '(\\w+\\s*,)+', '(?:[^,]+,)+',
  ]) {
    assert.equal(hasNestedUnboundedQuantifier(ok), false, ok);
  }
});

test('long lines are counted, not regex-scanned (bounds per-line cost)', () => {
  const stats = { longLinesSkipped: 0 };
  const hits = scanContent('short needle\n' + 'x'.repeat(50) + ' needle\nneedle\n', /needle/, undefined, { maxScanLineLength: 20, stats });
  assert.deepEqual(hits.map(h => h.line), [1, 3]);
  assert.equal(stats.longLinesSkipped, 1);

  const collected: Array<{ line: number }> = [];
  const scanner = new LineScanner(/needle/, 0, 300, m => collected.push(m), 20);
  scanner.feed('needle\n' + 'y'.repeat(40) + 'needle\n');
  scanner.end();
  assert.equal(scanner.matchCount, 1);
  assert.equal(scanner.longLinesSkipped, 1);
});

test('compileSafeRegex: rejects exponential patterns (static + probe), accepts normal ones', () => {
  const opts = { maxLength: 512, probeTimeoutMs: 100 };
  const nested = compileSafeRegex('(a+)+$', opts);
  assert.equal(nested.ok, false);
  assert.match(!nested.ok ? nested.reason : '', /quantified group/);

  // Star height 1 but exponential via overlapping alternation — only the probe catches this.
  const overlapping = compileSafeRegex('(a|aa)+$', opts);
  assert.equal(overlapping.ok, false);
  assert.match(!overlapping.ok ? overlapping.reason : '', /adversarial|backtracks/);

  assert.equal(compileSafeRegex('\\1', opts).ok, false);
  assert.equal(compileSafeRegex('a'.repeat(513), opts).ok, false);
  assert.equal(compileSafeRegex('(', opts).ok, false);

  const t0 = performance.now();
  const ok = compileSafeRegex('^\\s*(import|export)\\s+.*from\\s+[\'"][^\'"]+[\'"]', { ...opts, flags: 'i' });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.regex.test('  import { x } from "./y"'), true);
  assert.ok(performance.now() - t0 < 100, 'benign pattern compiles fast');
});

test('scanFilesConcurrent: wall-clock deadline stops the scan and marks it', async () => {
  const cfg = loadConfig({ BITBUCKET_USERNAME: 'u', BITBUCKET_TOKEN: 't' }).scan;
  const outcome = await scanFilesConcurrent({
    files: ['a', 'b', 'c', 'd'],
    parallelism: 1,
    scanConfig: cfg,
    fetchContent: async () => {
      await new Promise(r => setTimeout(r, 30));
      return 'needle\n';
    },
    contentRe: /needle/,
    deadlineAt: Date.now() + 40,
  });
  assert.equal(outcome.timed_out, true);
  assert.ok(outcome.results.length >= 1 && outcome.results.length < 4);
});

test('snapshot grep: an expired deadline returns partial results with SCAN_TIMEOUT, nothing retained', async () => {
  const p = tarPack();
  p.entry({ name: 'a.ts' }, Buffer.from('needle\n'));
  p.entry({ name: 'b.ts' }, Buffer.from('needle\n'));
  p.finalize();
  const chunks: Buffer[] = [];
  for await (const c of p as any) chunks.push(c as Buffer);
  const archive = gzipSync(Buffer.concat(chunks));
  const config = loadConfig({ BITBUCKET_USERNAME: 'u', BITBUCKET_TOKEN: 't', BITBUCKET_REF_RESOLVE_TTL_MS: '0' });
  const client = {
    getConfig: () => config,
    getIsServer: () => true,
    resolveRef: async () => 'a'.repeat(40),
    streamArchive: async () => ({ stream: Readable.from(archive), release: () => {} }),
    makeRequest: async () => {
      throw { status: 404, message: 'nf', isAxiosError: true };
    },
  } as unknown as BitbucketApiClient;
  const store = new RepoSnapshotStore(client);
  const out = await store.grep({ project: 'P', repository: 'r', regex: /needle/, maxMatches: 10, contextLines: 0, deadlineAt: Date.now() - 1 });
  assert.ok(out.warnings.some(w => w.startsWith('SCAN_TIMEOUT')));
  assert.equal(store.usage().snapshots, 0, 'partial scans are never committed to the cache');
});

// ── Attachment uploads ───────────────────────────────────────────────────────

test('resolveAttachmentFile: disabled without a root; confined to the root; regular files only; size cap; one generic message', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bb-att-root-'));
  const outside = await mkdtemp(join(tmpdir(), 'bb-att-outside-'));
  try {
    await writeFile(join(root, 'ok.png'), Buffer.alloc(10));
    await writeFile(join(root, 'big.bin'), Buffer.alloc(1024 * 1024 + 1));
    await mkdir(join(root, 'dir'));
    await writeFile(join(outside, 'secret.txt'), 'token');
    await symlink(join(outside, 'secret.txt'), join(root, 'link-out'));

    const disabled = await resolveAttachmentFile({ uploadRoot: undefined, maxUploadMb: 1, maxDownloadMb: 1 }, join(root, 'ok.png'));
    assert.equal(disabled.ok, false);
    assert.match(!disabled.ok ? disabled.error : '', /BITBUCKET_ATTACHMENT_ROOT/);

    const cfg = { uploadRoot: root, maxUploadMb: 1, maxDownloadMb: 1 };
    const ok = await resolveAttachmentFile(cfg, 'ok.png');
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.file.size, 10);
      assert.equal(ok.file.name, 'ok.png');
      assert.ok(ok.file.ino > 0 && ok.file.dev >= 0, 'inode identity is captured for the open-time re-check');
    }
    const okAbs = await resolveAttachmentFile(cfg, join(root, 'ok.png'));
    assert.equal(okAbs.ok, true);

    const rejected = await Promise.all([
      resolveAttachmentFile(cfg, '/proc/self/environ'),
      resolveAttachmentFile(cfg, join(outside, 'secret.txt')),
      resolveAttachmentFile(cfg, '../' + outside.split('/').pop() + '/secret.txt'),
      resolveAttachmentFile(cfg, 'link-out'),
      resolveAttachmentFile(cfg, 'dir'),
      resolveAttachmentFile(cfg, 'big.bin'),
      resolveAttachmentFile(cfg, 'does-not-exist.png'),
      resolveAttachmentFile(cfg, '.'),
    ]);
    const messages = new Set<string>();
    for (const r of rejected) {
      assert.equal(r.ok, false);
      if (!r.ok) messages.add(r.error);
    }
    assert.equal(messages.size, 1, 'every rejection uses the same message (no existence oracle)');
    const [msg] = [...messages];
    assert.ok(!msg.includes('secret') && !msg.includes('environ') && !msg.includes('does-not-exist'));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

// ── Log hygiene ──────────────────────────────────────────────────────────────

test('summarizeError / redactSecrets never emit credentials', () => {
  const axiosLike = {
    name: 'AxiosError',
    message: 'Request failed with status code 500',
    status: 500,
    code: 'ERR_BAD_RESPONSE',
    config: { headers: { Authorization: 'Bearer SECRET-TOKEN-123' } },
  };
  const summary = summarizeError(axiosLike);
  assert.ok(!summary.includes('SECRET-TOKEN-123'));
  assert.match(summary, /HTTP 500/);
  assert.match(summary, /ERR_BAD_RESPONSE/);
  assert.equal(redactSecrets('Authorization: Bearer abcdefghijkl'), 'Authorization: [REDACTED]');
  assert.equal(redactSecrets('{"authorization":"Basic dTphcHAtcGFzc3dvcmQ="}'), '{"authorization":"[REDACTED]"}');
  assert.equal(redactSecrets('https://h/x?access_token=abc123&y=1'), 'https://h/x?access_token=[REDACTED]&y=1');
  assert.equal(summarizeError('plain string'), 'plain string');
});

// ── Access policy ────────────────────────────────────────────────────────────

test('isProtectedBranch: exact names, globs and every refs/heads spelling', () => {
  const list = ['main', 'release/*'];
  assert.equal(isProtectedBranch('main', list), true);
  assert.equal(isProtectedBranch('refs/heads/main', list), true);
  assert.equal(isProtectedBranch('heads/main', list), true, 'git DWIM spelling cannot dodge the list');
  assert.equal(isProtectedBranch('refs/heads/heads/main', list), true);
  assert.equal(normalizeBranchName('refs/heads/release/1.0'), 'release/1.0');
  assert.equal(isProtectedBranch('release/2026.10', list), true);
  assert.equal(isProtectedBranch('feature/main', list), false);
  assert.equal(isProtectedBranch('main', []), false);
});

test('ToolRegistry: read-only hides AND refuses mutating tools; disabled tools are gone; annotations are listed', async () => {
  const noop = async () => ({ content: [] });
  const build = (access: { readOnly: boolean; disabledTools: string[] }) => {
    const reg = new ToolRegistry(true, null, { ...access, protectedBranches: [] });
    for (const d of toolDefinitions) reg.register(d, noop);
    return reg;
  };
  const all = build({ readOnly: false, disabledTools: [] });
  assert.equal(all.listDefinitions().length, 25);
  const getPr = all.listDefinitions().find(t => t.name === 'get_pull_request');
  assert.equal(getPr?.annotations.readOnlyHint, true);
  assert.equal(all.listDefinitions().find(t => t.name === 'merge_pull_request')?.annotations.destructiveHint, true);

  const ro = build({ readOnly: true, disabledTools: ['grep'] });
  const names = ro.listDefinitions().map(t => t.name);
  for (const hidden of ['create_pull_request', 'update_pull_request', 'merge_pull_request', 'decline_pull_request', 'add_comment', 'manage_comment', 'set_review_status', 'delete_branch', 'grep']) {
    assert.equal(names.includes(hidden), false, hidden);
  }
  for (const kept of ['get_pull_request', 'list_pull_requests', 'get_pull_request_diff', 'get_file_content', 'search_code', 'manage_attachments']) {
    assert.equal(names.includes(kept), true, kept);
  }
  await assert.rejects(ro.dispatch('merge_pull_request', {}), (e: unknown) => e instanceof McpError && e.code === ErrorCode.MethodNotFound);
  await assert.rejects(ro.dispatch('grep', {}), (e: unknown) => e instanceof McpError && e.code === ErrorCode.MethodNotFound);
  const mutating = toolDefinitions.filter(d => d.mutates).map(d => d.name).sort();
  assert.deepEqual(mutating, ['add_comment', 'create_pull_request', 'decline_pull_request', 'delete_branch', 'manage_comment', 'merge_pull_request', 'set_review_status', 'update_pull_request']);
});

test('config: access and attachment settings parse from env', () => {
  const cfg = loadConfig({
    BITBUCKET_USERNAME: 'u',
    BITBUCKET_TOKEN: 't',
    BITBUCKET_READ_ONLY: 'true',
    BITBUCKET_DISABLED_TOOLS: 'grep, search_code',
    BITBUCKET_PROTECTED_BRANCHES: 'main,release/*',
    BITBUCKET_ATTACHMENT_ROOT: '/srv/uploads',
    BITBUCKET_ATTACHMENT_MAX_UPLOAD_MB: '5',
    BITBUCKET_GREP_TIMEOUT_MS: '5000',
  });
  assert.equal(cfg.access.readOnly, true);
  assert.deepEqual(cfg.access.disabledTools, ['grep', 'search_code']);
  assert.deepEqual(cfg.access.protectedBranches, ['main', 'release/*']);
  assert.equal(cfg.attachments.uploadRoot, '/srv/uploads');
  assert.equal(cfg.attachments.maxUploadMb, 5);
  assert.equal(cfg.grep.scanTimeoutMs, 5000);
  const defaults = loadConfig({ BITBUCKET_USERNAME: 'u', BITBUCKET_TOKEN: 't' });
  assert.equal(defaults.access.readOnly, false);
  assert.equal(defaults.attachments.uploadRoot, undefined, 'uploads are opt-in');
});
