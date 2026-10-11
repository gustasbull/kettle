import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { creatorAnalysisFixture } from '../packages/contracts/fixtures/creator-profile.ts';
import { creatorDnaViewFixture } from '../evals/creator-loop/dna-view-fixtures.ts';
import { recommendationBatchFixture, creatorScriptsFixture } from '../evals/creator-loop/pipeline-fixtures.ts';
import { accountA, accountB, createInput } from './fixtures.ts';

const db = new PGlite();
let projectId: string;
const profile = creatorAnalysisFixture().scan.request.supplied_url;
// Raw RPC assertions intentionally include internal capture/receipt fields, never client projections.
type Reply = {ok: boolean; error?: {code: string}; data: Record<string, any>};
async function rpc(op: string, input: unknown, account = accountA): Promise<Reply> {
 return db.transaction(async tx => {
  await tx.exec('set local role service_role');
  return (await tx.query<{r: Reply}>(`select public.kettle_${op}($1::uuid,$2::jsonb) as r`, [account, JSON.stringify(input)])).rows[0]!.r;
 });
}
before(async () => {
 await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin; grant usage on schema public to service_role; alter default privileges in schema public grant all on tables to service_role;');
 for (const f of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()) await db.exec(await readFile(`supabase/migrations/${f}`, 'utf8'));
 await db.exec(await readFile('supabase/seed.sql','utf8'));
 projectId=(await rpc('save_project',createInput())).data.project.id;
});
after(async()=>{await db.close();});
async function allow(enabled=true) {
 await db.query("insert into public.creator_pipeline_allowances(account_id,profile_url,enabled,expires_at) values($1,$2,$3,now()+interval '1 day') on conflict(account_id,profile_url) do update set enabled=excluded.enabled,expires_at=excluded.expires_at",[accountA,profile,enabled]);
}
const scanInput=()=>({project_id:projectId,request_id:crypto.randomUUID(),scan:creatorAnalysisFixture().scan.request});
async function runningScan() {
 await allow(); const start=await rpc('start_creator_scan',scanInput()); assert.equal(start.ok,true);
 const r=await rpc('run_creator_job',{job_id:start.data.job.id}); assert.equal(r.ok,true); return r.data.job;
}
async function saving(job:any) {
 const progress=job.progress;
 const saved=await rpc('checkpoint_creator_job',{job_id:job.id,key:`${job.kind}:test:save`,expected_revision:job.revision,stage:'saving',progress});
 assert.equal(saved.ok,true);return (await rpc('get_creator_job',{job_id:job.id})).data.job;
}
const attempt=(job: string,key='profile',ceiling=10)=>({job_id:job,key,provider:'scrapecreators',operation:'profile',ceiling_microusd:ceiling});

test('zero paid budget and no allowance are seeded; client roles cannot call or inspect internal jobs',async()=>{
 assert.equal((await rpc('start_creator_scan',scanInput())).error?.code,'FORBIDDEN');
 assert.deepEqual((await db.query('select * from public.creator_provider_trials')).rows,[]);
 assert.deepEqual((await db.query('select limit_microusd,reserved_microusd from public.creator_pipeline_budget')).rows,[{limit_microusd:0,reserved_microusd:0}]);
 for(const role of ['anon','authenticated']) for(const sql of ['select * from public.creator_jobs','select * from public.creator_job_checkpoints','select * from public.creator_attempt_outcomes','select * from public.creator_provider_trials',`select public.kettle_list_creator_dispatches('${accountA}','{}')`,`select public.kettle_start_creator_scan('${accountA}','{}')`,`select public.kettle_checkpoint_creator_job('${accountA}','{}')`,`select public.kettle_get_creator_job_status('${accountA}','{}')`,`select public.kettle_record_creator_attempt_outcome('${accountA}','{}')`]) {
  await assert.rejects(db.transaction(async tx=>{await tx.exec(`set local role ${role}`);await tx.exec(sql);}),/permission denied/);
 }
 const rows=await db.query<{relrowsecurity:boolean}>("select relrowsecurity from pg_class where relname in ('creator_jobs','creator_job_events','creator_job_checkpoints','creator_pipeline_budget','creator_pipeline_allowances','creator_provider_trials','creator_attempts','creator_attempt_receipts','creator_attempt_outcomes')");
 assert.equal(rows.rows.length,9); assert.ok(rows.rows.every(r=>r.relrowsecurity));
});
test('account ownership, immutable intent, global start request namespace, and replay after allowance withdrawal',async()=>{
 await allow(); const input=scanInput(); const first=await rpc('start_creator_scan',input); assert.equal(first.ok,true);
 assert.equal(first.data.job.revision,1); assert.deepEqual(first.data.job.captured,{scan:input.scan});
 assert.deepEqual(await rpc('start_creator_scan',input),first);
 assert.equal((await rpc('start_creator_scan',{...input,scan:{...input.scan,max_videos:5}})).error?.code,'IDEMPOTENCY_CONFLICT');
 assert.equal((await rpc('start_creator_recommendations',{dna_id:crypto.randomUUID(),expected_version:1,request_id:input.request_id})).error?.code,'IDEMPOTENCY_CONFLICT');
 assert.equal((await rpc('get_creator_job',{job_id:first.data.job.id},accountB)).error?.code,'NOT_FOUND');
 assert.equal((await rpc('start_creator_scan',scanInput(),accountB)).error?.code,'NOT_FOUND');
 await allow(false);
 assert.deepEqual(await rpc('start_creator_scan',input),first);
 assert.equal((await rpc('start_creator_scan',scanInput())).error?.code,'FORBIDDEN');
 assert.equal((await rpc('run_creator_job',{job_id:first.data.job.id})).error?.code,'FORBIDDEN');
 assert.deepEqual((await rpc('list_creator_dispatches',{})).data.jobs,[]);
 await db.query("update public.accounts set state='suspended' where id=$1",[accountA]);
 assert.equal((await rpc('get_creator_job',{job_id:first.data.job.id})).error?.code,'FORBIDDEN');
 assert.equal((await rpc('start_creator_scan',input)).error?.code,'FORBIDDEN');
 await db.query("update public.accounts set state='active' where id=$1",[accountA]);
 await allow();
 const dispatch=await rpc('list_creator_dispatches',{limit:1});assert.equal(dispatch.data.jobs.length,1);assert.equal(dispatch.data.jobs[0].account_id,accountA);
});
test('recommendations capture an exact DNA version; scripts retain that historical capture after corrections',async()=>{
 await allow();const analysis=creatorAnalysisFixture();analysis.dna.id=crypto.randomUUID();
 const stored=await rpc('ingest_creator_analysis',{project_id:projectId,request_id:crypto.randomUUID(),analysis});assert.equal(stored.ok,true);
 const input={dna_id:analysis.dna.id,expected_version:1,request_id:crypto.randomUUID()};
 const rec=await rpc('start_creator_recommendations',input);assert.equal(rec.ok,true);assert.deepEqual(rec.data.job.captured.stored,stored.data);
 const running=await rpc('run_creator_job',{job_id:rec.data.job.id});
 await saving(running.data.job);
 const batch={...recommendationBatchFixture(),id:crypto.randomUUID(),dna_id:analysis.dna.id};
 const finished=await rpc('finish_creator_job',{job_id:rec.data.job.id,state:'succeeded',result:{kind:'recommendations',batch},message:null});assert.equal(finished.ok,true);
 await rpc('correct_creator_dna',{dna_id:analysis.dna.id,expected_version:1,request_id:crypto.randomUUID(),corrections:[{claim_id:analysis.dna.claims[0]!.id,statement:'A corrected topic'}]});
 assert.equal((await rpc('start_creator_recommendations',{...input,request_id:crypto.randomUUID()})).error?.code,'VERSION_CONFLICT');
 const script=await rpc('start_creator_scripts',{batch_id:batch.id,idea_id:batch.ideas[0]!.id,request_id:crypto.randomUUID()});assert.equal(script.ok,true);
 assert.deepEqual(script.data.job.captured,{stored:stored.data,batch,idea_id:batch.ideas[0]!.id});
 assert.equal((await rpc('start_creator_scripts',{batch_id:batch.id,idea_id:crypto.randomUUID(),request_id:crypto.randomUUID()})).error?.code,'NOT_FOUND');
 assert.equal((await rpc('start_creator_scripts',{batch_id:batch.id,idea_id:batch.ideas[0]!.id,request_id:crypto.randomUUID()},accountB)).error?.code,'NOT_FOUND');
});
test('attempt intent reserves once, ambiguous attempts never reacquire, receipts replay, and ceilings remain reserved',async()=>{
 const job=await runningScan();
 assert.equal((await rpc('reserve_creator_attempt',attempt(job.id))).error?.code,'FORBIDDEN');
 await db.exec('update public.creator_pipeline_budget set limit_microusd=25');
 assert.equal((await rpc('reserve_creator_attempt',attempt(job.id))).data.status,'acquired');
 assert.equal((await rpc('reserve_creator_attempt',attempt(job.id))).data.status,'ambiguous');
 assert.equal((await rpc('reserve_creator_attempt',attempt(job.id,'profile',11))).error?.code,'IDEMPOTENCY_CONFLICT');
 const receipt={ok:true,provider:'scrapecreators',profile:{id:'fixture'}};
 assert.equal((await rpc('complete_creator_attempt',{job_id:job.id,key:'profile',receipt})).data.status,'completed');
 assert.equal((await rpc('complete_creator_attempt',{job_id:job.id,key:'profile',receipt:{changed:true}})).error?.code,'IDEMPOTENCY_CONFLICT');
 assert.deepEqual((await rpc('reserve_creator_attempt',attempt(job.id))).data,{status:'replay',receipt});
 assert.equal((await rpc('reserve_creator_attempt',attempt(job.id,'second'))).data.status,'acquired');
 assert.equal((await rpc('reserve_creator_attempt',attempt(job.id,'third'))).error?.code,'FORBIDDEN');
 assert.equal((await db.query<{reserved_microusd:number}>('select reserved_microusd from public.creator_pipeline_budget')).rows[0]!.reserved_microusd,20);
 await allow(false);
 assert.equal((await rpc('reserve_creator_attempt',attempt(job.id,'new',1))).error?.code,'FORBIDDEN');
 assert.equal((await rpc('reserve_creator_attempt',attempt(job.id,'second'))).data.status,'ambiguous');
 assert.equal((await rpc('complete_creator_attempt',{job_id:job.id,key:'second',receipt})).ok,true,'already reserved response can be persisted after allowance withdrawal');
 assert.equal((await rpc('complete_creator_attempt',{job_id:job.id,key:'missing',receipt})).error?.code,'NOT_FOUND');
 assert.equal((await rpc('reserve_creator_attempt',attempt(job.id),accountB)).error?.code,'NOT_FOUND');
});
test('terminal states and append-only histories cannot be overwritten; exact terminal replay does not create events',async()=>{
 const job=await runningScan(); const finish={job_id:job.id,state:'needs_reconciliation',result:null,message:'A paid attempt has an unknown outcome.'};
 const done=await rpc('finish_creator_job',finish);assert.equal(done.ok,true);assert.equal(done.data.job.revision,3);
 assert.deepEqual(await rpc('finish_creator_job',finish),done);
 assert.deepEqual(await rpc('run_creator_job',{job_id:job.id}),done);
 assert.equal((await rpc('finish_creator_job',{...finish,state:'failed'})).error?.code,'IDEMPOTENCY_CONFLICT');
 const events=await db.query<{revision:number;state:string}>('select revision,state from public.creator_job_events where job_id=$1 order by revision',[job.id]);
 assert.deepEqual(events.rows,[{revision:1,state:'queued'},{revision:2,state:'running'},{revision:3,state:'needs_reconciliation'}]);
 for(const sql of ["update public.creator_attempt_receipts set receipt='{}'",'delete from public.creator_attempts',"update public.creator_jobs set input='{}'",'delete from public.creator_job_events']) await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role service_role');await tx.exec(sql);}),/permission denied/);
 await assert.rejects(db.query("update public.creator_jobs set state='running',revision=revision+1 where id=$1",[job.id]),/immutable creator job/);
});

test('attempt outcomes are append-only, exact-replayable and take precedence over receipts',async()=>{
 const job=await runningScan();await db.exec('update public.creator_pipeline_budget set limit_microusd=reserved_microusd+100');
 assert.equal((await rpc('reserve_creator_attempt',attempt(job.id,'profile',10))).data.status,'acquired');
 const input={job_id:job.id,key:'profile',terminal_state:'failed',failure_code:'http_4xx',http_status:429};
 const first=await rpc('record_creator_attempt_outcome',input);assert.equal(first.data.status,'recorded');
 const replay=await rpc('record_creator_attempt_outcome',input);assert.equal(replay.data.status,'replay');assert.deepEqual(replay.data.outcome,first.data.outcome);
 assert.equal((await rpc('record_creator_attempt_outcome',{...input,http_status:404})).error?.code,'IDEMPOTENCY_CONFLICT');
 const reserved=await rpc('reserve_creator_attempt',attempt(job.id,'profile',10));assert.equal(reserved.data.status,'definite_failure');
 assert.equal((await rpc('complete_creator_attempt',{job_id:job.id,key:'profile',receipt:{ok:true}})).error?.code,'FORBIDDEN');
 assert.equal((await rpc('finish_creator_job',{job_id:job.id,state:'succeeded',result:{kind:'scan',dna:{}},message:null})).error?.code,'FORBIDDEN');
 await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role service_role');await tx.query("update public.creator_attempt_outcomes set failure_code='unavailable' where job_id=$1",[job.id]);}),/permission denied/);
 await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role service_role');await tx.query('delete from public.creator_attempt_outcomes where job_id=$1',[job.id]);}),/permission denied/);
});

test('semantic definite outcome may follow a receipt while ambiguous outcome may not',async()=>{
 await db.exec('update public.creator_pipeline_budget set limit_microusd=reserved_microusd+100');
 const definite=await runningScan();await rpc('reserve_creator_attempt',attempt(definite.id,'profile',10));
 await rpc('complete_creator_attempt',{job_id:definite.id,key:'profile',receipt:{ok:true}});
 assert.equal((await rpc('record_creator_attempt_outcome',{job_id:definite.id,key:'profile',terminal_state:'failed',failure_code:'schema_invalid',http_status:200})).ok,true);
 assert.equal((await rpc('reserve_creator_attempt',attempt(definite.id,'profile',10))).data.status,'definite_failure');
 const ambiguous=await runningScan();await rpc('reserve_creator_attempt',attempt(ambiguous.id,'profile',10));
 await rpc('complete_creator_attempt',{job_id:ambiguous.id,key:'profile',receipt:{ok:true}});
 assert.equal((await rpc('record_creator_attempt_outcome',{job_id:ambiguous.id,key:'profile',terminal_state:'needs_reconciliation',failure_code:'timeout',http_status:null})).error?.code,'FORBIDDEN');
 const impossible=await runningScan();await rpc('reserve_creator_attempt',attempt(impossible.id,'profile',10));
 await rpc('complete_creator_attempt',{job_id:impossible.id,key:'profile',receipt:{ok:true}});
 assert.equal((await rpc('record_creator_attempt_outcome',{job_id:impossible.id,key:'profile',terminal_state:'failed',failure_code:'http_5xx',http_status:503})).error?.code,'FORBIDDEN');
});

test('stopped workflow reconciliation classifies durable state atomically without redispatch',async()=>{
 await db.exec('update public.creator_pipeline_budget set limit_microusd=reserved_microusd+100');
 const unresolved=await runningScan();await rpc('reserve_creator_attempt',attempt(unresolved.id,'profile',10));
 assert.equal((await rpc('reconcile_creator_job',{job_id:unresolved.id})).data.job.state,'needs_reconciliation');
 const failed=await runningScan();await rpc('reserve_creator_attempt',attempt(failed.id,'profile',10));
 await rpc('record_creator_attempt_outcome',{job_id:failed.id,key:'profile',terminal_state:'failed',failure_code:'http_5xx',http_status:503});
 assert.equal((await rpc('reconcile_creator_job',{job_id:failed.id})).data.job.state,'failed');
 const receipted=await runningScan();await rpc('reserve_creator_attempt',attempt(receipted.id,'profile',10));
 await rpc('complete_creator_attempt',{job_id:receipted.id,key:'profile',receipt:{ok:true}});
 assert.equal((await rpc('reconcile_creator_job',{job_id:receipted.id})).data.job.state,'failed');
});
test('per-job attempt ceiling, receipt size, expiry, and invalid provider pairs fail before new reservations',async()=>{
 const job=await runningScan();await db.exec('update public.creator_pipeline_budget set limit_microusd=1000');
 assert.equal((await rpc('reserve_creator_attempt',{...attempt(job.id),provider:'lightreel'})).error?.code,'VALIDATION_ERROR');
 for(let i=0;i<32;i++) assert.equal((await rpc('reserve_creator_attempt',attempt(job.id,`key:${i}`,1))).data.status,'acquired');
 assert.equal((await rpc('reserve_creator_attempt',attempt(job.id,'overflow',1))).error?.code,'FORBIDDEN');
 assert.equal((await rpc('complete_creator_attempt',{job_id:job.id,key:'key:0',receipt:{oversized:'x'.repeat(307200)}})).error?.code,'VALIDATION_ERROR');
 assert.equal((await rpc('reserve_creator_attempt',attempt(job.id,'key:0',1))).data.status,'ambiguous');
 await db.exec("update public.creator_pipeline_allowances set expires_at=now()-interval '1 second'");
 assert.equal((await rpc('start_creator_scan',scanInput())).error?.code,'FORBIDDEN');
 assert.deepEqual((await rpc('list_creator_dispatches',{limit:100})).data.jobs,[]);
});

test('failure after budget reservation rolls back the intent and budget together',async()=>{
 const job=await runningScan();
 await db.exec('update public.creator_pipeline_budget set limit_microusd=1000');
 const before=(await db.query('select reserved_microusd from public.creator_pipeline_budget')).rows;
 await db.exec(`create function public.test_creator_attempt_failure() returns trigger language plpgsql as $$ begin raise exception 'synthetic attempt insert failure'; end; $$;
 create trigger test_creator_attempt_failure after insert on public.creator_attempts for each row execute function public.test_creator_attempt_failure();`);
 try {
  await assert.rejects(rpc('reserve_creator_attempt',attempt(job.id)),/synthetic attempt insert failure/);
  assert.deepEqual((await db.query('select reserved_microusd from public.creator_pipeline_budget')).rows,before);
  assert.deepEqual((await db.query('select key from public.creator_attempts where job_id=$1',[job.id])).rows,[]);
 } finally { await db.exec('drop trigger test_creator_attempt_failure on public.creator_attempts; drop function public.test_creator_attempt_failure();'); }
 assert.equal((await rpc('reserve_creator_attempt',attempt(job.id))).data.status,'acquired');
});

test('dispatch recovery lists queued and running only, bounds results, and excludes suspended or disallowed accounts',async()=>{
 await allow();
 // Isolate dispatch eligibility from earlier cases without deleting append-only jobs.
 const prior=(await rpc('list_creator_dispatches',{limit:10})).data.jobs;
 for(const j of prior) await rpc('finish_creator_job',{job_id:j.id,state:'failed',result:null,message:'Synthetic prior job closed.'});
 const queued=await rpc('start_creator_scan',scanInput());assert.equal(queued.ok,true);
 const running=await runningScan();
 const failed=await rpc('start_creator_scan',scanInput());
 await rpc('finish_creator_job',{job_id:failed.data.job.id,state:'failed',result:null,message:'Synthetic failure'});
 assert.deepEqual((await rpc('list_creator_dispatches',{})).data.jobs.map((j:any)=>({id:j.id,account_id:j.account_id,state:j.state})),[
  {id:queued.data.job.id,account_id:accountA,state:'queued'}, {id:running.id,account_id:accountA,state:'running'}
 ]);
 await allow(false);assert.deepEqual((await rpc('list_creator_dispatches',{})).data.jobs,[]);
 await allow();await db.query("update public.accounts set state='suspended' where id=$1",[accountA]);
 assert.deepEqual((await rpc('list_creator_dispatches',{})).data.jobs,[]);
 await db.query("update public.accounts set state='active' where id=$1",[accountA]);
 await db.exec("update public.creator_pipeline_allowances set expires_at=now()-interval '1 second'");
 assert.deepEqual((await rpc('list_creator_dispatches',{})).data.jobs,[]);
 await allow();
 for(let i=0;i<11;i++) assert.equal((await rpc('start_creator_scan',scanInput())).ok,true);
 assert.equal((await rpc('list_creator_dispatches',{limit:100})).data.jobs.length,10);
 assert.equal((await rpc('list_creator_dispatches',{limit:1})).data.jobs.length,1);
 assert.equal((await rpc('list_creator_dispatches',{limit:0})).data.jobs.length,0);
});

test('free trial authority consumes one unit once, denies expiry/exhaustion/disabled/missing trials, and never permits free OpenAI',async()=>{
 const job=await runningScan();
 const dollarBefore=(await db.query('select reserved_microusd from public.creator_pipeline_budget')).rows;
 const request=attempt(job.id,'trial:profile',0);
 assert.equal((await rpc('reserve_creator_attempt',request)).error?.code,'FORBIDDEN');
 await db.exec("insert into public.creator_provider_trials(provider,remaining_units,enabled,expires_at) values('scrapecreators',2,true,now()+interval '1 hour'),('lightreel',2,true,now()+interval '1 hour')");
 assert.equal((await rpc('reserve_creator_attempt',request)).data.status,'acquired');
 assert.equal((await rpc('reserve_creator_attempt',request)).data.status,'ambiguous');
 assert.equal((await db.query<{remaining_units:number}>("select remaining_units from public.creator_provider_trials where provider='scrapecreators'")).rows[0]!.remaining_units,1);
 await rpc('complete_creator_attempt',{job_id:job.id,key:request.key,receipt:{synthetic:true}});
 assert.equal((await rpc('reserve_creator_attempt',request)).data.status,'replay');
 assert.equal((await rpc('reserve_creator_attempt',{...request,key:'trial:second'})).data.status,'acquired');
 assert.equal((await rpc('reserve_creator_attempt',{...request,key:'trial:exhausted'})).error?.code,'FORBIDDEN');
 const research={...request,key:'trial:research',provider:'lightreel',operation:'research'};
 await db.exec("update public.creator_provider_trials set enabled=false where provider='lightreel'");
 assert.equal((await rpc('reserve_creator_attempt',research)).error?.code,'FORBIDDEN');
 await db.exec("update public.creator_provider_trials set enabled=true,expires_at=now()-interval '1 second' where provider='lightreel'");
 assert.equal((await rpc('reserve_creator_attempt',research)).error?.code,'FORBIDDEN');
 await db.exec("update public.creator_provider_trials set expires_at=now()+interval '1 hour' where provider='lightreel'");
 assert.equal((await rpc('reserve_creator_attempt',research)).data.status,'acquired');
 assert.equal((await rpc('reserve_creator_attempt',{...research,key:'trial:poll',operation:'poll'})).data.status,'acquired');
 assert.equal((await rpc('reserve_creator_attempt',{...request,key:'trial:openai',provider:'openai',operation:'generate'})).error?.code,'FORBIDDEN');
 await assert.rejects(db.exec("insert into public.creator_provider_trials(provider,remaining_units,enabled,expires_at) values('openai',5,true,now()+interval '1 hour')"),/check constraint/);
 assert.deepEqual((await db.query('select reserved_microusd from public.creator_pipeline_budget')).rows,dollarBefore);
});
test('trial debit rolls back with failed intent insert and ambiguous pending attempts prevent successful completion',async()=>{
 const job=await runningScan();
 await db.exec("update public.creator_provider_trials set remaining_units=1,enabled=true,expires_at=now()+interval '1 hour' where provider='scrapecreators'");
 await db.exec(`create function public.test_creator_trial_failure() returns trigger language plpgsql as $$ begin raise exception 'synthetic trial insert failure'; end; $$;
 create trigger test_creator_trial_failure after insert on public.creator_attempts for each row execute function public.test_creator_trial_failure();`);
 const request=attempt(job.id,'trial:rollback',0);
 try {
  await assert.rejects(rpc('reserve_creator_attempt',request),/synthetic trial insert failure/);
  assert.equal((await db.query<{remaining_units:number}>("select remaining_units from public.creator_provider_trials where provider='scrapecreators'")).rows[0]!.remaining_units,1);
  assert.deepEqual((await db.query('select key from public.creator_attempts where job_id=$1',[job.id])).rows,[]);
 } finally { await db.exec('drop trigger test_creator_trial_failure on public.creator_attempts; drop function public.test_creator_trial_failure();'); }
 assert.equal((await rpc('reserve_creator_attempt',request)).data.status,'acquired');
 const finish={job_id:job.id,state:'succeeded',result:{kind:'scan',dna:creatorDnaViewFixture()},message:null};
 assert.equal((await rpc('finish_creator_job',finish)).error?.code,'FORBIDDEN');
 assert.equal((await rpc('get_creator_job',{job_id:job.id})).data.job.state,'running');
 await rpc('complete_creator_attempt',{job_id:job.id,key:request.key,receipt:{synthetic:true}});
 await saving((await rpc('get_creator_job',{job_id:job.id})).data.job);
 assert.equal((await rpc('finish_creator_job',finish)).ok,true);
 assert.equal((await db.query<{remaining_units:number}>("select remaining_units from public.creator_provider_trials where provider='scrapecreators'")).rows[0]!.remaining_units,0,'completion never refunds an attempted request');
});

test('ChatGPT-authored variants are captured immutably with shared script-stage request identity',async()=>{
 await allow();
 const analysis=creatorAnalysisFixture();analysis.dna.id=crypto.randomUUID();
 const stored=await rpc('ingest_creator_analysis',{project_id:projectId,request_id:crypto.randomUUID(),analysis});assert.equal(stored.ok,true);
 const rec=await rpc('start_creator_recommendations',{dna_id:analysis.dna.id,expected_version:1,request_id:crypto.randomUUID()});assert.equal(rec.ok,true);
 const running=await rpc('run_creator_job',{job_id:rec.data.job.id});await saving(running.data.job);
 const batch={...recommendationBatchFixture(),id:crypto.randomUUID(),dna_id:analysis.dna.id};
 assert.equal((await rpc('finish_creator_job',{job_id:rec.data.job.id,state:'succeeded',result:{kind:'recommendations',batch},message:null})).ok,true);
 const variants=creatorScriptsFixture().variants;
 const input={batch_id:batch.id,idea_id:batch.ideas[0]!.id,request_id:crypto.randomUUID(),variants};
 const saved=await rpc('save_creator_scripts',input);assert.equal(saved.ok,true);
 assert.equal(saved.data.job.kind,'scripts');
 assert.deepEqual(saved.data.job.captured,{stored:stored.data,batch,idea_id:input.idea_id,variants});
 assert.deepEqual(await rpc('save_creator_scripts',input),saved);
 assert.equal((await rpc('save_creator_scripts',{...input,variants:variants.map(v=>({...v,hook:'Changed hook'}))})).error?.code,'IDEMPOTENCY_CONFLICT');
 const {variants:_variants,...withoutVariants}=input;
 assert.equal((await rpc('start_creator_scripts',withoutVariants)).error?.code,'IDEMPOTENCY_CONFLICT');
 assert.equal((await rpc('save_creator_scripts',input,accountB)).error?.code,'NOT_FOUND');
 for(const invalid of [null,{},[],variants.slice(0,1),[...variants,...variants]]) {
  assert.equal((await rpc('save_creator_scripts',{...input,request_id:crypto.randomUUID(),variants:invalid})).error?.code,'VALIDATION_ERROR');
 }
 for(const role of ['anon','authenticated']) await assert.rejects(db.transaction(async tx=>{
  await tx.exec(`set local role ${role}`);
  await tx.query('select public.kettle_save_creator_scripts($1::uuid,$2::jsonb)',[accountA,JSON.stringify(input)]);
 }),/permission denied/);
 assert.deepEqual((await db.query('select key from public.creator_attempts where job_id=$1',[saved.data.job.id])).rows,[]);
});

test('creator checkpoints are versioned, append-only, exact-replayable and preserve terminal progress',async()=>{
 const job=await runningScan();
 assert.equal(job.stage,'accepted');
 assert.deepEqual(job.progress,{kind:'scan',profile:null,videos:[],limitations:[]});
 const progress={kind:'scan',profile:null,videos:[],limitations:[]};
 const first=await rpc('checkpoint_creator_job',{job_id:job.id,key:'scan:profile:start',expected_revision:job.revision,
  stage:'reading_profile',progress});
 assert.equal(first.ok,true);assert.equal(first.data.status,'stored');assert.equal(first.data.revision,job.revision+1);
 const replay=await rpc('checkpoint_creator_job',{job_id:job.id,key:'scan:profile:start',expected_revision:job.revision,
  stage:'reading_profile',progress});
 assert.equal(replay.data.status,'replay');assert.equal(replay.data.revision,job.revision+1);
 assert.equal((await rpc('checkpoint_creator_job',{job_id:job.id,key:'scan:profile:start',expected_revision:job.revision+1,
  stage:'reading_profile',progress:{...progress,limitations:['changed']}})).error?.code,'IDEMPOTENCY_CONFLICT');
 assert.equal((await rpc('checkpoint_creator_job',{job_id:job.id,key:'scan:analysis',expected_revision:job.revision,
  stage:'building_analysis',progress})).error?.code,'VERSION_CONFLICT');
 const save=await rpc('checkpoint_creator_job',{job_id:job.id,key:'scan:save',expected_revision:job.revision+1,
  stage:'saving',progress});assert.equal(save.ok,true);
 const finished=await rpc('finish_creator_job',{job_id:job.id,state:'failed',result:null,message:'fixture'});
 assert.equal(finished.data.job.stage,'saving');assert.deepEqual(finished.data.job.progress,progress);
 assert.equal((await rpc('checkpoint_creator_job',{job_id:job.id,key:'scan:new',expected_revision:finished.data.job.revision,
  stage:'saving',progress:{...progress,limitations:['later']}})).error?.code,'FORBIDDEN');
 assert.equal((await rpc('checkpoint_creator_job',{job_id:job.id,key:'scan:profile:start',expected_revision:job.revision,
  stage:'reading_profile',progress})).data.status,'replay');
 const rows=await db.query('select key,revision from public.creator_job_checkpoints where job_id=$1 order by revision',[job.id]);
 assert.deepEqual(rows.rows,[{key:'scan:profile:start',revision:job.revision+1},{key:'scan:save',revision:job.revision+2}]);
});

test('compact creator status is owned, provider-free and exposes only safe fields',async()=>{
 const job=await runningScan();const status=await rpc('get_creator_job_status',{job_id:job.id});assert.equal(status.ok,true);
 assert.deepEqual(Object.keys(status.data.status).sort(),['created_at','id','kind','progress','revision','stage','state','terminal_result_available','updated_at']);
 assert.equal((await rpc('get_creator_job_status',{job_id:job.id},accountB)).error?.code,'NOT_FOUND');
 assert.equal((await rpc('get_creator_job_status',{job_id:crypto.randomUUID()},accountB)).error?.code,'NOT_FOUND');
 await db.query("update public.accounts set state='suspended' where id=$1",[accountA]);
 assert.equal((await rpc('get_creator_job_status',{job_id:job.id})).error?.code,'FORBIDDEN');
 await db.query("update public.accounts set state='active' where id=$1",[accountA]);
 for(const role of ['anon','authenticated']) await assert.rejects(db.transaction(async tx=>{
  await tx.exec(`set local role ${role}`);await tx.query('select public.kettle_get_creator_job_status($1::uuid,$2::jsonb)',[accountA,JSON.stringify({job_id:job.id})]);
 }),/permission denied/);
});

test('checkpoint progress is monotonic, strict and cannot mutate profile or prior cards',async()=>{
 const job=await runningScan(),base={kind:'scan',profile:null,videos:[],limitations:[]};
 const start=await rpc('checkpoint_creator_job',{job_id:job.id,key:'scan:profile:start',expected_revision:job.revision,stage:'reading_profile',progress:base});
 const provenance={origin:'live',retrieved_at:'2026-10-11T08:00:00.000Z',source_observed_at:null,permission_basis:'Fixture permission.',limitations:[]};
 const profileProgress={...base,profile:{platform:'tiktok',native_id:'9000000000000000001',url:profile,handle:'fictional_kettle_creator',
  display_name:null,bio:null,follower_count:null,provenance}};
 const profileSaved=await rpc('checkpoint_creator_job',{job_id:job.id,key:'scan:profile',expected_revision:start.data.revision,stage:'reading_posts',progress:profileProgress});
 const card={platform:'tiktok',native_id:'9000000000000000011',url:`${profile}/video/9000000000000000011`,caption:null,published_at:null,
  duration_seconds:null,metrics:{views:null,likes:null,comments:null,shares:null},provenance};
 const feed={...profileProgress,videos:[card]};
 const feedSaved=await rpc('checkpoint_creator_job',{job_id:job.id,key:'scan:feed:0',expected_revision:profileSaved.data.revision,stage:'reading_posts',progress:feed});
 assert.equal(feedSaved.ok,true);
 for(const [key,stage,progressValue] of [
  ['scan:duplicate','reading_posts',feed],
  ['scan:regress','reading_profile',feed],
  ['scan:shrink','reading_posts',profileProgress],
  ['scan:change-profile','building_analysis',{...feed,profile:{...profileProgress.profile,handle:'changed'}}],
  ['scan:private','building_analysis',{...feed,receipt:'secret'}],
 ] as const){
  const result=await rpc('checkpoint_creator_job',{job_id:job.id,key,expected_revision:feedSaved.data.revision,stage,progress:progressValue});
  assert.equal(result.error?.code,'VALIDATION_ERROR',key);
 }
 assert.equal((await rpc('checkpoint_creator_job',{job_id:job.id,key:'scan:analysis',expected_revision:feedSaved.data.revision,
  stage:'building_analysis',progress:feed})).ok,true,'forward stage with unchanged truthful snapshot is valid');
});

test('checkpoint insert failure rolls back revision/event and checkpoint writes together',async()=>{
 const job=await runningScan();const beforeEvents=(await db.query<{count:number}>('select count(*)::int count from public.creator_job_events where job_id=$1',[job.id])).rows[0]!.count;
 await db.exec(`create function public.test_checkpoint_failure() returns trigger language plpgsql as $$ begin raise exception 'synthetic checkpoint insert failure'; end; $$;
  create trigger test_checkpoint_failure before insert on public.creator_job_checkpoints for each row execute function public.test_checkpoint_failure();`);
 try{await assert.rejects(rpc('checkpoint_creator_job',{job_id:job.id,key:'scan:profile:start',expected_revision:job.revision,
  stage:'reading_profile',progress:job.progress}),/synthetic checkpoint insert failure/);}finally{
  await db.exec('drop trigger test_checkpoint_failure on public.creator_job_checkpoints; drop function public.test_checkpoint_failure();');
 }
 const current=(await rpc('get_creator_job',{job_id:job.id})).data.job;
 assert.equal(current.revision,job.revision);assert.equal(current.stage,'accepted');
 assert.equal((await db.query<{count:number}>('select count(*)::int count from public.creator_job_events where job_id=$1',[job.id])).rows[0]!.count,beforeEvents);
 assert.deepEqual((await db.query('select * from public.creator_job_checkpoints where job_id=$1',[job.id])).rows,[]);
});

test('checkpoint and status never change attempts, receipts, grants, trials or budget and direct writes stay denied',async()=>{
 const job=await runningScan();
 const authority=(await db.query<{security_definer:boolean;empty_path:boolean;stage_update:boolean;checkpoint_insert:boolean;rpc_execute:boolean}>(`
  select p.prosecdef security_definer,p.proconfig=array['search_path=""']::text[] empty_path,
   has_column_privilege('service_role','public.creator_jobs','stage','UPDATE') stage_update,
   has_table_privilege('service_role','public.creator_job_checkpoints','INSERT') checkpoint_insert,
   has_function_privilege('service_role','public.kettle_checkpoint_creator_job(uuid,jsonb)','EXECUTE') rpc_execute
  from pg_proc p where p.oid='public.kettle_checkpoint_creator_job(uuid,jsonb)'::regprocedure`)).rows[0]!;
 assert.deepEqual(authority,{security_definer:true,empty_path:true,stage_update:false,checkpoint_insert:false,rpc_execute:true});
 const beforeRevision=job.revision;
 const beforeEvents=(await db.query<{count:number}>('select count(*)::int count from public.creator_job_events where job_id=$1',[job.id])).rows[0]!.count;
 await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role service_role');
  await tx.exec("select set_config('kettle.checkpoint_write','on',true)");
  await tx.query("update public.creator_jobs set stage='reading_profile',revision=revision+1,updated_at=now() where id=$1",[job.id]);
  throw new Error('caller-settable checkpoint GUC bypass succeeded');
 }),/permission denied|immutable creator job/);
 await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role service_role');
  await tx.query("insert into public.creator_job_checkpoints(job_id,key,stage,progress,revision) values($1,'scan:forged','reading_profile',$2::jsonb,$3)",
   [job.id,JSON.stringify(job.progress),job.revision+1]);
  throw new Error('direct checkpoint insert succeeded');
 }),/permission denied/);
 const afterBypass=(await rpc('get_creator_job',{job_id:job.id})).data.job;
 assert.equal(afterBypass.revision,beforeRevision);assert.equal(afterBypass.stage,'accepted');
 assert.equal((await db.query<{count:number}>('select count(*)::int count from public.creator_job_events where job_id=$1',[job.id])).rows[0]!.count,beforeEvents);
 assert.deepEqual((await db.query('select * from public.creator_job_checkpoints where job_id=$1',[job.id])).rows,[]);
 const before={attempts:(await db.query('select * from public.creator_attempts where job_id=$1',[job.id])).rows,
  receipts:(await db.query('select * from public.creator_attempt_receipts where job_id=$1',[job.id])).rows,
  budget:(await db.query('select * from public.creator_pipeline_budget')).rows,
  trials:(await db.query('select * from public.creator_provider_trials order by provider')).rows};
 await rpc('checkpoint_creator_job',{job_id:job.id,key:'scan:profile:start',expected_revision:job.revision,stage:'reading_profile',progress:job.progress});
 await rpc('get_creator_job_status',{job_id:job.id});
 assert.deepEqual((await db.query('select * from public.creator_attempts where job_id=$1',[job.id])).rows,before.attempts);
 assert.deepEqual((await db.query('select * from public.creator_attempt_receipts where job_id=$1',[job.id])).rows,before.receipts);
 assert.deepEqual((await db.query('select * from public.creator_pipeline_budget')).rows,before.budget);
 assert.deepEqual((await db.query('select * from public.creator_provider_trials order by provider')).rows,before.trials);
 await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role service_role');
  await tx.query("update public.creator_jobs set stage='building_analysis',revision=revision+1 where id=$1",[job.id]);}),/permission denied|immutable creator job/);
 await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role service_role');
  await tx.query('delete from public.creator_job_checkpoints where job_id=$1',[job.id]);}),/permission denied/);
});

test('progress migration backfills legacy jobs and events without editing applied history',async t=>{
 const legacy=new PGlite();t.after(()=>legacy.close());
 await legacy.exec('create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin; grant usage on schema public to service_role; alter default privileges in schema public grant all on tables to service_role;');
 const files=(await readdir('supabase/migrations')).filter(file=>file.endsWith('.sql')).sort();
 for(const file of files.filter(file=>file<'20261011091042_creator_job_progress.sql'))await legacy.exec(await readFile(`supabase/migrations/${file}`,'utf8'));
 await legacy.exec(await readFile('supabase/seed.sql','utf8'));
 const legacyProject=(await legacy.query<{id:string}>('select id from public.projects limit 1')).rows[0]!.id;
 await legacy.query(`insert into public.creator_jobs(account_id,project_id,kind,input,captured,request_id)
  values($1,$2,'scan','{}','{}',$3)`,[accountA,legacyProject,crypto.randomUUID()]);
 await legacy.exec(await readFile('supabase/migrations/20261011091042_creator_job_progress.sql','utf8'));
 const rows=(await legacy.query<any>('select stage,progress from public.creator_jobs')).rows;
 assert.deepEqual(rows,[{stage:'accepted',progress:{kind:'scan',profile:null,videos:[],limitations:[]}}]);
 assert.deepEqual((await legacy.query<any>('select stage,progress from public.creator_job_events')).rows,rows);
});
