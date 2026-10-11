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
const profileSource = {
  platform: 'tiktok' as const,
  kind: 'profile' as const,
  handle: source.handle,
  canonical_url: source.profile_url,
  profile_url: source.profile_url,
  video_url: null,
};
const profileInput = { request_id: requestId, source_url: profileSource.canonical_url };
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

test('TikTok source classification distinguishes canonical, short and invalid without network I/O', async () => {
  const module = await import('../packages/adapters/creator-pipeline/tiktok-source.ts');
  const classify = (module as unknown as { classifyTikTokCreatorSource?: (value: string) => string }).classifyTikTokCreatorSource;
  assert.equal(typeof classify, 'function');
  assert.equal(classify?.(source.canonical_url), 'canonical');
  assert.equal(classify?.('https://www.tiktok.com/@creator.one'), 'canonical');
  assert.equal(classify?.('https://vm.tiktok.com/ZN8kT85EE/'), 'short');
  assert.equal(classify?.('https://evil.test/@creator.one'), 'invalid');
  assert.equal(classify?.('https://user:secret@vm.tiktok.com/ZN8kT85EE/'), 'invalid');
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

test('canonical creator start skips preflight and schedules one queued dispatch', async () => {
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
    undefined, () => 'canonical',
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
    { method: 'start', accountId: accountA, value: { value: input, canonical: source } },
  ]);
  assert.deepEqual(dispatches, [[jobId, accountA]]);
  assert.ok(!JSON.stringify(result).includes('account_id'));
});

test('canonical profile start preserves profile kind without a replay lookup', async () => {
  let finds=0,resolutions=0,starts=0;
  const dispatches:Array<[string,string]>=[];
  const repository:RiffCreatorRepository={
    async find(){finds++;throw new Error('canonical input must skip replay lookup');},
    async start(accountId,value,canonical){
      starts++;assert.equal(accountId,accountA);assert.deepEqual(value,profileInput);assert.deepEqual(canonical,profileSource);
      return {ok:true,data:{project,job:storedJob,source:profileSource}};
    },
    async list(){throw new Error('must not list');},
  };
  const operations=createRiffCreatorOperations(
    {async verify(){return {account_id:accountA,scopes:['projects:write']};}},repository,
    async value=>{resolutions++;assert.equal(value,profileSource.canonical_url);return profileSource;},
    (id,owner)=>{dispatches.push([id,owner]);},()=>true,undefined,()=> 'canonical',
  );

  const result=StartRiffCreatorOutput.parse(await operations.execute('start_riff_creator','token',profileInput));
  assert.equal(result.ok,true);if(!result.ok)return;
  assert.deepEqual(result.data.source,profileSource);
  assert.equal(result.data.job.source_kind,undefined,'stored captured input remains the only source-kind authority');
  assert.deepEqual({finds,resolutions,starts},{finds:0,resolutions:1,starts:1});
  assert.deepEqual(dispatches,[[jobId,accountA]]);
});

test('short-link replay returns before redirect resolution and rejects untrusted identity or input', async () => {
  let resolutions = 0; let starts = 0; let finds = 0; let dispatches = 0;
  const repository: RiffCreatorRepository = {
    async find() { finds++; return storedSuccess; },
    async start() { starts++; throw new Error('must not start'); },
    async list() { throw new Error('must not list'); },
  };
  const operations = createRiffCreatorOperations(
    { async verify(token) {
      if (token === 'expired') return null;
      return { account_id: accountA, scopes: token === 'read-only' ? ['projects:read'] : ['projects:write'] };
    } }, repository, async () => { resolutions++; return source; }, async () => { dispatches++; }, () => true,
    undefined, () => 'short',
  );
  assert.equal((await operations.execute('start_riff_creator', 'valid', input) as {ok:boolean}).ok, true);
  assert.equal(resolutions, 0); assert.equal(starts, 0); assert.equal(finds, 1); assert.equal(dispatches,1);
  assert.deepEqual(await operations.execute('start_riff_creator', null, input), failure('UNAUTHENTICATED'));
  assert.deepEqual(await operations.execute('start_riff_creator', 'expired', input), failure('UNAUTHENTICATED'));
  assert.deepEqual(await operations.execute('start_riff_creator', 'read-only', input), failure('FORBIDDEN'));
  assert.deepEqual(await operations.execute('start_riff_creator', 'valid', { ...input, account_id: accountA }), failure('VALIDATION_ERROR'));
  assert.equal(finds, 1);
});

test('short-link miss resolves once, starts once, and schedules the returned queued job once', async () => {
  const calls:string[]=[];
  const repository:RiffCreatorRepository={
    async find(){calls.push('find');return failure('NOT_FOUND');},
    async start(_accountId,_value,canonical){calls.push('start');assert.deepEqual(canonical,source);return storedSuccess;},
    async list(){throw new Error('must not list');},
  };
  const operations=createRiffCreatorOperations(
    {async verify(){return {account_id:accountA,scopes:['projects:write']};}},repository,
    async()=>{calls.push('resolve');return source;},()=>{calls.push('dispatch');},()=>true,undefined,()=> 'short',
  );
  assert.equal((await operations.execute('start_riff_creator','token',input)).ok,true);
  assert.deepEqual(calls,['find','resolve','start','dispatch']);
});

test('short-link non-NOT_FOUND lookup failure returns immediately without resolution, start, or dispatch', async () => {
  for(const code of ['FORBIDDEN','UNAVAILABLE'] as const){
    const calls:string[]=[];
    const repository:RiffCreatorRepository={
      async find(){calls.push('find');return failure(code);},
      async start(){calls.push('start');return storedSuccess;},
      async list(){throw new Error('must not list');},
    };
    const operations=createRiffCreatorOperations(
      {async verify(){return {account_id:accountA,scopes:['projects:write']};}},repository,
      async()=>{calls.push('resolve');return source;},()=>{calls.push('dispatch');},()=>true,undefined,()=> 'short',
    );
    assert.deepEqual(await operations.execute('start_riff_creator','token',input),failure(code));
    assert.deepEqual(calls,['find']);
  }
});

test('invalid source classification reaches neither repository nor scheduler', async () => {
  let calls = 0;
  const operations = createRiffCreatorOperations(
    { async verify() { return { account_id: accountA, scopes: ['projects:write'] }; } },
    {
      async find() { calls++; return storedSuccess; },
      async start() { calls++; return storedSuccess; },
      async list() { calls++; return workSuccess; },
    },
    async () => { calls++; return source; },
    () => { calls++; },
    () => true,
    undefined,
    () => 'invalid',
  );
  assert.deepEqual(await operations.execute('start_riff_creator', 'valid', {
    request_id: requestId, source_url: 'https://evil.test/@creator.one',
  }), failure('VALIDATION_ERROR'));
  assert.equal(calls, 0);
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
  let classifications=0;
  const operations = createRiffCreatorOperations(
    { async verify() { return { account_id: accountA, scopes: ['projects:read'] }; } }, repository,
    async () => { throw new Error('lookup must not resolve'); },
    async () => { throw new Error('lookup must not dispatch'); },
    () => false,
    undefined,
    () => {classifications++;throw new Error('lookup must not classify');},
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
  assert.equal(classifications,0);
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
