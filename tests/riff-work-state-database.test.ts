import { before,after,test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile,readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { accountA,accountB,createInput } from './fixtures.ts';

const db=new PGlite();
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let project:string,foreignProject:string;
const job=id(701),variantA=id(702),variantB=id(703),foreignJob=id(704),scanJob=id(705),runningJob=id(706),rollbackJob=id(707),rollbackVariant=id(708);
const variantV7Upper='018F3E12-9ABC-7DEF-8ABC-1234567890AB',variantV7=variantV7Upper.toLowerCase();
const request=(n:number)=>id(800+n);
type Reply={ok:boolean;data?:any;error?:{code:string}};
async function rpc(input:unknown,account=accountA):Promise<Reply>{return db.transaction(async tx=>{await tx.exec('set local role service_role');return (await tx.query<{value:Reply}>('select public.kettle_set_riff_work_state($1::uuid,$2::jsonb) value',[account,JSON.stringify(input)])).rows[0]!.value;});}
const mutation=(state:'active'|'saved'|'filmed',expected_version:number,request_id:string,variant_id=variantA,job_id=job)=>({job_id,variant_id,state,expected_version,request_id});

before(async()=>{
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin; grant usage on schema public to service_role; alter default privileges in schema public grant all on tables to service_role;');
  for(const file of (await readdir('supabase/migrations')).filter(file=>file.endsWith('.sql')).sort())await db.exec(await readFile(`supabase/migrations/${file}`,'utf8'));
  await db.exec(await readFile('supabase/seed.sql','utf8'));
  const own=createInput();own.name='Work state fixture';
  const foreign=createInput();foreign.name='Foreign work';
  const save=async(account:string,input:unknown)=>(await db.transaction(async tx=>{await tx.exec('set local role service_role');return (await tx.query<{value:Reply}>('select public.kettle_save_project($1::uuid,$2::jsonb) value',[account,JSON.stringify(input)])).rows[0]!.value;}));
  project=(await save(accountA,own)).data!.project.id;foreignProject=(await save(accountB,foreign)).data!.project.id;
  const scriptResult=JSON.stringify({kind:'scripts',scripts:{variants:[{id:variantA},{id:variantB},{id:variantV7Upper}]}});
  const rollbackResult=JSON.stringify({kind:'scripts',scripts:{variants:[{id:rollbackVariant},{id:id(712)}]}});
  for(const [jobId,owner,projectId,kind,state,result] of [[job,accountA,project,'scripts','succeeded',scriptResult],[foreignJob,accountB,foreignProject,'scripts','succeeded',scriptResult],[scanJob,accountA,project,'scan','succeeded',JSON.stringify({kind:'scan'})],[runningJob,accountA,project,'scripts','running',null],[rollbackJob,accountA,project,'scripts','succeeded',rollbackResult]] as const){
    const progress=kind==='scan'?{kind:'scan',profile:null,videos:[],limitations:[]}:{kind:'scripts',limitations:[]};
    await db.query("insert into public.creator_jobs(id,account_id,project_id,kind,state,revision,stage,progress,input,captured,result,message,request_id) values($1,$2,$3,$4,'queued',1,'accepted',$5::jsonb,'{}','{}',null,null,$6)",[jobId,owner,projectId,kind,JSON.stringify(progress),crypto.randomUUID()]);
    const invoke=async(name:string,input:unknown)=>(await db.transaction(async tx=>{await tx.exec('set local role service_role');return (await tx.query<{value:Reply}>(`select public.kettle_${name}($1::uuid,$2::jsonb) value`,[owner,JSON.stringify(input)])).rows[0]!.value;}));
    await db.query("update public.creator_jobs set state='running',revision=2 where id=$1",[jobId]);
    if(state==='succeeded'){
      const advanced={...progress,limitations:['Fixture reached saving.']};
      assert.equal((await invoke('checkpoint_creator_job',{job_id:jobId,key:'fixture:saving',expected_revision:2,stage:'saving',progress:advanced})).ok,true);
      assert.equal((await invoke('finish_creator_job',{job_id:jobId,state:'succeeded',result:JSON.parse(result!),message:null})).ok,true);
    }
  }
});
after(async()=>db.close());

test('migration creates RLS-protected projection/history/receipt relations and service-only RPC',async()=>{
  const fn=await db.query<{count:number}>("select count(*)::int count from pg_proc where proname='kettle_set_riff_work_state'");
  assert.equal(fn.rows[0]?.count,1,'Task 7 migration/RPC is not implemented');
  const rls=await db.query<{relname:string;relrowsecurity:boolean}>("select relname,relrowsecurity from pg_class where relname in ('riff_work_states','riff_work_state_events','riff_work_state_receipts') order by relname");
  assert.equal(rls.rows.length,3);assert.ok(rls.rows.every(row=>row.relrowsecurity));
  const columns=await db.query<{column_name:string}>("select column_name from information_schema.columns where table_schema='public' and table_name='riff_work_states' order by column_name");
  assert.ok(columns.rows.some(row=>row.column_name==='created_at'),'projection retains its creation timestamp');
  for(const role of ['anon','authenticated'])for(const sql of ['select * from public.riff_work_states',`select public.kettle_set_riff_work_state('${accountA}','{}')`])await assert.rejects(db.transaction(async tx=>{await tx.exec(`set local role ${role}`);await tx.exec(sql);}),/permission denied/);
});

test('strict malformed JSON types, fractional/range versions, unknown keys, and initial active change nothing',async()=>{
  const invalid=[null,{},mutation('saved',0,request(1)) as any];invalid[2]={...invalid[2],account_id:accountA};
  invalid.push({...mutation('saved',0,request(2)),job_id:1},{...mutation('saved',0,request(3)),variant_id:false},{...mutation('saved',0,request(4)),state:1},{...mutation('saved',0,request(5)),expected_version:'0'},{...mutation('saved',0,request(6)),expected_version:.5},{...mutation('saved',0,request(7)),expected_version:-1},{...mutation('saved',0,request(8)),expected_version:2147483647},{...mutation('saved',0,request(9)),request_id:null},mutation('active',0,request(10)));
  for(const value of invalid)assert.equal((await rpc(value)).error?.code,'VALIDATION_ERROR',JSON.stringify(value));
  assert.equal((await db.query<{count:number}>('select count(*)::int count from public.riff_work_states')).rows[0]!.count,0);
});

test('save, undo, filmed correction, replay after later transitions, conflicts and append-only evidence are exact',async()=>{
  const saveInput=mutation('saved',0,request(20));const saved=await rpc(saveInput);assert.equal(saved.ok,true);assert.equal(saved.data.work_state.version,1);
  const undo=await rpc(mutation('active',1,request(21)));assert.equal(undo.data.work_state.version,2);
  const filmed=await rpc(mutation('filmed',2,request(22)));assert.equal(filmed.data.work_state.version,3);
  const corrected=await rpc(mutation('active',3,request(23)));assert.equal(corrected.data.work_state.version,4);
  assert.deepEqual(await rpc(saveInput),saved,'the original receipt survives later transitions exactly');
  assert.equal((await rpc({...saveInput,state:'filmed'})).error?.code,'IDEMPOTENCY_CONFLICT');
  assert.equal((await rpc(mutation('saved',3,request(24)))).error?.code,'VERSION_CONFLICT');
  assert.equal((await rpc(mutation('active',4,request(25)))).error?.code,'VALIDATION_ERROR');
  const events=await db.query<{version:number;from_state:string|null;to_state:string}>('select version,from_state,to_state from public.riff_work_state_events where job_id=$1 order by version',[job]);
  assert.deepEqual(events.rows,[{version:1,from_state:null,to_state:'saved'},{version:2,from_state:'saved',to_state:'active'},{version:3,from_state:'active',to_state:'filmed'},{version:4,from_state:'filmed',to_state:'active'}]);
  assert.equal((await db.query<{count:number}>('select count(*)::int count from public.riff_work_state_receipts where account_id=$1',[accountA])).rows[0]!.count,4);
});

test('owned succeeded script and persisted variant lineage precede receipt inspection',async()=>{
  const ownerRequest=request(30);assert.equal((await rpc(mutation('saved',0,ownerRequest,variantB))).ok,true);
  for(const attempt of [mutation('saved',0,ownerRequest,variantB,foreignJob),mutation('saved',0,ownerRequest,id(799)),mutation('saved',0,ownerRequest,variantA,scanJob),mutation('saved',0,ownerRequest,variantA,runningJob),mutation('saved',0,ownerRequest,variantA,id(798))]){
    assert.equal((await rpc(attempt)).error?.code,'NOT_FOUND',JSON.stringify(attempt));
  }
  assert.equal((await rpc({...mutation('saved',0,ownerRequest,variantB),expected_version:1})).error?.code,'IDEMPOTENCY_CONFLICT','valid owned lineage may reveal request conflict');
  assert.equal((await rpc(mutation('saved',0,request(31),variantA,foreignJob),accountB)).ok,true,'foreign owner can mutate its own job');
});

test('v7 and uppercase stored variant IDs reconcile semantically through mutation and full projection',async()=>{
  const storedVariant=await db.query<{id:string}>("select result#>>'{scripts,variants,2,id}' id from public.creator_jobs where id=$1",[job]);
  assert.equal(storedVariant.rows[0]?.id,variantV7Upper,'the projection fixture must retain the noncanonical source casing');
  const saved=await rpc(mutation('saved',0,request(32),variantV7));
  assert.equal(saved.ok,true);assert.equal(saved.data.work_state.variant_id,variantV7);
  const full=await db.transaction(async tx=>{await tx.exec('set local role service_role');return (await tx.query<{value:Reply}>('select public.kettle_get_creator_job($1::uuid,$2::jsonb) value',[accountA,JSON.stringify({job_id:job})])).rows[0]!.value;});
  assert.ok(full.data.job.work_states.some((state:any)=>state.variant_id===variantV7&&state.state==='saved'));
});

test('receipt insertion failure rolls back projection/event and exact retry succeeds',async()=>{
  const input=mutation('saved',0,request(40),rollbackVariant,rollbackJob);
  await db.exec("create function public.test_riff_receipt_failure() returns trigger language plpgsql as $$ begin raise exception 'synthetic receipt failure'; end; $$; create trigger test_riff_receipt_failure before insert on public.riff_work_state_receipts for each row execute function public.test_riff_receipt_failure();");
  try{
    assert.equal((await rpc(input)).error?.code,'UNAVAILABLE');
    assert.equal((await db.query<{count:number}>('select count(*)::int count from public.riff_work_states where job_id=$1 and variant_id=$2',[rollbackJob,rollbackVariant])).rows[0]!.count,0);
    assert.equal((await db.query<{count:number}>('select count(*)::int count from public.riff_work_state_events where job_id=$1 and variant_id=$2',[rollbackJob,rollbackVariant])).rows[0]!.count,0);
  }finally{await db.exec('drop trigger test_riff_receipt_failure on public.riff_work_state_receipts; drop function public.test_riff_receipt_failure();');}
  assert.equal((await rpc(input)).ok,true);
});

test('service role direct DML is denied while owner-level event/receipt rewrites hit append-only triggers',async()=>{
  for(const sql of ["update public.riff_work_states set state='saved'",'delete from public.riff_work_state_events','delete from public.riff_work_state_receipts'])await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role service_role');await tx.exec(sql);}),/permission denied/);
  await assert.rejects(db.exec("update public.riff_work_state_events set to_state='saved'"),/append-only/i);
  await assert.rejects(db.exec('delete from public.riff_work_state_receipts'),/append-only/i);
});

test('owner-level receipt inserts require one exact, typed, correlated successful work-state value',async()=>{
  const insert=(requestId:string,output:unknown,variantId=variantV7)=>db.query(
    'insert into public.riff_work_state_receipts(account_id,request_id,job_id,variant_id,input,output) values($1,$2,$3,$4,$5::jsonb,$6::jsonb)',
    [accountA,requestId,job,variantId,'{}',JSON.stringify(output)]);
  const valid={job_id:job,variant_id:variantV7Upper,state:'saved',version:1,updated_at:'2026-10-11T09:10:46.000Z'};
  const receipt=(workState:unknown)=>({ok:true,data:{work_state:workState}});
  const invalid=[
    {ok:'true',data:{work_state:valid}},
    {ok:true},
    receipt({}),
    receipt({...valid,secret:'accepted'}),
    receipt({...valid,job_id:1}),
    receipt({...valid,variant_id:false}),
    receipt({...valid,state:'archived'}),
    receipt({...valid,version:'1'}),
    receipt({...valid,updated_at:1}),
    receipt({...valid,updated_at:'not-a-timestamp'}),
    receipt({...valid,job_id:foreignJob}),
    receipt({...valid,variant_id:variantB}),
  ];
  for(const [index,output] of invalid.entries())
    await assert.rejects(insert(request(50+index),output),/check constraint/i,JSON.stringify(output));
  await assert.doesNotReject(insert(request(70),receipt(valid)));
});

test('full-job and recent reads are additive, ordered, owner-scoped and redacted',async()=>{
  const full=await db.transaction(async tx=>{await tx.exec('set local role service_role');return (await tx.query<{value:Reply}>('select public.kettle_get_creator_job($1::uuid,$2::jsonb) value',[accountA,JSON.stringify({job_id:job})])).rows[0]!.value;});
  assert.equal(full.ok,true);assert.deepEqual(full.data.job.work_states.map((state:any)=>state.variant_id),[variantA,variantB,variantV7]);
  assert.equal(full.data.job.work_states.some((state:any)=>'account_id' in state||'request_id' in state),false);
  const historical=await db.transaction(async tx=>{await tx.exec('set local role service_role');return (await tx.query<{value:Reply}>('select public.kettle_get_creator_job($1::uuid,$2::jsonb) value',[accountA,JSON.stringify({job_id:scanJob})])).rows[0]!.value;});
  assert.deepEqual(historical.data.job.work_states,[]);
  await db.query("insert into public.riff_creator_starts(account_id,request_id,input,source,project_id,job_id) values($1,$2,'{}','{\"platform\":\"tiktok\",\"kind\":\"video\",\"handle\":\"fixture\",\"canonical_url\":\"https://www.tiktok.com/@fixture/video/1\",\"profile_url\":\"https://www.tiktok.com/@fixture\",\"video_url\":\"https://www.tiktok.com/@fixture/video/1\"}',$3,$4)",[accountA,crypto.randomUUID(),project,job]);
  const recent=await db.transaction(async tx=>{await tx.exec('set local role service_role');return (await tx.query<{value:Reply}>('select public.kettle_list_riff_work($1::uuid,$2::jsonb) value',[accountA,'{"limit":4}'])).rows[0]!.value;});
  assert.equal(recent.ok,true);assert.equal(recent.data.work[0].variant_id,rollbackVariant);assert.equal(recent.data.work[0].work_state.variant_id,rollbackVariant);
  assert.equal(JSON.stringify(recent).includes(accountA),false);assert.equal(JSON.stringify(recent).includes(request(20)),false);
});
