import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCreatorDispatchScheduler, createPipelineOperations, publicCreatorJob, publicCreatorJobStatus, createGuardedProviderContext, canProcessCapturedDna,
  runCreatorPipelineJob, PipelineRunError, type PipelineRepository, type StoredCreatorJob, type DurableStep } from '../packages/application/creator-pipeline.ts';
import { failure, type IdentityVerifier } from '../packages/application/operations.ts';
import { projectCreatorDna, type CreatorRepository } from '../packages/application/creator-operations.ts';
import { creatorAnalysisFixture } from '../packages/contracts/fixtures/creator-profile.ts';
import { creatorJobFixture, recommendationBatchFixture, creatorScriptsFixture } from '../evals/creator-loop/pipeline-fixtures.ts';
import type { CreatorPipelineProvider, PipelineOperation } from '../packages/contracts/creator-pipeline.ts';
import { TrustedCatalogObservation } from '../packages/contracts/riff-videos.ts';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function deferred<T>(){let resolve!:(value?:T)=>void;const promise=new Promise<T>(done=>{resolve=value=>done(value as T);});return {promise,resolve};}
async function waitFor(check:()=>boolean){while(!check())await new Promise<void>(resolve=>setTimeout(resolve,1));}
const account=id(800), request=id(801);
const ceilings={scrapecreators:1000,lightreel:2000,openai:3000};
const step:DurableStep=async(_name,run)=>run();
const identity:IdentityVerifier={async verify(){return {account_id:account,scopes:['projects:read','projects:write']};}};
const wrapped=(job:StoredCreatorJob)=>({ok:true as const,data:{job}});
function stored(kind:StoredCreatorJob['kind']='recommendations',state:StoredCreatorJob['state']='queued'):StoredCreatorJob {
  const job=creatorJobFixture(kind);
  return {...job,state,stage:state==='succeeded'?'saving':'accepted',progress:kind==='scan'?{kind,profile:null,videos:[],limitations:[]}:
    kind==='recommendations'?{kind,identities:[],references:[],limitations:[]}:{kind,limitations:[]},
    result:state==='succeeded'?job.result:null,account_id:account,request_id:request,
    input:{private_input:'never public'},captured:{private_snapshot:'never public'},message:'private provider diagnostics'};
}
function input(kind:PipelineOperation='start_creator_recommendations') {
  if(kind==='get_creator_job')return {job_id:id(620)};
  if(kind==='start_creator_scan')return {project_id:id(100),request_id:request,scan:creatorAnalysisFixture().scan.request};
  if(kind==='start_creator_scripts')return {batch_id:id(600),idea_id:id(602),request_id:request};
  return {dna_id:id(4),expected_version:1,request_id:request};
}
function harness(job=stored(), verifier=identity) {
  const calls:{op:string;owner:string;input:unknown}[]=[],dispatches:string[][]=[];
  const repository:PipelineRepository={async call(op,owner,raw){calls.push({op,owner,input:raw});return wrapped(job);}};
  const operations=createPipelineOperations(verifier,repository,createCreatorDispatchScheduler(
    async(jobId,accountId)=>{dispatches.push([jobId,accountId]);},task=>{void task;}));
  return {calls,dispatches,operations};
}
function code(result:Awaited<ReturnType<ReturnType<typeof createPipelineOperations>['execute']>>) {
  assert.equal(result.ok,false);if(!result.ok)return result.error.code;throw new Error('Expected failure');
}

test('pipeline operations require verified identity, scope and strict public input before repository access',async()=>{
  for(const verifier of [{async verify(){return null;}},{async verify(){throw Error('private');}},{async verify(){return {account_id:'bad',scopes:['projects:write']};}}]) {
    const h=harness(stored(),verifier);assert.equal(code(await h.operations.execute('start_creator_recommendations','token',input())),'UNAUTHENTICATED');assert.equal(h.calls.length,0);
  }
  const h=harness();assert.equal(code(await h.operations.execute('start_creator_recommendations',null,input())),'UNAUTHENTICATED');
  assert.equal(code(await h.operations.execute('start_creator_recommendations','token',{...input(),account_id:account})),'VALIDATION_ERROR');assert.equal(h.calls.length,0);
  const denied=harness(stored(),{async verify(){return {account_id:account,scopes:['projects:read']};}});
  assert.equal(code(await denied.operations.execute('start_creator_recommendations','token',input())),'FORBIDDEN');assert.equal(denied.calls.length,0);
});

test('public projection excludes account, captured evidence, inputs, request IDs and provider diagnostics',()=>{
  for(const state of ['queued','running','succeeded','failed','needs_reconciliation'] as const){
    const value=publicCreatorJob(stored('recommendations',state));
    for(const privateKey of ['account_id','request_id','captured','input','receipts'])assert.equal(privateKey in value,false);
    assert.doesNotMatch(JSON.stringify(value),/private provider|private_input|private_snapshot/);
    if(state==='failed'||state==='needs_reconciliation')assert.ok(value.message);else assert.equal(value.message,null);
  }
});

test('public scan source kind is derived only from a fully validated captured scan',()=>{
  const analysis=creatorAnalysisFixture(),profile=stored('scan');
  profile.captured={scan:analysis.scan.request};
  assert.equal(publicCreatorJob(profile).source_kind,'profile');
  const video=stored('scan');
  video.captured={scan:analysis.scan.request,seed_url:`${analysis.scan.request.supplied_url}/video/9000000000000000011`};
  assert.equal(publicCreatorJob(video).source_kind,'video');
  const mismatched=stored('scan');
  mismatched.captured={scan:analysis.scan.request,seed_url:'https://www.tiktok.com/@different_creator/video/9000000000000000011'};
  assert.equal(publicCreatorJob(mismatched).source_kind,undefined);
  const malformed=stored('scan');
  assert.equal(publicCreatorJob(malformed).source_kind,undefined);
  const nonScan=stored('recommendations');nonScan.captured=video.captured;
  assert.equal(publicCreatorJob(nonScan).source_kind,undefined);
});

test('reads never dispatch; repeated durable queued start retains job identity; dispatch failure retains accepted intent',async()=>{
  const h=harness();for(let n=0;n<2;n++)assert.equal((await h.operations.execute('start_creator_recommendations','token',input())).ok,true);
  assert.deepEqual(h.dispatches,[[id(620),account],[id(620),account]]);
  assert.ok(h.calls.every(c=>c.owner===account));
  await h.operations.execute('get_creator_job','token',input('get_creator_job'));assert.equal(h.dispatches.length,2);
  const ops=createPipelineOperations(identity,{async call(){return wrapped(stored());}},createCreatorDispatchScheduler(
    async()=>{throw Error('dispatch gap');},task=>{void task;}));
  assert.equal((await ops.execute('start_creator_recommendations','token',input())).ok,true);
});

test('queued start returns while deferred workflow create is unresolved', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const background:Promise<void>[]=[];
  const operations = createPipelineOperations(identity, { async call() { return wrapped(stored()); } },
    createCreatorDispatchScheduler(async () => gate,task=>background.push(task)));
  const outcome = await Promise.race([
    operations.execute('start_creator_recommendations', 'token', input()),
    new Promise<'blocked'>(resolve => setTimeout(() => resolve('blocked'), 25)),
  ]);
  release();
  await Promise.all(background);
  assert.notEqual(outcome, 'blocked', 'durable acknowledgement must not await Workflow creation');
  assert.equal((outcome as { ok: boolean }).ok, true);
});

test('deferred dispatch failure is observed once, contained, and cannot mutate durable intent', async () => {
  const job=stored(),before=structuredClone(job),repositoryCalls:string[]=[];
  const background:Promise<void>[]=[],events:Array<Record<string,unknown>>=[];
  const observer:any={
    scope(){return observer;},
    record(fields:Record<string,unknown>){events.push(fields);},
    async measure<T>(fields:Record<string,unknown>,run:()=>Promise<T>){
      const started=performance.now();
      try{const value=await run();events.push({...fields,status:'ok',duration_ms:performance.now()-started});return value;}
      catch(error){events.push({...fields,status:'error',duration_ms:performance.now()-started});throw error;}
    },
  };
  let dispatchAttempts=0;
  const operations=createPipelineOperations(identity,{async call(operation){repositoryCalls.push(operation);return wrapped(job);}},
    createCreatorDispatchScheduler(async()=>{dispatchAttempts++;throw new Error('workflow unavailable');},task=>background.push(task)),
    ()=>true,observer);

  const outcome=await operations.execute('start_creator_recommendations','token',input());
  assert.equal(outcome.ok,true,'the committed queued intent remains accepted');
  assert.deepEqual(repositoryCalls,['start_creator_recommendations']);
  assert.equal(background.length,1,'one logical start registers one background task');
  await assert.doesNotReject(background[0]!);
  assert.equal(dispatchAttempts,1,'a failed workflow create is never retried in-process');
  assert.deepEqual(job,before,'dispatch failure cannot mutate the stored job returned by the repository');
  assert.deepEqual(events.filter(event=>event.stage==='application_operation'&&event.operation==='dispatch')
    .map(event=>event.status),['error']);
});

test('start observations use the validated logical request then the returned durable job',async()=>{
  const correlations:Array<Record<string,string>>=[];
  const events:Array<{correlation?:Record<string,string>;stage:unknown;operation:unknown}>=[];
  const scoped=(correlation?:Record<string,string>):any=>({
    scope(next:Record<string,string>){correlations.push(next);return scoped(next);},
    record(fields:Record<string,unknown>){events.push({correlation,stage:fields.stage,operation:fields.operation});},
    async measure<T>(fields:Record<string,unknown>,run:()=>Promise<T>){
      events.push({correlation,stage:fields.stage,operation:fields.operation});return run();
    },
  });
  let dispatchTelemetry:unknown;
  const background:Promise<void>[]=[];
  const operations=createPipelineOperations(identity,
    {async call(_operation,_owner,_input,telemetry){
      assert.equal(telemetry === undefined, false, 'the RPC boundary receives logical request scope');
      return wrapped(stored());
    }},
    createCreatorDispatchScheduler(async(_jobId,_accountId,telemetry)=>{dispatchTelemetry=telemetry;},task=>background.push(task)),()=>true,scoped());

  assert.equal((await operations.execute('start_creator_recommendations','token',input())).ok,true);
  await Promise.all(background);
  assert.deepEqual(correlations,[{request_id:request},{job_id:id(620)}]);
  assert.ok(dispatchTelemetry);
  assert.deepEqual(events.map(event=>[event.correlation,event.stage,event.operation]),[
    [{request_id:request},'application_operation','start'],
    [{job_id:id(620)},'application_operation','dispatch'],
  ]);
});

test('repository identity, request, project and kind mismatches never dispatch',async()=>{
  for(const [operation,field] of [['get_creator_job','id'],['start_creator_recommendations','account_id'],['start_creator_recommendations','request_id'],['start_creator_scan','project_id'],['start_creator_recommendations','kind']] as const){
    const job=stored(operation==='start_creator_scan'?'scan':'recommendations');
    if(field==='kind')job.kind='scripts';else job[field]=id(999);
    const h=harness(job);assert.equal(code(await h.operations.execute(operation,'token',input(operation))),'UNAVAILABLE');assert.equal(h.dispatches.length,0);
  }
});

test('malformed repository public state fails before dispatch',async()=>{
  const job=stored();job.result=creatorJobFixture().result;
  const h=harness(job);assert.equal(code(await h.operations.execute('start_creator_recommendations','token',input())),'UNAVAILABLE');assert.equal(h.dispatches.length,0);
});

test('repository failure and rejection are sanitized',async()=>{
  for(const output of [failure('NOT_FOUND'),{ok:true,data:{job:{private:'secret'}}}]){
    const ops=createPipelineOperations(identity,{async call(){return output;}},async()=>assert.fail('dispatch'));
    const value=await ops.execute('get_creator_job','token',input('get_creator_job'));assert.equal(value.ok,false);assert.doesNotMatch(JSON.stringify(value),/secret/);
  }
});

function guarded(reserve:unknown,complete:unknown={ok:true,data:{status:'completed',receipt:{allowed:'saved'}}},telemetry?:any) {
  const events:string[]=[],calls:{op:string;raw:any}[]=[];
  const repository:PipelineRepository={async call(op,owner,raw){assert.equal(owner,account);calls.push({op,raw});events.push(op);if(op==='reserve_creator_attempt')return reserve;if(complete instanceof Error)throw complete;return complete;}};
  return {events,calls,context:createGuardedProviderContext(repository,stored(),ceilings,step,telemetry)};
}
const reservation=(status:string,receipt?:unknown)=>({ok:true,data:{status,...(receipt===undefined?{}:{receipt})}});

test('guard reserves ceiling before I/O, saves allowlisted receipt and returns durable receipt',async()=>{
  const g=guarded(reservation('acquired'));
  const value=await g.context.call('profile','scrapecreators','profile',async()=>{g.events.push('execute');return {allowed:'received'};});
  assert.deepEqual(g.events,['reserve_creator_attempt','execute','complete_creator_attempt']);assert.deepEqual(value,{allowed:'saved'});
  assert.deepEqual(g.calls[0]!.raw,{job_id:id(620),key:'profile',provider:'scrapecreators',operation:'profile',ceiling_microusd:1000});
});

test('guard replays without I/O; ambiguous/denied reservations do not execute',async()=>{
  const replay=guarded(reservation('replay',{allowed:'cached'}));
  assert.deepEqual(await replay.context.call('research','lightreel','research',async()=>assert.fail('repeat I/O')),{allowed:'cached'});
  for(const [reserve,state] of [[reservation('ambiguous'),'needs_reconciliation'],[failure('FORBIDDEN'),'failed'],[{},'failed']] as const){
    const g=guarded(reserve);await assert.rejects(g.context.call('research','lightreel','research',async()=>assert.fail('I/O')),e=>e instanceof PipelineRunError&&e.state===state);assert.equal(g.calls.length,1);
  }
});

test('guard never retries execute exceptions, oversized receipts or completion failure',async()=>{
  for(const mode of ['execute','oversized','completion','invalid-completion']){
    const g=guarded(reservation('acquired'),mode==='completion'?Error('storage'):mode==='invalid-completion'?failure('UNAVAILABLE'):undefined);
    let executions=0;await assert.rejects(g.context.call('generate','openai','generate',async()=>{executions++;if(mode==='execute')throw Error('provider secret');return mode==='oversized'?{text:'x'.repeat(300001)}:{allowed:'received'};}),e=>e instanceof PipelineRunError&&e.state==='needs_reconciliation');assert.equal(executions,1);
    assert.equal(g.calls.filter(c=>c.op==='reserve_creator_attempt').length,1);
    assert.equal(g.calls.filter(c=>c.op==='complete_creator_attempt').length,mode==='execute'||mode==='oversized'?0:1);
  }
});

test('parallel stable video keys retain independent reservation and receipt boundaries',async()=>{
 const job=stored('recommendations','running'),steps:string[]=[],calls:Array<{op:string;raw:any}>=[],gates=['901','902','903'].map(()=>deferred<void>());
 let executing=0,maxExecuting=0;
 const repository:PipelineRepository={async call(op,_owner,raw){calls.push({op,raw});return op==='reserve_creator_attempt'
  ?reservation('acquired'):{ok:true,data:{status:'completed',receipt:{native_id:(raw as any).key.split(':')[1]}}};}};
 const context=createGuardedProviderContext(repository,job,ceilings,async(name,run)=>{steps.push(name);return run();});
 const pending=['901','902','903'].map((id,index)=>context.call(`video:${id}`,'scrapecreators','video',async()=>{
  executing++;maxExecuting=Math.max(maxExecuting,executing);await gates[index]!.promise;executing--;return {native_id:id};
 }));
 await waitFor(()=>executing===3);assert.equal(maxExecuting,3);gates[2]!.resolve();gates[0]!.resolve();gates[1]!.resolve();
 assert.deepEqual(await Promise.all(pending),[{native_id:'901'},{native_id:'902'},{native_id:'903'}]);
 assert.deepEqual(steps,['provider:video:901','provider:video:902','provider:video:903']);
 assert.deepEqual(calls.filter(call=>call.op==='reserve_creator_attempt').map(call=>call.raw),['901','902','903'].map(id=>({
  job_id:job.id,key:`video:${id}`,provider:'scrapecreators',operation:'video',ceiling_microusd:ceilings.scrapecreators,
 })));
 assert.deepEqual(calls.filter(call=>call.op==='complete_creator_attempt').map(call=>call.raw.key),['video:903','video:901','video:902']);
});

test('concurrent reservation denials execute no provider work and create no receipts',async()=>{
 let executions=0;const calls:string[]=[];
 const context=createGuardedProviderContext({async call(op){calls.push(op);return failure('FORBIDDEN');}},stored('recommendations','running'),ceilings,step);
 const results=await Promise.allSettled(['901','902','903'].map(id=>context.call(`video:${id}`,'scrapecreators','video',async()=>{executions++;return {};})));
 assert.ok(results.every(result=>result.status==='rejected'&&result.reason instanceof PipelineRunError&&result.reason.state==='failed'));
 assert.equal(executions,0);assert.deepEqual(calls,['reserve_creator_attempt','reserve_creator_attempt','reserve_creator_attempt']);
});

test('invalid guard keys and ceilings fail before reservation or execution',async()=>{
  for(const [key,ceiling] of [['bad key',1000],['profile',-1],['profile',0.5]] as const){
    const context=createGuardedProviderContext({async call(){assert.fail('reserve');}},stored(),{...ceilings,scrapecreators:ceiling},step);
    await assert.rejects(context.call(key,'scrapecreators','profile',async()=>assert.fail('execute')),e=>e instanceof PipelineRunError&&e.state==='failed');
  }
});

/** These are synthetic authorization fixtures, never fetched/live evidence. */
function approvedStored() {
  const analysis=creatorAnalysisFixture();
  for(const o of [...analysis.scan.profile_observations,...analysis.scan.video_observations]){
    o.provenance.origin='live';o.provenance.permission.status='approved';o.provenance.permission.basis='Synthetic permission test only';
  }
  return {dna_id:analysis.dna.id,project_id:id(100),analysis};
}
function approvedBatch(){const batch=recommendationBatchFixture();batch.contains_fixture_data=false;batch.references.forEach(r=>{r.origin='live';r.permission_basis='Synthetic permission test only';});return batch;}
function approvedScripts(batch=approvedBatch()){
  const scripts=creatorScriptsFixture();scripts.contains_fixture_data=false;
  const idea=batch.ideas[0]!;
  return {...scripts,idea,references:idea.reference_ids.map(referenceId=>batch.references.find(reference=>reference.id===referenceId)!)};
}

test('model-processing authorization requires exact captured identity/version/snapshot and live approved underlying claim evidence',()=>{
  const saved=approvedStored();assert.equal(canProcessCapturedDna(saved,projectCreatorDna(saved)),true);
  for(const key of ['dna_id','snapshot_id','project_id','version'] as const){const view=projectCreatorDna(saved);if(key==='version')view.version++;else view[key]=id(999);assert.equal(canProcessCapturedDna(saved,view),false);}
  for(const mutate of [
    (s:ReturnType<typeof approvedStored>)=>{s.analysis.scan.video_observations[0]!.provenance.permission.permitted_uses=['store','display'];},
    (s:ReturnType<typeof approvedStored>)=>{s.analysis.scan.video_observations[0]!.provenance.permission.status='fixture_only';},
    (s:ReturnType<typeof approvedStored>)=>{s.analysis.scan.video_observations[0]!.provenance.origin='fixture';},
  ]){const s=approvedStored();mutate(s);assert.equal(canProcessCapturedDna(s,projectCreatorDna(s)),false);}
  const corrected=approvedStored();corrected.analysis.dna.claims[0]!.basis='user_corrected';corrected.analysis.dna.claims[0]!.supersedes_claim_id=id(900);
  corrected.analysis.scan.video_observations[0]!.provenance.permission.permitted_uses=['store','display'];
  assert.equal(canProcessCapturedDna(corrected,projectCreatorDna(corrected)),false);
});

function runner(kind:StoredCreatorJob['kind']='recommendations') {
  const saved=approvedStored(),batch=approvedBatch(),scripts=approvedScripts(batch);
  const job=stored(kind,'running');job.captured=kind==='scan'?{scan:saved.analysis.scan.request}:{stored:saved,...(kind==='scripts'?{batch,idea_id:batch.ideas[0]!.id}:{})};
  const finishes:any[]=[],providerCalls:string[]=[],steps:string[]=[],ingests:unknown[]=[];
  let revision=job.revision;
  const repository:PipelineRepository={async call(op,_account,raw){if(op==='run_creator_job')return wrapped(job);
    if(op==='checkpoint_creator_job'){const input=raw as any;revision++;job.revision=revision;job.stage=input.stage;job.progress=input.progress;
      return {ok:true,data:{status:'stored',revision,checkpoint:{key:input.key,stage:input.stage,progress:input.progress,revision,created_at:job.updated_at}}};}
    if(op==='finish_creator_job'){finishes.push(raw);return wrapped({...job,...raw as object});}throw Error(op);}};
  const creatorRepository:CreatorRepository={async call(_op,_account,raw){ingests.push(raw);return {ok:true,data:saved};}};
  const provider:CreatorPipelineProvider={async scan(){providerCalls.push('scan');return saved.analysis;},async recommend(){providerCalls.push('recommend');return batch;},async generate(){providerCalls.push('generate');return scripts;}};
  const run=()=>runCreatorPipelineJob(repository,creatorRepository,account,job.id,()=>provider,ceilings,async(name,fn)=>{steps.push(name);return fn();});
  return {saved,batch,scripts,job,finishes,providerCalls,steps,ingests,repository,creatorRepository,provider,run};
}

test('runner stages save immutable captured lineage and scan ingestion receipt',async()=>{
  for(const kind of ['scan','recommendations','scripts'] as const){const r=runner(kind);await r.run();assert.equal(r.finishes.length,1);assert.equal(r.finishes[0].state,'succeeded');assert.equal(r.finishes[0].result.kind,kind);assert.equal(r.providerCalls.length,1);
    if(kind==='scan'){assert.equal(r.ingests.length,1);assert.equal((r.ingests[0] as {request_id:string}).request_id,r.job.id);assert.ok(r.steps.includes('save-dna'));}}
});

test('runner rejects captured project and processing rights before provider calls',async()=>{
  for(const mode of ['project','permission']){const r=runner();if(mode==='project')r.saved.project_id=id(999);else r.saved.analysis.scan.video_observations[0]!.provenance.permission.permitted_uses=['store','display'];await r.run();assert.deepEqual(r.providerCalls,[]);assert.equal(r.finishes.at(-1).state,'failed');}
});

test('runner rejects recommendation and script output lineage mismatches',async()=>{
  for(const key of ['dna_id','dna_version','contains_fixture_data'] as const){const r=runner();if(key==='dna_version')r.batch[key]++;else if(key==='contains_fixture_data')r.batch[key]=true;else r.batch[key]=id(999);await r.run();assert.equal(r.finishes.at(-1).state,'failed');}
  for(const key of ['batch_id','idea_id','dna_id','dna_version','references','contains_fixture_data']){const r=runner('scripts');if(key==='dna_version')r.scripts.dna_version++;else if(key==='references')r.scripts.variants[0]!.reference_ids=[id(999)];else if(key==='contains_fixture_data')r.scripts.contains_fixture_data=true;else r.scripts[key as 'batch_id'|'idea_id'|'dna_id']=id(999);await r.run();assert.equal(r.finishes.at(-1).state,'failed');}
});

test('runner rejects missing or substituted Studio context from a script provider',async()=>{
  for(const mode of ['missing','substituted'] as const){
    const r=runner('scripts');
    const providerOutput=r.scripts as {idea?:unknown;references?:Array<Record<string,unknown>>};
    if(mode==='missing'){delete providerOutput.idea;delete providerOutput.references;}
    else providerOutput.references=[{...providerOutput.references![0]!,caption:'Provider-substituted reference content'}];
    await r.run();assert.equal(r.finishes.at(-1).state,'failed',mode);
  }
});

test('runner rejects captured batch or selected idea mismatch before generation',async()=>{
  for(const mode of ['version','idea']){const r=runner('scripts');if(mode==='version')r.batch.dna_version++;else (r.job.captured as {idea_id:string}).idea_id=id(999);await r.run();assert.deepEqual(r.providerCalls,[]);assert.equal(r.finishes.at(-1).state,'failed');}
});

test('runner preserves ambiguous outcome, does not retry providers or failed stage writes',async()=>{
  for(const mode of ['ambiguous','save-result','save-dna']){
    const r=runner(mode==='save-dna'?'scan':'recommendations');
    if(mode==='ambiguous')r.provider.recommend=async()=>{r.providerCalls.push('recommend');throw new PipelineRunError('needs_reconciliation');};
    if(mode==='save-dna')r.creatorRepository.call=async()=>{r.ingests.push('failed');return failure('UNAVAILABLE');};
    if(mode==='save-result'){const call=r.repository.call;r.repository.call=async(op,owner,raw)=>{if(op==='finish_creator_job'&&(raw as {state:string}).state==='succeeded'){r.finishes.push(raw);return failure('UNAVAILABLE');}return call(op,owner,raw);};}
    await r.run();assert.equal(r.providerCalls.length,1);assert.equal(r.finishes.at(-1).state,mode==='ambiguous'?'needs_reconciliation':'failed');
    assert.equal(r.steps.filter(s=>s==='save-result').length,mode==='save-result'?1:0);
  }
});

test('runner ignores terminal jobs and rejects wrong loaded identity without providers',async()=>{
  for(const mode of ['terminal','account','id']){const r=runner();if(mode==='terminal')r.job.state='failed';else if(mode==='account')r.job.account_id=id(999);else r.job.id=id(999);
    if(mode==='terminal')await r.run();else await assert.rejects(runCreatorPipelineJob(r.repository,r.creatorRepository,account,id(620),()=>r.provider,ceilings,step),PipelineRunError);
    assert.deepEqual(r.providerCalls,[]);assert.deepEqual(r.finishes,[]);
  }
});

test('re-entering a durable step after unknown provider outcome cannot execute again',async()=>{
  let reserved=false,executions=0;
  const repo:PipelineRepository={async call(op){assert.equal(op,'reserve_creator_attempt');if(reserved)return reservation('ambiguous');reserved=true;return reservation('acquired');}};
  const run=()=>createGuardedProviderContext(repo,stored(),ceilings,step).call('research','lightreel','research',async()=>{executions++;throw Error('response lost');});
  await assert.rejects(run(),e=>e instanceof PipelineRunError&&e.state==='needs_reconciliation');
  await assert.rejects(run(),e=>e instanceof PipelineRunError&&e.state==='needs_reconciliation');
  assert.equal(executions,1);
});

test('runner rejects a scan for a different captured request before ingesting',async()=>{
  const r=runner('scan');
  (r.job.captured as {scan:unknown}).scan={...r.saved.analysis.scan.request,max_videos:3};
  await r.run();assert.equal(r.providerCalls.length,1);assert.equal(r.ingests.length,0);assert.equal(r.finishes.at(-1).state,'failed');
});

test('ChatGPT drafted variants save with generated durable IDs and no provider construction or calls',async()=>{
  const r=runner('scripts');
  const variants=r.scripts.variants.map(({id:_id,...v})=>v);
  (r.job.captured as Record<string,unknown>).variants=variants;
  await runCreatorPipelineJob(r.repository,r.creatorRepository,account,r.job.id,()=>assert.fail('provider construction'),{scrapecreators:0,lightreel:0,openai:0},step);
  assert.equal(r.finishes.at(-1).state,'succeeded');assert.deepEqual(r.providerCalls,[]);
  const saved=r.finishes.at(-1).result.scripts;
  assert.equal(saved.variants.length,2);assert.equal(new Set(saved.variants.map((v:{id:string})=>v.id)).size,2);
  assert.deepEqual(saved.idea,r.batch.ideas[0]);
  assert.deepEqual(saved.references,r.batch.references.filter(reference=>r.batch.ideas[0]!.reference_ids.includes(reference.id)));
  assert.match(saved.limitations.join(' '),/No separate OpenAI API request/);
  assert.deepEqual(saved.variants.map(({id:_id,...v}:any)=>v),variants);
});

test('saved ChatGPT variants enforce selected reference IDs and unique labels without invoking providers',async()=>{
  for(const invalid of ['reference','label','count']){
    const r=runner('scripts'),variants=r.scripts.variants.map(({id:_id,...v})=>v);
    if(invalid==='reference')variants[0]!.reference_ids=[id(999)];
    if(invalid==='label')variants[1]!.label=variants[0]!.label;
    if(invalid==='count')variants.pop();
    (r.job.captured as Record<string,unknown>).variants=variants;
    await runCreatorPipelineJob(r.repository,r.creatorRepository,account,r.job.id,()=>assert.fail('provider construction'),{scrapecreators:0,lightreel:0,openai:0},step);
    assert.equal(r.finishes.at(-1).state,'failed');assert.deepEqual(r.providerCalls,[]);
  }
});

test('guard retains only enum-only provider diagnostics and redacts arbitrary exception text',async()=>{
  for(const diagnostic of ['creator_provider_transport_http_429','creator_provider_transport_oversized_200','creator_provider_malformed','creator_provider_permission','creator_provider_unavailable_404']){
    const g=guarded(reservation('acquired'));
    await assert.rejects(g.context.call('feed:0','scrapecreators','feed',async()=>{throw new Error(diagnostic);}),error=>{
      assert.ok(error instanceof PipelineRunError);assert.equal(error.diagnostic,diagnostic);
      assert.equal(error.message,`creator_attempt_needs_reconciliation:${diagnostic}`);return true;
    });
  }
  for(const unsafe of ['secret API key','creator_provider_transport_http_429 secret','creator_provider_transport_http_600','creator_provider_transport_http_200_secret','creator_provider_newreason_500','creator_provider_transport_http_200\nsecret','creator_provider_transport_http_200\n','prefix creator_provider_transport_http_500']){
    const g=guarded(reservation('acquired'));
    await assert.rejects(g.context.call('feed:0','scrapecreators','feed',async()=>{throw new Error(unsafe);}),error=>{
      assert.ok(error instanceof PipelineRunError);assert.equal(error.diagnostic,undefined);
      assert.equal(error.message,'creator_attempt_needs_reconciliation');return true;
    });
    assert.equal(new PipelineRunError('needs_reconciliation',unsafe).diagnostic,undefined);
  }
});

test('application, provider guard, queue wall time, and terminal save expose only allowlisted observation fields',async()=>{
  const events:Array<Record<string,unknown>>=[];
  const telemetry={
    record(fields:Record<string,unknown>){events.push({...fields});},
    async measure<T>(fields:Record<string,unknown>,run:()=>Promise<T>){events.push({...fields,status:'measured'});return run();},
  };
  const h=harness();
  const operations=createPipelineOperations(identity,
    {call:(...args)=>h.operations.execute('get_creator_job','token',input('get_creator_job')).then(()=>wrapped(stored()))},
    async()=>{},()=>true,telemetry);
  await operations.execute('get_creator_job','token',input('get_creator_job'));

  const g=guarded(reservation('acquired'),undefined,telemetry);
  await g.context.call('profile','scrapecreators','profile',async()=>({allowed:'received'}));

  const r=runner();
  await runCreatorPipelineJob(r.repository,r.creatorRepository,account,r.job.id,()=>r.provider,ceilings,step,telemetry);
  assert.ok(events.some(event=>event.stage==='application_operation'&&event.operation==='read'));
  assert.ok(events.some(event=>event.stage==='provider_reservation'&&event.operation==='reserve'));
  assert.ok(events.some(event=>event.stage==='receipt_persistence'&&event.operation==='persist'));
  assert.ok(events.some(event=>event.stage==='queue_to_running'&&event.clock==='wall'));
  assert.ok(events.some(event=>event.stage==='terminal_save'&&event.operation==='persist'));
  assert.doesNotMatch(JSON.stringify(events),/private_input|private_snapshot|provider diagnostics|account_id|source_url/i);
});

test('runner preserves sanitized diagnostic through Workflow error wrapping but public results remain generic',async()=>{
  const r=runner('scan');
  const oldCall=r.repository.call;
  r.repository.call=async(op,owner,input)=>op==='reserve_creator_attempt'?reservation('acquired'):oldCall(op,owner,input);
  r.provider.scan=async(_request,context)=>context.call('feed:0','scrapecreators','feed',async()=>{throw new Error('creator_provider_transport_oversized_200');}) as never;
  const wrapped:DurableStep=async(name,run)=>{
    try{return await run();}catch(error){
      if(name.startsWith('provider:'))throw new Error(`Workflow step failed: Error: ${(error as Error).message}\nAdditional private runtime context`);
      throw error;
    }
  };
  await runCreatorPipelineJob(r.repository,r.creatorRepository,account,r.job.id,()=>r.provider,ceilings,wrapped);
  assert.equal(r.finishes.length,1);
  assert.equal(r.finishes[0].state,'needs_reconciliation');
  assert.equal(r.finishes[0].message,'needs_reconciliation:creator_provider_transport_oversized_200');
  const view=publicCreatorJob({...r.job,...r.finishes[0]});
  assert.doesNotMatch(JSON.stringify(view),/creator_provider|private runtime/);
  assert.match(view.message!,/No automatic resubmission/);
});

test('runner does not persist raw provider or Workflow exception details',async()=>{
  for(const message of ['secret key in response',
    'Workflow: creator_attempt_needs_reconciliation:creator_provider_transport_http_500_secret',
    'Workflow: creator_attempt_needs_reconciliation:creator_provider_unknown_http_500']){
    const r=runner();r.provider.recommend=async()=>{throw new Error(message);};await r.run();
    assert.equal(r.finishes[0].message,message.includes('creator_attempt_needs_reconciliation')?'needs_reconciliation':'failed');
    assert.ok(!r.finishes[0].message.includes('secret'));
  }
  const r=runner();r.provider.recommend=async()=>{throw new Error('creator_provider_permission');};await r.run();
  assert.equal(r.finishes[0].message,'failed:creator_provider_permission');
  assert.doesNotMatch(JSON.stringify(publicCreatorJob({...r.job,...r.finishes[0]})),/creator_provider/);
});

test('compact public status copies only allowlisted safe progress and terminal availability',()=>{
 const running=stored('scan','running');
 const status=publicCreatorJobStatus(running);
 assert.deepEqual(Object.keys(status).sort(),['created_at','id','kind','progress','revision','stage','state','terminal_result_available','updated_at']);
 assert.equal(status.terminal_result_available,false);
 assert.equal(publicCreatorJobStatus(stored('scan','succeeded')).terminal_result_available,true);
 assert.doesNotMatch(JSON.stringify(status),/private_input|private_snapshot|account_id|request_id|project_id/);
});

test('checkpoint context uses durable versioned writes and content-free telemetry without provider reservation',async()=>{
 const job=stored('scan','running');job.revision=2;
 const calls:{op:string;raw:any}[]=[],steps:string[]=[],events:Array<Record<string,unknown>>=[];
 let revision=2;
 const repository:PipelineRepository={async call(op,_owner,raw){calls.push({op,raw});const input=raw as any;
  if(op!=='checkpoint_creator_job')assert.fail(`unexpected ${op}`);
  revision++;return {ok:true,data:{status:'stored',revision,checkpoint:{key:input.key,stage:input.stage,progress:input.progress,revision,created_at:job.updated_at}}};
 }};
 const telemetry:any={record(){},async measure(fields:Record<string,unknown>,run:()=>Promise<unknown>){events.push(fields);return run();}};
 const context=createGuardedProviderContext(repository,job,ceilings,async(name,run)=>{steps.push(name);return run();},telemetry) as any;
 const progress={kind:'scan',profile:null,videos:[],limitations:[]};
 await context.checkpoint('scan:profile:start','reading_profile',progress);
 await context.checkpoint('scan:profile','reading_posts',progress);
 assert.deepEqual(steps,['checkpoint:scan:profile:start','checkpoint:scan:profile']);
 assert.deepEqual(calls.map(call=>({op:call.op,revision:call.raw.expected_revision})),[
  {op:'checkpoint_creator_job',revision:2},{op:'checkpoint_creator_job',revision:3}]);
 assert.ok(events.every(event=>event.stage==='checkpoint_persistence'&&event.operation==='persist'));
 assert.doesNotMatch(JSON.stringify(events),/scan:profile|caption|url|account/i);
});

test('compact status read works with providers disabled and never schedules or accepts private input',async()=>{
 const job=stored('recommendations','running'),status=publicCreatorJobStatus(job),calls:string[]=[],dispatches:string[]=[];
 const operations=createPipelineOperations(identity,{async call(operation){calls.push(operation);return {ok:true,data:{status}};}},
  async()=>{dispatches.push('unexpected');},()=>false);
 const result=await operations.execute('get_creator_job_status','token',{job_id:job.id});
 assert.deepEqual(result,{ok:true,data:{status}});assert.deepEqual(calls,['get_creator_job_status']);assert.deepEqual(dispatches,[]);
 assert.equal(code(await operations.execute('get_creator_job_status','token',{job_id:job.id,account_id:account})),'VALIDATION_ERROR');
});

test('checkpoint context accepts exact replay revision and rejects malformed persistence replies',async()=>{
 const job=stored('scripts','running');job.revision=2;const progress={kind:'scripts' as const,limitations:[]};
 for(const [reply,accepted] of [
  [{ok:true,data:{status:'replay',revision:4,checkpoint:{key:'script:generate:start',stage:'building_analysis',progress,revision:3,created_at:job.updated_at}}},true],
  [{ok:true,data:{status:'stored',revision:3,checkpoint:{key:'script:generate:start',stage:'building_analysis',progress,revision:3,created_at:job.updated_at}}},true],
  [{ok:true,data:{status:'stored',revision:2,checkpoint:{key:'script:generate:start',stage:'building_analysis',progress,revision:2,created_at:job.updated_at}}},false],
  [{ok:true,data:{status:'stored',revision:4,checkpoint:{key:'script:generate:start',stage:'building_analysis',progress,revision:4,created_at:job.updated_at}}},false],
  [{ok:true,data:{status:'stored',revision:3,checkpoint:{key:'script:generate:start',stage:'building_analysis',progress,revision:2,created_at:job.updated_at}}},false],
  [{ok:true,data:{status:'stored',revision:3,checkpoint:{key:'changed',stage:'building_analysis',progress,revision:3,created_at:job.updated_at}}},false],
 ] as const){
  const context=createGuardedProviderContext({async call(){return reply;}},job,ceilings,step) as any;
  if(accepted)await assert.doesNotReject(context.checkpoint('script:generate:start','building_analysis',progress));
  else await assert.rejects(context.checkpoint('script:generate:start','building_analysis',progress),PipelineRunError);
 }
});

test('catalog context uses a separate retryable durable boundary and strictly validates its receipt',async()=>{
 const job=stored('scan','running'),steps:string[]=[],pipelineCalls:string[]=[],catalogCalls:any[]=[];
 const catalogObservation=TrustedCatalogObservation.parse({id:id(990),platform:'tiktok',native_id:'990',
  canonical_url:'https://www.tiktok.com/@fixture/video/990',caption:null,thumbnail_url:null,published_at:null,duration_seconds:null,
  metrics:{views:0,likes:null,comments:null,shares:null,saves:null},retrieved_at:job.updated_at,source_observed_at:null,
  origin:'live',permission_basis:'Approved retained metadata.',limitations:['Metadata only.']});
 const context=createGuardedProviderContext({async call(operation){pipelineCalls.push(operation);throw new Error('not used');}},job,ceilings,
  async(name,run)=>{steps.push(name);return run();},undefined,{async list(){throw new Error('not used');},async ingest(owner,input){
   catalogCalls.push({owner,input});return {ok:true,data:{status:'stored',ingested_count:1,observation_ids:[catalogObservation.id]}};
  }});
 await context.ingestCatalog('scan:feed:0','own_profile',[catalogObservation]);
 assert.deepEqual(steps,['catalog:scan:feed:0:own_profile']);assert.deepEqual(pipelineCalls,[]);
 assert.deepEqual(catalogCalls,[{owner:job.account_id,input:{job_id:job.id,checkpoint_key:'scan:feed:0',role:'own_profile',observations:[catalogObservation]}}]);
 const malformed=createGuardedProviderContext({async call(){throw new Error('not used');}},job,ceilings,step,undefined,
  {async list(){throw new Error('not used');},async ingest(){return {ok:true,data:{status:'stored',ingested_count:2,observation_ids:[catalogObservation.id]}};}});
 await assert.rejects(malformed.ingestCatalog('scan:feed:0','own_profile',[catalogObservation]));
 await assert.rejects(context.ingestCatalog('recommend:detail:990','discovered_reference',[catalogObservation]),/Invalid catalog source/);
});
