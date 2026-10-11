import type { ReconciliationReadRepository } from '../application/creator-attempt-reconciliation.ts';
export function createCreatorAttemptReconciliationRepository(baseUrl:string,serviceRoleKey:string,fetcher:typeof fetch=fetch):ReconciliationReadRepository{
  new URL(baseUrl);if(!serviceRoleKey.trim())throw new Error('Invalid database credential');
  return {async list(input){const response=await fetcher(new URL('/rest/v1/rpc/kettle_list_creator_attempt_reconciliation',baseUrl),{
    method:'POST',redirect:'manual',signal:AbortSignal.timeout(10_000),headers:{'Content-Type':'application/json',apikey:serviceRoleKey,Authorization:`Bearer ${serviceRoleKey}`},
    body:JSON.stringify({p_input:input})});if(!response.ok)throw new Error('Reconciliation read unavailable');return response.json();}};
}
