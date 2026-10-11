import type { CreatorJobView, PipelineReference } from '../../packages/contracts/creator-pipeline.ts';

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
const id = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const timestamp = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 64 && !Number.isNaN(Date.parse(value));
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const nullable = <T>(value: unknown, check: (candidate: unknown) => candidate is T): value is T | null =>
  value === null || check(value);
const list = <T = unknown>(value: unknown, max: number, check: (candidate: unknown) => boolean, min = 0): value is T[] =>
  Array.isArray(value) && value.length >= min && value.length <= max && value.every(check);
const enumValue = <T extends string>(value: unknown, values: readonly T[]): value is T =>
  typeof value === 'string' && values.includes(value as T);

const creatorUrl = (value: unknown): value is string => {
  if (!text(value, 2_048)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash
      && ['tiktok.com', 'www.tiktok.com', 'instagram.com', 'www.instagram.com'].includes(url.hostname.toLowerCase());
  } catch { return false; }
};

const imageUrl = (value: unknown): value is string => {
  if (!text(value, 4_096)) return false;
  try {
    const url = new URL(value); const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash
      && (host === 'tiktokcdn.com' || host.endsWith('.tiktokcdn.com'));
  } catch { return false; }
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

function evidence(value: unknown) {
  const item = shape(value, ['observation_id', 'url', 'retrieved_at', 'source_observed_at', 'origin', 'published_at', 'metrics'], ['thumbnail_url', 'duration_seconds']);
  return !!item && id(item.observation_id) && creatorUrl(item.url) && timestamp(item.retrieved_at)
    && nullable(item.source_observed_at, timestamp) && enumValue(item.origin, ['fixture', 'live'])
    && nullable(item.published_at, timestamp) && (item.metrics === null || metrics(item.metrics))
    && optional(item, 'thumbnail_url', imageUrl)
    && optional(item, 'duration_seconds', candidate => candidate === null || number(candidate));
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
  return !!item && creatorUrl(item.url) && item.provider === 'lightreel' && text(item.summary, 8_000)
    && enumValue(item.access_basis, ['video_access_reported', 'transcript_or_caption_only', 'unavailable', 'unknown'])
    && optional(item, 'dimensions', candidate => list(candidate, 6, reviewDimension, 6))
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
  return !!item && id(item.id)
    && enumValue(item.dimension, ['topics','formats','hooks','showcase','cta','structure','duration','pacing','relative_performance','audience'])
    && text(item.statement, 2_000) && enumValue(item.basis, ['observed','inferred','user_corrected'])
    && list(item.evidence, 50, claimEvidence) && typeof item.requires_video === 'boolean'
    && text(item.method, 500) && text(item.uncertainty, 1_000) && nullable(item.supersedes_claim_id, id);
}

function creatorDna(value: unknown) {
  const item = shape(value, ['dna_id','project_id','snapshot_id','profile','version','created_at','source_scan_id','scan_status','coverage','contains_fixture_data','requested_videos','coverage_limited','claims','evidence','withheld_claim_count','limitations'], ['profile_summary','seed_review']); if (!item) return false;
  const coverage = shape(item.coverage, ['unique_videos','oldest_published_at','newest_published_at']); const profile = shape(item.profile, ['platform','native_id']);
  const summary = item.profile_summary === undefined ? undefined : shape(item.profile_summary, ['handle','display_name','follower_count'], ['avatar_url']);
  return id(item.dna_id) && id(item.project_id) && id(item.snapshot_id) && identity(profile)
    && Number.isSafeInteger(item.version) && Number(item.version) > 0 && timestamp(item.created_at)
    && id(item.source_scan_id) && enumValue(item.scan_status, ['complete', 'partial', 'unavailable', 'failed'])
    && !!coverage && integer(coverage.unique_videos)
    && nullable(coverage.oldest_published_at, timestamp) && nullable(coverage.newest_published_at, timestamp)
    && typeof item.contains_fixture_data === 'boolean'
    && (!summary || (text(summary.handle, 100) && nullable(summary.display_name, candidate => text(candidate, 500, true))
      && nullable(summary.follower_count, integer) && optional(summary, 'avatar_url', imageUrl)))
    && Number.isSafeInteger(item.requested_videos) && Number(item.requested_videos) > 0
    && typeof item.coverage_limited === 'boolean' && list(item.claims, 100, dnaClaim)
    && optional(item, 'seed_review', seedReview) && list(item.evidence, 170, evidence)
    && integer(item.withheld_claim_count) && textList(item.limitations, 61, 1_000);
}

function reference(value: unknown): value is PipelineReference {
  const item = shape(value, ['id','platform','native_id','url','retrieved_at','published_at','caption','views','origin','permission_basis','limitations'], ['thumbnail_url','duration_seconds','likes','saves','view_multiplier','view_multiplier_basis']); if (!item) return false;
  const multiplierBasis = item.view_multiplier_basis === undefined ? undefined : shape(item.view_multiplier_basis, ['method','baseline_views','sample_size']);
  return id(item.id) && item.platform === 'tiktok' && text(item.native_id, 200) && creatorUrl(item.url)
    && timestamp(item.retrieved_at) && nullable(item.published_at, timestamp)
    && nullable(item.caption, candidate => text(candidate, 10_000, true)) && nullable(item.views, integer)
    && optional(item, 'thumbnail_url', imageUrl)
    && optional(item, 'duration_seconds', candidate => candidate === null || number(candidate))
    && optional(item, 'likes', candidate => candidate === null || integer(candidate))
    && optional(item, 'saves', candidate => candidate === null || integer(candidate))
    && optional(item, 'view_multiplier', number)
    && (!multiplierBasis || (multiplierBasis.method === 'median_observed_profile_views'
      && number(multiplierBasis.baseline_views) && multiplierBasis.baseline_views > 0
      && Number.isSafeInteger(multiplierBasis.sample_size) && Number(multiplierBasis.sample_size) > 0))
    && enumValue(item.origin, ['fixture', 'live']) && text(item.permission_basis, 2_000)
    && textList(item.limitations, 20, 1_000);
}

function idea(value: unknown) {
  const item = shape(value, ['id','title','concept','creator_fit','evidence_summary','execution','reference_ids','limitations']);
  return !!item && id(item.id) && text(item.title, 200) && text(item.concept, 3_000)
    && text(item.creator_fit, 3_000) && text(item.evidence_summary, 3_000) && text(item.execution, 3_000)
    && idList(item.reference_ids, 3, 1) && textList(item.limitations, 20, 1_000);
}

function recommendations(value: unknown) {
  const item = shape(value, ['id','dna_id','dna_version','created_at','references','ideas','contains_fixture_data','limitations']); if (!item) return false;
  return id(item.id) && id(item.dna_id) && Number.isSafeInteger(item.dna_version) && Number(item.dna_version) > 0
    && timestamp(item.created_at) && list(item.references, 3, reference)
    && list(item.ideas, 3, idea) && typeof item.contains_fixture_data === 'boolean'
    && textList(item.limitations, 30, 1_000);
}

function segment(value: unknown) {
  const item = shape(value, ['part','start_seconds','end_seconds','spoken_text','filming_direction'], ['on_screen_text']);
  return !!item && enumValue(item.part, ['hook', 'main_content', 'cta'])
    && number(item.start_seconds) && number(item.end_seconds) && item.end_seconds > item.start_seconds
    && text(item.spoken_text, 4_000) && text(item.filming_direction, 3_000)
    && optional(item, 'on_screen_text', candidate => text(candidate, 1_000));
}

function variant(value: unknown) {
  const item = shape(value, ['id','label','hook','opening_visual','script','shots','b_roll','on_screen_text','showcase_timing','cta','estimated_duration_seconds','pacing','reference_ids','limitations'], ['timed_segments','caption','hashtags']);
  return !!item && id(item.id) && enumValue(item.label, ['Reference-led', 'Creator Fit', 'Experimental'])
    && text(item.hook, 2_000) && text(item.opening_visual, 2_000) && text(item.script, 12_000)
    && textList(item.shots, 30, 2_000, 1) && textList(item.b_roll, 30, 2_000)
    && textList(item.on_screen_text, 30, 1_000) && text(item.showcase_timing, 1_000)
    && text(item.cta, 2_000) && number(item.estimated_duration_seconds) && item.estimated_duration_seconds > 0
    && text(item.pacing, 2_000) && idList(item.reference_ids, 3, 1)
    && textList(item.limitations, 20, 1_000)
    && optional(item, 'timed_segments', candidate => list(candidate, 10, segment, 1))
    && optional(item, 'caption', candidate => text(candidate, 3_000))
    && optional(item, 'hashtags', candidate => textList(candidate, 30, 101));
}

function scripts(value: unknown) {
  const item = shape(value, ['id','batch_id','idea_id','dna_id','dna_version','version','created_at','variants','contains_fixture_data','limitations'], ['idea','references']); if (!item) return false;
  const hasIdea = item.idea !== undefined; const hasReferences = item.references !== undefined;
  return id(item.id) && id(item.batch_id) && id(item.idea_id) && id(item.dna_id)
    && Number.isSafeInteger(item.dna_version) && Number(item.dna_version) > 0 && item.version === 1
    && timestamp(item.created_at) && list(item.variants, 3, variant, 2)
    && hasIdea === hasReferences && (!hasIdea || (idea(item.idea) && list(item.references, 3, reference, 1)))
    && typeof item.contains_fixture_data === 'boolean' && textList(item.limitations, 30, 1_000);
}

/** Lightweight full display-boundary validation. This deliberately avoids pulling
 * the server's Zod graph into Home's first-paint bundle. */
export function isCreatorJobView(value: unknown): value is CreatorJobView {
  const candidate = object(value); if (!candidate) return false;
  const job = shape(candidate, ['id','project_id','revision','kind','state','created_at','updated_at','result','message'], ['source_kind']); if (!job) return false;
  try { if (JSON.stringify(job).length > 1_500_000) return false; } catch { return false; }
  if (!id(job.id) || !id(job.project_id) || !Number.isSafeInteger(job.revision) || Number(job.revision) < 1
    || !enumValue(job.kind, ['scan', 'recommendations', 'scripts'])
    || !enumValue(job.state, ['queued', 'running', 'succeeded', 'failed', 'needs_reconciliation'])
    || !timestamp(job.created_at) || !timestamp(job.updated_at)
    || !(job.message === null || text(job.message, 1_000))) return false;
  if (job.source_kind !== undefined && (!enumValue(job.source_kind, ['video', 'profile']) || job.kind !== 'scan')) return false;
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
