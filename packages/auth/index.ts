import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import type { IdentityVerifier } from '../application/operations.ts';

/** OAuth scopes are protocol-level capabilities. Product authorization is
 * carried separately in the trusted `riff_permissions` access-token claim. */
export const oauthScopes = ['openid'] as const;
export const internalPermissions = ['account:read', 'projects:read', 'projects:write'] as const;
/** @deprecated Use internalPermissions. Kept while downstream Stage 2 fixtures migrate. */
export const scopes = internalPermissions;

export interface AuthConfig {
  issuer: string;
  resource: string;
  /** @deprecated Website auth now has a separate Supabase configuration. */
  clientId?: string;
  /** @deprecated Website auth now uses the publishable key, never an OAuth client secret. */
  clientSecret?: string;
  /** @deprecated Website cookie configuration is separate from MCP verification. */
  sessionSecret?: string;
}

export type IdentityResolver = (issuer: string, subject: string, issuedAt: number) => Promise<string | null>;

const metadataSchema = z.object({
  issuer: z.string(),
  jwks_uri: z.string(),
  authorization_endpoint: z.string(),
  token_endpoint: z.string(),
  registration_endpoint: z.string(),
  revocation_endpoint: z.string().optional(),
  token_endpoint_auth_methods_supported: z.array(z.string()).optional(),
  code_challenge_methods_supported: z.array(z.string()),
  authorization_response_iss_parameter_supported: z.boolean().optional(),
});
export type AuthMetadata = z.infer<typeof metadataSchema>;

export function secureUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) throw new Error('Invalid auth URL');
  return url;
}

export function validateConfig(config: AuthConfig): AuthConfig {
  const issuer = secureUrl(config.issuer);
  const resource = secureUrl(config.resource);
  if (issuer.pathname === '/' || issuer.pathname.endsWith('/') || resource.pathname !== '/mcp') {
    throw new Error('Incomplete auth configuration');
  }
  return config;
}

export async function readJsonBounded(response: Response, limit = 32_768): Promise<unknown> {
  if (!response.ok || !response.body) throw new Error('Upstream unavailable');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) throw new Error('Response too large');
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function discover(config: AuthConfig, fetcher: typeof fetch = fetch): Promise<AuthMetadata> {
  validateConfig(config);
  const discoveryUrl = new URL(`${config.issuer}/.well-known/openid-configuration`);
  const response = await fetcher(discoveryUrl, {
    redirect: 'manual',
    signal: AbortSignal.timeout(5000),
  });
  const metadata = metadataSchema.parse(await readJsonBounded(response));
  if (metadata.issuer !== config.issuer || !metadata.code_challenge_methods_supported.includes('S256')) {
    throw new Error('Unsupported issuer');
  }
  for (const endpoint of [metadata.jwks_uri, metadata.authorization_endpoint, metadata.token_endpoint,
    metadata.registration_endpoint, metadata.revocation_endpoint]) {
    if (endpoint && secureUrl(endpoint).origin !== new URL(config.issuer).origin) throw new Error('Foreign auth endpoint');
  }
  return metadata;
}

type VerificationKey = JWTVerifyGetKey | Parameters<typeof jwtVerify>[1];

function validLifetime(payload: { sub?: unknown; iat?: unknown; exp?: unknown }, now: number): boolean {
  return typeof payload.sub === 'string' && payload.sub.length > 0 && payload.sub.length <= 255
    && typeof payload.iat === 'number' && Number.isInteger(payload.iat) && payload.iat <= now
    && typeof payload.exp === 'number' && Number.isInteger(payload.exp) && payload.exp > payload.iat
    && payload.exp - payload.iat <= 3600;
}

async function verifyIdentity(
  token: string,
  config: AuthConfig,
  resolve: IdentityResolver,
  key: VerificationKey,
  audience: string,
  policy: 'mcp' | 'website',
): Promise<{ account_id: string; scopes: readonly string[] } | null> {
  try {
    if (token.length > 16_384) return null;
    const { payload, protectedHeader } = await jwtVerify(token, key, {
      issuer: config.issuer,
      audience,
      algorithms: ['ES256', 'RS256'],
      requiredClaims: ['sub', 'iat', 'exp', 'role'],
      clockTolerance: 0,
    });
    const now = Math.floor(Date.now() / 1000);
    if (!['JWT', 'at+jwt'].includes(protectedHeader.typ ?? 'JWT')
      || !validLifetime(payload, now)
      || payload.aud !== audience
      || payload.role !== 'authenticated'
      || ['client-credentials', 'client_credentials'].includes(String(payload.gty))
      || payload.sub?.endsWith('@clients')
      || (payload.token_use !== undefined && payload.token_use !== 'access')) return null;

    let permissions: readonly string[] = internalPermissions;
    if (policy === 'mcp') {
      if (typeof payload.client_id !== 'string' || payload.client_id.length === 0 || payload.client_id.length > 512
        || typeof payload.scope !== 'string' || payload.scope.length > 4096
        || !payload.scope.split(/\s+/).includes('openid')
        || !Array.isArray(payload.riff_permissions) || payload.riff_permissions.length === 0
        || payload.riff_permissions.some((permission) => typeof permission !== 'string'
          || !internalPermissions.includes(permission as (typeof internalPermissions)[number]))) return null;
      permissions = [...new Set(payload.riff_permissions as string[])];
    }

    const accountId = await resolve(config.issuer, payload.sub!, payload.iat!);
    return accountId ? { account_id: accountId, scopes: permissions } : null;
  } catch {
    return null;
  }
}

/** Verifies Supabase OAuth Server tokens presented to the canonical MCP resource. */
export function createMcpJwtVerifier(
  config: AuthConfig,
  resolve: IdentityResolver,
  key: VerificationKey,
): IdentityVerifier {
  validateConfig(config);
  return { verify: (token) => verifyIdentity(token, config, resolve, key, config.resource, 'mcp') };
}

/** Verifies ordinary Supabase Auth access tokens used by the first-party website. */
export function createWebsiteSessionVerifier(
  config: AuthConfig,
  resolve: IdentityResolver,
  key: VerificationKey,
): IdentityVerifier {
  validateConfig(config);
  return { verify: (token) => verifyIdentity(token, config, resolve, key, 'authenticated', 'website') };
}

/** @deprecated Prefer the policy-specific verifier. */
export function createJwtVerifier(
  config: AuthConfig,
  resolve: IdentityResolver,
  key: VerificationKey,
  requiredClientId?: string,
): IdentityVerifier {
  return requiredClientId
    ? createWebsiteSessionVerifier(config, resolve, key)
    : createMcpJwtVerifier(config, resolve, key);
}

export function remoteMcpVerifier(config: AuthConfig, metadata: AuthMetadata, resolve: IdentityResolver): IdentityVerifier {
  return createMcpJwtVerifier(config, resolve, createRemoteJWKSet(new URL(metadata.jwks_uri), { timeoutDuration: 5000 }));
}

export function remoteWebsiteSessionVerifier(config: AuthConfig, metadata: AuthMetadata, resolve: IdentityResolver): IdentityVerifier {
  return createWebsiteSessionVerifier(config, resolve, createRemoteJWKSet(new URL(metadata.jwks_uri), { timeoutDuration: 5000 }));
}

/** @deprecated Prefer remoteMcpVerifier or remoteWebsiteSessionVerifier. */
export function remoteVerifier(config: AuthConfig, metadata: AuthMetadata, resolve: IdentityResolver, requiredClientId?: string): IdentityVerifier {
  return requiredClientId
    ? remoteWebsiteSessionVerifier(config, metadata, resolve)
    : remoteMcpVerifier(config, metadata, resolve);
}

export function bearer(request: Request): string | null {
  const header = request.headers.get('authorization');
  const match = header?.match(/^Bearer ([A-Za-z0-9_\-.]+)$/i);
  return match?.[1] ?? null;
}

export function challenge(config: AuthConfig, error = 'invalid_token'): string {
  const requestedScope = error === 'insufficient_scope' ? `, scope="${oauthScopes.join(' ')}"` : '';
  return `Bearer resource_metadata="${new URL('/.well-known/oauth-protected-resource', config.resource)}", error="${error}", error_description="Connect or reauthorize your Riff account"${requestedScope}`;
}

export function protectedResource(config: AuthConfig) {
  validateConfig(config);
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: [...oauthScopes],
    bearer_methods_supported: ['header'],
  };
}
