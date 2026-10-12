import test from 'node:test';
import assert from 'node:assert/strict';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const jobId=id(1),variantId=id(2);
const job:any={id:jobId,work_states:[]};
const wrapped=(value:unknown)=>({structuredContent:value,content:[]});
const failed=(code:string)=>wrapped({ok:false,error:{code,message:'Fixture failure.',retryable:false,recovery:'reload'}});

test('work-state client retains one exact request across ambiguity and confirms only after a matching full reread',async()=>{
  const module:any=await import('../apps/panel/riff-work-state-client.ts').catch(()=>({}));
  assert.equal(typeof module.createRiffWorkStateClient,'function','work-state bridge client is not implemented');
  const inputs:any[]=[];let attempt=0;
  const state={job_id:jobId,variant_id:variantId,state:'saved',version:1,updated_at:'2026-10-11T09:10:46.000Z'};
  const client=module.createRiffWorkStateClient(async(input:any)=>{inputs.push(input);if(attempt++===0)throw Error('ambiguous');return wrapped({ok:true,data:{work_state:state}});},
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
  release(failed('VERSION_CONFLICT'));
  assert.equal((await late).status,'stale');
});

test('work-state client rejects a receipt with a loose timestamp or out-of-range version',async()=>{
  const module:any=await import('../apps/panel/riff-work-state-client.ts').catch(()=>({}));
  for(const state of [
    {job_id:jobId,variant_id:variantId,state:'saved',version:1,updated_at:'123'},
    {job_id:jobId,variant_id:variantId,state:'saved',version:2147483648,updated_at:'2026-10-11T09:10:46.000Z'},
  ]){
    const client=module.createRiffWorkStateClient(async()=>wrapped({ok:true,data:{work_state:state}}),async()=>({...job,work_states:[state]}));
    assert.equal((await client.set(job,variantId,'saved')).status,'failed');
  }
});

test('work-state client handles reread failure while preserving only genuinely ambiguous intent',async()=>{
  const module:any=await import('../apps/panel/riff-work-state-client.ts').catch(()=>({}));
  const state={job_id:jobId,variant_id:variantId,state:'saved',version:1,updated_at:'2026-10-11T09:10:46.000Z'};
  const conflictInputs:any[]=[];let conflictAttempt=0;
  const conflictClient=module.createRiffWorkStateClient(async(input:any)=>{conflictInputs.push(input);return conflictAttempt++===0
    ?failed('VERSION_CONFLICT'):wrapped({ok:true,data:{work_state:state}});},async()=>{if(conflictAttempt===1)throw Error('read failed');return {...job,work_states:[state]};});
  assert.equal((await conflictClient.set(job,variantId,'saved')).status,'failed');
  assert.equal((await conflictClient.set(job,variantId,'saved')).status,'confirmed');
  assert.notEqual(conflictInputs[0].request_id,conflictInputs[1].request_id,'a conflict discards the old write intent');

  const ambiguousInputs:any[]=[];let readAttempt=0;
  const ambiguousClient=module.createRiffWorkStateClient(async(input:any)=>{ambiguousInputs.push(input);return wrapped({ok:true,data:{work_state:state}});},
    async()=>{if(readAttempt++===0)throw Error('read failed');return {...job,work_states:[state]};});
  assert.equal((await ambiguousClient.set(job,variantId,'saved')).status,'failed');
  assert.equal((await ambiguousClient.set(job,variantId,'saved')).status,'confirmed');
  assert.equal(ambiguousInputs[0].request_id,ambiguousInputs[1].request_id,'an unconfirmed success keeps its exact retry intent');
});

test('work-state client accepts v7 UUIDs and reconciles UUID casing semantically',async()=>{
  const module:any=await import('../apps/panel/riff-work-state-client.ts').catch(()=>({}));
  const upperJob='018F3E12-9ABC-7DEF-8ABC-1234567890AB',upperVariant='018F3E13-9ABC-7DEF-8ABC-1234567890AB';
  const state={job_id:upperJob.toLowerCase(),variant_id:upperVariant.toLowerCase(),state:'saved',version:1,updated_at:'2026-10-11T09:10:46.000Z'};
  const client=module.createRiffWorkStateClient(async()=>wrapped({ok:true,data:{work_state:state}}),
    async()=>({id:upperJob.toLowerCase(),work_states:[state]}));
  assert.equal((await client.set({id:upperJob,work_states:[]},upperVariant,'saved')).status,'confirmed');
});

test('work-state client describes a confirmed filmed correction without calling it a save undo',async()=>{
  const module:any=await import('../apps/panel/riff-work-state-client.ts').catch(()=>({}));
  const filmed={job_id:jobId,variant_id:variantId,state:'filmed',version:1,updated_at:'2026-10-11T09:10:46.000Z'};
  const active={...filmed,state:'active',version:2,updated_at:'2026-10-11T09:10:47.000Z'};
  const client=module.createRiffWorkStateClient(async()=>wrapped({ok:true,data:{work_state:active}}),async()=>({...job,work_states:[active]}));
  const result=await client.set({...job,work_states:[filmed]},variantId,'active');
  assert.equal(result.status,'confirmed');assert.equal(result.message,'Marked as not filmed.');
});

test('work-state client rejects hostile and direct envelopes before rereading authoritative state',async()=>{
  const module:any=await import('../apps/panel/riff-work-state-client.ts').catch(()=>({}));
  const state={job_id:jobId,variant_id:variantId,state:'saved',version:1,updated_at:'2026-10-11T09:10:46.000Z'};
  const success={ok:true,data:{work_state:state}},conflict={ok:false,error:{code:'VERSION_CONFLICT',message:'Changed.',retryable:false,recovery:'reload'}};
  const innerHidden=structuredClone(success) as any;Object.defineProperty(innerHidden.data.work_state,'secret',{value:true});
  const innerFailure=structuredClone(conflict) as any;Object.defineProperty(innerFailure.error,'secret',{value:true});
  const hostileEnvelopes=(inner:unknown)=>{
    const innerObject=inner as Record<string,unknown>;
    const hidden=wrapped(inner) as any;Object.defineProperty(hidden,'secret',{value:true});
    const symbol=wrapped(inner) as any;symbol[Symbol('secret')]=true;
    const accessor:any={content:[]};Object.defineProperty(accessor,'structuredContent',{get(){return inner;},enumerable:true});
    const hiddenOptional:any={structuredContent:inner};Object.defineProperty(hiddenOptional,'content',{value:[],enumerable:false});
    const accessorContent:any[]=[];Object.defineProperty(accessorContent,'0',{get(){return {type:'text',text:'spoof'};},enumerable:true});
    const customContent:any[]=[];Object.setPrototypeOf(customContent,null);
    const proxyContent=new Proxy([],{ownKeys(){throw new Error('proxy trap');}});
    const metaAccessor:any={};Object.defineProperty(metaAccessor,'trace',{get(){return 'spoof';},enumerable:true});
    const topProxy=new Proxy(wrapped(inner),{getPrototypeOf(){throw new Error('hostile outer proxy');}});
    const nestedProxy=wrapped(new Proxy(innerObject,{getPrototypeOf(){throw new Error('hostile inner proxy');}}));
    const topNull=Object.assign(Object.create(null),wrapped(inner));
    const nestedNull=wrapped(Object.assign(Object.create(null),innerObject));
    return [
      inner,
      topProxy,
      nestedProxy,
      topNull,
      nestedNull,
      hidden,
      symbol,
      accessor,
      hiddenOptional,
      {structuredContent:inner,isError:undefined},
      {structuredContent:inner,content:undefined},
      {structuredContent:inner,isError:'false'},
      {structuredContent:inner,_meta:1},
      {structuredContent:inner,_meta:metaAccessor},
      {structuredContent:inner,content:[{type:'text',text:'spoof',secret:true}]},
      {structuredContent:inner,content:accessorContent},
      {structuredContent:inner,content:customContent},
      {structuredContent:inner,content:proxyContent},
      {structuredContent:inner,isError:innerObject.ok===true},
    ];
  };
  for(const raw of [...hostileEnvelopes(success),...hostileEnvelopes(conflict),wrapped(innerHidden),wrapped(innerFailure)]){
    let reads=0;
    const client=module.createRiffWorkStateClient(async()=>raw,async()=>{reads++;return {...job,work_states:[state]};});
    assert.equal((await client.set(job,variantId,'saved')).status,'failed');
    assert.equal(reads,0,'untrusted envelope must fail before confirmation or conflict reread');
  }
});

test('work-state client rejects a nested proxy mutation without reading its restoring getter or rereading truth',async()=>{
  const module:any=await import('../apps/panel/riff-work-state-client.ts').catch(()=>({}));
  const state={job_id:jobId,variant_id:variantId,state:'saved',version:1,updated_at:'2026-10-11T09:10:46.000Z'};
  const original={ok:true,data:{work_state:state}};
  const injected={ok:false,error:{code:'VERSION_CONFLICT',message:'Injected.',retryable:false,recovery:'reload'}};
  const raw:any={structuredContent:original,content:[],isError:true,_meta:{}};
  let getterReads=0;
  raw._meta.mutator=new Proxy({}, {getPrototypeOf(){
    Object.defineProperty(raw,'structuredContent',{configurable:true,enumerable:true,get(){
      getterReads++;
      Object.defineProperty(raw,'structuredContent',{configurable:true,enumerable:true,writable:true,value:original});
      return injected;
    }});
    return Object.prototype;
  }});
  let rereads=0;
  const client=module.createRiffWorkStateClient(async()=>raw,async()=>{rereads++;return {...job,work_states:[state]};});

  assert.equal((await client.set(job,variantId,'saved')).status,'failed');
  assert.equal(getterReads,0);
  assert.equal(rereads,0,'mutating metadata cannot inject a conflict that authorizes an authoritative reread');
});

test('work-state client rejects an earlier sibling proxy that restores an injected conflict without rereading truth',async()=>{
  const module:any=await import('../apps/panel/riff-work-state-client.ts').catch(()=>({}));
  const state={job_id:jobId,variant_id:variantId,state:'saved',version:1,updated_at:'2026-10-11T09:10:46.000Z'};
  const successData={work_state:state};
  const structuredContent:any={ok:true,data:successData};
  const conflict={ok:false,error:{code:'VERSION_CONFLICT',message:'Injected.',retryable:false,recovery:'reload'}};
  let prototypeReads=0;
  let getterReads=0;
  const replaceStructuredContent=(next:Record<string,unknown>)=>{
    for(const key of Reflect.ownKeys(structuredContent))delete structuredContent[key];
    Object.assign(structuredContent,next);
  };
  const mutator=new Proxy({}, {
    getPrototypeOf(){
      prototypeReads+=1;
      replaceStructuredContent(prototypeReads%2===1?conflict:{ok:true,data:successData});
      return Object.prototype;
    },
    get(){getterReads+=1;return undefined;},
  });
  const raw={_meta:{mutator},structuredContent,content:[],isError:true};
  let rereads=0;
  const client=module.createRiffWorkStateClient(async()=>raw,async()=>{rereads+=1;return {...job,work_states:[state]};});

  assert.equal((await client.set(job,variantId,'saved')).status,'failed');
  assert.equal(getterReads,0);
  assert.equal(rereads,0,'an intermediate injected conflict cannot authorize an authoritative reread');
});

test('work-state client accepts a complete valid MCP result envelope',async()=>{
  const module:any=await import('../apps/panel/riff-work-state-client.ts').catch(()=>({}));
  const state={job_id:jobId,variant_id:variantId,state:'saved',version:1,updated_at:'2026-10-11T09:10:46.000Z'};
  const raw={structuredContent:{ok:true,data:{work_state:state}},isError:false,
    content:[{type:'text',text:'Saved.',annotations:{audience:['user'],priority:1}}],_meta:{trace:['ok']}};
  const client=module.createRiffWorkStateClient(async()=>raw,async()=>({...job,work_states:[state]}));
  assert.equal((await client.set(job,variantId,'saved')).status,'confirmed');
});

test('an old successful replay refreshes newer truth and clears the stale retry intent',async()=>{
  const module:any=await import('../apps/panel/riff-work-state-client.ts').catch(()=>({}));
  const saved={job_id:jobId,variant_id:variantId,state:'saved',version:1,updated_at:'2026-10-11T09:10:46.000Z'};
  const active={...saved,state:'active',version:2,updated_at:'2026-10-11T09:11:46.000Z'};
  const filmed={...saved,state:'filmed',version:3,updated_at:'2026-10-11T09:12:46.000Z'};
  const inputs:any[]=[];let writes=0;
  const client=module.createRiffWorkStateClient(async(input:any)=>{inputs.push(input);return wrapped({ok:true,data:{work_state:writes++===0?saved:filmed}});},
    async()=>({id:jobId,work_states:[writes===1?active:filmed]}));
  const first=await client.set(job,variantId,'saved');
  assert.equal(first.status,'conflict');
  if(first.status!=='conflict')assert.fail('expected refreshed conflict');
  assert.deepEqual(first.job.work_states,[active]);
  assert.equal((await client.set(first.job,variantId,'filmed')).status,'confirmed');
  assert.equal(inputs[0].expected_version,0);assert.equal(inputs[1].expected_version,2);
  assert.notEqual(inputs[0].request_id,inputs[1].request_id);
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
