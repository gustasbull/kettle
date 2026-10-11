import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMcp, type McpAuth } from '../apps/worker/mcp.ts';
import { config } from './auth-fixtures.ts';

test('authenticated tools/list stays bounded and fully describes structured results', async () => {
  const unusedOperations = { async execute() { throw new Error('tools/list must not execute operations'); } };
  const auth = {
    config,
    verifier: { async verify() { throw new Error('tools/list must not verify a bearer token'); } },
    operations: unusedOperations,
    creatorOperations: unusedOperations,
    pipelineOperations: unusedOperations,
  } as unknown as McpAuth;
  const response = await handleMcp(new Request(config.resource, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  }), auth);

  assert.equal(response.status, 200);
  const body = await response.json() as { result: { tools: Record<string, any>[] } };
  const catalogBytes = Buffer.byteLength(JSON.stringify(body.result), 'utf8');
  assert.ok(catalogBytes < 64 * 1024,
    `ChatGPT refresh catalog is ${catalogBytes} bytes; keep discovery below 64 KB`);

  assert.ok(body.result.tools.length > 1, 'authenticated discovery must expose account tools');
  for (const tool of body.result.tools) {
    assert.equal(typeof tool.name, 'string');
    assert.equal(typeof tool.title, 'string', `${tool.name} title`);
    assert.equal(typeof tool.description, 'string', `${tool.name} description`);
    assert.equal(tool.inputSchema?.type, 'object', `${tool.name} input schema`);
    assert.equal(tool.outputSchema?.type, 'object', `${tool.name} output schema`);
    assert.deepEqual(tool.securitySchemes, tool._meta?.securitySchemes,
      `${tool.name} security metadata must match at both protocol locations`);
    for (const hint of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
      assert.equal(typeof tool.annotations?.[hint], 'boolean', `${tool.name} ${hint}`);
    }
  }

  const resultTool = body.result.tools.find(tool => tool.name === 'get_project');
  assert.ok(resultTool, 'project result tool');
  assert.deepEqual(resultTool.outputSchema.oneOf.map((branch: Record<string, unknown>) => branch.required), [
    ['ok', 'data'],
    ['ok', 'error'],
  ], 'published schemas must retain the success and failure result envelope');
});
