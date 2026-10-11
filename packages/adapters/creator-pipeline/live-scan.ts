/** @internal Live scan mapping; only trusted transport receipts and server permissions belong here. */
import { z } from 'zod';
import { ProfileScanRequest, ProfileScanResult, TikTokImageUrl, type ObservationProvenance,
  type ScanCostEvidence, type ScanCoverage } from '../../contracts/creator-profile.ts';
import { characterizeFeed, characterizeProfile } from '../creator-scan/scrapecreators-characterization.ts';
import type { HttpEvidence } from './http.ts';
import { readTikTokVideoFacts } from './detail-json.ts';

// Receipt IDs/timestamps are assigned by the transport, never accepted from source JSON.
export type ScanReceipt = HttpEvidence & { id: string; source_observed_at: string | null };

export function normalizeLiveTikTokScan(input: {
  id: string; created_at: string; request: ProfileScanRequest;
  profileAttempt: ScanReceipt;
  feedAttempts: readonly (ScanReceipt & { requestedCursor: string | null })[];
  latency_ms: number; permission: ObservationProvenance['permission'];
}, newId: () => string = () => crypto.randomUUID()): ProfileScanResult {
  if (input.permission.status !== 'approved' || !input.permission.permitted_uses.includes('store')) {
    throw new Error('Live ingestion permission required');
  }
  const request = ProfileScanRequest.parse(input.request);
  const profileAttempt = input.profileAttempt;
  const profile = profileAttempt.status === 200 ? characterizeProfile(profileAttempt.body) : null;
  const attempts: ScanCostEvidence['attempts'] = [];
  const errors: ScanCoverage['errors'] = [];
  const cost = (attempt: ScanReceipt, succeeded: boolean, credits: number | null) => {
    attempts.push({ id: attempt.id, provider: 'scrapecreators',
      outcome: attempt.failure === 'timeout' || attempt.failure === 'network' ? 'ambiguous' : succeeded ? 'succeeded' : 'failed',
      credits, usd: null, usd_basis: 'unknown', conversion_basis: null });
  };
  const failureCode = (status: number | null): ScanCoverage['errors'][number]['code'] =>
    status === null ? 'timeout' : status === 404 ? 'not_found' : status === 403 ? 'private' :
      status === 429 ? 'rate_limited' : status === 200 ? 'malformed' : 'provider_failure';
  cost(profileAttempt, profile !== null && profile.kind !== 'malformed',
    profile && profile.kind !== 'malformed' ? profile.credits : null);
  const base = {
    id: input.id, request, created_at: input.created_at,
    cost: { attempts, latency_ms: input.latency_ms },
  };
  const profileHandleMatches = profile && profile.kind !== 'malformed' &&
    profile.user.uniqueId.toLowerCase() === new URL(request.supplied_url).pathname.replace(/^\/@|\/$/g, '').toLowerCase();
  if (!profile || profile.kind !== 'available' || !profileHandleMatches) {
    const unavailable = profile?.kind === 'private' || [403, 404].includes(profileAttempt.status ?? 0);
    errors.push({ code: profile?.kind === 'private' ? 'private' : failureCode(profileAttempt.status),
      attempt_id: profileAttempt.id, retryable: false });
    return ProfileScanResult.parse({ ...base, status: unavailable ? 'unavailable' : 'failed',
      profile: null, profile_observations: [], video_observations: [],
      coverage: { pages_received: 0, unique_videos: 0, rejected_items: 0,
        pagination: 'unknown', stop_reason: unavailable ? 'inaccessible' : 'error',
        omissions: [], oldest_published_at: null, newest_published_at: null, pages: [], errors },
      limitations: ['Profile is inaccessible, malformed, or does not match the requested handle. No feed was admitted.'],
    });
  }
  const identity = { platform: 'tiktok' as const, native_id: profile.user.id };
  const url = `https://www.tiktok.com/@${profile.user.uniqueId}`;
  const avatarCandidate = (() => {
    try {
      return z.object({ user: z.object({ avatarLarger: z.unknown().optional() }) })
        .parse(JSON.parse(profileAttempt.body)).user.avatarLarger;
    } catch { return undefined; }
  })();
  const avatar = TikTokImageUrl.safeParse(avatarCandidate);
  const provenance = (attempt: ScanReceipt, endpoint: string, source_url: string,
    caption: boolean): ObservationProvenance => ({
    provider: 'scrapecreators', endpoint, origin: 'live', retrieved_at: attempt.retrieved_at,
    source_observed_at: attempt.source_observed_at, source_url,
    permission: input.permission,
    modalities: caption ? ['metadata', 'caption'] : ['metadata'],
  });
  const replay = characterizeFeed({ profileBody: profileAttempt.body, attempts: input.feedAttempts,
    maxPages: request.max_pages, maxVideos: request.max_videos });
  // Characterization deliberately understands only analysis fields. Parse the
  // already-sanitized receipt again for optional display facts and bind by ID.
  const presentation = input.feedAttempts.map(attempt => {
    const byId = new Map<string, NonNullable<ReturnType<typeof readTikTokVideoFacts>>[]>();
    try {
      const rows = z.object({ aweme_list: z.array(z.unknown()).max(500) }).parse(JSON.parse(attempt.body)).aweme_list;
      for (const row of rows) {
        const facts = readTikTokVideoFacts(row);
        if (!facts) continue;
        const queue = byId.get(facts.native_id) ?? [];
        queue.push(facts); byId.set(facts.native_id, queue);
      }
    } catch { /* malformed core rows are already counted/rejected by characterization */ }
    return byId;
  });
  for (let i = 0; i < replay.attempts; i++) {
    const attempt = input.feedAttempts[i]!;
    const succeeded = i < replay.pages.length;
    cost(attempt, succeeded, replay.credits[i] ?? null);
    if (!succeeded) errors.push({ code: failureCode(attempt.status), attempt_id: attempt.id, retryable: false });
  }
  const videos = replay.observations.map(({ attempt, item }) => {
    const source = input.feedAttempts[attempt - 1]!;
    const canonical_url = `${url}/video/${item.aweme_id}`;
    const facts = presentation[attempt - 1]?.get(item.aweme_id)?.shift();
    return { id: newId(), video: { platform: 'tiktok' as const, native_id: item.aweme_id },
      creator: identity, canonical_url, caption: item.desc,
      published_at: item.create_time === null ? null : new Date(item.create_time * 1000).toISOString(),
      duration_seconds: item.video?.duration ? item.video.duration / 1000 : null,
      ...(facts?.thumbnail_url ? { thumbnail_url: facts.thumbnail_url } : {}),
      metrics: { views: item.statistics?.play_count ?? null, likes: item.statistics?.digg_count ?? null,
        comments: item.statistics?.comment_count ?? null, shares: item.statistics?.share_count ?? null,
        ...(facts?.saves !== undefined ? { saves: facts.saves } : {}) },
      provenance: provenance(source, '/v3/tiktok/profile/videos', canonical_url, item.desc !== null),
    };
  });
  const dates = videos.flatMap(v => v.published_at === null ? [] : [v.published_at]).sort();
  const stoppedWithError = errors.length > 0;
  const lastPage = replay.pages.at(-1);
  const stop_reason: ScanCoverage['stop_reason'] = stoppedWithError ? 'error' :
    replay.stop === 'feed_exhausted' ? 'exhausted' :
      ['page_limit', 'video_limit', 'observation_limit'].includes(replay.stop) ? 'limit' : 'unknown';
  // Provider feed coverage is known to be incomplete even when pagination ends.
  return ProfileScanResult.parse({ ...base, status: 'partial', profile: identity,
    profile_observations: [{ id: newId(), profile: identity, canonical_url: url,
      handle: profile.user.uniqueId, display_name: profile.user.nickname ?? null,
      bio: profile.user.signature, follower_count: profile.followerCount,
      ...(avatar.success ? { avatar_url: avatar.data } : {}),
      provenance: provenance(profileAttempt, '/v1/tiktok/profile', url, false) }],
    video_observations: videos,
    coverage: { pages_received: replay.pages.length, unique_videos: replay.uniqueIds.length,
      rejected_items: replay.rejected,
      pagination: lastPage?.has_more === false ? 'exhausted' : lastPage?.has_more === true ? 'more' : 'unknown',
      stop_reason, omissions: ['TikTok feeds may omit public posts; this bounded sample cannot prove profile completeness.'],
      oldest_published_at: dates[0] ?? null, newest_published_at: dates.at(-1) ?? null,
      pages: replay.pages.map(({ has_more: _hasMore, ...p }) => p), errors },
    limitations: [
      'Metadata and captions only; no actual audience demographics, visual content or pacing analyzed.',
      `Scan stopped: ${replay.stop}. Rejected rows: ${replay.rejected}. Duplicate observations retained: ${replay.duplicates}.`,
      'Provider credits are recorded when supplied; dollar costs remain unknown. Duration zero is unavailable, not a valid video duration.',
    ],
  });
}
