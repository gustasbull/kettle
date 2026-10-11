import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('only development configures the shortest supported creator recovery cron', async () => {
  const text = await readFile('wrangler.jsonc', 'utf8');
  const config = JSON.parse(text) as { triggers?: unknown; env?: Record<string, { triggers?: { crons?: string[] } }> };
  assert.equal(config.triggers, undefined);
  assert.deepEqual(Object.keys(config.env ?? {}), ['development']);
  assert.deepEqual(config.env?.development?.triggers?.crons, ['* * * * *']);
});
