import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadConfig } from '../config/index.js';
import { BitbucketApiClient, tlsAgentOptions } from '../core/api-client.js';

const dir = mkdtempSync(join(tmpdir(), 'bb-mcp-tls-'));
const cert = join(dir, 'client.pem');
const key = join(dir, 'client.key');
const ca = join(dir, 'ca.pem');
writeFileSync(cert, 'CERT');
writeFileSync(key, 'KEY');
writeFileSync(ca, 'CA');

const base = { BITBUCKET_USERNAME: 'u', BITBUCKET_BASE_URL: 'https://bitbucket.example.com' };

test('loadConfig: reads TLS env vars; verification on by default', () => {
  const tls = loadConfig({ ...base, BITBUCKET_TLS_CLIENT_CERT: cert, BITBUCKET_TLS_CLIENT_KEY: key }).tls;
  assert.equal(tls.clientCertPath, cert);
  assert.equal(tls.clientKeyPath, key);
  assert.equal(tls.caCertPath, undefined);
  assert.equal(tls.rejectUnauthorized, true);
  assert.equal(loadConfig({ ...base, BITBUCKET_TLS_REJECT_UNAUTHORIZED: 'false' }).tls.rejectUnauthorized, false);
});

test('tlsAgentOptions: reads cert, key and CA files', () => {
  const opts = tlsAgentOptions({ clientCertPath: cert, clientKeyPath: key, caCertPath: ca, rejectUnauthorized: true });
  assert.equal(opts.cert?.toString(), 'CERT');
  assert.equal(opts.key?.toString(), 'KEY');
  assert.equal(opts.ca?.toString(), 'CA');
  assert.equal('rejectUnauthorized' in opts, false);
});

test('tlsAgentOptions: no TLS config yields no options', () => {
  assert.deepEqual(tlsAgentOptions({ rejectUnauthorized: true }), {});
});

test('tlsAgentOptions: certificate without key (and vice versa) fails', () => {
  assert.throws(() => tlsAgentOptions({ clientCertPath: cert, rejectUnauthorized: true }), /both a client certificate/);
  assert.throws(() => tlsAgentOptions({ clientKeyPath: key, rejectUnauthorized: true }), /both a client certificate/);
});

test('tlsAgentOptions: missing file fails with its path', () => {
  const missing = join(dir, 'nope.pem');
  assert.throws(
    () => tlsAgentOptions({ clientCertPath: missing, clientKeyPath: key, rejectUnauthorized: true }),
    new RegExp(`Client certificate file not found: ${missing}`)
  );
});

function axiosDefaults(client: BitbucketApiClient): any {
  return (client as any).axiosInstance.defaults;
}

test('BitbucketApiClient: mTLS-only is Server mode with no Authorization header', () => {
  const client = new BitbucketApiClient(
    loadConfig({ ...base, BITBUCKET_TLS_CLIENT_CERT: cert, BITBUCKET_TLS_CLIENT_KEY: key })
  );
  const defaults = axiosDefaults(client);
  assert.equal(client.getIsServer(), true);
  assert.equal(defaults.headers.Authorization, undefined);
  assert.equal(defaults.auth, undefined);
  assert.equal(defaults.httpsAgent.options.cert.toString(), 'CERT');
  assert.equal(defaults.httpsAgent.options.key.toString(), 'KEY');
});

test('BitbucketApiClient: mTLS + token sends bearer and client certificate', () => {
  const client = new BitbucketApiClient(
    loadConfig({ ...base, BITBUCKET_TOKEN: 't', BITBUCKET_TLS_CLIENT_CERT: cert, BITBUCKET_TLS_CLIENT_KEY: key })
  );
  const defaults = axiosDefaults(client);
  assert.equal(defaults.headers.Authorization, 'Bearer t');
  assert.equal(defaults.httpsAgent.options.cert.toString(), 'CERT');
});

test('BitbucketApiClient: Cloud app password is unchanged by TLS support', () => {
  const client = new BitbucketApiClient(loadConfig({ BITBUCKET_USERNAME: 'u', BITBUCKET_APP_PASSWORD: 'p' }));
  const defaults = axiosDefaults(client);
  assert.equal(client.getIsServer(), false);
  assert.deepEqual(defaults.auth, { username: 'u', password: 'p' });
  assert.equal(defaults.httpsAgent.options.cert, undefined);
});
