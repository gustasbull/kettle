import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createCreatorIngestion, createCreatorOperations, projectCreatorDna, type CreatorRepositoryOperation } from '../packages/application/creator-operations.ts';
import { GetCreatorDnaOutput, CorrectCreatorDnaOutput, StoredCreatorOutput } from '../packages/contracts/creator-operations.ts';
import { creatorAnalysisFixture } from '../packages/contracts/fixtures/creator-profile.ts';
import { accountA, accountB, createInput } from './fixtures.ts';
const db = new PGlite();
let projectId: string;
let calls = 0;
before(async () => {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin; grant usage on schema public to service_role; alter default privileges in schema public grant all on tables to service_role;');
  for (const f of (await readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await readFile(`supabase/migrations/${f}`, 'utf8'));
  await db.exec(await readFile('supabase/seed.sql', 'utf8'));
  const r = await db.query<{result: {data: {project: {id: string}}}}>('select public.kettle_save_project($1,$2) as result',[accountA,JSON.stringify(createInput())]);
  projectId = r.rows[0]!.result.data.project.id;
});
after(async () => { await db.close(); });
const repository = { async call(op: CreatorRepositoryOperation, account: string, input: unknown) {
  calls++;
  return db.transaction(async tx => {
    await tx.exec('set local role service_role');
    return (await tx.query<{result: unknown}>(`select public.kettle_${op}($1::uuid,$2::jsonb) as result`, [account, JSON.stringify(input)])).rows[0]!.result;
  });
} };
const verifier = { async verify(token: string) {
  if (token === 'expired') return null;
  return { account_id: token === 'b' ? accountB : accountA, scopes: token === 'limited' ? ['account:read'] : ['projects:read','projects:write'] };
} };
const ops = createCreatorOperations(verifier, repository);
const ingest = createCreatorIngestion(repository);
async function seedAnalysis() {
  const analysis = creatorAnalysisFixture(); analysis.dna.id = crypto.randomUUID(); analysis.dna.claims[0]!.id = crypto.randomUUID();
  const url=analysis.scan.request.supplied_url+'/video/12345';
  analysis.seed_review={url,provider:'lightreel',conversation_id:'fixture-review',summary:'Fictional provider review for persistence checks.',
    access_basis:'unknown',limitations:['Fictional fixture; no actual access.'],
    provenance:{...structuredClone(analysis.scan.profile_observations[0]!.provenance),provider:'lightreel',endpoint:'/v1/chat',source_url:url,modalities:['metadata']}};
  const input = { project_id: projectId, request_id: crypto.randomUUID(), analysis };
  const stored = StoredCreatorOutput.parse(await ingest(accountA,input));
  assert.ok(stored.ok); return { input, stored: stored.data, id: stored.data.dna_id };
}
async function counts() {
  return (await db.query('select (select count(*) from public.creator_profiles) as profiles, (select count(*) from public.creator_dna_versions) as versions, (select count(*) from public.creator_write_receipts) as receipts')).rows;
}
test('trusted ingestion, immutable reads, correction, historical reopen and exact replay', async () => {
  const {input,id} = await seedAnalysis();
  const before = await counts();
  assert.ok((await ingest(accountA,input)).ok); assert.deepEqual(await counts(),before);
  const initial = GetCreatorDnaOutput.parse(await ops.execute('get_creator_dna','a',{dna_id:id})); assert.ok(initial.ok);
  assert.equal(initial.data.dna.seed_review?.summary,'Fictional provider review for persistence checks.');
  const request = { dna_id:id, expected_version:1, request_id:crypto.randomUUID(),
    corrections:[{claim_id:initial.data.dna.claims[0]!.id,statement:'Lighting tutorials are my focus.'}] };
  const saved = CorrectCreatorDnaOutput.parse(await ops.execute('correct_creator_dna','a',request)); assert.ok(saved.ok);
  assert.equal(saved.data.dna.version,2); assert.equal(saved.data.dna.claims[0]!.basis,'user_corrected');
  assert.deepEqual(saved.data.dna.seed_review,initial.data.dna.seed_review);
  assert.equal(saved.data.dna.claims[0]!.supersedes_claim_id,initial.data.dna.claims[0]!.id);
  assert.deepEqual(saved.data.dna.claims[0]!.evidence,initial.data.dna.claims[0]!.evidence);
  assert.notEqual(saved.data.dna.snapshot_id,initial.data.dna.snapshot_id);
  assert.deepEqual(await ops.execute('get_creator_dna','a',{dna_id:id,version:1}),initial);
  const second = {...request,expected_version:2,request_id:crypto.randomUUID(),corrections:[{claim_id:saved.data.dna.claims[0]!.id,statement:'Updated user correction.'}]};
  assert.ok((await ops.execute('correct_creator_dna','a',second)).ok);
  const after = await counts();
  assert.deepEqual(await ops.execute('correct_creator_dna','a',request),saved);
  assert.deepEqual(await counts(),after);
  const reopened = createCreatorOperations(verifier,repository);
  const latest = GetCreatorDnaOutput.parse(await reopened.execute('get_creator_dna','a',{dna_id:id})); assert.ok(latest.ok); assert.equal(latest.data.dna.version,3);
});
test('foreign/missing IDs, stale writes, changed receipts and foreign projects cannot mutate history', async () => {
  const {id,input} = await seedAnalysis();
  const request = {dna_id:id,expected_version:1,request_id:crypto.randomUUID(),corrections:[{claim_id:input.analysis.dna.claims[0]!.id,statement:'Own correction'}]};
  const before=await counts();
  for (const dna_id of [id,crypto.randomUUID()]) {
    const read=await ops.execute('get_creator_dna','b',{dna_id}); assert.ok(!read.ok); assert.equal(read.error.code,'NOT_FOUND');
    const write=await ops.execute('correct_creator_dna','b',{...request,dna_id}); assert.ok(!write.ok); assert.equal(write.error.code,'NOT_FOUND');
  }
  const foreign=await ingest(accountB,{...input,request_id:crypto.randomUUID()}); assert.ok(!foreign.ok); assert.equal(foreign.error.code,'NOT_FOUND');
  const bad=await ops.execute('correct_creator_dna','a',{...request,corrections:[{claim_id:crypto.randomUUID(),statement:'Unknown claim'}]}); assert.ok(!bad.ok); assert.equal(bad.error.code,'VALIDATION_ERROR');
  assert.deepEqual(await counts(),before);
  assert.ok((await ops.execute('correct_creator_dna','a',request)).ok);
  const after=await counts();
  const stale=await ops.execute('correct_creator_dna','a',{...request,request_id:crypto.randomUUID()}); assert.ok(!stale.ok); assert.equal(stale.error.code,'VERSION_CONFLICT');
  const changed=await ops.execute('correct_creator_dna','a',{...request,corrections:[{...request.corrections[0]!,statement:'Changed replay'}]}); assert.ok(!changed.ok); assert.equal(changed.error.code,'IDEMPOTENCY_CONFLICT');
  assert.deepEqual(await counts(),after);
});
test('each replay rechecks identity/scope and suspended account status; unknown input fields rejected', async () => {
  const {id,input}=await seedAnalysis();
  const request={dna_id:id,expected_version:1,request_id:crypto.randomUUID(),corrections:[{claim_id:input.analysis.dna.claims[0]!.id,statement:'Safe correction'}]};
  assert.ok((await ops.execute('correct_creator_dna','a',request)).ok);
  const before=await counts(), beforeCalls=calls;
  for (const token of [null,'expired','limited']) {
    const r=await ops.execute('correct_creator_dna',token,request); assert.ok(!r.ok); assert.equal(r.error.code,token==='limited'?'FORBIDDEN':'UNAUTHENTICATED');
  }
  const injection=await ops.execute('get_creator_dna','a',{dna_id:id,account_id:accountB}); assert.ok(!injection.ok); assert.equal(injection.error.code,'VALIDATION_ERROR');
  assert.equal(calls,beforeCalls);
  await db.query("update public.accounts set state='suspended' where id=$1",[accountA]);
  try {
    const r=await ops.execute('correct_creator_dna','a',request); assert.ok(!r.ok); assert.equal(r.error.code,'FORBIDDEN');
  } finally { await db.query("update public.accounts set state='active' where id=$1",[accountA]); }
  assert.deepEqual(await counts(),before);
});
test('display projection withholds restricted derived claims and strips raw provider/internal fields', async () => {
  const {stored}=await seedAnalysis();
  const raw=stored.analysis.scan; raw.cost.attempts.push({id:crypto.randomUUID(),provider:'SECRET_PROVIDER_NOTE',outcome:'ambiguous',credits:null,usd:null,usd_basis:'unknown',conversion_basis:null});
  raw.coverage.pages[0]!.requested_cursor='SECRET_CURSOR'; raw.video_observations[0]!.caption='PRIVATE_CAPTION';
  raw.video_observations[0]!.provenance.permission.basis='PRIVATE_PERMISSION_NOTE';
  const view=projectCreatorDna(stored); const serialized=JSON.stringify(view);
  for(const secret of ['SECRET_PROVIDER_NOTE','SECRET_CURSOR','PRIVATE_CAPTION','PRIVATE_PERMISSION_NOTE']) assert.ok(!serialized.includes(secret));
  raw.video_observations[0]!.provenance.permission.permitted_uses=['store','model_processing'];
  const restricted=projectCreatorDna(stored); assert.equal(restricted.claims.length,0); assert.equal(restricted.evidence.length,0); assert.equal(restricted.withheld_claim_count,1);
});
test('ingestion rejects absent storage permission before SQL; service-role history is append only and clients have no access', async () => {
  const analysis=creatorAnalysisFixture(); analysis.dna.id=crypto.randomUUID();
  analysis.scan.video_observations[0]!.provenance.permission.permitted_uses=['model_processing'];
  const before=calls;
  const r=await ingest(accountA,{project_id:projectId,request_id:crypto.randomUUID(),analysis}); assert.ok(!r.ok); assert.equal(r.error.code,'FORBIDDEN'); assert.equal(calls,before);
  for(const role of ['anon','authenticated']) await assert.rejects(db.transaction(async tx=>{await tx.exec(`set local role ${role}`);await tx.query('select public.kettle_get_creator_dna($1,$2)',[accountA,JSON.stringify({dna_id:crypto.randomUUID()})]);}),/permission denied/);
  for(const table of ['creator_scans','creator_dna_versions','creator_write_receipts']) await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role service_role');await tx.exec(`delete from public.${table}`);}),/permission denied/);
});
test('receipt insert failure rolls back correction, version pointer and history together', async () => {
  const {id,input}=await seedAnalysis(); const before=await counts();
  await db.exec("create function public.fail_creator_receipt() returns trigger language plpgsql as $$ begin raise exception 'fixture receipt failure'; end $$; create trigger fail_creator_receipt before insert on public.creator_write_receipts for each row execute function public.fail_creator_receipt();");
  try {
    const r=await ops.execute('correct_creator_dna','a',{dna_id:id,expected_version:1,request_id:crypto.randomUUID(),corrections:[{claim_id:input.analysis.dna.claims[0]!.id,statement:'Must rollback'}]});
    assert.ok(!r.ok); assert.equal(r.error.code,'UNAVAILABLE'); assert.deepEqual(await counts(),before);
    const read=GetCreatorDnaOutput.parse(await ops.execute('get_creator_dna','a',{dna_id:id})); assert.ok(read.ok); assert.equal(read.data.dna.version,1);
  } finally { await db.exec('drop trigger fail_creator_receipt on public.creator_write_receipts; drop function public.fail_creator_receipt();'); }
});

test('database foreign keys reject mixed-account parent links and ingestion receipt namespace conflicts', async () => {
  const {input,id}=await seedAnalysis();
  await assert.rejects(db.query('insert into public.creator_profiles(id,account_id,project_id,platform,native_id,current_version) values($1,$2,$3,$4,$5,1)',[crypto.randomUUID(),accountB,projectId,'tiktok','foreign']),/foreign key/);
  const other=await seedAnalysis();
  const mixed=await ops.execute('correct_creator_dna','a',{dna_id:id,expected_version:1,request_id:crypto.randomUUID(),
    corrections:[{claim_id:other.input.analysis.dna.claims[0]!.id,statement:'Wrong analysis claim'}]});
  assert.ok(!mixed.ok); assert.equal(mixed.error.code,'VALIDATION_ERROR');
  const oversized=await ops.execute('correct_creator_dna','a',{dna_id:id,expected_version:2147483647,request_id:crypto.randomUUID(),
    corrections:[{claim_id:input.analysis.dna.claims[0]!.id,statement:'Oversized version'}]});
  assert.ok(!oversized.ok); assert.equal(oversized.error.code,'VALIDATION_ERROR');
  const before=await counts();
  const collision=await ops.execute('correct_creator_dna','a',{dna_id:id,expected_version:1,request_id:input.request_id,
    corrections:[{claim_id:input.analysis.dna.claims[0]!.id,statement:'Conflicting operation'}]});
  assert.ok(!collision.ok); assert.equal(collision.error.code,'IDEMPOTENCY_CONFLICT'); assert.deepEqual(await counts(),before);
});
