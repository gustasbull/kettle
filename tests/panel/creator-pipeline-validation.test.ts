import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creatorJobFixture } from '../../evals/creator-loop/pipeline-fixtures.ts';
import { creatorFailure } from '../../packages/application/creator-operations.ts';
import { creatorJobStructuredOutput, parseCreatorJobOutput, parseGetCreatorJobInput, parseStartRiffCreatorInput } from '../../apps/panel/creator-pipeline-validation.ts';

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

test('structured results alone are accepted and Riff start output projects only the job',()=>{
  const job=creatorJobFixture('scan');job.state='queued';job.result=null;
  const started={ok:true,data:{project:{ignored:true},job,source:{ignored:true}}};
  assert.deepEqual(creatorJobStructuredOutput({structuredContent:started}),{ok:true,data:{job}});
  for(const raw of [started,{content:[{type:'text',text:JSON.stringify(started)}]},{_meta:started},{structuredContent:started,isError:true}])
    assert.equal(creatorJobStructuredOutput(raw),undefined);
});

test('local read and direct-start inputs are exact and bounded',()=>{
  const id='00000000-0000-4000-8000-000000000622';
  assert.deepEqual(parseGetCreatorJobInput({job_id:id}),{job_id:id});
  assert.equal(parseGetCreatorJobInput({job_id:id,account_id:id}),undefined);
  assert.deepEqual(parseStartRiffCreatorInput({request_id:id,source_url:'https://www.tiktok.com/@fixture'}),{request_id:id,source_url:'https://www.tiktok.com/@fixture'});
  for(const raw of [{request_id:'bad',source_url:'https://www.tiktok.com/@fixture'},{request_id:id,source_url:'http://www.tiktok.com/@fixture'},{request_id:id,source_url:'https://user:secret@www.tiktok.com/@fixture'},{request_id:id,source_url:'https://www.tiktok.com/@fixture',account_id:id}])
    assert.equal(parseStartRiffCreatorInput(raw),undefined);
});
