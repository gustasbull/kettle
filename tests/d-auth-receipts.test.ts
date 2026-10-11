import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createMcpJwtVerifier, internalPermissions } from '../packages/auth/index.ts';
import { createOperations, failure, type ProjectRepository } from '../packages/application/operations.ts';
import { SaveProjectOutput } from '../packages/contracts/index.ts';
import { config } from './auth-fixtures.ts';
import { createInput } from './fixtures.ts';

// Existing APIs only: locally signed JWTs and actual migration SQL in PGlite.
// These cases prove neither hosted provider revocation nor forthcoming D operations.
async function harness() {
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin; grant usage on schema public to service_role; alter default privileges in schema public grant all on tables to service_role;');
  for (const file of (await readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) {
    await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
  }
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const keys = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: 'd-auth', alg: 'RS256' }] });
  const issued = Math.floor(Date.now() / 1000) - 10;
  const token = (sub: string, claims: Record<string, unknown> = {}) => new SignJWT({
    sub, iss: config.issuer, aud: config.resource, iat: issued, exp: issued + 300,
    role: 'authenticated', client_id: 'chatgpt-dcr-client', scope: 'openid offline_access',
    riff_permissions: [...internalPermissions], ...claims,
  }).setProtectedHeader({ alg: 'RS256', kid: 'd-auth' }).sign(privateKey);
  const verifier = createMcpJwtVerifier(config, (issuer, subject, iat) => db.transaction(async tx => {
    await tx.exec('set local role service_role');
    return (await tx.query<{ id: string | null }>('select public.kettle_resolve_identity($1,$2,$3) as id', [issuer, subject, iat])).rows[0]!.id;
  }), keys);
  let storageCalls = 0;
  const repository: ProjectRepository = { call: (operation, account, input) => db.transaction(async tx => {
    storageCalls++;
    await tx.exec('set local role service_role');
    return (await tx.query<{ result: unknown }>(`select public.kettle_${operation}($1::uuid,$2::jsonb) as result`, [account, JSON.stringify(input)])).rows[0]!.result;
  }) };
  const snapshot = async () => ({
    projects: (await db.query('select * from public.projects order by id')).rows,
    history: (await db.query('select * from public.brief_versions order by id')).rows,
    receipts: (await db.query('select * from public.write_receipts order by account_id, request_id')).rows,
  });
  return { db, token, issued, verifier, ops: createOperations(verifier, repository), snapshot, calls: () => storageCalls };
}

test('receipt replay rechecks expiry, scope and SQL identity cutoff/block before storage', async t => {
  const h = await harness();
  t.after(() => h.db.close());
  const a = await h.token('fictional-a');
  const b = await h.token('fictional-b');
  const owner = await h.verifier.verify(a);
  assert.ok(owner);
  const input = createInput();
  const saved = SaveProjectOutput.parse(await h.ops.execute('save_project', a, input));
  assert.ok(saved.ok);
  const before = await h.snapshot();
  const calls = h.calls();
  for (const [credential, code] of [
    [await h.token('fictional-a', { exp: h.issued + 1 }), 'UNAUTHENTICATED'],
    [await h.token('fictional-a', { riff_permissions: ['account:read', 'projects:read'] }), 'FORBIDDEN'],
  ] as const) {
    assert.deepEqual(await h.ops.execute('save_project', credential, input), failure(code));
    assert.equal(h.calls(), calls, 'even an exact successful receipt replay must reauthorize');
    assert.deepEqual(await h.snapshot(), before);
  }
  await h.db.query('update public.account_identities set tokens_valid_after=to_timestamp($1) where account_id=$2', [h.issued, owner.account_id]);
  assert.deepEqual(await h.ops.execute('save_project', a, input), failure('UNAUTHENTICATED'));
  const newer = await h.token('fictional-a', { iat: h.issued + 1 });
  await h.db.query('update public.account_identities set blocked=true where account_id=$1', [owner.account_id]);
  assert.deepEqual(await h.ops.execute('save_project', newer, input), failure('UNAUTHENTICATED'));
  assert.equal(h.calls(), calls);
  assert.deepEqual(await h.snapshot(), before);
  assert.ok((await h.ops.execute('get_account_state', b, {})).ok, 'B remains usable');
  await h.db.query('update public.account_identities set blocked=false where account_id=$1', [owner.account_id]);
  assert.deepEqual(await h.ops.execute('save_project', a, input), failure('UNAUTHENTICATED'));
  assert.deepEqual(await h.ops.execute('save_project', newer, input), saved, 'fresh authorized replay returns the original snapshot');
  assert.deepEqual(await h.snapshot(), before, 'recovery does not append history or receipts');
});

test('foreign and missing IDs hide versions and receipts; denied request IDs remain usable by their owner', async t => {
  const h = await harness();
  t.after(() => h.db.close());
  const a = await h.token('fictional-a');
  const b = await h.token('fictional-b');
  const input = createInput();
  const saved = SaveProjectOutput.parse(await h.ops.execute('save_project', a, input));
  assert.ok(saved.ok);
  const update = { ...input, request_id: crypto.randomUUID(), project_id: saved.data.project.id, expected_version: 1, name: 'A private revision' };
  const edited = SaveProjectOutput.parse(await h.ops.execute('save_project', a, update));
  assert.ok(edited.ok);
  const before = await h.snapshot();
  const deniedId = crypto.randomUUID();
  for (const project_id of [saved.data.project.id, crypto.randomUUID()]) {
    assert.deepEqual(await h.ops.execute('get_project', b, { project_id }), failure('NOT_FOUND'));
    for (const expected_version of [1, 2, 999]) {
      // Include A's successful receipt ID: it must not return A's snapshot or conflict.
      for (const request_id of [update.request_id, deniedId]) {
        assert.deepEqual(await h.ops.execute('save_project', b, { ...update, project_id, expected_version, request_id }), failure('NOT_FOUND'));
        assert.deepEqual(await h.snapshot(), before);
      }
    }
  }
  assert.deepEqual(await h.ops.execute('save_project', a, { ...update, request_id: crypto.randomUUID() }), failure('VERSION_CONFLICT'));
  assert.deepEqual(await h.ops.execute('save_project', a, { ...update, name: 'Changed receipt payload' }), failure('IDEMPOTENCY_CONFLICT'));
  assert.deepEqual(await h.snapshot(), before);
  for (const request_id of [update.request_id, deniedId]) {
    const own = SaveProjectOutput.parse(await h.ops.execute('save_project', b, { ...input, request_id }));
    assert.ok(own.ok, 'neither another account receipt nor a denial consumes B request IDs');
    assert.notEqual(own.data.project.id, saved.data.project.id);
  }
  assert.deepEqual(await h.ops.execute('save_project', a, update), edited);
});
