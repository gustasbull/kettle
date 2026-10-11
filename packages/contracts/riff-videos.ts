import { z } from 'zod';
import { Id, Timestamp, result } from './index.ts';
import { CreatorUrl, TikTokImageUrl, VideoObservation } from './creator-profile.ts';

const boundedText=(max:number)=>z.string().trim().min(1).max(max);
const safeCount=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const RiffVideoRole=z.enum(['own_profile','discovered_reference']);
export const RiffVideoSort=z.literal('observed_at_desc');
export const ListRiffVideosInput=z.strictObject({
  project_id:Id.optional(),role:RiffVideoRole.optional(),sort:RiffVideoSort.optional(),
  cursor:z.string().min(1).max(1024).optional(),limit:z.number().int().min(1).max(20).optional(),
});
export const RiffVideoMetrics=z.strictObject({views:safeCount.nullable(),likes:safeCount.nullable(),
  comments:safeCount.nullable(),shares:safeCount.nullable(),saves:safeCount.nullable()});
export const RiffVideoCard=z.strictObject({
  id:Id,platform:z.literal('tiktok'),native_id:boundedText(200),canonical_url:CreatorUrl,
  caption:z.string().max(10_000).nullable(),thumbnail_url:TikTokImageUrl.nullable(),
  published_at:Timestamp.nullable(),duration_seconds:z.number().finite().positive().max(86_400).nullable(),
  metrics:RiffVideoMetrics,retrieved_at:Timestamp,source_observed_at:Timestamp.nullable(),observed_at:Timestamp,
  origin:z.enum(['fixture','live']),role:RiffVideoRole,permission_basis:boundedText(2_000),
  limitations:z.array(boundedText(1_000)).max(20),
}).refine(card=>{try{return new URL(card.canonical_url).hostname.replace(/^www\./,'')===`${card.platform}.com`;}catch{return false;}},
  'Card platform and canonical URL must match');
export const ListRiffVideosOutput=result(z.strictObject({cards:z.array(RiffVideoCard).max(20),
  next_cursor:z.string().min(1).max(1024).nullable(),coverage:boundedText(1_000),freshness:boundedText(1_000)}));
export const riffVideoContracts={list_riff_videos:{input:ListRiffVideosInput,output:ListRiffVideosOutput,
  scope:'projects:read',readOnly:true}} as const;
export type RiffVideoRole=z.infer<typeof RiffVideoRole>;
export type ListRiffVideosInput=z.infer<typeof ListRiffVideosInput>;
export type RiffVideoCard=z.infer<typeof RiffVideoCard>;
export type RiffVideoOperation=keyof typeof riffVideoContracts;

export const CatalogCheckpointKey=z.string().regex(/^[a-z0-9][a-z0-9:_-]{0,199}$/);
/** Strict server-only safe projection. It is never part of the public MCP contract. */
export const TrustedCatalogObservation=z.strictObject({
  id:Id,platform:z.literal('tiktok'),native_id:boundedText(200),canonical_url:CreatorUrl,
  caption:z.string().max(10_000).nullable(),thumbnail_url:TikTokImageUrl.nullable(),
  published_at:Timestamp.nullable(),duration_seconds:z.number().finite().positive().max(86_400).nullable(),
  metrics:RiffVideoMetrics,retrieved_at:Timestamp,source_observed_at:Timestamp.nullable(),
  origin:z.enum(['fixture','live']),permission_basis:boundedText(2_000),limitations:z.array(boundedText(1_000)).max(20),
}).refine(card=>{try{return new URL(card.canonical_url).hostname.replace(/^www\./,'')===`${card.platform}.com`;}catch{return false;}},
  'Observation platform and canonical URL must match');
export const TrustedRiffVideoIngest=z.strictObject({job_id:Id,checkpoint_key:CatalogCheckpointKey,
  role:RiffVideoRole,observations:z.array(TrustedCatalogObservation).min(1).max(10)}).superRefine((value,context)=>{
  if(new Set(value.observations.map(item=>item.id)).size!==value.observations.length)
    context.addIssue({code:'custom',message:'Observation IDs must be unique'});
  if(new Set(value.observations.map(item=>`${item.platform}:${item.native_id}`)).size!==value.observations.length)
    context.addIssue({code:'custom',message:'Video identities must be unique within an ingest'});
});
export const RiffVideoIngestReceipt=result(z.strictObject({status:z.enum(['stored','replay']),
  ingested_count:z.number().int().min(1).max(10),observation_ids:z.array(Id).min(1).max(10)}));
export type TrustedCatalogObservation=z.infer<typeof TrustedCatalogObservation>;
export type TrustedRiffVideoIngest=z.infer<typeof TrustedRiffVideoIngest>;

/** Maps an already validated provider observation and already-built safe caveats. */
export function trustedCatalogObservation(raw:z.infer<typeof VideoObservation>,limitations:readonly string[]):TrustedCatalogObservation{
  const observation=VideoObservation.parse(raw);
  if(observation.provenance.origin!=='live'||observation.provenance.permission.status!=='approved'||
    !observation.provenance.permission.permitted_uses.includes('store')||
    !observation.provenance.permission.permitted_uses.includes('display'))throw new Error('Catalog permission unavailable');
  return TrustedCatalogObservation.parse({id:observation.id,platform:observation.video.platform,
    native_id:observation.video.native_id,canonical_url:observation.canonical_url,caption:observation.caption,
    thumbnail_url:observation.thumbnail_url??null,published_at:observation.published_at,
    duration_seconds:observation.duration_seconds,metrics:{views:observation.metrics.views,likes:observation.metrics.likes,
      comments:observation.metrics.comments,shares:observation.metrics.shares,saves:observation.metrics.saves??null},
    retrieved_at:observation.provenance.retrieved_at,source_observed_at:observation.provenance.source_observed_at,
    origin:observation.provenance.origin,permission_basis:observation.provenance.permission.basis,
    limitations:[...limitations]});
}
