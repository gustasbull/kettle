import test from 'node:test';
import assert from 'node:assert/strict';
import { CreatorJobView } from '../../packages/contracts/creator-pipeline.ts';
import { pipelineFixture, scenarioNames } from '../../apps/panel/creator-pipeline/fixtures.ts';
test('pipeline previews use valid shared fictional contracts', () => {
  for (const name of scenarioNames) assert.equal(CreatorJobView.safeParse(pipelineFixture(name)).success, true, name);
});
test('analysis preview scenarios cover every truthful terminal route', () => {
  const video=pipelineFixture('video-analysis');
  assert.equal(video.source_kind,'video');
  assert.equal(video.result?.kind==='scan'&&video.result.dna.seed_review?.dimensions?.length,6);
  assert.equal(pipelineFixture('partial-video-analysis').source_kind,'video');
  const instagram=pipelineFixture('instagram-profile');
  assert.equal(instagram.source_kind,'profile');
  assert.equal(instagram.result?.kind==='scan'&&instagram.result.dna.profile.platform,'instagram');
});
