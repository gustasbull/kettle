import test from 'node:test';
import assert from 'node:assert/strict';
import { isCreatorJobView,parseCreatorJobView } from '../../apps/panel/riff-home-validation.ts';
import { pipelineFixture } from '../../apps/panel/creator-pipeline/fixtures.ts';
import { CreatorJobView } from '../../packages/contracts/creator-pipeline.ts';

function scanJob() {
  const job = structuredClone(pipelineFixture('scan'));
  if (job.result?.kind !== 'scan') throw new Error('Expected scan fixture');
  return { job, dna: job.result.dna };
}

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
