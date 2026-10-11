import type { RiffVideoRepository } from '../application/riff-videos.ts';
import { createSupabaseRepository } from './supabase.ts';
import { observed, type CreatorLatencyObserver } from '../application/creator-observability.ts';

export function createRiffVideoSupabaseRepository(baseUrl:string,serviceRoleKey:string,
  fetcher:typeof fetch=fetch,telemetry?:CreatorLatencyObserver):RiffVideoRepository{
  createSupabaseRepository(baseUrl,serviceRoleKey,fetcher);
  const call=async(operation:'list_riff_videos'|'ingest_riff_videos',accountId:string,input:unknown)=>{
    const response=await observed(telemetry,{stage:'supabase_rpc',clock:'monotonic',
      operation:operation==='list_riff_videos'?'list':'persist',endpoint:'riff_video_catalog_rpc'},()=>fetcher(
      new URL(`/rest/v1/rpc/kettle_${operation}`,baseUrl),{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10_000),
        headers:{'Content-Type':'application/json',apikey:serviceRoleKey,Authorization:`Bearer ${serviceRoleKey}`},
        body:JSON.stringify({p_account_id:accountId,p_input:input})}));
    if(!response.ok)throw new Error('Riff video storage unavailable');
    return response.json();
  };
  return {list:(accountId,input)=>call('list_riff_videos',accountId,input),
    ingest:(accountId,input)=>call('ingest_riff_videos',accountId,input)};
}
