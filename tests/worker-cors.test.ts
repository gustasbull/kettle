import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleMcp } from '../apps/worker/mcp.ts';
import { withMcpCors } from '../apps/worker/mcp-cors.ts';

const workerUrl = 'https://riff-worker.example/mcp';
const chatGptOrigin = 'https://chatgpt.com';
const request = (init: RequestInit) => {
  const incoming = new Request(workerUrl, init);
  return withMcpCors(incoming, chatGptOrigin, () => handleMcp(incoming));
};

test('configured ChatGPT origin receives a bounded MCP preflight response', async () => {
  const response = await request({
    method: 'OPTIONS',
    headers: {
      Origin: chatGptOrigin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization, content-type',
    },
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), chatGptOrigin);
  assert.equal(response.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  assert.equal(response.headers.get('access-control-allow-headers'),
    'Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id');
  assert.equal(response.headers.get('vary'), 'Origin');
  assert.equal(response.headers.get('access-control-allow-credentials'), null);
});

test('configured ChatGPT origin can read the MCP POST response', async () => {
  const response = await request({
    method: 'POST',
    headers: {
      Origin: chatGptOrigin,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), chatGptOrigin);
  assert.equal(response.headers.get('access-control-expose-headers'), 'MCP-Session-Id');
  assert.equal(response.headers.get('vary'), 'Origin');
  assert.equal(response.headers.get('access-control-allow-credentials'), null);
});

test('unconfigured cross origins cannot preflight or call MCP', async () => {
  for (const request of [
    new Request(workerUrl, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://chatgpt.com.evil.example',
        'Access-Control-Request-Method': 'POST',
      },
    }),
    new Request(workerUrl, {
      method: 'POST',
      headers: {
        Origin: 'https://chatgpt.com.evil.example',
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    }),
  ]) {
    const response = await withMcpCors(request, chatGptOrigin, () => handleMcp(request));
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
});
