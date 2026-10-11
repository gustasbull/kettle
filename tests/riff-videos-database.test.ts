import { before,after,test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile,readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { accountA,accountB,createInput } from './fixtures.ts';

const db=new PGlite();
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
type Reply={ok:boolean;error?:{code:string};data?:Record<string,any>};
async function rpc(operation:string,input:unknown,account=accountA):Promise<Reply>{return db.transaction(async tx=>{
  await tx.exec('set local role service_role');
  return (await tx.query<{value:Reply}>(`select public.kettle_${operation}($1::uuid,$2::jsonb) as value`,[account,JSON.stringify(input)])).rows[0]!.value;
});}
let projectA:string,projectA2:string,projectB:string;
const progress={kind:'scan',profile:null,videos:[],limitations:[]};
async function project(account:string,name:string){const input=createInput();input.name=name;return (await rpc('save_project',input,account)).data!.project.id as string;}
async function source(kind:'scan'|'recommendations',account:string,projectId:string,key:string,stage:string){
  const jobId=crypto.randomUUID(),requestId=crypto.randomUUID();
  const jobProgress=kind==='scan'?progress:{kind:'recommendations',identities:[],references:[],limitations:[]};
  await db.query(`insert into public.creator_jobs(id,account_id,project_id,kind,state,revision,input,captured,request_id,stage,progress)
    values($1,$2,$3,$4,'queued',1,'{}','{}',$5,'accepted',$6::jsonb)`,[jobId,account,projectId,kind,requestId,JSON.stringify(jobProgress)]);
  await db.query("update public.creator_jobs set state='running',revision=2 where id=$1",[jobId]);
  const checkpoint=await rpc('checkpoint_creator_job',{job_id:jobId,key,expected_revision:2,stage,progress:jobProgress},account);
  assert.equal(checkpoint.ok,true);
  return jobId;
}
const observation=(observationId:string,nativeId:string,overrides:Record<string,unknown>={})=>({
  id:observationId,platform:'tiktok',native_id:nativeId,canonical_url:`https://www.tiktok.com/@fixture/video/${nativeId}`,
  caption:null,thumbnail_url:null,published_at:null,duration_seconds:null,
  metrics:{views:0,likes:null,comments:null,shares:null,saves:null},retrieved_at:'2026-10-11T09:10:43.000Z',
  source_observed_at:null,origin:'live',permission_basis:'Approved retained public metadata.',limitations:['Metadata only.'],...overrides,
});
const ingest=(job_id:string,checkpoint_key:string,role:'own_profile'|'discovered_reference',observations:unknown[],account=accountA)=>
  rpc('ingest_riff_videos',{job_id,checkpoint_key,role,observations},account);
const list=(input:Record<string,unknown>,account=accountA)=>rpc('list_riff_videos',{
  project_id:null,role:null,sort:'observed_at_desc',after:null,limit:20,...input},account);

before(async()=>{
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin; grant usage on schema public to service_role; alter default privileges in schema public grant all on tables to service_role;');
  for(const file of (await readdir('supabase/migrations')).filter(file=>file.endsWith('.sql')).sort())await db.exec(await readFile(`supabase/migrations/${file}`,'utf8'));
  await db.exec(await readFile('supabase/seed.sql','utf8'));
  projectA=await project(accountA,'Catalog A');projectA2=await project(accountA,'Catalog A2');projectB=await project(accountB,'Catalog B');
});
after(async()=>db.close());

test('catalog grants are read-minimal and client roles cannot inspect or execute',async()=>{
  const rls=await db.query<{relname:string;relrowsecurity:boolean}>("select relname,relrowsecurity from pg_class where relkind='r' and relname like 'riff_video_%'");
  assert.equal(rls.rows.length,4);assert.ok(rls.rows.every(row=>row.relrowsecurity));
  for(const sql of [
    `insert into public.riff_video_identities(account_id,platform,native_id) values('${accountA}','tiktok','denied')`,
    'update public.riff_video_observations set caption=null','delete from public.riff_video_observation_sources',
    'select * from public.riff_video_catalog_ingests',
  ])await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role service_role');await tx.exec(sql);}),/permission denied/);
  for(const role of ['anon','authenticated'])for(const sql of ['select * from public.riff_video_observations',
    `select public.kettle_list_riff_videos('${accountA}','{}')`,`select public.kettle_ingest_riff_videos('${accountA}','{}')`])
    await assert.rejects(db.transaction(async tx=>{await tx.exec(`set local role ${role}`);await tx.exec(sql);}),/permission denied/);
});

test('checkpoint-bound ingest is atomic, exact-replayable after terminal state, and spend neutral',async()=>{
  const key='scan:feed:0',job=await source('scan',accountA,projectA,key,'reading_posts');
  const input=[observation(id(101),'9101'),observation(id(102),'9102',{metrics:{views:null,likes:0,comments:null,shares:null,saves:null}})];
  const first=await ingest(job,key,'own_profile',input);assert.equal(first.ok,true);assert.deepEqual(first.data,{status:'stored',ingested_count:2,observation_ids:[id(101),id(102)]});
  assert.deepEqual((await db.query<{n:number}>('select count(*)::int n from public.riff_video_identities where account_id=$1',[accountA])).rows,[{n:2}]);
  const terminal=await rpc('finish_creator_job',{job_id:job,state:'failed',result:null,message:'Synthetic close.'});assert.equal(terminal.ok,true);
  const snapshot=await db.query(`select to_jsonb(j) job,
    (select count(*)::int from public.creator_attempts where job_id=j.id) attempts,
    (select count(*)::int from public.creator_attempt_receipts where job_id=j.id) receipts,
    (select count(*)::int from public.creator_job_checkpoints where job_id=j.id) checkpoints,
    (select count(*)::int from public.riff_video_observations where account_id=j.account_id) observations,
    (select count(*)::int from public.riff_video_catalog_ingests where source_job_id=j.id) ingests
    from public.creator_jobs j where j.id=$1`,[job]);
  assert.deepEqual(await ingest(job,key,'own_profile',input),first,'terminal exact replay returns the immutable stored receipt');
  assert.equal((await ingest(job,key,'own_profile',[{...input[0],metrics:{...(input[0] as any).metrics,views:1}},input[1]])).error?.code,'IDEMPOTENCY_CONFLICT');
  assert.deepEqual((await db.query(`select to_jsonb(j) job,
    (select count(*)::int from public.creator_attempts where job_id=j.id) attempts,
    (select count(*)::int from public.creator_attempt_receipts where job_id=j.id) receipts,
    (select count(*)::int from public.creator_job_checkpoints where job_id=j.id) checkpoints,
    (select count(*)::int from public.riff_video_observations where account_id=j.account_id) observations,
    (select count(*)::int from public.riff_video_catalog_ingests where source_job_id=j.id) ingests
    from public.creator_jobs j where j.id=$1`,[job])).rows,snapshot.rows);

  const badStage=await source('scan',accountA,projectA,'scan:feed:9','building_analysis');
  assert.equal((await ingest(badStage,'scan:feed:9','own_profile',[observation(id(109),'9109')])).error?.code,'VALIDATION_ERROR');
  const rec=await source('recommendations',accountA,projectA,'recommend:detail:9200','enriching_references');
  assert.equal((await ingest(rec,'recommend:detail:9200','discovered_reference',[observation(id(110),'different')])).error?.code,'VALIDATION_ERROR');
  assert.equal((await ingest(rec,'recommend:detail:9200','own_profile',[observation(id(110),'9200')])).error?.code,'VALIDATION_ERROR');
});

test('source/receipt failure rolls back identity and observation before a clean retry',async()=>{
  const key='scan:feed:1',job=await source('scan',accountA,projectA,key,'reading_posts'),native='rollback';
  await db.exec(`create function public.test_catalog_receipt_failure() returns trigger language plpgsql as $$ begin raise exception 'synthetic catalog receipt failure'; end; $$;
    create trigger test_catalog_receipt_failure before insert on public.riff_video_catalog_ingests for each row execute function public.test_catalog_receipt_failure();`);
  try{const failed=await ingest(job,key,'own_profile',[observation(id(120),native)]);assert.equal(failed.error?.code,'UNAVAILABLE');
    assert.equal((await db.query<{n:number}>('select count(*)::int n from public.riff_video_identities where native_id=$1',[native])).rows[0]!.n,0);
    assert.equal((await db.query<{n:number}>('select count(*)::int n from public.riff_video_observations where id=$1',[id(120)])).rows[0]!.n,0);
  }finally{await db.exec('drop trigger test_catalog_receipt_failure on public.riff_video_catalog_ingests;drop function public.test_catalog_receipt_failure();');}
  assert.equal((await ingest(job,key,'own_profile',[observation(id(120),native)])).ok,true);
});

test('owned filtering precedes latest-per-identity collapse and cursor pages are deterministic',async()=>{
  const oldKey='scan:feed:2',oldJob=await source('scan',accountA,projectA,oldKey,'reading_posts');
  assert.equal((await ingest(oldJob,oldKey,'own_profile',[observation(id(201),'shared')])).ok,true);
  const newerKey='scan:feed:3',newerJob=await source('scan',accountA,projectA2,newerKey,'reading_posts');
  assert.equal((await ingest(newerJob,newerKey,'own_profile',[observation(id(202),'shared')])).ok,true);
  const filtered=await list({project_id:projectA});assert.equal(filtered.ok,true);
  assert.equal(filtered.data!.cards.find((card:any)=>card.native_id==='shared').id,id(201),'project filter applies before dedupe');
  assert.equal((await list({project_id:projectB},accountA)).error?.code,'NOT_FOUND');
  assert.equal((await list({project_id:id(999)},accountA)).error?.code,'NOT_FOUND');

  const tieKey='scan:feed:4',tieJob=await source('scan',accountA,projectA,tieKey,'reading_posts');
  assert.equal((await ingest(tieJob,tieKey,'own_profile',[observation(id(301),'tie-low'),observation(id(302),'tie-high')])).ok,true);
  const all=await list({project_id:projectA,limit:20});assert.equal(all.ok,true);
  const expected=all.data!.cards.map((card:any)=>card.id);
  const walked:string[]=[];let after:null|Record<string,unknown>=null;
  do{const page=await list({project_id:projectA,limit:1,after});assert.equal(page.ok,true);walked.push(...page.data!.cards.map((card:any)=>card.id));after=page.data!.next_position;}while(after);
  assert.deepEqual(walked,expected);assert.equal(new Set(walked).size,walked.length);
  const tieIds=walked.filter(value=>value===id(301)||value===id(302));assert.deepEqual(tieIds,[id(302),id(301)]);

  const otherKey='scan:feed:0',otherJob=await source('scan',accountB,projectB,otherKey,'reading_posts');
  assert.equal((await ingest(otherJob,otherKey,'own_profile',[observation(id(401),'shared')],accountB)).ok,true);
  const identities=await db.query<{account_id:string;n:number}>("select account_id,count(*)::int n from public.riff_video_identities where native_id='shared' group by account_id order by account_id");
  assert.deepEqual(identities.rows,[{account_id:accountA,n:1},{account_id:accountB,n:1}]);
  assert.equal((await list({},accountB)).data!.cards.some((card:any)=>card.id===id(202)),false);
});
