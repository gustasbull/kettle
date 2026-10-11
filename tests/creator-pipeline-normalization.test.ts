import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizedFixtureInput } from '../evals/creator-loop/normalized-fixture.ts';
import { normalizeLiveTikTokScan } from '../packages/adapters/creator-pipeline/live-scan.ts';
import { readTikTokDetail } from '../packages/adapters/creator-pipeline/detail-json.ts';
import { readLightreelSubmission, readLightreelHistory } from '../packages/adapters/creator-pipeline/lightreel-json.ts';
import { CreatorAnalysis, ProfileScanResult, type ObservationProvenance } from '../packages/contracts/creator-profile.ts';
import { buildGroundedCreatorDna } from '../packages/adapters/creator-scan/dna.ts';
import { fictionalVideo } from '../evals/creator-loop/fixtures.ts';
import { documentedDynamicCover, documentedStaticCover, downloadSentinel, playbackSentinel,
  scrapeCreatorsOfficialShapeFixture } from '../evals/creator-loop/scrapecreators-official-shape-fixture.ts';
import { sanitizedScrape, sourceObservedAt } from '../packages/adapters/creator-pipeline/sanitize.ts';
const permission: ObservationProvenance['permission'] = { status: 'approved',
  basis: 'Synthetic test of trusted server permission; not real authorization.',
  permitted_uses: ['store', 'display', 'model_processing'], retention: 'Test process only' };
function input() {
  const fixture = normalizedFixtureInput();
  return { ...fixture, permission,
    profileAttempt: { ...fixture.profileAttempt, failure: null, latency_ms: 0 },
    feedAttempts: fixture.feedAttempts.map(a => ({ ...a, failure: null, latency_ms: 0 })),
  };
}
test('live mapper validates shared envelope and cannot inherit provider-supplied permissions or provenance', () => {
  const i = input();
  const raw = JSON.parse(i.profileAttempt.body);
  raw.provenance = { origin: 'fixture', permission: { status: 'approved', permitted_uses: ['media_analysis'] } };
  i.profileAttempt.body = JSON.stringify(raw);
  const scan = ProfileScanResult.parse(normalizeLiveTikTokScan(i));
  assert.equal(scan.profile_observations[0]!.provenance.origin, 'live');
  assert.deepEqual(scan.profile_observations[0]!.provenance.permission, permission);
  assert.equal(scan.cost.attempts[0]!.usd, null);
  const analysis = buildGroundedCreatorDna(scan, { id: crypto.randomUUID(), created_at: scan.created_at });
  CreatorAnalysis.parse(analysis);
  assert.ok(analysis.dna.claims.every(c => !c.requires_video && c.dimension !== 'pacing'));
  assert.ok(analysis.dna.claims.filter(c => c.dimension === 'audience').every(c => c.basis === 'inferred'));
});
test('live mapping requires server approval and preserves dated duplicates, null metrics and zero', () => {
  const i = input();
  assert.throws(() => normalizeLiveTikTokScan({ ...i, permission: { ...permission, status: 'fixture_only' } }));
  assert.throws(() => normalizeLiveTikTokScan({ ...i, permission: { ...permission, permitted_uses: [] } }));
  const first = JSON.parse(i.feedAttempts[0]!.body);
  first.has_more = true; first.max_cursor = '10';
  first.aweme_list[0].statistics = { play_count: null, digg_count: 0 };
  i.feedAttempts[0]!.body = JSON.stringify(first);
  i.feedAttempts.push({ ...i.feedAttempts[0]!, id: crypto.randomUUID(), requestedCursor: '10',
    source_observed_at: '2026-10-08T00:00:00Z',
    body: JSON.stringify({ ...first, has_more: false,
      aweme_list: [{ ...first.aweme_list[0], statistics: { play_count: 99 } }] }) });
  const scan = normalizeLiveTikTokScan(i);
  assert.equal(scan.video_observations.length, 2); assert.equal(scan.coverage.unique_videos, 1);
  assert.equal(scan.video_observations[0]!.metrics.views, null);
  assert.equal(scan.video_observations[0]!.metrics.likes, 0);
  assert.equal(scan.video_observations[1]!.provenance.source_observed_at, '2026-10-08T00:00:00Z');
  assert.equal(scan.status, 'partial');
});
test('live feed and profile mapping retains only allowlisted Paper display facts', () => {
  const i=input();
  const profile=JSON.parse(i.profileAttempt.body);
  profile.user.avatarLarger='https://p16-sign-va.tiktokcdn.com/avatar.jpeg?x-expires=1';
  i.profileAttempt.body=JSON.stringify(profile);
  const page=JSON.parse(i.feedAttempts[0]!.body);
  page.aweme_list[0].statistics={...page.aweme_list[0].statistics,digg_count:22,collect_count:11};
  page.aweme_list[0].video={...page.aweme_list[0].video,
    cover:{url_list:['https://evil.test/cover.jpeg','https://p16-sign-va.tiktokcdn.com/cover.jpeg']},
    play_addr:{url_list:['https://p16-sign-va.tiktokcdn.com/play.mp4']}};
  i.feedAttempts[0]!.body=JSON.stringify(page);
  const scan=normalizeLiveTikTokScan(i);
  assert.equal(scan.profile_observations[0]!.avatar_url,'https://p16-sign-va.tiktokcdn.com/avatar.jpeg?x-expires=1');
  assert.equal(scan.video_observations[0]!.thumbnail_url,'https://p16-sign-va.tiktokcdn.com/cover.jpeg');
  assert.equal(scan.video_observations[0]!.duration_seconds,12);
  assert.equal(scan.video_observations[0]!.metrics.likes,22);
  assert.equal(scan.video_observations[0]!.metrics.saves,11);
  assert.ok(!JSON.stringify(scan).includes('play.mp4'));
});
test('Lightreel parsing requires identity and bounds canonical deduplicated candidates to three', () => {
  const urls = ['https://evil.test/a', 'https://www.tiktok.com/@a/video/1?x=1',
    'https://www.tiktok.com/@b/video/1', ...[2, 3, 4].map(id => `https://www.tiktok.com/@a/video/${id}`)];
  const result = readLightreelSubmission(JSON.stringify({ conversationId: 'chat-1', answer: { urls } }));
  assert.equal(result.urls?.length, 3); assert.equal(result.urls![0], 'https://www.tiktok.com/@a/video/1');
  assert.throws(() => readLightreelSubmission(JSON.stringify({ answer: { urls } })));
  assert.throws(() => readLightreelHistory(JSON.stringify({ conversationId: 'other', messages: [] }), 'chat-1'));
  assert.equal(readLightreelHistory(JSON.stringify({ conversationId: 'chat-1', messages: [] }), 'chat-1').urls, null);
  assert.deepEqual(readLightreelSubmission(JSON.stringify({ conversationId: 'chat-1', answer: { urls: [] } })).urls, []);
});
test('v2 enrichment binds native video and handle, never treats a caption as media', () => {
  const video = fictionalVideo();
  const url = `https://www.tiktok.com/@fictional_kettle_creator/video/${video.aweme_id}`;
  const provenance = normalizeLiveTikTokScan(input()).profile_observations[0]!.provenance;
  const body = JSON.stringify({ success: true, aweme_detail: { ...video,
    author: { ...video.author, unique_id: 'fictional_kettle_creator' },
    statistics: { ...video.statistics, collect_count: 9 },
    video: { ...video.video, cover: { url_list: [
      'https://evil.test/not-allowed.jpeg',
      'https://p16-sign-va.tiktokcdn.com/tos-maliva-p-0068/cover.jpeg?x-expires=1',
    ] }, play_addr: { url_list: ['https://p16-sign-va.tiktokcdn.com/private-playback.mp4'] } },
    provenance: { modalities: ['video'] } } });
  const result = readTikTokDetail(body, url, crypto.randomUUID(), provenance);
  assert.equal(result.credits, null); assert.equal(result.observation.metrics.likes, 0);
  assert.equal(result.observation.metrics.shares, null);
  assert.equal(result.observation.duration_seconds, 12);
  assert.equal(result.observation.metrics.saves, 9);
  assert.equal(result.observation.thumbnail_url, 'https://p16-sign-va.tiktokcdn.com/tos-maliva-p-0068/cover.jpeg?x-expires=1');
  assert.deepEqual(result.observation.provenance.modalities, ['metadata', 'caption']);
  assert.throws(() => readTikTokDetail(body, url.replace(video.aweme_id, '1'), crypto.randomUUID(), provenance));
});

test('sanitizer prefers documented dynamic cover and never retains playback or download fields', () => {
  const official = scrapeCreatorsOfficialShapeFixture();
  const body = sanitizedScrape(JSON.stringify(official.detail), 'video');
  const reduced = JSON.parse(body);
  assert.deepEqual(reduced.aweme_detail.video.dynamic_cover.url_list, [documentedDynamicCover]);
  assert.deepEqual(reduced.aweme_detail.video.cover.url_list, [documentedStaticCover]);
  assert.ok(!body.includes(playbackSentinel));
  assert.ok(!body.includes(downloadSentinel));
  assert.ok(!body.includes('play_addr'));
  assert.ok(!body.includes('download_addr'));
  const provenance = normalizeLiveTikTokScan(input()).profile_observations[0]!.provenance;
  const url = `https://www.tiktok.com/@${official.handle}/video/${official.video.aweme_id}`;
  assert.equal(readTikTokDetail(body, url, crypto.randomUUID(), provenance).observation.thumbnail_url,
    documentedDynamicCover);
});

test('invalid dynamic cover falls back to the first valid static cover', () => {
  const official = scrapeCreatorsOfficialShapeFixture();
  official.detail.aweme_detail.video.dynamic_cover.url_list = [
    'http://p16-sign.tiktokcdn-us.com/unsafe.jpeg',
    'https://tiktokcdn-us.com.evil.test/unsafe.jpeg',
  ];
  official.detail.aweme_detail.video.cover.url_list = [
    'https://evil.test/unsafe.jpeg', documentedStaticCover,
  ];
  const body = sanitizedScrape(JSON.stringify(official.detail), 'video');
  const provenance = normalizeLiveTikTokScan(input()).profile_observations[0]!.provenance;
  const url = `https://www.tiktok.com/@${official.handle}/video/${official.video.aweme_id}`;
  assert.equal(readTikTokDetail(body, url, crypto.randomUUID(), provenance).observation.thumbnail_url,
    documentedStaticCover);
  official.detail.aweme_detail.video.cover.url_list = ['https://evil.test/unsafe.jpeg'];
  const withoutCover = readTikTokDetail(sanitizedScrape(JSON.stringify(official.detail), 'video'),
    url, crypto.randomUUID(), provenance).observation;
  assert.equal(withoutCover.thumbnail_url, undefined);
});

test('feed normalization and detail enrichment share dynamic-cover selection', () => {
  const official = scrapeCreatorsOfficialShapeFixture();
  const scanInput = input();
  scanInput.feedAttempts[0]!.body = sanitizedScrape(JSON.stringify(official.feed), 'feed');
  const scan = normalizeLiveTikTokScan(scanInput);
  const detailBody = sanitizedScrape(JSON.stringify(official.detail), 'video');
  const url = `https://www.tiktok.com/@${official.handle}/video/${official.video.aweme_id}`;
  const detail = readTikTokDetail(detailBody, url, crypto.randomUUID(),
    scan.profile_observations[0]!.provenance);
  assert.equal(scan.video_observations[0]!.thumbnail_url, documentedDynamicCover);
  assert.equal(detail.observation.thumbnail_url, documentedDynamicCover);
  assert.match(detail.observation.thumbnail_url!, /x-signature=redacted%2Bfixture$/);
});

test('cached_at survives sanitization but becomes observation time only for a declared cache hit', () => {
  const official = scrapeCreatorsOfficialShapeFixture();
  const sanitized = sanitizedScrape(JSON.stringify(official.detail), 'video');
  assert.equal(JSON.parse(sanitized).cached, true);
  assert.equal(JSON.parse(sanitized).cached_at, '2026-10-08T10:30:00-04:00');
  assert.equal(sourceObservedAt(sanitized), '2026-10-08T14:30:00.000Z');
  assert.equal(sourceObservedAt(JSON.stringify({ ...official.detail, cached: false })), null);
  assert.equal(sourceObservedAt(JSON.stringify({ ...official.detail, cached_at: 'not-a-time' })), null);
  assert.equal(sourceObservedAt(JSON.stringify({ ...official.detail, cached_at: undefined })), null);
});

test('OpenAI parsing rejects refusals, incomplete output and multiple answers without retrying', async () => {
  const { readOpenAiResponse } = await import('../packages/adapters/creator-pipeline/openai-json.ts');
  const complete = { id: 'resp-fixture', status: 'completed', output: [{ type: 'message', role: 'assistant',
    content: [{ type: 'output_text', text: '{"variants":[]}' }] }] };
  assert.deepEqual(readOpenAiResponse(JSON.stringify(complete)).output, { variants: [] });
  assert.equal(readOpenAiResponse(JSON.stringify(complete)).usage, null);
  assert.throws(() => readOpenAiResponse(JSON.stringify({ ...complete, status: 'incomplete' })));
  assert.throws(() => readOpenAiResponse(JSON.stringify({ ...complete, output: [complete.output[0], complete.output[0]] })));
  assert.throws(() => readOpenAiResponse(JSON.stringify({ ...complete,
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal' }] }] })));
});

test('durable receipt sanitizer discards media/account fields and nested smuggling in scalar fields', async () => {
  const body = sanitizedScrape(JSON.stringify({ success: true, credits_remaining: 100,
    user: { id: '1', uniqueId: 'fictional', signature: { hidden: 'secret-media-url' }, avatarLarger: 'secret-media-url' },
    stats: { followerCount: null }, arbitrary: 'secret-media-url' }), 'profile');
  assert.ok(!body.includes('secret-media-url')); assert.ok(!body.includes('credits_remaining'));
  assert.deepEqual(JSON.parse(body).user.signature, {});

  const videoBody = sanitizedScrape(JSON.stringify({ success: true, aweme_detail: {
    aweme_id: '1', author: { uid: '2', unique_id: 'fictional' }, desc: 'caption', create_time: 1,
    statistics: { play_count: 3, digg_count: 2, collect_count: 1 },
    video: { duration: 1000, cover: { url_list: ['https://p16-sign-va.tiktokcdn.com/cover.jpeg'] },
      play_addr: { url_list: ['https://p16-sign-va.tiktokcdn.com/play.mp4'] },
      download_addr: { url_list: ['https://p16-sign-va.tiktokcdn.com/download.mp4'] } },
  } }), 'video');
  assert.match(videoBody,/cover\.jpeg/);
  assert.ok(!videoBody.includes('play.mp4'));
  assert.ok(!videoBody.includes('download.mp4'));
});
