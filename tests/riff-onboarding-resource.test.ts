import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  RIFF_ONBOARDING_META,
  RIFF_ONBOARDING_MIME,
  RIFF_ONBOARDING_URI,
  RIFF_ONBOARDING_V4_URI,
  RIFF_ONBOARDING_V3_URI,
  RIFF_ONBOARDING_V2_URI,
  RIFF_ONBOARDING_LEGACY_URI,
  registerRiffOnboardingResource,
  riffOnboardingHtml,
} from '../apps/worker/riff-onboarding-resource.ts';

test('Riff onboarding is one static, inline-only, empty-network MCP App', async (t) => {
  assert.equal(RIFF_ONBOARDING_URI, 'ui://riff/onboarding-v5.html');
  const server = new McpServer({ name: 'riff-onboarding-fixture', version: '1' });
  registerRiffOnboardingResource(server);
  const client = new Client({ name: 'fixture-client', version: '1' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });

  const listed = await client.listResources();
  assert.deepEqual(listed.resources.map(({ name, uri, mimeType }) => ({ name, uri, mimeType })), [{
    name: 'riff-onboarding', uri: RIFF_ONBOARDING_URI, mimeType: RIFF_ONBOARDING_MIME,
  }, {
    name: 'riff-onboarding-v4-compat', uri: RIFF_ONBOARDING_V4_URI, mimeType: RIFF_ONBOARDING_MIME,
  }, {
    name: 'riff-onboarding-v3-compat', uri: RIFF_ONBOARDING_V3_URI, mimeType: RIFF_ONBOARDING_MIME,
  }, {
    name: 'riff-onboarding-v2-compat', uri: RIFF_ONBOARDING_V2_URI, mimeType: RIFF_ONBOARDING_MIME,
  }, {
    name: 'riff-onboarding-v1-compat', uri: RIFF_ONBOARDING_LEGACY_URI, mimeType: RIFF_ONBOARDING_MIME,
  }]);
  const content = (await client.readResource({ uri: RIFF_ONBOARDING_URI })).contents[0]!;
  const compatible = (await client.readResource({ uri: RIFF_ONBOARDING_V3_URI })).contents[0]!;
  assert.deepEqual(content._meta, RIFF_ONBOARDING_META);
  assert.deepEqual(RIFF_ONBOARDING_META['openai/ui'], {
    availableDisplayModes: ['inline'], preferredDisplayMode: 'inline',
  });
  assert.deepEqual(RIFF_ONBOARDING_META.ui.csp, {
    connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [],
  });
  assert.ok('text' in content);
  assert.ok('text' in compatible);
  assert.equal(compatible.text, content.text);
  for (const alias of [RIFF_ONBOARDING_V4_URI, RIFF_ONBOARDING_V2_URI, RIFF_ONBOARDING_LEGACY_URI]) {
    const prior = (await client.readResource({ uri: alias })).contents[0]!;
    assert.ok('text' in prior);
    assert.equal(prior.text, content.text);
  }
  const html = content.text as string;
  assert.match(html, /Welcome to Riff/);
  assert.match(html, /Unlock your viral potential/);
  assert.equal((html.match(/<script>/g) ?? []).length, 1);
  assert.equal((html.match(/<\/script>/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<script[^>]+src=|sourceMappingURL|account_id|display_name/);
});

test('Riff onboarding HTML escapes raw-text delimiters', () => {
  const html = riffOnboardingHtml('const payload = "</ScRiPt><!--";', {
    resource_version: 'riff-onboarding-v5', bundle_version: `sha256:${'a'.repeat(64)}`,
  });
  assert.equal((html.match(/<\/script>/gi) ?? []).length, 1);
  assert.ok(html.includes('<\\/script>'));
  assert.ok(!html.includes('<!--'));
  assert.match(html, /name="riff-bundle-version"/);
});
