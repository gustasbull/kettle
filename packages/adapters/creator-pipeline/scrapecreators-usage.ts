import { z } from 'zod';
import type { UsageHistoryReader } from '../../application/creator-attempt-reconciliation.ts';

const documentedRecord=z.object({endpoint:z.string().min(1).max(2048),status_code:z.number().int().min(100).max(599),
  request_time:z.iso.datetime({offset:true}),response_time:z.iso.datetime({offset:true}),http_method:z.literal('GET')})
  .refine(value=>Date.parse(value.response_time)>=Date.parse(value.request_time));
const documentedHistory=z.array(documentedRecord).max(100);
const operationsByPath=new Map<string,'profile'|'feed'|'video'>([
  ['/v1/tiktok/profile','profile'],['/v3/tiktok/profile/videos','feed'],['/v2/tiktok/video','video'],
]);
function operationForEndpoint(endpoint:string){
  try{if(!endpoint.startsWith('/'))return undefined;const parsed=new URL(endpoint,'https://api.scrapecreators.com');
    if(parsed.origin!=='https://api.scrapecreators.com'||parsed.hash)return undefined;return operationsByPath.get(parsed.pathname);}
  catch{return undefined;}
}

export function createScrapeCreatorsUsageReader(apiKey:string,fetcher:typeof fetch=fetch,bounds:{timeoutMs?:number;maxBytes?:number}={}):UsageHistoryReader{
  if(!apiKey.trim()||/[\r\n]/.test(apiKey))throw new Error('Invalid usage credential');
  const timeoutMs=bounds.timeoutMs??10_000,maxBytes=bounds.maxBytes??262_144;
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30_000||!Number.isInteger(maxBytes)||maxBytes<1024||maxBytes>262_144)
    throw new Error('Invalid usage bounds');
  return {async read(page){
    if(!Number.isInteger(page)||page<1||page>100)throw new Error('Invalid usage page');
    const controller=new AbortController(),deadline=Date.now()+timeoutMs;
    const bounded=async<T>(promise:Promise<T>)=>{let timer:ReturnType<typeof setTimeout>|undefined;
      const remaining=Math.max(1,deadline-Date.now());const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{
        controller.abort();reject(new Error('Usage history unavailable'));},remaining);});
      try{return await Promise.race([promise,timeout]);}finally{if(timer!==undefined)clearTimeout(timer);}};
    const response=await bounded(fetcher(`https://api.scrapecreators.com/v1/account/get-api-usage?page=${page}`,
      {method:'GET',redirect:'manual',signal:controller.signal,headers:{'x-api-key':apiKey,Accept:'application/json'}}));
    if(!response.ok||response.type==='opaqueredirect')return {complete:false,candidates:[]};
    const declared=Number(response.headers.get('content-length'));if(Number.isFinite(declared)&&declared>maxBytes)return {complete:false,candidates:[]};
    const reader=response.body?.getReader();if(!reader)return {complete:false,candidates:[]};
    const chunks:Uint8Array[]=[];let total=0,finished=false;
    try{while(true){const next=await bounded(reader.read());if(next.done){finished=true;break;}total+=next.value.byteLength;
      if(total>maxBytes){await reader.cancel();finished=true;return {complete:false,candidates:[]};}chunks.push(next.value);}}
    finally{if(finished)reader.releaseLock();}
    const buffer=new Uint8Array(total);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.byteLength;}
    let raw:unknown;try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer));}catch{return {complete:false,candidates:[]};}
    const documented=documentedHistory.safeParse(raw);
    if(documented.success)return {complete:true,candidates:documented.data.flatMap(record=>{
      const operation=operationForEndpoint(record.endpoint);return operation?[{operation,
        observed_at:new Date(record.request_time).toISOString(),http_status:record.status_code}]:[];
    })};
    return {complete:false,candidates:[]};
  }};
}
