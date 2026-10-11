import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRiffCreatorRuntime } from '../apps/worker/riff-creator-runtime.ts';
import { failure } from '../packages/application/operations.ts';
import { createCreatorDispatchScheduler } from '../packages/application/creator-pipeline.ts';
import { accountA } from './fixtures.ts';

test('runtime factory composes verified identity, service storage, canonicalization and dispatch without MCP globals', async () => {
  const requestId = '55555555-5555-4555-8555-555555555555';
  const sourceUrl = 'https://www.tiktok.com/@creator.one';
  const projectId = '33333333-3333-4333-8333-333333333333';
  const jobId = '44444444-4444-4444-8444-444444444444';
  const timestamp = '2026-10-10T22:45:49Z';
  const calls: string[] = [];
  const fetcher: typeof fetch = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith('/kettle_get_riff_creator_start')) return Response.json(failure('NOT_FOUND'));
    return Response.json({ ok: true, data: {
      project: {
        id: projectId, name: '@creator.one creator work', project_type: 'brand', current_version: 1,
        created_at: timestamp, updated_at: timestamp,
        brief_version: { id: '66666666-6666-4666-8666-666666666666', project_id: projectId, version: 1,
          name: '@creator.one creator work', created_at: timestamp, brief: {
            product: 'Creator profile @creator.one', audience: 'Unknown until analysis',
            goal: 'Find a tailored next video direction', tone: 'Creator-led', language: 'en',
            duration_seconds: 30, filming_constraints: [], facts: [],
          } },
      },
      job: { id: jobId, account_id: accountA, project_id: projectId, request_id: requestId,
        kind: 'scan', state: 'queued', revision: 1, created_at: timestamp, updated_at: timestamp,
        input: {}, captured: {}, result: null, message: null },
      source: { platform: 'tiktok', kind: 'profile', handle: 'creator.one', canonical_url: sourceUrl,
        profile_url: sourceUrl, video_url: null },
    } });
  };
  const dispatched: string[] = [];
  const observed: Array<Record<string, unknown>> = [];
  const telemetry = {
    record(fields: Record<string, unknown>) { observed.push({ ...fields }); },
    async measure<T>(fields: Record<string, unknown>, run: () => Promise<T>) {
      const result = await run(); observed.push({ ...fields, status: 'measured' }); return result;
    },
  };
  const operations = createRiffCreatorRuntime({
    supabaseUrl: 'https://example.supabase.co', serviceRoleKey: 'fixture-service-role',
    maxProfilesPerAccount: 1, allowanceTtlSeconds: 604800,
  }, { async verify() { return { account_id: accountA, scopes: ['projects:write'] }; } },
  createCreatorDispatchScheduler(async id => { dispatched.push(id); },task=>{void task;}), () => true, fetcher, telemetry);

  const response = await operations.execute('start_riff_creator', 'token', { request_id: requestId, source_url: sourceUrl });
  assert.equal(response.ok, true);
  assert.deepEqual(calls, ['https://example.supabase.co/rest/v1/rpc/kettle_start_riff_creator']);
  assert.deepEqual(dispatched, [jobId]);
  assert.deepEqual(observed.map(event => [event.stage, event.operation]), [
    ['application_operation', 'start'],
    ['supabase_rpc', 'start'],
    ['application_operation', 'dispatch'],
  ]);
  assert.doesNotMatch(JSON.stringify(observed), /source_url|service-role|creator\.one|account_id/i);
});
