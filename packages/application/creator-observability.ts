export type CreatorObservationFields = {
  stage: 'request_receipt' | 'mcp_route' | 'auth_metadata' | 'auth_jwks' | 'identity_lookup'
    | 'application_operation' | 'supabase_rpc' | 'workflow_dispatch' | 'queue_to_running'
    | 'provider_reservation' | 'provider_http' | 'sanitization' | 'receipt_persistence'
    | 'checkpoint_persistence' | 'catalog_persistence' | 'attempt_outcome_persistence' | 'terminal_save' | 'poll_observation' | 'panel_render';
  clock: 'monotonic' | 'wall';
  status?: 'ok' | 'error' | 'timeout' | 'rejected' | 'replay' | 'ambiguous' | 'unavailable';
  duration_ms?: number;
  provider?: 'scrapecreators' | 'lightreel' | 'openai';
  operation?: 'profile' | 'feed' | 'research' | 'poll' | 'video' | 'generate'
    | 'start' | 'find' | 'list' | 'read' | 'dispatch' | 'reserve' | 'persist' | 'render';
  endpoint?: 'worker_health' | 'worker_home' | 'worker_mcp' | 'worker_oauth' | 'worker_not_found'
    | 'mcp_transport' | 'auth_discovery' | 'auth_jwks' | 'identity_rpc'
    | 'riff_creator_find' | 'riff_creator_start' | 'riff_creator_list' | 'creator_pipeline_rpc' | 'riff_video_catalog_rpc'
    | 'workflow_create' | 'workflow_get' | 'workflow_status'
    | 'scrapecreators_profile' | 'scrapecreators_feed' | 'scrapecreators_video'
    | 'lightreel_research' | 'lightreel_poll' | 'openai_responses'
    | 'panel_home' | 'panel_onboarding' | 'panel_pipeline';
  cache_state?: 'none' | 'hit' | 'miss' | 'replay' | 'ambiguous' | 'unknown';
  http_status?: number;
  request_bytes?: number;
  response_bytes?: number;
  item_count?: number;
  resource_version?: 'riff-home-v4' | 'riff-onboarding-v3' | 'creator-pipeline-v4';
  bundle_version?: string;
};

export type CreatorCorrelation = { trace_id: string } | { request_id: string } | { job_id: string };

export interface CreatorLatencyObserver {
  record(fields: CreatorObservationFields & { status: NonNullable<CreatorObservationFields['status']>; duration_ms: number }): unknown;
  measure<T>(fields: Omit<CreatorObservationFields, 'status' | 'duration_ms'>, operation: () => Promise<T>): Promise<T>;
  scope?(correlation: CreatorCorrelation): CreatorLatencyObserver;
}

export function observed<T>(observer: CreatorLatencyObserver | undefined,
  fields: Omit<CreatorObservationFields, 'status' | 'duration_ms'>, operation: () => Promise<T>): Promise<T> {
  return observer ? observer.measure(fields, operation) : operation();
}
