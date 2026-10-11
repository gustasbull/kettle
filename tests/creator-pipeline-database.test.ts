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
const attempt=(job: string,key='profile',ceiling=10)=>({job_id:job,key,provider:'scrapecreators',operation:'profile',ceiling_microusd:ceiling});

test('zero paid budget and no allowance are seeded; client roles cannot call or inspect internal jobs',async()=>{
 assert.equal((await rpc('start_creator_scan',scanInput())).error?.code,'FORBIDDEN');
 assert.deepEqual((await db.query('select * from public.creator_provider_trials')).rows,[]);
 assert.deepEqual((await db.query('select limit_microusd,reserved_microusd from public.creator_pipeline_budget')).rows,[{limit_microusd:0,reserved_microusd:0}]);
 for(const role of ['anon','authenticated']) for(const sql of ['select * from public.creator_jobs','select * from public.creator_provider_trials',`select public.kettle_list_creator_dispatches('${accountA}','{}')`,`select public.kettle_start_creator_scan('${accountA}','{}')`]) {
  await assert.rejects(db.transaction(async tx=>{await tx.exec(`set local role ${role}`);await tx.exec(sql);}),/permission denied/);
 }
 const rows=await db.query<{relrowsecurity:boolean}>("select relrowsecurity from pg_class where relname in ('creator_jobs','creator_job_events','creator_pipeline_budget','creator_pipeline_allowances','creator_provider_trials','creator_attempts','creator_attempt_receipts')");
 assert.equal(rows.rows.length,7); assert.ok(rows.rows.every(r=>r.relrowsecurity));
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
 await rpc('run_creator_job',{job_id:rec.data.job.id});
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
 assert.equal((await rpc('finish_creator_job',finish)).ok,true);
 assert.equal((await db.query<{remaining_units:number}>("select remaining_units from public.creator_provider_trials where provider='scrapecreators'")).rows[0]!.remaining_units,0,'completion never refunds an attempted request');
});

test('ChatGPT-authored variants are captured immutably with shared script-stage request identity',async()=>{
 await allow();
 const analysis=creatorAnalysisFixture();analysis.dna.id=crypto.randomUUID();
 const stored=await rpc('ingest_creator_analysis',{project_id:projectId,request_id:crypto.randomUUID(),analysis});assert.equal(stored.ok,true);
 const rec=await rpc('start_creator_recommendations',{dna_id:analysis.dna.id,expected_version:1,request_id:crypto.randomUUID()});assert.equal(rec.ok,true);
 await rpc('run_creator_job',{job_id:rec.data.job.id});
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
