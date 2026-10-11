import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import {
  handleWebsiteAuth,
  type SupabaseWebsiteAuthClient,
  type SupabaseWebsiteConfig,
  type SupabaseWebsiteSession,
} from '../packages/auth/website.ts';

const session: SupabaseWebsiteSession = {
  accessToken: 'browser-test-access-token',
  refreshToken: 'browser-test-refresh-token',
  userId: '00000000-0000-4000-8000-000000000101',
};

const callbackBase = 'https://chatgpt.com/connector/oauth/callback';
const config: SupabaseWebsiteConfig = {
  supabaseUrl: 'https://project.supabase.co',
  publishableKey: 'sb_publishable_fixture',
  websiteOrigin: 'https://riff.example',
  sessionSecret: 'ab'.repeat(32),
};

const client: SupabaseWebsiteAuthClient = {
  async signUp() {
    throw new Error('Unexpected sign-up');
  },
  async signInWithPassword() {
    return { session };
  },
  async exchangeCodeForSession() {
    throw new Error('Unexpected code exchange');
  },
  async requestPasswordRecovery() {
    throw new Error('Unexpected password recovery');
  },
  async updatePassword() {
    throw new Error('Unexpected password update');
  },
  async signOut() {
    throw new Error('Unexpected sign-out');
  },
  async getAuthorizationDetails() {
    return {
      authorizationId: 'authorization-1',
      clientName: 'ChatGPT',
      redirectUri: callbackBase,
      scope: 'openid email offline_access',
      session,
    };
  },
  async approveAuthorization() {
    return {
      redirectUrl: `${callbackBase}?code=approved&state=browser-test`,
      session,
    };
  },
  async denyAuthorization() {
    throw new Error('Unexpected authorization denial');
  },
  async listGrants() {
    throw new Error('Unexpected grant listing');
  },
  async revokeGrant() {
    throw new Error('Unexpected grant revocation');
  },
};

function cookieHeader(response: Response) {
  return response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
}

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

function csrfFrom(html: string) {
  const match = html.match(/name="csrf_token" value="([^"]+)"/);
  assert.ok(match, 'consent form includes a CSRF token');
  return match[1]!;
}

async function routedResponse(source: Response, body?: string) {
  const headers: Record<string, string> = {};
  for (const [name, value] of source.headers) {
    if (name !== 'set-cookie') headers[name] = value;
  }
  return { status: source.status, headers, body: body ?? await source.text() };
}

test('OAuth consent returns to ChatGPT after approval in Chromium', async (context) => {
  const call = (path: string, init: RequestInit = {}) => handleWebsiteAuth(
    new Request(`${config.websiteOrigin}${path}`, init),
    config,
    client,
    async () => ({
      id: '22222222-2222-4222-8222-222222222222',
      displayName: 'Riff member',
      state: 'active',
    }),
  );

  const signInPage = await call('/auth/sign-in');
  const signInHtml = await signInPage.text();
  const signedIn = await call('/auth/sign-in', {
    method: 'POST',
    headers: {
      Cookie: cookieHeader(signInPage),
      Origin: config.websiteOrigin,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      csrf_token: csrfFrom(signInHtml),
      email: 'creator@example.test',
      password: 'correct horse battery staple',
    }),
  });
  assert.equal(signedIn.status, 303);

  const consent = await call('/oauth/consent?authorization_id=authorization-1', {
    headers: { Cookie: cookieHeader(signedIn) },
  });
  assert.equal(consent.status, 200);
  const consentHtml = await consent.text();
  const decisionCookies = mergeCookies(cookieHeader(signedIn), cookieHeader(consent));

  const browser = await chromium.launch({ headless: true });
  context.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('https://chatgpt.com/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<h1>ChatGPT callback received</h1>',
  }));
  await page.route('https://riff.example/**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET' && new URL(request.url()).pathname === '/') {
      const browserConsent = await call('/oauth/consent?authorization_id=authorization-1', {
        headers: { Cookie: decisionCookies },
      });
      await route.fulfill(await routedResponse(browserConsent, consentHtml));
      return;
    }
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/oauth/decision') {
      const decision = await call('/oauth/decision', {
        method: 'POST',
        headers: {
          Cookie: decisionCookies,
          Origin: config.websiteOrigin,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: request.postData() ?? '',
      });
      await route.fulfill(await routedResponse(decision));
      return;
    }
    await route.fulfill({ status: 404, body: 'Not found' });
  });

  await page.goto(config.websiteOrigin);
  await page.getByRole('button', { name: 'Allow' }).click();
  await page.waitForURL(`${callbackBase}?code=approved&state=browser-test`, { timeout: 2_000 });

  assert.equal(page.url(), `${callbackBase}?code=approved&state=browser-test`);
});
