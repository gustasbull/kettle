import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import {
  createMcpJwtVerifier,
  createWebsiteSessionVerifier,
  discover,
  internalPermissions,
  oauthScopes,
  protectedResource,
  type AuthConfig,
} from '../packages/auth/index.ts';
import { accountA } from './fixtures.ts';

const config: AuthConfig = {
  issuer: 'https://project-ref.supabase.co/auth/v1',
  resource: 'https://riff.example/mcp',
};

async function fixture() {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const jwk = await exportJWK(publicKey);
  const key = createLocalJWKSet({ keys: [{ ...jwk, kid: 'supabase-key', alg: 'ES256' }] });
  const resolutions: Array<{ issuer: string; subject: string }> = [];
  const resolve = async (issuer: string, subject: string) => {
    resolutions.push({ issuer, subject });
    return accountA;
  };
  const sign = (claims: Record<string, unknown>) => {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      iss: config.issuer,
      sub: 'supabase-user-a',
      iat: now,
      exp: now + 300,
      role: 'authenticated',
      ...claims,
    }).setProtectedHeader({ alg: 'ES256', kid: 'supabase-key', typ: 'JWT' }).sign(privateKey);
  };
  return {
    resolutions,
    mcp: createMcpJwtVerifier(config, resolve, key),
    website: createWebsiteSessionVerifier(config, resolve, key),
    mcpToken: (claims: Record<string, unknown> = {}) => sign({
      aud: config.resource,
      client_id: 'chatgpt-dcr-client',
      scope: 'openid offline_access',
      riff_permissions: [...internalPermissions],
      ...claims,
    }),
    websiteToken: (claims: Record<string, unknown> = {}) => sign({ aud: 'authenticated', ...claims }),
  };
}

test('Supabase MCP and website JWT policies are intentionally distinct', async () => {
  const auth = await fixture();
  const mcpToken = await auth.mcpToken();
  const websiteToken = await auth.websiteToken();
  assert.deepEqual(await auth.mcp.verify(mcpToken), { account_id: accountA, scopes: [...internalPermissions] });
  assert.equal(await auth.website.verify(mcpToken), null);
  assert.deepEqual(await auth.website.verify(websiteToken), { account_id: accountA, scopes: [...internalPermissions] });
  assert.equal(await auth.mcp.verify(websiteToken), null);
  assert.equal(await auth.website.verify(await auth.websiteToken({ aud: ['authenticated', config.resource] })), null);
});

test('MCP rejects unbound, anonymous, malformed, and unpermissioned tokens before identity mapping', async () => {
  const auth = await fixture();
  for (const claims of [
    { aud: 'authenticated' },
    { aud: 'https://other.example/mcp' },
    { aud: [config.resource, 'https://other.example/mcp'] },
    { client_id: undefined },
    { client_id: '' },
    { role: 'anon' },
    { scope: 'offline_access' },
    { riff_permissions: undefined },
    { riff_permissions: [] },
    { riff_permissions: ['account:read', 'admin'] },
  ]) {
    assert.equal(await auth.mcp.verify(await auth.mcpToken(claims)), null, JSON.stringify(claims));
  }
  assert.equal(auth.resolutions.length, 0);
});

test('Supabase discovery uses the pathful issuer and accepts public-client metadata', async () => {
  const metadata = {
    issuer: config.issuer,
    jwks_uri: `${config.issuer}/.well-known/jwks.json`,
    authorization_endpoint: `${config.issuer}/oauth/authorize`,
    token_endpoint: `${config.issuer}/oauth/token`,
    registration_endpoint: `${config.issuer}/oauth/clients/register`,
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
  };
  const result = await discover(config, (async (url, init) => {
    assert.equal(String(url), `${config.issuer}/.well-known/openid-configuration`);
    assert.equal(init?.redirect, 'manual');
    return Response.json(metadata);
  }) as typeof fetch);
  assert.deepEqual(result, metadata);
  assert.deepEqual(protectedResource(config), {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: [...oauthScopes],
    bearer_methods_supported: ['header'],
  });
  await assert.rejects(discover(config, (async () => Response.json({
    ...metadata, registration_endpoint: undefined,
  })) as typeof fetch));
});
