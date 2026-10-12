import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperations, failure } from '../packages/application/operations.ts';
import { handleMcp } from '../apps/worker/mcp.ts';
import { RIFF_HOME_URI } from '../apps/worker/riff-home-resource.ts';
import { config, fixtureAuth } from './auth-fixtures.ts';
import { accountA } from './fixtures.ts';

type ToolResult = {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
};

const exactRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

const firstUseAccount = (result: ToolResult) => {
  if (result.isError === true || !exactRecord(result.structuredContent)) return undefined;
  const envelope = result.structuredContent;
  if (Object.keys(envelope).length !== 2 || envelope.ok !== true || !exactRecord(envelope.data)) return undefined;
  const data = envelope.data;
  if (!exactRecord(data.account) || data.account.onboarding_seen_at !== null) return undefined;
  return data.account;
};

const welcomeSucceeded = (result: ToolResult) => {
  if (result.isError === true || !exactRecord(result.structuredContent)) return false;
  const content = result.structuredContent;
  return Object.keys(content).length === 1 && Array.isArray(content.steps)
    && content.steps.length === 3
    && content.steps[0] === 'Start' && content.steps[1] === 'Find' && content.steps[2] === 'Make';
};

const markSucceeded = (result: ToolResult) => {
  if (result.isError === true || !exactRecord(result.structuredContent)) return false;
  const envelope = result.structuredContent;
  if (Object.keys(envelope).length !== 2 || envelope.ok !== true || !exactRecord(envelope.data)) return false;
  return Object.keys(envelope.data).length === 1
    && typeof envelope.data.onboarding_seen_at === 'string'
    && Number.isFinite(Date.parse(envelope.data.onboarding_seen_at));
};

test('the packaged setup host can open Home, show first-use welcome, then mark only a strict welcome success', async () => {
  const identity = await fixtureAuth();
  const token = await identity.token();
  let markWrites = 0;
  const repositoryCalls: string[] = [];
  const accountState = { ok: true as const, data: {
    account: { id: accountA, display_name: 'Authored setup creator', state: 'active' as const,
      preferred_language: 'en', created_at: '2026-10-11T08:00:00Z', onboarding_seen_at: null },
    entitlements: { status: 'not_configured' as const },
    usage: { status: 'not_configured' as const, reset_at: null },
  } };
  const operations = createOperations(identity.verifier, { async call(operation) {
    repositoryCalls.push(operation);
    if (operation === 'get_account_state') return accountState;
    if (operation === 'mark_riff_onboarding_seen') {
      markWrites++;
      return { ok: true, data: { onboarding_seen_at: '2026-10-11T08:05:00Z' } };
    }
    return failure('NOT_FOUND');
  } });
  const rpc = async (method: string, params: unknown, credential: string | null = token) => {
    const response = await handleMcp(new Request(config.resource, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
        ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }), { config, verifier: identity.verifier, operations });
    return response.json() as Promise<{ result: any }>;
  };
  const invoke = async (name: string, credential: string | null = token): Promise<ToolResult> =>
    (await rpc('tools/call', { name, arguments: {} }, credential)).result;

  const tools = (await rpc('tools/list', {})).result.tools as Array<{ name: string; _meta?: { ui?: { resourceUri?: string } } }>;
  assert.equal(tools.find(tool => tool.name === 'open_riff')?._meta?.ui?.resourceUri, RIFF_HOME_URI,
    'the first protected call exposes Home independently of the conversational welcome');

  type WelcomeAdapter = (real: () => Promise<ToolResult>) => Promise<ToolResult>;
  const runPackagedHost = async (welcome: WelcomeAdapter) => {
    const trace: string[] = [];
    const call = async (name: string) => {
      trace.push(name);
      return name === 'show_riff_welcome' ? welcome(() => invoke(name)) : invoke(name);
    };
    const home = await call('open_riff');
    if (!firstUseAccount(home)) return { trace, completed: false, home };
    let shown: ToolResult;
    try { shown = await call('show_riff_welcome'); }
    catch { return { trace, completed: false, home }; }
    if (!welcomeSucceeded(shown)) return { trace, completed: false, home };
    const marked = await call('mark_riff_onboarding_seen');
    return { trace, completed: markSucceeded(marked), home };
  };

  let releaseWelcome!: () => void;
  let signalWelcomeStarted!: () => void;
  const release = new Promise<void>(resolve => { releaseWelcome = resolve; });
  const welcomeStarted = new Promise<void>(resolve => { signalWelcomeStarted = resolve; });
  const success = runPackagedHost(async real => {
    const result = real();
    signalWelcomeStarted();
    await release;
    return result;
  });
  await welcomeStarted;
  assert.equal(markWrites, 0, 'opening Home and starting the welcome never marks before visible success');
  const homeResource = (await rpc('resources/read', { uri: RIFF_HOME_URI }, null)).result.contents[0];
  assert.equal(homeResource.uri, RIFF_HOME_URI);
  assert.match(homeResource.text, /<title>Riff Home<\/title>/);
  releaseWelcome();
  const completed = await success;
  assert.equal(firstUseAccount(completed.home)?.id, accountA, 'Home account data was usable while welcome was pending');
  assert.deepEqual(completed.trace, ['open_riff', 'show_riff_welcome', 'mark_riff_onboarding_seen']);
  assert.equal(completed.completed, true);
  assert.equal(markWrites, 1);

  const invalidWelcomeCases: Array<[string, WelcomeAdapter]> = [
    ['failure', async () => invoke('show_riff_welcome', null)],
    ['malformed', async real => ({ ...(await real()), structuredContent: { steps: ['Start', 'Find', 'Make'], extra: true } })],
    ['timeout', async () => { throw new Error('host timed out waiting for show_riff_welcome'); }],
  ];
  for (const [name, adapter] of invalidWelcomeCases) {
    const writesBefore: number = markWrites;
    const result = await runPackagedHost(adapter);
    assert.deepEqual(result.trace, ['open_riff', 'show_riff_welcome'], `${name} stops before the mark tool`);
    assert.equal(result.completed, false);
    assert.equal(markWrites, writesBefore, `${name} cannot record onboarding`);
  }
  assert.deepEqual(repositoryCalls,
    ['get_account_state', 'mark_riff_onboarding_seen', 'get_account_state', 'get_account_state', 'get_account_state'],
    'only the strict success path reaches the write operation');
});
