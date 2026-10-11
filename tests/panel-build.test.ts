import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { gzipSync } from 'node:zlib';
// @ts-expect-error Build tooling is a Node ESM module, not part of the Worker.
import { buildPanel, buildPanelManifest, PANEL_BUDGETS } from '../scripts/build-panel.mjs';

function generatedScript(source: string, symbol: string): string {
  const line = source.split('\n').find(value => value.startsWith(`export const ${symbol}: string = `));
  assert.ok(line);
  return JSON.parse(line.slice(`export const ${symbol}: string = `.length, -1));
}

test('Riff Home keeps its first-paint browser bundle below 500 KB', async () => {
  const source = await readFile('apps/panel/generated/riff-home-bundle.ts', 'utf8');
  const script = generatedScript(source, 'riffHomeScript');
  const bytes = Buffer.byteLength(script, 'utf8');
  assert.ok(bytes < 500_000, `Riff Home browser bundle is ${bytes} bytes; keep launch-critical code below 500 KB`);
});

test('creator pipeline excludes server contract graphs and stays within launch budgets', async () => {
  const result = await buildPanel(process.cwd(), 'pipeline');
  assert.equal(result.status, 'built');
  assert.ok(result.fingerprint.raw_bytes <= 250_000, `${result.fingerprint.raw_bytes} raw bytes`);
  assert.ok(result.fingerprint.gzip_bytes <= 75_000, `${result.fingerprint.gzip_bytes} gzip bytes`);
  assert.deepEqual(PANEL_BUDGETS.pipeline, { raw_bytes: 250_000, gzip_bytes: 75_000 });
});

for (const kind of ['project', 'creator', 'riff-onboarding', 'riff-home']) test(`${kind} panel build bundles component code and removes stale output on missing/broken integration`, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'kettle-panel-build-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const name = kind === 'creator' ? 'creator-review' : kind === 'project' ? 'project-review' : kind;
  const bridge = kind === 'creator' ? 'creator-review-bridge.ts' : kind === 'project' ? 'bridge.ts' : `${kind}-bridge.ts`;
  const symbol = kind === 'creator' ? 'creatorReviewScript' : kind === 'project' ? 'projectReviewScript'
    : kind === 'riff-onboarding' ? 'riffOnboardingScript' : 'riffHomeScript';
  const panel = join(root, 'apps/panel');
  const output = join(panel, `generated/${name}-bundle.ts`);
  await mkdir(join(panel, 'generated'), { recursive: true });
  await writeFile(output, 'stale');
  assert.equal((await buildPanel(root, kind)).status, 'not-integrated');
  await assert.rejects(readFile(output));
  await writeFile(join(panel, bridge), `import { message } from './${name}'; globalThis.rendered = message;`);
  await assert.rejects(buildPanel(root, kind), /requires/);
  const component = kind.startsWith('riff-') ? join(panel, name, 'index.ts') : join(panel, `${name}.ts`);
  await mkdir(join(component, '..'), { recursive: true });
  await writeFile(component, 'export const message = "</script><script>untrusted</script>";');
  assert.equal((await buildPanel(root, kind)).status, 'built');
  const source = await readFile(output, 'utf8');
  const script = generatedScript(source, symbol);
  assert.doesNotMatch(script, /<\/script/i);
  const context: Record<string, unknown> = {};
  runInNewContext(script, context);
  assert.equal(context.rendered, '</script><script>untrusted</script>');
  await writeFile(join(panel, bridge), 'import "./missing";');
  await assert.rejects(buildPanel(root, kind));
  await assert.rejects(readFile(output));
});

test('Home, onboarding, and pipeline manifest fingerprints exact deterministic bundles within raw and gzip budgets', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'kettle-panel-manifest-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const panel = join(root, 'apps/panel');
  const fixtures = [
    { kind: 'riff-home', name: 'riff-home', symbol: 'riffHomeScript', resource: 'riff-home-v3' },
    { kind: 'riff-onboarding', name: 'riff-onboarding', symbol: 'riffOnboardingScript', resource: 'riff-onboarding-v1' },
    { kind: 'pipeline', name: 'creator-pipeline', symbol: 'creatorPipelineScript', resource: 'creator-pipeline-v3' },
  ] as const;
  for (const fixture of fixtures) {
    const component = join(panel, fixture.name, 'index.ts');
    await mkdir(join(component, '..'), { recursive: true });
    await writeFile(component, `export const message = ${JSON.stringify(`${fixture.kind}-content`)};`);
    await writeFile(join(panel, fixture.kind === 'pipeline' ? 'creator-pipeline-bridge.ts' : `${fixture.kind}-bridge.ts`),
      `import { message } from './${fixture.name}/index'; globalThis.rendered = message;`);
    await mkdir(join(root, 'apps/worker'), { recursive: true });
    await writeFile(join(root, `apps/worker/${fixture.name}-resource.ts`), 'export {};');
  }

  type Manifest = { schema_version: number; panels: Array<{ panel: string; resource_version: string;
    sha256: string; bundle_version: string; raw_bytes: number; gzip_bytes: number;
    budget: { raw_bytes: number; gzip_bytes: number } }> };
  const first = await buildPanelManifest(root) as Manifest;
  const second = await buildPanelManifest(root) as Manifest;
  assert.deepEqual(second, first);
  assert.equal(first.schema_version, 1);
  assert.deepEqual(first.panels.map(panel => panel.panel), ['creator-pipeline', 'riff-home', 'riff-onboarding']);
  for (const entry of first.panels) {
    const fixture = fixtures.find(value => value.name === entry.panel)!;
    assert.equal(entry.resource_version, fixture.resource);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    assert.equal(entry.bundle_version, `sha256:${entry.sha256}`);
    assert.deepEqual(entry.budget, PANEL_BUDGETS[fixture.kind]);
    assert.ok(entry.raw_bytes <= entry.budget.raw_bytes);
    assert.ok(entry.gzip_bytes <= entry.budget.gzip_bytes);
    const source = await readFile(join(panel, `generated/${fixture.name}-bundle.ts`), 'utf8');
    const script = generatedScript(source, fixture.symbol);
    assert.equal(entry.raw_bytes, Buffer.byteLength(script));
    assert.equal(entry.gzip_bytes, gzipSync(Buffer.from(script), { level: 9 }).byteLength);
  }

  await writeFile(join(panel, 'riff-home/index.ts'), 'export const message = "changed-home-content";');
  const changed = await buildPanelManifest(root) as Manifest;
  assert.notEqual(changed.panels.find(panel => panel.panel === 'riff-home')?.sha256,
    first.panels.find(panel => panel.panel === 'riff-home')?.sha256);
  assert.equal(changed.panels.find(panel => panel.panel === 'riff-onboarding')?.sha256,
    first.panels.find(panel => panel.panel === 'riff-onboarding')?.sha256);
});
