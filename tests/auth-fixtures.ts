import assert from 'node:assert/strict';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import {
  createMcpJwtVerifier,
  createWebsiteSessionVerifier,
  internalPermissions,
  type AuthConfig,
} from '../packages/auth/index.ts';
import { accountA, accountB } from './fixtures.ts';
export const config: AuthConfig = { issuer: 'https://project-ref.supabase.co/auth/v1', resource: 'https://kettle.example/mcp',
  clientId: 'website-client', clientSecret: 'fixture-client-secret', sessionSecret: 'ab'.repeat(32) };
export const metadata = { issuer: config.issuer, jwks_uri: `${config.issuer}/.well-known/jwks.json`,
  authorization_endpoint: `${config.issuer}/oauth/authorize`, token_endpoint: `${config.issuer}/oauth/token`,
  registration_endpoint: `${config.issuer}/oauth/clients/register`,
  revocation_endpoint: `${config.issuer}/oauth/revoke`, code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
  authorization_response_iss_parameter_supported: true };
export async function fixtureAuth(mode: 'mcp' | 'website' = 'mcp') {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const jwk = await exportJWK(publicKey);
  const resolutions: string[] = [];
  let blocked = false;
  const resolve = async (issuer: string, subject: string) => {
    assert.equal(issuer, config.issuer); resolutions.push(subject);
    return blocked ? null : subject === 'user-a' ? accountA : accountB;
  };
  const key = createLocalJWKSet({ keys: [{ ...jwk, kid: 'test-key', alg: 'ES256' }] });
  const verifier = mode === 'website'
    ? createWebsiteSessionVerifier(config, resolve, key)
    : createMcpJwtVerifier(config, resolve, key);
  const token = (claims: Record<string, unknown> = {}) => {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ sub: 'user-a', iss: config.issuer,
      aud: mode === 'website' ? 'authenticated' : config.resource,
      iat: now, exp: now + 300, role: 'authenticated',
      ...(mode === 'mcp' ? { client_id: 'chatgpt-dcr-client', scope: 'openid offline_access', riff_permissions: [...internalPermissions] } : {}),
      ...claims }).setProtectedHeader({ alg: 'ES256', kid: 'test-key', typ: 'JWT' }).sign(privateKey);
  };
  return { verifier, token, resolutions, block: () => { blocked = true; } };
}
