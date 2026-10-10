import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import {
  createMcpVerifierForRequest,
  createRemoteAuthInputsCache,
  memoizeVerifierForRequest,
} from '../apps/worker/auth-runtime.ts';
import { internalPermissions, type AuthConfig } from '../packages/auth/index.ts';
import type { IdentityVerifier } from '../packages/application/operations.ts';
import { accountA } from './fixtures.ts';

const configFor = (name: string): AuthConfig => ({
  issuer: `https://${name}.supabase.co/auth/v1`,
  resource: `https://${name}.example/mcp`,
});

const metadataFor = (config: AuthConfig) => ({
  issuer: config.issuer,
  jwks_uri: `${config.issuer}/.well-known/jwks.json`,
  authorization_endpoint: `${config.issuer}/oauth/authorize`,
  token_endpoint: `${config.issuer}/oauth/token`,
  registration_endpoint: `${config.issuer}/oauth/clients/register`,
  code_challenge_methods_supported: ['S256'],
});

test('remote auth inputs coalesce concurrent reads, expire, and stay bounded by configuration', async () => {
  let now = 1_000;
  const calls = new Map<string, number>();
  const configs = [configFor('cache-a'), configFor('cache-b')];
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.set(url, (calls.get(url) ?? 0) + 1);
    const config = configs.find(candidate => url === `${candidate.issuer}/.well-known/openid-configuration`);
    assert.ok(config, `unexpected discovery request ${url}`);
    return Response.json(metadataFor(config));
  }) as typeof fetch;
  const cache = createRemoteAuthInputsCache({
    ttlMilliseconds: 100,
    maxEntries: 1,
    now: () => now,
  });

  const [first, concurrent] = await Promise.all([
    cache.get(configs[0]!, fetcher),
    cache.get(configs[0]!, fetcher),
  ]);
  assert.strictEqual(first, concurrent, 'one validated metadata/key object is shared during its TTL');
  assert.equal(calls.get(`${configs[0]!.issuer}/.well-known/openid-configuration`), 1);

  await cache.get(configs[1]!, fetcher);
  await cache.get(configs[0]!, fetcher);
  assert.equal(calls.get(`${configs[0]!.issuer}/.well-known/openid-configuration`), 2,
    'the oldest configuration is evicted when the bound is reached');

  now += 101;
  const refreshed = await cache.get(configs[0]!, fetcher);
  assert.notStrictEqual(refreshed, first);
  assert.equal(calls.get(`${configs[0]!.issuer}/.well-known/openid-configuration`), 3,
    'expired discovery and key material is rebuilt');
});

test('failed or foreign discovery is never retained in the remote auth cache', async () => {
  const config = configFor('cache-failure');
  const cache = createRemoteAuthInputsCache();
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    return Response.json(calls === 1
      ? { ...metadataFor(config), issuer: 'https://foreign.example/auth/v1' }
      : metadataFor(config));
  }) as typeof fetch;

  await assert.rejects(cache.get(config, fetcher), /Unsupported issuer/);
  assert.deepEqual((await cache.get(config, fetcher)).metadata, metadataFor(config));
  assert.equal(calls, 2, 'a failed validation is retried rather than served from cache');
});

test('request verifier memoizes only its bearer and a new request rechecks revocation', async () => {
  let calls = 0;
  let revoked = false;
  const underlying: IdentityVerifier = {
    async verify(credential) {
      calls += 1;
      return credential === 'valid' && !revoked
        ? { account_id: accountA, scopes: [...internalPermissions] }
        : null;
    },
  };

  const firstRequest = memoizeVerifierForRequest(underlying);
  assert.deepEqual(await firstRequest.verify('valid'), {
    account_id: accountA,
    scopes: [...internalPermissions],
  });
  assert.deepEqual(await firstRequest.verify('valid'), {
    account_id: accountA,
    scopes: [...internalPermissions],
  });
  assert.equal(calls, 1, 'the HTTP gate and operation share one verification result');

  revoked = true;
  assert.equal(await memoizeVerifierForRequest(underlying).verify('valid'), null);
  assert.equal(calls, 2, 'a later request cannot reuse identity or revocation state');
});

test('request verifiers reuse discovery and JWKS but reject invalid and expired credentials', async () => {
  const config = configFor('runtime-cache');
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const jwk = { ...await exportJWK(publicKey), kid: 'runtime-key', alg: 'ES256' };
  const calls = { discovery: 0, jwks: 0, identity: 0 };
  let revoked = false;
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url === `${config.issuer}/.well-known/openid-configuration`) {
      calls.discovery += 1;
      return Response.json(metadataFor(config));
    }
    if (url === `${config.issuer}/.well-known/jwks.json`) {
      calls.jwks += 1;
      return Response.json({ keys: [jwk] });
    }
    throw new Error(`unexpected request ${url}`);
  }) as typeof fetch;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetcher;
  try {
    const now = Math.floor(Date.now() / 1000);
    const sign = (claims: Record<string, unknown> = {}) => new SignJWT({
      iss: config.issuer,
      sub: 'runtime-user',
      aud: config.resource,
      iat: now,
      exp: now + 300,
      role: 'authenticated',
      client_id: 'chatgpt-client',
      scope: 'openid',
      riff_permissions: [...internalPermissions],
      ...claims,
    }).setProtectedHeader({ alg: 'ES256', kid: 'runtime-key', typ: 'JWT' }).sign(privateKey);
    const valid = await sign();
    const expired = await sign({ iat: now - 600, exp: now - 300 });
    const resolve = async () => {
      calls.identity += 1;
      return revoked ? null : accountA;
    };
    const cache = createRemoteAuthInputsCache();

    const expiredRequest = createMcpVerifierForRequest(config, resolve, cache);
    assert.deepEqual(calls, { discovery: 0, jwks: 0, identity: 0 },
      'building an unauthenticated request graph performs no remote auth work');
    assert.equal(await expiredRequest.verify(expired), null);
    const invalidRequest = createMcpVerifierForRequest(config, resolve, cache);
    assert.equal(await invalidRequest.verify('eyJhbGciOiJub25lIn0.e30.'), null);
    const firstRequest = createMcpVerifierForRequest(config, resolve, cache);
    assert.deepEqual(await firstRequest.verify(valid), {
      account_id: accountA,
      scopes: [...internalPermissions],
    });
    assert.deepEqual(await firstRequest.verify(valid), {
      account_id: accountA,
      scopes: [...internalPermissions],
    });
    assert.deepEqual(calls, { discovery: 1, jwks: 1, identity: 1 });

    revoked = true;
    const secondRequest = createMcpVerifierForRequest(config, resolve, cache);
    assert.equal(await secondRequest.verify(valid), null);
    assert.deepEqual(calls, { discovery: 1, jwks: 1, identity: 2 },
      'public verification inputs are shared, while account mapping is checked per request');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
