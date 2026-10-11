import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createCreatorPipelineController, creatorJobStructuredOutput, creatorJobText, type CreatorPipelineLimits } from '../../apps/panel/creator-pipeline-controller.ts';
import { creatorJobFixture } from '../../evals/creator-loop/pipeline-fixtures.ts';
import { creatorFailure } from '../../packages/application/creator-operations.ts';
import type { CreatorJobView } from '../../packages/contracts/creator-pipeline.ts';
import { StartRiffCreatorOutput } from '../../packages/contracts/riff-creator.ts';

const output = (state: CreatorJobView['state'] = 'running', revision = 1, kind: CreatorJobView['kind'] = 'recommendations') => {
  const job = creatorJobFixture(kind); job.state = state; job.revision = revision;
  if (state !== 'succeeded') job.result = null;
  return { ok: true as const, data: { job } };
};
const startOutput = () => {
  const value = output('running', 1, 'scan');
  const projectId = value.data.job.project_id;
  const createdAt = value.data.job.created_at;
  return StartRiffCreatorOutput.parse({ ok: true, data: {
    project: {
      id: projectId, name: '@fixture creator work', project_type: 'brand', current_version: 1,
      created_at: createdAt, updated_at: createdAt,
      brief_version: {
        id: '00000000-0000-4000-8000-000000000621', project_id: projectId, version: 1,
        name: '@fixture creator work', created_at: createdAt,
        brief: {
          product: 'Creator profile @fixture', audience: 'Unknown until analysis',
          goal: 'Find a tailored next video direction', tone: 'Creator-led', language: 'en',
          duration_seconds: 30, filming_constraints: ['Treat missing data as unknown'], facts: [],
        },
      },
    },
    job: value.data.job,
    source: {
      platform: 'tiktok', kind: 'profile', handle: 'fixture',
      canonical_url: 'https://www.tiktok.com/@fixture',
      profile_url: 'https://www.tiktok.com/@fixture', video_url: null,
    },
  } });
};
const flush = async () => { for (let i=0;i<8;i++) await Promise.resolve(); };
function setup(t: TestContext, limits: CreatorPipelineLimits = {}) {
  t.mock.timers.enable({apis:['setTimeout','Date'], now: 1000});
  let visible: CreatorJobView | undefined;
  let notice: string | undefined, reason: string | undefined;
  const calls: {input:unknown;signal:AbortSignal;resolve:(raw:unknown)=>void;reject:(err:Error)=>void}[] = [];
  const controller = createCreatorPipelineController({
    loading(){visible=undefined;},
    job(job,status){visible=job; notice=status.notice;},
    cleared(value){visible=undefined;reason=value;},
  }, (input,signal)=>new Promise((resolve,reject)=>calls.push({input,signal,resolve,reject})),
  {timeoutMs:100,pollIntervalMs:20,maxPollIntervalMs:20,maxPolls:3,pollWindowMs:200,...limits});
  t.after(()=>controller.dispose());
  const launch=(value=output(), tools=true)=>{
    controller.receiveInput({job_id:value.data.job.id}); controller.receiveResult(value); controller.connected(tools);
  };
  return {controller,calls,launch,visible:()=>visible,notice:()=>notice,reason:()=>reason,
    tick:async(ms:number)=>{t.mock.timers.tick(ms);await flush();}};
}

function observedSetup(t: TestContext) {
  const pollStatuses: string[] = [];
  const fixture = setup(t, { performance: { start(stage) {
    return status => { if (stage === 'poll_observation') pollStatuses.push(status); };
  } } });
  return { ...fixture, pollStatuses };
}

test('requires validated selection and handshake; missing tools displays without reads', async t=>{
  const f=setup(t), value=output();
  f.controller.receiveInput({job_id:value.data.job.id}); f.controller.receiveResult(value);
  assert.equal(f.visible(),undefined); await f.tick(30); assert.equal(f.calls.length,0);
  f.controller.connected(false); await f.controller.refresh(); await f.tick(300);
  assert.deepEqual(f.visible(),value.data.job); assert.equal(f.calls.length,0);
});

test('polling is bounded, only selected read input, one in flight; manual refresh never resets budget',async t=>{
  const f=setup(t); f.launch(); assert.equal(f.calls.length,0);
  for(let i=0;i<3;i++){
    await f.tick(20); assert.equal(f.calls.length,i+1);
    await f.controller.refresh(); assert.equal(f.calls.length,i+1);
    assert.deepEqual(f.calls[i]!.input,{job_id:output().data.job.id});
    f.calls[i]!.resolve(output('running',i+2)); await flush();
  }
  assert.match(f.notice()!,/Automatic updates paused/);
  await f.tick(20); assert.equal(f.calls.length,3);
  const manual=f.controller.refresh(); f.calls[3]!.resolve(output('running',5)); await manual;
  await f.tick(20); assert.equal(f.calls.length,4);
});

test('elapsed window stops new reads independently of count',async t=>{
  const f=setup(t,{pollWindowMs:25,maxPolls:100}); f.launch(); await f.tick(20);
  f.calls[0]!.resolve(output('running',2)); await flush(); await f.tick(5);
  assert.equal(f.calls.length,1); assert.match(f.notice()!,/Automatic updates paused/);
});
test('polling backs off to a cap while staying inside the bounded window',async t=>{
  const f=setup(t,{pollIntervalMs:10,maxPollIntervalMs:25,maxPolls:4,pollWindowMs:200});f.launch();
  await f.tick(9);assert.equal(f.calls.length,0);await f.tick(1);assert.equal(f.calls.length,1);
  f.calls[0]!.resolve(output('running',2));await flush();
  await f.tick(15);assert.equal(f.calls.length,1);await f.tick(1);assert.equal(f.calls.length,2);
  f.calls[1]!.resolve(output('running',3));await flush();
  await f.tick(24);assert.equal(f.calls.length,2);await f.tick(1);assert.equal(f.calls.length,3);
});

for(const state of ['succeeded','failed','needs_reconciliation'] as const) test(`${state} stops polling and aborts older request`,async t=>{
  const f=setup(t);f.launch();await f.tick(20);
  f.controller.receiveResult(output(state,2));
  assert.equal(f.calls[0]!.signal.aborted,true);
  f.calls[0]!.resolve(output('running',3));await flush();await f.tick(300);
  assert.equal(f.visible()?.state,state);assert.equal(f.calls.length,1);
});

for(const field of ['id','project_id','kind','created_at'] as const) test(`rejects mismatched ${field}`,t=>{
  const f=setup(t);f.launch();const next=output('running',2);
  if(field==='kind')next.data.job.kind='scan';
  else if(field==='created_at')next.data.job.created_at='2026-10-08T00:00:00Z';
  else next.data.job[field]='00000000-0000-4000-8000-000000000999';
  f.controller.receiveResult(next);assert.equal(f.visible(),undefined);assert.equal(f.reason(),'invalid');
});

test('rejects lower revisions, contradictory same revision and terminal reactivation', async t=>{
  const f=setup(t);f.launch(output('running',4));
  f.controller.receiveResult(output('running',3));assert.equal(f.visible()?.revision,4);
  assert.match(f.notice()!,/older/);await f.tick(30);assert.equal(f.calls.length,0);
  f.controller.receiveResult(output('queued',4));assert.equal(f.reason(),'invalid');
});
test('same-revision progress contradictions fail closed while newer safe progress remains valid',t=>{
 const f=setup(t),first=output('running',4,'scan');first.data.job.stage='reading_profile';
 first.data.job.progress={kind:'scan',profile:null,videos:[],limitations:[]};f.launch(first);
 const contradiction=structuredClone(first);contradiction.data.job.progress.limitations=['changed without revision'];
 f.controller.receiveResult(contradiction);assert.equal(f.reason(),'invalid');
});
test('terminal cannot reactivate with a newer revision', t=>{
  const f=setup(t);f.launch(output('failed',3));f.controller.receiveResult(output('running',4));assert.equal(f.reason(),'invalid');
});

test('selection change resets identity/revision and ignores prior pending completion',async t=>{
  const f=setup(t);f.launch(output('running',9));await f.tick(20);
  const next=output('running',1);next.data.job.id='00000000-0000-4000-8000-000000000999';
  f.controller.receiveInput({job_id:next.data.job.id});assert.equal(f.visible(),undefined);
  f.controller.receiveResult(next);f.calls[0]!.resolve(output('succeeded',10));await flush();
  assert.equal(f.calls[0]!.signal.aborted,true);assert.equal(f.visible()?.id,next.data.job.id);
  assert.equal(f.visible()?.revision,1);
});

for(const code of ['UNAUTHENTICATED','FORBIDDEN','NOT_FOUND'] as const) test(`${code} clears and permanently ignores late data`,async t=>{
  const f=setup(t);f.launch();await f.tick(20);f.controller.receiveResult(creatorFailure(code));
  f.calls[0]!.resolve(output('succeeded',2));await flush();f.controller.receiveResult(output('succeeded',3));
  await f.tick(300);assert.equal(f.visible(),undefined);assert.equal(f.calls.length,1);
  assert.equal(f.reason(),code==='UNAUTHENTICATED'?'reauthorize':'unavailable');
});

test('timeout aborts and pauses automatic reads; explicit refresh recovers without late overwrite',async t=>{
  const f=setup(t);f.launch();await f.tick(20);await f.tick(100);
  assert.equal(f.calls[0]!.signal.aborted,true);assert.match(f.notice()!,/timed out/);
  await f.tick(20);assert.equal(f.calls.length,1);
  const retry=f.controller.refresh();f.calls[1]!.resolve(output('succeeded',2));await retry;
  f.calls[0]!.resolve(output('running',3));await flush();assert.equal(f.visible()?.state,'succeeded');
});
test('successful poll performance finishes ok',async t=>{
  const f=observedSetup(t);f.launch();await f.tick(20);
  f.calls[0]!.resolve(output('running',2));await flush();
  assert.deepEqual(f.pollStatuses,['ok']);
});
test('malformed poll performance finishes rejected',async t=>{
  const f=observedSetup(t);f.launch();await f.tick(20);
  f.calls[0]!.resolve({ok:true,data:{job:{}}});await flush();
  assert.deepEqual(f.pollStatuses,['rejected']);assert.equal(f.reason(),'invalid');
});
test('unavailable poll performance finishes error',async t=>{
  const f=observedSetup(t);f.launch();await f.tick(20);
  f.calls[0]!.resolve(creatorFailure('UNAVAILABLE'));await flush();
  assert.deepEqual(f.pollStatuses,['error']);assert.match(f.notice()!,/paused/);
});
test('stale poll performance finishes rejected',async t=>{
  const f=observedSetup(t);f.launch(output('running',4));await f.tick(20);
  f.calls[0]!.resolve(output('running',3));await flush();
  assert.deepEqual(f.pollStatuses,['rejected']);assert.equal(f.visible()?.revision,4);
});
for(const field of ['id','project_id','kind','created_at'] as const) test(`refresh performance rejects mismatched ${field}`,async t=>{
  const f=observedSetup(t);f.launch();await f.tick(20);const next=output('running',2);
  if(field==='kind')next.data.job.kind='scan';
  else if(field==='created_at')next.data.job.created_at='2026-10-08T00:00:00Z';
  else next.data.job[field]='00000000-0000-4000-8000-000000000999';
  f.calls[0]!.resolve(next);await flush();
  assert.deepEqual(f.pollStatuses,['rejected']);assert.equal(f.reason(),'invalid');
});
test('refresh performance rejects contradictory same-revision results',async t=>{
  const f=observedSetup(t);f.launch(output('running',4));await f.tick(20);
  f.calls[0]!.resolve(output('queued',4));await flush();
  assert.deepEqual(f.pollStatuses,['rejected']);assert.equal(f.reason(),'invalid');
});
test('refresh performance rejects terminal reactivation',async t=>{
  const f=observedSetup(t);f.launch(output('failed',3));
  const refresh=f.controller.refresh();f.calls[0]!.resolve(output('running',4));await refresh;
  assert.deepEqual(f.pollStatuses,['rejected']);assert.equal(f.reason(),'invalid');
});
test('timed out poll performance finishes timeout',async t=>{
  const f=observedSetup(t);f.launch();await f.tick(20);await f.tick(100);
  assert.deepEqual(f.pollStatuses,['timeout']);assert.equal(f.calls[0]!.signal.aborted,true);
});
test('transient UNAVAILABLE pauses; unknown rejection clears',async t=>{
  const f=setup(t);f.launch();await f.tick(20);f.calls[0]!.resolve(creatorFailure('UNAVAILABLE'));await flush();
  assert.match(f.notice()!,/paused/);await f.tick(20);assert.equal(f.calls.length,1);
  const retry=f.controller.refresh();f.calls[1]!.reject(new Error('Host disconnected'));await retry;assert.equal(f.reason(),'connection');
});
test('dispose aborts pending and prevents all callbacks from late input/results',async t=>{
  const f=setup(t);f.launch();await f.tick(20);const previous=f.visible();
  f.controller.dispose();f.controller.dispose();f.calls[0]!.resolve(output('succeeded',2));await flush();
  f.controller.receiveInput({job_id:output().data.job.id});f.controller.receiveResult(output('succeeded',3));
  f.controller.connected(true);f.controller.connectionFailed();await f.tick(300);
  assert.equal(f.visible(),previous);assert.equal(f.calls[0]!.signal.aborted,true);assert.equal(f.calls.length,1);
});
test('initial deadline fails closed without invented job state',async t=>{
  const f=setup(t);await f.tick(100);assert.equal(f.reason(),'connection');assert.equal(f.visible(),undefined);
});
test('malformed input/output and output without selection fail closed',t=>{
  for(const run of [
    (c:ReturnType<typeof createCreatorPipelineController>)=>c.receiveInput({job_id:'bad'}),
    (c:ReturnType<typeof createCreatorPipelineController>)=>c.receiveResult(output()),
    (c:ReturnType<typeof createCreatorPipelineController>)=>{c.receiveInput({job_id:output().data.job.id});c.receiveResult({ok:true,data:{job:{...output().data.job,secret:'x'}}});},
  ]){
    const f=setup(t);run(f.controller);assert.equal(f.reason(),'invalid');f.controller.dispose();t.mock.timers.reset();
  }
});
test('public text preserves all three result types; structured envelopes reject private/text/contradictory data',()=>{
  for(const kind of ['scan','recommendations','scripts'] as const){
    const value=output('succeeded',2,kind);
    assert.deepEqual(JSON.parse(creatorJobText(value)),value);
    assert.deepEqual(creatorJobStructuredOutput({structuredContent:value}),value);
    for(const raw of [{structuredContent:value,isError:true},{content:[{text:JSON.stringify(value)}]},{_meta:value},value])assert.equal(creatorJobStructuredOutput(raw),undefined);
    assert.throws(()=>creatorJobText({...value,internal:'secret'}));
  }
  const started = startOutput();
  assert.equal(started.ok, true);
  if (started.ok) assert.deepEqual(
    creatorJobStructuredOutput({ structuredContent: started }),
    { ok: true, data: { job: started.data.job } },
  );
});
