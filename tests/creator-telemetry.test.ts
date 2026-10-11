import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCreatorTelemetry,
  type CreatorTelemetryEvent,
} from '../apps/worker/creator-telemetry.ts';
import { createPanelPerformance } from '../apps/panel/creator-performance.ts';

const requestId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';
const traceId = '33333333-3333-4333-8333-333333333333';

test('creator telemetry emits only a frozen allowlisted event with integer monotonic duration', () => {
  const emitted: CreatorTelemetryEvent[] = [];
  const telemetry = createCreatorTelemetry({ emit: event => emitted.push(event), now: () => 0 });
  const event = telemetry.record({
    event: 'creator_latency', request_id: requestId, stage: 'provider_http', status: 'ok',
    clock: 'monotonic', duration_ms: 12.6, provider: 'scrapecreators', operation: 'feed',
    endpoint: 'scrapecreators_feed', http_status: 200, request_bytes: 48,
    response_bytes: 1_024, item_count: 3, cache_state: 'miss',
    resource_version: 'riff-home-v4', bundle_version: `sha256:${'a'.repeat(64)}`,
  });

  assert.deepEqual(event, {
    event: 'creator_latency', request_id: requestId, stage: 'provider_http', status: 'ok',
    clock: 'monotonic', duration_ms: 13, provider: 'scrapecreators', operation: 'feed',
    endpoint: 'scrapecreators_feed', http_status: 200, request_bytes: 48,
    response_bytes: 1_024, item_count: 3, cache_state: 'miss',
    resource_version: 'riff-home-v4', bundle_version: `sha256:${'a'.repeat(64)}`,
  });
  assert.equal(Object.isFrozen(event), true);
  assert.equal(Object.getPrototypeOf(event), Object.prototype);
  assert.deepEqual(emitted, [event]);
});

test('creator telemetry fails closed for arbitrary, credential-bearing, malformed, or uncorrelated input', () => {
  const emitted: CreatorTelemetryEvent[] = [];
  const telemetry = createCreatorTelemetry({ emit: event => emitted.push(event) });
  const base = {
    event: 'creator_latency', request_id: requestId, stage: 'application_operation',
    status: 'ok', clock: 'monotonic', duration_ms: 1,
  } as const;
  const unsafe: unknown[] = [
    { ...base, source_url: 'https://www.tiktok.com/@private/video/1' },
    { ...base, caption: 'raw provider caption' },
    { ...base, token: 'Bearer secret-token' },
    { ...base, arbitrary: { body: 'raw provider response' } },
    { ...base, error: new Error('credential=secret') },
    { ...base, provider: 'unknown-provider' },
    { ...base, stage: 'unknown-stage' },
    { ...base, status: 'unknown-status' },
    { ...base, endpoint: 'https://api.scrapecreators.com/v1/private' },
    { ...base, request_id: 'Bearer secret-token' },
    { ...base, job_id: jobId },
    { ...base, duration_ms: -1 },
    { ...base, response_bytes: Number.MAX_SAFE_INTEGER + 1 },
    { ...base, item_count: 0.5 },
    { ...base, resource_version: 'service-role-key' },
    { ...base, bundle_version: 'service-role-key' },
    ['not', 'plain'],
    new Request('https://example.com', { headers: { authorization: 'Bearer secret' } }),
  ];

  for (const candidate of unsafe) assert.equal(telemetry.record(candidate), undefined);
  assert.deepEqual(emitted, []);
  assert.doesNotMatch(JSON.stringify(emitted), /tiktok|caption|secret|provider response|authorization/i);
});

test('creator telemetry labels queue elapsed as wall-clock and rejects a monotonic claim', () => {
  const emitted: CreatorTelemetryEvent[] = [];
  const telemetry = createCreatorTelemetry({ emit: event => emitted.push(event) });
  assert.equal(telemetry.record({
    event: 'creator_latency', job_id: jobId, stage: 'queue_to_running', status: 'ok',
    clock: 'monotonic', duration_ms: 25,
  }), undefined);
  assert.ok(telemetry.record({
    event: 'creator_latency', job_id: jobId, stage: 'queue_to_running', status: 'ok',
    clock: 'wall', duration_ms: 25,
  }));
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0]?.clock, 'wall');
});

test('creator telemetry measure emits once and preserves resolved and rejected behavior without exception text', async () => {
  const emitted: CreatorTelemetryEvent[] = [];
  const ticks = [10.2, 14.8, 20, 23];
  const telemetry = createCreatorTelemetry({ emit: event => emitted.push(event), now: () => ticks.shift()! });
  const fields = {
    request_id: requestId, stage: 'auth_metadata', clock: 'monotonic', cache_state: 'miss',
  } as const;

  assert.equal(await telemetry.measure(fields, async () => 'value'), 'value');
  const failure = new Error('raw provider body with token secret');
  await assert.rejects(telemetry.measure(fields, async () => { throw failure; }), error => error === failure);

  assert.deepEqual(emitted.map(event => ({ status: event.status, duration_ms: event.duration_ms })), [
    { status: 'ok', duration_ms: 5 },
    { status: 'error', duration_ms: 3 },
  ]);
  assert.doesNotMatch(JSON.stringify(emitted), /raw provider|token|secret/i);
});

test('creator telemetry creates a correlation-bound observer without exposing caller data', async () => {
  const emitted: CreatorTelemetryEvent[] = [];
  const ticks = [1, 4];
  const telemetry = createCreatorTelemetry({ emit: event => emitted.push(event), now: () => ticks.shift()! });
  const observer = telemetry.scope({ job_id: jobId });
  assert.equal(await observer.measure({
    stage: 'receipt_persistence', clock: 'monotonic', provider: 'lightreel', operation: 'persist',
  }, async () => 42), 42);
  assert.deepEqual(emitted, [{
    event: 'creator_latency', job_id: jobId, stage: 'receipt_persistence', status: 'ok',
    clock: 'monotonic', duration_ms: 3, provider: 'lightreel', operation: 'persist',
  }]);
});

test('checkpoint persistence telemetry accepts only content-free counts and correlation',()=>{
 const emitted:CreatorTelemetryEvent[]=[];const telemetry=createCreatorTelemetry({emit:event=>emitted.push(event)});
 assert.ok(telemetry.record({event:'creator_latency',job_id:jobId,stage:'checkpoint_persistence',status:'ok',
  clock:'monotonic',duration_ms:2,operation:'persist',item_count:3}));
 const base={event:'creator_latency',job_id:jobId,stage:'checkpoint_persistence',status:'ok',clock:'monotonic',duration_ms:2,operation:'persist'} as const;
 for(const unsafe of [{progress:{kind:'scan'}},{url:'https://www.tiktok.com/@private'},{caption:'private'},
  {key:'scan:feed:0'},{account_id:requestId}])assert.equal(telemetry.record({...base,...unsafe}),undefined);
 assert.equal(emitted.length,1);assert.deepEqual(emitted[0]?.item_count,3);
});

test('HTTP traces stay distinct while logical request scope hands off to job scope', async () => {
  const emitted: CreatorTelemetryEvent[] = [];
  let now = 0;
  const telemetry = createCreatorTelemetry({ emit: event => emitted.push(event), now: () => now++ });
  const trace = telemetry.scope({ trace_id: traceId } as never);
  const request = (trace as typeof trace & { scope?: typeof telemetry.scope }).scope?.({ request_id: requestId });
  assert.ok(request, 'a request-local observer can be rebound after the logical request ID is validated');
  await request.measure({ stage: 'application_operation', clock: 'monotonic', operation: 'start' }, async () => 'stored');
  const job = (request as typeof request & { scope?: typeof telemetry.scope }).scope?.({ job_id: jobId });
  assert.ok(job, 'a logical request observer can hand off to the returned durable job ID');
  await job.measure({ stage: 'workflow_dispatch', clock: 'monotonic', operation: 'dispatch' }, async () => 'sent');

  assert.deepEqual(emitted.map(event => ({ trace_id: event.trace_id, request_id: event.request_id, job_id: event.job_id })), [
    { trace_id: traceId, request_id: requestId, job_id: undefined },
    { trace_id: traceId, request_id: undefined, job_id: jobId },
  ]);
});

test('panel performance measurements remain browser-local and carry only the served fingerprint', () => {
  const entries: Array<Record<string, unknown>> = [];
  let now = 5;
  const performance = {
    now: () => now,
    measure: (name: string, options: Record<string, unknown>) => { entries.push({ name, ...options }); return {} as PerformanceMeasure; },
  };
  const tracker = createPanelPerformance(performance, {
    resource_version: 'riff-home-v4', bundle_version: `sha256:${'b'.repeat(64)}`,
  });
  const finish = tracker.start('panel_render');
  now = 17.4;
  finish('ok');
  assert.deepEqual(entries, [{
    name: 'riff:panel_render', start: 5, end: 17.4,
    detail: { stage: 'panel_render', status: 'ok', resource_version: 'riff-home-v4', bundle_version: `sha256:${'b'.repeat(64)}` },
  }]);
  assert.doesNotMatch(JSON.stringify(entries), /source_url|caption|token|email|account_id/i);
});
