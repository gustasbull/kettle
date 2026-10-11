import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  RIFF_HOME_META,
  RIFF_HOME_MIME,
  RIFF_HOME_URI,
  RIFF_HOME_V3_URI,
  RIFF_HOME_V2_URI,
  RIFF_HOME_LEGACY_URI,
  registerRiffHomeResource,
  RIFF_HOME_DOCUMENT,
  riffHomeHtml,
} from '../apps/worker/riff-home-resource.ts';
import { riffHomeFingerprint } from '../apps/panel/generated/riff-home-bundle.ts';
import { panelManifest } from '../apps/panel/generated/panel-manifest.ts';

test('Riff Home keeps the prior URI readable while publishing the current fullscreen MCP App', async (t) => {
  const policy = await import('../packages/contracts/tiktok-image-policy.ts').catch(() => undefined);
  assert.ok(policy, 'shared lightweight TikTok image policy must exist');
  const resourceDomains = ['https://tiktokcdn.com', 'https://*.tiktokcdn.com',
    'https://tiktokcdn-us.com', 'https://*.tiktokcdn-us.com'];
  assert.deepEqual(policy.TIKTOK_IMAGE_RESOURCE_DOMAINS, resourceDomains);
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
  }, {
    name: 'riff-home-v3-compat', uri: RIFF_HOME_V3_URI, mimeType: RIFF_HOME_MIME,
  }, {
    name: 'riff-home-v2-compat', uri: RIFF_HOME_V2_URI, mimeType: RIFF_HOME_MIME,
  }, {
    name: 'riff-home-v1-compat', uri: RIFF_HOME_LEGACY_URI, mimeType: RIFF_HOME_MIME,
  }]);
  const content = (await client.readResource({ uri: RIFF_HOME_URI })).contents[0]!;
  const v3 = (await client.readResource({ uri: RIFF_HOME_V3_URI })).contents[0]!;
  const prior = (await client.readResource({ uri: RIFF_HOME_V2_URI })).contents[0]!;
  const legacy = (await client.readResource({ uri: RIFF_HOME_LEGACY_URI })).contents[0]!;
  assert.ok('text' in content);
  assert.ok('text' in v3);
  assert.ok('text' in prior);
  assert.ok('text' in legacy);
  assert.equal(v3.text, content.text,
    'existing ChatGPT threads can reload their cached v3 resource with the current safe bundle');
  assert.equal(prior.text, content.text,
    'existing ChatGPT threads can reload their cached v2 resource with the current safe bundle');
  assert.equal(legacy.text, content.text,
    'existing ChatGPT threads can reload their cached v1 resource with the current safe bundle');
  assert.equal(content.text, RIFF_HOME_DOCUMENT);
  assert.equal(RIFF_HOME_URI, 'ui://riff/home-v4.html');
  assert.equal(riffHomeFingerprint.resource_version, 'riff-home-v4');
  assert.deepEqual(panelManifest.panels.find(panel => panel.panel === 'riff-home'), riffHomeFingerprint);
  assert.match(content.text as string, new RegExp(`content="${riffHomeFingerprint.bundle_version}" data-resource-version="riff-home-v4"`));
  assert.deepEqual(content._meta, RIFF_HOME_META);
  assert.deepEqual(RIFF_HOME_META['openai/ui'], {
    availableDisplayModes: ['fullscreen'], preferredDisplayMode: 'fullscreen',
  });
  assert.deepEqual(RIFF_HOME_META.ui.csp, {
    connectDomains: [],
    resourceDomains,
    frameDomains: [], baseUriDomains: [],
  });
  assert.deepEqual(RIFF_HOME_META.ui.csp.resourceDomains, policy.TIKTOK_IMAGE_RESOURCE_DOMAINS);
  const html = content.text as string;
  assert.match(html, /Riff Home/);
  assert.equal((html.match(/<script>/g) ?? []).length, 1);
  assert.equal((html.match(/<\/script>/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<script[^>]+src=|sourceMappingURL|Fictional Creator|00000000-0000-4000-8000-000000000001/);
});

test('Riff Home HTML escapes raw-text delimiters', () => {
  const html = riffHomeHtml('const payload = "</ScRiPt><!--";', {
    resource_version: 'riff-home-v4', bundle_version: `sha256:${'a'.repeat(64)}`,
  });
  assert.equal((html.match(/<\/script>/gi) ?? []).length, 1);
  assert.ok(html.includes('<\\/script>'));
  assert.ok(!html.includes('<!--'));
  assert.match(html, new RegExp(`name="riff-bundle-version" content="sha256:${'a'.repeat(64)}" data-resource-version="riff-home-v4"`));
});
