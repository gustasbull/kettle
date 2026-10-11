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

  const reversed = structuredClone(legacy) as any;
  const second = structuredClone(reversed.evidence[0]);
  second.observation_id = '00000000-0000-4000-8000-000000000099';
  second.url = 'https://www.tiktok.com/@fictional_kettle_creator/video/9000000000000000099';
  second.metrics.views = 300;
  reversed.evidence.push(second); reversed.coverage.unique_videos = 2;
  reversed.profile_analysis.top_content = [
    { observation_id: reversed.evidence[0].observation_id, rank: 1, basis: 'observed_views' },
    { observation_id: second.observation_id, rank: 2, basis: 'observed_views' },
  ];
  assert.equal(CreatorDnaView.safeParse(reversed).success, false, 'top content must descend by observed views');

  const reversedTie = structuredClone(reversed);
  reversedTie.evidence[1].metrics.views = reversedTie.evidence[0].metrics.views;
  reversedTie.profile_analysis.top_content.reverse();
  reversedTie.profile_analysis.top_content.forEach((entry:any,index:number)=>entry.rank=index+1);
  assert.equal(CreatorDnaView.safeParse(reversedTie).success, false, 'view ties use observation ID order');
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

test('trusted profile aggregates count repeated observations of one video once', () => {
  const analysis=creatorAnalysisFixture();
  const original=analysis.scan.video_observations[0]!;
  original.metrics={views:120,likes:12,comments:3,shares:1};
  original.provenance.retrieved_at='2026-10-09T12:00:00Z';
  const repeated=structuredClone(original);
  repeated.id='00000000-0000-4000-8000-000000000099';
  repeated.metrics={views:300,likes:30,comments:6,shares:3};
  repeated.provenance.retrieved_at='2026-10-10T12:00:00Z';
  analysis.scan.video_observations.push(repeated);
  analysis.scan.coverage.pages[0]!.received_items=2;
  analysis.scan.coverage.pages[0]!.admitted_observations=2;
  const view=projectCreatorDna({dna_id:analysis.dna.id,project_id:'00000000-0000-4000-8000-000000000100',analysis});
  assert.deepEqual(view.profile_analysis?.performance?.observed_views,{value:300,sample_size:1,basis:'sum_observed_post_views'});
  assert.deepEqual(view.profile_analysis?.performance?.engagement_rate,{percent:13,sample_size:1,basis:'engagements_divided_by_views'});
  assert.deepEqual(view.profile_analysis?.top_content,[{observation_id:repeated.id,rank:1,basis:'observed_views'}]);
});
