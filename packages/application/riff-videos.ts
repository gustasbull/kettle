import { z } from 'zod';
import { Id, Timestamp, result, type Failure } from '../contracts/index.ts';
import { ListRiffVideosInput, ListRiffVideosOutput, RiffVideoCard, RiffVideoIngestReceipt,
  RiffVideoRole, RiffVideoSort, TrustedRiffVideoIngest, riffVideoContracts,
  type RiffVideoOperation, type TrustedCatalogObservation } from '../contracts/riff-videos.ts';
import { failure, type IdentityVerifier } from './operations.ts';

export const RiffVideoCursor=z.strictObject({v:z.literal(1),sort:RiffVideoSort,observed_at:Timestamp,id:Id,
  project_id:Id.nullable(),role:RiffVideoRole.nullable()});
export type RiffVideoCursor=z.infer<typeof RiffVideoCursor>;
export type RiffVideoFilters={project_id:string|null;role:z.infer<typeof RiffVideoRole>|null;sort:'observed_at_desc'};
const canonicalJson=(position:RiffVideoCursor)=>JSON.stringify({v:position.v,sort:position.sort,
  observed_at:position.observed_at,id:position.id,project_id:position.project_id,role:position.role});
const base64urlEncode=(bytes:Uint8Array)=>btoa(Array.from(bytes,byte=>String.fromCharCode(byte)).join(''))
  .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export function encodeRiffVideoCursor(raw:RiffVideoCursor):string{
  const position=RiffVideoCursor.parse(raw);
  return base64urlEncode(new TextEncoder().encode(canonicalJson(position)));
}
export function decodeRiffVideoCursor(token:string,filters:RiffVideoFilters):RiffVideoCursor{
  if(typeof token!=='string'||token.length<1||token.length>1024||!/^[A-Za-z0-9_-]+$/.test(token))throw new Error('Invalid cursor');
  let bytes:Uint8Array,text:string,raw:unknown;
  try{
    const base64=token.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-token.length%4)%4);
    const binary=atob(base64);bytes=Uint8Array.from(binary,character=>character.charCodeAt(0));
    if(base64urlEncode(bytes)!==token)throw new Error('Non-canonical cursor');
    text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);raw=JSON.parse(text);
  }catch{throw new Error('Invalid cursor');}
  const position=RiffVideoCursor.parse(raw);
  if(position.project_id!==filters.project_id||position.role!==filters.role||position.sort!==filters.sort)throw new Error('Cursor filters changed');
  if(encodeRiffVideoCursor(position)!==token)throw new Error('Non-canonical cursor');
  return position;
}
export type ListRiffVideosRepositoryInput=RiffVideoFilters&{after:{observed_at:string;id:string}|null;limit:number};
export interface RiffVideoRepository{
  list(accountId:string,input:ListRiffVideosRepositoryInput):Promise<unknown>;
  ingest(accountId:string,input:z.infer<typeof TrustedRiffVideoIngest>):Promise<unknown>;
}
const StorageListOutput=result(z.strictObject({cards:z.array(RiffVideoCard).max(20),
  next_position:z.strictObject({observed_at:Timestamp,id:Id}).nullable()}));
const coverage='Returned saved permitted metadata only; this page is not complete platform or profile coverage, and no provider refresh was performed.';
function freshness(cards:readonly z.infer<typeof RiffVideoCard>[]){
  if(cards.length===0)return 'No saved observations matched; no provider refresh was performed.';
  const retrieved=cards.map(card=>card.retrieved_at).sort();
  const unknown=cards.filter(card=>card.source_observed_at===null).length;
  return `Returned cards were retrieved from ${retrieved[0]} through ${retrieved.at(-1)}; source observation time is unknown for ${unknown} of ${cards.length} card${cards.length===1?'':'s'}.`;
}
export function createRiffVideoOperations(verifier:IdentityVerifier,repository:RiffVideoRepository){
  return {async execute(operation:RiffVideoOperation,credential:string|null,rawInput:unknown):Promise<z.infer<typeof ListRiffVideosOutput>|Failure>{
    if(!credential)return failure('UNAUTHENTICATED');let identity;
    try{identity=await verifier.verify(credential);}catch{return failure('UNAUTHENTICATED');}
    if(!identity||!Id.safeParse(identity.account_id).success)return failure('UNAUTHENTICATED');
    const contract=riffVideoContracts[operation];if(!identity.scopes.includes(contract.scope))return failure('FORBIDDEN');
    const parsed=ListRiffVideosInput.safeParse(rawInput);if(!parsed.success)return failure('VALIDATION_ERROR');
    const filters:RiffVideoFilters={project_id:parsed.data.project_id??null,role:parsed.data.role??null,sort:parsed.data.sort??'observed_at_desc'};
    let after:null|{observed_at:string;id:string}=null;
    try{if(parsed.data.cursor){const decoded=decodeRiffVideoCursor(parsed.data.cursor,filters);after={observed_at:decoded.observed_at,id:decoded.id};}}
    catch{return failure('VALIDATION_ERROR');}
    try{
      const stored=StorageListOutput.parse(await repository.list(identity.account_id,{...filters,after,limit:parsed.data.limit??8}));
      if(!stored.ok)return failure(stored.error.code);
      const next_cursor=stored.data.next_position?encodeRiffVideoCursor({v:1,sort:filters.sort,
        observed_at:stored.data.next_position.observed_at,id:stored.data.next_position.id,
        project_id:filters.project_id,role:filters.role}):null;
      return ListRiffVideosOutput.parse({ok:true,data:{cards:stored.data.cards,next_cursor,coverage,freshness:freshness(stored.data.cards)}});
    }catch{return failure('UNAVAILABLE');}
  }};
}

export type CatalogJob={id:string;account_id:string;kind:'scan'|'recommendations'|'scripts'};
export function riffVideoCatalogInput(job:CatalogJob,checkpointKey:string,role:z.infer<typeof RiffVideoRole>,observations:readonly TrustedCatalogObservation[]){
  Id.parse(job.id);Id.parse(job.account_id);
  const roleMatches=(job.kind==='scan'&&role==='own_profile'&&/^scan:feed:\d+$/.test(checkpointKey))||
    (job.kind==='recommendations'&&role==='discovered_reference'&&observations.length===1&&
      checkpointKey===`recommend:detail:${observations[0]?.native_id}`);
  if(!roleMatches)throw new Error('Invalid catalog source');
  return TrustedRiffVideoIngest.parse({job_id:job.id,checkpoint_key:checkpointKey,role,observations:[...observations]});
}
export function parseRiffVideoIngestReceipt(raw:unknown,input:z.infer<typeof TrustedRiffVideoIngest>){
  const output=RiffVideoIngestReceipt.parse(raw);
  if(!output.ok||output.data.ingested_count!==input.observations.length||
    JSON.stringify(output.data.observation_ids)!==JSON.stringify(input.observations.map(item=>item.id)))throw new Error('Catalog persistence unavailable');
  return output;
}
export function createRiffVideoCatalogIngestion(repository:RiffVideoRepository,job:CatalogJob){
  return async(checkpointKey:string,role:z.infer<typeof RiffVideoRole>,observations:readonly TrustedCatalogObservation[])=>{
    const input=riffVideoCatalogInput(job,checkpointKey,role,observations);
    return parseRiffVideoIngestReceipt(await repository.ingest(job.account_id,input),input);
  };
}
