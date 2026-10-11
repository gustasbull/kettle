import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { handleMcp } from '../apps/worker/mcp.ts';
import { createOperations, failure } from '../packages/application/operations.ts';
import { riffCreatorContracts } from '../packages/contracts/riff-creator.ts';
import { oauthScopes } from '../packages/auth/index.ts';
import { config, fixtureAuth } from './auth-fixtures.ts';

test('Riff creator entry and recents are authenticated MCP tools usable by Home', async () => {
  const identity = await fixtureAuth(); const token = await identity.token();
  const operations = createOperations(identity.verifier, { async call() { throw new Error('not used'); } });
  const calls: Array<{ operation: string; token: string | null; input: unknown }> = [];
  const riffCreatorOperations = { async execute(operation: string, credential: string | null, input: unknown) {
    calls.push({ operation, token: credential, input });
    if (operation === 'start_riff_creator') return failure('UNAVAILABLE');
    if (operation === 'get_riff_creator_start') return failure('NOT_FOUND');
    return { ok: true as const, data: { work: [] } };
  } };
  const auth = { config, verifier: identity.verifier, operations, riffCreatorOperations } as any;
  const rpc = async (method: string, params: unknown) => handleMcp(new Request(config.resource, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }), auth);
  const listing = await (await rpc('tools/list', {})).json() as { result: { tools: Record<string, any>[] } };
  for (const name of ['start_riff_creator', 'get_riff_creator_start', 'list_riff_work'] as const) {
    const tool = listing.result.tools.find(candidate => candidate.name === name); assert.ok(tool, name);
    assert.deepEqual(tool.inputSchema, { ...z.toJSONSchema(riffCreatorContracts[name].input), type: 'object' });
    if (name !== 'list_riff_work') assert.equal(tool.outputSchema, undefined,
      'the large job result stays out of launch discovery while runtime validation remains authoritative');
    else assert.deepEqual(tool.outputSchema, { ...z.toJSONSchema(riffCreatorContracts[name].output), type: 'object' });
    assert.deepEqual(tool.securitySchemes, [{ type: 'oauth2', scopes: [...oauthScopes] }]);
    assert.equal(tool.annotations.readOnlyHint, name !== 'start_riff_creator');
    assert.equal(tool.annotations.openWorldHint, name === 'start_riff_creator');
    assert.deepEqual(tool._meta.ui?.visibility, ['model', 'app'], `${name} must be callable from Riff Home`);
    if (name === 'start_riff_creator') {
      assert.equal(tool._meta.ui.resourceUri, 'ui://kettle/creator-pipeline-v3.html',
        'a direct @Riff chat start must attach the live creator workflow');
    } else assert.equal(tool._meta.ui?.resourceUri, undefined);
  }
  const response = await (await rpc('tools/call', { name: 'list_riff_work', arguments: { limit: 4 } })).json() as {
    result: { structuredContent: unknown; isError?: boolean };
  };
  assert.deepEqual(response.result.structuredContent, { ok: true, data: { work: [] } });
  assert.equal(response.result.isError, undefined);
  assert.deepEqual(calls, [{ operation: 'list_riff_work', token, input: { limit: 4 } }]);
  const lookupInput = {
    request_id: '00000000-0000-4000-8000-000000000701', source_url: 'https://vm.tiktok.com/ZN8kT85EE/',
  };
  const missing = await (await rpc('tools/call', { name: 'get_riff_creator_start', arguments: lookupInput })).json() as {
    result: { structuredContent: unknown; isError?: boolean };
  };
  assert.equal(missing.result.isError, true);
  assert.deepEqual(missing.result.structuredContent, failure('NOT_FOUND'));
  const failed = await (await rpc('tools/call', { name: 'start_riff_creator', arguments: {
    request_id: '00000000-0000-4000-8000-000000000700', source_url: 'https://www.tiktok.com/@fixture',
  } })).json() as { result: { structuredContent: unknown; isError?: boolean } };
  assert.equal(failed.result.isError, true);
  assert.deepEqual(failed.result.structuredContent, failure('UNAVAILABLE'),
    'retry semantics must remain machine-readable to the bound MCP App');
  assert.deepEqual(calls, [
    { operation: 'list_riff_work', token, input: { limit: 4 } },
    { operation: 'get_riff_creator_start', token, input: lookupInput },
    { operation: 'start_riff_creator', token, input: {
      request_id: '00000000-0000-4000-8000-000000000700', source_url: 'https://www.tiktok.com/@fixture',
    } },
  ]);
});
