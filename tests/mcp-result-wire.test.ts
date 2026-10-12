import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperations, failure } from '../packages/application/operations.ts';
import { handleMcp } from '../apps/worker/mcp.ts';
import { config, fixtureAuth } from './auth-fixtures.ts';
import { accountA } from './fixtures.ts';

test('account and profile tools publish safe text with the required profile compatibility fallback', async () => {
  const identity = await fixtureAuth();
  const token = await identity.token();
  const accountState = {
    ok: true as const,
    data: {
      account: {
        id: accountA,
        display_name: 'Fictional private display name',
        state: 'active' as const,
        preferred_language: 'en',
        created_at: '2026-10-11T08:00:00Z',
        onboarding_seen_at: null,
      },
      entitlements: { status: 'not_configured' as const },
      usage: { status: 'not_configured' as const, reset_at: null },
    },
  };
  const operations = createOperations(identity.verifier, {
    async call(operation) {
      if (operation === 'get_account_state') return accountState;
      if (operation === 'mark_riff_onboarding_seen') return {
        ok: true, data: { onboarding_seen_at: '2026-10-11T08:05:00Z' },
      };
      return failure('NOT_FOUND');
    },
  });
  const invoke = async (name: string, credential?: string, args: unknown = {}) => {
    const response = await handleMcp(new Request(config.resource, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    }), { config, verifier: identity.verifier, operations });
    return (await response.json() as { result: {
      structuredContent?: unknown;
      content: Array<{ text: string }>;
      isError?: boolean;
    } }).result;
  };

  const account = await invoke('get_account_state', token);
  assert.deepEqual(account.structuredContent, accountState);
  assert.equal(account.content[0]!.text,
    'Riff account is active; onboarding is not complete. Entitlements: not configured. Usage: not configured.');
  assert.ok(!account.content[0]!.text.includes(accountA));
  assert.ok(!account.content[0]!.text.includes(accountState.data.account.display_name));

  const onboarding = await invoke('mark_riff_onboarding_seen', token, { expected_account_id: accountA });
  assert.equal(onboarding.content[0]!.text, 'Riff onboarding is complete.');
  assert.deepEqual(onboarding.structuredContent,
    { ok: true, data: { onboarding_seen_at: '2026-10-11T08:05:00Z' } });

  const profile = await invoke('get_riff_profile', token);
  assert.deepEqual(profile.structuredContent, { id: accountA, name: accountState.data.account.display_name });
  assert.deepEqual(JSON.parse(profile.content[0]!.text), profile.structuredContent,
    'OpenAI profile compatibility requires the same profile as JSON text');

  for (const name of ['get_account_state', 'get_riff_profile']) {
    const denied = await invoke(name);
    assert.equal(denied.isError, true);
    assert.equal(denied.content[0]!.text,
      'Riff request failed (UNAUTHENTICATED). Connect or reauthorize your Riff account.');
    assert.ok(!denied.content[0]!.text.startsWith('{'));
  }
});

test('open_riff summarizes failure text without dropping structured errors or auth challenges', async () => {
  const identity = await fixtureAuth();
  const token = await identity.token();
  const privateMessage = 'private repository detail';
  const repositoryFailure = {
    ok: false as const,
    error: {
      code: 'FORBIDDEN' as const,
      message: privateMessage,
      retryable: false,
      recovery: 'contact_support' as const,
    },
  };
  const operations = createOperations(identity.verifier, {
    async call() { return repositoryFailure; },
  });
  const invoke = async (credential?: string) => {
    const response = await handleMcp(new Request(config.resource, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'open_riff', arguments: {} },
      }),
    }), { config, verifier: identity.verifier, operations });
    return (await response.json() as { result: {
      structuredContent?: unknown;
      content: Array<{ text: string }>;
      isError?: boolean;
      _meta?: Record<string, string[]>;
    } }).result;
  };

  const forbidden = await invoke(token);
  assert.equal(forbidden.isError, true);
  assert.deepEqual(forbidden.structuredContent, repositoryFailure);
  assert.equal(forbidden.content[0]!.text,
    'Riff request failed (FORBIDDEN). This action is not permitted for this account.');
  assert.ok(!forbidden.content[0]!.text.includes(privateMessage));

  const anonymous = await invoke();
  assert.equal(anonymous.isError, true);
  assert.deepEqual(anonymous.structuredContent, failure('UNAUTHENTICATED'));
  assert.match(anonymous._meta!['mcp/www_authenticate']![0]!, /invalid_token/);
});
