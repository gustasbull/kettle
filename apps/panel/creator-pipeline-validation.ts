import type { CreatorJobStatusView, CreatorJobView } from '../../packages/contracts/creator-pipeline.ts';
import type { RiffVideoCard } from '../../packages/contracts/riff-videos.ts';
import { isAllowedTikTokImageUrl } from '../../packages/contracts/tiktok-image-policy.ts';
import { isCreatorJobStatusView, isCreatorJobView } from './riff-home-validation.ts';

type JsonObject = Record<string, unknown>;
export type CreatorJobPublicOutput = { ok: true; data: { job: CreatorJobView } } | {
  ok: false; error: { code: 'UNAUTHENTICATED'|'FORBIDDEN'|'VALIDATION_ERROR'|'NOT_FOUND'|'VERSION_CONFLICT'|'IDEMPOTENCY_CONFLICT'|'UNAVAILABLE'; message:string; retryable:boolean; recovery:'reauthorize'|'correct_input'|'reload'|'retry_same_request'|'contact_support' } };
type PublicFailure=Extract<CreatorJobPublicOutput,{ok:false}>;
export type CreatorJobStatusPublicOutput={ok:true;data:{status:CreatorJobStatusView}}|PublicFailure;
export type RiffVideoCatalogPage={cards:RiffVideoCard[];next_cursor:string|null;coverage:string;freshness:string};
export type RiffVideosPublicOutput={ok:true;data:RiffVideoCatalogPage}|PublicFailure;

const id = (value:unknown):value is string => typeof value==='string'
  &&/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i.test(value);
const text=(value:unknown,max:number):value is string=>typeof value==='string'&&value.length<=max&&value.trim().length>0;
const timestamp=(value:unknown):value is string=>typeof value==='string'
  &&/^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|02-(?:0[1-9]|1\d|2[0-8])))T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value);
const positiveInteger=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>0;
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
function httpUrl(value:unknown):value is string {
  if(typeof value!=='string'||value.length>2_048)return false;
  try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password;}catch{return false;}
}
function imageUrl(value:unknown):value is string {
  return typeof value==='string'&&value.length<=4_096&&isAllowedTikTokImageUrl(value);
}
function creatorUrl(value:unknown):value is string {
  if(!httpUrl(value))return false;
  const url=new URL(value);return url.protocol==='https:'&&!url.port&&!url.search&&!url.hash
    &&['tiktok.com','www.tiktok.com','instagram.com','www.instagram.com'].includes(url.hostname);
}
function fact(value:unknown):boolean {
  const sourceValue=(value as JsonObject|null)?.source;
  const sourceKind=(sourceValue as JsonObject|null)?.kind;
  const item=record(value,['id','statement','source','user_confirmed']);
  const source=sourceKind==='url'?record(sourceValue,['kind','url','captured_at']):record(sourceValue,['kind','captured_at']);
  return !!item&&id(item.id)&&text(item.statement,1_000)&&typeof item.user_confirmed==='boolean'&&!!source
    &&((source.kind==='user'&&timestamp(source.captured_at))
      ||(source.kind==='url'&&httpUrl(source.url)&&timestamp(source.captured_at)));
}
function project(value:unknown):JsonObject|undefined {
  const item=record(value,['id','name','project_type','current_version','created_at','updated_at','brief_version']);if(!item)return;
  const version=record(item.brief_version,['id','project_id','version','name','brief','created_at']);if(!version)return;
  const brief=record(version.brief,['product','audience','goal','tone','language','duration_seconds','filming_constraints','facts']);if(!brief)return;
  if(!Array.isArray(brief.filming_constraints)||brief.filming_constraints.length>20
    ||!brief.filming_constraints.every(value=>text(value,500))||!Array.isArray(brief.facts)||brief.facts.length>50
    ||!brief.facts.every(fact)||new Set(brief.facts.map(value=>(value as JsonObject).id)).size!==brief.facts.length)return;
  if(!(id(item.id)&&text(item.name,120)&&item.project_type==='brand'&&positiveInteger(item.current_version)
    &&timestamp(item.created_at)&&timestamp(item.updated_at)&&id(version.id)&&id(version.project_id)
    &&positiveInteger(version.version)&&text(version.name,120)&&timestamp(version.created_at)
    &&text(brief.product,4_000)&&text(brief.audience,1_000)&&text(brief.goal,1_000)&&text(brief.tone,200)
    &&text(brief.language,35)&&Number.isSafeInteger(brief.duration_seconds)&&Number(brief.duration_seconds)>=5
    &&Number(brief.duration_seconds)<=180&&item.id===version.project_id&&item.current_version===version.version&&item.name===version.name))return;
  return item;
}
function canonicalSource(value:unknown):JsonObject|undefined {
  const item=record(value,['platform','kind','handle','canonical_url','profile_url','video_url']);if(!item)return;
  if(item.platform!=='tiktok'||!['profile','video'].includes(String(item.kind))||!text(item.handle,100)
    ||!/^[\w.]+$/.test(item.handle)||!creatorUrl(item.canonical_url)||!creatorUrl(item.profile_url))return;
  const expectedProfile=`https://www.tiktok.com/@${item.handle}`;
  if(item.profile_url!==expectedProfile)return;
  if(item.kind==='profile')return item.video_url===null&&item.canonical_url===item.profile_url?item:undefined;
  if(!creatorUrl(item.video_url)||item.canonical_url!==item.video_url
    ||!new RegExp(`^/@${String(item.handle).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}/video/\\d{1,30}$`).test(new URL(item.video_url).pathname))return;
  return item;
}
function failure(value:unknown):PublicFailure|undefined {
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
  const job=record(data.job,['id','project_id','revision','kind','state','stage','progress','created_at','updated_at','result','message']
    .concat((data.job as JsonObject)?.source_kind===undefined?[]:['source_kind']));
  if(!job||!isCreatorJobView(job))return;
  return {ok:true,data:{job:structuredClone(job) as CreatorJobView}};
}

function statusOutput(value:unknown):CreatorJobStatusPublicOutput|undefined {
  if(!safeTree(value))return;
  const failed=failure(value);if(failed)return failed;
  const outer=record(value,['ok','data']);if(!outer||outer.ok!==true)return;
  const data=record(outer.data,['status']);if(!data||!isCreatorJobStatusView(data.status))return;
  return {ok:true,data:{status:structuredClone(data.status)}};
}
function nullableCount(value:unknown){return value===null||Number.isSafeInteger(value)&&Number(value)>=0;}
function videoMetrics(value:unknown){
  const item=record(value,['views','likes','comments','shares','saves']);
  return !!item&&nullableCount(item.views)&&nullableCount(item.likes)&&nullableCount(item.comments)
    &&nullableCount(item.shares)&&nullableCount(item.saves);
}
function videoCard(value:unknown):value is RiffVideoCard {
  const item=record(value,['id','platform','native_id','canonical_url','caption','thumbnail_url','published_at','duration_seconds',
    'metrics','retrieved_at','source_observed_at','observed_at','origin','role','permission_basis','limitations']);
  if(!item||!id(item.id)||item.platform!=='tiktok'||!text(item.native_id,200)||!creatorUrl(item.canonical_url)
    ||!(item.caption===null||typeof item.caption==='string'&&item.caption.length<=10_000)
    ||!(item.thumbnail_url===null||imageUrl(item.thumbnail_url))
    ||!(item.published_at===null||timestamp(item.published_at))
    ||!(item.duration_seconds===null||typeof item.duration_seconds==='number'&&Number.isFinite(item.duration_seconds)
      &&item.duration_seconds>0&&item.duration_seconds<=86_400)
    ||!videoMetrics(item.metrics)||!timestamp(item.retrieved_at)
    ||!(item.source_observed_at===null||timestamp(item.source_observed_at))||!timestamp(item.observed_at)
    ||!['fixture','live'].includes(String(item.origin))||!['own_profile','discovered_reference'].includes(String(item.role))
    ||!text(item.permission_basis,2_000)||!Array.isArray(item.limitations)||item.limitations.length>20
    ||!item.limitations.every(value=>text(value,1_000)))return false;
  return new URL(String(item.canonical_url)).hostname.replace(/^www\./,'')==='tiktok.com';
}
function videosOutput(value:unknown):RiffVideosPublicOutput|undefined {
  if(!safeTree(value))return;
  const failed=failure(value);if(failed)return failed;
  const outer=record(value,['ok','data']);if(!outer||outer.ok!==true)return;
  const data=record(outer.data,['cards','next_cursor','coverage','freshness']);
  if(!data||!Array.isArray(data.cards)||data.cards.length>20||!data.cards.every(videoCard)
    ||!(data.next_cursor===null||text(data.next_cursor,1_024))||!text(data.coverage,1_000)||!text(data.freshness,1_000))return;
  return {ok:true,data:structuredClone(data) as RiffVideoCatalogPage};
}

function structuredOutput<T>(raw:unknown,parse:(value:unknown)=>T|undefined):T|undefined {
  try{
    if(!safeTree(raw)||raw===null||typeof raw!=='object'||Array.isArray(raw))return;
    const keys=Reflect.ownKeys(raw);if(keys.some(key=>typeof key!=='string'||!['structuredContent','isError','content','_meta'].includes(key)))return;
    const envelope=raw as JsonObject;if(!Object.hasOwn(envelope,'structuredContent'))return;
    const parsed=parse(envelope.structuredContent);if(!parsed)return;
    return envelope.isError===true&&(parsed as {ok?:unknown}).ok===true?undefined:parsed;
  }catch{return;}
}

export function parseCreatorJobOutput(value:unknown):CreatorJobPublicOutput|undefined { try{return jobOutput(value);}catch{return;} }
export function parseCreatorJobStatusOutput(value:unknown):CreatorJobStatusPublicOutput|undefined { try{return statusOutput(value);}catch{return;} }
export function parseRiffVideosOutput(value:unknown):RiffVideosPublicOutput|undefined { try{return videosOutput(value);}catch{return;} }
export function creatorJobStatusStructuredOutput(raw:unknown):CreatorJobStatusPublicOutput|undefined {
  return structuredOutput(raw,statusOutput);
}
export function riffVideosStructuredOutput(raw:unknown):RiffVideosPublicOutput|undefined {
  return structuredOutput(raw,videosOutput);
}
/** Discovery accepts one bounded, role-filtered page; any mixed or oversized page fails closed. */
export function riffDiscoveryCatalogStructuredOutput(raw:unknown):RiffVideosPublicOutput|undefined {
  const parsed=structuredOutput(raw,videosOutput);
  if(!parsed||!parsed.ok)return parsed;
  if(parsed.data.cards.length>8||parsed.data.cards.some(card=>card.role!=='discovered_reference'))return;
  return parsed;
}
export function creatorJobStructuredOutput(raw:unknown):CreatorJobPublicOutput|undefined {
  try {
    if(!safeTree(raw)||raw===null||typeof raw!=='object'||Array.isArray(raw))return;
    const keys=Reflect.ownKeys(raw);if(keys.some(key=>typeof key!=='string'||!['structuredContent','isError','content','_meta'].includes(key)))return;
    const envelope=raw as JsonObject;if(!Object.hasOwn(envelope,'structuredContent'))return;
    const direct=jobOutput(envelope.structuredContent);if(direct)return envelope.isError===true&&direct.ok?undefined:direct;
    const started=record(envelope.structuredContent,['ok','data']);if(!started||started.ok!==true||envelope.isError===true)return;
    const data=record(started.data,['project','job','source']);if(!data)return;
    const publicJob=jobOutput({ok:true,data:{job:data.job}});const savedProject=project(data.project),source=canonicalSource(data.source);
    if(!publicJob?.ok||!savedProject||!source||publicJob.data.job.kind!=='scan'
      ||publicJob.data.job.project_id!==savedProject.id
      ||(publicJob.data.job.source_kind!==undefined&&publicJob.data.job.source_kind!==source.kind))return;
    return publicJob;
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
