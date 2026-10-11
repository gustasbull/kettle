/** Reduce provider success receipts before the durable guard stores them. */
import { z } from 'zod';
import { TikTokImageUrl } from '../../contracts/creator-profile.ts';
const record = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const pick = (v: unknown, keys: string[]) => {
  const source = record(v);
  // Unexpected containers become an inert invalid marker, not a channel for extra source fields.
  return Object.fromEntries(keys.filter(k => source[k] !== undefined).map(k => [k,
    source[k] !== null && typeof source[k] === 'object' ? {} : source[k]]));
};
export function sourceObservedAt(body: string): string | null {
  const raw = record(JSON.parse(body));
  return raw.cached === true && typeof raw.cached_at === 'string' &&
    z.iso.datetime({ offset: true }).safeParse(raw.cached_at).success ? new Date(raw.cached_at).toISOString() : null;
}
function video(raw: unknown) {
  const v = record(raw);
  const media = record(v.video);
  const cover = record(media.cover);
  const urls = Array.isArray(cover.url_list) && cover.url_list.length <= 20
    ? cover.url_list.filter((value): value is string => typeof value === 'string' && TikTokImageUrl.safeParse(value).success) : [];
  return { ...pick(v, ['aweme_id', 'desc', 'create_time']),
    author: pick(v.author, ['uid', 'unique_id']),
    video: { ...pick(v.video, ['duration']), ...(urls.length ? { cover: { url_list: urls } } : {}) },
    statistics: pick(v.statistics, ['play_count', 'digg_count', 'comment_count', 'share_count', 'collect_count']) };
}
export function sanitizedScrape(body: string, kind: 'profile' | 'feed' | 'video'): string {
  const raw = record(JSON.parse(body));
  if (raw.success !== true) throw new Error('Provider did not return success');
  const common = pick(raw, ['success', 'credits_charged', 'cached', 'cached_at']);
  if (kind === 'profile') {
    const user = record(raw.user);
    return JSON.stringify({ ...common,
    user: { ...pick(raw.user, ['id', 'uniqueId', 'nickname', 'signature', 'privateAccount']),
      ...(typeof user.avatarLarger === 'string' && TikTokImageUrl.safeParse(user.avatarLarger).success
        ? { avatarLarger: user.avatarLarger } : {}) },
    stats: pick(raw.stats, ['followerCount']) });
  }
  if (kind === 'video') return JSON.stringify({ ...common, aweme_detail: video(raw.aweme_detail) });
  if (!Array.isArray(raw.aweme_list) || raw.aweme_list.length > 500) throw new Error('Invalid feed');
  return JSON.stringify({ ...common, ...pick(raw, ['has_more', 'max_cursor']), aweme_list: raw.aweme_list.map(video) });
}
