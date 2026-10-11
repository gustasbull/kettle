import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

export type BenchmarkMode = 'fixture' | 'live';
export type SampleClass = 'fixture' | 'historical-live' | 'current-live';
export type ProofSurface =
  | 'local-process'
  | 'local-workerd'
  | 'hosted-development-worker'
  | 'chatgpt-development';

const developmentOrigin = 'https://kettle-stage2-development.g-baltramiejunas.workers.dev';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256 = /^sha256:[a-f0-9]{64}$/;
const sampleOrdinal = /^sample-[0-9]{3}$/;
const integer = z.number().int().safe().nonnegative();

const sampleClasses = z.enum(['fixture', 'historical-live', 'current-live']);
const proofSurfaces = z.enum(['local-process', 'local-workerd', 'hosted-development-worker', 'chatgpt-development']);
const scenarios = z.enum([
  'cold_scan', 'cold_recommendation', 'telemetry_failure', 'catalog_first_page', 'catalog_repeat',
  'reopen', 'status_read', 'result_read', 'render_only',
]);
const operations = z.enum([
  'shell', 'start', 'queue', 'scan', 'seed_review', 'research', 'detail_enrichment',
  'persist', 'catalog', 'read', 'render',
]);
const metrics = z.enum([
  'shell', 'durable_acknowledgement', 'queue_delay', 'first_safe_partial', 'profile_feed',
  'seed_review', 'research', 'detail_enrichment', 'terminal_persistence', 'result_ready_to_paint',
]);
const clocks = z.enum(['monotonic', 'wall_clock']);
const outcomes = z.enum(['success', 'failure', 'ambiguous']);
const cacheStates = z.enum(['none', 'miss', 'hit', 'replay', 'unknown']);
const fingerprintNames = z.enum(['pipeline', 'home', 'onboarding']);
const requiredReadScenarios = [
  'catalog_first_page', 'catalog_repeat', 'reopen', 'status_read', 'result_read', 'render_only',
] as const;
const readScenarios = new Set<string>(requiredReadScenarios);

const countersSchema = z.strictObject({
  request_bytes: integer,
  response_bytes: integer,
  provider_calls: integer,
  provider_cache_hits: integer,
  credits: integer,
  attempt_delta: integer,
  trial_units_delta: integer,
  cash_reservation_delta: integer,
});

const sampleSchema = z.strictObject({
  sample_ordinal: z.string().regex(sampleOrdinal),
  sample_class: sampleClasses,
  proof_surface: proofSurfaces,
  scenario: scenarios,
  operation: operations,
  metric: metrics,
  value_ms: integer,
  clock_basis: clocks,
  outcome: outcomes,
  cache_state: cacheStates,
  fingerprint: fingerprintNames,
  bundle_version: z.string().regex(sha256),
  counters: countersSchema,
}).superRefine((sample, context) => {
  if ((sample.metric === 'queue_delay') !== (sample.clock_basis === 'wall_clock')) {
    context.addIssue({ code: 'custom', message: 'invalid_clock_basis' });
  }
  if (readScenarios.has(sample.scenario)) {
    for (const key of ['provider_calls', 'attempt_delta', 'trial_units_delta', 'cash_reservation_delta'] as const) {
      if (sample.counters[key] !== 0) context.addIssue({ code: 'custom', message: 'unsafe_read_delta' });
    }
  }
});

const percentileSchema = z.strictObject({
  status: z.enum(['available', 'insufficient_for_percentile']),
  value_ms: integer.nullable(),
}).superRefine((value, context) => {
  if ((value.status === 'available') !== (value.value_ms !== null)) {
    context.addIssue({ code: 'custom', message: 'invalid_percentile' });
  }
});

const aggregateSchema = z.strictObject({
  sample_class: sampleClasses,
  proof_surface: proofSurfaces,
  scenario: scenarios,
  operation: operations,
  metric: metrics,
  cache_state: cacheStates,
  outcome: outcomes,
  clock_basis: clocks,
  fingerprint: fingerprintNames,
  bundle_version: z.string().regex(sha256),
  n: integer,
  outcome_count: integer,
  raw_values_ms: z.array(integer).max(1_000),
  percentiles: z.strictObject({ p50: percentileSchema, p95: percentileSchema, p99: percentileSchema }),
});

const fingerprintResourceVersions = {
  pipeline: 'creator-pipeline-v4',
  home: 'riff-home-v4',
  onboarding: 'riff-onboarding-v3',
} as const;

const fingerprintSchema = z.strictObject({
  resource: fingerprintNames,
  resource_version: z.enum(['creator-pipeline-v4', 'riff-home-v4', 'riff-onboarding-v3']),
  bundle_version: z.string().regex(sha256),
  raw_bytes: integer.max(10_000_000),
  gzip_bytes: integer.max(10_000_000),
}).superRefine((fingerprint, context) => {
  if (fingerprint.resource_version !== fingerprintResourceVersions[fingerprint.resource]) {
    context.addIssue({ code: 'custom', message: 'invalid_resource_version' });
  }
});

const fingerprintListSchema = z.array(fingerprintSchema).length(3).superRefine((fingerprints, context) => {
  if (new Set(fingerprints.map(fingerprint => fingerprint.resource)).size !== 3) {
    context.addIssue({ code: 'custom', message: 'duplicate_or_missing_fingerprint' });
  }
});

const maxCallsSchema = z.strictObject({
  scrapecreators: integer.max(6),
  lightreel: integer.max(2),
  openai: z.literal(0),
  total: integer.max(8),
}).superRefine((value, context) => {
  if (value.total !== value.scrapecreators + value.lightreel + value.openai) {
    context.addIssue({ code: 'custom', message: 'invalid_call_total' });
  }
});

const planSchema = z.strictObject({
  plan: z.enum(['fixture-riff-scenarios-v1', 'single-managed-riff-run-v1']),
  samples: z.array(z.enum([
    'synthetic-cold-path', 'telemetry-validation', 'catalog-first-page', 'catalog-repeat',
    'reopen', 'status-read', 'result-read', 'render-only', 'canonical-profile', 'supplied-video',
  ])).min(1).max(10),
  max_calls: maxCallsSchema,
});

const guardSchema = z.strictObject({
  status: z.enum(['fixture_only', 'ready']),
  network_selected: z.boolean(),
  provider_free_reads_verified: z.boolean(),
  provider_free_read_samples: integer,
  read_deltas: z.strictObject({
    provider_calls: z.literal(0),
    attempt_delta: z.literal(0),
    trial_units_delta: z.literal(0),
    cash_reservation_delta: z.literal(0),
  }),
});

const limitations = z.enum([
  'fixture_only', 'no_network', 'no_provider_calls', 'no_hosted_supabase', 'no_deployment',
  'no_chatgpt_session', 'no_current_live_measurement', 'insufficient_for_p95', 'insufficient_for_p99',
  'persisted_result_to_paint_unverified', 'terminal_observed_to_render_only', 'local_controller_schedule_only',
]);

const reportSchema = z.strictObject({
  schema_version: z.literal(1),
  generated_at: z.iso.datetime({ offset: true }),
  mode: z.enum(['fixture', 'live']),
  sample_class: sampleClasses,
  proof_surface: proofSurfaces,
  fingerprint: fingerprintListSchema,
  plan: planSchema,
  samples: z.array(sampleSchema).min(1).max(1_000),
  aggregates: z.array(aggregateSchema).min(1).max(1_000),
  guard_result: guardSchema,
  limitations: z.array(limitations).min(1).max(20),
}).superRefine((report, context) => {
  const bundleVersions = new Map(report.fingerprint.map(value => [value.resource, value.bundle_version]));
  if (report.samples.some(sample => sample.sample_class !== report.sample_class
      || sample.proof_surface !== report.proof_surface)) {
    context.addIssue({ code: 'custom', message: 'mixed_evidence' });
  }
  if (report.samples.some(sample => bundleVersions.get(sample.fingerprint) !== sample.bundle_version)) {
    context.addIssue({ code: 'custom', message: 'sample_fingerprint_mismatch' });
  }
  if (report.aggregates.some(aggregate => aggregate.sample_class !== report.sample_class
      || aggregate.proof_surface !== report.proof_surface)) {
    context.addIssue({ code: 'custom', message: 'mixed_aggregates' });
  }
  if (report.aggregates.some(aggregate => bundleVersions.get(aggregate.fingerprint) !== aggregate.bundle_version)) {
    context.addIssue({ code: 'custom', message: 'aggregate_fingerprint_mismatch' });
  }
});

export type BenchmarkSample = z.infer<typeof sampleSchema>;
export type BenchmarkAggregate = z.infer<typeof aggregateSchema>;
export type EvidenceReport = z.infer<typeof reportSchema>;

export type BenchmarkOptions =
  | Readonly<{ mode: 'fixture' }>
  | Readonly<{ mode: 'live'; allocationId: string; developmentOrigin: string; confirmMaxCalls: 8 }>;

export type BenchmarkDependencies = Readonly<{
  now: () => Date;
  manifest: unknown;
  writeJson: (value: string) => void;
  writeSummary: (value: string) => void;
  fixtureSamples?: readonly BenchmarkSample[];
  liveOperator?: Readonly<{
    preflight: (input: Readonly<{
      allocation_id: string;
      development_origin: string;
      plan: typeof livePlan;
    }>) => Promise<Readonly<{ status: 'ready' | 'unavailable' | 'expired' | 'wrong_account' | 'insufficient_units' }>>;
  }>;
}>;

class BenchmarkError extends Error {
  constructor(readonly code: 'invalid_cli' | 'invalid_live_guard' | 'unsafe_report') {
    super(`benchmark_error:${code}`);
  }
}

const livePlan = Object.freeze({
  plan: 'single-managed-riff-run-v1' as const,
  samples: ['canonical-profile', 'supplied-video', 'catalog-repeat'] as const,
  max_calls: Object.freeze({ scrapecreators: 6, lightreel: 2, openai: 0, total: 8 }),
});

const fixturePlan = Object.freeze({
  plan: 'fixture-riff-scenarios-v1' as const,
  samples: ['synthetic-cold-path', 'telemetry-validation', 'catalog-first-page', 'catalog-repeat',
    'reopen', 'status-read', 'result-read', 'render-only'] as const,
  max_calls: Object.freeze({ scrapecreators: 0, lightreel: 0, openai: 0, total: 0 }),
});

export function parseBenchmarkArgs(args: readonly string[]): BenchmarkOptions {
  const flags = new Map<string, string | true>();
  const valueFlags = new Set(['--allocation-id', '--development-origin', '--confirm-max-calls']);
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (!['--fixture', '--live', ...valueFlags].includes(argument) || flags.has(argument)) {
      throw new BenchmarkError('invalid_cli');
    }
    if (valueFlags.has(argument)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new BenchmarkError('invalid_cli');
      flags.set(argument, value);
    } else flags.set(argument, true);
  }
  const fixture = flags.has('--fixture');
  const live = flags.has('--live');
  if (fixture === live) throw new BenchmarkError('invalid_cli');
  if (fixture) {
    if (flags.size !== 1) throw new BenchmarkError('invalid_cli');
    return { mode: 'fixture' };
  }
  if (flags.size !== 4) throw new BenchmarkError('invalid_live_guard');
  const allocationId = flags.get('--allocation-id');
  const origin = flags.get('--development-origin');
  const confirmation = flags.get('--confirm-max-calls');
  if (typeof allocationId !== 'string' || !uuid.test(allocationId)
      || typeof origin !== 'string' || origin !== developmentOrigin
      || typeof confirmation !== 'string' || confirmation !== '8') {
    throw new BenchmarkError('invalid_live_guard');
  }
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port
        || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error();
  } catch { throw new BenchmarkError('invalid_live_guard'); }
  return { mode: 'live', allocationId, developmentOrigin: origin, confirmMaxCalls: 8 };
}

export function nearestRank(values: readonly number[], percentile: 0.5 | 0.95 | 0.99): number {
  if (values.length === 0 || values.some(value => !Number.isSafeInteger(value) || value < 0)) {
    throw new BenchmarkError('unsafe_report');
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(percentile * sorted.length) - 1]!;
}

function percentile(values: readonly number[], minimum: number, rank: 0.5 | 0.95 | 0.99) {
  return values.length < minimum
    ? { status: 'insufficient_for_percentile' as const, value_ms: null }
    : { status: 'available' as const, value_ms: nearestRank(values, rank) };
}

export function aggregateBenchmarkSamples(samples: readonly BenchmarkSample[]): readonly BenchmarkAggregate[] {
  const parsed = z.array(sampleSchema).max(1_000).parse(samples);
  const groups = new Map<string, BenchmarkSample[]>();
  for (const sample of parsed) {
    const key = [sample.sample_class, sample.proof_surface, sample.scenario, sample.operation, sample.metric,
      sample.cache_state, sample.outcome, sample.clock_basis, sample.fingerprint, sample.bundle_version].join('|');
    const group = groups.get(key) ?? [];
    group.push(sample);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => {
    const first = group[0]!;
    const values = first.outcome === 'success' ? group.map(sample => sample.value_ms) : [];
    return aggregateSchema.parse({
      sample_class: first.sample_class,
      proof_surface: first.proof_surface,
      scenario: first.scenario,
      operation: first.operation,
      metric: first.metric,
      cache_state: first.cache_state,
      outcome: first.outcome,
      clock_basis: first.clock_basis,
      fingerprint: first.fingerprint,
      bundle_version: first.bundle_version,
      n: values.length,
      outcome_count: group.length,
      raw_values_ms: values,
      percentiles: {
        p50: percentile(values, 5, 0.5),
        p95: percentile(values, 20, 0.95),
        p99: percentile(values, 100, 0.99),
      },
    });
  });
}

export function validateEvidenceReport(candidate: unknown): EvidenceReport {
  const parsed = reportSchema.safeParse(candidate);
  if (!parsed.success) throw new BenchmarkError('unsafe_report');
  return parsed.data;
}

const unsafeString = /https?:\/\/|\b(?:bearer|authorization|cookie|secret|token|password|api[-_]?key|service[-_]?role|caption|transcript|prompt|receipt|stack|error:)\b|-----begin|\S+@\S+|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

export function assertSafeEvidenceReport(report: EvidenceReport): void {
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      if (unsafeString.test(value)) throw new BenchmarkError('unsafe_report');
      return;
    }
    if (Array.isArray(value)) { for (const item of value) walk(item); return; }
    if (value && typeof value === 'object') for (const item of Object.values(value)) walk(item);
  };
  walk(validateEvidenceReport(report));
}

const zeroCounters = Object.freeze({
  request_bytes: 0, response_bytes: 0, provider_calls: 0, provider_cache_hits: 0,
  credits: 0, attempt_delta: 0, trial_units_delta: 0, cash_reservation_delta: 0,
});

function fixtureSamples(bundleVersions: Readonly<Record<z.infer<typeof fingerprintNames>, string>>): BenchmarkSample[] {
  const definitions = [
    ['shell', 'shell', 'cold_scan', 'home', [12, 9, 11, 10, 8]],
    ['durable_acknowledgement', 'start', 'cold_scan', 'home', [42, 38, 41, 39, 40]],
    ['queue_delay', 'queue', 'cold_scan', 'pipeline', [170, 160, 180, 150, 165]],
    ['first_safe_partial', 'scan', 'cold_scan', 'pipeline', [420, 390, 410, 405, 400]],
    ['profile_feed', 'scan', 'cold_scan', 'pipeline', [720, 690, 710, 700, 705]],
    ['seed_review', 'seed_review', 'cold_recommendation', 'pipeline', [530, 520, 540, 515, 525]],
    ['research', 'research', 'cold_recommendation', 'pipeline', [840, 810, 830, 820, 825]],
    ['detail_enrichment', 'detail_enrichment', 'cold_recommendation', 'pipeline', [610, 590, 600, 605, 595]],
    ['terminal_persistence', 'persist', 'cold_recommendation', 'pipeline', [35, 31, 34, 32, 33]],
    ['result_ready_to_paint', 'render', 'cold_recommendation', 'pipeline', [18, 15, 17, 16, 14]],
  ] as const;
  let ordinal = 0;
  const result: BenchmarkSample[] = [];
  for (const [metric, operation, scenario, fingerprint, values] of definitions) {
    for (const value of values) {
      ordinal++;
      result.push(sampleSchema.parse({
        sample_ordinal: `sample-${String(ordinal).padStart(3, '0')}`,
        sample_class: 'fixture', proof_surface: 'local-process', scenario, operation, metric, value_ms: value,
        clock_basis: metric === 'queue_delay' ? 'wall_clock' : 'monotonic', outcome: 'success',
        cache_state: scenario === 'cold_scan' || scenario === 'cold_recommendation' ? 'miss' : 'none',
        fingerprint, bundle_version: bundleVersions[fingerprint],
        counters: metric === 'profile_feed'
          ? { ...zeroCounters, request_bytes: 64, response_bytes: 2_048, provider_calls: 1, credits: 1,
            attempt_delta: 1, trial_units_delta: 1 }
          : metric === 'research'
            ? { ...zeroCounters, request_bytes: 128, response_bytes: 4_096, provider_calls: 1, credits: 1,
              attempt_delta: 1, trial_units_delta: 1 }
            : zeroCounters,
      }));
    }
  }
  ordinal++;
  result.push(sampleSchema.parse({
    sample_ordinal: `sample-${String(ordinal).padStart(3, '0')}`,
    sample_class: 'fixture', proof_surface: 'local-process', scenario: 'telemetry_failure', operation: 'research',
    metric: 'research', value_ms: 25, clock_basis: 'monotonic', outcome: 'ambiguous', cache_state: 'unknown',
    fingerprint: 'pipeline', bundle_version: bundleVersions.pipeline,
    counters: { ...zeroCounters, provider_calls: 1, credits: 1, attempt_delta: 1,
      trial_units_delta: 1 },
  }));
  const reads = [
    ['catalog_first_page', 'catalog', 'shell', 'hit', 'home', 7],
    ['catalog_repeat', 'catalog', 'shell', 'hit', 'home', 4],
    ['reopen', 'read', 'durable_acknowledgement', 'replay', 'home', 9],
    ['status_read', 'read', 'first_safe_partial', 'replay', 'pipeline', 6],
    ['result_read', 'read', 'result_ready_to_paint', 'replay', 'pipeline', 11],
    ['render_only', 'render', 'result_ready_to_paint', 'hit', 'pipeline', 3],
  ] as const;
  for (const [scenario, operation, metric, cacheState, fingerprint, value] of reads) {
    ordinal++;
    result.push(sampleSchema.parse({
      sample_ordinal: `sample-${String(ordinal).padStart(3, '0')}`,
      sample_class: 'fixture', proof_surface: 'local-process', scenario, operation, metric, value_ms: value,
      clock_basis: 'monotonic', outcome: 'success', cache_state: cacheState, fingerprint,
      bundle_version: bundleVersions[fingerprint], counters: zeroCounters,
    }));
  }
  return result;
}

const panelResourceVersions = {
  'creator-pipeline': 'creator-pipeline-v4',
  'riff-home': 'riff-home-v4',
  'riff-onboarding': 'riff-onboarding-v3',
} as const;

const manifestPanelSchema = z.strictObject({
  panel: z.enum(['creator-pipeline', 'riff-home', 'riff-onboarding']),
  resource_version: z.enum(['creator-pipeline-v4', 'riff-home-v4', 'riff-onboarding-v3']),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  raw_bytes: integer.max(10_000_000),
  gzip_bytes: integer.max(10_000_000),
  budget: z.strictObject({ raw_bytes: integer, gzip_bytes: integer }),
  bundle_version: z.string().regex(sha256),
}).superRefine((panel, context) => {
  if (panel.resource_version !== panelResourceVersions[panel.panel]) {
    context.addIssue({ code: 'custom', message: 'invalid_resource_version' });
  }
  if (panel.bundle_version !== `sha256:${panel.sha256}`) {
    context.addIssue({ code: 'custom', message: 'invalid_bundle_version' });
  }
  if (panel.raw_bytes > panel.budget.raw_bytes || panel.gzip_bytes > panel.budget.gzip_bytes) {
    context.addIssue({ code: 'custom', message: 'bundle_budget_exceeded' });
  }
});

const manifestSchema = z.strictObject({
  schema_version: z.literal(1),
  panels: z.array(manifestPanelSchema).length(3).superRefine((panels, context) => {
    if (new Set(panels.map(panel => panel.panel)).size !== 3) {
      context.addIssue({ code: 'custom', message: 'duplicate_or_missing_panel' });
    }
  }),
});

function fingerprints(manifest: unknown): EvidenceReport['fingerprint'] {
  const parsed = manifestSchema.safeParse(manifest);
  if (!parsed.success) throw new BenchmarkError('unsafe_report');
  const resource = { 'creator-pipeline': 'pipeline', 'riff-home': 'home', 'riff-onboarding': 'onboarding' } as const;
  return parsed.data.panels.map(panel => fingerprintSchema.parse({
    resource: resource[panel.panel], resource_version: panel.resource_version, bundle_version: panel.bundle_version,
    raw_bytes: panel.raw_bytes, gzip_bytes: panel.gzip_bytes,
  }));
}

function fixtureReport(dependencies: BenchmarkDependencies, fingerprint: EvidenceReport['fingerprint']): EvidenceReport {
  const bundleVersions = Object.fromEntries(fingerprint.map(value => [value.resource, value.bundle_version])) as
    Record<z.infer<typeof fingerprintNames>, string>;
  const samples = z.array(sampleSchema).min(1).max(1_000)
    .parse([...(dependencies.fixtureSamples ?? fixtureSamples(bundleVersions))]);
  const reads = samples.filter(sample => readScenarios.has(sample.scenario));
  const readScenarioCounts = new Map<string, number>();
  for (const sample of reads) {
    readScenarioCounts.set(sample.scenario, (readScenarioCounts.get(sample.scenario) ?? 0) + 1);
  }
  const readDeltas = reads.reduce((total, sample) => ({
    provider_calls: total.provider_calls + sample.counters.provider_calls,
    attempt_delta: total.attempt_delta + sample.counters.attempt_delta,
    trial_units_delta: total.trial_units_delta + sample.counters.trial_units_delta,
    cash_reservation_delta: total.cash_reservation_delta + sample.counters.cash_reservation_delta,
  }), { provider_calls: 0, attempt_delta: 0, trial_units_delta: 0, cash_reservation_delta: 0 });
  const readsVerified = reads.length === requiredReadScenarios.length
    && requiredReadScenarios.every(scenario => readScenarioCounts.get(scenario) === 1)
    && Object.values(readDeltas).every(value => value === 0);
  if (!readsVerified) throw new BenchmarkError('unsafe_report');
  const report = validateEvidenceReport({
    schema_version: 1,
    generated_at: dependencies.now().toISOString(),
    mode: 'fixture',
    sample_class: 'fixture',
    proof_surface: 'local-process',
    fingerprint,
    plan: fixturePlan,
    samples,
    aggregates: aggregateBenchmarkSamples(samples),
    guard_result: {
      status: 'fixture_only', network_selected: false, provider_free_reads_verified: readsVerified,
      provider_free_read_samples: reads.length, read_deltas: readDeltas,
    },
    limitations: [
      'fixture_only', 'no_network', 'no_provider_calls', 'no_hosted_supabase', 'no_deployment',
      'no_chatgpt_session', 'no_current_live_measurement', 'insufficient_for_p95', 'insufficient_for_p99',
      'persisted_result_to_paint_unverified', 'terminal_observed_to_render_only', 'local_controller_schedule_only',
    ],
  });
  assertSafeEvidenceReport(report);
  return report;
}

export async function main(args: readonly string[], dependencies: BenchmarkDependencies): Promise<number> {
  let options: BenchmarkOptions;
  try { options = parseBenchmarkArgs(args); }
  catch (error) {
    dependencies.writeSummary(error instanceof BenchmarkError ? error.message : 'benchmark_error:invalid_cli');
    return 2;
  }
  if (options.mode === 'live') {
    dependencies.writeSummary(JSON.stringify(livePlan));
    if (!dependencies.liveOperator) {
      dependencies.writeSummary('benchmark_error:operator_preflight_unavailable');
      return 2;
    }
    try {
      const preflight = await dependencies.liveOperator.preflight({
        allocation_id: options.allocationId, development_origin: options.developmentOrigin, plan: livePlan,
      });
      if (preflight.status !== 'ready') {
        dependencies.writeSummary('benchmark_error:operator_preflight_unavailable');
        return 2;
      }
      dependencies.writeSummary('benchmark_error:live_execution_unavailable');
      return 2;
    } catch {
      dependencies.writeSummary('benchmark_error:transport_error');
      return 2;
    }
  }
  try {
    let fingerprint: EvidenceReport['fingerprint'];
    try { fingerprint = fingerprints(dependencies.manifest); }
    catch {
      dependencies.writeSummary('benchmark_error:panel_manifest_unavailable; run npm run build:panel');
      return 2;
    }
    const report = fixtureReport(dependencies, fingerprint);
    dependencies.writeJson(JSON.stringify(report));
    dependencies.writeSummary('fixture local-process: terminal-observed-to-render and local-controller-schedule only; persisted-result-to-paint unverified');
    return 0;
  } catch {
    dependencies.writeSummary('benchmark_error:unsafe_report');
    return 2;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const run = async () => {
    try {
      const generatedManifestPath = '../apps/panel/generated/panel-manifest.ts';
      const generated = await import(generatedManifestPath) as { panelManifest?: unknown };
      return main(process.argv.slice(2), {
        now: () => new Date(), manifest: generated.panelManifest,
        writeJson: value => console.log(value),
        writeSummary: value => console.error(value),
      });
    } catch {
      console.error('benchmark_error:panel_manifest_unavailable; run npm run build:panel');
      return 2;
    }
  };
  run().then(code => { process.exitCode = code; }, () => { process.exitCode = 2; });
}
