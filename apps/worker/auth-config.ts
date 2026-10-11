import { validateConfig, type AuthConfig } from '../../packages/auth/index.ts';
import type { SupabaseWebsiteConfig } from '../../packages/auth/website.ts';

export interface RuntimeAuthConfig {
  mcp: AuthConfig;
  website: SupabaseWebsiteConfig;
}

function canonicalOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/'
    || url.search || url.hash || url.origin !== value) throw new Error('Invalid origin');
  return url.origin;
}

export function authConfig(env: Env): RuntimeAuthConfig | null {
  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY,
    RIFF_MCP_RESOURCE, RIFF_WEBSITE_ORIGIN, RIFF_AUTH_COOKIE_SECRET } = env;
  if (![SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY,
    RIFF_MCP_RESOURCE, RIFF_WEBSITE_ORIGIN, RIFF_AUTH_COOKIE_SECRET].every((value) => typeof value === 'string' && value.length > 0)) return null;
  try {
    const supabaseOrigin = canonicalOrigin(SUPABASE_URL!);
    const websiteOrigin = canonicalOrigin(RIFF_WEBSITE_ORIGIN!);
    if (RIFF_MCP_RESOURCE !== `${websiteOrigin}/mcp`
      || !/^[a-f0-9]{64}$/i.test(RIFF_AUTH_COOKIE_SECRET!)) return null;
    const mcp = validateConfig({ issuer: `${supabaseOrigin}/auth/v1`, resource: RIFF_MCP_RESOURCE! });
    return {
      mcp,
      website: {
        supabaseUrl: supabaseOrigin,
        publishableKey: SUPABASE_PUBLISHABLE_KEY!,
        websiteOrigin,
        sessionSecret: RIFF_AUTH_COOKIE_SECRET!,
      },
    };
  } catch {
    return null;
  }
}

const websitePaths = new Set([
  '/auth/sign-in', '/auth/sign-up', '/auth/sign-out', '/auth/callback',
  '/auth/forgot-password', '/auth/update-password', '/oauth/consent',
  '/oauth/decision', '/account',
]);

const oauthGrantRevokePath = /^\/account\/oauth-grants\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/revoke$/i;

export function isWebsiteAuthPath(url: URL): boolean {
  return websitePaths.has(url.pathname) || oauthGrantRevokePath.test(url.pathname);
}
