import { EncryptJWT, jwtDecrypt } from 'jose';
import { createClient, type SupabaseClient, type SupportedStorage } from '@supabase/supabase-js';
import { z } from 'zod';

const SESSION_COOKIE = '__Host-riff-session';
const TRANSACTION_COOKIE = '__Host-riff-transaction';
const SESSION_TTL_SECONDS = 60 * 60;
const FORM_TRANSACTION_TTL_SECONDS = 15 * 60;
const EMAIL_CALLBACK_TTL_SECONDS = 60 * 60;
const MAX_FORM_BYTES = 16 * 1024;
const SUPABASE_STORAGE_KEY = 'riff-website-auth';
const PKCE_VERIFIER_KEY = `${SUPABASE_STORAGE_KEY}-code-verifier`;

export interface SupabaseWebsiteConfig {
  supabaseUrl: string;
  publishableKey: string;
  websiteOrigin: string;
  /** 32-byte key encoded as 64 hexadecimal characters. */
  sessionSecret: string;
}

export interface SupabaseWebsiteSession {
  accessToken: string;
  refreshToken?: string;
  userId: string;
}

export interface SupabaseOAuthGrant {
  clientId: string;
  clientName: string;
  scopes: string[];
  grantedAt: string;
}

export interface SupabaseWebsiteAccount {
  id: string;
  displayName: string;
  state: 'active' | 'suspended';
}

export type SupabaseWebsiteAccountReader = (
  session: SupabaseWebsiteSession,
) => Promise<SupabaseWebsiteAccount>;

export type SupabaseAuthorizationDetails =
  | { redirectUrl: string; session: SupabaseWebsiteSession }
  | {
    authorizationId: string;
    clientName: string;
    redirectUri: string;
    scope: string;
    session: SupabaseWebsiteSession;
  };

/**
 * Narrow boundary around Supabase Auth. The Worker integration may adapt a
 * request-scoped `@supabase/ssr`/`@supabase/supabase-js` client to this shape;
 * website code never receives a service-role credential.
 */
export interface SupabaseWebsiteAuthClient {
  signUp(input: { email: string; password: string; emailRedirectTo: string }): Promise<{
    confirmationRequired: boolean;
    session?: SupabaseWebsiteSession;
    flowId?: string;
  }>;
  signInWithPassword(input: { email: string; password: string }): Promise<{ session: SupabaseWebsiteSession }>;
  exchangeCodeForSession(input: { code: string; flowId?: string }): Promise<{ session: SupabaseWebsiteSession }>;
  requestPasswordRecovery(input: { email: string; redirectTo: string }): Promise<{ flowId?: string }>;
  updatePassword(input: { session: SupabaseWebsiteSession; password: string }): Promise<void>;
  signOut(input: { session: SupabaseWebsiteSession }): Promise<void>;
  getAuthorizationDetails(input: {
    session: SupabaseWebsiteSession;
    authorizationId: string;
  }): Promise<SupabaseAuthorizationDetails>;
  approveAuthorization(input: {
    session: SupabaseWebsiteSession;
    authorizationId: string;
  }): Promise<{ redirectUrl: string; session: SupabaseWebsiteSession }>;
  denyAuthorization(input: {
    session: SupabaseWebsiteSession;
    authorizationId: string;
  }): Promise<{ redirectUrl: string; session: SupabaseWebsiteSession }>;
  listGrants(input: {
    session: SupabaseWebsiteSession;
  }): Promise<{ grants: SupabaseOAuthGrant[]; session: SupabaseWebsiteSession }>;
  revokeGrant(input: {
    session: SupabaseWebsiteSession;
    clientId: string;
  }): Promise<{ session: SupabaseWebsiteSession }>;
}

const oauthGrantSchema = z.object({
  client: z.object({
    id: z.string().uuid(),
    name: z.string().min(1).max(512),
  }),
  scopes: z.array(z.string().min(1).max(128)).max(64),
  granted_at: z.string().min(1).max(128),
});

const websiteAccountSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().trim().min(1).max(120),
  state: z.enum(['active', 'suspended']),
});

class TransientSupabaseStorage implements SupportedStorage {
  private readonly values = new Map<string, string>();

  constructor(entries: Record<string, string> = {}) {
    for (const [name, value] of Object.entries(entries)) this.values.set(name, value);
  }

  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

function validatedPkceContinuation(value: string | undefined) {
  if (!value || value.length > 512) throw new Error('Missing PKCE continuation');
  let verifier: unknown;
  try { verifier = JSON.parse(value); } catch { throw new Error('Invalid PKCE continuation'); }
  if (typeof verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,256}(?:\/recovery)?$/.test(verifier)) {
    throw new Error('Invalid PKCE continuation');
  }
  return value;
}

function sdkSession(value: {
  access_token: string;
  refresh_token: string;
  user: { id: string };
}): SupabaseWebsiteSession {
  return normalizeSession({
    accessToken: value.access_token,
    refreshToken: value.refresh_token,
    userId: value.user.id,
  });
}

/**
 * Production adapter for Supabase Auth. Every operation gets an isolated SDK
 * client so concurrent Worker requests cannot share mutable auth state. PKCE
 * verifier state is only persisted inside the encrypted transaction cookie.
 */
export function createSupabaseWebsiteAuthClient(
  rawConfig: SupabaseWebsiteConfig,
  fetcher: typeof fetch = fetch,
): SupabaseWebsiteAuthClient {
  const config = validateConfig(rawConfig);
  const sdk = (storage = new TransientSupabaseStorage()): SupabaseClient => createClient(
    config.supabaseUrl,
    config.publishableKey,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        flowType: 'pkce',
        persistSession: true,
        storage,
        storageKey: SUPABASE_STORAGE_KEY,
      },
      global: { fetch: fetcher },
    },
  );
  const withSession = async (websiteSession: SupabaseWebsiteSession) => {
    const normalized = normalizeSession(websiteSession);
    if (!normalized.refreshToken) throw new Error('Supabase refresh token required');
    const client = sdk();
    const { data, error } = await client.auth.setSession({
      access_token: normalized.accessToken,
      refresh_token: normalized.refreshToken,
    });
    if (error || !data.session) throw error ?? new Error('Supabase session unavailable');
    const verified = sdkSession(data.session);
    if (verified.userId !== normalized.userId) throw new Error('Supabase session identity changed');
    return { client, session: verified };
  };
  const consent = async (
    action: 'approve' | 'deny',
    input: { session: SupabaseWebsiteSession; authorizationId: string },
  ) => {
    const { client, session } = await withSession(input.session);
    const result = action === 'approve'
      ? await client.auth.oauth.approveAuthorization(input.authorizationId, { skipBrowserRedirect: true })
      : await client.auth.oauth.denyAuthorization(input.authorizationId, { skipBrowserRedirect: true });
    if (result.error || !result.data?.redirect_url) {
      throw result.error ?? new Error('Supabase authorization response unavailable');
    }
    return { redirectUrl: result.data.redirect_url, session };
  };

  return {
    async signUp(input) {
      const storage = new TransientSupabaseStorage();
      const { data, error } = await sdk(storage).auth.signUp({
        email: input.email,
        password: input.password,
        options: { emailRedirectTo: input.emailRedirectTo },
      });
      if (error) throw error;
      if (data.session) return { confirmationRequired: false, session: sdkSession(data.session) };
      const continuation = storage.getItem(PKCE_VERIFIER_KEY);
      return {
        confirmationRequired: true,
        ...(continuation ? { flowId: validatedPkceContinuation(continuation) } : {}),
      };
    },
    async signInWithPassword(input) {
      const { data, error } = await sdk().auth.signInWithPassword({ email: input.email, password: input.password });
      if (error || !data.session) throw error ?? new Error('Supabase session unavailable');
      return { session: sdkSession(data.session) };
    },
    async exchangeCodeForSession(input) {
      const storage = new TransientSupabaseStorage({
        [PKCE_VERIFIER_KEY]: validatedPkceContinuation(input.flowId),
      });
      const { data, error } = await sdk(storage).auth.exchangeCodeForSession(input.code);
      if (error || !data.session) throw error ?? new Error('Supabase session unavailable');
      return { session: sdkSession(data.session) };
    },
    async requestPasswordRecovery(input) {
      const storage = new TransientSupabaseStorage();
      const { error } = await sdk(storage).auth.resetPasswordForEmail(input.email, { redirectTo: input.redirectTo });
      if (error) throw error;
      return { flowId: validatedPkceContinuation(storage.getItem(PKCE_VERIFIER_KEY) ?? undefined) };
    },
    async updatePassword(input) {
      const { client } = await withSession(input.session);
      const { error } = await client.auth.updateUser({ password: input.password });
      if (error) throw error;
    },
    async signOut(input) {
      const { client } = await withSession(input.session);
      // Revoke only this website session. A global sign-out would also tear
      // down independent sessions, including the user's ChatGPT OAuth grant.
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw error;
    },
    async getAuthorizationDetails(input) {
      const { client, session } = await withSession(input.session);
      const { data, error } = await client.auth.oauth.getAuthorizationDetails(input.authorizationId);
      if (error || !data) throw error ?? new Error('Supabase authorization details unavailable');
      if ('redirect_url' in data) return { redirectUrl: data.redirect_url, session };
      return {
        authorizationId: data.authorization_id,
        clientName: data.client.name,
        redirectUri: data.redirect_uri,
        scope: data.scope,
        session,
      };
    },
    approveAuthorization: (input) => consent('approve', input),
    denyAuthorization: (input) => consent('deny', input),
    async listGrants(input) {
      const { client, session } = await withSession(input.session);
      const { data, error } = await client.auth.oauth.listGrants();
      if (error || !data) throw error ?? new Error('Supabase OAuth grants unavailable');
      const grants = z.array(oauthGrantSchema).max(256).parse(data).map((grant) => ({
        clientId: grant.client.id,
        clientName: grant.client.name,
        scopes: grant.scopes,
        grantedAt: grant.granted_at,
      }));
      return { grants, session };
    },
    async revokeGrant(input) {
      const clientId = z.string().uuid().parse(input.clientId);
      const { client, session } = await withSession(input.session);
      const { error } = await client.auth.oauth.revokeGrant({ clientId });
      if (error) throw error;
      return { session };
    },
  };
}

const storedSessionSchema = z.object({
  accessToken: z.string().min(1).max(16_000),
  refreshToken: z.string().min(1).max(4_000).optional(),
  userId: z.string().min(1).max(255),
  kind: z.enum(['website', 'recovery']),
});

const transactionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('form'),
    csrf: z.string().length(43),
    returnTo: z.string().min(1).max(2_048),
  }),
  z.object({
    kind: z.literal('callback'),
    flow: z.enum(['confirmation', 'recovery']),
    flowId: z.string().min(1).max(512).optional(),
    returnTo: z.string().min(1).max(2_048),
  }),
  z.object({
    kind: z.literal('decision'),
    csrf: z.string().length(43),
    authorizationId: z.string().min(1).max(512),
    redirectUri: z.string().min(1).max(512),
  }),
]);

type StoredSession = z.infer<typeof storedSessionSchema>;
type Transaction = z.infer<typeof transactionSchema>;

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]!));

const base64 = (value: Uint8Array) => btoa(String.fromCharCode(...value))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = () => base64(crypto.getRandomValues(new Uint8Array(32)));

function validateConfig(config: SupabaseWebsiteConfig): SupabaseWebsiteConfig {
  const supabase = new URL(config.supabaseUrl);
  const website = new URL(config.websiteOrigin);
  if (supabase.protocol !== 'https:' || supabase.username || supabase.password || supabase.search || supabase.hash
    || website.protocol !== 'https:' || website.username || website.password || website.pathname !== '/'
    || website.search || website.hash || website.origin !== config.websiteOrigin
    || !config.publishableKey || config.publishableKey.length > 4_096
    || !/^[a-f0-9]{64}$/i.test(config.sessionSecret)) {
    throw new Error('Incomplete Supabase website configuration');
  }
  return config;
}

const key = (config: SupabaseWebsiteConfig) => Uint8Array.from(
  config.sessionSecret.match(/../g)!, (byte) => Number.parseInt(byte, 16),
);

async function seal(config: SupabaseWebsiteConfig, value: Record<string, unknown>, purpose: string, ttl: number) {
  return new EncryptJWT(value)
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuer(config.websiteOrigin)
    .setAudience(purpose)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .encrypt(key(config));
}

async function unseal(config: SupabaseWebsiteConfig, value: string, purpose: string) {
  if (!value || value.length > 7_000) throw new Error('Missing sealed value');
  return (await jwtDecrypt(value, key(config), {
    issuer: config.websiteOrigin,
    audience: purpose,
    keyManagementAlgorithms: ['dir'],
    contentEncryptionAlgorithms: ['A256GCM'],
    requiredClaims: ['iat', 'exp'],
  })).payload;
}

function cookie(name: string, value: string, ttl: number) {
  if (value.length > 3_800) throw new Error('Cookie value too large');
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ttl}`;
}

function readCookie(request: Request, name: string) {
  const matches = (request.headers.get('cookie') ?? '').split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  return matches.length === 1 ? matches[0]!.slice(name.length + 1) : '';
}

async function readSession(request: Request, config: SupabaseWebsiteConfig): Promise<StoredSession> {
  return storedSessionSchema.parse(await unseal(config, readCookie(request, SESSION_COOKIE), 'riff-website-session'));
}

async function readTransaction(request: Request, config: SupabaseWebsiteConfig): Promise<Transaction> {
  return transactionSchema.parse(await unseal(config, readCookie(request, TRANSACTION_COOKIE), 'riff-website-transaction'));
}

function publicSession(session: StoredSession): SupabaseWebsiteSession {
  return {
    accessToken: session.accessToken,
    ...(session.refreshToken ? { refreshToken: session.refreshToken } : {}),
    userId: session.userId,
  };
}

function normalizeSession(value: SupabaseWebsiteSession): SupabaseWebsiteSession {
  return publicSession(storedSessionSchema.pick({
    accessToken: true, refreshToken: true, userId: true,
  }).parse(value) as StoredSession);
}

function safeReturnPath(value: string | null | undefined, config: SupabaseWebsiteConfig, fallback = '/account') {
  if (!value || value.length > 2_048 || !value.startsWith('/') || value.startsWith('//')
    || value.includes('\\') || /[\r\n]/.test(value)) return fallback;
  try {
    const parsed = new URL(value, config.websiteOrigin);
    if (parsed.origin !== config.websiteOrigin || parsed.hash) return fallback;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return fallback;
  }
}

function chatGptRedirectUri(value: string) {
  if (!/^https:\/\/chatgpt\.com\/(?:connector_platform_oauth_redirect|connector\/oauth\/[A-Za-z0-9._~-]{1,128})$/.test(value)) {
    throw new Error('Unexpected OAuth client redirect');
  }
  const redirect = new URL(value);
  if (redirect.origin !== 'https://chatgpt.com' || redirect.username || redirect.password || redirect.port
    || redirect.search || redirect.hash || redirect.href !== value) throw new Error('Unexpected OAuth client redirect');
  return redirect.href;
}

function providerRedirect(value: string, expectedBase?: string) {
  if (!value || value.length > 4_096) throw new Error('Unsafe provider redirect');
  const redirect = new URL(value);
  const base = `${redirect.origin}${redirect.pathname}`;
  chatGptRedirectUri(base);
  if (redirect.username || redirect.password || redirect.port || redirect.hash
    || (expectedBase && base !== chatGptRedirectUri(expectedBase))) {
    throw new Error('Unsafe provider redirect');
  }
  return redirect.href;
}

async function equalSecret(left: string, right: string) {
  if (!left || !right || left.length !== right.length) return false;
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const hmac = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const signed = await crypto.subtle.sign('HMAC', hmac, new TextEncoder().encode(left));
  return crypto.subtle.verify('HMAC', hmac, signed, new TextEncoder().encode(right));
}

function sameOriginPost(request: Request, config: SupabaseWebsiteConfig) {
  return request.method === 'POST'
    && request.headers.get('origin') === config.websiteOrigin
    && !['cross-site', 'none'].includes(request.headers.get('sec-fetch-site') ?? '');
}

async function readForm(request: Request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/x-www-form-urlencoded')) {
    throw new Error('Expected form encoding');
  }
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_FORM_BYTES) throw new Error('Form too large');
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_FORM_BYTES) throw new Error('Form too large');
  return new URLSearchParams(body);
}

function one(form: URLSearchParams, name: string, maximum: number) {
  const values = form.getAll(name);
  if (values.length !== 1) throw new Error(`Invalid ${name}`);
  const value = values[0]!.trim();
  if (!value || value.length > maximum) throw new Error(`Invalid ${name}`);
  return value;
}

function responseHeaders() {
  return new Headers({
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    'Content-Type': 'text/html; charset=utf-8',
    'Referrer-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
  });
}

const pageStyles = `<style>
:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#24262b;background:#f4f5f7;color-scheme:light}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}
main{width:min(100%,430px);padding:32px;border:1px solid #e2e5ea;border-radius:24px;background:#fff;box-shadow:0 18px 48px rgba(28,35,48,.08)}
h1{margin:0 0 8px;font-size:30px;letter-spacing:-.035em}p{color:#656b75;line-height:1.55}label{display:grid;gap:6px;margin-top:18px;font-weight:650}
input{width:100%;min-height:46px;padding:10px 12px;border:1px solid #cfd4dc;border-radius:12px;font:inherit}button{min-height:46px;margin-top:22px;padding:10px 18px;border:0;border-radius:999px;background:#3865f8;color:#fff;font:inherit;font-weight:700;cursor:pointer}
.actions{display:flex;gap:10px;flex-wrap:wrap}.actions button[value=deny]{color:#24262b;background:#eef0f3}a{color:#3157d9}.status{padding:12px;border-radius:12px;background:#f1f4ff;color:#33436d}
</style>`;

function htmlPage(title: string, content: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>${pageStyles}</head><body><main>${content}</main></body></html>`;
}

function html(body: string, status = 200, headers = responseHeaders()) {
  return new Response(body, { status, headers });
}

function redirect(location: string, headers = responseHeaders()) {
  headers.delete('Content-Type');
  headers.set('Location', location);
  return new Response(null, { status: 303, headers });
}

function clearAuthCookies(headers: Headers) {
  headers.append('Set-Cookie', cookie(SESSION_COOKIE, '', 0));
  headers.append('Set-Cookie', cookie(TRANSACTION_COOKIE, '', 0));
}

function sessionCookie(session: SupabaseWebsiteSession, kind: StoredSession['kind']) {
  const normalized = normalizeSession(session);
  return { ...normalized, kind };
}

async function setSessionCookie(
  headers: Headers,
  config: SupabaseWebsiteConfig,
  session: SupabaseWebsiteSession,
  kind: StoredSession['kind'] = 'website',
) {
  headers.append('Set-Cookie', cookie(SESSION_COOKIE,
    await seal(config, sessionCookie(session, kind), 'riff-website-session', SESSION_TTL_SECONDS), SESSION_TTL_SECONDS));
}

function authPath(path: string, parameters: Record<string, string>) {
  return `${path}?${new URLSearchParams(parameters)}`;
}

const OAUTH_GRANT_REVOKE_PATH = /^\/account\/oauth-grants\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/revoke$/i;

async function authForm(
  route: '/auth/sign-up' | '/auth/sign-in' | '/auth/forgot-password',
  config: SupabaseWebsiteConfig,
  returnTo: string,
  status?: string,
  statusCode = 200,
) {
  const csrf = random();
  const transaction: Transaction = { kind: 'form', csrf, returnTo };
  const headers = responseHeaders();
  headers.append('Set-Cookie', cookie(TRANSACTION_COOKIE,
    await seal(config, transaction, 'riff-website-transaction', FORM_TRANSACTION_TTL_SECONDS), FORM_TRANSACTION_TTL_SECONDS));
  const signup = route === '/auth/sign-up';
  const forgot = route === '/auth/forgot-password';
  const title = signup ? 'Create your Riff account' : forgot ? 'Reset your password' : 'Sign in to Riff';
  const action = route;
  const password = forgot ? '' : `<label>Password<input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="8" maxlength="1024" required></label>`;
  const button = signup ? 'Create account' : forgot ? 'Send recovery email' : 'Sign in';
  const signInPath = escapeHtml(authPath('/auth/sign-in', { return_to: returnTo }));
  const alternate = signup
    ? `<p>Already have an account? <a href="${signInPath}">Sign in</a>.</p>`
    : forgot ? `<p><a href="${signInPath}">Back to sign in</a></p>`
      : `<p><a href="${escapeHtml(authPath('/auth/forgot-password', { return_to: returnTo }))}">Forgot password?</a> · <a href="${escapeHtml(authPath('/auth/sign-up', { return_to: returnTo }))}">Create account</a></p>`;
  return html(htmlPage(title, `<h1>${title}</h1><p>Use your Riff email and password.</p>${status ? `<p class="status" role="status">${escapeHtml(status)}</p>` : ''}
<form method="post" action="${action}"><input type="hidden" name="csrf_token" value="${csrf}">
<label>Email<input name="email" type="email" autocomplete="email" maxlength="320" required></label>${password}<button type="submit">${button}</button></form>${alternate}`), statusCode, headers);
}

async function verifiedForm(
  request: Request,
  config: SupabaseWebsiteConfig,
): Promise<{ form: URLSearchParams; transaction: Extract<Transaction, { kind: 'form' }> } | null> {
  if (!sameOriginPost(request, config)) return null;
  try {
    const form = await readForm(request);
    const transaction = await readTransaction(request, config);
    if (transaction.kind !== 'form' || !await equalSecret(transaction.csrf, one(form, 'csrf_token', 128))) return null;
    return { form, transaction };
  } catch {
    return null;
  }
}

function genericError(message: string, status = 401, headers = responseHeaders()) {
  return html(htmlPage('Riff authentication', `<h1>Riff authentication</h1><p class="status" role="alert">${escapeHtml(message)}</p><p><a href="/auth/sign-in">Return to sign in</a></p>`), status, headers);
}

/**
 * Standalone Riff website auth surface. Runtime composition supplies one
 * request-scoped Supabase client adapter; this handler owns no global session.
 */
export async function handleWebsiteAuth(
  request: Request,
  rawConfig: SupabaseWebsiteConfig,
  client: SupabaseWebsiteAuthClient,
  readAccount: SupabaseWebsiteAccountReader,
): Promise<Response> {
  let config: SupabaseWebsiteConfig;
  try {
    config = validateConfig(rawConfig);
  } catch {
    return genericError('Authentication is not configured.', 503);
  }
  const url = new URL(request.url);
  if (url.origin !== config.websiteOrigin || url.protocol !== 'https:') {
    return genericError('Invalid website origin.', 400);
  }

  if (request.method === 'GET' && ['/auth/sign-up', '/auth/sign-in', '/auth/forgot-password'].includes(url.pathname)) {
    const route = url.pathname as '/auth/sign-up' | '/auth/sign-in' | '/auth/forgot-password';
    const returnTo = safeReturnPath(url.searchParams.get('return_to'), config);
    const status = route === '/auth/sign-in' && url.searchParams.get('password_updated') === '1'
      ? 'Password updated. Sign in with your new password.' : undefined;
    return authForm(route, config, returnTo, status);
  }

  if (url.pathname === '/auth/sign-up' && request.method === 'POST') {
    const verified = await verifiedForm(request, config);
    if (!verified) return genericError('The form expired. Reload and try again.', 403);
    const { form, transaction } = verified;
    let email: string; let password: string;
    try { email = one(form, 'email', 320); password = one(form, 'password', 1_024); }
    catch { return authForm('/auth/sign-up', config, transaction.returnTo, 'Check the email and password, then try again.', 400); }
    try {
      const result = await client.signUp({ email, password, emailRedirectTo: `${config.websiteOrigin}/auth/callback` });
      if (result.session) {
        const headers = responseHeaders();
        headers.append('Set-Cookie', cookie(SESSION_COOKIE,
          await seal(config, sessionCookie(result.session, 'website'), 'riff-website-session', SESSION_TTL_SECONDS), SESSION_TTL_SECONDS));
        headers.append('Set-Cookie', cookie(TRANSACTION_COOKIE, '', 0));
        return redirect(transaction.returnTo, headers);
      }
      if (!result.confirmationRequired) throw new Error('Missing signup result');
      const headers = responseHeaders();
      const pending: Transaction = { kind: 'callback', flow: 'confirmation', returnTo: transaction.returnTo,
        ...(result.flowId ? { flowId: result.flowId } : {}) };
      headers.append('Set-Cookie', cookie(TRANSACTION_COOKIE,
        await seal(config, pending, 'riff-website-transaction', EMAIL_CALLBACK_TTL_SECONDS), EMAIL_CALLBACK_TTL_SECONDS));
      return html(htmlPage('Check your email', '<h1>Check your email</h1><p class="status" role="status">Check your email to confirm your Riff account, then return here to continue.</p>'), 200, headers);
    } catch {
      return authForm('/auth/sign-up', config, transaction.returnTo,
        'Account creation could not be completed. Check the details or sign in if you already have an account.', 400);
    }
  }

  if (url.pathname === '/auth/sign-in' && request.method === 'POST') {
    const verified = await verifiedForm(request, config);
    if (!verified) return genericError('The form expired. Reload and try again.', 403);
    const { form, transaction } = verified;
    try {
      const result = await client.signInWithPassword({
        email: one(form, 'email', 320), password: one(form, 'password', 1_024),
      });
      const headers = responseHeaders();
      headers.append('Set-Cookie', cookie(SESSION_COOKIE,
        await seal(config, sessionCookie(result.session, 'website'), 'riff-website-session', SESSION_TTL_SECONDS), SESSION_TTL_SECONDS));
      headers.append('Set-Cookie', cookie(TRANSACTION_COOKIE, '', 0));
      return redirect(transaction.returnTo, headers);
    } catch {
      return authForm('/auth/sign-in', config, transaction.returnTo,
        'Sign-in could not be completed. Check the details and try again.', 400);
    }
  }

  if (url.pathname === '/auth/forgot-password' && request.method === 'POST') {
    const verified = await verifiedForm(request, config);
    if (!verified) return genericError('The form expired. Reload and try again.', 403);
    const { form, transaction } = verified;
    let result: { flowId?: string } = {};
    try {
      result = await client.requestPasswordRecovery({
        email: one(form, 'email', 320), redirectTo: `${config.websiteOrigin}/auth/callback`,
      });
    } catch {
      // The response remains identical so this route cannot enumerate accounts.
    }
    const pending: Transaction = { kind: 'callback', flow: 'recovery',
      returnTo: authPath('/auth/update-password', { return_to: transaction.returnTo }),
      ...(result.flowId ? { flowId: result.flowId } : {}) };
    const headers = responseHeaders();
    headers.append('Set-Cookie', cookie(TRANSACTION_COOKIE,
      await seal(config, pending, 'riff-website-transaction', EMAIL_CALLBACK_TTL_SECONDS), EMAIL_CALLBACK_TTL_SECONDS));
    return html(htmlPage('Check your email', '<h1>Check your email</h1><p class="status" role="status">If that account exists, Riff sent a password recovery link.</p>'), 200, headers);
  }

  if (url.pathname === '/auth/callback' && request.method === 'GET') {
    const headers = responseHeaders();
    headers.append('Set-Cookie', cookie(TRANSACTION_COOKIE, '', 0));
    try {
      const transaction = await readTransaction(request, config);
      const codes = url.searchParams.getAll('code');
      if (transaction.kind !== 'callback' || codes.length !== 1 || !codes[0]
        || url.searchParams.has('error')) throw new Error('Invalid callback');
      const result = await client.exchangeCodeForSession({ code: codes[0],
        ...(transaction.flowId ? { flowId: transaction.flowId } : {}) });
      headers.append('Set-Cookie', cookie(SESSION_COOKIE,
        await seal(config, sessionCookie(result.session, transaction.flow === 'recovery' ? 'recovery' : 'website'),
          'riff-website-session', SESSION_TTL_SECONDS), SESSION_TTL_SECONDS));
      return redirect(transaction.returnTo, headers);
    } catch {
      return genericError('This email link is invalid or expired. Start again from Riff.', 401, headers);
    }
  }

  if (url.pathname === '/auth/update-password' && request.method === 'GET') {
    try {
      const session = await readSession(request, config);
      if (session.kind !== 'recovery') throw new Error('Recovery required');
      const returnTo = safeReturnPath(url.searchParams.get('return_to'), config);
      const csrf = random();
      const headers = responseHeaders();
      headers.append('Set-Cookie', cookie(TRANSACTION_COOKIE,
        await seal(config, { kind: 'form', csrf,
          returnTo: authPath('/auth/sign-in', { password_updated: '1', return_to: returnTo }) },
          'riff-website-transaction', FORM_TRANSACTION_TTL_SECONDS), FORM_TRANSACTION_TTL_SECONDS));
      return html(htmlPage('Choose a new password', `<h1>Choose a new password</h1><form method="post" action="/auth/update-password">
<input type="hidden" name="csrf_token" value="${csrf}"><label>New password<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="1024" required></label><button type="submit">Update password</button></form>`), 200, headers);
    } catch {
      return redirect('/auth/forgot-password');
    }
  }

  if (url.pathname === '/auth/update-password' && request.method === 'POST') {
    const verified = await verifiedForm(request, config);
    if (!verified) return genericError('The recovery form expired. Request another link.', 403);
    try {
      const session = await readSession(request, config);
      if (session.kind !== 'recovery') throw new Error('Recovery required');
      await client.updatePassword({ session: publicSession(session), password: one(verified.form, 'password', 1_024) });
      const headers = responseHeaders();
      clearAuthCookies(headers);
      return redirect(verified.transaction.returnTo, headers);
    } catch {
      return genericError('The recovery link is invalid or expired. Request another link.', 401);
    }
  }

  if (url.pathname === '/account' && request.method === 'GET') {
    try {
      const session = await readSession(request, config);
      if (session.kind !== 'website') return redirect('/auth/update-password');
      const listed = await client.listGrants({ session: publicSession(session) });
      const account = websiteAccountSchema.parse(await readAccount(listed.session));
      const csrf = random();
      const headers = responseHeaders();
      await setSessionCookie(headers, config, listed.session);
      headers.append('Set-Cookie', cookie(TRANSACTION_COOKIE,
        await seal(config, { kind: 'form', csrf, returnTo: '/account' },
          'riff-website-transaction', FORM_TRANSACTION_TTL_SECONDS), FORM_TRANSACTION_TTL_SECONDS));
      const status = url.searchParams.get('oauth_revoked') === '1'
        ? '<p class="status" role="status">ChatGPT access was revoked.</p>' : '';
      const grants = listed.grants.length === 0
        ? '<p>No connected OAuth apps.</p>'
        : listed.grants.map((grant) => {
          const scopes = grant.scopes.map((scope) => `<li><code>${escapeHtml(scope)}</code></li>`).join('');
          return `<section><h2>${escapeHtml(grant.clientName)}</h2><p>Granted ${escapeHtml(grant.grantedAt)}</p>
<ul>${scopes || '<li>No scopes stated</li>'}</ul><form method="post" action="/account/oauth-grants/${escapeHtml(grant.clientId)}/revoke">
<input type="hidden" name="csrf_token" value="${csrf}"><input type="hidden" name="client_id" value="${escapeHtml(grant.clientId)}">
<button type="submit">Revoke access</button></form></section>`;
        }).join('');
      return html(htmlPage('Riff account', `<h1>Riff account</h1>${status}
<p><strong>${escapeHtml(account.displayName)}</strong></p><p>Account ID: <code>${escapeHtml(account.id)}</code></p>
<p>State: ${escapeHtml(account.state)}. Your password session is active.</p>
<h2>Connected apps</h2>${grants}
<form method="post" action="/auth/sign-out"><input type="hidden" name="csrf_token" value="${csrf}"><button type="submit">Sign out</button></form>`), 200, headers);
    } catch {
      return redirect('/auth/sign-in?return_to=%2Faccount');
    }
  }

  const revokeMatch = OAUTH_GRANT_REVOKE_PATH.exec(url.pathname);
  if (revokeMatch && request.method === 'POST') {
    const headers = responseHeaders();
    headers.append('Set-Cookie', cookie(TRANSACTION_COOKIE, '', 0));
    const verified = await verifiedForm(request, config);
    if (!verified) return genericError('Same-origin form submission required.', 403, headers);
    try {
      const session = await readSession(request, config);
      if (session.kind !== 'website') throw new Error('Website session required');
      const pathClientId = z.string().uuid().parse(revokeMatch[1]).toLowerCase();
      const submittedClientId = z.string().uuid().parse(one(verified.form, 'client_id', 64)).toLowerCase();
      if (submittedClientId !== pathClientId) throw new Error('OAuth client mismatch');
      const listed = await client.listGrants({ session: publicSession(session) });
      const grant = listed.grants.find(({ clientId }) => clientId.toLowerCase() === pathClientId);
      if (!grant) throw new Error('OAuth grant unavailable');
      const revoked = await client.revokeGrant({ session: listed.session, clientId: grant.clientId });
      await setSessionCookie(headers, config, revoked.session);
      return redirect('/account?oauth_revoked=1', headers);
    } catch {
      return genericError('This OAuth grant could not be revoked.', 400, headers);
    }
  }

  if (url.pathname === '/auth/sign-out' && request.method === 'POST') {
    const verified = await verifiedForm(request, config);
    if (!verified) return genericError('Same-origin form submission required.', 403);
    const headers = responseHeaders();
    clearAuthCookies(headers);
    try {
      const session = await readSession(request, config);
      await client.signOut({ session: publicSession(session) });
    } catch {
      return html(htmlPage('Signed out', '<h1>Signed out locally</h1><p>Riff could not confirm remote sign-out. Reconnect if needed.</p>'), 502, headers);
    }
    return redirect('/', headers);
  }

  if (url.pathname === '/oauth/consent' && request.method === 'GET') {
    const authorizationIds = url.searchParams.getAll('authorization_id');
    if (authorizationIds.length !== 1 || !authorizationIds[0] || authorizationIds[0].length > 512) {
      return genericError('This authorization request is invalid or expired.', 400);
    }
    let session: StoredSession;
    try {
      session = await readSession(request, config);
      if (session.kind !== 'website') throw new Error('Website session required');
    } catch {
      const returnTo = safeReturnPath(`${url.pathname}${url.search}`, config);
      return redirect(`/auth/sign-in?${new URLSearchParams({ return_to: returnTo })}`);
    }
    try {
      const details = await client.getAuthorizationDetails({
        session: publicSession(session), authorizationId: authorizationIds[0],
      });
      const headers = responseHeaders();
      await setSessionCookie(headers, config, details.session);
      if ('redirectUrl' in details) return redirect(providerRedirect(details.redirectUrl), headers);
      if (details.authorizationId !== authorizationIds[0]) throw new Error('Authorization mismatch');
      const redirectUri = chatGptRedirectUri(details.redirectUri);
      const csrf = random();
      headers.append('Set-Cookie', cookie(TRANSACTION_COOKIE,
        await seal(config, { kind: 'decision', csrf, authorizationId: details.authorizationId, redirectUri },
          'riff-website-transaction', FORM_TRANSACTION_TTL_SECONDS), FORM_TRANSACTION_TTL_SECONDS));
      const scopes = details.scope.split(/\s+/).filter(Boolean).map((scope) => `<li><code>${escapeHtml(scope)}</code></li>`).join('');
      return html(htmlPage('Connect ChatGPT to Riff', `<h1>Connect ChatGPT to Riff</h1>
<p><strong>${escapeHtml(details.clientName)}</strong> is requesting access through <code>${escapeHtml(details.redirectUri)}</code>.</p>
<p>OAuth information requested:</p><ul>${scopes || '<li>None stated</li>'}</ul>
<p>Riff access granted:</p><ul><li>Read your Riff account</li><li>Read creator projects and work</li><li>Create or update Riff work when you ask</li></ul>
<form method="post" action="/oauth/decision"><input type="hidden" name="csrf_token" value="${csrf}"><div class="actions"><button type="submit" name="decision" value="allow">Allow</button><button type="submit" name="decision" value="deny">Deny</button></div></form>`), 200, headers);
    } catch {
      return genericError('This authorization request is invalid or expired.', 400);
    }
  }

  if (url.pathname === '/oauth/decision' && request.method === 'POST') {
    const headers = responseHeaders();
    headers.append('Set-Cookie', cookie(TRANSACTION_COOKIE, '', 0));
    if (!sameOriginPost(request, config)) return genericError('Same-origin form submission required.', 403, headers);
    try {
      const [form, transaction, session] = await Promise.all([
        readForm(request), readTransaction(request, config), readSession(request, config),
      ]);
      if (transaction.kind !== 'decision' || session.kind !== 'website'
        || !await equalSecret(transaction.csrf, one(form, 'csrf_token', 128))) {
        throw new Error('Invalid decision');
      }
      const decision = one(form, 'decision', 8);
      const input = { session: publicSession(session), authorizationId: transaction.authorizationId };
      const result = decision === 'allow' ? await client.approveAuthorization(input)
        : decision === 'deny' ? await client.denyAuthorization(input) : (() => { throw new Error('Invalid decision'); })();
      await setSessionCookie(headers, config, result.session);
      return redirect(providerRedirect(result.redirectUrl, transaction.redirectUri), headers);
    } catch {
      return genericError('This authorization decision is invalid or expired.', 400, headers);
    }
  }

  return genericError('Not found.', 404);
}

/** Clear local cookies during an upstream outage without claiming remote sign-out. */
export function websiteAuthUnavailable(request: Request, rawConfig: SupabaseWebsiteConfig): Response {
  try {
    const config = validateConfig(rawConfig);
    const url = new URL(request.url);
    if (url.pathname !== '/auth/sign-out' || url.origin !== config.websiteOrigin || !sameOriginPost(request, config)) {
      return genericError('Authentication service unavailable.', 503);
    }
    const headers = responseHeaders();
    clearAuthCookies(headers);
    return html(htmlPage('Signed out', '<h1>Signed out locally</h1><p>Riff could not confirm remote sign-out. Reconnect if needed.</p>'), 502, headers);
  } catch {
    return genericError('Authentication service unavailable.', 503);
  }
}
