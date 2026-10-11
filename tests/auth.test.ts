import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discover, internalPermissions, oauthScopes, protectedResource } from '../packages/auth/index.ts';
import { createOperations, failure } from '../packages/application/operations.ts';
import { handleMcp } from '../apps/worker/mcp.ts';
import { accountA, accountB, createInput } from './fixtures.ts';

import { config, metadata, fixtureAuth } from './auth-fixtures.ts';

test('signed tokens validate Supabase issuer, resource, lifetime and permissions before identity mapping', async (t) => {
  const auth = await fixtureAuth();
  // Freeze both token issuance and verification: crossing a second must not turn
  // a 3601-second lifetime into 3600 or a future iat into the present.
  const now = 1_800_000_000;
  t.mock.timers.enable({ apis: ['Date'], now: now * 1000 });
  const valid = await auth.token();
  assert.deepEqual(await auth.verifier.verify(valid), { account_id: accountA, scopes: [...internalPermissions] });
  assert.equal(auth.resolutions.length, 1);
  for (const claims of [
    { iss: 'https://evil.example/auth/v1' }, { aud: 'authenticated' }, { aud: 'https://other.example/mcp' },
    { exp: now - 1 }, { nbf: now + 100 }, { iat: now + 1 }, { iat: undefined }, { exp: undefined },
    { gty: 'client-credentials' }, { sub: 'machine@clients' }, { token_use: 'id' }, { role: 'anon' },
    { exp: now + 3601 }, { sub: '' }, { scope: 'offline_access' }, { scope: undefined },
    { client_id: undefined }, { riff_permissions: undefined }, { riff_permissions: ['admin'] },
  ]) assert.equal(await auth.verifier.verify(await auth.token(claims)), null, JSON.stringify(claims));
  assert.equal(await auth.verifier.verify(`${valid.slice(0, -12)}AAAAAAAAAAAA`), null);
  assert.equal(await auth.verifier.verify('eyJhbGciOiJub25lIn0.e30.'), null);
  assert.equal(auth.resolutions.length, 1, 'invalid credentials must never provision accounts');
  auth.block();
  assert.equal(await auth.verifier.verify(valid), null, 'local revocation rechecked on each call');
});
test('same verified issuer-subject maps to the same account while email cannot link users', async () => {
  const auth = await fixtureAuth();
  const first = await auth.verifier.verify(await auth.token({ client_id: 'chatgpt-client-a', email: 'same@example.test' }));
  const second = await auth.verifier.verify(await auth.token({ client_id: 'chatgpt-client-b', email: 'changed@example.test' }));
  const other = await auth.verifier.verify(await auth.token({ sub: 'user-b', email: 'same@example.test' }));
  assert.equal(first?.account_id, second?.account_id);
  assert.notEqual(first?.account_id, other?.account_id);
});
test('discovery rejects issuer mismatch, foreign endpoints, missing PKCE and redirects cannot be followed', async () => {
  for (const override of [ { issuer: 'https://evil.example/' }, { token_endpoint: 'https://evil.example/token' },
    { jwks_uri: 'http://identity.example/keys' }, { code_challenge_methods_supported: ['plain'] } ]) {
    await assert.rejects(discover(config, (async (_url, init) => {
      assert.equal(init?.redirect, 'manual'); return Response.json({ ...metadata, ...override });
    }) as typeof fetch));
  }
  assert.deepEqual(await discover(config, (async () => Response.json(metadata)) as typeof fetch), metadata);
  assert.equal(protectedResource(config).resource, config.resource);
});
test('authenticated MCP advertises standard OAuth scopes and returns challenges; injected ownership never reaches repository', async () => {
  const auth = await fixtureAuth();
  let writes = 0;
  const operations = createOperations(auth.verifier, { async call(_name, owner) {
    writes++; assert.equal(owner, accountA); return failure('NOT_FOUND');
  } });
  const rpc = async (method: string, params: unknown, token?: string) => {
    const response = await handleMcp(new Request(config.resource, { method: 'POST', headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }), { config, verifier: auth.verifier, operations });
    return response;
  };
  const listing = await (await rpc('tools/list', {})).json() as { result: { tools: { name: string; title?: string; _meta: unknown; securitySchemes: unknown }[] } };
  assert.deepEqual(listing.result.tools.map((tool) => tool.name), ['kettle_diagnostic', 'show_riff_welcome', 'get_account_state', 'mark_riff_onboarding_seen', 'get_project', 'save_project', 'show_project_brief', 'get_riff_profile', 'open_riff']);
  for (const tool of listing.result.tools) assert.ok(tool.title?.trim(), `${tool.name} must have a title`);
  const save = listing.result.tools.find((tool) => tool.name === 'save_project')!;
  assert.deepEqual(save.securitySchemes, [{ type: 'oauth2', scopes: [...oauthScopes] }]);
  assert.deepEqual(save._meta, { securitySchemes: [{ type: 'oauth2', scopes: [...oauthScopes] }] });
  const welcome = listing.result.tools.find((tool) => tool.name === 'show_riff_welcome')!;
  assert.deepEqual(welcome.securitySchemes, [{ type: 'oauth2', scopes: [...oauthScopes] }]);
  const profile = listing.result.tools.find((tool) => tool.name === 'get_riff_profile')!;
  assert.equal((profile._meta as Record<string, unknown>)['openai/profile'], true);
  assert.equal(listing.result.tools.filter((tool) => (tool._meta as Record<string, unknown>)['openai/profile'] === true).length, 1);
  const home = listing.result.tools.find((tool) => tool.name === 'open_riff')!;
  assert.equal((home as { title?: string }).title, 'Riff Home');
  assert.deepEqual((home._meta as { 'openai/ui': { entrypoints: unknown[] } })['openai/ui'].entrypoints, [{ type: 'global' }, { type: 'thread' }]);
  const denied = await (await rpc('tools/call', { name: 'save_project', arguments: createInput() })).json() as { result: { isError: boolean; structuredContent?: unknown; _meta: Record<string, string[]> } };
  assert.equal(denied.result.isError, true);
  assert.equal('structuredContent' in denied.result, false, 'errors must not violate success-only output schemas');
  assert.match(denied.result._meta['mcp/www_authenticate']![0]!, /resource_metadata=.*invalid_token/);
  assert.match(denied.result._meta['mcp/www_authenticate']![0]!, /Riff account/);
  const invalidHttp = await rpc('tools/list', {}, 'bad-token');
  assert.equal(invalidHttp.status, 401);
  assert.match(invalidHttp.headers.get('www-authenticate')!, /invalid_token/);
  const missingScope = await (await rpc('tools/call', { name: 'save_project', arguments: createInput() }, await auth.token({ riff_permissions: ['account:read'] }))).json() as { result: { _meta: Record<string, string[]> } };
  assert.match(missingScope.result._meta['mcp/www_authenticate']![0]!, /insufficient_scope/);
  assert.match(missingScope.result._meta['mcp/www_authenticate']![0]!, /scope="openid"/);
  await rpc('tools/call', { name: 'save_project', arguments: { ...createInput(), account_id: accountB } }, await auth.token());
  assert.equal(writes, 0);
  await rpc('tools/call', { name: 'save_project', arguments: createInput() }, await auth.token());
  assert.equal(writes, 1);
});

test('Riff profile and Home aliases each perform one verified account-state read without placeholder identity', async () => {
  const identity = await fixtureAuth();
  const accountState = { ok: true as const, data: {
    account: { id: accountA, display_name: 'Fictional Riff Creator', state: 'active' as const,
      preferred_language: 'en', created_at: '2026-10-10T00:00:00Z', onboarding_seen_at: null },
    entitlements: { status: 'not_configured' as const },
    usage: { status: 'not_configured' as const, reset_at: null },
  } };
  const calls: Array<{ name: string; owner: string; input: unknown }> = [];
  const operations = createOperations(identity.verifier, { async call(name, owner, input) {
    calls.push({ name, owner, input }); return accountState;
  } });
  const invoke = async (name: string, credential?: string) => {
    const response = await handleMcp(new Request(config.resource, { method: 'POST', headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } }) }),
    { config, verifier: identity.verifier, operations });
    return (await response.json() as { result: { structuredContent: unknown; isError?: boolean; _meta?: Record<string, string[]> } }).result;
  };
  const token = await identity.token();
  const profile = await invoke('get_riff_profile', token);
  assert.deepEqual(profile.structuredContent, { id: accountA, name: 'Fictional Riff Creator' });
  assert.deepEqual(calls, [{ name: 'get_account_state', owner: accountA, input: {} }]);
  calls.length = 0;
  assert.deepEqual((await invoke('open_riff', token)).structuredContent, accountState);
  assert.deepEqual(calls, [{ name: 'get_account_state', owner: accountA, input: {} }]);
  calls.length = 0;
  const anonymous = await invoke('get_riff_profile');
  assert.equal(anonymous.isError, true);
  assert.match(anonymous._meta!['mcp/www_authenticate']![0]!, /invalid_token/);
  assert.ok(!JSON.stringify(anonymous).includes('00000000-0000-4000-8000-000000000000'));
  assert.deepEqual(calls, []);
});
