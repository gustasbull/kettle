import { z } from 'zod';
import { Id, type Failure } from '../contracts/index.ts';
import { CreatorDnaView, IngestCreatorAnalysisInput, StoredCreatorOutput, creatorContracts, type CreatorOperation, type StoredCreatorAnalysis } from '../contracts/creator-operations.ts';
import { failure, type IdentityVerifier } from './operations.ts';

export type CreatorRepositoryOperation = CreatorOperation | 'ingest_creator_analysis';
export interface CreatorRepository {
  call(operation: CreatorRepositoryOperation, accountId: string, input: unknown): Promise<unknown>;
}
export function creatorFailure(code: Failure['error']['code']): Failure {
  const response = failure(code);
  if (code === 'NOT_FOUND') response.error.message = 'This creator analysis is unavailable.';
  if (code === 'VERSION_CONFLICT') response.error.message = 'The creator DNA has changed. Reload before correcting it.';
  return response;
}
/** Pure projection. Never serialize the internal stored envelope to a public client. */
export function projectCreatorDna(stored: StoredCreatorAnalysis): CreatorDnaView {
  const { scan, dna } = stored.analysis;
  const review=stored.analysis.seed_review;
  const reviewVisible=review && review.provenance.permission.status!=='needs_review' && review.provenance.permission.permitted_uses.includes('display');
  const observations = [...scan.profile_observations, ...scan.video_observations];
  const displayable = observations.filter(o => o.provenance.permission.status !== 'needs_review' && o.provenance.permission.permitted_uses.includes('display'));
  const profileObservation = scan.profile_observations.find(o => displayable.some(candidate => candidate.id === o.id));
  const allowed = new Set(displayable.map(o => o.id));
  // Withhold a whole derived claim when any of its supporting evidence is restricted.
  const claims = dna.claims.filter(c => c.evidence.every(e => allowed.has(e.observation_id)));
  const referenced = new Set(claims.flatMap(c => c.evidence.map(e => e.observation_id)));
  if(reviewVisible&&review){
    const seedObservation=scan.video_observations.find(observation=>observation.canonical_url===review.url&&allowed.has(observation.id));
    if(seedObservation)referenced.add(seedObservation.id);
  }
  return CreatorDnaView.parse({
    dna_id: stored.dna_id, project_id: stored.project_id, snapshot_id: dna.id, profile: dna.profile,
    version: dna.version, created_at: dna.created_at, source_scan_id: scan.id, scan_status: scan.status,
    coverage: { unique_videos: scan.coverage.unique_videos, oldest_published_at: scan.coverage.oldest_published_at, newest_published_at: scan.coverage.newest_published_at },
    contains_fixture_data: observations.some(o => o.provenance.origin === 'fixture') || review?.provenance.origin==='fixture',
    ...(profileObservation?{profile_summary:{handle:profileObservation.handle,display_name:profileObservation.display_name,
      follower_count:profileObservation.follower_count,...(profileObservation.avatar_url?{avatar_url:profileObservation.avatar_url}:{})}}:{}),
    ...(reviewVisible?{seed_review:{url:review.url,provider:review.provider,summary:review.summary,access_basis:review.access_basis,
      ...(review.dimensions?{dimensions:review.dimensions}:{}),
      limitations:review.limitations,retrieved_at:review.provenance.retrieved_at,origin:review.provenance.origin}}:{}),
    requested_videos: scan.request.max_videos, coverage_limited: true,
    claims, evidence: displayable.filter(o => referenced.has(o.id)).map(o => ({
      observation_id: o.id, url: o.canonical_url, retrieved_at: o.provenance.retrieved_at,
      source_observed_at: o.provenance.source_observed_at, origin: o.provenance.origin,
      published_at: 'published_at' in o ? o.published_at : null,
      ...('thumbnail_url' in o && o.thumbnail_url ? {thumbnail_url:o.thumbnail_url} : {}),
      ...('duration_seconds' in o ? {duration_seconds:o.duration_seconds} : {}),
      metrics: 'metrics' in o ? o.metrics : null,
    })),
    withheld_claim_count: dna.claims.length - claims.length,
    // Provider-generated free text is not safe merely because it is called a limitation.
    limitations: ['Coverage describes a bounded sample, not the entire profile.',
      ...(scan.status === 'partial' ? ['The scan returned a partial result.'] : []),
      ...(claims.length < dna.claims.length ? ['Some claims are withheld because source display permission is unavailable.'] : [])],
  });
}
export function createCreatorOperations(verifier: IdentityVerifier, repository: CreatorRepository) {
  return {
    async execute<K extends CreatorOperation>(operation: K, credential: string | null, rawInput: unknown): Promise<z.infer<(typeof creatorContracts)[K]['output']> | Failure> {
      if (!credential) return creatorFailure('UNAUTHENTICATED');
      let identity;
      try { identity = await verifier.verify(credential); } catch { return creatorFailure('UNAUTHENTICATED'); }
      if (!identity || !Id.safeParse(identity.account_id).success) return creatorFailure('UNAUTHENTICATED');
      const contract = creatorContracts[operation];
      if (!identity.scopes.includes(contract.scope)) return creatorFailure('FORBIDDEN');
      const input = contract.input.safeParse(rawInput);
      if (!input.success) return creatorFailure('VALIDATION_ERROR');
      try {
        const output = StoredCreatorOutput.parse(await repository.call(operation, identity.account_id, input.data));
        if (!output.ok) return creatorFailure(output.error.code);
        if (output.data.dna_id !== input.data.dna_id) return creatorFailure('UNAVAILABLE');
        if ('version' in input.data && input.data.version !== undefined && output.data.analysis.dna.version !== input.data.version) return creatorFailure('UNAVAILABLE');
        if ('expected_version' in input.data && output.data.analysis.dna.version !== input.data.expected_version + 1) return creatorFailure('UNAVAILABLE');
        const dna = projectCreatorDna(output.data);
        return contract.output.parse({ ok: true, data: { dna,
          ...('request_id' in input.data ? { request_id: input.data.request_id } : {}) } }) as z.infer<(typeof creatorContracts)[K]['output']>;
      } catch { return creatorFailure('UNAVAILABLE'); }
    },
  };
}
/** Trusted worker/application seam only. accountId comes from durable authorized intent.
 * No public ingestion operation, credential bypass, or arbitrary client analysis input. */
export function createCreatorIngestion(repository: CreatorRepository) {
  return async (accountId: string, rawInput: unknown) => {
    const input = IngestCreatorAnalysisInput.safeParse(rawInput);
    if (!Id.safeParse(accountId).success || !input.success) return creatorFailure('VALIDATION_ERROR');
    const { scan } = input.data.analysis;
    const review=input.data.analysis.seed_review;
    if(review && (review.provenance.permission.status==='needs_review'||!review.provenance.permission.permitted_uses.includes('store')))return creatorFailure('FORBIDDEN');
    if (![...scan.profile_observations, ...scan.video_observations].every(o =>
      o.provenance.permission.status !== 'needs_review' && o.provenance.permission.permitted_uses.includes('store'))) return creatorFailure('FORBIDDEN');
    try {
      const output = StoredCreatorOutput.parse(await repository.call('ingest_creator_analysis', accountId, input.data));
      if (!output.ok) return creatorFailure(output.error.code);
      if (output.data.project_id !== input.data.project_id || output.data.dna_id !== input.data.analysis.dna.id) return creatorFailure('UNAVAILABLE');
      return output;
    } catch { return creatorFailure('UNAVAILABLE'); }
  };
}
