import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { accountA, accountB } from './fixtures.ts';

const db = new PGlite();
type Reply = { ok: boolean; error?: { code: string }; data?: Record<string, any> };
const requestId = '55555555-5555-4555-8555-555555555555';
const publicInput = { request_id: requestId, source_url: 'https://vt.tiktok.com/ZSFictional/' };
const source = {
  platform: 'tiktok', kind: 'video', handle: 'creator.one',
  canonical_url: 'https://www.tiktok.com/@creator.one/video/1234567890',
  profile_url: 'https://www.tiktok.com/@creator.one',
  video_url: 'https://www.tiktok.com/@creator.one/video/1234567890',
};
const startInput = (input: { request_id: string; source_url: string } = publicInput, canonical: {
  platform: string; kind: string; handle: string; canonical_url: string; profile_url: string; video_url: string | null;
} = source) => ({
  input, source: canonical, max_profiles_per_account: 1, allowance_ttl_seconds: 604800,
});
const initialProvisionId = '99999999-9999-4999-8999-999999999991';
const refillProvisionId = '99999999-9999-4999-8999-999999999992';
async function rpc(operation: string, input: unknown, account = accountA): Promise<Reply> {
  return db.transaction(async tx => {
    await tx.exec('set local role service_role');
    return (await tx.query<{ value: Reply }>(
      `select public.kettle_${operation}($1::uuid,$2::jsonb) as value`, [account, JSON.stringify(input)],
    )).rows[0]!.value;
  });
}
before(async () => {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin; grant usage on schema public to service_role; alter default privileges in schema public grant all on tables to service_role;');
  for (const file of (await readdir('supabase/migrations')).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
  }
  await db.exec(await readFile('supabase/seed.sql', 'utf8'));
});
after(async () => { await db.close(); });

test('service-only initial grant reserves a complete run and is required before creator start', async () => {
  assert.equal((await rpc('start_riff_creator', startInput())).error?.code, 'FORBIDDEN');
  assert.equal((await db.query<{ count: number }>('select count(*)::int as count from public.riff_creator_starts')).rows[0]!.count, 0);
  await db.exec("insert into public.creator_provider_trials(provider,remaining_units,enabled,expires_at) values('scrapecreators',30,true,now()+interval '7 days'),('lightreel',10,true,now()+interval '7 days')");

  assert.equal((await rpc('start_riff_creator', startInput())).error?.code, 'FORBIDDEN',
    'shared provider capacity is not account authorization');
  const provisionInput = { request_id: initialProvisionId, mode: 'initial', run_count: 1 };
  const provisioned = await rpc('provision_riff_creator_run_grants', provisionInput);
  assert.equal(provisioned.ok, true);
  assert.equal(provisioned.data?.status, 'created');
  assert.equal(provisioned.data?.grants.length, 1);
  assert.deepEqual((await db.query<{ provider: string; remaining_units: number }>(
    'select provider,remaining_units::int from public.creator_provider_trials order by provider',
  )).rows, [
    { provider: 'lightreel', remaining_units: 8 },
    { provider: 'scrapecreators', remaining_units: 24 },
  ]);
  assert.deepEqual(await rpc('provision_riff_creator_run_grants', provisionInput), provisioned,
    'an exact provisioning replay cannot reserve capacity twice');
  const duplicateInitial = await rpc('provision_riff_creator_run_grants', {
    request_id: '99999999-9999-4999-8999-999999999993', mode: 'initial', run_count: 1,
  });
  assert.equal(duplicateInitial.ok, true);
  assert.equal(duplicateInitial.data?.status, 'existing');
  assert.deepEqual((await db.query<{ provider: string; remaining_units: number }>(
    'select provider,remaining_units::int from public.creator_provider_trials order by provider',
  )).rows, [
    { provider: 'lightreel', remaining_units: 8 },
    { provider: 'scrapecreators', remaining_units: 24 },
  ], 'default initial provisioning is insert-only and never refills an account');
  assert.equal((await rpc('provision_riff_creator_run_grants', {
    request_id: '99999999-9999-4999-8999-999999999994', mode: 'refill', run_count: 5,
  }, accountB)).error?.code, 'FORBIDDEN');
  assert.deepEqual((await db.query<{ provider: string; remaining_units: number }>(
    'select provider,remaining_units::int from public.creator_provider_trials order by provider',
  )).rows, [
    { provider: 'lightreel', remaining_units: 8 },
    { provider: 'scrapecreators', remaining_units: 24 },
  ], 'a capacity rejection atomically preserves both shared provider balances');

  const started = await rpc('start_riff_creator', startInput());
  assert.equal(started.ok, true);
  assert.equal(started.data?.project.name, '@creator.one creator work');
  assert.equal(started.data?.job.kind, 'scan');
  assert.equal(started.data?.job.state, 'queued');
  assert.equal(started.data?.job.account_id, accountA);
  assert.deepEqual(started.data?.source, source);
  assert.deepEqual(started.data?.job.input.scan, {
    platform: 'tiktok', supplied_url: source.profile_url, max_videos: 10, max_pages: 2,
  });
  assert.equal(started.data?.job.input.seed_url, source.video_url);
  const allowance = (await db.query<{ enabled: boolean; profile_url: string; riff_managed: boolean }>(
    'select enabled,profile_url,riff_managed from public.creator_pipeline_allowances where account_id=$1', [accountA],
  )).rows;
  assert.deepEqual(allowance, [{ enabled: true, profile_url: source.profile_url, riff_managed: true }]);
  assert.equal((await db.query<{ same_expiry: boolean }>(`select a.expires_at = g.expires_at as same_expiry
    from public.creator_pipeline_allowances a
    join public.riff_creator_project_grants pg on pg.account_id=a.account_id and pg.profile_url=a.profile_url
    join public.riff_creator_run_grants g on g.id=pg.grant_id
    where a.account_id=$1 and pg.project_id=$2`, [accountA, started.data?.project.id])).rows[0]!.same_expiry, true,
  'the allowance remains usable for the full bounded grant lifetime');
  const consumed = (await db.query<{ state: string; consumed_request_id: string; scrapecreators_remaining: number; lightreel_remaining: number }>(
    `select state,consumed_request_id,scrapecreators_remaining,lightreel_remaining
       from public.riff_creator_run_grants where account_id=$1`, [accountA],
  )).rows[0]!;
  assert.deepEqual(consumed, {
    state: 'consumed', consumed_request_id: requestId,
    scrapecreators_remaining: 6, lightreel_remaining: 2,
  });

  assert.deepEqual(await rpc('get_riff_creator_start', publicInput), started);
  assert.deepEqual(await rpc('start_riff_creator', startInput()), started);
  assert.equal((await db.query<{ count: number }>('select count(*)::int as count from public.riff_creator_starts')).rows[0]!.count, 1);
  assert.equal((await db.query<{ count: number }>('select count(*)::int as count from public.creator_jobs where request_id=$1', [requestId])).rows[0]!.count, 1);
  assert.equal((await db.query<{ count: number }>(
    'select count(*)::int as count from public.riff_creator_run_grants where account_id=$1 and state=$2',
    [accountA, 'consumed'],
  )).rows[0]!.count, 1, 'a creator-start replay cannot consume another grant');
  assert.equal((await rpc('start_riff_creator', startInput({
    request_id: '77777777-7777-4777-8777-777777777770', source_url: source.profile_url,
  }, { ...source, kind: 'profile', canonical_url: source.profile_url, video_url: null }), accountB)).error?.code,
  'FORBIDDEN', 'another account cannot borrow the shared pool or another account grant');
});

test('explicit refill adds one bounded run while rejected starts leave it unconsumed', async () => {
  assert.equal((await rpc('get_riff_creator_start', { ...publicInput, source_url: source.profile_url })).error?.code,
    'IDEMPOTENCY_CONFLICT');
  assert.equal((await rpc('get_riff_creator_start', publicInput, accountB)).error?.code, 'NOT_FOUND');

  const refill = await rpc('provision_riff_creator_run_grants', {
    request_id: refillProvisionId, mode: 'refill', run_count: 1,
  });
  assert.equal(refill.ok, true);
  assert.equal(refill.data?.status, 'created');

  const secondInput = { request_id: '77777777-7777-4777-8777-777777777777', source_url: source.profile_url };
  const sameProfile = { ...source, kind: 'profile', canonical_url: source.profile_url, video_url: null };
  assert.equal((await rpc('start_riff_creator', startInput(secondInput, sameProfile))).ok, true,
    'an explicitly refilled run may reuse the already admitted profile');
  assert.equal((await db.query<{ bounded: boolean }>(`select a.expires_at <= least(s.expires_at, l.expires_at) as bounded
    from public.creator_pipeline_allowances a
    cross join public.creator_provider_trials s cross join public.creator_provider_trials l
    where a.account_id = $1 and a.profile_url = $2 and s.provider = 'scrapecreators' and l.provider = 'lightreel'`,
  [accountA, source.profile_url])).rows[0]!.bounded, true, 'renewal stays inside currently configured trial expiry');
  const otherInput = { request_id: '88888888-8888-4888-8888-888888888888', source_url: 'https://www.tiktok.com/@another' };
  const other = { ...sameProfile, handle: 'another', canonical_url: otherInput.source_url, profile_url: otherInput.source_url };
  assert.equal((await rpc('start_riff_creator', startInput(otherInput, other))).error?.code, 'FORBIDDEN');
  assert.equal((await db.query<{ count: number }>(
    'select count(*)::int as count from public.riff_creator_run_grants where account_id=$1 and state=$2',
    [accountA, 'available'],
  )).rows[0]!.count, 0, 'the only refill was consumed by the valid same-profile start');

  await db.exec("update public.creator_provider_trials set enabled=false where provider='scrapecreators'");
  assert.deepEqual(await rpc('start_riff_creator', startInput()), await rpc('get_riff_creator_start', publicInput),
    'exact replay survives later trial withdrawal');
  await db.exec("update public.creator_provider_trials set enabled=true where provider='scrapecreators'");
});

test('Riff-managed allowances cannot authorize unrelated low-level jobs and all project jobs share one run budget', async () => {
  const seededProject = (await db.query<{ id: string }>(
    "select id from public.projects where account_id=$1 and name='Fictional desk lamp'", [accountA],
  )).rows[0]!.id;
  const bypass = await rpc('start_creator_scan', {
    project_id: seededProject,
    request_id: '77777777-7777-4777-8777-777777777771',
    scan: { platform: 'tiktok', supplied_url: source.profile_url, max_videos: 10, max_pages: 2 },
  });
  assert.equal(bypass.error?.code, 'FORBIDDEN',
    'a profile allowance created by Riff is scoped to its grant-backed project');

  const start = await rpc('get_riff_creator_start', publicInput);
  const jobId = start.data?.job.id;
  assert.ok(jobId);
  const duplicateProjectScan = await rpc('start_creator_scan', {
    project_id: start.data?.project.id,
    request_id: '77777777-7777-4777-8777-777777777772',
    scan: { platform: 'tiktok', supplied_url: source.profile_url, max_videos: 10, max_pages: 2 },
  });
  assert.equal(duplicateProjectScan.error?.code, 'FORBIDDEN',
    'one run grant authorizes only one scan job for its project');
  assert.equal((await rpc('run_creator_job', { job_id: jobId })).ok, true);
  await db.exec('update public.creator_pipeline_budget set limit_microusd=100');
  assert.equal((await rpc('reserve_creator_attempt', {
    job_id: jobId, key: 'managed-openai', provider: 'openai', operation: 'generate', ceiling_microusd: 1,
  })).error?.code, 'FORBIDDEN', 'managed OpenAI requires separate authorization not supplied by the run grant');
  const paid = await rpc('reserve_creator_attempt', {
    job_id: jobId, key: 'paid-bypass', provider: 'scrapecreators', operation: 'profile', ceiling_microusd: 1,
  });
  assert.equal(paid.ok, true, 'a priced managed provider call still needs both run and cash capacity');
  assert.equal((await db.query<{ reserved_microusd: number }>(
    'select reserved_microusd from public.creator_pipeline_budget where id=1',
  )).rows[0]!.reserved_microusd, 1);
  assert.equal((await db.query<{ scrapecreators_remaining: number }>(
    'select scrapecreators_remaining from public.riff_creator_run_grants where consumed_request_id=$1', [requestId],
  )).rows[0]!.scrapecreators_remaining, 5);
  const sharedBefore = (await db.query<{ provider: string; remaining_units: number }>(
    'select provider,remaining_units::int from public.creator_provider_trials order by provider',
  )).rows;
  for (let n = 0; n < 5; n++) {
    const attempt = await rpc('reserve_creator_attempt', {
      job_id: jobId, key: `scrape-${n}`, provider: 'scrapecreators', operation: n === 0 ? 'profile' : 'feed',
      ceiling_microusd: 0,
    });
    assert.equal(attempt.ok, true);
  }
  for (let n = 0; n < 2; n++) {
    const attempt = await rpc('reserve_creator_attempt', {
      job_id: jobId, key: `light-${n}`, provider: 'lightreel', operation: 'research', ceiling_microusd: 0,
    });
    assert.equal(attempt.ok, true);
  }
  assert.deepEqual(await rpc('reserve_creator_attempt', {
    job_id: jobId, key: 'scrape-over', provider: 'scrapecreators', operation: 'feed', ceiling_microusd: 0,
  }), { ok: false, error: { code: 'FORBIDDEN', retryable: false,
    message: 'This action is not permitted for this account.', recovery: 'contact_support' } });
  const replay = await rpc('reserve_creator_attempt', {
    job_id: jobId, key: 'scrape-0', provider: 'scrapecreators', operation: 'profile', ceiling_microusd: 0,
  });
  assert.equal(replay.data?.status, 'ambiguous');
  assert.equal((await rpc('reserve_creator_attempt', {
    job_id: jobId, key: 'paid-bypass', provider: 'scrapecreators', operation: 'profile', ceiling_microusd: 1,
  })).data?.status, 'ambiguous');
  assert.equal((await db.query<{ reserved_microusd: number }>(
    'select reserved_microusd from public.creator_pipeline_budget where id=1',
  )).rows[0]!.reserved_microusd, 1, 'a priced attempt replay reserves neither grant units nor cash twice');
  assert.deepEqual((await db.query<{ provider: string; remaining_units: number }>(
    'select provider,remaining_units::int from public.creator_provider_trials order by provider',
  )).rows, sharedBefore, 'provider calls spend the capacity reserved into the account run, not the shared pool twice');
  assert.deepEqual((await db.query<{ scrapecreators_remaining: number; lightreel_remaining: number }>(
    'select scrapecreators_remaining,lightreel_remaining from public.riff_creator_run_grants where consumed_request_id=$1',
    [requestId],
  )).rows, [{ scrapecreators_remaining: 0, lightreel_remaining: 0 }]);
});

test('recent Riff work returns the latest job per owned started project in bounded activity order', async () => {
  const listed = await rpc('list_riff_work', { limit: 1 });
  assert.equal(listed.ok, true);
  assert.equal(listed.data?.work.length, 1);
  assert.equal(listed.data?.work[0].project_name, '@creator.one creator work');
  assert.equal(listed.data?.work[0].source.profile_url, source.profile_url);
  assert.ok(!JSON.stringify(listed).includes('account_id'));
  const foreign = await rpc('list_riff_work', { limit: 10 }, accountB);
  assert.deepEqual(foreign.data?.work, []);
  assert.equal((await rpc('list_riff_work', { limit: 21 })).error?.code, 'VALIDATION_ERROR');
});

test('Riff creator start state and RPCs remain unavailable to client roles', async () => {
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(db.transaction(async tx => {
      await tx.exec(`set local role ${role}`);
      await tx.exec('select * from public.riff_creator_starts');
    }), /permission denied/);
    await assert.rejects(db.transaction(async tx => {
      await tx.exec(`set local role ${role}`);
      await tx.exec('select * from public.riff_creator_run_grants');
    }), /permission denied/);
    await assert.rejects(db.transaction(async tx => {
      await tx.exec(`set local role ${role}`);
      await tx.query('select public.kettle_get_riff_creator_start($1::uuid,$2::jsonb)', [accountA, JSON.stringify(publicInput)]);
    }), /permission denied/);
    await assert.rejects(db.transaction(async tx => {
      await tx.exec(`set local role ${role}`);
      await tx.query('select public.kettle_list_riff_work($1::uuid,$2::jsonb)', [accountA, '{}']);
    }), /permission denied/);
    await assert.rejects(db.transaction(async tx => {
      await tx.exec(`set local role ${role}`);
      await tx.query('select public.kettle_provision_riff_creator_run_grants($1::uuid,$2::jsonb)', [accountA, JSON.stringify({
        request_id: crypto.randomUUID(), mode: 'refill', run_count: 1,
      })]);
    }), /permission denied/);
  }
});
