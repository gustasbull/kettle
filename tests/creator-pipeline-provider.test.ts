import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCreatorPipelineProvider } from '../packages/adapters/creator-pipeline/provider.ts';
import { fakeGuard, providerHttpFixture } from '../evals/creator-loop/provider-http-fixtures.ts';
import { projectCreatorDna } from '../packages/application/creator-operations.ts';
import { CreatorAnalysis } from '../packages/contracts/creator-profile.ts';
import { RecommendationBatch, CreatorScriptSet } from '../packages/contracts/creator-pipeline.ts';
import { creatorScriptsFixture } from '../evals/creator-loop/pipeline-fixtures.ts';
import { creatorDnaViewFixture } from '../evals/creator-loop/dna-view-fixtures.ts';

async function setup() {
  const f = providerHttpFixture();
  const provider = createCreatorPipelineProvider(f.options);
  const guard = fakeGuard();
  const analysis = await provider.scan(f.input.request, guard.context);
  const dna = projectCreatorDna({ dna_id: analysis.dna.id,
    project_id: '00000000-0000-4000-8000-000000000100', analysis });
  return { f, provider, guard, analysis, dna };
}
test('offline full adapter chain uses guarded calls and validates shared envelopes and selection lineage', async () => {
  const { f, provider, guard, analysis, dna } = await setup();
  CreatorAnalysis.parse(analysis);
  assert.equal(analysis.scan.status, 'partial');
  assert.equal(analysis.scan.cost.attempts.length, 2);
  assert.deepEqual(guard.calls.map(c => c.key), ['profile', 'feed:0']);
  const recommendations = fakeGuard();
  const batch = RecommendationBatch.parse(await provider.recommend(dna, recommendations.context));
  assert.equal(batch.ideas.length, 1); assert.equal(batch.references.length, 1);
  assert.equal(batch.dna_version, dna.version);
  assert.equal(batch.references[0]!.duration_seconds,12);
  assert.equal(batch.references[0]!.likes,0);
  assert.deepEqual(recommendations.calls.map(c => c.operation), ['research', 'video']);
  const generation = fakeGuard();
  const scripts = CreatorScriptSet.parse(await provider.generate({ batch, idea_id: batch.ideas[0]!.id, dna }, generation.context));
  assert.equal(scripts.variants.length, 2); assert.equal(scripts.idea_id, batch.ideas[0]!.id);
  assert.equal(scripts.dna_id, dna.dna_id);
  assert.deepEqual(scripts.idea,batch.ideas[0]);
  assert.deepEqual(scripts.references,batch.ideas[0]!.reference_ids.map(referenceId=>batch.references.find(reference=>reference.id===referenceId)!));
  assert.equal(scripts.variants[0]!.timed_segments?.length,3);
  assert.match(scripts.variants[0]!.caption!,/desk/i);
  assert.deepEqual(scripts.variants[0]!.hashtags,['#desktips']);
  assert.deepEqual(generation.calls.map(c => c.operation), ['generate']);
  assert.equal(f.http.length, 5);
  const modelRequest=JSON.parse(f.http.find(h=>new URL(h.url).hostname==='api.openai.com')!.init.body as string);
  const variantSchema=modelRequest.text.format.schema.properties.variants.items;
  for(const field of ['timed_segments','caption','hashtags']) {
    assert.ok(variantSchema.properties[field]);
    assert.ok(variantSchema.required.includes(field),`${field} must be required by the strict model response schema`);
  }
  const segmentSchema=variantSchema.properties.timed_segments.items;
  assert.deepEqual(new Set(segmentSchema.required),new Set(Object.keys(segmentSchema.properties)),
    'strict model response schemas must require every declared nested property');
  assert.match(modelRequest.instructions,/original drafting proposals/);
  const before = f.http.length;
  assert.deepEqual(await provider.scan(f.input.request, guard.context), analysis);
  assert.deepEqual(await provider.recommend(dna, recommendations.context), batch);
  assert.deepEqual(await provider.generate({ batch, idea_id: batch.ideas[0]!.id, dna }, generation.context), scripts);
  assert.equal(f.http.length, before, 'recorded successes replay without new fetch');
  const records = JSON.stringify([...guard.successes.values(), ...recommendations.successes.values(), ...generation.successes.values()]);
  for (const key of Object.values(f.options.credentials)) assert.ok(!records.includes(key));
});
test('scan derives feed user_id from the matched sanitized profile and applies trusted cache policy', async () => {
  const f = providerHttpFixture();
  const guard = fakeGuard();
  await createCreatorPipelineProvider(f.options).scan(f.input.request, guard.context);
  const profile = new URL(f.http.find(({ url }) => new URL(url).pathname === '/v1/tiktok/profile')!.url);
  const feed = new URL(f.http.find(({ url }) => new URL(url).pathname === '/v3/tiktok/profile/videos')!.url);
  assert.equal(profile.searchParams.get('cache_max_age'), '1d');
  assert.deepEqual([...profile.searchParams.keys()].sort(), ['cache_max_age', 'handle']);
  assert.equal(feed.searchParams.get('handle'), 'fictional_kettle_creator');
  assert.equal(feed.searchParams.get('user_id'), '9000000000000000001');
  assert.equal(feed.searchParams.has('cache_max_age'), false);
  assert.deepEqual(guard.calls.map(({ key }) => key), ['profile', 'feed:0']);
  assert.equal('cache_max_age' in f.input.request, false, 'cache policy is not public scan input');
  assert.equal('user_id' in f.input.request, false, 'native provider identity is not public scan input');
});
test('malformed native profile ID prevents feed reservation and HTTP', async () => {
  const f = providerHttpFixture(); const fallback = f.options.fetch;
  f.options.fetch = async (url, init) => {
    const response = await fallback(url, init);
    if (new URL(url).pathname !== '/v1/tiktok/profile') return response;
    const body = await response.json() as any; body.user.id = '1'.repeat(31); return Response.json(body);
  };
  const guard = fakeGuard();
  await assert.rejects(createCreatorPipelineProvider(f.options).scan(f.input.request, guard.context), /malformed/);
  assert.deepEqual(guard.calls.map(({ key }) => key), ['profile']);
  assert.equal(f.http.filter(({ url }) => new URL(url).pathname === '/v3/tiktok/profile/videos').length, 0);
});
test('recommendation detail uses seven-day cache and keeps transcript and media disabled', async () => {
  const { f, provider, dna } = await setup(); const guard = fakeGuard();
  await provider.recommend(dna, guard.context);
  const detail = new URL(f.http.find(({ url }) => new URL(url).pathname === '/v2/tiktok/video')!.url);
  assert.equal(detail.searchParams.get('cache_max_age'), '7d');
  assert.equal(detail.searchParams.get('get_transcript'), 'false');
  assert.equal(detail.searchParams.get('download_media'), 'false');
  assert.deepEqual(guard.calls.map(({ key }) => key), ['research', 'video:9000000000000000011']);
  assert.equal(f.http.filter(({ url }) => new URL(url).pathname === '/v2/tiktok/video').length, 1);
});
test('provider rejects invalid cache configuration before guard reservation or HTTP', () => {
  for (const cacheMaxAge of [undefined, null, { profile: '2d', detail: '7d' },
    { profile: '1d', detail: '604800' }, { profile: '1d', detail: '7d', caller: 'override' }]) {
    const f = providerHttpFixture(); const guard = fakeGuard();
    const options = { ...f.options, cacheMaxAge } as any;
    assert.throws(() => createCreatorPipelineProvider(options), /cache/i);
    assert.deepEqual(guard.calls, []);
    assert.deepEqual(f.http, []);
  }
});
test('live recommendation exposes typed cache observation separately from retrieval', async () => {
  const { provider, dna } = await setup();
  const batch = await provider.recommend(dna, fakeGuard().context);
  const reference = batch.references[0]!;
  assert.equal(reference.source_observed_at, '2026-10-08T14:30:00.000Z');
  assert.notEqual(reference.retrieved_at, reference.source_observed_at);

  const f = providerHttpFixture(); const fallback = f.options.fetch;
  f.options.fetch = async (url, init) => {
    const response = await fallback(url, init);
    if (new URL(url).pathname !== '/v2/tiktok/video') return response;
    const body = await response.json() as any; body.cached = false; delete body.cached_at; return Response.json(body);
  };
  const scanProvider = createCreatorPipelineProvider(f.options); const scanGuard = fakeGuard();
  const analysis = await scanProvider.scan(f.input.request, scanGuard.context);
  const uncachedDna = projectCreatorDna({ dna_id: analysis.dna.id,
    project_id: '00000000-0000-4000-8000-000000000100', analysis });
  const uncached = (await scanProvider.recommend(uncachedDna, fakeGuard().context)).references[0]!;
  assert.equal(Object.hasOwn(uncached, 'source_observed_at'), true);
  assert.equal(uncached.source_observed_at, null);
});
test('provider observation records endpoint enums, sizes, HTTP and sanitization timing without raw content', async () => {
  const f = providerHttpFixture();
  const events: Array<Record<string, unknown>> = [];
  const telemetry = {
    record(fields: Record<string, unknown>) { events.push({ ...fields }); },
    async measure<T>(fields: Record<string, unknown>, run: () => Promise<T>) {
      const result = await run(); events.push({ ...fields }); return result;
    },
  };
  const provider = createCreatorPipelineProvider({ ...f.options, telemetry });
  await provider.scan(f.input.request, fakeGuard().context);
  assert.ok(events.some(event => event.stage === 'provider_http' && event.endpoint === 'scrapecreators_profile'
    && event.http_status === 200 && Number(event.response_bytes) > 0));
  assert.ok(events.some(event => event.stage === 'sanitization' && event.provider === 'scrapecreators'));
  assert.doesNotMatch(JSON.stringify(events), /fictional_kettle_creator|supplied_url|caption|api-key|body/i);
});
test('Lightreel-selected references remain grounded candidates when English lexical overlap misses', async () => {
  const { dna } = await setup();
  const f = providerHttpFixture(); const fallback=f.options.fetch;
  const provider=createCreatorPipelineProvider({...f.options,fetch:async(url,init)=>{
    const u=new URL(url);
    if(u.hostname==='api.lightreel.ai')return Response.json({conversationId:'selected-by-lightreel',answer:{
      urls:['https://www.tiktok.com/@fictional_kettle_creator/video/9000000000000000011']}});
    const response=await fallback(url,init);
    if(u.pathname!=='/v2/tiktok/video')return response;
    const body=await response.json() as any;
    body.aweme_detail.desc='Caf\u00e9 ma\u00f1ana \u65b0\u3057\u3044';
    body.aweme_detail.statistics={...body.aweme_detail.statistics,play_count:480,digg_count:21,collect_count:13};
    body.aweme_detail.video={...body.aweme_detail.video,
      dynamic_cover:{url_list:['https://p16-sign-va.tiktokcdn.com/cover.jpeg']},
      cover:{url_list:['https://p16-sign-va.tiktokcdn.com/static-cover.jpeg']}};
    return Response.json(body);
  }});
  const batch=await provider.recommend(dna,fakeGuard().context);
  assert.equal(batch.ideas.length,1,'provider-selected reference must not collapse solely on lexical mismatch');
  assert.match(batch.ideas[0]!.evidence_summary,/Caf\u00e9 ma\u00f1ana \u65b0\u3057\u3044/);
  assert.match(batch.ideas[0]!.creator_fit,/Proposed fit/i);
  assert.match(batch.ideas[0]!.limitations.join(' '),/provider-selected relevance/i);
  assert.equal(batch.references[0]!.thumbnail_url,'https://p16-sign-va.tiktokcdn.com/cover.jpeg');
  assert.equal(batch.references[0]!.duration_seconds,12);
  assert.equal(batch.references[0]!.likes,21);
  assert.equal(batch.references[0]!.saves,13);
  assert.equal(batch.references[0]!.view_multiplier,4);
  assert.deepEqual(batch.references[0]!.view_multiplier_basis,
    {method:'median_observed_profile_views',baseline_views:120,sample_size:1});
});
test('guard denial stops dispatch; adapter has no permissive guard or permission default', async () => {
  const f = providerHttpFixture(); const p = createCreatorPipelineProvider(f.options);
  const guard = fakeGuard(); guard.context.call = async () => { throw Error('not allocated'); };
  await assert.rejects(p.scan(f.input.request, guard.context), /not allocated/);
  assert.equal(f.http.length, 0);
  const { dna } = await setup();
  const denied = createCreatorPipelineProvider({ ...f.options, canProcessDna: () => false });
  await assert.rejects(denied.recommend(dna, fakeGuard().context), /permission/);
  await assert.rejects(p.recommend(creatorDnaViewFixture(), fakeGuard().context), /permission/);
  assert.equal(f.http.length, 0);
});
test('ambiguous research POST is never automatically retried, including same-job replay', async () => {
  const { dna } = await setup(); const f = providerHttpFixture(); let calls = 0;
  const p = createCreatorPipelineProvider({ ...f.options, fetch: async () => { calls++; throw Error('secret-key'); } });
  const guard = fakeGuard();
  await assert.rejects(p.recommend(dna, guard.context), /^Error: creator_provider_transport_network$/);
  await assert.rejects(p.recommend(dna, guard.context), /reconciliation/);
  assert.equal(calls, 1);
});
test('known conversation ID enables bounded history only, followed by at most three enrichments', async () => {
  const { dna } = await setup(); const f = providerHttpFixture(); let count = 0;
  const fallback = f.options.fetch;
  const p = createCreatorPipelineProvider({ ...f.options, maxHistoryReads: 3, fetch: async (url, init) => {
    if (new URL(url).hostname === 'api.lightreel.ai') {
      count++;
      return count === 1 ? Response.json({ conversationId: 'known-chat' }) :
        Response.json({ conversationId: 'known-chat', messages: [{ role: 'assistant', answer: { urls: [] } }] });
    }
    return fallback(url, init);
  } });
  const guard = fakeGuard(); const batch = await p.recommend(dna, guard.context);
  assert.equal(count, 2); assert.deepEqual(batch.ideas, []);
  assert.deepEqual(guard.calls.map(c => c.key), ['research', 'poll:0']);
});
test('missing research ID and HTTP failures stop after one call and keep raw diagnostics out of errors', async () => {
  const { dna } = await setup(); const f = providerHttpFixture();
  for (const response of [Response.json({ answer: { urls: [] } }), new Response('sensitive error', { status: 500 })]) {
    let calls = 0;
    const p = createCreatorPipelineProvider({ ...f.options, fetch: async () => { calls++; return response; } });
    await assert.rejects(p.recommend(dna, fakeGuard().context), /creator_provider_(malformed|transport)/);
    assert.equal(calls, 1);
  }
});
test('scan bounds and identity checks reject before more paid calls', async () => {
  const f = providerHttpFixture(); const p = createCreatorPipelineProvider(f.options);
  await assert.rejects(p.scan({ ...f.input.request, max_videos: 11 }, fakeGuard().context), /exceeds/);
  assert.equal(f.http.length, 0);
  await assert.rejects(p.scan({ ...f.input.request, supplied_url: 'https://www.tiktok.com/@different' }, fakeGuard().context), /unavailable/);
  assert.equal(f.http.length, 1);
});
test('selected scripts use captured corrected DNA; stale version and uncited source IDs fail', async () => {
  const { f, provider, dna } = await setup();
  dna.version = 2;
  dna.claims[0] = { ...dna.claims[0]!, basis: 'user_corrected', supersedes_claim_id: dna.claims[0]!.id,
    id: crypto.randomUUID(), statement: 'My topic is practical desk organization.' };
  const batch = await provider.recommend(dna, fakeGuard().context);
  const before = f.http.length;
  await assert.rejects(provider.generate({ batch, idea_id: batch.ideas[0]!.id, dna: { ...dna, version: 3 } }, fakeGuard().context), /lineage/);
  assert.equal(f.http.length, before);
  const wrong = createCreatorPipelineProvider({ ...f.options, fetch: async () => Response.json({ id: 'resp-bad', status: 'completed',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify({ variants: creatorScriptsFixture().variants.map(({id: _id, ...v}) => ({ ...v, reference_ids: [crypto.randomUUID()] })) }) }] }] }) });
  await assert.rejects(wrong.generate({ batch, idea_id: batch.ideas[0]!.id, dna }, fakeGuard().context), /malformed/);
  const researchBody = JSON.parse(f.http.find(h => new URL(h.url).hostname === 'api.lightreel.ai')!.init.body as string);
  assert.match(researchBody.question, /practical desk organization/);
});

test('enrichment never exceeds three distinct videos even when discovery supplies duplicates and extra URLs', async () => {
  const { dna } = await setup(); const f = providerHttpFixture(); const fallback = f.options.fetch;
  const seen: string[] = [];
  const p = createCreatorPipelineProvider({ ...f.options, fetch: async (url, init) => {
    const u = new URL(url);
    if (u.hostname === 'api.lightreel.ai') return Response.json({ conversationId: 'bounded', answer: {
      urls: [1, 1, 2, 3, 4, 5].map(id => `https://www.tiktok.com/@fictional_kettle_creator/video/${id}`) } });
    if (u.pathname === '/v2/tiktok/video') {
      const requested = u.searchParams.get('url')!; seen.push(requested);
      const response = await fallback(url, init); const body = await response.json() as any;
      body.aweme_detail.aweme_id = requested.split('/').at(-1);
      return Response.json(body);
    }
    return fallback(url, init);
  } });
  const guard = fakeGuard(); const batch = await p.recommend(dna, guard.context);
  assert.equal(seen.length, 3); assert.equal(new Set(seen).size, 3);
  assert.equal(batch.references.length, 3); assert.equal(batch.ideas.length, 3);
  assert.equal(guard.calls.length, 4);
});
test('cursor chains stop on unknown or repeated cursors, retaining coverage and conflicting observations', async () => {
  for (const hasMore of [undefined, true]) {
    const f = providerHttpFixture(); const fallback = f.options.fetch; let pages = 0;
    const p = createCreatorPipelineProvider({ ...f.options, fetch: async (url, init) => {
      const response = await fallback(url, init);
      if (new URL(url).pathname !== '/v3/tiktok/profile/videos') return response;
      pages++; const body = await response.json() as any;
      body.has_more = hasMore; body.max_cursor = '42';
      body.cached = true; body.cached_at = pages === 1 ? '2026-10-08T00:00:00Z' : '2026-10-09T00:00:00Z';
      body.aweme_list[0].statistics.play_count = pages === 1 ? null : 99;
      return Response.json(body);
    } });
    const analysis = await p.scan(f.input.request, fakeGuard().context);
    assert.equal(pages, hasMore ? 2 : 1);
    assert.equal(analysis.scan.coverage.unique_videos, 1);
    assert.equal(analysis.scan.video_observations.length, pages);
    assert.equal(analysis.scan.video_observations[0]!.metrics.views, null);
    assert.equal(analysis.scan.video_observations[0]!.provenance.source_observed_at, '2026-10-08T00:00:00.000Z');
  }
});
test('source rights predicate must approve the exact captured snapshot and version before research', async () => {
  const { dna } = await setup(); const f = providerHttpFixture();
  const p = createCreatorPipelineProvider({ ...f.options,
    canProcessDna: view => view.dna_id === dna.dna_id && view.snapshot_id === dna.snapshot_id && view.version === dna.version });
  await assert.rejects(p.recommend({ ...dna, version: dna.version + 1 }, fakeGuard().context), /permission/);
  await assert.rejects(p.recommend({ ...dna, snapshot_id: crypto.randomUUID() }, fakeGuard().context), /permission/);
  assert.equal(f.http.length, 0);
});

test('absent OpenAI credential permits scan/recommend but generation fails before any guard or HTTP call', async () => {
  const f = providerHttpFixture();
  const { openai: _openai, ...credentials } = f.options.credentials;
  const provider = createCreatorPipelineProvider({ ...f.options, credentials });
  const scanGuard = fakeGuard();
  const analysis = await provider.scan(f.input.request, scanGuard.context);
  const dna = projectCreatorDna({ dna_id: analysis.dna.id,
    project_id: '00000000-0000-4000-8000-000000000100', analysis });
  const recommendationGuard = fakeGuard();
  const batch = await provider.recommend(dna, recommendationGuard.context);
  assert.equal(batch.ideas.length, 1);
  assert.equal(scanGuard.calls.length, 2);
  assert.equal(recommendationGuard.calls.length, 2);
  const generationGuard = fakeGuard();
  let guardCalls = 0;
  generationGuard.context.call = async () => { guardCalls++; throw Error('must not reserve'); };
  const httpBefore = f.http.length;
  await assert.rejects(provider.generate({ batch, idea_id: batch.ideas[0]!.id, dna }, generationGuard.context), /Missing OpenAI provider credential/);
  assert.equal(guardCalls, 0);
  assert.equal(f.http.length, httpBefore);
});
test('optional OpenAI does not relax required scan/recommend credentials', () => {
  const f = providerHttpFixture();
  for (const credentials of [{ scrapeCreators: '', lightreel: 'synthetic-lr' },
    { scrapeCreators: 'synthetic-sc', lightreel: '' }]) {
    assert.throws(() => createCreatorPipelineProvider({ ...f.options, credentials }), /Missing provider credential/);
  }
  assert.equal(f.http.length, 0);
});

test('provider publishes stable truthful checkpoints only after validated boundaries',async()=>{
 const f=providerHttpFixture();const provider=createCreatorPipelineProvider(f.options);const scan=fakeGuard();
 const analysis=await provider.scan(f.input.request,scan.context);
 assert.deepEqual((scan as any).checkpoints.map((entry:any)=>[entry.key,entry.stage]),[
  ['scan:profile:start','reading_profile'],['scan:profile','reading_posts'],['scan:feed:0','reading_posts'],
  ['scan:analysis','building_analysis'],['scan:save','saving']]);
 const profile=(scan as any).checkpoints.find((entry:any)=>entry.key==='scan:profile').progress.profile;
 assert.equal(profile.handle,'fictional_kettle_creator');assert.equal('provider' in profile.provenance,false);
 const feed=(scan as any).checkpoints.find((entry:any)=>entry.key==='scan:feed:0').progress;
 assert.equal(feed.videos.length,1);assert.doesNotMatch(JSON.stringify(feed),/credits_charged|aweme_list|receipt|body/);
 const dna=projectCreatorDna({dna_id:analysis.dna.id,project_id:'00000000-0000-4000-8000-000000000100',analysis});
 const recommendations=fakeGuard();await provider.recommend(dna,recommendations.context);
 assert.deepEqual((recommendations as any).checkpoints.map((entry:any)=>[entry.key,entry.stage]),[
  ['recommend:research:start','researching_formats'],['recommend:identities','enriching_references'],
  ['recommend:detail:9000000000000000011','enriching_references'],['recommend:save','saving']]);
 const identities=(recommendations as any).checkpoints[1].progress;
 assert.equal(identities.identities.length,1);assert.deepEqual(identities.references,[]);
 assert.doesNotMatch(JSON.stringify(identities),/conversation/i);
});

test('supplied-video scan publishes review stage before any provider request',async()=>{
 const f=providerHttpFixture();f.options.seedUrl=`${f.input.request.supplied_url}/video/9000000000000000011`;
 const fallback=f.options.fetch;f.options.fetch=async(url,init)=>new URL(url).hostname==='api.lightreel.ai'
  ? Response.json({conversationId:'seed-fixture',answer:{video_url:f.options.seedUrl,summary:'Reviewed fixture video.',access_basis:'video_access_reported',limitations:[]}})
  : fallback(url,init);
 const guard=fakeGuard();await createCreatorPipelineProvider(f.options).scan(f.input.request,guard.context);
 assert.deepEqual((guard as any).checkpoints.slice(0,2).map((entry:any)=>[entry.key,entry.stage]),[
  ['scan:seed:start','reviewing_video'],['scan:profile:start','reading_profile']]);
 assert.equal(guard.calls[0]!.key,'seed-review');
});

test('provider failure retains only the truthful pre-call checkpoint',async()=>{
 const f=providerHttpFixture();f.options.fetch=async()=>{throw new Error('offline transport failure');};const scan=fakeGuard();
 await assert.rejects(createCreatorPipelineProvider(f.options).scan(f.input.request,scan.context),/transport/);
 assert.deepEqual(scan.checkpoints.map(entry=>[entry.key,entry.stage]),[['scan:profile:start','reading_profile']]);

 const setupResult=await setup(),recommendations=fakeGuard();let calls=0;
 const failing=createCreatorPipelineProvider({...setupResult.f.options,fetch:async(url,init)=>{
  calls++;if(new URL(url).pathname==='/v2/tiktok/video')throw new Error('detail transport failure');
  return setupResult.f.options.fetch(url,init);
 }});
 await assert.rejects(failing.recommend(setupResult.dna,recommendations.context),/transport/);
 assert.deepEqual(recommendations.checkpoints.map(entry=>[entry.key,entry.stage]),[
  ['recommend:research:start','researching_formats'],['recommend:identities','enriching_references']]);
 assert.equal(calls,2);
});

test('duplicate-only feed pages do not publish identical progress revisions',async()=>{
 const f=providerHttpFixture(),fallback=f.options.fetch;let pages=0;
 f.options.fetch=async(url,init)=>{const response=await fallback(url,init);if(new URL(url).pathname!=='/v3/tiktok/profile/videos')return response;
  pages++;const body=await response.json() as any;body.has_more=pages===1;body.max_cursor='42';return Response.json(body);};
 const guard=fakeGuard();await createCreatorPipelineProvider(f.options).scan(f.input.request,guard.context);
 assert.equal(pages,2);assert.deepEqual(guard.checkpoints.filter(entry=>entry.key.startsWith('scan:feed:')).map(entry=>entry.key),['scan:feed:0']);
});
