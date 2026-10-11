import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOperations, failure } from '../packages/application/operations.ts';
import { createSupabaseRepository } from '../packages/database/supabase.ts';
import { accountA, createInput } from './fixtures.ts';

test('missing, expired and insufficient-scope credentials never reach storage', async () => {
  let calls = 0;
  const ops = createOperations({ async verify(token) {
    if (token === 'expired') return null;
    return { account_id: accountA, scopes: [] };
  } }, { async call() { calls++; throw new Error('must not reach'); } });
  assert.deepEqual(await ops.execute('save_project', null, createInput()), failure('UNAUTHENTICATED'));
  assert.deepEqual(await ops.execute('save_project', 'expired', createInput()), failure('UNAUTHENTICATED'));
  assert.deepEqual(await ops.execute('save_project', 'read-only', createInput()), failure('FORBIDDEN'));
  assert.equal(calls, 0);
});
test('ownership comes from verifier and malformed inputs stop before storage', async () => {
  let calls = 0;
  const ops = createOperations({ async verify() { return { account_id: accountA, scopes: ['projects:write'] }; } }, {
    async call(_operation, accountId) { calls++; assert.equal(accountId, accountA); return failure('NOT_FOUND'); },
  });
  assert.deepEqual(await ops.execute('save_project', 'fixture', { ...createInput(), owner_id: crypto.randomUUID() }), failure('VALIDATION_ERROR'));
  assert.equal(calls, 0);
  assert.deepEqual(await ops.execute('save_project', 'fixture', createInput()), failure('NOT_FOUND'));
  assert.equal(calls, 1);
});
test('marking onboarding is an authenticated idempotent write routed with verified ownership', async () => {
  let calls = 0;
  const seenAt = '2026-10-10T00:01:00Z';
  const ops = createOperations({ async verify() {
    return { account_id: accountA, scopes: ['account:read'] };
  } }, { async call(operation, accountId, input) {
    calls++;
    assert.equal(operation, 'mark_riff_onboarding_seen');
    assert.equal(accountId, accountA);
    assert.deepEqual(input, {});
    return { ok: true, data: { onboarding_seen_at: seenAt } };
  } });
  assert.deepEqual(await ops.execute('mark_riff_onboarding_seen', 'fixture', {}), {
    ok: true, data: { onboarding_seen_at: seenAt },
  });
  assert.deepEqual(await ops.execute('mark_riff_onboarding_seen', 'fixture', { account_id: accountA }), failure('VALIDATION_ERROR'));
  assert.equal(calls, 1);
});
test('storage errors and invalid outputs are sanitized', async () => {
  for (const call of [async () => { throw new Error('secret connection string'); }, async () => ({ account_id: accountA })]) {
    const ops = createOperations({ async verify() { return { account_id: accountA, scopes: ['projects:read'] }; } }, { call });
    assert.deepEqual(await ops.execute('get_project', 'fixture', { project_id: crypto.randomUUID() }), failure('UNAVAILABLE'));
  }
});
test('Supabase adapter sends verified owner separately to a bounded HTTPS RPC', async () => {
  const fetcher = (async (url: URL | RequestInfo, init?: RequestInit) => {
    assert.equal(String(url), 'https://example.supabase.co/rest/v1/rpc/kettle_get_project');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.redirect, 'manual');
    assert.equal(JSON.parse(String(init?.body)).p_account_id, accountA);
    assert.ok(init?.signal);
    return Response.json(failure('NOT_FOUND'));
  }) as typeof fetch;
  const repo = createSupabaseRepository('https://example.supabase.co', 'fictional-test-key', fetcher);
  assert.deepEqual(await repo.call('get_project', accountA, { project_id: crypto.randomUUID() }), failure('NOT_FOUND'));
  assert.throws(() => createSupabaseRepository('http://remote.example', 'fixture'));
});
