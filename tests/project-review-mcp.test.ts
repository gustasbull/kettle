import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { z } from 'zod';
import { createOperations } from '../packages/application/operations.ts';
import { GetProjectInput, GetProjectOutput, SaveProjectOutput } from '../packages/contracts/index.ts';
import { handleMcp, type McpAuth } from '../apps/worker/mcp.ts';
import { oauthScopes } from '../packages/auth/index.ts';
import { PROJECT_REVIEW_URI, PROJECT_REVIEW_MIME, PROJECT_REVIEW_META, projectReviewHtml } from '../apps/worker/project-review-resource.ts';
import { RIFF_ONBOARDING_MIME, RIFF_ONBOARDING_URI } from '../apps/worker/riff-onboarding-resource.ts';
import { RIFF_HOME_MIME, RIFF_HOME_URI } from '../apps/worker/riff-home-resource.ts';
import { config, fixtureAuth } from './auth-fixtures.ts';
import { createInput } from './fixtures.ts';

async function rpc(method: string, params: unknown, auth?: McpAuth, token?: string) {
  return handleMcp(new Request(config.resource, { method: 'POST', headers: {
    'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }), auth);
}

test('project-review render tool uses signed identity, exact read contract and real SQL ownership', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin; grant usage on schema public to service_role; alter default privileges in schema public grant all on tables to service_role;');
  for (const file of (await readdir('supabase/migrations')).filter((name) => name.endsWith('.sql')).sort()) {
    await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
  }
  await db.exec(await readFile('supabase/seed.sql', 'utf8'));
  const identity = await fixtureAuth();
  let calls = 0;
  const operations = createOperations(identity.verifier, { call: (name, owner, input) => db.transaction(async (tx) => {
    calls++;
    await tx.exec('set local role service_role');
    return (await tx.query<{ result: unknown }>(`select public.kettle_${name}($1::uuid,$2::jsonb) as result`,
      [owner, JSON.stringify(input)])).rows[0]!.result;
  }) });
  const auth = { config, verifier: identity.verifier, operations };
  const token = await identity.token();
  const call = async (name: string, args: unknown, credential?: string) => {
    const response = await rpc('tools/call', { name, arguments: args }, auth, credential);
    assert.equal(response.status, 200);
    return (await response.json() as { result: { structuredContent: unknown; content: { text: string }[]; isError: boolean; _meta?: Record<string, string[]> }; error?: unknown });
  };
  const list = await (await rpc('tools/list', {}, auth)).json() as { result: { tools: Record<string, unknown>[] } };
  const tool = list.result.tools.find((item) => item.name === 'show_project_brief')!;
  assert.ok(tool);
  assert.deepEqual(tool.inputSchema, { ...z.toJSONSchema(GetProjectInput), type: 'object' });
  assert.deepEqual(tool.outputSchema, { ...z.toJSONSchema(GetProjectOutput), type: 'object' });
  const securitySchemes = [{ type: 'oauth2', scopes: [...oauthScopes] }];
  assert.deepEqual(tool.securitySchemes, securitySchemes);
  assert.deepEqual(tool._meta, { securitySchemes, ui: { resourceUri: PROJECT_REVIEW_URI } });
  assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  for (const name of ['get_project', 'save_project']) {
    assert.equal((list.result.tools.find((item) => item.name === name)!._meta as Record<string, unknown>).ui, undefined);
  }

  const input = createInput();
  input.brief.facts = [{ id: crypto.randomUUID(), statement: 'Fictional supplied fact',
    source: { kind: 'url', url: 'https://example.com/lamp', captured_at: '2026-10-06T00:00:00Z' }, user_confirmed: false }];
  const saved = SaveProjectOutput.parse((await call('save_project', input, token)).result.structuredContent);
  assert.ok(saved.ok);
  const args = { project_id: saved.data.project.id };
  const shown = (await call('show_project_brief', args, token)).result;
  assert.notEqual(shown.isError, true);
  assert.deepEqual(GetProjectOutput.parse(shown.structuredContent), { ok: true, data: { project: saved.data.project } });
  assert.deepEqual(JSON.parse(shown.content[0]!.text), { project: saved.data.project }, 'complete text fallback includes every brief field, fact and version');
  const count = calls;
  const anonymous = (await call('show_project_brief', args)).result;
  assert.equal(anonymous.isError, true);
  assert.match(anonymous._meta!['mcp/www_authenticate']![0]!, /invalid_token/);
  const scope = (await call('show_project_brief', args, await identity.token({ riff_permissions: ['account:read'] }))).result;
  assert.equal(scope.isError, true);
  assert.match(scope._meta!['mcp/www_authenticate']![0]!, /insufficient_scope.*scope="openid"/);
  const injected = await call('show_project_brief', { ...args, account_id: 'caller-owned', brief: input.brief }, token);
  assert.ok(injected.error || injected.result?.isError, 'strict input rejects injected ownership/snapshot');
  assert.equal(calls, count, 'anonymous, scope-denied and malformed requests cannot touch storage');
  const expired = await rpc('tools/call', { name: 'show_project_brief', arguments: args }, auth,
    await identity.token({ exp: Math.floor(Date.now() / 1000) - 1 }));
  assert.equal(expired.status, 401);
  assert.match(expired.headers.get('www-authenticate')!, /invalid_token/);
  const otherToken = await identity.token({ sub: 'user-b' });
  const other = (await call('show_project_brief', args, otherToken)).result;
  const absent = (await call('show_project_brief', { project_id: crypto.randomUUID() }, otherToken)).result;
  assert.deepEqual(other, absent, 'another account cannot distinguish owned from missing IDs');
  assert.equal(other.isError, true);
  assert.equal('structuredContent' in other, false, 'errors must not violate success-only output schemas');
  assert.equal(other.content[0]!.text, 'This project is unavailable.');
  assert.ok(!JSON.stringify(other).includes(input.brief.product));

  const updated = SaveProjectOutput.parse((await call('save_project', { ...input, ...args,
    request_id: crypto.randomUUID(), expected_version: 1, brief: { ...input.brief, audience: 'Corrected fictional audience' } }, token)).result.structuredContent);
  assert.ok(updated.ok);
  for (const name of ['get_project', 'show_project_brief']) {
    const reopened = GetProjectOutput.parse((await call(name, args, token)).result.structuredContent);
    assert.deepEqual(reopened, { ok: true, data: { project: updated.data.project } });
  }
  assert.equal(updated.data.project.current_version, 2);

  const resources = await (await rpc('resources/list', {}, auth)).json() as { result: { resources: Record<string, unknown>[] } };
  assert.deepEqual(resources.result.resources.map((r) => [r.name, r.uri, r.mimeType]),
    [['riff-onboarding', RIFF_ONBOARDING_URI, RIFF_ONBOARDING_MIME],
      ['kettle-project-review', PROJECT_REVIEW_URI, PROJECT_REVIEW_MIME],
      ['riff-home', RIFF_HOME_URI, RIFF_HOME_MIME]]);
  assert.equal(resources.result.resources.find((r) => r.uri === PROJECT_REVIEW_URI)!.title, 'Riff project brief');
  const read = await (await rpc('resources/read', { uri: PROJECT_REVIEW_URI }, auth)).json() as {
    result: { contents: { uri: string; mimeType: string; text: string; _meta: unknown }[] };
  };
  const resource = read.result.contents[0]!;
  assert.equal(resource.mimeType, PROJECT_REVIEW_MIME);
  assert.deepEqual(resource._meta, PROJECT_REVIEW_META);
  assert.deepEqual((resource._meta as Record<string, unknown>)['openai/ui'], { availableDisplayModes: ['inline'] });
  assert.ok(!('availableDisplayModes' in PROJECT_REVIEW_META.ui));
  assert.match(resource.text, /<script>/);
  assert.match(resource.text, /<title>Riff project brief<\/title>/);
  assert.match(resource.text, /ui\/initialize/);
  assert.match(resource.text, /Your project brief/);
  assert.ok(!resource.text.includes(token));
  assert.ok(!resource.text.includes(saved.data.project.id));
  assert.ok(!resource.text.includes(input.brief.product));
  const another = await (await rpc('resources/read', { uri: PROJECT_REVIEW_URI }, auth, otherToken)).json();
  assert.deepEqual(another, read, 'static resource is independent of caller');
});

test('unconfigured auth exposes only the public diagnostic and no account resources', async () => {
  const listing = await (await rpc('tools/list', {})).json() as { result: { tools: { name: string }[] } };
  assert.deepEqual(listing.result.tools.map((t) => t.name), ['kettle_diagnostic']);
  const call = await (await rpc('tools/call', { name: 'show_project_brief', arguments: { project_id: crypto.randomUUID() } })).json() as { result?: { isError: boolean }; error?: unknown };
  assert.ok(call.error || call.result?.isError);
  const resource = await (await rpc('resources/read', { uri: PROJECT_REVIEW_URI })).json() as { error?: unknown };
  assert.ok(resource.error);
});

test('static HTML assembly escapes raw-text delimiters', () => {
  const html = projectReviewHtml('const sample = "</ScRiPt><script>bad()</script><!--";');
  assert.equal((html.match(/<script>/g) ?? []).length, 2); // one literal in a JS string, one actual opening tag
  assert.equal((html.match(/<\/script>/gi) ?? []).length, 1);
  assert.ok(!html.includes('<!--'));
});
