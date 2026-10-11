import type { RiffWorkStateRepository } from '../application/riff-work-state.ts';

export function createRiffWorkStateSupabaseRepository(baseUrl:string,serviceRoleKey:string,
  fetcher:typeof fetch=fetch):RiffWorkStateRepository{
  const url=new URL(baseUrl);
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))
    throw new Error('Supabase requires HTTPS, except local development');
  if(!serviceRoleKey)throw new Error('Missing server credential');
  return {async set(accountId,input){
    const response=await fetcher(new URL('/rest/v1/rpc/kettle_set_riff_work_state',url),{
      method:'POST',redirect:'manual',headers:{'Content-Type':'application/json',apikey:serviceRoleKey,
        Authorization:`Bearer ${serviceRoleKey}`},body:JSON.stringify({p_account_id:accountId,p_input:input}),
      signal:AbortSignal.timeout(10_000),
    });
    if(!response.ok)throw new Error('Database request failed');
    return response.json();
  }};
}
