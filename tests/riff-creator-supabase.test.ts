import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRiffCreatorSupabaseRepository } from '../packages/database/riff-creator-supabase.ts';
import { failure } from '../packages/application/operations.ts';
import { accountA } from './fixtures.ts';

const input = { request_id: '55555555-5555-4555-8555-555555555555', source_url: 'https://www.tiktok.com/@creator.one' };
const source = {
  platform: 'tiktok' as const, kind: 'profile' as const, handle: 'creator.one',
  canonical_url: input.source_url, profile_url: input.source_url, video_url: null,
};

test('Riff creator Supabase adapter keeps owner and development policy in the service-role boundary', async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'manual'); assert.ok(init?.signal);
    assert.equal(headers.get('authorization'), 'Bearer fixture-service-role');
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json(failure('NOT_FOUND'));
  };
  const repository = createRiffCreatorSupabaseRepository('https://example.supabase.co', 'fixture-service-role', {
    maxProfilesPerAccount: 2, allowanceTtlSeconds: 604800,
  }, fetcher);
  assert.deepEqual(await repository.find(accountA, input), failure('NOT_FOUND'));
  assert.deepEqual(await repository.start(accountA, input, source), failure('NOT_FOUND'));
  assert.deepEqual(await repository.list(accountA, { limit: 5 }), failure('NOT_FOUND'));
  assert.deepEqual(requests, [
    {
      url: 'https://example.supabase.co/rest/v1/rpc/kettle_get_riff_creator_start',
      body: { p_account_id: accountA, p_input: input },
    },
    {
      url: 'https://example.supabase.co/rest/v1/rpc/kettle_start_riff_creator',
      body: { p_account_id: accountA, p_input: {
        input, source, max_profiles_per_account: 2, allowance_ttl_seconds: 604800,
      } },
    },
    {
      url: 'https://example.supabase.co/rest/v1/rpc/kettle_list_riff_work',
      body: { p_account_id: accountA, p_input: { limit: 5 } },
    },
  ]);
  assert.throws(() => createRiffCreatorSupabaseRepository('http://remote.test', 'secret', {
    maxProfilesPerAccount: 1, allowanceTtlSeconds: 60,
  }));
  assert.throws(() => createRiffCreatorSupabaseRepository('https://example.supabase.co', 'secret', {
    maxProfilesPerAccount: 0, allowanceTtlSeconds: 60,
  }));
  assert.throws(() => createRiffCreatorSupabaseRepository('https://example.supabase.co', 'secret', {
    maxProfilesPerAccount: 1, allowanceTtlSeconds: 604801,
  }));
});
