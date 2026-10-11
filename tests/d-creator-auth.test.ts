import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createMcpJwtVerifier, internalPermissions } from '../packages/auth/index.ts';
import { createOperations, type ProjectRepository } from '../packages/application/operations.ts';
import { createCreatorOperations, createCreatorIngestion, creatorFailure, type CreatorRepository } from '../packages/application/creator-operations.ts';
import { SaveProjectOutput } from '../packages/contracts/index.ts';
import { CreatorAnalysis } from '../packages/contracts/creator-profile.ts';
import { CorrectCreatorDnaOutput, GetCreatorDnaOutput, StoredCreatorOutput } from '../packages/contracts/creator-operations.ts';
import { creatorAnalysisFixture } from '../packages/contracts/fixtures/creator-profile.ts';
import { config } from './auth-fixtures.ts';
import { createInput } from './fixtures.ts';

// Real verifier + SQL identity mapping + real creator operations/RPCs. Only RSA keys
// and provider content are fixtures. No hosted OAuth or provider revocation proof.
const db = new PGlite();
const issued = Math.floor(Date.now() / 1000) - 20;
let token: (subject: string, claims?: Record<string, unknown>) => Promise<string>;
let verifier: ReturnType<typeof createMcpJwtVerifier>;
let creatorCalls = 0;
const repository: CreatorRepository = { call: (operation, owner, input) => {
  creatorCalls++;
  return rpc(operation, owner, input);
} };
async function rpc(operation: string, owner: string, input: unknown) {
  return db.transaction(async tx => {
    await tx.exec('set local role service_role');
    return (await tx.query<{ result: unknown }>(`select public.kettle_${operation}($1::uuid,$2::jsonb) as result`, [owner, JSON.stringify(input)])).rows[0]!.result;
  });
}
before(async () => {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin; grant usage on schema public to service_role; alter default privileges in schema public grant all on tables to service_role;');
  for (const file of (await readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) {
    await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
  }
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  token = (sub, claims = {}) => new SignJWT({ sub, iss: config.issuer, aud: config.resource,
    iat: issued, exp: issued + 3600, role: 'authenticated', client_id: 'chatgpt-dcr-client',
    scope: 'openid offline_access', riff_permissions: [...internalPermissions], ...claims,
  }).setProtectedHeader({ alg: 'RS256', kid: 'd-creator-auth' }).sign(privateKey);
  verifier = createMcpJwtVerifier(config, (issuer, subject, iat) => db.transaction(async tx => {
    await tx.exec('set local role service_role');
    return (await tx.query<{ id: string | null }>('select public.kettle_resolve_identity($1,$2,$3) as id', [issuer, subject, iat])).rows[0]!.id;
  }), createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: 'd-creator-auth', alg: 'RS256' }] }));
});
after(() => db.close());
const operations = () => createCreatorOperations(verifier, repository);
async function actor() {
  const subject = `fictional-${crypto.randomUUID()}`;
  const credential = await token(subject);
  const identity = await verifier.verify(credential);
  assert.ok(identity);
  return { subject, credential, account: identity.account_id };
}
async function seed(owner: Awaited<ReturnType<typeof actor>>) {
  const projectRepo: ProjectRepository = { call: rpc };
  const saved = SaveProjectOutput.parse(await createOperations(verifier, projectRepo).execute('save_project', owner.credential, createInput()));
  assert.ok(saved.ok);
  // Fresh IDs, same public creator for every association, coherent evidence graph.
  const analysis = creatorAnalysisFixture();
  const remap = new Map<string, string>();
  for (const o of [...analysis.scan.profile_observations, ...analysis.scan.video_observations]) {
    const id = crypto.randomUUID(); remap.set(o.id, id); o.id = id;
  }
  analysis.scan.id = crypto.randomUUID();
  analysis.dna.id = crypto.randomUUID();
  analysis.dna.source_scan_id = analysis.scan.id;
  for (const c of analysis.dna.claims) {
    c.id = crypto.randomUUID();
    for (const e of c.evidence) e.observation_id = remap.get(e.observation_id)!;
  }
  const result = StoredCreatorOutput.parse(await createCreatorIngestion(repository)(owner.account, {
    project_id: saved.data.project.id, request_id: crypto.randomUUID(), analysis: CreatorAnalysis.parse(analysis),
  }));
  assert.ok(result.ok);
  return { id: result.data.dna_id, claim: analysis.dna.claims[0]!.id };
}
const correction = (target: { id: string; claim: string }) => ({ dna_id: target.id, expected_version: 1,
  request_id: crypto.randomUUID(), corrections: [{ claim_id: target.claim, statement: 'Fictional owner correction' }] });
async function snapshot() {
  // Complete durable data, not just counts. Identity controls intentionally excluded.
  const result: Record<string, unknown> = {};
  for (const table of ['projects', 'brief_versions', 'write_receipts', 'creator_profiles', 'creator_scans', 'creator_dna_versions', 'creator_write_receipts']) {
    result[table] = (await db.query(`select * from public.${table} order by to_jsonb(${table})::text`)).rows;
  }
  return result;
}

test('signed creator reads and receipt replay recheck scope, expiry, SQL cutoff and block, then recover', async () => {
  const a = await actor(), b = await actor();
  const target = await seed(a), control = await seed(b);
  const ops = operations(), request = correction(target);
  const saved = CorrectCreatorDnaOutput.parse(await ops.execute('correct_creator_dna', a.credential, request));
  assert.ok(saved.ok);
  const before = await snapshot();
  const reads = [{ dna_id: target.id }, { dna_id: target.id, version: 1 }, { dna_id: target.id, version: 2 }];
  const noRead = await token(a.subject, { riff_permissions: ['projects:write'] });
  const noWrite = await token(a.subject, { riff_permissions: ['projects:read'] });
  let calls = creatorCalls;
  for (const input of reads) assert.deepEqual(await ops.execute('get_creator_dna', noRead, input), creatorFailure('FORBIDDEN'));
  assert.deepEqual(await ops.execute('correct_creator_dna', noWrite, request), creatorFailure('FORBIDDEN'));
  assert.equal(creatorCalls, calls);
  assert.ok((await ops.execute('get_creator_dna', noWrite, reads[0])).ok);
  assert.deepEqual(await ops.execute('correct_creator_dna', noRead, request), saved);

  const denied = async (credential: string) => {
    calls = creatorCalls;
    for (const input of reads) assert.deepEqual(await ops.execute('get_creator_dna', credential, input), creatorFailure('UNAUTHENTICATED'));
    assert.deepEqual(await ops.execute('correct_creator_dna', credential, request), creatorFailure('UNAUTHENTICATED'));
    assert.equal(creatorCalls, calls, 'denial precedes creator repository access, including receipt lookup');
    assert.deepEqual(await snapshot(), before);
    assert.ok((await ops.execute('get_creator_dna', b.credential, { dna_id: control.id })).ok);
  };
  await denied(await token(a.subject, { exp: issued + 1 }));
  await denied(await token(a.subject, { aud: 'https://wrong.example/mcp' }));
  await db.query('update public.account_identities set tokens_valid_after=to_timestamp($1) where account_id=$2', [issued, a.account]);
  await denied(a.credential); // iat exactly equals cutoff
  const fresh = await token(a.subject, { iat: issued + 1, client_id: 'separate-chatgpt-client' });
  assert.deepEqual(await operations().execute('correct_creator_dna', fresh, request), saved);
  await db.query('update public.account_identities set blocked=true where account_id=$1', [a.account]);
  await denied(fresh);
  await denied(await token(a.subject, { iat: issued + 2 }));
  await db.query('update public.account_identities set blocked=false where account_id=$1', [a.account]);
  await denied(a.credential);
  assert.equal((await verifier.verify(fresh))!.account_id, a.account);
  assert.deepEqual(await operations().execute('correct_creator_dna', fresh, request), saved);
  assert.deepEqual(await snapshot(), before);
});

test('signed accounts sharing a public creator isolate historical reads and successful correction receipts', async () => {
  const a = await actor(), b = await actor();
  const a1 = await seed(a), b1 = await seed(b);
  const ops = operations(), request = correction(a1);
  const saved = CorrectCreatorDnaOutput.parse(await ops.execute('correct_creator_dna', a.credential, request));
  assert.ok(saved.ok);
  const before = await snapshot();
  for (const [owner, foreign] of [[a, b1], [b, a1]] as const) {
    for (const dna_id of [foreign.id, crypto.randomUUID()]) {
      for (const version of [undefined, 1, 2, 999]) {
        assert.deepEqual(await ops.execute('get_creator_dna', owner.credential, { dna_id, ...(version ? { version } : {}) }), creatorFailure('NOT_FOUND'));
      }
    }
  }
  for (const expected_version of [1, 2, 999]) {
    assert.deepEqual(await ops.execute('correct_creator_dna', b.credential, { ...request, expected_version }), creatorFailure('NOT_FOUND'));
    assert.deepEqual(await snapshot(), before);
  }
  const own = CorrectCreatorDnaOutput.parse(await ops.execute('correct_creator_dna', b.credential, { ...correction(b1), request_id: request.request_id }));
  assert.ok(own.ok, 'A receipt and B denials do not consume B request ID');
  assert.notEqual(own.data.dna.dna_id, saved.data.dna.dna_id);
  assert.deepEqual(own.data.dna.profile, saved.data.dna.profile);
  assert.deepEqual(await ops.execute('correct_creator_dna', a.credential, request), saved);
  for (const [owner, target] of [[a, a1], [b, b1]] as const) {
    const current = GetCreatorDnaOutput.parse(await operations().execute('get_creator_dna', owner.credential, { dna_id: target.id }));
    const historical = GetCreatorDnaOutput.parse(await operations().execute('get_creator_dna', owner.credential, { dna_id: target.id, version: 1 }));
    assert.ok(current.ok && historical.ok);
    assert.equal(current.data.dna.version, 2);
    assert.equal(historical.data.dna.claims[0]!.id, target.claim);
    assert.notEqual(current.data.dna.snapshot_id, historical.data.dna.snapshot_id);
  }
});

test('mixed-account and mixed-analysis claim batches are atomic; stale and invalid corrections leave reusable IDs', async () => {
  const a = await actor(), b = await actor();
  const a1 = await seed(a), a2 = await seed(a), b1 = await seed(b);
  const ops = operations(), request = correction(a1), before = await snapshot();
  for (const claim_id of [a2.claim, b1.claim, crypto.randomUUID()]) {
    // Include a valid prefix: no partial correction may persist before the bad claim.
    assert.deepEqual(await ops.execute('correct_creator_dna', a.credential, { ...request,
      corrections: [...request.corrections, { claim_id, statement: 'Must not cross analysis boundary' }],
    }), creatorFailure('VALIDATION_ERROR'));
    assert.deepEqual(await snapshot(), before);
  }
  const saved = CorrectCreatorDnaOutput.parse(await ops.execute('correct_creator_dna', a.credential, request));
  assert.ok(saved.ok, 'invalid batches did not consume the request ID');
  const after = await snapshot(), stale = { ...request, request_id: crypto.randomUUID() };
  assert.deepEqual(await ops.execute('correct_creator_dna', a.credential, stale), creatorFailure('VERSION_CONFLICT'));
  assert.deepEqual(await ops.execute('correct_creator_dna', a.credential, { ...stale, expected_version: 2 }), creatorFailure('VALIDATION_ERROR'), 'superseded claim is not a current correction target');
  assert.deepEqual(await snapshot(), after);
  const next = CorrectCreatorDnaOutput.parse(await ops.execute('correct_creator_dna', a.credential, {
    ...stale, expected_version: 2, corrections: [{ claim_id: saved.data.dna.claims[0]!.id, statement: 'Reconciled owner correction' }],
  }));
  assert.ok(next.ok);
  assert.equal(next.data.dna.version, 3);
  const final = await snapshot();
  assert.deepEqual(await operations().execute('correct_creator_dna', a.credential, request), saved);
  assert.deepEqual(await ops.execute('correct_creator_dna', a.credential, { ...request, corrections: [{ ...request.corrections[0]!, statement: 'Changed replay' }] }), creatorFailure('IDEMPOTENCY_CONFLICT'));
  assert.deepEqual(await snapshot(), final);
});
