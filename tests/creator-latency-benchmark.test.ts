import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import {
  aggregateBenchmarkSamples,
  assertSafeEvidenceReport,
  main,
  nearestRank,
  parseBenchmarkArgs,
  validateEvidenceReport,
  type BenchmarkDependencies,
  type BenchmarkSample,
} from '../scripts/creator-latency-benchmark.ts';

const developmentOrigin = 'https://kettle-stage2-development.g-baltramiejunas.workers.dev';
const allocationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const bundle = (character: string) => `sha256:${character.repeat(64)}`;
const manifest = {
  schema_version: 1,
  panels: [
    { panel: 'creator-pipeline', resource_version: 'creator-pipeline-v3', sha256: 'a'.repeat(64), raw_bytes: 10,
      gzip_bytes: 5, budget: { raw_bytes: 250_000, gzip_bytes: 75_000 }, bundle_version: bundle('a') },
    { panel: 'riff-home', resource_version: 'riff-home-v3', sha256: 'b'.repeat(64), raw_bytes: 20,
      gzip_bytes: 8, budget: { raw_bytes: 500_000, gzip_bytes: 110_000 }, bundle_version: bundle('b') },
    { panel: 'riff-onboarding', resource_version: 'riff-onboarding-v1', sha256: 'c'.repeat(64), raw_bytes: 30,
      gzip_bytes: 9, budget: { raw_bytes: 400_000, gzip_bytes: 85_000 }, bundle_version: bundle('c') },
  ],
};

function dependencies(overrides: Partial<BenchmarkDependencies> = {}) {
  const json: string[] = [];
  const summary: string[] = [];
  let preflights = 0;
  const result: BenchmarkDependencies & { json: string[]; summary: string[]; preflights: () => number } = {
    now: () => new Date('2026-10-11T10:00:00.000Z'),
    manifest,
    writeJson: value => json.push(value),
    writeSummary: value => summary.push(value),
    liveOperator: { preflight: async () => { preflights++; return { status: 'unavailable' }; } },
    ...overrides,
    json,
    summary,
    preflights: () => preflights,
  };
  return result;
}

test('module import has no side effect', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval',
    "await import('./scripts/creator-latency-benchmark.ts')"], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('parser accepts only the exact fixture and guarded live grammar without echoing input', () => {
  assert.deepEqual(parseBenchmarkArgs(['--fixture']), { mode: 'fixture' });
  assert.deepEqual(parseBenchmarkArgs([
    '--live', '--allocation-id', allocationId, '--development-origin', developmentOrigin,
    '--confirm-max-calls', '8',
  ]), { mode: 'live', allocationId, developmentOrigin, confirmMaxCalls: 8 });

  const unsafe = 'https://user:secret@production.example/path?token=raw';
  for (const args of [
    [], ['--fixture', '--live'], ['--fixture', '--allocation-id', allocationId], ['--fixture', '--fixture'],
    ['--unknown', unsafe], ['positional'], ['--live'],
    ['--live', '--allocation-id', 'not-a-uuid', '--development-origin', developmentOrigin, '--confirm-max-calls', '8'],
    ['--live', '--allocation-id', allocationId, '--development-origin', unsafe, '--confirm-max-calls', '8'],
    ['--live', '--allocation-id', allocationId, '--development-origin', developmentOrigin, '--confirm-max-calls', '7'],
  ]) {
    assert.throws(() => parseBenchmarkArgs(args), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^benchmark_error:[a-z_]+$/);
      assert.doesNotMatch(error.message, /secret|production|not-a-uuid|unknown/i);
      return true;
    });
  }
});

test('nearest-rank aggregation enforces independent p50 p95 and p99 sample floors', () => {
  assert.equal(nearestRank([50, 10, 40, 20, 30], 0.5), 30);
  assert.equal(nearestRank(Array.from({ length: 20 }, (_, index) => index + 1), 0.95), 19);
  assert.equal(nearestRank(Array.from({ length: 100 }, (_, index) => index + 1), 0.99), 99);

  const samples = (count: number): BenchmarkSample[] => Array.from({ length: count }, (_, index) => ({
    sample_ordinal: `sample-${String(index + 1).padStart(3, '0')}`,
    sample_class: 'fixture', proof_surface: 'local-process', scenario: 'cold_scan', operation: 'shell',
    metric: 'shell', value_ms: index + 1, clock_basis: 'monotonic', outcome: 'success', cache_state: 'none',
    fingerprint: 'home', bundle_version: bundle('b'), counters: { request_bytes: 0, response_bytes: 0, provider_calls: 0,
      provider_cache_hits: 0, credits: 0, attempt_delta: 0, trial_units_delta: 0, cash_reservation_delta: 0 },
  }));
  const at4 = aggregateBenchmarkSamples(samples(4))[0]!;
  const at5 = aggregateBenchmarkSamples(samples(5))[0]!;
  const at19 = aggregateBenchmarkSamples(samples(19))[0]!;
  const at20 = aggregateBenchmarkSamples(samples(20))[0]!;
  const at99 = aggregateBenchmarkSamples(samples(99))[0]!;
  const at100 = aggregateBenchmarkSamples(samples(100))[0]!;
  assert.deepEqual(at4.percentiles, {
    p50: { status: 'insufficient_for_percentile', value_ms: null },
    p95: { status: 'insufficient_for_percentile', value_ms: null },
    p99: { status: 'insufficient_for_percentile', value_ms: null },
  });
  assert.deepEqual(at5.raw_values_ms, [1, 2, 3, 4, 5]);
  assert.deepEqual(at5.percentiles.p50, { status: 'available', value_ms: 3 });
  assert.equal(at19.percentiles.p95.status, 'insufficient_for_percentile');
  assert.deepEqual(at20.percentiles.p95, { status: 'available', value_ms: 19 });
  assert.equal(at99.percentiles.p99.status, 'insufficient_for_percentile');
  assert.deepEqual(at100.percentiles.p99, { status: 'available', value_ms: 99 });
});

test('aggregation keeps every evidence boundary separate and excludes failures from n', () => {
  const base = {
    sample_class: 'fixture', proof_surface: 'local-process', scenario: 'cold_scan', operation: 'shell',
    metric: 'shell', value_ms: 10, clock_basis: 'monotonic', outcome: 'success', cache_state: 'none',
    fingerprint: 'home', bundle_version: bundle('b'), counters: { request_bytes: 0, response_bytes: 0, provider_calls: 0,
      provider_cache_hits: 0, credits: 0, attempt_delta: 0, trial_units_delta: 0, cash_reservation_delta: 0 },
  } as const;
  const dimensions = [
    {}, { proof_surface: 'local-workerd' }, { scenario: 'cold_recommendation' }, { operation: 'render' },
    { metric: 'first_safe_partial' }, { cache_state: 'hit' }, { outcome: 'failure' },
    { clock_basis: 'wall_clock', metric: 'queue_delay' }, { fingerprint: 'pipeline' },
  ];
  const aggregates = aggregateBenchmarkSamples(dimensions.map((change, index) => ({
    ...base, ...change, sample_ordinal: `sample-${String(index + 1).padStart(3, '0')}`,
  })) as BenchmarkSample[]);
  assert.equal(aggregates.length, dimensions.length);
  assert.equal(aggregates.find(value => value.outcome === 'failure')?.n, 0);
});

test('aggregation keeps different builds of the same resource separate', () => {
  const base = {
    sample_class: 'fixture', proof_surface: 'local-process', scenario: 'cold_scan', operation: 'shell',
    metric: 'shell', value_ms: 10, clock_basis: 'monotonic', outcome: 'success', cache_state: 'none',
    fingerprint: 'home', counters: { request_bytes: 0, response_bytes: 0, provider_calls: 0,
      provider_cache_hits: 0, credits: 0, attempt_delta: 0, trial_units_delta: 0, cash_reservation_delta: 0 },
  } as const;
  const samples = [bundle('a'), bundle('b')].map((bundleVersion, index) => ({
    ...base, sample_ordinal: `sample-${String(index + 1).padStart(3, '0')}`, bundle_version: bundleVersion,
  })) as BenchmarkSample[];

  const aggregates = aggregateBenchmarkSamples(samples);

  assert.equal(aggregates.length, 2);
  assert.deepEqual(aggregates.map(value => value.bundle_version), [bundle('a'), bundle('b')]);
});

test('fixture main emits one strict local report without selecting network or credentials', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network selected'); };
  process.env.RIFF_BENCHMARK_SECRET_FOR_TEST = 'must-not-be-read';
  try {
    const deps = dependencies();
    assert.equal(await main(['--fixture'], deps), 0);
    assert.equal(deps.preflights(), 0);
    assert.equal(deps.json.length, 1);
    assert.equal(deps.summary.length, 1);
    const report = validateEvidenceReport(JSON.parse(deps.json[0]!));
    assert.equal(report.sample_class, 'fixture');
    assert.equal(report.proof_surface, 'local-process');
    assert.equal(report.mode, 'fixture');
    assert.equal(report.guard_result.network_selected, false);
    assert.equal(report.guard_result.provider_free_reads_verified, true);
    assert.deepEqual(report.fingerprint.map((value: Record<string, unknown>) => value.bundle_version),
      [bundle('a'), bundle('b'), bundle('c')]);
    assert.doesNotMatch(`${deps.json[0]}${deps.summary[0]}`, /must-not-be-read|persisted-result-to-visible-paint.*under/i);
    assert.match(deps.summary[0]!, /terminal-observed-to-render.*local-controller-schedule/i);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.RIFF_BENCHMARK_SECRET_FOR_TEST;
  }
});

test('missing generated manifest fails closed with the local build instruction', async () => {
  const deps = dependencies({ manifest: undefined });
  assert.equal(await main(['--fixture'], deps), 2);
  assert.equal(deps.json.length, 0);
  assert.deepEqual(deps.summary, ['benchmark_error:panel_manifest_unavailable; run npm run build:panel']);
});

test('manifest evidence requires one coherent in-budget fingerprint for every panel', async () => {
  const duplicatePanel = structuredClone(manifest);
  duplicatePanel.panels[1] = structuredClone(duplicatePanel.panels[0]!);
  const mismatchedResource = structuredClone(manifest);
  mismatchedResource.panels[0]!.resource_version = 'riff-home-v3';
  const mismatchedBundle = structuredClone(manifest);
  mismatchedBundle.panels[0]!.bundle_version = bundle('d');
  const rawOverBudget = structuredClone(manifest);
  rawOverBudget.panels[0]!.raw_bytes = rawOverBudget.panels[0]!.budget.raw_bytes + 1;
  const gzipOverBudget = structuredClone(manifest);
  gzipOverBudget.panels[0]!.gzip_bytes = gzipOverBudget.panels[0]!.budget.gzip_bytes + 1;

  for (const candidate of [duplicatePanel, mismatchedResource, mismatchedBundle, rawOverBudget, gzipOverBudget]) {
    const deps = dependencies({ manifest: candidate });
    assert.equal(await main(['--fixture'], deps), 2);
    assert.equal(deps.json.length, 0);
    assert.deepEqual(deps.summary, ['benchmark_error:panel_manifest_unavailable; run npm run build:panel']);
  }
});

test('fixture report proves exact zero durable deltas for every provider-free read', async () => {
  const deps = dependencies();
  assert.equal(await main(['--fixture'], deps), 0);
  const report = JSON.parse(deps.json[0]!);
  const readScenarios = new Set(['catalog_first_page', 'catalog_repeat', 'reopen', 'status_read', 'result_read', 'render_only']);
  const reads = report.samples.filter((sample: Record<string, unknown>) => readScenarios.has(String(sample.scenario)));
  assert.equal(reads.length, 6);
  for (const sample of reads) assert.deepEqual(sample.counters, {
    request_bytes: 0, response_bytes: 0, provider_calls: 0, provider_cache_hits: 0, credits: 0,
    attempt_delta: 0, trial_units_delta: 0, cash_reservation_delta: 0,
  });
  assert.deepEqual(report.guard_result.read_deltas, reads.reduce((total: Record<string, number>, sample: any) => ({
    provider_calls: total.provider_calls + sample.counters.provider_calls,
    attempt_delta: total.attempt_delta + sample.counters.attempt_delta,
    trial_units_delta: total.trial_units_delta + sample.counters.trial_units_delta,
    cash_reservation_delta: total.cash_reservation_delta + sample.counters.cash_reservation_delta,
  }), { provider_calls: 0, attempt_delta: 0, trial_units_delta: 0, cash_reservation_delta: 0 }));

  const tampered = structuredClone(reads[0]);
  tampered.counters.provider_calls = 1;
  const rejected = dependencies({ fixtureSamples: [tampered] });
  assert.equal(await main(['--fixture'], rejected), 2);
  assert.equal(rejected.json.length, 0);
  assert.deepEqual(rejected.summary, ['benchmark_error:unsafe_report']);

  const duplicateScenario = reads.map((_: unknown, index: number) => ({
    ...structuredClone(reads[0]), sample_ordinal: `sample-${String(index + 1).padStart(3, '0')}`,
  }));
  for (const invalidReads of [duplicateScenario, reads.slice(0, -1)]) {
    const invalid = dependencies({ fixtureSamples: invalidReads });
    assert.equal(await main(['--fixture'], invalid), 2);
    assert.equal(invalid.json.length, 0);
    assert.deepEqual(invalid.summary, ['benchmark_error:unsafe_report']);
  }
});

test('report validation and recursive safety reject unknown fields, identifiers, URLs and secrets', async () => {
  const deps = dependencies();
  assert.equal(await main(['--fixture'], deps), 0);
  const valid = JSON.parse(deps.json[0]!);
  assert.doesNotThrow(() => assertSafeEvidenceReport(validateEvidenceReport(valid)));
  const attacks: Array<(candidate: any) => void> = [
    candidate => { candidate.unknown = true; },
    candidate => { candidate.samples[0].caption = 'source content'; },
    candidate => { candidate.limitations[0] = allocationId; },
    candidate => { candidate.limitations[0] = 'https://example.com/?token=secret'; },
    candidate => { candidate.limitations[0] = 'person@example.com'; },
    candidate => { candidate.limitations[0] = 'Bearer abc.def.ghi'; },
    candidate => { candidate.limitations[0] = 'Error: failure\n    at private.ts:1:1'; },
    candidate => { candidate.fingerprint[0].raw_bytes = -1; },
    candidate => { candidate.fingerprint[2] = structuredClone(candidate.fingerprint[0]); },
    candidate => { candidate.fingerprint[2].resource_version = 'riff-home-v3'; },
    candidate => { candidate.samples[0].bundle_version = bundle('d'); },
  ];
  for (const mutate of attacks) {
    const candidate = structuredClone(valid);
    mutate(candidate);
    assert.throws(() => assertSafeEvidenceReport(validateEvidenceReport(candidate)));
  }
});

test('live guards stop before preflight and valid guarded live mode prints only the redacted plan', async () => {
  for (const args of [
    ['--live'],
    ['--live', '--allocation-id', allocationId, '--development-origin', developmentOrigin, '--confirm-max-calls', '9'],
    ['--live', '--allocation-id', allocationId, '--development-origin', 'https://production.example', '--confirm-max-calls', '8'],
  ]) {
    const deps = dependencies();
    assert.equal(await main(args, deps), 2);
    assert.equal(deps.preflights(), 0);
    assert.equal(deps.json.length, 0);
    assert.equal(deps.summary.length, 1);
    assert.doesNotMatch(deps.summary[0]!, /aaaaaaaa|production|workers\.dev/i);
  }

  const events: string[] = [];
  const deps = dependencies({
    writeSummary: value => events.push(`write:${value}`),
    liveOperator: { preflight: async input => {
      events.push('preflight');
      assert.equal(input.allocation_id, allocationId);
      return { status: 'unavailable' };
    } },
  });
  assert.equal(await main([
    '--live', '--allocation-id', allocationId, '--development-origin', developmentOrigin, '--confirm-max-calls', '8',
  ], deps), 2);
  assert.equal(events[0]?.startsWith('write:{"plan":"single-managed-riff-run-v1"'), true);
  assert.equal(events[1], 'preflight');
  assert.equal(events[2], 'write:benchmark_error:operator_preflight_unavailable');
  assert.doesNotMatch(events.join('\n'), /aaaaaaaa|workers\.dev/i);
});

test('provider exceptions collapse to a fixed diagnostic and never leak content', async () => {
  const deps = dependencies({ liveOperator: { preflight: async () => {
    throw new Error(`token=private ${allocationId} ${developmentOrigin}`);
  } } });
  assert.equal(await main([
    '--live', '--allocation-id', allocationId, '--development-origin', developmentOrigin, '--confirm-max-calls', '8',
  ], deps), 2);
  assert.equal(deps.json.length, 0);
  assert.equal(deps.summary.at(-1), 'benchmark_error:transport_error');
  assert.doesNotMatch(deps.summary.join('\n'), /private|aaaaaaaa|workers\.dev|token=/i);
});

test('package lifecycle builds panel artifacts before the exact no-live benchmark command', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(packageJson.scripts['prebenchmark:creator'], 'npm run build:panel');
  assert.equal(packageJson.scripts['benchmark:creator'], 'tsx scripts/creator-latency-benchmark.ts');
  assert.doesNotMatch(packageJson.scripts['benchmark:creator'], /provider|allocation|provision|deploy|credential/i);
});
