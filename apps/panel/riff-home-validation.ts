import type { CreatorJobStatusView, CreatorJobView, PipelineReference } from '../../packages/contracts/creator-pipeline.ts';
import { isAllowedTikTokImageUrl } from '../../packages/contracts/tiktok-image-policy.ts';

type JsonObject = Record<string, unknown>;

const object = (value: unknown): JsonObject | undefined => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  if (Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => !('value' in descriptor))) return undefined;
  return value as JsonObject;
};
const shape = (value: unknown, required: readonly string[], optionalKeys: readonly string[] = []): JsonObject | undefined => {
  const item = object(value); if (!item) return undefined;
  const keys = Object.keys(item), allowed = new Set([...required, ...optionalKeys]);
  return required.every(key => Object.hasOwn(item, key)) && keys.every(key => allowed.has(key)) ? item : undefined;
};
const text = (value: unknown, max: number, allowEmpty = false): value is string =>
  typeof value === 'string' && value.length <= max && (allowEmpty || value.trim().length > 0);
const id = (value: unknown): value is string => typeof value === 'string'
  && /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i.test(value);
const timestamp = (value: unknown): value is string => typeof value === 'string'
  && /^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|02-(?:0[1-9]|1\d|2[0-8])))T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const positiveNumber = (value: unknown): value is number => number(value) && value > 0;
const boundedNumber = (value: unknown, maximum: number): value is number => number(value) && value <= maximum;
const nullable = <T>(value: unknown, check: (candidate: unknown) => candidate is T): value is T | null =>
  value === null || check(value);
const list = <T = unknown>(value: unknown, max: number, check: (candidate: unknown) => boolean, min = 0): value is T[] =>
  Array.isArray(value) && value.length >= min && value.length <= max && value.every(check);
const enumValue = <T extends string>(value: unknown, values: readonly T[]): value is T =>
  typeof value === 'string' && values.includes(value as T);
const unique = (values: unknown[], key: (value: any) => unknown) => new Set(values.map(key)).size === values.length;

const creatorUrl = (value: unknown): value is string => {
  if (!text(value, 2_048)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash
      && ['tiktok.com', 'www.tiktok.com', 'instagram.com', 'www.instagram.com'].includes(url.hostname.toLowerCase());
  } catch { return false; }
};

const imageUrl = (value: unknown): value is string => {
  return text(value, 4_096) && isAllowedTikTokImageUrl(value);
};

const optional = (record: JsonObject, key: string, check: (candidate: unknown) => boolean) =>
  record[key] === undefined || check(record[key]);
const textList = (value: unknown, maxItems: number, maxText: number, min = 0) =>
  list(value, maxItems, (item): item is string => text(item, maxText), min);
const idList = (value: unknown, max: number, min = 0) => list(value, max, id, min);

function identity(value: unknown) {
  const item = shape(value, ['platform', 'native_id']);
  return !!item && enumValue(item.platform, ['tiktok', 'instagram']) && text(item.native_id, 200);
}

function metrics(value: unknown) {
  const item = shape(value, ['views', 'likes', 'comments', 'shares'], ['saves']);
  return !!item && nullable(item.views, integer) && nullable(item.likes, integer)
    && nullable(item.comments, integer) && nullable(item.shares, integer)
    && optional(item, 'saves', candidate => nullable(candidate, integer));
}

function progressProvenance(value:unknown){
  const item=shape(value,['origin','retrieved_at','source_observed_at','permission_basis','limitations']);
  return !!item&&enumValue(item.origin,['fixture','live'])&&timestamp(item.retrieved_at)
    &&nullable(item.source_observed_at,timestamp)&&text(item.permission_basis,1_000)&&textList(item.limitations,10,500);
}
function progressProfile(value:unknown){
  const item=shape(value,['platform','native_id','url','handle','display_name','bio','follower_count','provenance'],['avatar_url']);
  return !!item&&item.platform==='tiktok'&&text(item.native_id,200)&&creatorUrl(item.url)&&text(item.handle,100)
    &&nullable(item.display_name,candidate=>text(candidate,200,true))&&nullable(item.bio,candidate=>text(candidate,1_000,true))
    &&nullable(item.follower_count,integer)&&optional(item,'avatar_url',imageUrl)&&progressProvenance(item.provenance);
}
function progressCard(value:unknown){
  const item=shape(value,['platform','native_id','url','caption','published_at','duration_seconds','metrics','provenance'],['thumbnail_url']);
  return !!item&&item.platform==='tiktok'&&text(item.native_id,200)&&creatorUrl(item.url)
    &&nullable(item.caption,candidate=>text(candidate,2_000,true))&&nullable(item.published_at,timestamp)
    &&nullable(item.duration_seconds,positiveNumber)&&optional(item,'thumbnail_url',imageUrl)
    &&metrics(item.metrics)&&progressProvenance(item.provenance);
}
function progressIdentity(value:unknown){
  const item=shape(value,['platform','native_id','url','retrieved_at','origin','permission_basis','limitations']);
  return !!item&&item.platform==='tiktok'&&text(item.native_id,200)&&creatorUrl(item.url)&&timestamp(item.retrieved_at)
    &&enumValue(item.origin,['fixture','live'])&&text(item.permission_basis,1_000)&&textList(item.limitations,10,500);
}
function jobProgress(value:unknown,kind:string){
  if(kind==='scan'){
    const item=shape(value,['kind','profile','videos','limitations']);if(!item||item.kind!=='scan')return false;
    const videos=Array.isArray(item.videos)?item.videos:[];
    return (item.profile===null||progressProfile(item.profile))&&list(item.videos,10,progressCard)&&textList(item.limitations,20,500)
      &&unique(videos,video=>{const card=object(video);return `${card?.platform}:${card?.native_id}`;})
      &&(item.profile===null||videos.every(video=>new URL(String((video as JsonObject).url)).pathname.split('/video/')[0]
        ===new URL(String((item.profile as JsonObject).url)).pathname.replace(/\/$/,'')));
  }
  if(kind==='recommendations'){
    const item=shape(value,['kind','identities','references','limitations']);if(!item||item.kind!=='recommendations'
      ||!list(item.identities,3,progressIdentity)||!list(item.references,3,progressCard)||!textList(item.limitations,20,500))return false;
    const identities=item.identities as JsonObject[],references=item.references as JsonObject[];
    return unique(identities,value=>`${value.platform}:${value.native_id}:${value.url}`)
      &&unique(references,value=>`${value.platform}:${value.native_id}:${value.url}`)
      &&references.every((value,index)=>{const identity=identities[index];return !!identity&&value.platform===identity.platform
        &&value.native_id===identity.native_id&&value.url===identity.url;});
  }
  const item=shape(value,['kind','limitations']);return !!item&&item.kind==='scripts'&&textList(item.limitations,20,500);
}

export function isCreatorJobStatusView(value: unknown): value is CreatorJobStatusView {
  const status=shape(value,['id','kind','state','stage','revision','created_at','updated_at','progress','terminal_result_available']);
  if(!status||!id(status.id)||!enumValue(status.kind,['scan','recommendations','scripts'])
    ||!enumValue(status.state,['queued','running','succeeded','failed','needs_reconciliation'])
    ||!enumValue(status.stage,['accepted','reviewing_video','reading_profile','reading_posts','building_analysis','researching_formats','enriching_references','saving'])
    ||!Number.isSafeInteger(status.revision)||Number(status.revision)<1||!timestamp(status.created_at)||!timestamp(status.updated_at)
    ||!jobProgress(status.progress,String(status.kind))||typeof status.terminal_result_available!=='boolean')return false;
  const stagePaths={scan:['accepted','reviewing_video','reading_profile','reading_posts','building_analysis','saving'],
    recommendations:['accepted','researching_formats','enriching_references','saving'],scripts:['accepted','building_analysis','saving']} as const;
  if(!stagePaths[status.kind].includes(status.stage as never))return false;
  if(status.terminal_result_available!==(status.state==='succeeded')||(status.state==='succeeded'&&status.stage!=='saving'))return false;
  if(status.state==='queued'&&(status.stage!=='accepted'||JSON.stringify(status.progress)!==JSON.stringify(status.kind==='scan'
    ?{kind:'scan',profile:null,videos:[],limitations:[]}:status.kind==='recommendations'
      ?{kind:'recommendations',identities:[],references:[],limitations:[]}:{kind:'scripts',limitations:[]})))return false;
  return true;
}

function evidence(value: unknown) {
  const item = shape(value, ['observation_id', 'url', 'retrieved_at', 'source_observed_at', 'origin', 'published_at', 'metrics'], ['thumbnail_url', 'duration_seconds']);
  return !!item && id(item.observation_id) && creatorUrl(item.url) && timestamp(item.retrieved_at)
    && nullable(item.source_observed_at, timestamp) && enumValue(item.origin, ['fixture', 'live'])
    && nullable(item.published_at, timestamp) && (item.metrics === null || metrics(item.metrics))
    && optional(item, 'thumbnail_url', imageUrl)
    && optional(item, 'duration_seconds', candidate => candidate === null || positiveNumber(candidate));
}

const dimensions = ['hook', 'content', 'style_pacing', 'voice_language', 'script', 'cta'] as const;
function reviewDimension(value: unknown) {
  const item = shape(value, ['dimension', 'status', 'summary'], ['recommendation']);
  return !!item && enumValue(item.dimension, dimensions)
    && enumValue(item.status, ['working_well', 'needs_attention', 'needs_rework', 'unknown'])
    && text(item.summary, 3_000) && optional(item, 'recommendation', candidate => text(candidate, 2_000));
}

function seedReview(value: unknown) {
  const item = shape(value, ['url', 'provider', 'summary', 'access_basis', 'limitations', 'retrieved_at', 'origin'], ['dimensions']);
  return !!item && creatorUrl(item.url) && /^\/@[\w.]+\/video\/\d{1,30}$/.test(new URL(item.url).pathname)
    && item.provider === 'lightreel' && text(item.summary, 8_000)
    && enumValue(item.access_basis, ['video_access_reported', 'transcript_or_caption_only', 'unavailable', 'unknown'])
    && optional(item, 'dimensions', candidate => list(candidate, 6, reviewDimension, 6)
      && unique(candidate, dimension => object(dimension)?.dimension))
    && textList(item.limitations, 20, 1_000) && timestamp(item.retrieved_at)
    && enumValue(item.origin, ['fixture', 'live']);
}

function dnaClaim(value: unknown) {
  const item = shape(value, ['id','dimension','statement','basis','evidence','requires_video','method','uncertainty','supersedes_claim_id']);
  const claimEvidence = (candidate: unknown) => {
    const entry = shape(candidate, ['observation_id','modality','start_seconds','end_seconds']);
    if (!entry || !id(entry.observation_id)
      || !enumValue(entry.modality, ['metadata','caption','transcript','image','video'])) return false;
    if (entry.modality === 'video') return number(entry.start_seconds) && number(entry.end_seconds)
      && entry.end_seconds > entry.start_seconds;
    return entry.start_seconds === null && entry.end_seconds === null;
  };
  if (!item || !id(item.id)
    || !enumValue(item.dimension, ['topics','formats','hooks','showcase','cta','structure','duration','pacing','relative_performance','audience'])
    || !text(item.statement, 2_000) || !enumValue(item.basis, ['observed','inferred','user_corrected'])
    || !list(item.evidence, 50, claimEvidence) || typeof item.requires_video !== 'boolean'
    || !text(item.method, 500) || !text(item.uncertainty, 1_000) || !nullable(item.supersedes_claim_id, id)) return false;
  if (item.basis === 'user_corrected') return item.supersedes_claim_id !== null;
  if (item.supersedes_claim_id !== null || item.evidence.length === 0) return false;
  return (!(item.requires_video || item.dimension === 'pacing')
    || item.evidence.some(entry => object(entry)?.modality === 'video'));
}

function profileAnalysis(value:unknown,coverageCount:number,claims:JsonObject[],evidenceItems:JsonObject[]){
  const item=shape(value,[],['performance','top_content','findings']);if(!item)return false;
  const performance=item.performance===undefined?undefined:shape(item.performance,[],['observed_views','engagement_rate']);
  if(item.performance!==undefined&&!performance)return false;
  const observed=performance?.observed_views===undefined?undefined:shape(performance.observed_views,['value','sample_size','basis']);
  const engagement=performance?.engagement_rate===undefined?undefined:shape(performance.engagement_rate,['percent','sample_size','basis']);
  if(performance?.observed_views!==undefined&&(!observed||!integer(observed.value)||!Number.isSafeInteger(observed.value)
    ||!Number.isSafeInteger(observed.sample_size)||Number(observed.sample_size)<=0||Number(observed.sample_size)>coverageCount||observed.basis!=='sum_observed_post_views'))return false;
  if(performance?.engagement_rate!==undefined&&(!engagement||!number(engagement.percent)
    ||!Number.isSafeInteger(engagement.sample_size)||Number(engagement.sample_size)<=0||Number(engagement.sample_size)>coverageCount||engagement.basis!=='engagements_divided_by_views'))return false;
  const evidenceById=new Map(evidenceItems.map(entry=>[entry.observation_id,entry]));
  if(item.top_content!==undefined){
    if(!list(item.top_content,3,candidate=>{
      const rank=shape(candidate,['observation_id','rank','basis']);
      const evidenceItem=rank&&evidenceById.get(rank.observation_id);
      const evidenceMetrics=evidenceItem&&object(evidenceItem.metrics);
      return !!rank&&id(rank.observation_id)&&[1,2,3].includes(Number(rank.rank))&&rank.basis==='observed_views'&&integer(evidenceMetrics?.views);
    },1))return false;
    const ranked=item.top_content as JsonObject[];
    if(!unique(ranked,entry=>entry.observation_id)||ranked.some((entry,index)=>entry.rank!==index+1))return false;
    for(let index=1;index<ranked.length;index+=1){
      const previous=ranked[index-1]!,current=ranked[index]!;
      const previousViews=(object(evidenceById.get(previous.observation_id)?.metrics)?.views as number);
      const currentViews=(object(evidenceById.get(current.observation_id)?.metrics)?.views as number);
      if(previousViews<currentViews||(previousViews===currentViews&&String(previous.observation_id).localeCompare(String(current.observation_id))>0))return false;
    }
  }
  if(item.findings!==undefined){
    const findings=shape(item.findings,['working','improvement','next_move']);if(!findings)return false;
    const claimIds=new Set(claims.map(claim=>claim.id));
    const finding=(candidate:unknown)=>{const entry=shape(candidate,['claim_id','evidence_summary','recommendation']);return !!entry&&id(entry.claim_id)&&claimIds.has(entry.claim_id)&&text(entry.evidence_summary,3000)&&text(entry.recommendation,3000);};
    const next=shape(findings.next_move,['title','rationale','claim_ids']);
    if(!finding(findings.working)||!finding(findings.improvement)||!next||!text(next.title,3000)||!text(next.rationale,3000)
      ||!idList(next.claim_ids,100,1)||!unique(next.claim_ids as unknown[],value=>value)||(next.claim_ids as unknown[]).some(value=>!claimIds.has(value)))return false;
  }
  return true;
}

function creatorDna(value: unknown) {
  const item = shape(value, ['dna_id','project_id','snapshot_id','profile','version','created_at','source_scan_id','scan_status','coverage','contains_fixture_data','requested_videos','coverage_limited','claims','evidence','withheld_claim_count','limitations'], ['profile_summary','profile_analysis','seed_review']); if (!item) return false;
  const coverage = shape(item.coverage, ['unique_videos','oldest_published_at','newest_published_at']); const profile = shape(item.profile, ['platform','native_id']);
  const summary = item.profile_summary === undefined ? undefined : shape(item.profile_summary, ['handle','display_name','follower_count'], ['avatar_url']);
  return id(item.dna_id) && id(item.project_id) && id(item.snapshot_id) && identity(profile)
    && Number.isSafeInteger(item.version) && Number(item.version) > 0 && timestamp(item.created_at)
    && id(item.source_scan_id) && enumValue(item.scan_status, ['complete', 'partial', 'unavailable', 'failed'])
    && !!coverage && integer(coverage.unique_videos) && coverage.unique_videos <= 50
    && nullable(coverage.oldest_published_at, timestamp) && nullable(coverage.newest_published_at, timestamp)
    && typeof item.contains_fixture_data === 'boolean'
    && (item.profile_summary === undefined || (!!summary && text(summary.handle, 100) && nullable(summary.display_name, candidate => text(candidate, 500, true))
      && nullable(summary.follower_count, integer) && optional(summary, 'avatar_url', imageUrl)))
    && Number.isSafeInteger(item.requested_videos) && Number(item.requested_videos) > 0
    && typeof item.coverage_limited === 'boolean' && list(item.claims, 100, dnaClaim)
    && unique(item.claims, claim => object(claim)?.id)
    && optional(item, 'seed_review', seedReview) && list(item.evidence, 170, evidence)
    && optional(item,'profile_analysis',candidate=>profileAnalysis(candidate,Number(coverage.unique_videos),item.claims as JsonObject[],item.evidence as JsonObject[]))
    && integer(item.withheld_claim_count) && list(item.limitations, 61,
      candidate => typeof candidate === 'string' && candidate.length <= 1_000);
}

function reference(value: unknown): value is PipelineReference {
  const item = shape(value, ['id','platform','native_id','url','retrieved_at','published_at','caption','views','origin','permission_basis','limitations'], ['source_observed_at','thumbnail_url','duration_seconds','likes','saves','view_multiplier','view_multiplier_basis']); if (!item) return false;
  const multiplierBasis = item.view_multiplier_basis === undefined ? undefined : shape(item.view_multiplier_basis, ['method','baseline_views','sample_size']);
  const hasMultiplier=item.view_multiplier!==undefined,hasBasis=item.view_multiplier_basis!==undefined;
  return hasMultiplier===hasBasis && (!hasMultiplier || item.views!==null)
    && id(item.id) && item.platform === 'tiktok' && text(item.native_id, 200) && creatorUrl(item.url)
    && timestamp(item.retrieved_at) && optional(item, 'source_observed_at', candidate => nullable(candidate, timestamp))
    && nullable(item.published_at, timestamp)
    && nullable(item.caption, candidate => text(candidate, 10_000, true)) && nullable(item.views, integer)
    && optional(item, 'thumbnail_url', imageUrl)
    && optional(item, 'duration_seconds', candidate => candidate === null || positiveNumber(candidate))
    && optional(item, 'likes', candidate => candidate === null || integer(candidate))
    && optional(item, 'saves', candidate => candidate === null || integer(candidate))
    && optional(item, 'view_multiplier', candidate => boundedNumber(candidate, Number.MAX_SAFE_INTEGER))
    && (!hasBasis || (!!multiplierBasis && multiplierBasis.method === 'median_observed_profile_views'
      && boundedNumber(multiplierBasis.baseline_views, Number.MAX_SAFE_INTEGER) && multiplierBasis.baseline_views > 0
      && Number.isSafeInteger(multiplierBasis.sample_size) && Number(multiplierBasis.sample_size) > 0
      && Number(multiplierBasis.sample_size) <= 170))
    && enumValue(item.origin, ['fixture', 'live']) && text(item.permission_basis, 2_000)
    && textList(item.limitations, 20, 1_000);
}

function idea(value: unknown) {
  const item = shape(value, ['id','title','concept','creator_fit','evidence_summary','execution','reference_ids','limitations']);
  return !!item && id(item.id) && text(item.title, 200) && text(item.concept, 3_000)
    && text(item.creator_fit, 3_000) && text(item.evidence_summary, 3_000) && text(item.execution, 4_000)
    && idList(item.reference_ids, 3, 1) && textList(item.limitations, 20, 1_000);
}

function recommendations(value: unknown) {
  const item = shape(value, ['id','dna_id','dna_version','created_at','references','ideas','contains_fixture_data','limitations']); if (!item) return false;
  if (!id(item.id) || !id(item.dna_id) || !Number.isSafeInteger(item.dna_version) || Number(item.dna_version) <= 0
    || !timestamp(item.created_at) || !list(item.references, 3, reference)
    || !list(item.ideas, 3, idea) || typeof item.contains_fixture_data !== 'boolean'
    || !textList(item.limitations, 30, 1_000)) return false;
  const references=item.references as JsonObject[],ideas=item.ideas as JsonObject[];
  const referenceIds=new Set(references.map(entry=>entry.id));
  return unique(references,entry=>entry.id) && unique(references,entry=>entry.native_id)
    && unique(ideas,entry=>entry.id)
    && ideas.every(entry=>(entry.reference_ids as unknown[]).every(referenceId=>referenceIds.has(referenceId)))
    && (!references.some(entry=>entry.origin==='fixture') || item.contains_fixture_data);
}

function segment(value: unknown) {
  const item = shape(value, ['part','start_seconds','end_seconds','spoken_text','filming_direction'], ['on_screen_text','reference_ids']);
  return !!item && enumValue(item.part, ['hook', 'main_content', 'cta'])
    && boundedNumber(item.start_seconds, 180) && boundedNumber(item.end_seconds, 180) && item.end_seconds > item.start_seconds
    && text(item.spoken_text, 4_000) && text(item.filming_direction, 3_000)
    && optional(item, 'on_screen_text', candidate => text(candidate, 1_000))
    && optional(item, 'reference_ids', candidate => idList(candidate, 3, 1) && unique(candidate as unknown[], id => id));
}

function variant(value: unknown) {
  const item = shape(value, ['id','label','hook','opening_visual','script','shots','b_roll','on_screen_text','showcase_timing','cta','estimated_duration_seconds','pacing','reference_ids','limitations'], ['timed_segments','caption','hashtags']);
  return !!item && id(item.id) && enumValue(item.label, ['Reference-led', 'Creator Fit', 'Experimental'])
    && text(item.hook, 2_000) && text(item.opening_visual, 2_000) && text(item.script, 12_000)
    && textList(item.shots, 30, 2_000, 1) && textList(item.b_roll, 30, 2_000)
    && textList(item.on_screen_text, 30, 1_000) && text(item.showcase_timing, 1_000)
    && text(item.cta, 2_000) && boundedNumber(item.estimated_duration_seconds, 180) && item.estimated_duration_seconds > 0
    && text(item.pacing, 2_000) && idList(item.reference_ids, 3, 1)
    && textList(item.limitations, 20, 1_000)
    && optional(item, 'timed_segments', candidate => list(candidate, 10, segment, 1))
    && optional(item, 'caption', candidate => text(candidate, 3_000))
    && optional(item, 'hashtags', candidate => list(candidate, 30,
      hashtag => typeof hashtag === 'string' && /^#[\p{L}\p{N}_]{1,100}$/u.test(hashtag)));
}

function scripts(value: unknown) {
  const item = shape(value, ['id','batch_id','idea_id','dna_id','dna_version','version','created_at','variants','contains_fixture_data','limitations'], ['idea','references']); if (!item) return false;
  const hasIdea = item.idea !== undefined; const hasReferences = item.references !== undefined;
  if (!id(item.id) || !id(item.batch_id) || !id(item.idea_id) || !id(item.dna_id)
    || !Number.isSafeInteger(item.dna_version) || Number(item.dna_version) <= 0 || item.version !== 1
    || !timestamp(item.created_at) || !list(item.variants, 3, variant, 2)
    || hasIdea !== hasReferences || (hasIdea && (!idea(item.idea) || !list(item.references, 3, reference, 1)))
    || typeof item.contains_fixture_data !== 'boolean' || !textList(item.limitations, 30, 1_000)) return false;
  const variants=item.variants as JsonObject[];
  if (!unique(variants,entry=>entry.id) || !unique(variants,entry=>entry.label)) return false;
  for (const entry of variants) {
    const variantReferenceIds=new Set(entry.reference_ids as unknown[]);
    const segments=(entry.timed_segments as JsonObject[]|undefined)??[];
    if(segments.some(segment=>segment.reference_ids!==undefined
      &&(segment.reference_ids as unknown[]).some(referenceId=>!variantReferenceIds.has(referenceId))))return false;
  }
  if (!hasIdea) return true;
  const selectedIdea=item.idea as JsonObject,references=item.references as JsonObject[];
  const referenceIds=new Set(references.map(entry=>entry.id));
  const ideaReferences=selectedIdea.reference_ids as unknown[];
  return selectedIdea.id===item.idea_id && unique(references,entry=>entry.id)
    && unique(references,entry=>entry.native_id) && unique(ideaReferences,value=>value)
    && referenceIds.size===ideaReferences.length && ideaReferences.every(referenceId=>referenceIds.has(referenceId))
    && variants.every(entry=>(entry.reference_ids as unknown[]).every(referenceId=>referenceIds.has(referenceId)))
    && (!references.some(entry=>entry.origin==='fixture') || item.contains_fixture_data);
}

/** Lightweight full display-boundary validation. This deliberately avoids pulling
 * the server's Zod graph into Home's first-paint bundle. */
export function isCreatorJobView(value: unknown): value is CreatorJobView {
  const candidate = object(value); if (!candidate) return false;
  const job = shape(candidate, ['id','project_id','revision','kind','state','stage','progress','created_at','updated_at','result','message'], ['source_kind']); if (!job) return false;
  try { if (JSON.stringify(job).length > 1_500_000) return false; } catch { return false; }
  if (!id(job.id) || !id(job.project_id) || !Number.isSafeInteger(job.revision) || Number(job.revision) < 1
    || !enumValue(job.kind, ['scan', 'recommendations', 'scripts'])
    || !enumValue(job.state, ['queued', 'running', 'succeeded', 'failed', 'needs_reconciliation'])
    || !enumValue(job.stage,['accepted','reviewing_video','reading_profile','reading_posts','building_analysis','researching_formats','enriching_references','saving'])
    || !jobProgress(job.progress,String(job.kind))
    || !timestamp(job.created_at) || !timestamp(job.updated_at)
    || !(job.message === null || text(job.message, 1_000))) return false;
  if (job.source_kind !== undefined && (!enumValue(job.source_kind, ['video', 'profile']) || job.kind !== 'scan')) return false;
  const stagePaths={scan:['accepted','reviewing_video','reading_profile','reading_posts','building_analysis','saving'],
    recommendations:['accepted','researching_formats','enriching_references','saving'],scripts:['accepted','building_analysis','saving']} as const;
  if(!stagePaths[job.kind as keyof typeof stagePaths].includes(job.stage as never))return false;
  if(job.source_kind==='profile'&&job.stage==='reviewing_video')return false;
  if(job.state==='queued'&&(job.stage!=='accepted'||JSON.stringify(job.progress)!==JSON.stringify(job.kind==='scan'
    ?{kind:'scan',profile:null,videos:[],limitations:[]}:job.kind==='recommendations'
      ?{kind:'recommendations',identities:[],references:[],limitations:[]}:{kind:'scripts',limitations:[]})))return false;
  if(job.state==='succeeded'&&job.stage!=='saving')return false;
  if (job.state !== 'succeeded') return job.result === null;
  const result = job.kind === 'scan' ? shape(job.result, ['kind','dna'])
    : job.kind === 'recommendations' ? shape(job.result, ['kind','batch']) : shape(job.result, ['kind','scripts']);
  if (!result || result.kind !== job.kind) return false;
  if (result.kind === 'scan') {
    if (!creatorDna(result.dna)) return false;
    return object(result.dna)?.project_id === job.project_id;
  }
  if (result.kind === 'recommendations') return recommendations(result.batch);
  return result.kind === 'scripts' && scripts(result.scripts);
}
