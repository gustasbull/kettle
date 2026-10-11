import type { CreatorRepository } from '../application/creator-operations.ts';
import { createSupabaseRepository } from './supabase.ts';
import { observed, type CreatorLatencyObserver } from '../application/creator-observability.ts';

export function createCreatorSupabaseRepository(baseUrl: string, serviceRoleKey: string, fetcher: typeof fetch = fetch,
  telemetry?: CreatorLatencyObserver): CreatorRepository {
  // Reuse transport configuration checks, without calling a project operation.
  createSupabaseRepository(baseUrl, serviceRoleKey, fetcher);
  const operations = new Set(['get_creator_dna', 'correct_creator_dna', 'ingest_creator_analysis']);
  return { async call(operation, accountId, input) {
    if (!operations.has(operation)) throw new Error('Unsupported creator operation');
    const response = await observed(telemetry,
      { stage: 'supabase_rpc', clock: 'monotonic', operation: 'persist', endpoint: 'creator_pipeline_rpc' },
      () => fetcher(new URL(`/rest/v1/rpc/kettle_${operation}`, baseUrl), {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json', apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
      body: JSON.stringify({ p_account_id: accountId, p_input: input }),
    }));
    if (!response.ok) throw new Error('Creator storage unavailable');
    return response.json();
  } };
}
