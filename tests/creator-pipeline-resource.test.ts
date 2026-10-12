import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { creatorPipelineHtml, registerCreatorPipelineResource, CREATOR_PIPELINE_URI,
  CREATOR_PIPELINE_V6_URI, CREATOR_PIPELINE_V5_URI, CREATOR_PIPELINE_V4_URI, CREATOR_PIPELINE_V3_URI, CREATOR_PIPELINE_V2_URI,
  CREATOR_PIPELINE_MIME, CREATOR_PIPELINE_META, CREATOR_PIPELINE_DOCUMENT } from '../apps/worker/creator-pipeline-resource.ts';
import { creatorPipelineFingerprint } from '../apps/panel/generated/creator-pipeline-bundle.ts';
import { panelManifest } from '../apps/panel/generated/panel-manifest.ts';

test('Creator pipeline resource is a static bundled MCP App with narrowly scoped media metadata', async t => {
  const policy = await import('../packages/contracts/tiktok-image-policy.ts').catch(() => undefined);
  assert.ok(policy, 'shared lightweight TikTok image policy must exist');
  const resourceDomains = ['https://tiktokcdn.com', 'https://*.tiktokcdn.com',
    'https://tiktokcdn-us.com', 'https://*.tiktokcdn-us.com'];
  assert.deepEqual(policy.TIKTOK_IMAGE_RESOURCE_DOMAINS, resourceDomains);
  const server = new McpServer({name:'resource-fixture',version:'1'});
  registerCreatorPipelineResource(server);
  const client = new Client({name:'fixture-client',version:'1'});
  const [a,b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  t.after(async()=>{ await client.close(); await server.close(); });
  const list = await client.listResources();
  assert.equal(list.resources.length,6);
  assert.equal(list.resources[0]!.uri,CREATOR_PIPELINE_URI);
  assert.equal(list.resources[0]!.title,'Riff creator workflow');
  assert.equal(list.resources[0]!.mimeType,CREATOR_PIPELINE_MIME);
  assert.equal(list.resources[1]!.uri,CREATOR_PIPELINE_V6_URI);
  assert.equal(list.resources[2]!.uri,CREATOR_PIPELINE_V5_URI);
  assert.equal(list.resources[3]!.uri,CREATOR_PIPELINE_V4_URI);
  assert.equal(list.resources[4]!.uri,CREATOR_PIPELINE_V3_URI);
  assert.equal(list.resources[5]!.uri,CREATOR_PIPELINE_V2_URI);
  assert.deepEqual(list.resources[0]!._meta,CREATOR_PIPELINE_META);
  const result = await client.readResource({uri:CREATOR_PIPELINE_URI});
  assert.equal(result.contents.length,1);
  const content = result.contents[0]!;
  assert.equal(content.mimeType,CREATOR_PIPELINE_MIME);
  assert.deepEqual(content._meta,CREATOR_PIPELINE_META);
  assert.deepEqual(CREATOR_PIPELINE_META.ui.csp,{
    connectDomains:[],
    resourceDomains,
    frameDomains:[],baseUriDomains:[],
  });
  assert.deepEqual(CREATOR_PIPELINE_META.ui.csp.resourceDomains, policy.TIKTOK_IMAGE_RESOURCE_DOMAINS);
  assert.deepEqual(CREATOR_PIPELINE_META['openai/ui'],{
    availableDisplayModes:['inline','fullscreen'],preferredDisplayMode:'fullscreen',
  });
  assert.ok('text' in content);
  assert.equal(content.text, CREATOR_PIPELINE_DOCUMENT);
  assert.equal(CREATOR_PIPELINE_URI,'ui://kettle/creator-pipeline-v7.html');
  assert.equal(creatorPipelineFingerprint.resource_version,'creator-pipeline-v7');
  assert.deepEqual(panelManifest.panels.find(panel=>panel.panel==='creator-pipeline'),creatorPipelineFingerprint);
  assert.match(content.text as string,new RegExp(`content="${creatorPipelineFingerprint.bundle_version}" data-resource-version="creator-pipeline-v7"`));
  for(const alias of [CREATOR_PIPELINE_V6_URI,CREATOR_PIPELINE_V5_URI,CREATOR_PIPELINE_V4_URI,CREATOR_PIPELINE_V3_URI,CREATOR_PIPELINE_V2_URI]){
    const compatible=(await client.readResource({uri:alias})).contents[0]!;
    assert.ok('text' in compatible);
    assert.equal(compatible.text,content.text);
  }
  const html = content.text as string;
  assert.match(html,/id="root"/);
  assert.match(html,/<title>Riff creator workflow<\/title>/);
  assert.match(html,/Riff creator workflow/);
  assert.match(html,/get_creator_job/);
  assert.match(html,/kettle-creator-pipeline/);
  assert.doesNotMatch(html,/<script[^>]+src=|StoredCreatorAnalysis|sourceMappingURL/);
  assert.equal((html.match(/<script>/g)||[]).length,1);
  assert.equal((html.match(/<\/script>/g)||[]).length,1);
});

test('resource escapes closing script tags and legacy HTML comment openers',()=>{
  const html=creatorPipelineHtml('const untrusted = "</ScRiPt><!--";',{resource_version:'creator-pipeline-v7',bundle_version:`sha256:${'a'.repeat(64)}`});
  assert.equal((html.match(/<\/script>/gi)||[]).length,1);
  assert.ok(!html.includes('<!--'));
  assert.ok(html.includes('<\\/script>'));
  assert.match(html,/name="riff-bundle-version"/);
});
