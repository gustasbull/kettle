/** @internal Allowlisted ScrapeCreators v2 detail fields. Only safe image URLs are retained; no playback URL is retained or fetched. */
import { z } from 'zod';
import { TikTokImageUrl, VideoObservation, type ObservationProvenance } from '../../contracts/creator-profile.ts';
import { parseTikTokUrl } from './tiktok-url.ts';
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullish().transform(v => v ?? null);
const optionalCount = count.optional();
const videoFacts = z.object({
  aweme_id: z.string().regex(/^\d{1,30}$/),
  statistics: z.object({ play_count: count, digg_count: count, comment_count: count,
    share_count: count, collect_count: optionalCount }).nullish(),
  video: z.object({ duration: count,
    cover: z.object({ url_list: z.array(z.unknown()).max(20) }).optional(),
  }).nullish(),
});
const detail = z.object({ success: z.literal(true), credits_charged: count,
  aweme_detail: videoFacts.extend({
    author: z.object({ uid: z.string().regex(/^\d{1,30}$/), unique_id: z.string().regex(/^[\w.]{1,100}$/) }),
    desc: z.string().max(10000).nullish(), create_time: count.refine(v => v === null || v <= 253402300799),
  }),
});
/** Allowlisted display facts only. This intentionally has no playback/download shape. */
export function readTikTokVideoFacts(raw: unknown) {
  const parsed = videoFacts.safeParse(raw);
  if (!parsed.success) return null;
  const item = parsed.data;
  const thumbnail_url = item.video?.cover?.url_list
    .flatMap(value => typeof value === 'string' ? [value] : [])
    .find(value => TikTokImageUrl.safeParse(value).success);
  return {
    native_id: item.aweme_id,
    duration_seconds: item.video?.duration ? item.video.duration / 1000 : null,
    likes: item.statistics?.digg_count ?? null,
    ...(item.statistics?.collect_count !== undefined ? { saves: item.statistics.collect_count } : {}),
    ...(thumbnail_url ? { thumbnail_url } : {}),
  };
}
export function readTikTokDetail(body: string, requestedUrl: string, id: string,
  provenance: ObservationProvenance) {
  const { aweme_detail: item, credits_charged } = detail.parse(JSON.parse(body));
  const facts = readTikTokVideoFacts(item);
  if (!facts) throw new Error('Invalid video facts');
  const requested = parseTikTokUrl(requestedUrl);
  if (requested.videoId !== item.aweme_id || requested.handle.toLowerCase() !== item.author.unique_id.toLowerCase()) {
    throw new Error('Video identity mismatch');
  }
  const canonical_url = `https://www.tiktok.com/@${item.author.unique_id}/video/${item.aweme_id}`;
  return { credits: credits_charged, observation: VideoObservation.parse({ id,
    video: { platform: 'tiktok', native_id: item.aweme_id },
    creator: { platform: 'tiktok', native_id: item.author.uid }, canonical_url,
    caption: item.desc ?? null,
    published_at: item.create_time === null ? null : new Date(item.create_time * 1000).toISOString(),
    duration_seconds: facts.duration_seconds, ...(facts.thumbnail_url ? { thumbnail_url: facts.thumbnail_url } : {}),
    metrics: { views: item.statistics?.play_count ?? null, likes: item.statistics?.digg_count ?? null,
      comments: item.statistics?.comment_count ?? null, shares: item.statistics?.share_count ?? null,
      ...(facts.saves !== undefined ? { saves: facts.saves } : {}) },
    provenance: { ...provenance, source_url: canonical_url,
      modalities: item.desc == null ? ['metadata'] : ['metadata', 'caption'] },
  }) };
}
