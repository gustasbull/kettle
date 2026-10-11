import test from 'node:test';
import assert from 'node:assert/strict';
import { createRiffVideoSupabaseRepository } from '../packages/database/riff-videos-supabase.ts';

const account='00000000-0000-4000-8000-000000000001';
test('catalog adapter exposes only fixed service-role RPCs with bounded requests',async()=>{
  const seen:any[]=[];const fetcher:typeof fetch=async(url,init)=>{seen.push({url:String(url),init});return Response.json({ok:false,error:{code:'NOT_FOUND',message:'x',retryable:false,recovery:'reload'}});};
  const repo=createRiffVideoSupabaseRepository('https://example.supabase.co','service-secret',fetcher);
  await repo.list(account,{project_id:null,role:null,sort:'observed_at_desc',after:null,limit:8});
  await repo.ingest(account,{job_id:account,checkpoint_key:'scan:feed:0',role:'own_profile',observations:[] as never});
  assert.deepEqual(seen.map(x=>x.url),['https://example.supabase.co/rest/v1/rpc/kettle_list_riff_videos','https://example.supabase.co/rest/v1/rpc/kettle_ingest_riff_videos']);
  for(const request of seen){assert.equal(request.init.method,'POST');assert.equal(request.init.redirect,'manual');assert.ok(request.init.signal);assert.equal(new Headers(request.init.headers).get('authorization'),'Bearer service-secret');assert.equal(JSON.parse(request.init.body).p_account_id,account);}
  assert.throws(()=>createRiffVideoSupabaseRepository('http://example.com','secret',fetcher));
});
