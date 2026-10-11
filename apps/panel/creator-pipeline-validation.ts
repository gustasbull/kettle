import type { CreatorJobView } from '../../packages/contracts/creator-pipeline.ts';
import { isCreatorJobView } from './riff-home-validation.ts';

type JsonObject = Record<string, unknown>;
export type CreatorJobPublicOutput = { ok: true; data: { job: CreatorJobView } } | {
  ok: false; error: { code: 'UNAUTHENTICATED'|'FORBIDDEN'|'VALIDATION_ERROR'|'NOT_FOUND'|'VERSION_CONFLICT'|'IDEMPOTENCY_CONFLICT'|'UNAVAILABLE'; message:string; retryable:boolean; recovery:'reauthorize'|'correct_input'|'reload'|'retry_same_request'|'contact_support' } };

const id = (value:unknown):value is string => typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function record(value:unknown,keys:readonly string[]):JsonObject|undefined {
  if(value===null||typeof value!=='object'||Array.isArray(value))return;
  const proto=Object.getPrototypeOf(value);if(proto!==Object.prototype&&proto!==null)return;
  const own=Reflect.ownKeys(value);if(own.some(key=>typeof key!=='string')||own.length!==keys.length||keys.some(key=>!own.includes(key)))return;
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Object.values(descriptors).some(descriptor=>!('value' in descriptor)))return;
  return value as JsonObject;
}
function safeTree(value:unknown,maxBytes=1_500_000):boolean {
  let bytes=0;const seen=new Set<object>();
  const visit=(item:unknown):boolean=>{
    if(item===null||typeof item==='boolean')return true;
    if(typeof item==='number')return Number.isFinite(item);
    if(typeof item==='string'){bytes+=item.length*3;return bytes<=maxBytes;}
    if(typeof item!=='object'||seen.has(item))return false;seen.add(item);
    if(Array.isArray(item)){if(item.length>1_000)return false;return item.every(visit);}
    const proto=Object.getPrototypeOf(item);if(proto!==Object.prototype&&proto!==null)return false;
    const descriptors=Object.getOwnPropertyDescriptors(item);
    if(Reflect.ownKeys(item).some(key=>typeof key!=='string')||Object.values(descriptors).some(d=>!('value' in d)))return false;
    return Object.entries(descriptors).every(([key,d])=>{bytes+=key.length*3;return bytes<=maxBytes&&visit(d.value);});
  };return visit(value);
}
function failure(value:unknown):CreatorJobPublicOutput|undefined {
  const outer=record(value,['ok','error']);if(!outer||outer.ok!==false)return;
  const error=record(outer.error,['code','message','retryable','recovery']);if(!error)return;
  const codes=['UNAUTHENTICATED','FORBIDDEN','VALIDATION_ERROR','NOT_FOUND','VERSION_CONFLICT','IDEMPOTENCY_CONFLICT','UNAVAILABLE'];
  const recoveries=['reauthorize','correct_input','reload','retry_same_request','contact_support'];
  if(!codes.includes(String(error.code))||typeof error.message!=='string'||!error.message.trim()||error.message.length>500
    ||typeof error.retryable!=='boolean'||!recoveries.includes(String(error.recovery)))return;
  return {ok:false,error:{code:error.code as never,message:error.message,retryable:error.retryable,recovery:error.recovery as never}};
}
function jobOutput(value:unknown):CreatorJobPublicOutput|undefined {
  if(!safeTree(value))return;
  const failed=failure(value);if(failed)return failed;
  const outer=record(value,['ok','data']);if(!outer||outer.ok!==true)return;
  const data=record(outer.data,['job']);if(!data)return;
  const job=record(data.job,['id','project_id','revision','kind','state','created_at','updated_at','result','message']
    .concat((data.job as JsonObject)?.source_kind===undefined?[]:['source_kind']));
  if(!job||!isCreatorJobView(job))return;
  return {ok:true,data:{job:structuredClone(job) as CreatorJobView}};
}

export function parseCreatorJobOutput(value:unknown):CreatorJobPublicOutput|undefined { try{return jobOutput(value);}catch{return;} }
export function creatorJobStructuredOutput(raw:unknown):CreatorJobPublicOutput|undefined {
  try {
    if(!safeTree(raw)||raw===null||typeof raw!=='object'||Array.isArray(raw))return;
    const keys=Reflect.ownKeys(raw);if(keys.some(key=>typeof key!=='string'||!['structuredContent','isError','content','_meta'].includes(key)))return;
    const envelope=raw as JsonObject;if(!Object.hasOwn(envelope,'structuredContent'))return;
    const direct=jobOutput(envelope.structuredContent);if(direct)return envelope.isError===true&&direct.ok?undefined:direct;
    const started=record(envelope.structuredContent,['ok','data']);if(!started||started.ok!==true||envelope.isError===true)return;
    const data=record(started.data,['project','job','source']);if(!data)return;
    return jobOutput({ok:true,data:{job:data.job}});
  } catch{return;}
}
export function creatorJobText(raw:unknown):string {
  const parsed=jobOutput(raw);if(!parsed)throw new Error('Invalid creator job output');return JSON.stringify(parsed);
}
export function parseGetCreatorJobInput(raw:unknown):{job_id:string}|undefined {
  try{const input=record(raw,['job_id']);return input&&id(input.job_id)?{job_id:input.job_id}:undefined;}catch{return;}
}
export function parseStartRiffCreatorInput(raw:unknown):{request_id:string;source_url:string}|undefined {
  try{const input=record(raw,['request_id','source_url']);if(!input||!id(input.request_id)||typeof input.source_url!=='string'||input.source_url.length>2_048)return;
    const url=new URL(input.source_url);if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash)return;
    return {request_id:input.request_id,source_url:input.source_url};}catch{return;}
}
