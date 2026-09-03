import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BitbucketApiClient } from '../core/api-client.js';
import { loadConfig } from '../config/index.js';
import { PullRequestHandlers } from '../handlers/pull-request-handlers.js';
import { toolDefinitions } from '../tools/definitions.js';
import { ToolRegistry } from '../tools/registry.js';

const args = { workspace: 'PROJ', repository: 'my-repo' };
const scope = { type: 'REPOSITORY', resourceId: 42 };

function fixture(response: unknown, isServer = true) {
  const calls: Array<{ method: string; path: string }> = [];
  const state = { response, error: undefined as unknown };
  const errorClient = new BitbucketApiClient(loadConfig({
    BITBUCKET_USERNAME: 'test-user', BITBUCKET_TOKEN: 'test-token', BITBUCKET_BASE_URL: 'https://example.invalid',
  }));
  const client = {
    getIsServer: () => isServer,
    makeRequest: async (method: string, path: string) => {
      calls.push({ method, path });
      if (state.error) throw state.error;
      return state.response;
    },
    handleApiError: errorClient.handleApiError.bind(errorClient),
  } as unknown as BitbucketApiClient;
  return { calls, state, handler: new PullRequestHandlers(client, 'https://example.invalid') };
}

test('template: one GET preserves metadata and exact Markdown in separate blocks', async () => {
  const markdown = '### Changes\r\n\r\n- [ ] Review ✅\r\n  \r\n';
  const { handler, calls } = fixture({ enabled: true, scope, description: markdown });
  const result = await handler.handleGetPullRequestTemplate(args);
  assert.deepEqual(calls, [{
    method: 'get', path: '/rest/ui/latest/projects/PROJ/repos/my-repo/pull-request-templates',
  }]);
  assert.deepEqual(result.content, [
    { type: 'text', text: JSON.stringify({ enabled: true, scope }) },
    { type: 'text', text: markdown },
  ]);
  assert.ok(!result.isError);
});

test('template: encodes project/repository components and reads settings again on each call', async () => {
  const { handler, calls, state } = fixture({ enabled: true, scope, description: 'first' });
  const unusualArgs = { workspace: 'PROJ SPACE', repository: 'repo#one' };
  await handler.handleGetPullRequestTemplate(unusualArgs);
  state.response = { enabled: true, scope, description: 'updated' };
  const result = await handler.handleGetPullRequestTemplate(unusualArgs);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].path, '/rest/ui/latest/projects/PROJ%20SPACE/repos/repo%23one/pull-request-templates');
  assert.equal(result.content[1].text, 'updated');
});

test('template: an enabled empty description is not treated as missing', async () => {
  const { handler } = fixture({ enabled: true, scope, description: '' });
  const result = await handler.handleGetPullRequestTemplate(args);
  assert.ok(!result.isError);
  assert.equal(result.content.length, 2);
  assert.equal(result.content[1].text, '');
});

test('template: disabled settings and server-provided scope are preserved without fallback calls', async () => {
  for (const description of [undefined, null, '', 'Stored but disabled']) {
    const projectScope = { type: 'PROJECT', resourceId: 7 };
    const { handler, calls } = fixture({ enabled: false, scope: projectScope, description });
    const result = await handler.handleGetPullRequestTemplate(args);
    assert.ok(!result.isError);
    assert.deepEqual(JSON.parse(result.content[0].text as string), { enabled: false, scope: projectScope });
    assert.equal(result.content.length, typeof description === 'string' ? 2 : 1);
    assert.equal(calls.length, 1);
  }
});

test('template: HTML, malformed JSON shapes and missing enabled descriptions are errors', async () => {
  for (const response of [null, '<html>Log in</html>', {}, { enabled: 'true', description: '' },
    { enabled: true }, { enabled: true, description: null }, { enabled: false, description: 123 }]) {
    const { handler } = fixture(response);
    const result = await handler.handleGetPullRequestTemplate(args);
    assert.equal(result.isError, true);
    assert.match(result.content[0].text as string, /Create pull request form/);
  }
});

test('template: authentication, permission and unavailable endpoint errors stay errors', async () => {
  for (const [status, message] of [[401, /Authentication failed/], [403, /Permission denied/], [404, /Not found/]] as const) {
    const { handler, state } = fixture(undefined);
    state.error = { isAxiosError: true, status, message: 'API error' };
    const result = await handler.handleGetPullRequestTemplate(args);
    assert.equal(result.isError, true);
    assert.match(result.content[0].text as string, message);
  }
});

test('template: invalid required arguments and dot segments fail before requests', async () => {
  const { handler, calls } = fixture(undefined);
  for (const input of [null, {}, { ...args, workspace: '' }, { ...args, repository: 7 },
    { ...args, repository: ' ' }, { ...args, workspace: '..' }, { ...args, repository: '.' }]) {
    await assert.rejects(handler.handleGetPullRequestTemplate(input),
      (error: unknown) => error instanceof McpError && error.code === ErrorCode.InvalidParams);
  }
  assert.equal(calls.length, 0);
});

test('template: Cloud and disabled tool groups cannot list or dispatch the tool', async () => {
  const definition = toolDefinitions.find(tool => tool.name === 'get_pull_request_template');
  assert.ok(definition);
  const { handler, calls } = fixture({ enabled: true, description: 'template' });
  for (const registry of [new ToolRegistry(false, null), new ToolRegistry(true, ['files'])]) {
    registry.register(definition, input => handler.handleGetPullRequestTemplate(input));
    assert.equal(registry.listDefinitions().length, 0);
    await assert.rejects(registry.dispatch(definition.name, args),
      (error: unknown) => error instanceof McpError && error.code === ErrorCode.MethodNotFound);
  }
  assert.equal(calls.length, 0);
  const cloud = fixture(undefined, false);
  assert.equal((await cloud.handler.handleGetPullRequestTemplate(args)).isError, true);
  assert.equal(cloud.calls.length, 0);

  const server = new ToolRegistry(true, ['pr_core']);
  server.register(definition, input => handler.handleGetPullRequestTemplate(input));
  assert.equal(server.listDefinitions()[0].name, definition.name);
  assert.equal((await server.dispatch(definition.name, args)).content[1].text, 'template');
});
