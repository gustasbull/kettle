import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { creatorReviewHtml, registerCreatorReviewResource, CREATOR_REVIEW_URI,
  CREATOR_REVIEW_MIME, CREATOR_REVIEW_META } from '../apps/worker/creator-review-resource.ts';

test('Creator DNA resource is a static bundled MCP App with consistent empty-network metadata', async t => {
  const server = new McpServer({name:'resource-fixture',version:'1'});
  registerCreatorReviewResource(server);
  const client = new Client({name:'fixture-client',version:'1'});
  const [a,b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  t.after(async()=>{ await client.close(); await server.close(); });
  const list = await client.listResources();
  assert.equal(list.resources.length,1);
  assert.equal(list.resources[0]!.uri,CREATOR_REVIEW_URI);
  assert.equal(list.resources[0]!.title,'Riff Creator DNA review');
  assert.equal(list.resources[0]!.mimeType,CREATOR_REVIEW_MIME);
  assert.deepEqual(list.resources[0]!._meta,CREATOR_REVIEW_META);
  const result = await client.readResource({uri:CREATOR_REVIEW_URI});
  assert.equal(result.contents.length,1);
  const content = result.contents[0]!;
  assert.equal(content.mimeType,CREATOR_REVIEW_MIME);
  assert.deepEqual(content._meta,CREATOR_REVIEW_META);
  assert.deepEqual(CREATOR_REVIEW_META.ui.csp,{connectDomains:[],resourceDomains:[],frameDomains:[],baseUriDomains:[]});
  assert.ok('text' in content);
  const html = content.text as string;
  assert.match(html,/id="root"/);
  assert.match(html,/<title>Riff Creator DNA review<\/title>/);
  assert.match(html,/get_creator_dna/);
  assert.match(html,/kettle-creator-review/);
  assert.doesNotMatch(html,/<script[^>]+src=|StoredCreatorAnalysis|sourceMappingURL/);
  assert.equal((html.match(/<script>/g)||[]).length,1);
  assert.equal((html.match(/<\/script>/g)||[]).length,1);
});

test('resource escapes closing script tags and legacy HTML comment openers',()=>{
  const html=creatorReviewHtml('const untrusted = "</ScRiPt><!--";');
  assert.equal((html.match(/<\/script>/gi)||[]).length,1);
  assert.ok(!html.includes('<!--'));
  assert.ok(html.includes('<\\/script>'));
});
