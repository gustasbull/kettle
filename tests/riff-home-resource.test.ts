import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  RIFF_HOME_META,
  RIFF_HOME_MIME,
  RIFF_HOME_URI,
  registerRiffHomeResource,
  riffHomeHtml,
} from '../apps/worker/riff-home-resource.ts';

test('Riff Home is one static, fullscreen-only, empty-network MCP App', async (t) => {
  const server = new McpServer({ name: 'riff-home-fixture', version: '1' });
  registerRiffHomeResource(server);
  const client = new Client({ name: 'fixture-client', version: '1' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });

  const listed = await client.listResources();
  assert.deepEqual(listed.resources.map(({ name, uri, mimeType }) => ({ name, uri, mimeType })), [{
    name: 'riff-home', uri: RIFF_HOME_URI, mimeType: RIFF_HOME_MIME,
  }]);
  const content = (await client.readResource({ uri: RIFF_HOME_URI })).contents[0]!;
  assert.deepEqual(content._meta, RIFF_HOME_META);
  assert.deepEqual(RIFF_HOME_META['openai/ui'], {
    availableDisplayModes: ['fullscreen'], preferredDisplayMode: 'fullscreen',
  });
  assert.deepEqual(RIFF_HOME_META.ui.csp, {
    connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [],
  });
  assert.ok('text' in content);
  const html = content.text as string;
  assert.match(html, /Riff Home/);
  assert.equal((html.match(/<script>/g) ?? []).length, 1);
  assert.equal((html.match(/<\/script>/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<script[^>]+src=|sourceMappingURL|Fictional Creator|00000000-0000-4000-8000-000000000001/);
});

test('Riff Home HTML escapes raw-text delimiters', () => {
  const html = riffHomeHtml('const payload = "</ScRiPt><!--";');
  assert.equal((html.match(/<\/script>/gi) ?? []).length, 1);
  assert.ok(html.includes('<\\/script>'));
  assert.ok(!html.includes('<!--'));
});
