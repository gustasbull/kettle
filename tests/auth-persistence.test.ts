import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import {
  createMcpJwtVerifier,
  createWebsiteSessionVerifier,
  internalPermissions,
} from '../packages/auth/index.ts';
import { createOperations, failure, type ProjectRepository } from '../packages/application/operations.ts';
import { GetAccountStateOutput, GetProjectOutput, SaveProjectOutput } from '../packages/contracts/index.ts';
import { OpenAIProfile } from '../packages/contracts/openai-profile.ts';
import { handleMcp } from '../apps/worker/mcp.ts';
import { config } from './auth-fixtures.ts';
import { createInput } from './fixtures.ts';

// Locally signed Supabase-shaped credentials + real migration SQL. No hosted
// OAuth, network PostgREST, or multi-connection concurrency proof is implied.
test('website and MCP Supabase credentials share SQL ownership while other subjects remain isolated', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin; grant usage on schema public to service_role; alter default privileges in schema public grant all on tables to service_role;');
  for (const file of (await readdir('supabase/migrations')).filter((name) => name.endsWith('.sql')).sort()) {
    await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
  }

  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const keys = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: 'persistence-test', alg: 'ES256' }] });
  const issued = Math.floor(Date.now() / 1000) - 10;
  const token = (subject: string, policy: 'website' | 'mcp', claims: Record<string, unknown> = {}) => new SignJWT({
    sub: subject,
    iss: config.issuer,
    aud: policy === 'website' ? 'authenticated' : config.resource,
    role: 'authenticated',
    iat: issued,
    exp: issued + 300,
    ...(policy === 'mcp' ? {
      client_id: 'chatgpt-dcr-client', scope: 'openid offline_access', riff_permissions: [...internalPermissions],
    } : {}),
    ...claims,
  }).setProtectedHeader({ alg: 'ES256', kid: 'persistence-test', typ: 'JWT' }).sign(privateKey);

  const resolve = (issuer: string, subject: string, iat: number) => db.transaction(async (tx) => {
    await tx.exec('set local role service_role');
    return (await tx.query<{ id: string | null }>(
      'select public.kettle_resolve_identity($1,$2,$3) as id', [issuer, subject, iat],
    )).rows[0]!.id;
  });
  let storageCalls = 0;
  const repository: ProjectRepository = { call: (operation, owner, input) => db.transaction(async (tx) => {
    storageCalls++;
    await tx.exec('set local role service_role');
    return (await tx.query<{ result: unknown }>(
      `select public.kettle_${operation}($1::uuid,$2::jsonb) as result`, [owner, JSON.stringify(input)],
    )).rows[0]!.result;
  }) };

  const websiteVerifier = createWebsiteSessionVerifier(config, resolve, keys);
  const mcpVerifier = createMcpJwtVerifier(config, resolve, keys);
  const websiteOperations = createOperations(websiteVerifier, repository);
  const mcpOperations = createOperations(mcpVerifier, repository);
  const websiteToken = await token('fictional-a', 'website');
  const mcpToken = await token('fictional-a', 'mcp');
  const websiteAccount = GetAccountStateOutput.parse(await websiteOperations.execute('get_account_state', websiteToken, {}));
  assert.ok(websiteAccount.ok);
  const mcpAccount = GetAccountStateOutput.parse(await mcpOperations.execute('get_account_state', mcpToken, {}));
  assert.ok(mcpAccount.ok);
  assert.equal(mcpAccount.data.account.id, websiteAccount.data.account.id);

  // Each request may build a fresh verifier/transport; only SQL owns state.
  const mcp = async (credential: string, name: string, args: unknown) => {
    const verifier = createMcpJwtVerifier(config, resolve, keys);
    return handleMcp(new Request(config.resource, { method: 'POST', headers: {
      Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }),
    { config, verifier, operations: createOperations(verifier, repository) });
  };
  const result = async (response: Response) => {
    assert.equal(response.status, 200);
    return (await response.json() as { result: {
      structuredContent?: unknown; content: { text: string }[]; isError?: boolean; _meta?: Record<string, string[]>;
    } }).result;
  };

  const profileResult = await result(await mcp(mcpToken, 'get_riff_profile', {}));
  const profile = OpenAIProfile.parse(profileResult.structuredContent);
  assert.deepEqual(profile, { id: websiteAccount.data.account.id, name: websiteAccount.data.account.display_name });
  const input = createInput();
  const savedResult = await result(await mcp(mcpToken, 'save_project', input));
  const saved = SaveProjectOutput.parse(savedResult.structuredContent);
  assert.ok(saved.ok);
  const projectId = saved.data.project.id;
  const update = { ...input, request_id: crypto.randomUUID(), project_id: projectId, expected_version: 1,
    brief: { ...input.brief, audience: 'Fictional home-office workers' } };
  const updated = SaveProjectOutput.parse((await result(await mcp(mcpToken, 'save_project', update))).structuredContent);
  assert.ok(updated.ok);

  const reconnected = await token('fictional-a', 'mcp', { iat: issued + 1 });
  const reopened = GetProjectOutput.parse((await result(await mcp(reconnected, 'get_project', { project_id: projectId }))).structuredContent);
  assert.ok(reopened.ok);
  assert.deepEqual(reopened.data.project, updated.data.project);
  const websiteRead = GetProjectOutput.parse(await websiteOperations.execute('get_project', websiteToken, { project_id: projectId }));
  assert.ok(websiteRead.ok);
  assert.deepEqual(websiteRead.data.project, updated.data.project);

  const otherToken = await token('fictional-b', 'mcp');
  const otherAccount = GetAccountStateOutput.parse(await mcpOperations.execute('get_account_state', otherToken, {}));
  assert.ok(otherAccount.ok);
  assert.notEqual(otherAccount.data.account.id, websiteAccount.data.account.id);
  const denied = await result(await mcp(otherToken, 'get_project', { project_id: projectId }));
  const missing = await result(await mcp(otherToken, 'get_project', { project_id: crypto.randomUUID() }));
  assert.equal(denied.isError, true);
  assert.equal('structuredContent' in denied, false);
  assert.deepEqual(denied, missing);

  const callsBeforeDenial = storageCalls;
  const limited = await token('fictional-a', 'mcp', { riff_permissions: ['account:read'] });
  const scopeDenied = await result(await mcp(limited, 'save_project', { ...update, request_id: crypto.randomUUID(), expected_version: 2 }));
  assert.equal(scopeDenied.isError, true);
  assert.match(scopeDenied._meta!['mcp/www_authenticate']![0]!, /insufficient_scope.*scope="openid"/);
  assert.equal(storageCalls, callsBeforeDenial);
  assert.equal((await mcp(await token('fictional-a', 'mcp', { exp: issued + 1 }), 'get_project', { project_id: projectId })).status, 401);

  await db.query('update public.account_identities set tokens_valid_after=to_timestamp($1) where account_id=$2', [issued, websiteAccount.data.account.id]);
  assert.equal((await mcp(mcpToken, 'get_project', { project_id: projectId })).status, 401);
  assert.deepEqual(await websiteOperations.execute('get_account_state', websiteToken, {}), failure('UNAUTHENTICATED'));
  const freshWebsite = await token('fictional-a', 'website', { iat: issued + 1 });
  const freshMcp = await token('fictional-a', 'mcp', { iat: issued + 1 });
  assert.ok((await websiteOperations.execute('get_account_state', freshWebsite, {})).ok);
  await db.query('update public.account_identities set blocked=true where account_id=$1', [websiteAccount.data.account.id]);
  assert.equal((await mcp(freshMcp, 'get_project', { project_id: projectId })).status, 401);
  assert.ok((await mcpOperations.execute('get_account_state', otherToken, {})).ok, 'other account remains usable');
  await db.query('update public.account_identities set blocked=false where account_id=$1', [websiteAccount.data.account.id]);
  const recovered = GetProjectOutput.parse((await result(await mcp(freshMcp, 'get_project', { project_id: projectId }))).structuredContent);
  assert.ok(recovered.ok);
  assert.deepEqual(recovered.data.project, updated.data.project);
  const identityCount = await db.query<{ count: number }>('select count(*)::int as count from public.account_identities');
  assert.equal(identityCount.rows[0]!.count, 2);
});
