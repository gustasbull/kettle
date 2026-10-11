import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRiffVideoCatalogLoader,
  type RiffVideoCatalogState,
} from '../../apps/panel/riff-video-catalog-loader.ts';

const card = (index: number, role: 'discovered_reference' | 'own_profile' = 'discovered_reference') => ({
  id: `00000000-0000-4000-8000-${String(900 + index).padStart(12, '0')}`,
  platform: 'tiktok' as const,
  native_id: `9000000000000000${String(index).padStart(3, '0')}`,
  canonical_url: `https://www.tiktok.com/@fictional_catalog/video/9000000000000000${String(index).padStart(3, '0')}`,
  caption: `Catalog caption ${index}`,
  thumbnail_url: null,
  published_at: null,
  duration_seconds: null,
  metrics: { views: index, likes: null, comments: null, shares: null, saves: null },
  retrieved_at: '2026-10-11T12:00:00Z',
  source_observed_at: null,
  observed_at: '2026-10-11T12:00:00Z',
  origin: 'fixture' as const,
  role,
  permission_basis: 'Authored browser fixture for safe rendering.',
  limitations: [],
});

const envelope = (start: number, next_cursor: string | null, count = 8) => ({ structuredContent: { ok: true, data: {
  cards: Array.from({ length: count }, (_, offset) => card(start + offset)),
  next_cursor,
  coverage: 'Saved observations only.',
  freshness: 'As last observed.',
} } });

const pageFrom = (state: RiffVideoCatalogState) => 'page' in state ? state.page : undefined;

test('standalone project catalog loader reads one discovered-reference page and retains its unconsumed cursor locally', async () => {
  const calls: Record<string, unknown>[] = [];
  const published: RiffVideoCatalogState[] = [];
  const loader = createRiffVideoCatalogLoader(async args => {
    calls.push(args);
    return envelope(1, 'project-page-2');
  }, state => published.push(state));

  const scope = { ownerKey: 'opaque-authenticated-owner', projectId: '00000000-0000-4000-8000-000000000100' };
  await loader.load(scope);
  assert.deepEqual(calls, [{ project_id: scope.projectId, role: 'discovered_reference', sort: 'observed_at_desc', limit: 8 }]);
  assert.deepEqual(published.map(state => state.status), ['loading', 'ready']);
  assert.equal(pageFrom(published.at(-1)!)?.cards.length, 8);
  assert.equal(pageFrom(published.at(-1)!)?.next_cursor, 'project-page-2', 'the cursor is retained but never consumed');

  await loader.load(scope);
  assert.equal(calls.length, 1, 'reopening the same scope republishes the retained first page without consuming its cursor');
  assert.equal(published.at(-1)?.status, 'ready');
});

test('catalog loader clears and rejects late successes and failures across owner/project boundaries', async () => {
  const pending: Array<{ args: Record<string, unknown>; resolve: (value: unknown) => void; reject(reason: unknown): void }> = [];
  const published: RiffVideoCatalogState[] = [];
  const loader = createRiffVideoCatalogLoader(args => new Promise((resolve, reject) => pending.push({ args, resolve, reject })),
    state => published.push(state));

  const oldLoad = loader.load({ ownerKey: 'opaque-account-a' });
  while (!pending.length) await Promise.resolve();
  const newLoad = loader.load({ ownerKey: 'opaque-account-b' });
  while (pending.length < 2) await Promise.resolve();
  pending[0]!.reject(new Error('late old-owner failure'));
  pending[1]!.resolve(envelope(9, null));
  await Promise.all([oldLoad, newLoad]);

  assert.deepEqual(pending.map(item => item.args), [
    { role: 'discovered_reference', sort: 'observed_at_desc', limit: 8 },
    { role: 'discovered_reference', sort: 'observed_at_desc', limit: 8 },
  ]);
  assert.equal(pageFrom(published.at(-1)!)?.cards[0]?.caption, 'Catalog caption 9');
  assert.equal(published.some(state => pageFrom(state)?.cards[0]?.caption === 'Catalog caption 1'), false);
  assert.equal(published.some(state => state.status === 'error'), false, 'late prior-owner failures never reach the new owner');
});

test('transient failure is sanitized and recovers only through explicit retry', async () => {
  let calls = 0;
  const published: RiffVideoCatalogState[] = [];
  const loader = createRiffVideoCatalogLoader(async () => {
    calls++;
    if (calls === 1) throw new Error('secret upstream token abc');
    return envelope(1, null);
  }, state => published.push(state));
  const scope = { ownerKey: 'opaque-account-a' };

  await loader.load(scope);
  assert.equal(calls, 1);
  const failure=published.at(-1);
  assert.ok(failure?.status==='error');
  assert.equal(failure.message, 'Saved reference videos could not be loaded.');
  assert.equal(JSON.stringify(published.at(-1)).includes('secret upstream'), false);
  await Promise.resolve();
  assert.equal(calls, 1, 'failure never creates an automatic retry loop');

  await loader.retry(scope);
  assert.equal(calls, 2, 'only explicit retry performs another read');
  assert.equal(published.at(-1)?.status, 'ready');
  assert.equal(pageFrom(published.at(-1)!)?.cards[0]?.caption, 'Catalog caption 1');
});

test('same-scope retry retains the prior trusted page through loading and error', async () => {
  let calls = 0;
  const published: RiffVideoCatalogState[] = [];
  const loader = createRiffVideoCatalogLoader(async () => {
    calls++;
    if (calls === 1) return envelope(1, null);
    return { structuredContent: { ok: false, error: {
      code: 'UNAVAILABLE', message: 'Raw provider detail must not render.', retryable: true, recovery: 'retry_same_request',
    } } };
  }, state => published.push(state));
  const scope = { ownerKey: 'opaque-account-a' };
  await loader.load(scope);
  await loader.retry(scope);

  const loading = published.at(-2)!;
  const error = published.at(-1)!;
  assert.equal(loading.status, 'loading');
  assert.equal(pageFrom(loading)?.cards[0]?.caption, 'Catalog caption 1');
  assert.equal(error.status, 'error');
  assert.equal(pageFrom(error)?.cards[0]?.caption, 'Catalog caption 1');
  assert.equal(error.retryable, true);
  assert.equal(error.message, 'Saved reference videos are temporarily unavailable.');
});

test('empty is distinct from loading/error and any wrong-role or oversized page fails closed', async () => {
  const states: RiffVideoCatalogState[] = [];
  const replies: unknown[] = [
    envelope(1, null, 0),
    { structuredContent: { ok: true, data: { cards: [card(1), card(2, 'own_profile')], next_cursor: null,
      coverage: 'Mixed.', freshness: 'As last observed.' } } },
    envelope(1, null, 9),
  ];
  const loader = createRiffVideoCatalogLoader(async () => replies.shift(), state => states.push(state));
  const scope = { ownerKey: 'opaque-account-a' };

  await loader.load(scope);
  assert.equal(states.at(-1)?.status, 'empty');
  await loader.retry(scope);
  assert.equal(states.at(-1)?.status, 'error', 'one own-profile row rejects the whole reference page');
  await loader.retry(scope);
  assert.equal(states.at(-1)?.status, 'error', 'more than eight cards is rejected rather than truncated');
  assert.equal(pageFrom(states.at(-1)!)?.cards.length, 0, 'invalid replies cannot replace the prior trusted empty page');
});
