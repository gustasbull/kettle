import test from 'node:test';
import assert from 'node:assert/strict';
import { isCreatorJobView,parseCreatorJobView,parseListRiffWorkResult,parseOnboardingSeenResult } from '../../apps/panel/riff-home-validation.ts';
import { pipelineFixture } from '../../apps/panel/creator-pipeline/fixtures.ts';
import { CreatorJobView } from '../../packages/contracts/creator-pipeline.ts';

function scanJob() {
  const job = structuredClone(pipelineFixture('scan'));
  if (job.result?.kind !== 'scan') throw new Error('Expected scan fixture');
  return { job, dna: job.result.dna };
}

function recentWorkResult() {
  const workState = {
    job_id: '00000000-0000-4000-8000-000000000620',
    variant_id: '00000000-0000-4000-8000-000000000701',
    state: 'saved', version: 1, updated_at: '2026-10-11T12:00:01Z',
  };
  return { structuredContent: { ok: true, data: { work: [{
    project_id: '00000000-0000-4000-8000-000000000100', project_name: 'Saved Studio',
    job_id: workState.job_id, kind: 'scripts', state: 'succeeded', updated_at: '2026-10-11T12:00:00Z',
    source: { platform: 'tiktok', kind: 'video', handle: 'fixture.creator',
      canonical_url: 'https://www.tiktok.com/@fixture.creator/video/7000000000000000001',
      profile_url: 'https://www.tiktok.com/@fixture.creator',
      video_url: 'https://www.tiktok.com/@fixture.creator/video/7000000000000000001' },
    variant_id: workState.variant_id, work_state: workState,
  }] } }, content: [] };
}

test('Home accepts only an exact coherent onboarding completion receipt',()=>{
  const exact=()=>({structuredContent:{ok:true,data:{onboarding_seen_at:'2026-10-11T12:00:00Z'}},content:[]});
  assert.equal(parseOnboardingSeenResult(exact()),'2026-10-11T12:00:00Z');
  const cases:Array<[string,(value:any)=>void]>=[
    ['incoherent isError',value=>{value.isError=true;}],
    ['extra result key',value=>{value.structuredContent.debug=true;}],
    ['extra receipt key',value=>{value.structuredContent.data.account_id='private';}],
    ['missing timestamp',value=>{delete value.structuredContent.data.onboarding_seen_at;}],
    ['calendar-invalid timestamp',value=>{value.structuredContent.data.onboarding_seen_at='2026-02-30T12:00:00Z';}],
    ['permissive Date.parse value',value=>{value.structuredContent.data.onboarding_seen_at='0';}],
  ];
  for(const [name,mutate] of cases){const value=exact();mutate(value);assert.equal(parseOnboardingSeenResult(value),undefined,name);}
});

test('Home parses the exact public recent-work result as one all-or-nothing value', () => {
  const raw = recentWorkResult();
  const parsed = parseListRiffWorkResult(raw);
  assert.deepEqual(parsed, raw.structuredContent.data.work);
  assert.notEqual(parsed, raw.structuredContent.data.work, 'the transport value is cloned at the trust boundary');

  const second = structuredClone(raw.structuredContent.data.work[0]!);
  second.project_name = 'Second valid item';
  second.job_id = '00000000-0000-4000-8000-000000000621';
  second.work_state.job_id = second.job_id;
  raw.structuredContent.data.work.push(second);
  assert.equal(parseListRiffWorkResult(raw)?.length, 2);
});

test('Home rejects hostile recent-work shapes and never salvages valid siblings', () => {
  const cases: Array<[string, (value: any) => void]> = [
    ['incoherent success flag', value => { value.isError = true; }],
    ['extra result key', value => { value.structuredContent.debug = true; }],
    ['extra data key', value => { value.structuredContent.data.cursor = null; }],
    ['extra row key', value => { value.structuredContent.data.work[0].account_id = 'private'; }],
    ['missing nullable key', value => { delete value.structuredContent.data.work[0].variant_id; }],
    ['invalid project UUID', value => { value.structuredContent.data.work[0].project_id = 'project-1'; }],
    ['untrimmed project name', value => { value.structuredContent.data.work[0].project_name = ' Saved Studio '; }],
    ['calendar-invalid timestamp', value => { value.structuredContent.data.work[0].updated_at = '2026-02-30T12:00:00Z'; }],
    ['extra source key', value => { value.structuredContent.data.work[0].source.private = true; }],
    ['profile URL disagrees with handle', value => { value.structuredContent.data.work[0].source.profile_url = 'https://www.tiktok.com/@other'; }],
    ['profile source retains a video', value => {
      const source = value.structuredContent.data.work[0].source;
      source.kind = 'profile'; source.canonical_url = source.profile_url;
    }],
    ['video canonical URL differs', value => { value.structuredContent.data.work[0].source.canonical_url = 'https://www.tiktok.com/@fixture.creator/video/2'; }],
    ['extra work-state key', value => { value.structuredContent.data.work[0].work_state.receipt = 'private'; }],
    ['work-state version exceeds contract', value => { value.structuredContent.data.work[0].work_state.version = 2_147_483_648; }],
    ['work-state job differs', value => { value.structuredContent.data.work[0].work_state.job_id = '00000000-0000-4000-8000-000000000999'; }],
    ['work-state variant differs', value => { value.structuredContent.data.work[0].work_state.variant_id = '00000000-0000-4000-8000-000000000999'; }],
    ['variant lacks work state', value => { value.structuredContent.data.work[0].work_state = null; }],
    ['work state belongs to non-script work', value => { value.structuredContent.data.work[0].kind = 'scan'; }],
    ['work state belongs to unfinished work', value => { value.structuredContent.data.work[0].state = 'running'; }],
    ['one invalid sibling poisons the result', value => {
      const invalid = structuredClone(value.structuredContent.data.work[0]);
      invalid.updated_at = 'not-a-timestamp'; value.structuredContent.data.work.push(invalid);
    }],
  ];
  for (const [name, mutate] of cases) {
    const raw = recentWorkResult(); mutate(raw);
    assert.equal(parseListRiffWorkResult(raw), undefined, name);
  }

  const sparse = recentWorkResult();
  sparse.structuredContent.data.work = new Array(2) as typeof sparse.structuredContent.data.work;
  sparse.structuredContent.data.work[0] = recentWorkResult().structuredContent.data.work[0]!;
  assert.equal(parseListRiffWorkResult(sparse), undefined, 'sparse arrays are not valid JSON results');

  const accessor = recentWorkResult(); let reads = 0;
  Object.defineProperty(accessor.structuredContent.data.work[0], 'project_name', {
    enumerable: true, configurable: true, get() { reads += 1; return 'Restored value'; },
  });
  assert.equal(parseListRiffWorkResult(accessor), undefined);
  assert.equal(reads, 0, 'validation never invokes a hostile transport getter');

  const proxy = new Proxy(recentWorkResult(), { getPrototypeOf() { throw new Error('hostile proxy'); } });
  assert.equal(parseListRiffWorkResult(proxy), undefined);
});

test('Home accepts complete shared creator jobs without bundling the server schema graph', () => {
  for (const scenario of ['video-analysis', 'scan', 'ideas', 'scripts'] as const) {
    assert.equal(isCreatorJobView(pipelineFixture(scenario)), true, scenario);
  }
  const pending = structuredClone(pipelineFixture('video-analysis'));
  pending.state = 'running'; pending.result = null; pending.source_kind = 'video';
  assert.equal(isCreatorJobView(pending), true);
});

test('Home normalizes an omitted legacy work-state collection without weakening exact keys',()=>{
  const legacy:any=structuredClone(pipelineFixture('scripts'));delete legacy.work_states;
  const parsed=parseCreatorJobView(legacy);
  assert.ok(parsed);assert.deepEqual(parsed.work_states,[]);
  assert.equal(Object.hasOwn(legacy,'work_states'),false,'display parsing must not mutate the transport value');
  assert.equal(isCreatorJobView(legacy),true);
  assert.equal(parseCreatorJobView({...legacy,private_receipt:'secret'}),undefined);
});

test('Home rejects malformed nested media and source data before it reaches the Paper UI', () => {
  const scan = structuredClone(pipelineFixture('video-analysis'));
  if (scan.result?.kind !== 'scan' || !scan.result.dna.seed_review) throw new Error('Expected video-analysis fixture');
  scan.result.dna.seed_review.url = 'https://evil.example/video';
  assert.equal(isCreatorJobView(scan), false);

  const recommendations = structuredClone(pipelineFixture('ideas'));
  if (recommendations.result?.kind !== 'recommendations') throw new Error('Expected recommendations fixture');
  recommendations.result.batch.references[0]!.thumbnail_url = 'https://evil.example/cover.jpg';
  assert.equal(isCreatorJobView(recommendations), false);

  const scripts = structuredClone(pipelineFixture('scripts'));
  if (scripts.result?.kind !== 'scripts') throw new Error('Expected scripts fixture');
  scripts.result.scripts.variants[0]!.reference_ids = ['not-an-id'];
  assert.equal(isCreatorJobView(scripts), false);
});

test('Home validates the shared US CDN and reference freshness policy', () => {
  const make = () => {
    const job = structuredClone(pipelineFixture('ideas'));
    if (job.result?.kind !== 'recommendations') throw new Error('Expected recommendations fixture');
    return { job, reference: job.result.batch.references[0]! };
  };
  const dated = make();
  dated.reference.thumbnail_url = 'https://p16-sign.tiktokcdn-us.com/cover.jpeg?x-expires=1&x-signature=fixture';
  Object.assign(dated.reference, { source_observed_at: '2026-10-08T14:30:00.000Z' });
  assert.equal(isCreatorJobView(dated.job), true);
  const unknown = make(); Object.assign(unknown.reference, { source_observed_at: null });
  assert.equal(isCreatorJobView(unknown.job), true);
  assert.equal(isCreatorJobView(make().job), true, 'legacy omission remains accepted');
  const malformed = make(); Object.assign(malformed.reference, { source_observed_at: 'yesterday' });
  assert.equal(isCreatorJobView(malformed.job), false);
  const lookalike = make();
  lookalike.reference.thumbnail_url = 'https://tiktokcdn-us.com.evil.test/cover.jpeg';
  assert.equal(isCreatorJobView(lookalike.job), false);
});

test('Home accepts the public showcase DNA dimension', () => {
  const { job, dna } = scanJob();
  dna.claims[0]!.dimension = 'showcase';

  const contractValidJob = CreatorJobView.parse(job);
  assert.equal(isCreatorJobView(contractValidJob), true);
});

test('Home accepts the public 2,000-character DNA claim boundary', () => {
  const { job, dna } = scanJob();
  dna.claims[0]!.statement = 'x'.repeat(2_000);

  const contractValidJob = CreatorJobView.parse(job);
  assert.equal(isCreatorJobView(contractValidJob), true);
});

test('Home accepts the public maximum of 61 DNA limitations', () => {
  const { job, dna } = scanJob();
  dna.limitations = Array.from(
    { length: 61 },
    (_, index) => `Known limitation ${index + 1}.`,
  );

  const contractValidJob = CreatorJobView.parse(job);
  assert.equal(isCreatorJobView(contractValidJob), true);
});

test('Home validates required safe progress without rendering raw provider or private fields',()=>{
 const job=structuredClone(pipelineFixture('running'));
 job.stage='reading_posts';
 job.progress={kind:'scan',profile:{platform:'tiktok',native_id:'9000000000000000001',
  url:'https://www.tiktok.com/@fictional_kettle_creator',handle:'fictional_kettle_creator',display_name:'Fixture',bio:null,follower_count:null,
  provenance:{origin:'live',retrieved_at:job.created_at,source_observed_at:null,permission_basis:'Fixture display permission.',limitations:[]}},
  videos:[],limitations:[]};job.kind='scan';
 assert.equal(isCreatorJobView(job),true);
 assert.equal(isCreatorJobView({...job,stage:'researching_formats'}),false);
 assert.equal(isCreatorJobView({...job,progress:{...job.progress,receipt:{raw:'secret'}}}),false);
 const mismatch=structuredClone(job);
 if(mismatch.progress.kind!=='scan'||mismatch.progress.profile===null)assert.fail('expected scan progress fixture');
 mismatch.progress.videos=[{platform:'tiktok',native_id:'9000000000000000011',url:'https://www.tiktok.com/@bob/video/9000000000000000011',
  caption:null,published_at:null,duration_seconds:null,metrics:{views:null,likes:null,comments:null,shares:null},
  provenance:structuredClone(mismatch.progress.profile.provenance)}];
 mismatch.progress.profile.url='https://www.tiktok.com/@alice';mismatch.progress.profile.handle='alice';
 assert.equal(isCreatorJobView(mismatch),false,'displayed @alice profile cannot admit an @bob video');
 const queued={...job,state:'queued' as const};
 assert.equal(isCreatorJobView(queued),false,'queued jobs cannot claim partial progress');
});
