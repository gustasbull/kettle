import test from 'node:test';
import assert from 'node:assert/strict';
import { isCreatorJobView } from '../../apps/panel/riff-home-validation.ts';
import { pipelineFixture } from '../../apps/panel/creator-pipeline/fixtures.ts';
import { CreatorJobView } from '../../packages/contracts/creator-pipeline.ts';

function scanJob() {
  const job = structuredClone(pipelineFixture('scan'));
  if (job.result?.kind !== 'scan') throw new Error('Expected scan fixture');
  return { job, dna: job.result.dna };
}

test('Home accepts complete shared creator jobs without bundling the server schema graph', () => {
  for (const scenario of ['video-analysis', 'scan', 'ideas', 'scripts'] as const) {
    assert.equal(isCreatorJobView(pipelineFixture(scenario)), true, scenario);
  }
  const pending = structuredClone(pipelineFixture('video-analysis'));
  pending.state = 'running'; pending.result = null; pending.source_kind = 'video';
  assert.equal(isCreatorJobView(pending), true);
});

test('Home rejects malformed nested media and source data before it reaches the Paper UI', () => {
  const scan = structuredClone(pipelineFixture('video-analysis'));
  if (scan.result?.kind !== 'scan' || !scan.result.dna.seed_review) throw new Error('Expected video-analysis fixture');
  scan.result.dna.seed_review.url = 'https://evil.example/video';
  assert.equal(isCreatorJobView(scan), false);

  const recommendations = structuredClone(pipelineFixture('ideas'));
  if (recommendations.result?.kind !== 'recommendations') throw new Error('Expected recommendations fixture');
  recommendations.result.batch.references[0]!.thumbnail_url = 'https://evil.example/cover.jpg';
  assert.equal(isCreatorJobView(recommendations), false);

  const scripts = structuredClone(pipelineFixture('scripts'));
  if (scripts.result?.kind !== 'scripts') throw new Error('Expected scripts fixture');
  scripts.result.scripts.variants[0]!.reference_ids = ['not-an-id'];
  assert.equal(isCreatorJobView(scripts), false);
});

test('Home accepts the public showcase DNA dimension', () => {
  const { job, dna } = scanJob();
  dna.claims[0]!.dimension = 'showcase';

  const contractValidJob = CreatorJobView.parse(job);
  assert.equal(isCreatorJobView(contractValidJob), true);
});

test('Home accepts the public 2,000-character DNA claim boundary', () => {
  const { job, dna } = scanJob();
  dna.claims[0]!.statement = 'x'.repeat(2_000);

  const contractValidJob = CreatorJobView.parse(job);
  assert.equal(isCreatorJobView(contractValidJob), true);
});

test('Home accepts the public maximum of 61 DNA limitations', () => {
  const { job, dna } = scanJob();
  dna.limitations = Array.from(
    { length: 61 },
    (_, index) => `Known limitation ${index + 1}.`,
  );

  const contractValidJob = CreatorJobView.parse(job);
  assert.equal(isCreatorJobView(contractValidJob), true);
});
