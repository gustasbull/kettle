import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { creatorPipelineHtml, registerCreatorPipelineResource, CREATOR_PIPELINE_URI,
  CREATOR_PIPELINE_MIME, CREATOR_PIPELINE_META } from '../apps/worker/creator-pipeline-resource.ts';

test('Creator pipeline resource is a static bundled MCP App with narrowly scoped media metadata', async t => {
  const server = new McpServer({name:'resource-fixture',version:'1'});
  registerCreatorPipelineResource(server);
  const client = new Client({name:'fixture-client',version:'1'});
  const [a,b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  t.after(async()=>{ await client.close(); await server.close(); });
  const list = await client.listResources();
  assert.equal(list.resources.length,2);
  assert.equal(list.resources[0]!.uri,CREATOR_PIPELINE_URI);
  assert.equal(list.resources[0]!.title,'Riff creator workflow');
  assert.equal(list.resources[0]!.mimeType,CREATOR_PIPELINE_MIME);
  assert.equal(list.resources[1]!.uri,'ui://kettle/creator-pipeline-v2.html');
  assert.deepEqual(list.resources[0]!._meta,CREATOR_PIPELINE_META);
  const result = await client.readResource({uri:CREATOR_PIPELINE_URI});
  assert.equal(result.contents.length,1);
  const content = result.contents[0]!;
  assert.equal(content.mimeType,CREATOR_PIPELINE_MIME);
  assert.deepEqual(content._meta,CREATOR_PIPELINE_META);
  assert.deepEqual(CREATOR_PIPELINE_META.ui.csp,{
    connectDomains:[],
    resourceDomains:['https://tiktokcdn.com','https://*.tiktokcdn.com'],
    frameDomains:[],baseUriDomains:[],
  });
  assert.deepEqual(CREATOR_PIPELINE_META['openai/ui'],{
    availableDisplayModes:['inline','fullscreen'],preferredDisplayMode:'fullscreen',
  });
  assert.ok('text' in content);
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
  const html=creatorPipelineHtml('const untrusted = "</ScRiPt><!--";',{resource_version:'creator-pipeline-v3',bundle_version:`sha256:${'a'.repeat(64)}`});
  assert.equal((html.match(/<\/script>/gi)||[]).length,1);
  assert.ok(!html.includes('<!--'));
  assert.ok(html.includes('<\\/script>'));
  assert.match(html,/name="riff-bundle-version"/);
});
