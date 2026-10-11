import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authConfig, isWebsiteAuthPath } from '../apps/worker/auth-config.ts';

const runtimeEnv = {
  SUPABASE_URL: 'https://project-ref.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-fixture',
  RIFF_MCP_RESOURCE: 'https://riff.example/mcp',
  RIFF_WEBSITE_ORIGIN: 'https://riff.example',
  RIFF_AUTH_COOKIE_SECRET: 'ab'.repeat(32),
} as unknown as Env;

test('runtime auth derives separate MCP and website policies from Supabase-only configuration', () => {
  assert.deepEqual(authConfig(runtimeEnv), {
    mcp: {
      issuer: 'https://project-ref.supabase.co/auth/v1',
      resource: 'https://riff.example/mcp',
    },
    website: {
      supabaseUrl: 'https://project-ref.supabase.co',
      publishableKey: 'sb_publishable_fixture',
      websiteOrigin: 'https://riff.example',
      sessionSecret: 'ab'.repeat(32),
    },
  });
  assert.equal(authConfig({
    AUTH_ISSUER: 'https://retired.example/', AUTH_AUDIENCE: 'https://riff.example/mcp',
    AUTH_CLIENT_ID: 'retired', AUTH_CLIENT_SECRET: 'retired', AUTH_SESSION_SECRET: 'ab'.repeat(32),
  } as unknown as Env), null, 'retired Auth0 variables must never enable auth');
  assert.equal(authConfig({ ...runtimeEnv, RIFF_MCP_RESOURCE: 'https://riff.example:443/mcp' } as unknown as Env), null,
    'the configured resource must equal the canonical website /mcp URL byte-for-byte');
});

test('worker route policy includes password, recovery, consent, sign-out and account surfaces', () => {
  const grantClientId = '11111111-1111-4111-8111-111111111111';
  for (const path of ['/auth/sign-in', '/auth/sign-up', '/auth/callback', '/auth/forgot-password',
    '/auth/update-password', '/auth/sign-out', '/oauth/consent?authorization_id=fixture', '/oauth/decision', '/account',
    `/account/oauth-grants/${grantClientId}/revoke`]) {
    assert.equal(isWebsiteAuthPath(new URL(`https://riff.example${path}`)), true, path);
  }
  for (const path of ['/auth/login', '/api/save_project', '/mcp', '/health',
    '/account/oauth-grants/not-a-uuid/revoke', `/account/oauth-grants/${grantClientId}/revoke/extra`]) {
    assert.equal(isWebsiteAuthPath(new URL(`https://riff.example${path}`)), false, path);
  }
});
