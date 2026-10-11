import type { ProjectRepository } from '../application/operations.ts';
import { observed, type CreatorLatencyObserver } from '../application/creator-observability.ts';

/** HTTPS PostgREST RPC adapter, portable to Workers. Server-side service role only.
 * Stage 2 must wire it ONLY behind createOperations with a real IdentityVerifier. */
export function createSupabaseRepository(
  baseUrl: string, serviceRoleKey: string, fetcher: typeof fetch = fetch,
  telemetry?: CreatorLatencyObserver,
): ProjectRepository {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) {
    throw new Error('Supabase requires HTTPS, except local development');
  }
  if (!serviceRoleKey) throw new Error('Missing server credential');
  return {
    async call(operation, accountId, input) {
      const response = await observed(telemetry,
        { stage: 'supabase_rpc', clock: 'monotonic', operation: 'persist', endpoint: 'creator_pipeline_rpc' },
        () => fetcher(new URL(`/rest/v1/rpc/kettle_${operation}`, url), {
        method: 'POST', redirect: 'manual',
        headers: { 'Content-Type': 'application/json', apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
        body: JSON.stringify({ p_account_id: accountId, p_input: input }),
        signal: AbortSignal.timeout(10_000),
      }));
      if (!response.ok) throw new Error('Database request failed');
      return response.json();
    },
  };
}

/** The caller must first validate the issuer JWT. These parameters never come from tool input. */
export function createSupabaseIdentityResolver(baseUrl: string, serviceRoleKey: string, fetcher: typeof fetch = fetch,
  telemetry?: CreatorLatencyObserver) {
  // Reuse URL/credential validation without executing an operation.
  createSupabaseRepository(baseUrl, serviceRoleKey, fetcher);
  return async (issuer: string, subject: string, issuedAt: number): Promise<string | null> => {
    const response = await observed(telemetry,
      { stage: 'identity_lookup', clock: 'monotonic', operation: 'find', endpoint: 'identity_rpc' },
      () => fetcher(new URL('/rest/v1/rpc/kettle_resolve_identity', baseUrl), {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/json', apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
      body: JSON.stringify({ p_issuer: issuer, p_subject: subject, p_issued_at: issuedAt }),
      signal: AbortSignal.timeout(10_000),
    }));
    if (!response.ok) throw new Error('Identity storage unavailable');
    const accountId: unknown = await response.json();
    if (accountId === null) return null;
    if (typeof accountId !== 'string' || !/^[0-9a-f-]{36}$/i.test(accountId)) throw new Error('Invalid identity result');
    return accountId;
  };
}
