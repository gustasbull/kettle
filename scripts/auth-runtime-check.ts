/** Test-only workerd cryptography proof. Never imported by the deployed Worker. */
import { generateKeyPair, SignJWT } from 'jose';
import { createMcpJwtVerifier, discover, internalPermissions, type AuthConfig } from '../packages/auth/index.ts';

export async function runAuthRuntimeCheck(): Promise<{ status: 'passed'; fixture: true }> {
  const config: AuthConfig = { issuer: 'https://fixture-idp.example/auth/v1', resource: 'https://fixture-kettle.example/mcp' };
  const metadata = { issuer: config.issuer, jwks_uri: `${config.issuer}/keys`, authorization_endpoint: `${config.issuer}/oauth/authorize`,
    token_endpoint: `${config.issuer}/oauth/token`, registration_endpoint: `${config.issuer}/oauth/clients/register`,
    code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] };
  // Construct real workerd Requests so unsupported fetch options cannot hide behind mocks.
  await discover(config, (async (input, init) => {
    const request = new Request(input, init);
    if (request.redirect !== 'manual') throw new Error('Discovery must not follow redirects');
    return Response.json(metadata);
  }) as typeof fetch);
  let redirectRejected = false;
  try { await discover(config, (async (input, init) => {
    new Request(input, init);
    return new Response(null, { status: 302, headers: { Location: 'https://untrusted.example/' } });
  }) as typeof fetch); } catch { redirectRejected = true; }
  if (!redirectRejected) throw new Error('Discovery redirect accepted');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ iss: config.issuer, sub: 'fictional-subject', aud: config.resource,
    role: 'authenticated', client_id: 'fictional-chatgpt-client', iat: now, exp: now + 300,
    scope: 'openid offline_access', riff_permissions: [...internalPermissions] })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' }).sign(privateKey);
  const verifier = createMcpJwtVerifier(config, async () => '11111111-1111-4111-8111-111111111111', publicKey);
  if (!await verifier.verify(token) || await verifier.verify(`${token}bad`)) throw new Error('JWT runtime proof failed');
  return { status: 'passed', fixture: true };
}
