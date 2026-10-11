/**
 * Offline, redacted fixture adapted from ScrapeCreators' documented TikTok
 * profile-video and video-detail response shapes. It contains fictional IDs,
 * captions and inert signature values. It is not evidence of a live request,
 * provider permission, media access or a real creator.
 */
export const documentedDynamicCover =
  'https://p16-sign.tiktokcdn-us.com/tos-useast5-p-0068-tx/fictional-dynamic.jpeg?x-expires=1999999999&x-signature=redacted%2Bfixture';
export const documentedStaticCover =
  'https://p19-sign.tiktokcdn-us.com/tos-useast5-p-0068-tx/fictional-cover.jpeg?x-expires=1999999999&x-signature=redacted%2Ffixture';
export const playbackSentinel =
  'https://p16-sign.tiktokcdn-us.com/tos-useast5-ve-0068-tx/never-retain-playback.mp4?x-signature=playback-sentinel';
export const downloadSentinel =
  'https://p16-sign.tiktokcdn-us.com/tos-useast5-ve-0068-tx/never-retain-download.mp4?x-signature=download-sentinel';

export function scrapeCreatorsOfficialShapeFixture() {
  const video = {
    aweme_id: '9000000000000000011',
    author: { uid: '9000000000000000001', unique_id: 'fictional_kettle_creator' },
    desc: 'Authored fixture: show one practical desk change.',
    create_time: 1791504000,
    statistics: {
      play_count: 120, digg_count: 0, comment_count: null, share_count: null, collect_count: 9,
    },
    video: {
      duration: 12000,
      dynamic_cover: { url_list: [documentedDynamicCover] },
      cover: { url_list: [documentedStaticCover] },
      play_addr: { url_list: [playbackSentinel] },
      download_addr: { url_list: [downloadSentinel] },
    },
  };
  return {
    profileUserId: video.author.uid,
    handle: video.author.unique_id,
    video,
    feed: { success: true, credits_charged: 1, has_more: false, aweme_list: [structuredClone(video)] },
    detail: {
      success: true, credits_charged: 0, cached: true,
      cached_at: '2026-10-08T10:30:00-04:00', aweme_detail: structuredClone(video),
    },
  };
}
