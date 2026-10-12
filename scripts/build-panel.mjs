import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const repository = fileURLToPath(new URL('../', import.meta.url));

export const PANEL_BUDGETS = Object.freeze({
  'riff-home': Object.freeze({ raw_bytes: 500_000, gzip_bytes: 110_000 }),
  'riff-onboarding': Object.freeze({ raw_bytes: 400_000, gzip_bytes: 85_000 }),
  pipeline: Object.freeze({ raw_bytes: 250_000, gzip_bytes: 75_000 }),
});

const panels = {
  project: { name: 'project-review', symbol: 'projectReviewScript', fingerprintSymbol: 'projectReviewFingerprint', entry: 'apps/panel/bridge.ts', component: 'apps/panel/project-review.ts' },
  creator: { name: 'creator-review', symbol: 'creatorReviewScript', fingerprintSymbol: 'creatorReviewFingerprint', entry: 'apps/panel/creator-review-bridge.ts', component: 'apps/panel/creator-review.ts' },
  pipeline: { name: 'creator-pipeline', symbol: 'creatorPipelineScript', fingerprintSymbol: 'creatorPipelineFingerprint', resourceVersion: 'creator-pipeline-v5', entry: 'apps/panel/creator-pipeline-bridge.ts', component: 'apps/panel/creator-pipeline/index.ts' },
  'riff-onboarding': { name: 'riff-onboarding', symbol: 'riffOnboardingScript', fingerprintSymbol: 'riffOnboardingFingerprint', resourceVersion: 'riff-onboarding-v4', entry: 'apps/panel/riff-onboarding-bridge.ts', component: 'apps/panel/riff-onboarding/index.ts' },
  'riff-home': { name: 'riff-home', symbol: 'riffHomeScript', fingerprintSymbol: 'riffHomeFingerprint', resourceVersion: 'riff-home-v5', entry: 'apps/panel/riff-home-bridge.ts', component: 'apps/panel/riff-home/index.ts' },
};

/** No fixture or fallback component is emitted by this build. */
export async function buildPanel(root = repository, kind = 'project') {
  const panel = panels[kind];
  if (!panel) throw new Error('Unknown panel');
  const { name, symbol, fingerprintSymbol } = panel;
  const entry = resolve(root, panel.entry);
  const component = resolve(root, panel.component);
  const resource = resolve(root, `apps/worker/${name}-resource.ts`);
  const output = resolve(root, `apps/panel/generated/${name}-bundle.ts`);
  // Remove stale output even when a subsequent build fails.
  await rm(output, { force: true });
  if (!existsSync(entry) && !existsSync(resource)) {
    return { status: 'not-integrated' };
  }
  if (!existsSync(entry) || !existsSync(component)) {
    throw new Error(`Panel integration requires its ${name} bridge and component. No stub will be built.`);
  }
  const result = await build({
    absWorkingDir: root,
    entryPoints: [entry],
    outfile: `${name}.js`,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    write: false,
    metafile: true,
    minify: true,
    sourcemap: false,
    legalComments: 'inline',
    // Preserve esbuild's default escaping for code embedded in inline scripts.
    supported: { 'inline-script': true },
    logLevel: 'silent',
  });
  if (result.outputFiles.length !== 1 || !result.outputFiles[0].path.endsWith('.js')) {
    throw new Error('Panel must be one self-contained script. Inline styles/assets; do not emit separate CSS or asset files.');
  }
  if (Object.values(result.metafile.outputs).some(value => value.imports.some(item => item.external))) {
    throw new Error('Panel bundle must not retain external imports.');
  }
  const componentInput = Object.keys(result.metafile.inputs).some(path => resolve(root, path) === component);
  if (!componentInput) throw new Error(`Bridge must import the real ${name} component.`);
  if (kind === 'pipeline' || kind === 'riff-home') {
    const testOnly = Object.keys(result.metafile.inputs).find(path =>
      /(?:^|\/)(?:tests?|evals)(?:\/|$)/.test(path)
      || /(?:^|\/)(?:fixtures?|__fixtures__)(?:\/|\.|$)/i.test(path));
    if (testOnly) throw new Error(`${name} browser bundle crosses fixture/test boundary: ${testOnly}`);
  }
  if (kind === 'pipeline') {
    const browserSafePolicy = 'packages/contracts/tiktok-image-policy.ts';
    const forbidden = Object.keys(result.metafile.inputs).find(path => path !== browserSafePolicy
      && /(?:^|\/)(?:packages\/(?:contracts|application)|node_modules\/zod)\//.test(path));
    if (forbidden) throw new Error(`Creator pipeline browser bundle crosses server runtime boundary: ${forbidden}`);
  }
  const bytes = result.outputFiles[0].contents;
  const budget = PANEL_BUDGETS[kind];
  const fingerprint = panel.resourceVersion && budget ? Object.freeze({
    panel: name,
    resource_version: panel.resourceVersion,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    raw_bytes: bytes.length,
    gzip_bytes: gzipSync(bytes, { level: 9 }).byteLength,
    budget,
  }) : undefined;
  if (fingerprint && (fingerprint.raw_bytes > budget.raw_bytes || fingerprint.gzip_bytes > budget.gzip_bytes)) {
    throw new Error(`${name} exceeds its browser bundle budget`);
  }
  const versionedFingerprint = fingerprint ? { ...fingerprint, bundle_version: `sha256:${fingerprint.sha256}` } : undefined;
  const source = `// Generated by scripts/build-panel.mjs; do not edit or commit.\nexport const ${symbol}: string = ${JSON.stringify(result.outputFiles[0].text)};\n`+
    (versionedFingerprint ? `export const ${fingerprintSymbol} = Object.freeze(${JSON.stringify(versionedFingerprint)});\n` : '');
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, source);
    await rename(temporary, output);
  } finally {
    await rm(temporary, { force: true });
  }
  return { status: 'built', bytes: bytes.length, ...(versionedFingerprint ? { fingerprint: versionedFingerprint } : {}) };
}

export async function buildPanelManifest(root = repository) {
  const critical = ['pipeline', 'riff-onboarding', 'riff-home'];
  const built = await Promise.all(critical.map(kind => buildPanel(root, kind)));
  const manifest = Object.freeze({
    schema_version: 1,
    panels: Object.freeze(built.flatMap(result => result.status === 'built' && result.fingerprint ? [result.fingerprint] : [])
      .sort((left, right) => left.panel.localeCompare(right.panel))),
  });
  if (manifest.panels.length !== critical.length) throw new Error('Critical panel integration is incomplete');
  const output = resolve(root, 'apps/panel/generated/panel-manifest.ts');
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `// Generated by scripts/build-panel.mjs; do not edit or commit.\nexport const panelManifest = Object.freeze(${JSON.stringify(manifest)});\n`);
    await rename(temporary, output);
  } finally { await rm(temporary, { force: true }); }
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const kind of ['project', 'creator']) {
    const result = await buildPanel(repository, kind);
    console.log(result.status === 'built'
      ? `${kind} panel browser bundle: ${result.bytes} bytes.`
      : `${kind} panel integration not present; no browser artifact emitted.`);
  }
  const manifest = await buildPanelManifest(repository);
  for (const panel of manifest.panels) console.log(`${panel.panel} panel browser bundle: ${panel.raw_bytes} bytes (${panel.gzip_bytes} gzip), ${panel.bundle_version}.`);
}
