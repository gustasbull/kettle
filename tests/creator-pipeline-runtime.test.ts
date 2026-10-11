import test from 'node:test';
import assert from 'node:assert/strict';
import { createCreatorWorkflowDurableStep, creatorWorkflowStepOptions } from '../apps/worker/creator-workflow-policy.ts';

test('provider steps remain zero-retry while checkpoint persistence uses durable non-provider retries',()=>{
 assert.deepEqual(creatorWorkflowStepOptions('provider:feed:0'),
  {retries:{limit:0,delay:'1 second',backoff:'exponential'},timeout:'10 minutes'});
 assert.deepEqual(creatorWorkflowStepOptions('checkpoint:scan:feed:0'),
  {retries:{limit:2,delay:'1 second',backoff:'exponential'},timeout:'10 minutes'});
 assert.deepEqual(creatorWorkflowStepOptions('catalog:scan:feed:0:own_profile'),
  {retries:{limit:2,delay:'1 second',backoff:'exponential'},timeout:'10 minutes'});
 assert.deepEqual(creatorWorkflowStepOptions('save-result'),
  {retries:{limit:2,delay:'1 second',backoff:'exponential'},timeout:'10 minutes'});
 for(const unsafe of ['checkpoint:','provider:../secret','unknown-step','checkpoint:contains space'])
  assert.throws(()=>creatorWorkflowStepOptions(unsafe),/Invalid creator workflow step/);
});

test('three provider durable steps use separate zero-retry boundaries while checkpoint steps retain retries',async()=>{
 const calls:Array<{name:string;options:ReturnType<typeof creatorWorkflowStepOptions>}>=[],gates=['901','902','903'].map(()=>deferred<void>());
 let inFlight=0,maxInFlight=0;
 const durable=createCreatorWorkflowDurableStep({async do<T>(name:string,options:ReturnType<typeof creatorWorkflowStepOptions>,run:()=>Promise<T>){
  calls.push({name,options});return run();
 }});
 const pending=['901','902','903'].map((id,index)=>durable(`provider:video:${id}`,async()=>{
  inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);await gates[index]!.promise;inFlight--;return id;
 }));
 await waitFor(()=>inFlight===3);gates[2]!.resolve();gates[0]!.resolve();gates[1]!.resolve();
 assert.deepEqual(await Promise.all(pending),['901','902','903']);assert.equal(maxInFlight,3);
 assert.deepEqual(calls.map(call=>[call.name,call.options.retries.limit]),[
  ['provider:video:901',0],['provider:video:902',0],['provider:video:903',0],
 ]);
 const receipt={native_id:'904',nested:{status:'received'}};
 const normalized=await durable('provider:video:904',async()=>receipt);
 assert.deepEqual(normalized,receipt);assert.notEqual(normalized,receipt);assert.notEqual(normalized.nested,receipt.nested);
 await assert.rejects(durable('checkpoint:recommend:detail:901',async()=>undefined),SyntaxError);
 assert.deepEqual(calls.at(-1),{name:'checkpoint:recommend:detail:901',options:creatorWorkflowStepOptions('checkpoint:recommend:detail:901')});
 assert.equal(calls.at(-1)!.options.retries.limit,2);
 await assert.rejects(durable('checkpoint:recommend:detail:902',async()=>1n),TypeError);
});

function deferred<T>(){let resolve!:(value?:T)=>void;const promise=new Promise<T>(done=>{resolve=value=>done(value as T);});return {promise,resolve};}
async function waitFor(check:()=>boolean){while(!check())await new Promise<void>(resolve=>setTimeout(resolve,1));}
