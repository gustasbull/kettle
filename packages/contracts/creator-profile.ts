/** D0 internal contracts. No public tools, authorization, persistence or spending authority. */
import { z } from 'zod';
import { Id, Timestamp, HttpUrl } from './index.ts';

const text = (max: number) => z.string().trim().min(1).max(max);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const CreatorPlatform = z.enum(['tiktok', 'instagram']);
const identity = z.strictObject({ platform: CreatorPlatform, native_id: text(200) });
export const CreatorIdentity = identity;
/** Display-only TikTok image URL. Provider media is untrusted, so only TikTok's
 * HTTPS image CDN is admitted; playback/download URLs are never represented. */
export const TikTokImageUrl = z.url().max(4096).refine(value => {
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.hash &&
      (host === 'tiktokcdn.com' || host.endsWith('.tiktokcdn.com'));
  } catch { return false; }
}, 'Use a credential-free HTTPS tiktokcdn.com image URL without port or fragment');
export const CreatorUrl = HttpUrl.refine(value => {
  const u = new URL(value);
  return u.protocol === 'https:' && !u.port && !u.search && !u.hash &&
    ['www.tiktok.com', 'tiktok.com', 'www.instagram.com', 'instagram.com'].includes(u.hostname);
}, 'Use a canonical HTTPS platform URL without query or fragment');
export const ProfileScanRequest = z.strictObject({
  platform: z.literal('tiktok'),
  supplied_url: CreatorUrl,
  max_videos: z.number().int().min(1).max(50),
  max_pages: z.number().int().min(1).max(3),
}).refine(v => {
  const u = new URL(v.supplied_url);
  return ['tiktok.com', 'www.tiktok.com'].includes(u.hostname) && /^\/@[\w.]+\/?$/.test(u.pathname);
}, 'D1 accepts TikTok profile URLs only');

export const ObservationProvenance = z.strictObject({
  provider: text(100), endpoint: text(200), origin: z.enum(['fixture', 'live']),
  retrieved_at: Timestamp, source_observed_at: Timestamp.nullable(), source_url: CreatorUrl,
  permission: z.strictObject({ status: z.enum(['fixture_only', 'needs_review', 'approved']),
    basis: text(2000), permitted_uses: z.array(z.enum(['store', 'display', 'model_processing', 'media_analysis'])).max(4),
    retention: text(1000),
  }),
  modalities: z.array(z.enum(['metadata', 'caption', 'transcript', 'image', 'video'])).min(1).max(5),
}).refine(p => p.origin === 'fixture' ? p.permission.status === 'fixture_only' : p.permission.status !== 'fixture_only',
  'Fixture/live provenance must agree with permission status');

export const ProfileObservation = z.strictObject({
  id: Id, profile: identity, canonical_url: CreatorUrl, handle: text(100),
  display_name: z.string().max(500).nullable(), bio: z.string().max(10000).nullable(),
  follower_count: count.nullable(), avatar_url: TikTokImageUrl.optional(), provenance: ObservationProvenance,
});
export const VideoObservation = z.strictObject({
  id: Id, video: identity, creator: identity, canonical_url: CreatorUrl,
  caption: z.string().max(10000).nullable(), published_at: Timestamp.nullable(),
  duration_seconds: z.number().positive().finite().nullable(), thumbnail_url: TikTokImageUrl.optional(),
  metrics: z.strictObject({ views: count.nullable(), likes: count.nullable(),
    comments: count.nullable(), shares: count.nullable(), saves: count.nullable().optional() }),
  provenance: ObservationProvenance,
});
export const ScanCostEvidence = z.strictObject({
  attempts: z.array(z.strictObject({ id: Id, provider: text(100),
    outcome: z.enum(['succeeded', 'failed', 'ambiguous']),
    credits: z.number().nonnegative().finite().nullable(),
    usd: z.number().nonnegative().finite().nullable(),
    usd_basis: z.enum(['unknown', 'estimated', 'measured']),
    conversion_basis: text(2000).nullable(),
  }).refine(a => a.usd_basis === 'unknown' ? a.usd === null : a.usd !== null && a.conversion_basis !== null,
    'Known dollar costs require a basis; unknown cost stays null')).max(20),
  latency_ms: count,
});
export const ScanCoverage = z.strictObject({
  pages_received: z.number().int().min(0).max(3), unique_videos: z.number().int().min(0).max(50),
  rejected_items: count, pagination: z.enum(['exhausted', 'more', 'unknown']),
  stop_reason: z.enum(['exhausted', 'limit', 'unknown', 'inaccessible', 'error']),
  omissions: z.array(text(1000)).max(30),
  oldest_published_at: Timestamp.nullable(), newest_published_at: Timestamp.nullable(),
  pages: z.array(z.strictObject({
    requested_cursor: text(500).nullable(), returned_cursor: text(500).nullable(),
    received_items: count, admitted_observations: count,
  }).refine(p => p.admitted_observations <= p.received_items, 'Admitted rows exceed received rows')).max(3),
  errors: z.array(z.strictObject({
    code: z.enum(['private', 'not_found', 'rate_limited', 'timeout', 'malformed', 'provider_failure']),
    attempt_id: Id.nullable(), retryable: z.boolean(),
  })).max(20),
});
const same = (a: z.infer<typeof identity>, b: z.infer<typeof identity>) => a.platform === b.platform && a.native_id === b.native_id;
const platformUrl = (platform: string, url: string) => new URL(url).hostname.replace(/^www\./, '') === `${platform}.com`;
export const ProfileScanResult = z.strictObject({
  id: Id, request: ProfileScanRequest, created_at: Timestamp,
  status: z.enum(['complete', 'partial', 'unavailable', 'failed']),
  profile: identity.nullable(), profile_observations: z.array(ProfileObservation).max(20),
  video_observations: z.array(VideoObservation).max(150), coverage: ScanCoverage,
  limitations: z.array(text(1000)).max(30), cost: ScanCostEvidence,
}).superRefine((s, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  const observations = [...s.profile_observations, ...s.video_observations];
  if (new Set(observations.map(o => o.id)).size !== observations.length) issue('Observation IDs must be unique');
  if (new Set(s.cost.attempts.map(a => a.id)).size !== s.cost.attempts.length) issue('Attempt IDs must be unique');
  if (s.profile && s.profile.platform !== s.request.platform) issue('Requested platform mismatch');
  if (!s.profile && observations.length) issue('Unresolved profiles cannot carry observations');
  if (['complete', 'partial'].includes(s.status) && (!s.profile || !s.profile_observations.length)) issue('Resolved scan needs profile evidence');
  for (const o of observations) {
    const owner = 'creator' in o ? o.creator : o.profile;
    if (!s.profile || !same(owner, s.profile)) issue('Observation belongs to another profile');
    if ('video' in o && o.video.platform !== owner.platform) issue('Video platform mismatch');
    if (!platformUrl(owner.platform, o.canonical_url) || !platformUrl(owner.platform, o.provenance.source_url)) issue('Observation URL platform mismatch');
  }
  const unique = new Set(s.video_observations.map(o => `${o.video.platform}:${o.video.native_id}`)).size;
  if (s.coverage.unique_videos !== unique || unique > s.request.max_videos) issue('Unique video count or bound mismatch');
  if (s.coverage.pages_received > s.request.max_pages || s.coverage.pages.length !== s.coverage.pages_received) issue('Page count or bound mismatch');
  if (s.coverage.pages.reduce((n, p) => n + p.admitted_observations, 0) !== s.video_observations.length) issue('Page admissions must match video observations');
  for (const e of s.coverage.errors) if (e.attempt_id && !s.cost.attempts.some(a => a.id === e.attempt_id)) issue('Error references missing attempt');
  const dates = s.video_observations.map(o => o.published_at).filter((d): d is string => d !== null).sort((a, b) => Date.parse(a) - Date.parse(b));
  if (s.coverage.oldest_published_at !== (dates[0] ?? null) || s.coverage.newest_published_at !== (dates.at(-1) ?? null)) issue('Covered dates must match admitted observations');
  if (s.status === 'unavailable' && (s.profile || observations.length)) issue('Unavailable scan cannot claim resolved data');
  if (s.coverage.stop_reason === 'exhausted' && s.coverage.pagination !== 'exhausted') issue('Exhaustion requires matching pagination evidence');
  if (s.status === 'complete' && (s.coverage.pages_received === 0 || s.coverage.errors.length ||
      (s.coverage.stop_reason === 'limit' && unique < s.request.max_videos && s.coverage.pages_received < s.request.max_pages))) issue('Complete sample must have reached a bound or exhausted the feed');
  if (s.status !== 'complete' && !s.limitations.length) issue('Incomplete scans must explain limitations');
  if (s.status === 'complete' && (s.coverage.rejected_items > 0 || s.coverage.omissions.length > 0 ||
      !['limit', 'exhausted'].includes(s.coverage.stop_reason))) issue('Complete means bounded sample fulfilled without known omissions');
});

export const DnaDimension = z.enum(['topics', 'formats', 'hooks', 'showcase', 'cta', 'structure',
  'duration', 'pacing', 'relative_performance', 'audience']);
export const DnaClaim = z.strictObject({
  id: Id, dimension: DnaDimension, statement: text(2000),
  basis: z.enum(['observed', 'inferred', 'user_corrected']),
  evidence: z.array(z.strictObject({ observation_id: Id,
    modality: z.enum(['metadata', 'caption', 'transcript', 'image', 'video']),
    start_seconds: z.number().nonnegative().finite().nullable(),
    end_seconds: z.number().positive().finite().nullable(),
  }).refine(e => e.modality === 'video'
    ? e.start_seconds !== null && e.end_seconds !== null && e.end_seconds > e.start_seconds
    : e.start_seconds === null && e.end_seconds === null, 'Video evidence needs a valid time range')).max(50),
  requires_video: z.boolean(), method: text(500), uncertainty: text(1000),
  supersedes_claim_id: Id.nullable(),
}).superRefine((c, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (c.basis !== 'user_corrected' && !c.evidence.length) issue('Analysis claims need evidence');
  if (c.basis === 'user_corrected' && !c.supersedes_claim_id) issue('Corrections identify the prior claim');
  if (c.basis !== 'user_corrected' && c.supersedes_claim_id) issue('Only corrections supersede claims');
  if (c.basis !== 'user_corrected' && (c.requires_video || c.dimension === 'pacing') && !c.evidence.some(e => e.modality === 'video')) issue('Visual/pacing analysis needs video evidence');
});
export const CreatorDnaSnapshot = z.strictObject({
  id: Id, profile: identity, version: z.number().int().positive(), created_at: Timestamp,
  source_scan_id: Id, analyzer_version: text(100), taxonomy_version: text(100),
  claims: z.array(DnaClaim).max(100), limitations: z.array(text(1000)).max(30),
}).refine(d => new Set(d.claims.map(c => c.id)).size === d.claims.length, 'Claim IDs must be unique');
/** Provider-authored review of the supplied video, not verified profile-wide DNA. */
export const PaperAnalysisDimension = z.enum(['hook', 'content', 'style_pacing', 'voice_language', 'script', 'cta']);
export const PaperAnalysisAssessment = z.strictObject({
  dimension: PaperAnalysisDimension,
  status: z.enum(['working_well', 'needs_attention', 'needs_rework', 'unknown']),
  summary: text(3000),
  recommendation: text(2000).optional(),
});
const PaperAnalysisAssessments = z.array(PaperAnalysisAssessment).length(6).superRefine((items, ctx) => {
  const dimensions = new Set(items.map(item => item.dimension));
  if (dimensions.size !== PaperAnalysisDimension.options.length ||
      PaperAnalysisDimension.options.some(dimension => !dimensions.has(dimension))) {
    ctx.addIssue({ code: 'custom', message: 'Structured review must contain each Paper analysis dimension exactly once' });
  }
});
export const LightreelSeedReview = z.strictObject({
  url: CreatorUrl.refine(v => /^\/@[\w.]+\/video\/\d{1,30}$/.test(new URL(v).pathname)),
  provider: z.literal('lightreel'), conversation_id: text(200),
  summary: text(8000),
  access_basis: z.enum(['video_access_reported','transcript_or_caption_only','unavailable','unknown']),
  dimensions: PaperAnalysisAssessments.optional(),
  limitations: z.array(text(1000)).max(20), provenance: ObservationProvenance,
}).superRefine((review, ctx) => {
  const issue = (message: string, path: PropertyKey[] = []) => ctx.addIssue({ code: 'custom', message, path });
  if (review.provenance.provider !== 'lightreel' || review.provenance.source_url !== review.url) {
    issue('Seed review must retain its Lightreel source attribution');
  }
  if (!review.dimensions) return;
  if (review.dimensions.some(item => item.status === 'unknown' && item.recommendation !== undefined)) {
    issue('Unknown assessments cannot carry unsupported recommendations', ['dimensions']);
  }
  if (['unavailable', 'unknown'].includes(review.access_basis) &&
      review.dimensions.some(item => item.status !== 'unknown')) {
    issue('Unavailable or unknown access requires unknown dimension statuses', ['dimensions']);
  }
  if (review.access_basis === 'transcript_or_caption_only' &&
      review.dimensions.find(item => item.dimension === 'style_pacing')?.status !== 'unknown') {
    issue('Text-only access cannot assess style and pacing', ['dimensions']);
  }
});
/** Validate this envelope at the adapter/application boundary, not snapshot alone. */
export const CreatorAnalysis = z.strictObject({ scan: ProfileScanResult, dna: CreatorDnaSnapshot, seed_review: LightreelSeedReview.optional() })
  .superRefine(({ scan, dna, seed_review }, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (!scan.profile || !same(scan.profile, dna.profile) || dna.source_scan_id !== scan.id) issue('DNA scan/profile lineage mismatch');
    if (seed_review && (!seed_review.url.startsWith(scan.request.supplied_url.replace(/\/$/,'')+'/video/') ||
      seed_review.provenance.permission.status === 'needs_review' ||
      !seed_review.provenance.permission.permitted_uses.includes('model_processing'))) issue('Seed review profile or permission mismatch');
    const observations = new Map([...scan.profile_observations, ...scan.video_observations].map(o => [o.id, o]));
    for (const c of dna.claims) for (const e of c.evidence) {
      const o = observations.get(e.observation_id);
      if (!o || !o.provenance.modalities.includes(e.modality)) { issue('Missing evidence or unavailable modality'); continue; }
      const p = o.provenance.permission;
      if (c.basis !== 'user_corrected' && (p.status === 'needs_review' || !p.permitted_uses.includes('model_processing'))) issue('Evidence is not permitted for analysis');
      if (e.modality === 'image' && !p.permitted_uses.includes('media_analysis')) issue('Image analysis permission missing');
      if (e.modality === 'video' && (!('duration_seconds' in o) || o.duration_seconds === null ||
          e.end_seconds! > o.duration_seconds || !p.permitted_uses.includes('media_analysis'))) issue('Video range or analysis permission invalid');
    }
  });
/** Replacement text only: callers cannot mint provider evidence/provenance. */
export const CorrectCreatorDnaInput = z.strictObject({
  dna_id: Id, expected_version: z.number().int().positive(), request_id: Id,
  corrections: z.array(z.strictObject({ claim_id: Id, statement: text(2000) })).min(1).max(100),
}).refine(v => new Set(v.corrections.map(c => c.claim_id)).size === v.corrections.length, 'Correct each claim once');
export type ProfileScanRequest = z.infer<typeof ProfileScanRequest>;
export type ProfileScanResult = z.infer<typeof ProfileScanResult>;
export type CreatorDnaSnapshot = z.infer<typeof CreatorDnaSnapshot>;
export type CreatorAnalysis = z.infer<typeof CreatorAnalysis>;
export type CorrectCreatorDnaInput = z.infer<typeof CorrectCreatorDnaInput>;

export type CreatorIdentity = z.infer<typeof CreatorIdentity>;
export type ObservationProvenance = z.infer<typeof ObservationProvenance>;
export type ProfileObservation = z.infer<typeof ProfileObservation>;
export type VideoObservation = z.infer<typeof VideoObservation>;
export type ScanCoverage = z.infer<typeof ScanCoverage>;
export type ScanCostEvidence = z.infer<typeof ScanCostEvidence>;
export type DnaClaim = z.infer<typeof DnaClaim>;
