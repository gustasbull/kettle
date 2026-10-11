import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRiffVideoCatalogLoader } from '../../apps/panel/riff-video-catalog-loader.ts';

const card = (index: number) => ({
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
  role: 'discovered_reference' as const,
  permission_basis: 'Authored browser fixture for safe rendering.',
  limitations: [],
});

const envelope = (start: number, next_cursor: string | null) => ({ structuredContent: { ok: true, data: {
  cards: Array.from({ length: 8 }, (_, offset) => card(start + offset)),
  next_cursor,
  coverage: 'Saved observations only.',
  freshness: 'As last observed.',
} } });

test('standalone project catalog loader reads an explicit next cursor and keeps loaded pages local', async () => {
  const calls: Record<string, unknown>[] = [];
  const published: any[] = [];
  const loader = createRiffVideoCatalogLoader(async args => {
    calls.push(args);
    return args.cursor === 'project-page-2' ? envelope(9, null) : envelope(1, 'project-page-2');
  }, page => published.push(page));

  const scope = { ownerKey: 'standalone-session', projectId: '00000000-0000-4000-8000-000000000100' };
  await loader.load(scope);
  assert.deepEqual(calls, [{ project_id: scope.projectId, sort: 'observed_at_desc', limit: 8 }]);
  assert.equal(published.at(-1).cards.length, 8);

  await loader.load(scope, 'not-the-advertised-cursor');
  assert.equal(calls.length, 1, 'only the cursor advertised by the loaded page can be read');
  await loader.load(scope, 'project-page-2');
  assert.deepEqual(calls[1], { project_id: scope.projectId, sort: 'observed_at_desc', limit: 8, cursor: 'project-page-2' });
  assert.equal(published.at(-1).cards.length, 16);
  assert.deepEqual(published.at(-1).cards.slice(0, 2).map((item: any) => item.caption), ['Catalog caption 1', 'Catalog caption 2']);
  await loader.load(scope, 'project-page-2');
  assert.equal(calls.length, 2, 'a cursor is read at most once per owner/project scope');
});

test('catalog loader clears and rejects late pages across owner/project boundaries', async () => {
  const pending: Array<{ args: Record<string, unknown>; resolve: (value: unknown) => void }> = [];
  const published: any[] = [];
  const loader = createRiffVideoCatalogLoader(args => new Promise(resolve => pending.push({ args, resolve })),
    page => published.push(page));

  const oldScope = { ownerKey: 'account-a' };
  const oldLoad = loader.load(oldScope);
  while (!pending.length) await Promise.resolve();
  const newLoad = loader.load({ ownerKey: 'account-b' });
  while (pending.length < 2) await Promise.resolve();
  pending[0]!.resolve(envelope(1, 'old-cursor'));
  pending[1]!.resolve(envelope(9, null));
  await Promise.all([oldLoad, newLoad]);

  assert.deepEqual(pending.map(item => item.args), [
    { sort: 'observed_at_desc', limit: 8 },
    { sort: 'observed_at_desc', limit: 8 },
  ]);
  assert.equal(published.at(-1).cards[0].caption, 'Catalog caption 9');
  assert.equal(published.some(page => page?.cards?.[0]?.caption === 'Catalog caption 1'), false,
    'a late page from the previous owner never reaches the current view');
});
