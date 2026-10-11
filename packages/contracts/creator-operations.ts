import { z } from 'zod';
import { Id, Timestamp, result } from './index.ts';
import { CreatorAnalysis, CreatorDnaSnapshot, CreatorIdentity, CreatorUrl, CorrectCreatorDnaInput, ProfileScanResult, LightreelSeedReview, TikTokImageUrl } from './creator-profile.ts';

export const GetCreatorDnaInput = z.strictObject({ dna_id: Id, version: z.number().int().positive().max(2147483646).optional() });
/** Server ingestion only. Never accept this shape from a public tool. */
export const IngestCreatorAnalysisInput = z.strictObject({
  project_id: Id, request_id: Id, analysis: CreatorAnalysis,
}).refine(v => v.analysis.dna.version === 1 && v.analysis.dna.claims.every(c => c.basis !== 'user_corrected'), 'Ingestion creates an initial analysis, not a correction');
export const StoredCreatorAnalysis = z.strictObject({ dna_id: Id, project_id: Id, analysis: CreatorAnalysis });
export const StoredCreatorOutput = result(StoredCreatorAnalysis);

// Explicit allowlist. Raw captions/bios, provider endpoints, permission notes, cursors,
// error bodies, attempt accounting and account IDs never reach model/card results.
export const CreatorEvidenceView = z.strictObject({
  observation_id: Id, url: CreatorUrl, retrieved_at: Timestamp, source_observed_at: Timestamp.nullable(),
  origin: z.enum(['fixture', 'live']), published_at: Timestamp.nullable(),
  thumbnail_url: TikTokImageUrl.optional(), duration_seconds: z.number().positive().finite().nullable().optional(),
  metrics: z.strictObject({ views: z.number().int().nonnegative().nullable(), likes: z.number().int().nonnegative().nullable(),
    comments: z.number().int().nonnegative().nullable(), shares: z.number().int().nonnegative().nullable(),
    saves: z.number().int().nonnegative().nullable().optional() }).nullable(),
});
const ProfileAnalysisMetric = z.strictObject({
  value: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sample_size: z.number().int().positive().max(50),
  basis: z.literal('sum_observed_post_views'),
});
const ProfileEngagementMetric = z.strictObject({
  percent: z.number().finite().nonnegative(), sample_size: z.number().int().positive().max(50),
  basis: z.literal('engagements_divided_by_views'),
});
const ProfileFinding = z.strictObject({
  claim_id: Id, evidence_summary: z.string().trim().min(1).max(3000), recommendation: z.string().trim().min(1).max(3000),
});
const ProfileAnalysis = z.strictObject({
  performance: z.strictObject({ observed_views: ProfileAnalysisMetric.optional(), engagement_rate: ProfileEngagementMetric.optional() }).optional(),
  top_content: z.array(z.strictObject({
    observation_id: Id, rank: z.union([z.literal(1), z.literal(2), z.literal(3)]), basis: z.literal('observed_views'),
  })).min(1).max(3).optional(),
  findings: z.strictObject({
    working: ProfileFinding, improvement: ProfileFinding,
    next_move: z.strictObject({ title: z.string().trim().min(1).max(3000), rationale: z.string().trim().min(1).max(3000), claim_ids: z.array(Id).min(1).max(100) }),
  }).optional(),
});
export const CreatorDnaView = z.strictObject({
  dna_id: Id, project_id: Id, snapshot_id: Id, profile: CreatorIdentity,
  version: z.number().int().positive(), created_at: Timestamp,
  source_scan_id: Id, scan_status: ProfileScanResult.shape.status,
  coverage: ProfileScanResult.shape.coverage.pick({ unique_videos: true, oldest_published_at: true, newest_published_at: true }),
  contains_fixture_data: z.boolean(),
  profile_summary: z.strictObject({
    handle: z.string().trim().min(1).max(100), display_name: z.string().max(500).nullable(),
    follower_count: z.number().int().nonnegative().nullable(), avatar_url: TikTokImageUrl.optional(),
  }).optional(),
  profile_analysis: ProfileAnalysis.optional(),
  requested_videos: z.number().int().positive(), coverage_limited: z.boolean(),
  claims: CreatorDnaSnapshot.shape.claims,
  seed_review: z.strictObject({url:LightreelSeedReview.shape.url,provider:LightreelSeedReview.shape.provider,
    summary:LightreelSeedReview.shape.summary,access_basis:LightreelSeedReview.shape.access_basis,
    dimensions:LightreelSeedReview.shape.dimensions,
    limitations:LightreelSeedReview.shape.limitations,retrieved_at:Timestamp,origin:z.enum(['fixture','live'])}).optional(),
  evidence: z.array(CreatorEvidenceView).max(170),
  withheld_claim_count: z.number().int().nonnegative(),
  limitations: z.array(z.string().max(1000)).max(61),
}).superRefine((view, ctx) => {
  const analysis = view.profile_analysis; if (!analysis) return;
  for (const sample of [analysis.performance?.observed_views, analysis.performance?.engagement_rate]) {
    if (sample && sample.sample_size > view.coverage.unique_videos) ctx.addIssue({ code: 'custom', message: 'Profile analysis sample exceeds coverage' });
  }
  if (analysis.top_content) {
    const evidence = new Map(view.evidence.map(item => [item.observation_id, item]));
    if (new Set(analysis.top_content.map(item => item.observation_id)).size !== analysis.top_content.length ||
      analysis.top_content.some((item, index) => item.rank !== index + 1 || evidence.get(item.observation_id)?.metrics?.views == null)) {
      ctx.addIssue({ code: 'custom', message: 'Top content must be contiguous observed public evidence' });
    }
  }
  if (analysis.findings) {
    const claimIds = new Set(view.claims.map(claim => claim.id));
    const nextIds = analysis.findings.next_move.claim_ids;
    if (!claimIds.has(analysis.findings.working.claim_id) || !claimIds.has(analysis.findings.improvement.claim_id) ||
      new Set(nextIds).size !== nextIds.length || nextIds.some(id => !claimIds.has(id))) {
      ctx.addIssue({ code: 'custom', message: 'Profile findings must cite public claims' });
    }
  }
});
export const GetCreatorDnaOutput = result(z.strictObject({ dna: CreatorDnaView }));
export const CorrectCreatorDnaOutput = result(z.strictObject({ dna: CreatorDnaView, request_id: Id }));
export const creatorContracts = {
  get_creator_dna: { input: GetCreatorDnaInput, output: GetCreatorDnaOutput, scope: 'projects:read', readOnly: true },
  correct_creator_dna: { input: CorrectCreatorDnaInput.refine(v => v.expected_version < 2147483646, 'Version exceeds storage limit'), output: CorrectCreatorDnaOutput, scope: 'projects:write', readOnly: false },
} as const;
export type CreatorOperation = keyof typeof creatorContracts;
export type StoredCreatorAnalysis = z.infer<typeof StoredCreatorAnalysis>;
export type CreatorDnaView = z.infer<typeof CreatorDnaView>;
