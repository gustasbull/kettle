import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failure } from '../packages/application/operations.ts';
import { createRiffCreatorOperations, type RiffCreatorRepository } from '../packages/application/riff-creator.ts';
import {
  ListRiffWorkInput, ListRiffWorkOutput, StartRiffCreatorInput, StartRiffCreatorOutput, riffCreatorContracts,
} from '../packages/contracts/riff-creator.ts';
import { resolveTikTokCreatorSource } from '../packages/adapters/creator-pipeline/tiktok-source.ts';
import { accountA } from './fixtures.ts';

const projectId = '33333333-3333-4333-8333-333333333333';
const jobId = '44444444-4444-4444-8444-444444444444';
const requestId = '55555555-5555-4555-8555-555555555555';
const timestamp = '2026-10-10T22:45:49Z';
const source = {
  platform: 'tiktok' as const,
  kind: 'video' as const,
  handle: 'creator.one',
  canonical_url: 'https://www.tiktok.com/@creator.one/video/1234567890',
  profile_url: 'https://www.tiktok.com/@creator.one',
  video_url: 'https://www.tiktok.com/@creator.one/video/1234567890',
};
const input = { request_id: requestId, source_url: source.canonical_url };
const project = {
  id: projectId, name: '@creator.one creator work', project_type: 'brand' as const, current_version: 1,
  created_at: timestamp, updated_at: timestamp,
  brief_version: {
    id: '66666666-6666-4666-8666-666666666666', project_id: projectId, version: 1,
    name: '@creator.one creator work', created_at: timestamp,
    brief: {
      product: 'Creator profile @creator.one', audience: 'Unknown until analysis',
      goal: 'Find a tailored next video direction', tone: 'Creator-led', language: 'en',
      duration_seconds: 30, filming_constraints: ['Treat missing data as unknown'], facts: [],
    },
  },
};
const storedJob = {
  id: jobId, account_id: accountA, project_id: projectId, request_id: requestId,
  kind: 'scan' as const, state: 'queued' as const, revision: 1,
  created_at: timestamp, updated_at: timestamp,
  input: { project_id: projectId, request_id: requestId }, captured: {}, result: null, message: null,
};
const storedSuccess = { ok: true as const, data: { project, job: storedJob, source } };
const workSuccess = { ok: true as const, data: { work: [{
  project_id: projectId, project_name: project.name, job_id: jobId, kind: 'scan' as const,
  state: 'queued' as const, updated_at: timestamp, source,
}] } };

test('start contract accepts only a request ID and HTTPS source URL', () => {
  assert.deepEqual(StartRiffCreatorInput.parse(input), input);
  for (const invalid of [
    { ...input, account_id: accountA },
    { ...input, source_url: 'http://www.tiktok.com/@creator.one' },
    { ...input, source_url: 'https://user:secret@www.tiktok.com/@creator.one' },
    { source_url: source.canonical_url },
  ]) assert.equal(StartRiffCreatorInput.safeParse(invalid).success, false);
});

test('exact reported TikTok share link passes intake and the bounded canonical redirect fixture', async () => {
  const reported = 'https://vm.tiktok.com/ZN8kT85EE/';
  const canonical = 'https://www.tiktok.com/@katieworktips/video/7693046617351441672';
  assert.equal(StartRiffCreatorInput.safeParse({ request_id: requestId, source_url: reported }).success, true);
  const visited: string[] = [];
  const resolved = await resolveTikTokCreatorSource(reported, async (url, init) => {
    visited.push(String(url));
    assert.equal(init.redirect, 'manual');
    assert.ok(init.signal);
    return new Response(null, { status: 302, headers: { Location: `${canonical}?_r=1` } });
  }, { maxRedirects: 2, timeoutMs: 100 });
  assert.deepEqual(visited, [reported]);
  assert.deepEqual(resolved, {
    platform: 'tiktok', kind: 'video', handle: 'katieworktips', canonical_url: canonical,
    profile_url: 'https://www.tiktok.com/@katieworktips', video_url: canonical,
  });
});

test('canonical TikTok sources avoid network and short links follow only bounded HTTPS TikTok redirects', async () => {
  let calls = 0;
  assert.deepEqual(await resolveTikTokCreatorSource(source.canonical_url, async () => {
    calls++; throw new Error('canonical URL must not fetch');
  }), source);
  assert.equal(calls, 0);

  const visited: string[] = [];
  const resolved = await resolveTikTokCreatorSource('https://vt.tiktok.com/ZSFictional/', async (url, init) => {
    visited.push(String(url));
    assert.equal(init?.redirect, 'manual');
    assert.ok(init?.signal);
    return visited.length === 1
      ? new Response(null, { status: 302, headers: { Location: 'https://vm.tiktok.com/ZSTwo/' } })
      : new Response(null, { status: 301, headers: { Location: source.canonical_url + '?share=1' } });
  }, { maxRedirects: 3, timeoutMs: 100 });
  assert.deepEqual(resolved, source);
  assert.deepEqual(visited, ['https://vt.tiktok.com/ZSFictional/', 'https://vm.tiktok.com/ZSTwo/']);
});

test('TikTok short-link resolution rejects foreign, insecure and overlong redirect chains without following them', async () => {
  let calls = 0;
  await assert.rejects(resolveTikTokCreatorSource('https://vt.tiktok.com/ZSFictional/', async () => {
    calls++;
    return new Response(null, { status: 302, headers: { Location: 'https://tiktok.com.evil.test/steal' } });
  }), /Invalid TikTok redirect/);
  assert.equal(calls, 1);
  await assert.rejects(resolveTikTokCreatorSource('https://vt.tiktok.com/ZSFictional/', async (url) => {
    calls++;
    return new Response(null, { status: 302, headers: { Location: String(url) } });
  }, { maxRedirects: 2, timeoutMs: 100 }), /redirect limit/);
  assert.equal(calls, 3);
  for (const value of ['http://vt.tiktok.com/ZSFictional/', 'https://evil.test/ZSFictional/',
    'https://user:secret@vt.tiktok.com/ZSFictional/']) {
    await assert.rejects(resolveTikTokCreatorSource(value, async () => { throw new Error('must not fetch'); }), /TikTok/);
  }
});

test('authenticated creator start derives ownership, prepares once and dispatches the existing queued scan', async () => {
  const calls: Array<{ method: string; accountId: string; value: unknown }> = [];
  const repository: RiffCreatorRepository = {
    async find(accountId, value) { calls.push({ method: 'find', accountId, value }); return failure('NOT_FOUND'); },
    async start(accountId, value, canonical) {
      calls.push({ method: 'start', accountId, value: { value, canonical } }); return storedSuccess;
    },
    async list() { throw new Error('must not list'); },
  };
  const dispatches: Array<[string, string]> = [];
  const operations = createRiffCreatorOperations(
    { async verify() { return { account_id: accountA, scopes: ['projects:write'] }; } }, repository,
    async () => source, async (id, owner) => { dispatches.push([id, owner]); }, () => true,
  );

  const result = StartRiffCreatorOutput.parse(await operations.execute('start_riff_creator', 'fixture-token', input));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.data, {
    project,
    job: {
      id: jobId, project_id: projectId, kind: 'scan', state: 'queued', revision: 1,
      created_at: timestamp, updated_at: timestamp, result: null, message: null,
    },
    source,
  });
  assert.deepEqual(calls, [
    { method: 'find', accountId: accountA, value: input },
    { method: 'start', accountId: accountA, value: { value: input, canonical: source } },
  ]);
  assert.deepEqual(dispatches, [[jobId, accountA]]);
  assert.ok(!JSON.stringify(result).includes('account_id'));
});

test('creator start replays stored work before URL resolution and rejects untrusted identity or input', async () => {
  let resolutions = 0; let starts = 0; let finds = 0;
  const repository: RiffCreatorRepository = {
    async find() { finds++; return storedSuccess; },
    async start() { starts++; throw new Error('must not start'); },
    async list() { throw new Error('must not list'); },
  };
  const operations = createRiffCreatorOperations(
    { async verify(token) {
      if (token === 'expired') return null;
      return { account_id: accountA, scopes: token === 'read-only' ? ['projects:read'] : ['projects:write'] };
    } }, repository, async () => { resolutions++; return source; }, async () => {}, () => true,
  );
  assert.equal((await operations.execute('start_riff_creator', 'valid', input) as {ok:boolean}).ok, true);
  assert.equal(resolutions, 0); assert.equal(starts, 0); assert.equal(finds, 1);
  assert.deepEqual(await operations.execute('start_riff_creator', null, input), failure('UNAUTHENTICATED'));
  assert.deepEqual(await operations.execute('start_riff_creator', 'expired', input), failure('UNAUTHENTICATED'));
  assert.deepEqual(await operations.execute('start_riff_creator', 'read-only', input), failure('FORBIDDEN'));
  assert.deepEqual(await operations.execute('start_riff_creator', 'valid', { ...input, account_id: accountA }), failure('VALIDATION_ERROR'));
  assert.equal(finds, 1);
});

test('creator start lookup is a provider-free authenticated exact read', async () => {
  const contract = riffCreatorContracts.get_riff_creator_start;
  assert.equal(contract.input, StartRiffCreatorInput);
  assert.equal(contract.output, StartRiffCreatorOutput);
  assert.equal(contract.scope, 'projects:read');
  assert.equal(contract.readOnly, true);
  const calls: unknown[] = [];
  const repository: RiffCreatorRepository = {
    async find(accountId, value) { calls.push({ accountId, value }); return storedSuccess; },
    async start() { throw new Error('lookup must not start'); },
    async list() { throw new Error('lookup must not list'); },
  };
  const operations = createRiffCreatorOperations(
    { async verify() { return { account_id: accountA, scopes: ['projects:read'] }; } }, repository,
    async () => { throw new Error('lookup must not resolve'); },
    async () => { throw new Error('lookup must not dispatch'); },
    () => false,
  );
  const result = await operations.execute('get_riff_creator_start', 'fixture-token', input);
  assert.deepEqual(StartRiffCreatorOutput.parse(result), {
    ok: true,
    data: {
      project,
      job: {
        id: jobId, project_id: projectId, kind: 'scan', state: 'queued', revision: 1,
        created_at: timestamp, updated_at: timestamp, result: null, message: null,
      },
      source,
    },
  });
  assert.deepEqual(calls, [{ accountId: accountA, value: input }]);
});

test('recent Riff work is a bounded account-scoped read with no start or URL resolution', async () => {
  assert.deepEqual(ListRiffWorkInput.parse({}), {});
  assert.deepEqual(ListRiffWorkInput.parse({ limit: 5 }), { limit: 5 });
  assert.equal(ListRiffWorkInput.safeParse({ limit: 21 }).success, false);
  assert.equal(ListRiffWorkInput.safeParse({ account_id: accountA }).success, false);
  const calls: unknown[] = [];
  const repository: RiffCreatorRepository = {
    async find() { throw new Error('must not find'); },
    async start() { throw new Error('must not start'); },
    async list(accountId, value) { calls.push({ accountId, value }); return workSuccess; },
  };
  const operations = createRiffCreatorOperations(
    { async verify() { return { account_id: accountA, scopes: ['projects:read'] }; } }, repository,
    async () => { throw new Error('must not resolve'); }, async () => { throw new Error('must not dispatch'); }, () => true,
  );
  assert.deepEqual(ListRiffWorkOutput.parse(await operations.execute('list_riff_work', 'token', { limit: 5 })), workSuccess);
  assert.deepEqual(calls, [{ accountId: accountA, value: { limit: 5 } }]);
  assert.deepEqual(await operations.execute('start_riff_creator', 'token', input), failure('FORBIDDEN'));
});
