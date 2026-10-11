/** Explicit zero-dollar development allocation; secrets stay in CLI memory. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

export type CreatorTrialFetch = typeof fetch;
export type CreatorTrialOptions = {
  email: string;
  mode: 'initial' | 'refill';
  requestId: string;
  runs: number;
};

type ConfigureDependencies = {
  project: string;
  serviceRoleKey: string;
  fetcher?: CreatorTrialFetch;
  now?: () => Date;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseCreatorTrialArgs(args: string[]): CreatorTrialOptions {
  const values = new Map<string, string>();
  let execute = false;
  let refill = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (argument === '--execute') { execute = true; continue; }
    if (argument === '--refill') { refill = true; continue; }
    if (!['--email', '--runs', '--request-id'].includes(argument)) {
      throw new Error(`Unknown trial option: ${argument}`);
    }
    const value = args[++index];
    if (!value || value.startsWith('--') || values.has(argument)) throw new Error(`Missing or duplicate ${argument}`);
    values.set(argument, value);
  }
  if (!execute) throw new Error('Use --execute to confirm trial provisioning');
  const email = values.get('--email');
  const requestId = values.get('--request-id');
  const rawRuns = values.get('--runs');
  if (!email || email.trim() !== email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error('An exact account email is required');
  if (!requestId || !uuid.test(requestId)) throw new Error('A UUID --request-id is required');
  if (!rawRuns || !/^[0-9]+$/.test(rawRuns)) throw new Error('An explicit --runs count is required');
  const runs = Number(rawRuns);
  if (!Number.isSafeInteger(runs) || runs < 1 || runs > 10) throw new Error('Runs must be between 1 and 10');
  if (!refill && runs !== 1) throw new Error('Initial provisioning is insert-once; use --refill for additional runs');
  return { email, mode: refill ? 'refill' : 'initial', requestId, runs };
}

function assertProject(value: string) {
  if (!/^[a-z0-9-]{3,64}$/.test(value)) throw new Error('Invalid Supabase project reference');
}

function authHeaders(key: string, json = false) {
  if (!key || /[\r\n]/.test(key)) throw new Error('Invalid service credential');
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function readJson(response: Response, context: string) {
  if (!response.ok) throw new Error(`${context} failed (${response.status}); response body suppressed`);
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text) as unknown; }
  catch { throw new Error(`${context} returned malformed JSON`); }
}

async function exactAuthUser(
  base: string,
  key: string,
  email: string,
  fetcher: CreatorTrialFetch,
) {
  const matches: Array<{ id: string; email: string }> = [];
  const wanted = email.toLowerCase();
  for (let page = 1; page <= 100; page++) {
    const url = new URL('/auth/v1/admin/users', base);
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', '100');
    const raw = await readJson(await fetcher(url, { headers: authHeaders(key) }), 'Account lookup');
    const users = raw && typeof raw === 'object' && Array.isArray((raw as { users?: unknown }).users)
      ? (raw as { users: unknown[] }).users : null;
    if (!users) throw new Error('Account lookup returned malformed users');
    for (const candidate of users) {
      if (!candidate || typeof candidate !== 'object') continue;
      const id = (candidate as { id?: unknown }).id;
      const candidateEmail = (candidate as { email?: unknown }).email;
      if (typeof id === 'string' && uuid.test(id) && typeof candidateEmail === 'string'
        && candidateEmail.toLowerCase() === wanted) matches.push({ id, email: candidateEmail });
    }
    if (matches.length > 1 || users.length < 100) break;
  }
  if (matches.length !== 1) throw new Error('Exact account email was not found uniquely');
  return matches[0]!;
}

export async function configureCreatorTrial(options: CreatorTrialOptions, dependencies: ConfigureDependencies) {
  assertProject(dependencies.project);
  if (!uuid.test(options.requestId) || !Number.isSafeInteger(options.runs) || options.runs < 1 || options.runs > 10
    || (options.mode === 'initial' && options.runs !== 1)) throw new Error('Invalid trial provisioning options');
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? (() => new Date());
  const base = `https://${dependencies.project}.supabase.co`;
  const key = dependencies.serviceRoleKey;

  const rest = async (path: string, method = 'GET', body?: unknown, prefer?: string) => {
    const response = await fetcher(new URL(`/rest/v1/${path}`, base), {
      method,
      headers: {
        ...authHeaders(key, body !== undefined),
        ...(prefer ? { Prefer: prefer } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return readJson(response, 'Development allocation');
  };

  const budgets = await rest('creator_pipeline_budget?id=eq.1&select=limit_microusd,reserved_microusd');
  if (!Array.isArray(budgets) || budgets.length !== 1
    || budgets[0]?.limit_microusd !== 0 || budgets[0]?.reserved_microusd !== 0) {
    throw new Error('Cash budget must remain zero');
  }

  const authUser = await exactAuthUser(base, key, options.email, fetcher);
  const identitiesPath = new URL('/rest/v1/account_identities', base);
  identitiesPath.searchParams.set('issuer', `eq.${base}/auth/v1`);
  identitiesPath.searchParams.set('subject', `eq.${authUser.id}`);
  identitiesPath.searchParams.set('select', 'account_id');
  const identities = await readJson(await fetcher(identitiesPath, { headers: authHeaders(key) }), 'Identity lookup');
  const accountId = Array.isArray(identities) && identities.length === 1
    ? identities[0]?.account_id : null;
  if (typeof accountId !== 'string' || !uuid.test(accountId)) {
    throw new Error('Exact account email has not completed Riff identity setup');
  }

  const expires = new Date(now().getTime() + 7 * 24 * 3_600_000).toISOString();
  // Initial shared rows are insert-only. Existing balances, enabled state and
  // expiry are never reset by a routine provisioning run.
  await rest('creator_provider_trials?on_conflict=provider', 'POST', [
    { provider: 'scrapecreators', remaining_units: 20, enabled: true, expires_at: expires },
    { provider: 'lightreel', remaining_units: 10, enabled: true, expires_at: expires },
  ], 'resolution=ignore-duplicates,return=minimal');

  const provision = await rest('rpc/kettle_provision_riff_creator_run_grants', 'POST', {
    p_account_id: accountId,
    p_input: { request_id: options.requestId, mode: options.mode, run_count: options.runs },
  });
  const provisionData = provision && typeof provision === 'object'
    ? (provision as { ok?: unknown; data?: { status?: unknown; grants?: unknown } }) : null;
  if (provisionData?.ok !== true || !provisionData.data
    || !['created', 'existing'].includes(String(provisionData.data.status))
    || !Array.isArray(provisionData.data.grants)) {
    const code = provision && typeof provision === 'object'
      ? (provision as { error?: { code?: unknown } }).error?.code : null;
    throw new Error(`Run grant provisioning was denied${typeof code === 'string' ? ` (${code})` : ''}`);
  }
  const grantIds = provisionData.data.grants.map((grant) => {
    const id = grant && typeof grant === 'object' ? (grant as { id?: unknown }).id : null;
    if (typeof id !== 'string' || !uuid.test(id)) throw new Error('Run grant provisioning returned malformed grants');
    return id;
  });
  const trials = await rest('creator_provider_trials?select=provider,remaining_units,enabled,expires_at&order=provider');
  if (!Array.isArray(trials)) throw new Error('Shared trial state is unavailable');
  return {
    account_id: accountId,
    email: options.email,
    mode: options.mode,
    request_id: options.requestId,
    requested_runs: options.runs,
    status: provisionData.data.status,
    grant_ids: grantIds,
    shared_trials: trials,
    cash_budget_usd: 0,
  };
}

async function main() {
  const options = parseCreatorTrialArgs(process.argv.slice(2));
  const project = 'fdicggstdtthfpcrpujf';
  assert.equal((await readFile('supabase/.temp/project-ref', 'utf8')).trim(), project);
  let stdout: string;
  try {
    ({ stdout } = await promisify(execFile)('node_modules/.bin/supabase',
      ['projects', 'api-keys', '--project-ref', project, '--output', 'json'], { timeout: 60_000 }));
  } catch { throw new Error('Development credential lookup failed; CLI output suppressed'); }
  const keys = JSON.parse(stdout) as { name: string; api_key: string }[];
  const serviceRoleKey = keys.find(candidate => candidate.name === 'service_role')?.api_key;
  if (!serviceRoleKey) throw new Error('Development service credential unavailable');
  const result = await configureCreatorTrial(options, { project, serviceRoleKey });
  console.log(JSON.stringify(result, null, 2));
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Trial provisioning failed');
    process.exitCode = 1;
  });
}
