import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RecommendationBatch, CreatorScriptSet, CreatorJobView } from '../packages/contracts/creator-pipeline.ts';
import { recommendationBatchFixture, creatorScriptsFixture, creatorJobFixture } from '../evals/creator-loop/pipeline-fixtures.ts';
test('pipeline contracts retain reference lineage and fictional origin without padding',()=>{
 const batch=recommendationBatchFixture(); assert.equal(batch.ideas.length,1);
 assert.ok(!RecommendationBatch.safeParse({...batch,contains_fixture_data:false}).success);
 assert.ok(!RecommendationBatch.safeParse({...batch,references:[]}).success);
 assert.ok(!RecommendationBatch.safeParse({...batch,references:[...batch.references,...batch.references]}).success);
 assert.ok(!RecommendationBatch.safeParse({...batch,ideas:[...batch.ideas,...batch.ideas]}).success);
 assert.ok(RecommendationBatch.safeParse({...batch,references:[],ideas:[]}).success);
 const scripts=creatorScriptsFixture(); assert.equal(scripts.variants.length,2);
 assert.ok(!CreatorScriptSet.safeParse({...scripts,variants:[scripts.variants[0]]}).success);
 assert.ok(!CreatorScriptSet.safeParse({...scripts,variants:[scripts.variants[0],scripts.variants[0]]}).success);
 for(const kind of ['scan','recommendations','scripts'] as const)assert.equal(creatorJobFixture(kind).result!.kind,kind);
});
test('Paper discovery and Studio facts are optional for saved legacy results but strictly validated when present', () => {
 const legacyBatch=recommendationBatchFixture();
 const reference={...legacyBatch.references[0]!,
  thumbnail_url:'https://p16-sign-va.tiktokcdn.com/tos-maliva-p-0068/cover.jpeg?x-expires=1',
  duration_seconds:22,likes:8600,saves:1200,view_multiplier:4.2,
  view_multiplier_basis:{method:'median_observed_profile_views',baseline_views:28571,sample_size:8}};
 assert.equal(RecommendationBatch.parse({...legacyBatch,references:[reference]}).references[0]!.saves,1200);
 assert.equal(RecommendationBatch.parse({...legacyBatch,references:[{
  ...reference,
  view_multiplier_basis:{...reference.view_multiplier_basis,baseline_views:28571.5},
 }]}).references[0]!.view_multiplier_basis?.baseline_views,28571.5);
 assert.ok(!RecommendationBatch.safeParse({...legacyBatch,references:[{...reference,thumbnail_url:'https://evil.test/cover.jpeg'}]}).success);
 assert.ok(!RecommendationBatch.safeParse({...legacyBatch,references:[{...reference,view_multiplier_basis:undefined}]}).success);
 assert.ok(!RecommendationBatch.safeParse({...legacyBatch,references:[{...reference,views:null}]}).success);

 const legacyScripts=creatorScriptsFixture();
 const variant={...legacyScripts.variants[0]!,timed_segments:[
  {part:'hook',start_seconds:0,end_seconds:3,spoken_text:'Still on the same page?',
   filming_direction:'Film the open textbook, then cut to the clock.',on_screen_text:'SAME PAGE?'},
  {part:'main_content',start_seconds:3,end_seconds:17,spoken_text:'Try one question.',
   filming_direction:'Show the question, answer and page.'},
  {part:'cta',start_seconds:17,end_seconds:22,spoken_text:'Save this for your next study session.',
   filming_direction:'Hold the final caption for two seconds.'},
 ],caption:'Still rereading the same page? Try one question.',hashtags:['#studytips','#learning']};
 assert.equal(CreatorScriptSet.parse({...legacyScripts,variants:[variant,legacyScripts.variants[1]!]}).variants[0]!.timed_segments?.length,3);
 assert.ok(!CreatorScriptSet.safeParse({...legacyScripts,variants:[{...variant,hashtags:['studytips']},legacyScripts.variants[1]!]}).success);
 assert.ok(!CreatorScriptSet.safeParse({...legacyScripts,variants:[{...variant,timed_segments:[{...variant.timed_segments[0]!,end_seconds:0}]},legacyScripts.variants[1]!]}).success);
});
test('Studio context is optional only as a complete legacy-compatible pair with exact selected lineage', () => {
 const legacy=creatorScriptsFixture(),batch=recommendationBatchFixture();
 assert.ok(CreatorScriptSet.safeParse(legacy).success,'old saved script JSON remains readable');
 const contextual={...legacy,idea:batch.ideas[0]!,references:[batch.references[0]!]};
 assert.equal(CreatorScriptSet.parse(contextual).references?.[0]?.id,batch.references[0]!.id);
 assert.ok(!CreatorScriptSet.safeParse({...contextual,idea:undefined}).success);
 assert.ok(!CreatorScriptSet.safeParse({...contextual,references:undefined}).success);
 assert.ok(!CreatorScriptSet.safeParse({...contextual,idea:{...contextual.idea,id:'00000000-0000-4000-8000-000000000999'}}).success);
 assert.ok(!CreatorScriptSet.safeParse({...contextual,references:[{...contextual.references[0]!,id:'00000000-0000-4000-8000-000000000999'}]}).success);
 assert.ok(!CreatorScriptSet.safeParse({...contextual,references:[...contextual.references,...contextual.references]}).success);
});
test('job status cannot expose premature, mismatched or cross-project scan results', () => {
 const job = creatorJobFixture('scan');
 assert.ok(!CreatorJobView.safeParse({...job, state: 'running'}).success);
 assert.ok(!CreatorJobView.safeParse({...job, result: null}).success);
 assert.ok(!CreatorJobView.safeParse({...job, kind: 'scripts'}).success);
 assert.ok(!CreatorJobView.safeParse({...job, project_id: job.id}).success);
 assert.ok(CreatorJobView.safeParse({...job, state: 'queued', result: null}).success);
});
