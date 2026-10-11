import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { creatorJobFixture } from '../../evals/creator-loop/pipeline-fixtures.ts';
import {
  createCreatorPipelineController,
  type CreatorPipelineLimits,
  type CreatorPipelineSnapshot,
} from '../../apps/panel/creator-pipeline-controller.ts';
import {
  creatorJobStatusStructuredOutput,
  riffVideosStructuredOutput,
} from '../../apps/panel/creator-pipeline-validation.ts';
import { emptyCreatorJobProgress, type CreatorJobStatusView, type CreatorJobView } from '../../packages/contracts/creator-pipeline.ts';

const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
const jobOutput = (job: CreatorJobView) => ({ ok: true as const, data: { job } });
const statusOutput = (status: CreatorJobStatusView) => ({ ok: true as const, data: { status } });
const makeStatus = (job: CreatorJobView, patch: Partial<CreatorJobStatusView> = {}): CreatorJobStatusView => ({
  id: job.id,
  kind: job.kind,
  state: job.state,
  stage: job.stage,
  revision: job.revision,
  created_at: job.created_at,
  updated_at: job.updated_at,
  progress: structuredClone(job.progress),
  terminal_result_available: job.state === 'succeeded',
  ...patch,
});

function setup(t: TestContext, overrides: Partial<CreatorPipelineLimits> = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 });
  const snapshots: CreatorPipelineSnapshot[] = [];
  const notices: string[] = [];
  const clears: string[] = [];
  const statusCalls: Array<{ input: { job_id: string }; signal: AbortSignal; resolve(value: unknown): void }> = [];
  const fullCalls: Array<{ input: { job_id: string }; signal: AbortSignal; resolve(value: unknown): void }> = [];
  const controller = createCreatorPipelineController({
    loading() {},
    job(snapshot, state) {
      snapshots.push(Object.assign(structuredClone(snapshot.job), { job: structuredClone(snapshot.job), ...(snapshot.status ? { status: structuredClone(snapshot.status) } : {}) }));
      if (state.notice) notices.push(state.notice);
    },
    cleared(reason) { clears.push(reason); },
  }, {
    readStatus: (input, signal) => new Promise(resolve => statusCalls.push({ input, signal, resolve })),
    readFull: (input, signal) => new Promise(resolve => fullCalls.push({ input, signal, resolve })),
  }, {
    timeoutMs: 100,
    pollIntervalMs: 250,
    maxPollIntervalMs: 400,
    maxPolls: 10,
    pollWindowMs: 600_000,
    random: () => 0.5,
    ...overrides,
  });
  t.after(() => controller.dispose());
  const tick = async (ms: number) => { t.mock.timers.tick(ms); await flush(); };
  return { controller, snapshots, notices, clears, statusCalls, fullCalls, tick };
}

test('strict compact status and catalog boundaries accept only structured public envelopes', () => {
  const job = creatorJobFixture('scan');
  job.state = 'running'; job.result = null; job.revision = 2; job.stage = 'reading_profile';
  job.progress = { kind: 'scan', profile: null, videos: [], limitations: [] };
  const status = statusOutput(makeStatus(job));
  assert.deepEqual(creatorJobStatusStructuredOutput({ structuredContent: status }), status);
  assert.equal(creatorJobStatusStructuredOutput({ content: [{ type: 'text', text: JSON.stringify(status) }] }), undefined);
  assert.equal(creatorJobStatusStructuredOutput({ structuredContent: { ...status, private: true } }), undefined);

  const catalog = { ok: true as const, data: { cards: [], next_cursor: 'opaque-do-not-follow', coverage: 'Saved observations only.', freshness: 'As last observed.' } };
  assert.deepEqual(riffVideosStructuredOutput({ structuredContent: catalog }), catalog);
  assert.equal(riffVideosStructuredOutput({ structuredContent: { ...catalog, secret: true } }), undefined);
});

test('polls compact status, suppresses equal revisions, and reads the full job exactly once at success', async t => {
  const f = setup(t);
  const initial = creatorJobFixture('scan');
  initial.state = 'running'; initial.result = null; initial.revision = 1; initial.stage = 'reading_profile';
  initial.progress = { kind: 'scan', profile: null, videos: [], limitations: [] };
  f.controller.receiveInput({ job_id: initial.id });
  f.controller.receiveResult(jobOutput(initial));
  f.controller.connected(true);
  assert.equal(f.snapshots.at(-1)?.job.revision, 1);
  assert.equal(structuredClone(f.snapshots.at(-1))?.job.revision,1,'nested snapshot identity survives structured cloning');
  assert.equal(f.statusCalls.length, 1); assert.equal(f.fullCalls.length, 0);
  f.statusCalls[0]!.resolve(statusOutput(makeStatus(initial))); await flush();
  assert.equal(f.snapshots.filter(item => item.status?.revision === 1).length, 0, 'equal status revisions do not rerender');

  await f.tick(400);
  const terminalStatus = makeStatus(initial, {
    state: 'succeeded', stage: 'saving', revision: 2, updated_at: '2026-10-11T12:00:00Z',
    progress: { kind: 'scan', profile: null, videos: [], limitations: [] }, terminal_result_available: true,
  });
  f.statusCalls[1]!.resolve(statusOutput(terminalStatus)); await flush();
  assert.equal(f.fullCalls.length, 1);
  const terminal = creatorJobFixture('scan'); terminal.revision = 2;
  f.fullCalls[0]!.resolve(jobOutput(terminal)); await flush();
  assert.equal(f.snapshots.at(-1)?.job.state, 'succeeded');
  assert.equal(f.fullCalls.length, 1);
  await f.tick(500); assert.equal(f.statusCalls.length, 2);
});

test('streams monotonic progress and rejects contradictory same revisions without replacing the prior view', async t => {
  const f = setup(t);
  const initial = creatorJobFixture('recommendations');
  initial.state = 'running'; initial.result = null; initial.revision = 1; initial.stage = 'researching_formats';
  initial.progress = emptyCreatorJobProgress('recommendations');
  f.controller.receiveInput({ job_id: initial.id }); f.controller.receiveResult(jobOutput(initial)); f.controller.connected(true);
  assert.equal(f.statusCalls.length,1);
  const first = makeStatus(initial, { revision: 2, progress: { kind: 'recommendations', identities: [], references: [], limitations: ['Still gathering references.'] } });
  f.statusCalls[0]!.resolve(statusOutput(first)); await flush();
  assert.deepEqual(f.snapshots.at(-1)?.status?.progress, first.progress);
  await f.tick(400);
  const contradiction = structuredClone(first); contradiction.progress.limitations = ['Different at same revision.'];
  f.statusCalls[1]!.resolve(statusOutput(contradiction)); await flush();
  assert.deepEqual(f.clears, []);
  assert.deepEqual(f.snapshots.at(-1)?.status?.progress, first.progress);
  assert.match(f.notices.at(-1) ?? '', /contradictory/i);
});

test('retains streamed progress and limitations on terminal failure without a full read', async t => {
  const f = setup(t);
  const job = creatorJobFixture('recommendations');
  job.state = 'running'; job.result = null; job.revision = 1; job.stage = 'researching_formats';
  job.progress = emptyCreatorJobProgress('recommendations');
  f.controller.receiveInput({ job_id: job.id }); f.controller.receiveResult(jobOutput(job)); f.controller.connected(true);
  assert.equal(f.statusCalls.length,1);
  const progress = { kind: 'recommendations' as const, identities: [], references: [], limitations: ['Still gathering references.'] };
  const failed = makeStatus(job, { state: 'failed', revision: 2, progress, terminal_result_available: false });
  f.statusCalls[0]!.resolve(statusOutput(failed)); await flush();
  assert.equal(f.snapshots.at(-1)?.status?.state, 'failed');
  assert.deepEqual(f.snapshots.at(-1)?.status?.progress, progress);
  assert.equal(f.fullCalls.length, 0);
});

test('uses bounded jitter, pauses while hidden, resumes against the same deadline and disposes pending work', async t => {
  const f = setup(t, { pollIntervalMs: 250, maxPollIntervalMs: 250, random: () => 1 });
  const job = creatorJobFixture('scan'); job.state = 'running'; job.result = null; job.revision = 1;
  job.stage = 'reading_profile'; job.progress = { kind: 'scan', profile: null, videos: [], limitations: [] };
  f.controller.receiveInput({ job_id: job.id }); f.controller.receiveResult(jobOutput(job)); f.controller.connected(true);
  assert.equal(f.statusCalls.length,1,'first status read is immediate');
  f.statusCalls[0]!.resolve(statusOutput(makeStatus(job, { revision: 2 }))); await flush();
  await f.tick(299);assert.equal(f.statusCalls.length,1);
  await f.tick(1);assert.equal(f.statusCalls.length,2,'+20% jitter is bounded');
  f.statusCalls[1]!.resolve(statusOutput(makeStatus(job,{revision:2})));await flush();
  f.controller.visibilityChanged(true); await f.tick(5_000); assert.equal(f.statusCalls.length, 2);
  f.controller.visibilityChanged(false); await flush(); assert.equal(f.statusCalls.length, 3, 'visible resume reads immediately');
  f.controller.dispose(); assert.equal(f.statusCalls[2]!.signal.aborted, true);
});

test('transient compact-status failures retain progress and back off without clearing',async t=>{
  const f=setup(t);const job=creatorJobFixture('scan');job.state='running';job.result=null;job.revision=1;
  job.stage='reading_profile';job.progress={kind:'scan',profile:null,videos:[],limitations:[]};
  f.controller.receiveInput({job_id:job.id});f.controller.receiveResult(jobOutput(job));f.controller.connected(true);
  f.statusCalls[0]!.resolve({ok:false,error:{code:'UNAVAILABLE',message:'Temporarily unavailable.',retryable:true,recovery:'retry_same_request'}});await flush();
  assert.deepEqual(f.clears,[]);assert.equal(f.snapshots.at(-1)?.job.id,job.id);assert.match(f.notices.at(-1)??'',/delayed|retry/i);
  await f.tick(399);assert.equal(f.statusCalls.length,1);await f.tick(1);assert.equal(f.statusCalls.length,2);
});

test('connected-before-input ordering performs one initial full read',async t=>{
  const f=setup(t);const job=creatorJobFixture('scan');job.state='running';job.result=null;job.revision=1;
  job.stage='reading_profile';job.progress={kind:'scan',profile:null,videos:[],limitations:[]};
  f.controller.connected(true);f.controller.receiveInput({job_id:job.id});
  await f.tick(0);assert.equal(f.fullCalls.length,1);assert.deepEqual(f.fullCalls[0]!.input,{job_id:job.id});
  f.fullCalls[0]!.resolve(jobOutput(job));await flush();
  assert.equal(f.snapshots.at(-1)?.job.id,job.id);assert.equal(f.fullCalls.length,1);
  assert.equal(f.statusCalls.length,1,'the compact status read begins immediately after the initial full view');
});

test('explicit same-job reopen starts a fresh active observation session without terminal reactivation',async t=>{
  const f=setup(t,{maxPolls:2});const job=creatorJobFixture('scan');job.state='running';job.result=null;job.revision=1;
  job.stage='reading_profile';job.progress={kind:'scan',profile:null,videos:[],limitations:[]};
  f.controller.receiveInput({job_id:job.id});f.controller.receiveResult(jobOutput(job));f.controller.connected(true);
  assert.equal(f.statusCalls.length,1);f.statusCalls[0]!.resolve(statusOutput(makeStatus(job)));await flush();
  await f.tick(400);assert.equal(f.statusCalls.length,2);f.statusCalls[1]!.resolve(statusOutput(makeStatus(job)));await flush();
  assert.match(f.notices.at(-1)??'',/Automatic updates paused/i);
  f.controller.receiveResult(jobOutput(job));await flush();
  assert.equal(f.statusCalls.length,3,'an explicit reopen resets the paused observation budget');
  f.statusCalls[2]!.resolve(statusOutput(makeStatus(job)));await flush();
  await f.tick(400);assert.equal(f.statusCalls.length,4,'polling continues after the fresh reopen');
  f.statusCalls[3]!.resolve(statusOutput(makeStatus(job)));await flush();
  const terminal=creatorJobFixture('scan');terminal.revision=2;
  f.controller.receiveResult(jobOutput(terminal));await flush();
  const reactivated=structuredClone(job);reactivated.revision=3;
  f.controller.receiveResult(jobOutput(reactivated));await flush();
  assert.notEqual(f.snapshots.at(-1)?.job.state,'running','a terminal full result cannot reactivate');
});
