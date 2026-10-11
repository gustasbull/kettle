import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RecommendationBatch, CreatorScriptSet, CreatorJobView, PipelineReference,
  CreatorJobProgress, CreatorJobStatusView, CreatorJobStage } from '../packages/contracts/creator-pipeline.ts';
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
test('PipelineReference accepts legacy absence and validates new nullable source observation time', () => {
 const reference=recommendationBatchFixture().references[0]!;
 assert.ok(PipelineReference.safeParse(reference).success,'legacy saved reference remains readable');
 for(const source_observed_at of ['2026-10-08T14:30:00.000Z',null]){
  const parsed=PipelineReference.parse({...reference,source_observed_at});
  assert.equal(parsed.source_observed_at,source_observed_at);
 }
 assert.ok(!PipelineReference.safeParse({...reference,source_observed_at:'not-a-time'}).success);
 assert.ok(!PipelineReference.safeParse(({source_observed_at:'2026-10-08T14:30:00.000Z',...reference,retrieved_at:undefined})).success);
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
 assert.ok(CreatorJobView.safeParse({...job, state: 'queued', stage:'accepted',
  progress:{kind:'scan',profile:null,videos:[],limitations:[]},result: null}).success);
});

const provenance={origin:'live' as const,retrieved_at:'2026-10-11T08:00:00.000Z',source_observed_at:null,
 permission_basis:'Public metadata display approved.',limitations:[]};
const identity={platform:'tiktok' as const,native_id:'9000000000000000011',
 url:'https://www.tiktok.com/@fixture/video/9000000000000000011',retrieved_at:provenance.retrieved_at,
 origin:'live' as const,permission_basis:provenance.permission_basis,limitations:[]};
const card={platform:'tiktok' as const,native_id:identity.native_id,url:identity.url,caption:'Safe display caption',
 published_at:null,duration_seconds:null,metrics:{views:1,likes:null,comments:null,shares:null},provenance};

test('creator progress is a strict bounded display projection with ordered recommendation lineage',()=>{
 assert.deepEqual(CreatorJobProgress.parse({kind:'scan',profile:null,videos:[],limitations:[]}),
  {kind:'scan',profile:null,videos:[],limitations:[]});
 assert.deepEqual(CreatorJobProgress.parse({kind:'recommendations',identities:[],references:[],limitations:[]}),
  {kind:'recommendations',identities:[],references:[],limitations:[]});
 assert.deepEqual(CreatorJobProgress.parse({kind:'scripts',limitations:[]}),{kind:'scripts',limitations:[]});
 const recommended={kind:'recommendations' as const,identities:[identity],references:[card],limitations:[]};
 assert.ok(CreatorJobProgress.safeParse(recommended).success);
 for(const privateField of ['account_id','receipt','body','provider_credentials','allowance'])
  assert.ok(!CreatorJobProgress.safeParse({...recommended,[privateField]:'secret'}).success,privateField);
 assert.ok(!CreatorJobProgress.safeParse({...recommended,identities:[],references:[card]}).success);
 assert.ok(!CreatorJobProgress.safeParse({...recommended,references:[{...card,native_id:'other'}]}).success);
 assert.ok(!CreatorJobProgress.safeParse({...recommended,identities:Array.from({length:4},(_,i)=>({...identity,native_id:String(i),url:`https://www.tiktok.com/@fixture/video/${i}`}))}).success);
 assert.ok(!CreatorJobProgress.safeParse({kind:'scan',profile:null,videos:Array.from({length:11},(_,i)=>({...card,native_id:String(i),url:`https://www.tiktok.com/@fixture/video/${i}`})),limitations:[]}).success);
 assert.ok(!CreatorJobProgress.safeParse({...recommended,references:[{...card,caption:'x'.repeat(2001)}]}).success);
 assert.ok(!CreatorJobProgress.safeParse({...recommended,references:[{...card,provenance:{...provenance,retrieved_at:undefined}}]}).success);
});

test('job stage and compact status reject unknown stages, private fields and terminal contradictions',()=>{
 for(const stage of ['accepted','reviewing_video','reading_profile','reading_posts','building_analysis','researching_formats','enriching_references','saving'])
  assert.equal(CreatorJobStage.parse(stage),stage);
 assert.ok(!CreatorJobStage.safeParse('downloading_media').success);
 const job=creatorJobFixture('recommendations');
 const status={id:job.id,kind:job.kind,state:job.state,stage:'saving',revision:job.revision,
  created_at:job.created_at,updated_at:job.updated_at,progress:{kind:'recommendations',identities:[],references:[],limitations:[]},
  terminal_result_available:true};
 assert.ok(CreatorJobStatusView.safeParse(status).success);
 for(const key of ['project_id','result','account_id','request_id','captured','receipt','message'])
  assert.ok(!CreatorJobStatusView.safeParse({...status,[key]:'private'}).success,key);
 assert.ok(!CreatorJobStatusView.safeParse({...status,state:'running',terminal_result_available:true}).success);
 assert.ok(!CreatorJobStatusView.safeParse({...status,state:'succeeded',stage:'building_analysis'}).success);
 assert.ok(!CreatorJobStatusView.safeParse({...status,kind:'scan'}).success);
});
