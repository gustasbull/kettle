import { z } from 'zod';
import type { CreatorCorrelation, CreatorLatencyObserver } from '../../packages/application/creator-observability.ts';

const UUID = z.uuid();
const stages = z.enum([
  'request_receipt', 'mcp_route', 'auth_metadata', 'auth_jwks', 'identity_lookup',
  'application_operation', 'supabase_rpc', 'workflow_dispatch', 'queue_to_running',
  'provider_reservation', 'provider_http', 'sanitization', 'receipt_persistence',
  'checkpoint_persistence', 'catalog_persistence', 'attempt_outcome_persistence', 'terminal_save', 'poll_observation', 'panel_render',
]);
const statuses = z.enum(['ok', 'error', 'timeout', 'rejected', 'replay', 'ambiguous', 'unavailable']);
const providers = z.enum(['scrapecreators', 'lightreel', 'openai']);
const operations = z.enum([
  'profile', 'feed', 'research', 'poll', 'video', 'generate',
  'start', 'find', 'list', 'read', 'dispatch', 'reserve', 'persist', 'render',
]);
const endpoints = z.enum([
  'worker_health', 'worker_home', 'worker_mcp', 'worker_oauth', 'worker_not_found',
  'mcp_transport', 'auth_discovery', 'auth_jwks', 'identity_rpc',
  'riff_creator_find', 'riff_creator_start', 'riff_creator_list',
  'creator_pipeline_rpc', 'riff_video_catalog_rpc', 'workflow_create', 'workflow_get', 'workflow_status',
  'scrapecreators_profile', 'scrapecreators_feed', 'scrapecreators_video',
  'lightreel_research', 'lightreel_poll', 'openai_responses',
  'panel_home', 'panel_onboarding', 'panel_pipeline',
]);
const cacheStates = z.enum(['none', 'hit', 'miss', 'replay', 'ambiguous', 'unknown']);
const safeInteger = (maximum: number) => z.number().finite().nonnegative().max(maximum)
  .transform(value => Math.round(value));
const version = z.enum(['riff-home-v6', 'riff-onboarding-v5', 'creator-pipeline-v6']);
const bundleVersion = z.string().regex(/^sha256:[a-f0-9]{64}$/);

const eventSchema = z.strictObject({
  event: z.literal('creator_latency'),
  trace_id: UUID.optional(),
  request_id: UUID.optional(),
  job_id: UUID.optional(),
  stage: stages,
  status: statuses,
  clock: z.enum(['monotonic', 'wall']),
  duration_ms: safeInteger(86_400_000),
  provider: providers.optional(),
  operation: operations.optional(),
  endpoint: endpoints.optional(),
  cache_state: cacheStates.optional(),
  http_status: z.number().int().min(100).max(599).optional(),
  request_bytes: safeInteger(10_000_000).optional(),
  response_bytes: safeInteger(10_000_000).optional(),
  item_count: z.number().int().nonnegative().max(10_000).optional(),
  resource_version: version.optional(),
  bundle_version: bundleVersion.optional(),
}).superRefine((event, context) => {
  if (event.request_id !== undefined && event.job_id !== undefined) {
    context.addIssue({ code: 'custom', message: 'At most one durable correlation ID is allowed' });
  }
  if (event.trace_id === undefined && event.request_id === undefined && event.job_id === undefined) {
    context.addIssue({ code: 'custom', message: 'A validated correlation ID is required' });
  }
  if ((event.stage === 'queue_to_running') !== (event.clock === 'wall')) {
    context.addIssue({ code: 'custom', message: 'Only queue elapsed uses a wall clock' });
  }
});

export type CreatorTelemetryEvent = z.infer<typeof eventSchema>;
export type CreatorTelemetryMeasureFields = Omit<CreatorTelemetryEvent, 'event' | 'status' | 'duration_ms'>;

export interface CreatorTelemetry {
  record(candidate: unknown): CreatorTelemetryEvent | undefined;
  measure<T>(fields: CreatorTelemetryMeasureFields, operation: () => Promise<T>): Promise<T>;
  scope(correlation: CreatorCorrelation): CreatorLatencyObserver;
}

/**
 * The only runtime telemetry serializer. It constructs a fresh allowlisted
 * event and never serializes caller objects, exceptions, headers, or content.
 */
export function createCreatorTelemetry(options: {
  emit?: (event: CreatorTelemetryEvent) => void;
  now?: () => number;
} = {}): CreatorTelemetry {
  const emit = options.emit ?? (event => console.log(JSON.stringify(event)));
  const now = options.now ?? (() => performance.now());
  const record = (candidate: unknown) => {
    const parsed = eventSchema.safeParse(candidate);
    if (!parsed.success) return undefined;
    const event = Object.freeze({ ...parsed.data });
    try { emit(event); } catch { /* Observation cannot alter product behavior. */ }
    return event;
  };
  const bind = (correlation: CreatorCorrelation): CreatorLatencyObserver => ({
    record(fields) { return record({ ...fields, ...correlation, event: 'creator_latency' }); },
    measure(fields, operation) { return telemetry.measure({ ...fields, ...correlation }, operation); },
    scope(next) {
      const trace = 'trace_id' in correlation ? { trace_id: correlation.trace_id } : {};
      return bind({ ...trace, ...next } as CreatorCorrelation);
    },
  });
  const telemetry: CreatorTelemetry = {
    record,
    async measure(fields, operation) {
      const started = now();
      try {
        const result = await operation();
        record({ ...fields, event: 'creator_latency', status: 'ok',
          duration_ms: Math.max(0, now() - started) });
        return result;
      } catch (error) {
        record({ ...fields, event: 'creator_latency', status: 'error',
          duration_ms: Math.max(0, now() - started) });
        throw error;
      }
    },
    scope: bind,
  };
  return telemetry;
}
