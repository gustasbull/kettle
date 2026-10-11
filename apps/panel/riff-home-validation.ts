import type { CreatorJobView, PipelineReference } from '../../packages/contracts/creator-pipeline.ts';

type JsonObject = Record<string, unknown>;

const object = (value: unknown): JsonObject | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
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
  const item = object(value);
  return !!item && enumValue(item.platform, ['tiktok', 'instagram']) && text(item.native_id, 200);
}

function metrics(value: unknown) {
  const item = object(value);
  return !!item && nullable(item.views, integer) && nullable(item.likes, integer)
    && nullable(item.comments, integer) && nullable(item.shares, integer)
    && optional(item, 'saves', candidate => nullable(candidate, integer));
}

function evidence(value: unknown) {
  const item = object(value);
  return !!item && id(item.observation_id) && creatorUrl(item.url) && timestamp(item.retrieved_at)
    && nullable(item.source_observed_at, timestamp) && enumValue(item.origin, ['fixture', 'live'])
    && nullable(item.published_at, timestamp) && (item.metrics === null || metrics(item.metrics))
    && optional(item, 'thumbnail_url', imageUrl)
    && optional(item, 'duration_seconds', candidate => candidate === null || number(candidate));
}

const dimensions = ['hook', 'content', 'style_pacing', 'voice_language', 'script', 'cta'] as const;
function reviewDimension(value: unknown) {
  const item = object(value);
  return !!item && enumValue(item.dimension, dimensions)
    && enumValue(item.status, ['working_well', 'needs_attention', 'needs_rework', 'unknown'])
    && text(item.summary, 3_000) && optional(item, 'recommendation', candidate => text(candidate, 2_000));
}

function seedReview(value: unknown) {
  const item = object(value);
  return !!item && creatorUrl(item.url) && item.provider === 'lightreel' && text(item.summary, 8_000)
    && enumValue(item.access_basis, ['video_access_reported', 'transcript_or_caption_only', 'unavailable', 'unknown'])
    && optional(item, 'dimensions', candidate => list(candidate, 6, reviewDimension, 6))
    && textList(item.limitations, 20, 1_000) && timestamp(item.retrieved_at)
    && enumValue(item.origin, ['fixture', 'live']);
}

function dnaClaim(value: unknown) {
  const item = object(value);
  return !!item && id(item.id)
    && enumValue(item.dimension, ['topics', 'audience', 'hooks', 'showcase', 'cta', 'duration', 'relative_performance', 'formats', 'pacing', 'structure'])
    && text(item.statement, 2_000);
}

function creatorDna(value: unknown) {
  const item = object(value); if (!item) return false;
  const coverage = object(item.coverage); const profile = object(item.profile);
  const summary = item.profile_summary === undefined ? undefined : object(item.profile_summary);
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
  const item = object(value); if (!item) return false;
  const multiplierBasis = item.view_multiplier_basis === undefined ? undefined : object(item.view_multiplier_basis);
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
  const item = object(value);
  return !!item && id(item.id) && text(item.title, 200) && text(item.concept, 3_000)
    && text(item.creator_fit, 3_000) && text(item.evidence_summary, 3_000) && text(item.execution, 3_000)
    && idList(item.reference_ids, 3, 1) && textList(item.limitations, 20, 1_000);
}

function recommendations(value: unknown) {
  const item = object(value); if (!item) return false;
  return id(item.id) && id(item.dna_id) && Number.isSafeInteger(item.dna_version) && Number(item.dna_version) > 0
    && timestamp(item.created_at) && list(item.references, 3, reference)
    && list(item.ideas, 3, idea) && typeof item.contains_fixture_data === 'boolean'
    && textList(item.limitations, 30, 1_000);
}

function segment(value: unknown) {
  const item = object(value);
  return !!item && enumValue(item.part, ['hook', 'main_content', 'cta'])
    && number(item.start_seconds) && number(item.end_seconds) && item.end_seconds > item.start_seconds
    && text(item.spoken_text, 4_000) && text(item.filming_direction, 3_000)
    && optional(item, 'on_screen_text', candidate => text(candidate, 1_000));
}

function variant(value: unknown) {
  const item = object(value);
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
  const item = object(value); if (!item) return false;
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
  const job = object(value); if (!job) return false;
  try { if (JSON.stringify(job).length > 1_500_000) return false; } catch { return false; }
  if (!id(job.id) || !id(job.project_id) || !Number.isSafeInteger(job.revision) || Number(job.revision) < 1
    || !enumValue(job.kind, ['scan', 'recommendations', 'scripts'])
    || !enumValue(job.state, ['queued', 'running', 'succeeded', 'failed', 'needs_reconciliation'])
    || !timestamp(job.created_at) || !timestamp(job.updated_at)
    || !(job.message === null || text(job.message, 1_000))) return false;
  if (job.source_kind !== undefined && (!enumValue(job.source_kind, ['video', 'profile']) || job.kind !== 'scan')) return false;
  if (job.state !== 'succeeded') return job.result === null;
  const result = object(job.result); if (!result || result.kind !== job.kind) return false;
  if (result.kind === 'scan') {
    if (!creatorDna(result.dna)) return false;
    return object(result.dna)?.project_id === job.project_id;
  }
  if (result.kind === 'recommendations') return recommendations(result.batch);
  return result.kind === 'scripts' && scripts(result.scripts);
}
