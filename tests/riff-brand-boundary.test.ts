import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const userFacingSources = [
  'apps/worker/mcp.ts',
  'apps/worker/creator-pipeline-resource.ts',
  'apps/worker/creator-review-resource.ts',
  'apps/worker/project-review-resource.ts',
  'apps/panel/creator-loop/index.ts',
  'apps/panel/creator-pipeline/index.ts',
  'apps/panel/creator-pipeline-bridge.ts',
  'apps/panel/creator-review.ts',
  'apps/panel/bridge.ts',
  'apps/panel/project-review.ts',
  'apps/panel/seed-video-review.ts',
  'apps/panel/fixtures/index.html',
  'apps/web/index.ts',
  'packages/application/operations.ts',
  'packages/application/creator-pipeline.ts',
  'packages/auth/index.ts',
  'packages/auth/website.ts',
  'wrangler.jsonc',
] as const;

test('production copy uses Riff while lowercase Kettle compatibility identifiers remain available', async () => {
  for (const file of userFacingSources) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /\bKettle\b/, `${file} still contains the legacy display brand`);
  }

  const mcp = await readFile('apps/worker/mcp.ts', 'utf8');
  const pipelineResource = await readFile('apps/worker/creator-pipeline-resource.ts', 'utf8');
  assert.match(mcp, /'kettle_diagnostic'/, 'public diagnostic name remains compatible');
  assert.match(pipelineResource, /ui:\/\/kettle\/creator-pipeline-v2\.html/, 'resource URI remains compatible');
});
