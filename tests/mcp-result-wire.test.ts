import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperations, failure } from '../packages/application/operations.ts';
import { handleMcp } from '../apps/worker/mcp.ts';
import { config, fixtureAuth } from './auth-fixtures.ts';
import { accountA } from './fixtures.ts';

test('account and profile tools keep full data in structuredContent and publish concise safe text', async () => {
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
  const invoke = async (name: string, credential?: string) => {
    const response = await handleMcp(new Request(config.resource, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } }),
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

  const onboarding = await invoke('mark_riff_onboarding_seen', token);
  assert.equal(onboarding.content[0]!.text, 'Riff onboarding is complete.');
  assert.deepEqual(onboarding.structuredContent,
    { ok: true, data: { onboarding_seen_at: '2026-10-11T08:05:00Z' } });

  const profile = await invoke('get_riff_profile', token);
  assert.deepEqual(profile.structuredContent, { id: accountA, name: accountState.data.account.display_name });
  assert.equal(profile.content[0]!.text, 'Riff profile is connected.');
  assert.ok(!profile.content[0]!.text.includes(accountA));
  assert.ok(!profile.content[0]!.text.includes(accountState.data.account.display_name));

  for (const name of ['get_account_state', 'get_riff_profile']) {
    const denied = await invoke(name);
    assert.equal(denied.isError, true);
    assert.equal(denied.content[0]!.text,
      'Riff request failed (UNAUTHENTICATED). Connect or reauthorize your Riff account.');
    assert.ok(!denied.content[0]!.text.startsWith('{'));
  }
});
