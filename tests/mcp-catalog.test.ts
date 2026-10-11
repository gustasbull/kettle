import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { createOperations, failure } from '../packages/application/operations.ts';
import {
  ACCOUNT_CONTRACT,
  CREATOR_TOOLS,
  DIAGNOSTIC_REGISTRATION,
  PIPELINE_TOOLS,
  PRODUCT_TOOLS,
  PROFILE_REGISTRATION,
  RIFF_CREATOR_TOOLS,
  RIFF_VIDEO_TOOLS,
  WELCOME_REGISTRATION,
} from '../apps/worker/mcp-definitions.ts';
import { handleMcp, type McpAuth } from '../apps/worker/mcp.ts';
import { config } from './auth-fixtures.ts';

const AUTHENTICATED_TOOLS_LIST_BUDGET_BYTES = 256 * 1024;

test('authenticated tools/list publishes every exact output schema within its launch budget', async (t) => {
  const verifier = { async verify() { return null; } };
  const operations = createOperations(verifier, { async call() { throw new Error('not used'); } });
  const unavailable = { async execute() { return failure('UNAVAILABLE'); } };
  const auth = {
    config,
    verifier,
    operations,
    creatorOperations: unavailable,
    pipelineOperations: unavailable,
    riffCreatorOperations: unavailable,
    riffVideoOperations: unavailable,
  } as unknown as McpAuth;
  const startedAt = performance.now();
  const response = await handleMcp(new Request(config.resource, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  }), auth);
  const serialized = await response.text();
  const elapsedMs = performance.now() - startedAt;
  const listing = JSON.parse(serialized) as { result: { tools: Array<{
    name: string;
    outputSchema?: unknown;
    _meta?: { ui?: Record<string, unknown> };
  }> } };
  const expectedSchemas = new Map<string, z.ZodType>([
    ['kettle_diagnostic', DIAGNOSTIC_REGISTRATION.outputSchema],
    ['show_riff_welcome', WELCOME_REGISTRATION.outputSchema],
    ...PRODUCT_TOOLS.map(tool => [tool.name, tool.contract.output] as const),
    ...CREATOR_TOOLS.map(tool => [tool.name, tool.contract.output] as const),
    ...PIPELINE_TOOLS.map(tool => [tool.name, tool.contract.output] as const),
    ...RIFF_CREATOR_TOOLS.map(tool => [tool.name, tool.contract.output] as const),
    ...RIFF_VIDEO_TOOLS.map(tool => [tool.name, tool.contract.output] as const),
    ['get_riff_profile', PROFILE_REGISTRATION.outputSchema],
    ['open_riff', ACCOUNT_CONTRACT.output],
  ]);

  assert.equal(listing.result.tools.length, expectedSchemas.size, 'the schema map covers every published tool');
  for (const tool of listing.result.tools) {
    const schema = expectedSchemas.get(tool.name);
    assert.ok(schema, `missing expected schema fixture for ${tool.name}`);
    assert.ok(tool.outputSchema, `${tool.name} returns structuredContent and must advertise outputSchema`);
    assert.deepEqual(tool.outputSchema, { ...z.toJSONSchema(schema, { reused: 'ref' }), type: 'object' },
      `${tool.name} must publish its complete success/error schema`);
    assert.equal(Object.hasOwn(tool._meta?.ui ?? {}, 'domain'), false,
      `${tool.name} must not publish _meta.ui.domain`);
  }
  const serializedBytes = Buffer.byteLength(serialized, 'utf8');
  assert.ok(serializedBytes <= AUTHENTICATED_TOOLS_LIST_BUDGET_BYTES,
    `authenticated tools/list exceeds ${AUTHENTICATED_TOOLS_LIST_BUDGET_BYTES} bytes`);
  t.diagnostic(`authenticated tools/list: ${serializedBytes} bytes in ${elapsedMs.toFixed(1)} ms; budget ${AUTHENTICATED_TOOLS_LIST_BUDGET_BYTES} bytes`);
});
