import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { unstable_dev } from 'wrangler';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

process.env.WRANGLER_SEND_METRICS = 'false';
const state = await mkdtemp(join(tmpdir(), 'kettle-smoke-'));
const worker = await unstable_dev('scripts/runtime-harness.ts', {
  config: 'wrangler.jsonc', local: true, ip: '127.0.0.1', port: 0, inspectorPort: 0,
  persistTo: state, logLevel: 'error',
  experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false },
});
const client = new Client({ name: 'kettle-smoke', version: '1.0.0' });
try {
  const base = `http://${worker.address}:${worker.port}`;
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json() as { status: string }).status, 'ok');
  const home = await fetch(base);
  const homeHtml = await home.text();
  assert.match(homeHtml, /<title>Riff<\/title>/);
  assert.doesNotMatch(homeHtml, /\bKettle\b/);
  assert.equal((await fetch(`${base}/mcp`, { method: 'POST', headers: { Origin: 'https://untrusted.example' } })).status, 403);
  const authRuntime = await fetch(`${base}/__fixture/auth`, { method: 'POST' });
  assert.equal(authRuntime.status, 200);
  assert.deepEqual(await authRuntime.json(), { status: 'passed', fixture: true });
  const creatorTransport = await fetch(`${base}/__fixture/creator-transport`, { method: 'POST' });
  assert.equal(creatorTransport.status,200);
  assert.deepEqual(await creatorTransport.json(),{status:'passed',fixture:true});
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name), ['kettle_diagnostic']);
  const result = await client.callTool({ name: 'kettle_diagnostic', arguments: {} });
  assert.deepEqual(result.structuredContent, { status: 'ok', contract_version: '1.0.0' });
  for (const name of ['show_riff_welcome', 'save_project', 'get_project', 'get_account_state']) {
    const denied = await client.callTool({ name, arguments: {} });
    assert.equal(denied.isError, true, `${name} must not be exposed`);
  }
  const started = await fetch(`${base}/__fixture/workflow`, { method: 'POST' });
  assert.equal(started.status, 200);
  const { id } = await started.json() as { id: string };
  let completed = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const response = await fetch(`${base}/__fixture/workflow/${id}`);
    const status = await response.json() as { status: string; output?: unknown; error?: unknown };
    if (status.status === 'complete') {
      assert.deepEqual(status.output, { request_id: id, status: 'succeeded', fixture: true });
      completed = true;
      break;
    }
    assert.notEqual(status.status, 'errored', JSON.stringify(status.error));
    await delay(250);
  }
  assert.ok(completed, 'Local workflow must complete within 15 seconds');
  console.log('PASS: workerd health + Riff website, diagnostic-only anonymous MCP initialize/list/call, protected tools unavailable, origin rejection, local Workflow completion; fixture JWT/PKCE/encrypted-cookie roundtrip in workerd.');
} finally {
  await client.close();
  await worker.stop();
  await rm(state, { recursive: true, force: true });
}
