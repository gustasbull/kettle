import type { PipelineRepository } from '../application/creator-pipeline.ts';
import { createSupabaseRepository } from './supabase.ts';
import { observed, type CreatorLatencyObserver } from '../application/creator-observability.ts';
const allowed=new Set(['start_creator_scan','save_creator_scripts','start_creator_recommendations','start_creator_scripts','get_creator_job','run_creator_job','finish_creator_job','reserve_creator_attempt','complete_creator_attempt','list_creator_dispatches']);
export function createPipelineSupabaseRepository(baseUrl:string,serviceRoleKey:string,fetcher:typeof fetch=fetch,telemetry?:CreatorLatencyObserver):PipelineRepository {
  createSupabaseRepository(baseUrl,serviceRoleKey,fetcher);
  return {async call(operation,accountId,input,operationTelemetry){
    if(!allowed.has(operation))throw new Error('Unsupported pipeline operation');
    const r=await observed(operationTelemetry??telemetry,{stage:'supabase_rpc',clock:'monotonic',operation:'persist',endpoint:'creator_pipeline_rpc'},()=>fetcher(new URL(`/rest/v1/rpc/kettle_${operation}`,baseUrl),{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),
      headers:{'Content-Type':'application/json',apikey:serviceRoleKey,Authorization:`Bearer ${serviceRoleKey}`},body:JSON.stringify({p_account_id:accountId,p_input:input})}));
    if(!r.ok)throw new Error('Pipeline storage unavailable');
    return r.json();
  }};
}
