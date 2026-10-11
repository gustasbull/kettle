import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creatorJobFixture, recommendationBatchFixture } from '../../evals/creator-loop/pipeline-fixtures.ts';
import { creatorFailure } from '../../packages/application/creator-operations.ts';
import { CreatorJobOutput } from '../../packages/contracts/creator-pipeline.ts';
import { StartRiffCreatorOutput } from '../../packages/contracts/riff-creator.ts';
import { creatorJobStructuredOutput, parseCreatorJobOutput, parseGetCreatorJobInput, parseStartRiffCreatorInput } from '../../apps/panel/creator-pipeline-validation.ts';

const id=(value:number)=>`00000000-0000-4000-8000-${String(value).padStart(12,'0')}`;
const envelope=(kind:'scan'|'recommendations'|'scripts')=>({ok:true as const,data:{job:creatorJobFixture(kind)}});
const invalid=(kind:'scan'|'recommendations'|'scripts',mutate:(job:any)=>void)=>{
  const value=structuredClone(envelope(kind));mutate(value.data.job);return value;
};

function validStartOutput(kind:'profile'|'video'='profile') {
  const job=creatorJobFixture('scan');job.state='queued';job.revision=1;job.result=null;job.source_kind=kind;
  const projectId=job.project_id,createdAt=job.created_at,handle='fixture';
  const profileUrl=`https://www.tiktok.com/@${handle}`;
  const videoUrl=kind==='video'?`${profileUrl}/video/9000000000000000011`:null;
  const parsed=StartRiffCreatorOutput.parse({ok:true,data:{
    project:{id:projectId,name:'@fixture creator work',project_type:'brand',current_version:1,created_at:createdAt,updated_at:createdAt,
      brief_version:{id:id(621),project_id:projectId,version:1,name:'@fixture creator work',created_at:createdAt,
        brief:{product:'Creator profile @fixture',audience:'Unknown until analysis',goal:'Find a tailored next video direction',tone:'Creator-led',language:'en',duration_seconds:30,filming_constraints:['Treat missing data as unknown'],facts:[]}}},
    job,source:{platform:'tiktok',kind,handle,canonical_url:videoUrl??profileUrl,profile_url:profileUrl,video_url:videoUrl},
  }});
  if(!parsed.ok)throw new Error('fixture start output must succeed');
  return parsed;
}

for(const kind of ['scan','recommendations','scripts'] as const)test(`valid ${kind} result is copied at the display boundary`,()=>{
  const job=creatorJobFixture(kind),raw={ok:true as const,data:{job}};
  const parsed=parseCreatorJobOutput(raw);assert.deepEqual(parsed,raw);assert.notEqual(parsed,raw);assert.notEqual(parsed?.data,raw.data);
});
for(const code of ['UNAUTHENTICATED','FORBIDDEN','VALIDATION_ERROR','NOT_FOUND','VERSION_CONFLICT','IDEMPOTENCY_CONFLICT','UNAVAILABLE'] as const)
  test(`accepts public failure ${code}`,()=>assert.deepEqual(parseCreatorJobOutput(creatorFailure(code)),creatorFailure(code)));

test('display validation fails closed for malformed, hostile and oversized values',()=>{
  const job=creatorJobFixture('recommendations');
  const nested=structuredClone(job);
  if(nested.result?.kind==='recommendations')Object.assign(nested.result.batch.references[0]!,{secret:'private'});
  for(const raw of [
    {ok:true,data:{job:{...job,secret:'private'}}},
    {ok:true,data:{job:{...job,id:'bad'}}},
    {ok:true,data:{job:{...job,revision:NaN}}},
    {ok:true,data:{job:{...job,message:'x'.repeat(1_600_000)}}},
    Object.create({ok:true}),
    {ok:true,data:{job:nested}},
    'not-an-envelope',
  ])assert.equal(parseCreatorJobOutput(raw),undefined);
  const hostile:Record<string,unknown>={};Object.defineProperty(hostile,'ok',{get(){throw new Error('getter');}});
  assert.doesNotThrow(()=>parseCreatorJobOutput(hostile));assert.equal(parseCreatorJobOutput(hostile),undefined);
});

test('DNA mutations rejected by server contracts are rejected at the display boundary',()=>{
  const cases:Array<[string,(job:any)=>void]>=[
    ['observed claim without evidence',job=>{job.result.dna.claims[0].evidence=[];}],
    ['user correction without superseded claim',job=>{const claim=job.result.dna.claims[0];claim.basis='user_corrected';claim.supersedes_claim_id=null;claim.evidence=[];}],
    ['observed claim that supersedes another claim',job=>{job.result.dna.claims[0].supersedes_claim_id=id(999);}],
    ['video-required claim without video evidence',job=>{job.result.dna.claims[0].requires_video=true;}],
    ['pacing claim without video evidence',job=>{job.result.dna.claims[0].dimension='pacing';}],
  ];
  for(const [name,mutate] of cases){
    const raw=invalid('scan',mutate);
    assert.equal(CreatorJobOutput.safeParse(raw).success,false,`${name}: authoritative contract`);
    assert.equal(parseCreatorJobOutput(raw),undefined,`${name}: local validator`);
  }
  const duplicate=invalid('scan',job=>{job.result.dna.claims.push(structuredClone(job.result.dna.claims[0]));});
  assert.equal(parseCreatorJobOutput(duplicate),undefined,'claim IDs remain unique after public projection');
});

test('display validator rejects the remaining bounded DNA mutations accepted by loose JSON checks',()=>{
  const validSeedReview=()=>({
    url:'https://www.tiktok.com/@fictional_kettle_creator/video/9000000000000000011',provider:'lightreel',
    summary:'A bounded fixture review.',access_basis:'video_access_reported',
    dimensions:['hook','content','style_pacing','voice_language','script','cta'].map(dimension=>({
      dimension,status:'working_well',summary:`${dimension} summary`,
    })),limitations:[],retrieved_at:'2026-10-09T12:00:00Z',origin:'fixture',
  });
  const cases:Array<[string,(job:any)=>void]>=[
    ['calendar-invalid created timestamp',job=>{job.created_at='2026-02-30T12:00:00Z';}],
    ['date-only evidence timestamp',job=>{job.result.dna.evidence[0].retrieved_at='2026-10-09';}],
    ['coverage beyond public maximum',job=>{job.result.dna.coverage.unique_videos=51;}],
    ['present invalid profile summary',job=>{job.result.dna.profile_summary=null;}],
    ['zero evidence duration',job=>{job.result.dna.evidence[0].duration_seconds=0;}],
    ['seed review profile URL',job=>{job.result.dna.seed_review={...validSeedReview(),url:'https://www.tiktok.com/@fictional_kettle_creator'};}],
    ['duplicate seed review dimension',job=>{const review=validSeedReview();review.dimensions[5]=structuredClone(review.dimensions[0]!);job.result.dna.seed_review=review;}],
  ];
  for(const [name,mutate] of cases){
    const raw=invalid('scan',mutate);
    assert.equal(CreatorJobOutput.safeParse(raw).success,false,`${name}: authoritative contract`);
    assert.equal(parseCreatorJobOutput(raw),undefined,`${name}: local validator`);
  }
});

test('recommendation reference pairing, identity, lineage and fixture disclosure match the server contract',()=>{
  const cases:Array<[string,(job:any)=>void]>=[
    ['multiplier without basis',job=>{job.result.batch.references[0].view_multiplier=2;}],
    ['basis without multiplier',job=>{job.result.batch.references[0].view_multiplier_basis={method:'median_observed_profile_views',baseline_views:60,sample_size:1};}],
    ['multiplier without observed views',job=>{const ref=job.result.batch.references[0];ref.views=null;ref.view_multiplier=2;ref.view_multiplier_basis={method:'median_observed_profile_views',baseline_views:60,sample_size:1};}],
    ['malformed multiplier basis',job=>{const ref=job.result.batch.references[0];ref.view_multiplier=2;ref.view_multiplier_basis={method:'median_observed_profile_views',baseline_views:60,sample_size:1,secret:true};}],
    ['zero reference duration',job=>{job.result.batch.references[0].duration_seconds=0;}],
    ['duplicate reference ID',job=>{const ref=structuredClone(job.result.batch.references[0]);ref.native_id='9000000000000000012';ref.url='https://www.tiktok.com/@fictional_kettle_creator/video/9000000000000000012';job.result.batch.references.push(ref);}],
    ['duplicate native reference ID',job=>{const ref=structuredClone(job.result.batch.references[0]);ref.id=id(699);ref.url='https://www.tiktok.com/@fictional_kettle_creator/video/9000000000000000012';job.result.batch.references.push(ref);}],
    ['duplicate idea ID',job=>{job.result.batch.ideas.push(structuredClone(job.result.batch.ideas[0]));}],
    ['idea cites absent reference',job=>{job.result.batch.ideas[0].reference_ids=[id(999)];}],
    ['fixture reference hidden by batch flag',job=>{job.result.batch.contains_fixture_data=false;}],
  ];
  for(const [name,mutate] of cases){
    const raw=invalid('recommendations',mutate);
    assert.equal(CreatorJobOutput.safeParse(raw).success,false,`${name}: authoritative contract`);
    assert.equal(parseCreatorJobOutput(raw),undefined,`${name}: local validator`);
  }
});

test('contract-valid UUID, limitation and canonical-source edges stay accepted locally',()=>{
  const nilId=invalid('scan',job=>{job.id='00000000-0000-0000-0000-000000000000';});
  assert.equal(CreatorJobOutput.safeParse(nilId).success,true);
  assert.ok(parseCreatorJobOutput(nilId));

  const emptyLimitation=invalid('scan',job=>{job.result.dna.limitations=[''];});
  assert.equal(CreatorJobOutput.safeParse(emptyLimitation).success,true);
  assert.ok(parseCreatorJobOutput(emptyLimitation));

  const instagramVideo=validStartOutput('video');
  const url='https://www.instagram.com/@fixture/video/9000000000000000011';
  instagramVideo.data.source.video_url=url;instagramVideo.data.source.canonical_url=url;
  assert.equal(StartRiffCreatorOutput.safeParse(instagramVideo).success,true);
  assert.deepEqual(creatorJobStructuredOutput({structuredContent:instagramVideo}),{ok:true,data:{job:instagramVideo.data.job}});
});

test('script timing, hashtags, unique variants and persisted lineage match the server contract',()=>{
  const withContext=()=>invalid('scripts',job=>{
    const batch=recommendationBatchFixture();job.result.scripts.idea=structuredClone(batch.ideas[0]);job.result.scripts.references=structuredClone(batch.references);
  });
  const cases:Array<[string,()=>any,(job:any)=>void]>=[
    ['duration over 180 seconds',()=>envelope('scripts'),job=>{job.result.scripts.variants[0].estimated_duration_seconds=181;}],
    ['timed segment over 180 seconds',()=>envelope('scripts'),job=>{job.result.scripts.variants[0].timed_segments=[{part:'hook',start_seconds:0,end_seconds:181,spoken_text:'Hook',filming_direction:'Wide'}];}],
    ['invalid hashtag',()=>envelope('scripts'),job=>{job.result.scripts.variants[0].hashtags=['not-a-hashtag'];}],
    ['duplicate variant ID',()=>envelope('scripts'),job=>{job.result.scripts.variants[1].id=job.result.scripts.variants[0].id;}],
    ['duplicate variant label',()=>envelope('scripts'),job=>{job.result.scripts.variants[1].label=job.result.scripts.variants[0].label;}],
    ['persisted idea ID mismatch',withContext,job=>{job.result.scripts.idea.id=id(999);}],
    ['persisted reference set differs from idea',withContext,job=>{job.result.scripts.idea.reference_ids=[];}],
    ['variant cites absent persisted reference',withContext,job=>{job.result.scripts.variants[0].reference_ids=[id(999)];}],
    ['duplicate persisted reference ID',withContext,job=>{job.result.scripts.references.push(structuredClone(job.result.scripts.references[0]));}],
    ['fixture reference hidden by script flag',withContext,job=>{job.result.scripts.contains_fixture_data=false;}],
  ];
  for(const [name,make,mutate] of cases){
    const raw=structuredClone(make());mutate(raw.data.job);
    assert.equal(CreatorJobOutput.safeParse(raw).success,false,`${name}: authoritative contract`);
    assert.equal(parseCreatorJobOutput(raw),undefined,`${name}: local validator`);
  }
  const boundary=invalid('scripts',job=>{job.result.scripts.variants[0].script='x'.repeat(12_000);job.result.scripts.idea={...recommendationBatchFixture().ideas[0],execution:'x'.repeat(4_000)};job.result.scripts.references=recommendationBatchFixture().references;});
  assert.equal(CreatorJobOutput.safeParse(boundary).success,true);
  assert.ok(parseCreatorJobOutput(boundary),'contract-valid text boundaries remain accepted');
});

test('structured results alone are accepted and Riff start output projects only the job',()=>{
  const started=validStartOutput();
  assert.deepEqual(creatorJobStructuredOutput({structuredContent:started}),{ok:true,data:{job:started.data.job}});
  for(const raw of [started,{content:[{type:'text',text:JSON.stringify(started)}]},{_meta:started},{structuredContent:started,isError:true}])
    assert.equal(creatorJobStructuredOutput(raw),undefined);
});

test('Riff start projection validates the complete project, canonical source and cross-object lineage',()=>{
  for(const [name,mutate] of [
    ['project snapshot', (value:any)=>{value.data.project.name='mismatch';}],
    ['project/job ownership', (value:any)=>{value.data.job.project_id=id(999);}],
    ['canonical profile source', (value:any)=>{value.data.source.profile_url='https://www.tiktok.com/@different';}],
    ['source/job kind', (value:any)=>{value.data.job.source_kind='video';}],
    ['scan-only start job', (value:any)=>{value.data.job.kind='recommendations';}],
  ] as const){
    const value=structuredClone(validStartOutput());mutate(value);
    if(!['project/job ownership','source/job kind','scan-only start job'].includes(name))
      assert.equal(StartRiffCreatorOutput.safeParse(value).success,false,`${name}: authoritative contract`);
    assert.equal(creatorJobStructuredOutput({structuredContent:value}),undefined,`${name}: local validator`);
  }
  const video=validStartOutput('video');
  assert.deepEqual(creatorJobStructuredOutput({structuredContent:video}),{ok:true,data:{job:video.data.job}});
});

test('local read and direct-start inputs are exact and bounded',()=>{
  const id='00000000-0000-4000-8000-000000000622';
  assert.deepEqual(parseGetCreatorJobInput({job_id:id}),{job_id:id});
  assert.equal(parseGetCreatorJobInput({job_id:id,account_id:id}),undefined);
  assert.deepEqual(parseStartRiffCreatorInput({request_id:id,source_url:'https://www.tiktok.com/@fixture'}),{request_id:id,source_url:'https://www.tiktok.com/@fixture'});
  for(const raw of [{request_id:'bad',source_url:'https://www.tiktok.com/@fixture'},{request_id:id,source_url:'http://www.tiktok.com/@fixture'},{request_id:id,source_url:'https://user:secret@www.tiktok.com/@fixture'},{request_id:id,source_url:'https://www.tiktok.com/@fixture',account_id:id}])
    assert.equal(parseStartRiffCreatorInput(raw),undefined);
});
