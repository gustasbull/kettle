/** Lightweight display policy shared by server contracts and browser validators. */
export const TIKTOK_IMAGE_HOST_FAMILIES = [
  'tiktokcdn.com',
  'tiktokcdn-us.com',
] as const;

export const TIKTOK_IMAGE_RESOURCE_DOMAINS = [
  'https://tiktokcdn.com',
  'https://*.tiktokcdn.com',
  'https://tiktokcdn-us.com',
  'https://*.tiktokcdn-us.com',
] as const;

export function isAllowedTikTokImageUrl(value: string): boolean {
  if (value.length > 4096 || value !== value.trim() || value.includes('#')) return false;
  const authority = /^https:\/\/([^/?#]*)/i.exec(value)?.[1];
  // URL normalizes an explicit default :443 away, so inspect the raw authority too.
  if (!authority || authority.includes(':')) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash
      && TIKTOK_IMAGE_HOST_FAMILIES.some(family => host === family || host.endsWith(`.${family}`));
  } catch { return false; }
}
