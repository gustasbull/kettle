import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSupabaseWebsiteAuthClient,
  handleWebsiteAuth,
  type SupabaseWebsiteAuthClient,
  type SupabaseWebsiteConfig,
  type SupabaseWebsiteSession,
} from '../packages/auth/website.ts';
import { website } from '../apps/web/index.ts';

const config: SupabaseWebsiteConfig = {
  supabaseUrl: 'https://project.supabase.co',
  publishableKey: 'sb_publishable_fixture',
  websiteOrigin: 'https://riff.example',
  sessionSecret: 'ab'.repeat(32),
};

const session: SupabaseWebsiteSession = {
  accessToken: 'access-token-that-must-not-appear-in-html-or-cookies',
  refreshToken: 'refresh-token-that-must-not-appear-in-html-or-cookies',
  userId: '00000000-0000-4000-8000-000000000101',
};

const rotatedSession: SupabaseWebsiteSession = {
  accessToken: 'rotated-access-token-that-must-not-appear-in-html-or-cookies',
  refreshToken: 'rotated-refresh-token-that-must-not-appear-in-html-or-cookies',
  userId: session.userId,
};

const grantClientId = '11111111-1111-4111-8111-111111111111';
const internalAccount = {
  id: '22222222-2222-4222-8222-222222222222',
  displayName: '<b>Riff member</b>',
  state: 'active' as const,
};

class FixtureClient implements SupabaseWebsiteAuthClient {
  calls: Array<{ method: string; input: unknown }> = [];
  currentSession = session;
  exchangeFailure = false;
  decisionFailure = false;
  decisionRedirectBase = 'https://chatgpt.com/connector/oauth/callback';
  signOutFailure = false;
  grants = [{
    clientId: grantClientId,
    clientName: '<script>alert(1)</script> ChatGPT',
    scopes: ['openid', 'offline_access'],
    grantedAt: '2026-10-11T00:00:00.000Z',
  }];
  signUpResult: Awaited<ReturnType<SupabaseWebsiteAuthClient['signUp']>> = {
    confirmationRequired: true, flowId: 'signup-flow',
  };
  authorizationDetails: Awaited<ReturnType<SupabaseWebsiteAuthClient['getAuthorizationDetails']>> = {
    authorizationId: 'authorization-1',
    clientName: '<img src=x onerror=alert(1)> ChatGPT',
    redirectUri: 'https://chatgpt.com/connector/oauth/callback',
    scope: 'openid offline_access',
    session,
  };
  async signUp(input: Parameters<SupabaseWebsiteAuthClient['signUp']>[0]) {
    this.calls.push({ method: 'signUp', input }); return this.signUpResult;
  }
  async signInWithPassword(input: Parameters<SupabaseWebsiteAuthClient['signInWithPassword']>[0]) {
    this.calls.push({ method: 'signInWithPassword', input }); return { session };
  }
  async exchangeCodeForSession(input: Parameters<SupabaseWebsiteAuthClient['exchangeCodeForSession']>[0]) {
    this.calls.push({ method: 'exchangeCodeForSession', input });
    if (this.exchangeFailure) throw new Error('exchange failed');
    return { session };
  }
  async requestPasswordRecovery(input: Parameters<SupabaseWebsiteAuthClient['requestPasswordRecovery']>[0]) {
    this.calls.push({ method: 'requestPasswordRecovery', input }); return { flowId: 'recovery-flow' };
  }
  async updatePassword(input: Parameters<SupabaseWebsiteAuthClient['updatePassword']>[0]) {
    this.calls.push({ method: 'updatePassword', input });
  }
  async signOut(input: Parameters<SupabaseWebsiteAuthClient['signOut']>[0]) {
    this.calls.push({ method: 'signOut', input });
    if (this.signOutFailure) throw new Error('remote sign-out failed');
  }
  async getAuthorizationDetails(input: Parameters<SupabaseWebsiteAuthClient['getAuthorizationDetails']>[0]) {
    this.calls.push({ method: 'getAuthorizationDetails', input });
    return { ...this.authorizationDetails, session: this.currentSession };
  }
  async approveAuthorization(input: Parameters<SupabaseWebsiteAuthClient['approveAuthorization']>[0]) {
    this.calls.push({ method: 'approveAuthorization', input });
    if (this.decisionFailure) throw new Error('approval failed');
    return { redirectUrl: `${this.decisionRedirectBase}?code=approved`, session: this.currentSession };
  }
  async denyAuthorization(input: Parameters<SupabaseWebsiteAuthClient['denyAuthorization']>[0]) {
    this.calls.push({ method: 'denyAuthorization', input });
    if (this.decisionFailure) throw new Error('denial failed');
    return { redirectUrl: `${this.decisionRedirectBase}?error=access_denied`, session: this.currentSession };
  }
  async listGrants(input: { session: SupabaseWebsiteSession }) {
    this.calls.push({ method: 'listGrants', input });
    return { grants: this.grants, session: this.currentSession };
  }
  async revokeGrant(input: { session: SupabaseWebsiteSession; clientId: string }) {
    this.calls.push({ method: 'revokeGrant', input });
    return { session: this.currentSession };
  }
}

const cookieHeader = (response: Response) => response.headers.getSetCookie()
  .map((value) => value.split(';')[0]).join('; ');

function mergeCookies(...values: string[]) {
  const cookies = new Map<string, string>();
  for (const value of values) for (const part of value.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf('=');
    if (separator > 0) cookies.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
  }
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
}

const csrfFrom = (html: string) => {
  const match = html.match(/name="csrf_token" value="([^"]+)"/);
  assert.ok(match, 'form includes a CSRF token');
  return match[1]!;
};

function harness(client = new FixtureClient()) {
  const accountReads: SupabaseWebsiteSession[] = [];
  const readAccount = async (websiteSession: SupabaseWebsiteSession) => {
    accountReads.push(websiteSession);
    return internalAccount;
  };
  const call = (path: string, init: RequestInit = {}) => handleWebsiteAuth(
    new Request(`${config.websiteOrigin}${path}`, init), config, client, readAccount,
  );
  const form = async (path: string) => {
    const response = await call(path);
    assert.equal(response.status, 200);
    const html = await response.text();
    return { html, csrf: csrfFrom(html), cookie: cookieHeader(response) };
  };
  const post = (path: string, cookie: string, body: Record<string, string>, origin = config.websiteOrigin) => call(path, {
    method: 'POST',
    headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  return { client, accountReads, call, form, post };
}

async function signedIn(h: ReturnType<typeof harness>, returnTo = '/account') {
  const page = await h.form(`/auth/sign-in?return_to=${encodeURIComponent(returnTo)}`);
  const response = await h.post('/auth/sign-in', page.cookie, {
    csrf_token: page.csrf, email: 'creator@example.test', password: 'correct horse battery staple',
  });
  assert.equal(response.status, 303);
  return { response, cookie: cookieHeader(response) };
}

test('Riff serves password-only sign-up, sign-in and recovery forms', async () => {
  const h = harness();
  for (const [path, heading] of [
    ['/auth/sign-up', 'Create your Riff account'],
    ['/auth/sign-in', 'Sign in to Riff'],
    ['/auth/forgot-password', 'Reset your password'],
  ] as const) {
    const page = await h.form(path);
    assert.match(page.html, new RegExp(heading));
    assert.match(page.html, /type="email"/);
    assert.doesNotMatch(page.html, /Google|Apple|Auth0/);
    assert.match(page.cookie, /__Host-riff-transaction=/);
  }
});

test('auth pages preserve same-origin provenance for browser form posts', async () => {
  const response = await harness().call('/auth/sign-up');

  assert.equal(response.headers.get('referrer-policy'), 'same-origin');
});

test('every auth cross-link preserves the validated return destination', async () => {
  const h = harness();
  const returnTo = '/oauth/consent?authorization_id=authorization-1';
  const encoded = encodeURIComponent(returnTo);
  const signIn = await h.form(`/auth/sign-in?return_to=${encoded}`);
  assert.match(signIn.html, new RegExp(`href="/auth/forgot-password\\?return_to=${encoded}"`));
  assert.match(signIn.html, new RegExp(`href="/auth/sign-up\\?return_to=${encoded}"`));

  const signUp = await h.form(`/auth/sign-up?return_to=${encoded}`);
  assert.match(signUp.html, new RegExp(`href="/auth/sign-in\\?return_to=${encoded}"`));

  const forgot = await h.form(`/auth/forgot-password?return_to=${encoded}`);
  assert.match(forgot.html, new RegExp(`href="/auth/sign-in\\?return_to=${encoded}"`));
});

test('website entry links the Supabase password account routes', () => {
  const html = website(true);
  assert.match(html, /href="\/auth\/sign-in"/);
  assert.match(html, /href="\/auth\/sign-up"/);
  assert.doesNotMatch(html, /\/auth\/login|Auth0|Google|Apple/);
});

test('password signup preserves a signed consent return and confirmation callback establishes an encrypted session', async () => {
  const h = harness();
  const returnTo = '/oauth/consent?authorization_id=authorization-1';
  const page = await h.form(`/auth/sign-up?return_to=${encodeURIComponent(returnTo)}`);
  const pending = await h.post('/auth/sign-up', page.cookie, {
    csrf_token: page.csrf, email: 'creator@example.test', password: 'correct horse battery staple',
  });
  assert.equal(pending.status, 200);
  assert.match(await pending.text(), /Check your email/);
  assert.match(pending.headers.getSetCookie().join('\n'), /__Host-riff-transaction=.*Max-Age=3600/);
  assert.deepEqual(h.client.calls[0], { method: 'signUp', input: {
    email: 'creator@example.test', password: 'correct horse battery staple',
    emailRedirectTo: 'https://riff.example/auth/callback',
  } });
  const callback = await h.call('/auth/callback?code=confirmation-code', {
    headers: { Cookie: cookieHeader(pending) },
  });
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.get('location'), returnTo);
  assert.deepEqual(h.client.calls[1], { method: 'exchangeCodeForSession', input: {
    code: 'confirmation-code', flowId: 'signup-flow',
  } });
  const setCookie = callback.headers.getSetCookie().join('\n');
  assert.match(setCookie, /__Host-riff-session=.*HttpOnly; Secure; SameSite=Lax/);
  assert.ok(!setCookie.includes(session.accessToken));
  assert.ok(!setCookie.includes(session.refreshToken!));
});

test('password sign-in sanitizes return paths and same-origin CSRF protects sign-out', async () => {
  const h = harness();
  const signIn = await signedIn(h, 'https://evil.example/steal');
  assert.equal(signIn.response.headers.get('location'), '/account');
  assert.ok(!signIn.cookie.includes(session.accessToken));

  const account = await h.call('/account', { headers: { Cookie: signIn.cookie } });
  assert.equal(account.status, 200);
  const accountHtml = await account.text();
  const accountCsrf = csrfFrom(accountHtml);
  const accountCookies = mergeCookies(signIn.cookie, cookieHeader(account));
  const denied = await h.post('/auth/sign-out', accountCookies, { csrf_token: accountCsrf }, 'https://evil.example');
  assert.equal(denied.status, 403);
  assert.equal(h.client.calls.filter(({ method }) => method === 'signOut').length, 0);
  const signedOut = await h.post('/auth/sign-out', accountCookies, { csrf_token: accountCsrf });
  assert.equal(signedOut.status, 303);
  assert.equal(signedOut.headers.get('location'), '/');
  assert.match(signedOut.headers.getSetCookie().join('\n'), /__Host-riff-session=;.*Max-Age=0/);
});

test('account lists escaped OAuth grants and only revokes a server-confirmed matching client', async () => {
  const h = harness();
  const signIn = await signedIn(h);
  h.client.currentSession = rotatedSession;

  const accountPage = async () => {
    const response = await h.call('/account', { headers: { Cookie: signIn.cookie } });
    assert.equal(response.status, 200);
    const body = await response.text();
    return {
      body,
      csrf: csrfFrom(body),
      cookie: mergeCookies(signIn.cookie, cookieHeader(response)),
    };
  };

  const account = await accountPage();
  assert.ok(!account.body.includes('<script>alert(1)</script>'));
  assert.match(account.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt; ChatGPT/);
  assert.match(account.body, new RegExp(`action="/account/oauth-grants/${grantClientId}/revoke"`));
  assert.match(account.body, new RegExp(`name="client_id" value="${grantClientId}"`));
  assert.match(account.body, /openid/);
  assert.match(account.body, /offline_access/);
  assert.ok(!account.body.includes('<b>Riff member</b>'));
  assert.match(account.body, /&lt;b&gt;Riff member&lt;\/b&gt;/);
  assert.match(account.body, new RegExp(internalAccount.id));
  assert.deepEqual(h.accountReads[0], rotatedSession);

  const mismatch = await h.post(`/account/oauth-grants/${grantClientId}/revoke`, account.cookie, {
    csrf_token: account.csrf,
    client_id: '22222222-2222-4222-8222-222222222222',
  });
  assert.equal(mismatch.status, 400);
  assert.equal(h.client.calls.filter(({ method }) => method === 'revokeGrant').length, 0);

  const unknownPage = await accountPage();
  const unknownClient = '33333333-3333-4333-8333-333333333333';
  const unknown = await h.post(`/account/oauth-grants/${unknownClient}/revoke`, unknownPage.cookie, {
    csrf_token: unknownPage.csrf,
    client_id: unknownClient,
  });
  assert.equal(unknown.status, 400);
  assert.equal(h.client.calls.filter(({ method }) => method === 'revokeGrant').length, 0);

  const revokePage = await accountPage();
  const revoked = await h.post(`/account/oauth-grants/${grantClientId}/revoke`, revokePage.cookie, {
    csrf_token: revokePage.csrf,
    client_id: grantClientId,
  });
  assert.equal(revoked.status, 303);
  assert.equal(revoked.headers.get('location'), '/account?oauth_revoked=1');
  assert.deepEqual(h.client.calls.find(({ method }) => method === 'revokeGrant'), {
    method: 'revokeGrant', input: { session: rotatedSession, clientId: grantClientId },
  });
});

test('remote sign-out failure is reported after both local cookies are cleared', async () => {
  const h = harness();
  const signIn = await signedIn(h);
  const account = await h.call('/account', { headers: { Cookie: signIn.cookie } });
  const accountHtml = await account.text();
  h.client.signOutFailure = true;
  const signedOut = await h.post('/auth/sign-out', mergeCookies(signIn.cookie, cookieHeader(account)), {
    csrf_token: csrfFrom(accountHtml),
  });
  assert.equal(signedOut.status, 502);
  assert.match(await signedOut.text(), /Signed out locally/);
  const cleared = signedOut.headers.getSetCookie().join('\n');
  assert.match(cleared, /__Host-riff-session=;.*Max-Age=0/);
  assert.match(cleared, /__Host-riff-transaction=;.*Max-Age=0/);
});

test('password recovery creates a recovery-only session and updates the password once', async () => {
  const h = harness();
  const returnTo = '/oauth/consent?authorization_id=authorization-1';
  const forgot = await h.form(`/auth/forgot-password?return_to=${encodeURIComponent(returnTo)}`);
  const sent = await h.post('/auth/forgot-password', forgot.cookie, {
    csrf_token: forgot.csrf, email: 'creator@example.test',
  });
  assert.equal(sent.status, 200);
  assert.match(await sent.text(), /If that account exists/);
  const callback = await h.call('/auth/callback?code=recovery-code', {
    headers: { Cookie: cookieHeader(sent) },
  });
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.get('location'), `/auth/update-password?return_to=${encodeURIComponent(returnTo)}`);
  assert.deepEqual(h.client.calls.find(({ method }) => method === 'exchangeCodeForSession'), {
    method: 'exchangeCodeForSession', input: { code: 'recovery-code', flowId: 'recovery-flow' },
  });

  const recoveryCookie = cookieHeader(callback);
  const update = await h.call(callback.headers.get('location')!, { headers: { Cookie: recoveryCookie } });
  assert.equal(update.status, 200);
  const updateHtml = await update.text();
  const cookies = mergeCookies(recoveryCookie, cookieHeader(update));
  const changed = await h.post('/auth/update-password', cookies, {
    csrf_token: csrfFrom(updateHtml), password: 'new correct horse battery staple',
  });
  assert.equal(changed.status, 303);
  const signInLocation = changed.headers.get('location');
  assert.ok(signInLocation);
  assert.equal(new URL(signInLocation, config.websiteOrigin).searchParams.get('return_to'), returnTo);
  assert.equal(new URL(signInLocation, config.websiteOrigin).searchParams.get('password_updated'), '1');
  assert.equal(h.client.calls.filter(({ method }) => method === 'updatePassword').length, 1);
  assert.match(changed.headers.getSetCookie().join('\n'), /__Host-riff-session=;.*Max-Age=0/);

  const newSignIn = await h.form(signInLocation);
  const resumed = await h.post('/auth/sign-in', newSignIn.cookie, {
    csrf_token: newSignIn.csrf, email: 'creator@example.test', password: 'new correct horse battery staple',
  });
  assert.equal(resumed.status, 303);
  assert.equal(resumed.headers.get('location'), returnTo);
});

test('consent requires a session, escapes client metadata, and approve or deny uses the provider redirect', async () => {
  const h = harness();
  const anonymous = await h.call('/oauth/consent?authorization_id=authorization-1');
  assert.equal(anonymous.status, 303);
  assert.equal(anonymous.headers.get('location'), '/auth/sign-in?return_to=%2Foauth%2Fconsent%3Fauthorization_id%3Dauthorization-1');

  const signIn = await signedIn(h, '/oauth/consent?authorization_id=authorization-1');
  h.client.currentSession = rotatedSession;
  const consent = await h.call('/oauth/consent?authorization_id=authorization-1', {
    headers: { Cookie: signIn.cookie },
  });
  assert.equal(consent.status, 200);
  const html = await consent.text();
  assert.ok(!html.includes('<img src=x'));
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; ChatGPT/);
  assert.match(html, /openid/);
  assert.match(html, /offline_access/);
  assert.match(html, /Read your Riff account/);
  assert.match(html, />Allow</);
  assert.match(html, />Deny</);

  const cookies = mergeCookies(signIn.cookie, cookieHeader(consent));
  const approved = await h.post('/oauth/decision', cookies, {
    csrf_token: csrfFrom(html), decision: 'allow',
  });
  assert.equal(approved.status, 303);
  assert.equal(approved.headers.get('location'), 'https://chatgpt.com/connector/oauth/callback?code=approved');
  assert.deepEqual(h.client.calls.find(({ method }) => method === 'approveAuthorization'), {
    method: 'approveAuthorization', input: { session: rotatedSession, authorizationId: 'authorization-1' },
  });

  const consentAgain = await h.call('/oauth/consent?authorization_id=authorization-1', {
    headers: { Cookie: signIn.cookie },
  });
  const denyHtml = await consentAgain.text();
  const denied = await h.post('/oauth/decision', mergeCookies(signIn.cookie, cookieHeader(consentAgain)), {
    csrf_token: csrfFrom(denyHtml), decision: 'deny',
  });
  assert.equal(denied.status, 303);
  assert.equal(denied.headers.get('location'), 'https://chatgpt.com/connector/oauth/callback?error=access_denied');
});

test('consent rejects a foreign or malformed ChatGPT callback before a decision can be made', async () => {
  for (const redirectUri of [
    'https://evil.example/connector/oauth/callback',
    'https://chatgpt.com:444/connector/oauth/callback',
    'https://chatgpt.com/connector/oauth/',
    'https://chatgpt.com/connector/oauth/.',
    'https://chatgpt.com/connector/oauth/..',
    'https://chatgpt.com/connector/oauth/callback/extra',
    'https://chatgpt.com/connector/oauth/callback?unexpected=1',
    'https://user@chatgpt.com/connector/oauth/callback',
  ]) {
    const client = new FixtureClient();
    client.authorizationDetails = { ...client.authorizationDetails, redirectUri } as typeof client.authorizationDetails;
    const h = harness(client);
    const signIn = await signedIn(h, '/oauth/consent?authorization_id=authorization-1');
    const consent = await h.call('/oauth/consent?authorization_id=authorization-1', {
      headers: { Cookie: signIn.cookie },
    });
    assert.equal(consent.status, 400, redirectUri);
    assert.equal(client.calls.filter(({ method }) => ['approveAuthorization', 'denyAuthorization'].includes(method)).length, 0);
  }
});

test('consent accepts the OpenAI stable issuer-identified callback', async () => {
  const client = new FixtureClient();
  const callback = 'https://chatgpt.com/connector_platform_oauth_redirect';
  client.authorizationDetails = { ...client.authorizationDetails, redirectUri: callback } as typeof client.authorizationDetails;
  client.decisionRedirectBase = callback;
  const h = harness(client);
  const signIn = await signedIn(h, '/oauth/consent?authorization_id=authorization-1');
  const consent = await h.call('/oauth/consent?authorization_id=authorization-1', {
    headers: { Cookie: signIn.cookie },
  });
  assert.equal(consent.status, 200);
  const body = await consent.text();
  const approved = await h.post('/oauth/decision', mergeCookies(signIn.cookie, cookieHeader(consent)), {
    csrf_token: csrfFrom(body), decision: 'allow',
  });
  assert.equal(approved.status, 303);
  assert.equal(approved.headers.get('location'), `${callback}?code=approved`);
});

test('concrete Supabase JS adapter round-trips a server-side PKCE confirmation and maps its session', async () => {
  const requests: Array<{ url: URL; body: Record<string, unknown> }> = [];
  const user = {
    id: session.userId,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'creator@example.test',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    created_at: '2026-10-11T00:00:00.000Z',
  };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    requests.push({ url, body });
    if (url.pathname === '/auth/v1/signup') return Response.json({ user, session: null });
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'pkce') {
      return Response.json({
        access_token: 'sdk-access-token', refresh_token: 'sdk-refresh-token', expires_in: 3600,
        token_type: 'bearer', user,
      });
    }
    return Response.json({ message: 'unexpected request' }, { status: 500 });
  };
  const client = createSupabaseWebsiteAuthClient(config, fetcher);
  const pending = await client.signUp({
    email: 'creator@example.test', password: 'correct horse battery staple',
    emailRedirectTo: 'https://riff.example/auth/callback',
  });
  assert.equal(pending.confirmationRequired, true);
  assert.ok(pending.flowId && pending.flowId.length <= 512);
  assert.match(String(requests[0]?.body.code_challenge), /^[A-Za-z0-9_-]+$/);

  const exchanged = await client.exchangeCodeForSession({ code: 'confirmation-code', flowId: pending.flowId });
  assert.deepEqual(exchanged.session, {
    accessToken: 'sdk-access-token', refreshToken: 'sdk-refresh-token', userId: session.userId,
  });
  assert.equal(requests[1]?.body.auth_code, 'confirmation-code');
  assert.match(String(requests[1]?.body.code_verifier), /^[A-Za-z0-9._~-]+$/);
});

test('concrete Supabase JS adapter returns a rotated session while listing and revoking OAuth grants', async () => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = (exp: number) => `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    sub: session.userId, exp,
  })}.c2ln`;
  const expiredAccessToken = token(Math.floor(Date.now() / 1000) - 60);
  const refreshedAccessToken = token(Math.floor(Date.now() / 1000) + 3_600);
  const user = {
    id: session.userId,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'creator@example.test',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    created_at: '2026-10-11T00:00:00.000Z',
  };
  const requests: Array<{ method: string; url: URL }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const method = init?.method ?? 'GET';
    requests.push({ method, url });
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      return Response.json({
        access_token: refreshedAccessToken,
        refresh_token: 'rotated-sdk-refresh-token',
        expires_in: 3_600,
        token_type: 'bearer',
        user,
      });
    }
    if (url.pathname === '/auth/v1/user/oauth/grants' && method === 'GET') {
      return Response.json([{
        client: { id: grantClientId, name: 'ChatGPT', uri: 'https://chatgpt.com', logo_uri: '' },
        scopes: ['openid', 'offline_access'],
        granted_at: '2026-10-11T00:00:00.000Z',
      }]);
    }
    if (url.pathname === '/auth/v1/user/oauth/grants' && method === 'DELETE') {
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/auth/v1/logout' && method === 'POST') {
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/auth/v1/user') return Response.json(user);
    return Response.json({ message: 'unexpected request' }, { status: 500 });
  };
  const client = createSupabaseWebsiteAuthClient(config, fetcher);
  const listed = await client.listGrants({
    session: { accessToken: expiredAccessToken, refreshToken: 'sdk-refresh-token', userId: session.userId },
  });
  assert.deepEqual(listed, {
    session: {
      accessToken: refreshedAccessToken,
      refreshToken: 'rotated-sdk-refresh-token',
      userId: session.userId,
    },
    grants: [{
      clientId: grantClientId,
      clientName: 'ChatGPT',
      scopes: ['openid', 'offline_access'],
      grantedAt: '2026-10-11T00:00:00.000Z',
    }],
  });

  const revoked = await client.revokeGrant({ session: listed.session, clientId: grantClientId });
  assert.deepEqual(revoked.session, listed.session);
  const revokeRequest = requests.find(({ method }) => method === 'DELETE');
  assert.equal(revokeRequest?.url.searchParams.get('client_id'), grantClientId);
  await client.signOut({ session: listed.session });
  const signOutRequest = requests.find(({ url }) => url.pathname === '/auth/v1/logout');
  assert.equal(signOutRequest?.url.searchParams.get('scope'), 'local');
});

test('failed callbacks and consent decisions consume their transaction cookies', async () => {
  const callbackHarness = harness();
  const signup = await callbackHarness.form('/auth/sign-up');
  const pending = await callbackHarness.post('/auth/sign-up', signup.cookie, {
    csrf_token: signup.csrf, email: 'creator@example.test', password: 'correct horse battery staple',
  });
  callbackHarness.client.exchangeFailure = true;
  const callback = await callbackHarness.call('/auth/callback?code=confirmation-code', {
    headers: { Cookie: cookieHeader(pending) },
  });
  assert.equal(callback.status, 401);
  assert.match(callback.headers.getSetCookie().join('\n'), /__Host-riff-transaction=;.*Max-Age=0/);

  const decisionHarness = harness();
  const signIn = await signedIn(decisionHarness, '/oauth/consent?authorization_id=authorization-1');
  const consent = await decisionHarness.call('/oauth/consent?authorization_id=authorization-1', {
    headers: { Cookie: signIn.cookie },
  });
  const consentHtml = await consent.text();
  decisionHarness.client.decisionFailure = true;
  const decision = await decisionHarness.post('/oauth/decision', mergeCookies(signIn.cookie, cookieHeader(consent)), {
    csrf_token: csrfFrom(consentHtml), decision: 'allow',
  });
  assert.equal(decision.status, 400);
  assert.match(decision.headers.getSetCookie().join('\n'), /__Host-riff-transaction=;.*Max-Age=0/);
});

test('tampered callback and form state fail before the Supabase boundary', async () => {
  const h = harness();
  const callback = await h.call('/auth/callback?code=unbound-code');
  assert.equal(callback.status, 401);
  const form = await h.form('/auth/sign-in');
  const badCsrf = await h.post('/auth/sign-in', form.cookie, {
    csrf_token: 'wrong', email: 'creator@example.test', password: 'correct horse battery staple',
  });
  assert.equal(badCsrf.status, 403);
  assert.deepEqual(h.client.calls, []);
});
