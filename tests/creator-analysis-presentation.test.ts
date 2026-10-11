import test from 'node:test';
import assert from 'node:assert/strict';
import { CreatorDnaView } from '../packages/contracts/creator-operations.ts';
import { projectCreatorDna } from '../packages/application/creator-operations.ts';
import { creatorAnalysisFixture } from '../packages/contracts/fixtures/creator-profile.ts';

const project = () => {
  const analysis = creatorAnalysisFixture();
  return projectCreatorDna({
    dna_id: analysis.dna.id,
    project_id: '00000000-0000-4000-8000-000000000100',
    analysis,
  });
};

test('profile analysis projection is optional and strictly tied to public evidence', () => {
  const legacy = project();
  const base = structuredClone(legacy) as any;
  delete base.profile_analysis;
  assert.equal(CreatorDnaView.safeParse(base).success, true, 'older persisted views remain valid');

  assert.deepEqual(legacy.profile_analysis, {
    performance: {
      observed_views: { value: 120, sample_size: 1, basis: 'sum_observed_post_views' },
    },
    top_content: [{ observation_id: legacy.evidence[0]!.observation_id, rank: 1, basis: 'observed_views' }],
  });

  const invalid = structuredClone(legacy) as any;
  invalid.profile_analysis.top_content[0].observation_id = '00000000-0000-4000-8000-000000000999';
  assert.equal(CreatorDnaView.safeParse(invalid).success, false, 'ranked records must be public evidence');
  const oversized = structuredClone(legacy) as any;
  oversized.profile_analysis.performance.observed_views.sample_size = 2;
  assert.equal(CreatorDnaView.safeParse(oversized).success, false, 'samples cannot exceed scan coverage');
  const extra = structuredClone(legacy) as any;
  extra.profile_analysis.performance.observed_views.secret = true;
  assert.equal(CreatorDnaView.safeParse(extra).success, false, 'projection remains strict');
});

test('trusted profile aggregates preserve observed zero and require complete engagement inputs', () => {
  const analysis = creatorAnalysisFixture();
  const video = analysis.scan.video_observations[0]!;
  video.metrics = { views: 0, likes: 0, comments: 0, shares: 0 };
  const zero = projectCreatorDna({ dna_id: analysis.dna.id, project_id: '00000000-0000-4000-8000-000000000100', analysis });
  assert.deepEqual(zero.profile_analysis?.performance?.observed_views, {
    value: 0, sample_size: 1, basis: 'sum_observed_post_views',
  });
  assert.equal(zero.profile_analysis?.performance?.engagement_rate, undefined, 'zero views has no rate denominator');

  video.metrics = { views: 200, likes: 0, comments: 0, shares: 0 };
  const complete = projectCreatorDna({ dna_id: analysis.dna.id, project_id: '00000000-0000-4000-8000-000000000100', analysis });
  assert.deepEqual(complete.profile_analysis?.performance?.engagement_rate, {
    percent: 0, sample_size: 1, basis: 'engagements_divided_by_views',
  });

  video.provenance.permission.permitted_uses = ['store', 'model_processing'];
  const restricted = projectCreatorDna({ dna_id: analysis.dna.id, project_id: '00000000-0000-4000-8000-000000000100', analysis });
  assert.equal(restricted.profile_analysis, undefined);
});
