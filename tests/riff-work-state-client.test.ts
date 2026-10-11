import test from 'node:test';
import assert from 'node:assert/strict';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const jobId=id(1),variantId=id(2);
const job:any={id:jobId,work_states:[]};

test('work-state client retains one exact request across ambiguity and confirms only after a matching full reread',async()=>{
  const module:any=await import('../apps/panel/riff-work-state-client.ts').catch(()=>({}));
  assert.equal(typeof module.createRiffWorkStateClient,'function','work-state bridge client is not implemented');
  const inputs:any[]=[];let attempt=0;
  const state={job_id:jobId,variant_id:variantId,state:'saved',version:1,updated_at:'2026-10-11T09:10:46.000Z'};
  const client=module.createRiffWorkStateClient(async(input:any)=>{inputs.push(input);if(attempt++===0)throw Error('ambiguous');return {ok:true,data:{work_state:state}};},
    async()=>({...job,work_states:[state]}));
  assert.equal((await client.set(job,variantId,'saved')).status,'failed');
  assert.equal((await client.set(job,variantId,'saved')).status,'confirmed');
  assert.equal(inputs[0].request_id,inputs[1].request_id);assert.deepEqual(inputs[0],inputs[1]);
});

test('work-state client refreshes authoritative truth on version conflict and invalidation rejects late completion',async()=>{
  const module:any=await import('../apps/panel/riff-work-state-client.ts').catch(()=>({}));
  assert.equal(typeof module.createRiffWorkStateClient,'function','work-state bridge client is not implemented');
  const filmed={job_id:jobId,variant_id:variantId,state:'filmed',version:2,updated_at:'2026-10-11T09:10:47.000Z'};
  let release:(value:unknown)=>void=()=>{};
  const client=module.createRiffWorkStateClient(()=>new Promise(resolve=>{release=resolve;}),async()=>({...job,work_states:[filmed]}));
  const late=client.set({...job,work_states:[{...filmed,state:'saved',version:1}]},variantId,'filmed');client.invalidate();
  release({ok:false,error:{code:'VERSION_CONFLICT',message:'changed',retryable:false,recovery:'reload'}});
  assert.equal((await late).status,'stale');
});

test('work-state client rejects a receipt with a loose timestamp or out-of-range version',async()=>{
  const module:any=await import('../apps/panel/riff-work-state-client.ts').catch(()=>({}));
  for(const state of [
    {job_id:jobId,variant_id:variantId,state:'saved',version:1,updated_at:'123'},
    {job_id:jobId,variant_id:variantId,state:'saved',version:2147483648,updated_at:'2026-10-11T09:10:46.000Z'},
  ]){
    const client=module.createRiffWorkStateClient(async()=>({ok:true,data:{work_state:state}}),async()=>({...job,work_states:[state]}));
    assert.equal((await client.set(job,variantId,'saved')).status,'failed');
  }
});

test('work-state client handles reread failure while preserving only genuinely ambiguous intent',async()=>{
  const module:any=await import('../apps/panel/riff-work-state-client.ts').catch(()=>({}));
  const state={job_id:jobId,variant_id:variantId,state:'saved',version:1,updated_at:'2026-10-11T09:10:46.000Z'};
  const conflictInputs:any[]=[];let conflictAttempt=0;
  const conflictClient=module.createRiffWorkStateClient(async(input:any)=>{conflictInputs.push(input);return conflictAttempt++===0
    ?{ok:false,error:{code:'VERSION_CONFLICT'}}:{ok:true,data:{work_state:state}};},async()=>{if(conflictAttempt===1)throw Error('read failed');return {...job,work_states:[state]};});
  assert.equal((await conflictClient.set(job,variantId,'saved')).status,'failed');
  assert.equal((await conflictClient.set(job,variantId,'saved')).status,'confirmed');
  assert.notEqual(conflictInputs[0].request_id,conflictInputs[1].request_id,'a conflict discards the old write intent');

  const ambiguousInputs:any[]=[];let readAttempt=0;
  const ambiguousClient=module.createRiffWorkStateClient(async(input:any)=>{ambiguousInputs.push(input);return {ok:true,data:{work_state:state}};},
    async()=>{if(readAttempt++===0)throw Error('read failed');return {...job,work_states:[state]};});
  assert.equal((await ambiguousClient.set(job,variantId,'saved')).status,'failed');
  assert.equal((await ambiguousClient.set(job,variantId,'saved')).status,'confirmed');
  assert.equal(ambiguousInputs[0].request_id,ambiguousInputs[1].request_id,'an unconfirmed success keeps its exact retry intent');
});

test('recent labels come only from persisted job and work-state truth',async()=>{
  const module:any=await import('../apps/panel/riff-home-validation.ts');
  assert.equal(typeof module.riffRecentLabel,'function');
  assert.equal(module.riffRecentLabel('scan','succeeded',null),'Analysis ready');
  assert.equal(module.riffRecentLabel('recommendations','succeeded',null),'Formats ready');
  assert.equal(module.riffRecentLabel('scripts','succeeded',null),'Continue script');
  assert.equal(module.riffRecentLabel('scripts','succeeded','active'),'Continue script');
  assert.equal(module.riffRecentLabel('scripts','succeeded','saved'),'Ideas saved');
  assert.equal(module.riffRecentLabel('scripts','succeeded','filmed'),'Filmed');
  assert.equal(module.riffRecentLabel('scripts','running',null),'Studio in progress');
  assert.equal(module.riffRecentLabel('scan','failed',null),'Analysis failed');
});
