import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCreatorPipelineProvider, CreatorProviderError } from '../packages/adapters/creator-pipeline/provider.ts';
import { readLightreelSeedReview, seedReviewBody } from '../packages/adapters/creator-pipeline/seed-review.ts';
import { boundedJson } from '../packages/adapters/creator-pipeline/http.ts';
import { fakeGuard, providerHttpFixture } from '../evals/creator-loop/provider-http-fixtures.ts';
import { projectCreatorDna } from '../packages/application/creator-operations.ts';

function setup() {
 const f=providerHttpFixture(); const seedUrl=f.input.request.supplied_url+'/video/9000000000000000011';
 const dimensions=[
  ['hook','needs_attention'],['content','working_well'],['style_pacing','unknown'],
  ['voice_language','working_well'],['script','needs_rework'],['cta','needs_attention'],
 ].map(([dimension,status])=>({dimension,status,summary:`Evidence-bounded ${dimension} assessment.`,
  ...(status==='unknown'?{}:{recommendation:`Proposed ${dimension} change.`})}));
 const answer={video_url:seedUrl,summary:'A desk demonstration in this supplied video; pacing is unverified.',access_basis:'transcript_or_caption_only',dimensions,limitations:['Caption only.']};
 return {...f,seedUrl,answer};
}
test('exact supplied video is reviewed before SC calls, with allowlisted guarded replay and metadata-only attribution',async()=>{
 for(const asString of [false,true]) {
  const f=setup();const guard=fakeGuard();const fallback=f.options.fetch;let seedCalls=0;
  const provider=createCreatorPipelineProvider({...f.options,seedUrl:f.seedUrl,fetch:async(url,init)=>{
   if(new URL(url).hostname==='api.lightreel.ai') {
    seedCalls++;const request=JSON.parse(init.body as string);
    assert.equal(init.method,'POST');assert.match(request.question,/ONLY this exact supplied TikTok video/);
    assert.ok(request.question.includes(f.seedUrl));assert.equal(Object.keys(request.response_fields).length,5);
    assert.match(request.response_fields.dimensions.description,/exactly six/i);
    const answer={...f.answer,unrequested:'DO_NOT_RETAIN'};
    return Response.json({conversationId:'seed-fixture',answer:asString?JSON.stringify(answer):answer,private:'DO_NOT_RETAIN'});
   }
   assert.ok(guard.successes.has('seed-review'),'review persisted before profile/feed dispatch');return fallback(url,init);
  }});
  const analysis=await provider.scan(f.input.request,guard.context);
  assert.deepEqual(guard.calls.map(c=>c.key),['seed-review','profile','feed:0']);
  assert.deepEqual(guard.calls[0],{key:'seed-review',provider:'lightreel',operation:'research'});
  assert.equal(analysis.seed_review?.url,f.seedUrl);assert.equal(analysis.seed_review?.summary,f.answer.summary);
  assert.equal(analysis.seed_review?.conversation_id,'seed-fixture');assert.equal(analysis.seed_review?.access_basis,'transcript_or_caption_only');
  assert.deepEqual(analysis.seed_review?.dimensions,f.answer.dimensions);
  assert.deepEqual(analysis.seed_review?.provenance.permission,f.options.permission);
  assert.deepEqual(analysis.seed_review?.provenance.modalities,['metadata']);
  assert.equal(analysis.seed_review?.provenance.origin,'live');assert.equal(analysis.seed_review?.provenance.endpoint,'/v1/chat');
  assert.ok(analysis.seed_review?.limitations.some(x=>x.includes('not independently verified')));
  assert.ok(analysis.dna.claims.every(c=>!c.requires_video && c.dimension!=='pacing'));
  assert.ok(!analysis.dna.claims.some(c=>c.statement.includes(f.answer.summary)));
  assert.equal(analysis.scan.cost.attempts[0]?.provider,'lightreel');assert.equal(analysis.scan.cost.attempts[0]?.usd,null);
  assert.ok(!JSON.stringify([...guard.successes.values()]).includes('DO_NOT_RETAIN'));
  assert.deepEqual(await provider.scan(f.input.request,guard.context),analysis);assert.equal(seedCalls,1);
 }
});
test('held supplied-video review releases before any ScrapeCreators work begins',async()=>{
 const f=setup(),guard=fakeGuard(),fallback=f.options.fetch,release=deferred<void>(),started=deferred<void>();
 let scrapeCalls=0;
 const provider=createCreatorPipelineProvider({...f.options,seedUrl:f.seedUrl,fetch:async(url,init)=>{
  if(new URL(url).hostname==='api.lightreel.ai'){started.resolve();await release.promise;return Response.json({conversationId:'held-seed',answer:f.answer});}
  scrapeCalls++;return fallback(url,init);
 }});
 const pending=provider.scan(f.input.request,guard.context);await started.promise;
 assert.equal(scrapeCalls,0);assert.deepEqual(guard.calls.map(call=>call.key),['seed-review']);
 release.resolve();await pending;
 assert.deepEqual(guard.calls.map(call=>call.key),['seed-review','profile','feed:0']);assert.equal(scrapeCalls,2);
});

function deferred<T>(){let resolve!:(value?:T)=>void;const promise=new Promise<T>(done=>{resolve=value=>done(value as T);});return {promise,resolve};}
test('seed parser rejects wrong source, missing identity, invalid enums and bounds; strips arbitrary fields',()=>{
 const f=setup();
 assert.deepEqual(readLightreelSeedReview(JSON.stringify({conversationId:'valid',answer:{...f.answer,secret:'drop'}}),f.seedUrl),{conversationId:'valid',answer:f.answer});
 for(const raw of [ {answer:f.answer}, {conversationId:'bad/id',answer:f.answer},
  {conversationId:'ok',answer:{...f.answer,video_url:f.seedUrl.replace(/11$/,'12')}},
  {conversationId:'ok',answer:{...f.answer,access_basis:'verified'}},
  {conversationId:'ok',answer:{...f.answer,summary:'x'.repeat(8001)}},
  {conversationId:'ok',answer:{...f.answer,limitations:Array(21).fill('x')}},
  {conversationId:'ok',answer:{...f.answer,limitations:['x'.repeat(1001)]}},
  {conversationId:'ok',answer:{...f.answer,dimensions:f.answer.dimensions.slice(0,5)}},
  {conversationId:'ok',answer:{...f.answer,dimensions:f.answer.dimensions.map((d,i)=>i===5?{...d,dimension:'hook'}:d)}},
  {conversationId:'ok',answer:{...f.answer,dimensions:f.answer.dimensions.map((d,i)=>i===0?{...d,status:'great'}:d)}},
  {conversationId:'ok',answer:{...f.answer,dimensions:f.answer.dimensions.map(d=>d.dimension==='style_pacing'?{...d,status:'needs_attention'}:d)}},
  {conversationId:'ok',answer:{...f.answer,access_basis:'unavailable'}},
  {conversationId:'ok',answer:'prose instead of structured JSON'},
 ]) assert.throws(()=>readLightreelSeedReview(JSON.stringify(raw),f.seedUrl));
 const {dimensions:_dimensions,...legacy}=f.answer;
 assert.equal(readLightreelSeedReview(JSON.stringify({conversationId:'legacy',answer:legacy}),f.seedUrl).answer.dimensions,undefined);
 assert.throws(()=>seedReviewBody(f.input.request.supplied_url));
});
test('seed POST failure neither falls back to SC nor polls/resubmits, and errors contain only bounded diagnostic enums',async()=>{
 const f=setup();
 for(const sample of [
  {fetch:async()=>new Response('SECRET_RAW_ERROR',{status:429}),error:'creator_provider_transport_http_429'},
  {fetch:async()=>{throw Error('SECRET_RAW_ERROR');},error:'creator_provider_transport_network'},
  {fetch:async()=>new Response('SECRET_RAW_ERROR'),error:'creator_provider_transport_malformed_200'},
  {fetch:async()=>Response.json({conversationId:'known-id'}),error:'creator_provider_malformed_malformed_200'},
 ]) {
  let calls=0;const guard=fakeGuard();const provider=createCreatorPipelineProvider({...f.options,seedUrl:f.seedUrl,maxHistoryReads:3,fetch:async()=>{calls++;return sample.fetch();}});
  await assert.rejects(provider.scan(f.input.request,guard.context),(error:unknown)=>error instanceof Error&&error.message===sample.error);
  await assert.rejects(provider.scan(f.input.request,guard.context),/reconciliation/);
  assert.equal(calls,1);assert.deepEqual(guard.calls.map(c=>c.key),['seed-review']);assert.equal(guard.successes.size,0);
 }
 let calls=0;const timeout=createCreatorPipelineProvider({...f.options,seedUrl:f.seedUrl,timeouts:{seedReviewMs:10},fetch:async()=>{calls++;return new Promise<Response>(()=>{});}});
 await assert.rejects(timeout.scan(f.input.request,fakeGuard().context),/^Error: creator_provider_transport_timeout$/);assert.equal(calls,1);
 for(const status of [null,200,429,500,999]) assert.match(new CreatorProviderError('transport',status,'network').message,/^creator_provider_(transport|malformed|permission|unavailable)(?:_(timeout|network|oversized|malformed|http))?(?:_[1-5][0-9]{2})?$/);
});
test('seed source must match requested profile before dispatch; unavailable review stays explicitly unavailable',async()=>{
 const f=setup();let calls=0;
 const mismatch=createCreatorPipelineProvider({...f.options,seedUrl:'https://www.tiktok.com/@different/video/1',fetch:async()=>{calls++;throw Error('must not call');}});
 await assert.rejects(mismatch.scan(f.input.request,fakeGuard().context),/permission/);assert.equal(calls,0);
 const fallback=f.options.fetch;
 const {dimensions:_dimensions,...unavailableAnswer}=f.answer;
 const provider=createCreatorPipelineProvider({...f.options,seedUrl:f.seedUrl,fetch:async(url,init)=>new URL(url).hostname==='api.lightreel.ai'
  ?Response.json({conversationId:'unavailable',answer:{...unavailableAnswer,summary:'No video content could be accessed.',access_basis:'unavailable'}}):fallback(url,init)});
 const result=await provider.scan(f.input.request,fakeGuard().context);assert.equal(result.seed_review?.access_basis,'unavailable');
 assert.ok(result.dna.claims.every(c=>!c.statement.includes('No video content')));
});
test('recommendations receive supplied-video context without minting profile claims; unavailable review is not used as fit evidence',async()=>{
 const f=setup();const fallback=f.options.fetch;let seedDone=false;let query='';
 const provider=createCreatorPipelineProvider({...f.options,seedUrl:f.seedUrl,fetch:async(url,init)=>{
  if(new URL(url).hostname==='api.lightreel.ai'&&!seedDone){seedDone=true;return Response.json({conversationId:'seed',answer:f.answer});}
  if(new URL(url).hostname==='api.lightreel.ai')query=JSON.parse(init.body as string).question;
  return fallback(url,init);
 }});
 const analysis=await provider.scan(f.input.request,fakeGuard().context);
 const dna=projectCreatorDna({dna_id:analysis.dna.id,project_id:'00000000-0000-4000-8000-000000000100',analysis});
 assert.ok(dna.seed_review);dna.claims=[];
 const batch=await provider.recommend(dna,fakeGuard().context);assert.equal(batch.ideas.length,1);
 assert.match(query,/supplied_video_review/);assert.ok(query.includes(f.seedUrl));
 assert.match(batch.ideas[0]!.creator_fit,/supplied video review, not whole profile/);
 assert.match(batch.ideas[0]!.limitations.join(' '),/not independently verified/);
 const noAccess=await provider.recommend({...dna,seed_review:{...dna.seed_review!,access_basis:'unavailable'}},fakeGuard().context);
 assert.equal(noAccess.ideas.length,1);
 assert.doesNotMatch(noAccess.ideas[0]!.creator_fit,/supplied video review/);
});
test('only SC feeds accept a bounded 2MiB raw response; enlarged raw bodies still produce small allowlisted receipts',async()=>{
 const f=setup();const fallback=f.options.fetch;const guard=fakeGuard();
 const provider=createCreatorPipelineProvider({...f.options,fetch:async(url,init)=>{
  const result=await fallback(url,init);
  if(new URL(url).pathname!=='/v3/tiktok/profile/videos')return result;
  const body=await result.json() as Record<string,unknown>;return Response.json({...body,unusedMedia:'x'.repeat(300_000)});
 }});
 await provider.scan(f.input.request,guard.context);
 const recorded=JSON.stringify(guard.successes.get('feed:0'));assert.ok(recorded.length<262144);assert.ok(!recorded.includes('unusedMedia'));
 const feed=new URL('https://api.scrapecreators.com/v3/tiktok/profile/videos');
 const raw=await boundedJson(async()=>new Response('x'.repeat(2_097_153)),feed,{}, {timeoutMs:100,maxBytes:2_097_152});assert.equal(raw.failure,'oversized');
 for(const url of ['https://api.lightreel.ai/v1/chat','https://api.scrapecreators.com/v1/tiktok/profile','https://api.scrapecreators.com/v2/tiktok/video']) {
  await assert.rejects(boundedJson(async()=>{throw Error('must not call');},new URL(url),{},{timeoutMs:100,maxBytes:2_097_152}),/Invalid transport limits/);
 }
 const tooLarge=createCreatorPipelineProvider({...f.options,fetch:async(url,init)=>{
  const result=await fallback(url,init);if(new URL(url).pathname!=='/v3/tiktok/profile/videos')return result;
  const body=await result.json() as {aweme_list:Array<{desc:string}>};body.aweme_list[0]!.desc='é'.repeat(150_000);return Response.json(body);
 }});
 const failedGuard=fakeGuard();await assert.rejects(tooLarge.scan(f.input.request,failedGuard.context),/^Error: creator_provider_malformed_malformed_200$/);
 assert.ok(!failedGuard.successes.has('feed:0'),'sanitized receipts remain capped by UTF-8 bytes, not UTF-16 length');
});
