import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  configureCreatorTrial,
  parseCreatorTrialArgs,
  type CreatorTrialFetch,
} from '../scripts/configure-creator-trial.ts';
import { accountA } from './fixtures.ts';

const requestId = '99999999-9999-4999-8999-999999999999';

test('trial CLI requires an exact account email, explicit run count and explicit refill mode', () => {
  assert.deepEqual(parseCreatorTrialArgs([
    '--execute', '--email', 'Benas@bam.fun', '--runs', '1', '--request-id', requestId,
  ]), {
    email: 'Benas@bam.fun', mode: 'initial', requestId, runs: 1,
  });
  assert.deepEqual(parseCreatorTrialArgs([
    '--execute', '--email', 'Benas@bam.fun', '--runs', '3', '--request-id', requestId, '--refill',
  ]), {
    email: 'Benas@bam.fun', mode: 'refill', requestId, runs: 3,
  });
  for (const args of [
    ['--email', 'Benas@bam.fun', '--runs', '1', '--request-id', requestId],
    ['--execute', '--runs', '1', '--request-id', requestId],
    ['--execute', '--email', 'Benas@bam.fun', '--request-id', requestId],
    ['--execute', '--email', 'Benas@bam.fun', '--runs', '2', '--request-id', requestId],
    ['--execute', '--email', 'Benas@bam.fun', '--runs', '11', '--request-id', requestId, '--refill'],
    ['--execute', '--email', 'Benas@bam.fun', '--runs', '1', '--request-id', requestId, '--unknown'],
  ]) assert.throws(() => parseCreatorTrialArgs(args));
});

test('default provisioning finds one exact auth email, preserves existing shared balances and provisions initial capacity', async () => {
  const calls: Array<{ url: string; method: string; body: unknown; prefer: string | null }> = [];
  const fetcher: CreatorTrialFetch = async (url, init) => {
    const parsed = new URL(String(url));
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const headers = new Headers(init?.headers);
    calls.push({ url: `${parsed.pathname}${parsed.search}`, method, body, prefer: headers.get('prefer') });
    assert.equal(headers.get('apikey'), 'fixture-service-role');
    assert.equal(headers.get('authorization'), 'Bearer fixture-service-role');
    if (parsed.pathname === '/rest/v1/creator_pipeline_budget') {
      return Response.json([{ limit_microusd: 0, reserved_microusd: 0 }]);
    }
    if (parsed.pathname === '/auth/v1/admin/users') {
      return Response.json({ users: [
        { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'someone@example.com' },
        { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', email: 'benas@BAM.fun' },
      ] });
    }
    if (parsed.pathname === '/rest/v1/account_identities') return Response.json([{ account_id: accountA }]);
    if (parsed.pathname === '/rest/v1/creator_provider_trials' && method === 'POST') return new Response(null, { status: 201 });
    if (parsed.pathname === '/rest/v1/rpc/kettle_provision_riff_creator_run_grants') return Response.json({
      ok: true, data: { status: 'created', grants: [{
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', mode: 'initial', state: 'available',
        scrapecreators_remaining: 6, lightreel_remaining: 2, expires_at: '2026-10-18T00:00:00Z',
      }] },
    });
    if (parsed.pathname === '/rest/v1/creator_provider_trials') return Response.json([
      { provider: 'lightreel', remaining_units: 8, enabled: true, expires_at: '2026-10-18T00:00:00Z' },
      { provider: 'scrapecreators', remaining_units: 14, enabled: true, expires_at: '2026-10-18T00:00:00Z' },
    ]);
    throw new Error(`Unexpected request ${parsed.pathname}`);
  };

  const output = await configureCreatorTrial({
    email: 'Benas@bam.fun', mode: 'initial', requestId, runs: 1,
  }, {
    project: 'fixture-project', serviceRoleKey: 'fixture-service-role', fetcher,
    now: () => new Date('2026-10-11T00:00:00Z'),
  });
  assert.deepEqual(output, {
    account_id: accountA,
    email: 'Benas@bam.fun',
    mode: 'initial',
    request_id: requestId,
    requested_runs: 1,
    status: 'created',
    grant_ids: ['cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
    shared_trials: [
      { provider: 'lightreel', remaining_units: 8, enabled: true, expires_at: '2026-10-18T00:00:00Z' },
      { provider: 'scrapecreators', remaining_units: 14, enabled: true, expires_at: '2026-10-18T00:00:00Z' },
    ],
    cash_budget_usd: 0,
  });
  const seed = calls.find(call => call.url.startsWith('/rest/v1/creator_provider_trials?on_conflict='))!;
  assert.equal(seed.method, 'POST');
  assert.equal(seed.prefer, 'resolution=ignore-duplicates,return=minimal');
  assert.deepEqual(seed.body, [
    { provider: 'scrapecreators', remaining_units: 20, enabled: true, expires_at: '2026-10-18T00:00:00.000Z' },
    { provider: 'lightreel', remaining_units: 10, enabled: true, expires_at: '2026-10-18T00:00:00.000Z' },
  ]);
  const provision = calls.find(call => call.url === '/rest/v1/rpc/kettle_provision_riff_creator_run_grants')!;
  assert.deepEqual(provision.body, { p_account_id: accountA, p_input: {
    request_id: requestId, mode: 'initial', run_count: 1,
  } });
  assert.ok(!JSON.stringify(output).includes('someone@example.com'));
});

test('email resolution fails closed on missing or ambiguous exact matches without provisioning', async () => {
  for (const users of [
    [{ id: crypto.randomUUID(), email: 'other@example.com' }],
    [{ id: crypto.randomUUID(), email: 'BENAS@BAM.FUN' }, { id: crypto.randomUUID(), email: 'benas@bam.fun' }],
  ]) {
    let mutations = 0;
    const fetcher: CreatorTrialFetch = async (url, init) => {
      const parsed = new URL(String(url));
      if ((init?.method ?? 'GET') !== 'GET') mutations++;
      if (parsed.pathname === '/rest/v1/creator_pipeline_budget') {
        return Response.json([{ limit_microusd: 0, reserved_microusd: 0 }]);
      }
      if (parsed.pathname === '/auth/v1/admin/users') return Response.json({ users });
      throw new Error('must not continue');
    };
    await assert.rejects(configureCreatorTrial({
      email: 'Benas@bam.fun', mode: 'initial', requestId, runs: 1,
    }, { project: 'fixture-project', serviceRoleKey: 'fixture-service-role', fetcher }), /account email/i);
    assert.equal(mutations, 0);
  }
});
