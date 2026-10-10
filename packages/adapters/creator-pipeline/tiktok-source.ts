import { CanonicalRiffCreatorSource, type CanonicalRiffCreatorSource as CanonicalSource } from '../../contracts/riff-creator.ts';
import { parseTikTokUrl } from './tiktok-url.ts';

export type TikTokSourceFetch = (input: string, init: RequestInit) => Promise<Response>;
export interface TikTokSourceLimits { maxRedirects: number; timeoutMs: number }

class TikTokSourceError extends Error {
  constructor(message: string, readonly code: 'INVALID_SOURCE' | 'SOURCE_UNAVAILABLE') { super(message); }
}

function canonical(value: string): CanonicalSource | null {
  try {
    const parsed = parseTikTokUrl(value);
    return CanonicalRiffCreatorSource.parse({
      platform: 'tiktok',
      kind: parsed.videoId ? 'video' : 'profile',
      handle: parsed.handle,
      canonical_url: parsed.canonicalUrl,
      profile_url: parsed.profileUrl,
      video_url: parsed.videoId ? parsed.canonicalUrl : null,
    });
  } catch {
    return null;
  }
}

function safeTikTokRedirect(value: string | URL): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new TikTokSourceError('Invalid TikTok redirect', 'INVALID_SOURCE'); }
  if (url.href.length > 2_048 || url.protocol !== 'https:' || url.port || url.username || url.password || url.hash
    || !(url.hostname === 'tiktok.com' || url.hostname.endsWith('.tiktok.com'))) {
    throw new TikTokSourceError('Invalid TikTok redirect', 'INVALID_SOURCE');
  }
  return url;
}

function shortUrl(value: string): URL {
  const url = safeTikTokRedirect(value);
  if (!['vm.tiktok.com', 'vt.tiktok.com'].includes(url.hostname)
    || !/^\/[A-Za-z0-9_-]{1,128}\/?$/.test(url.pathname)) {
    throw new TikTokSourceError('Invalid TikTok source URL', 'INVALID_SOURCE');
  }
  return url;
}

/** Resolve TikTok share links without reading bodies, forwarding credentials, or following a redirect automatically. */
export async function resolveTikTokCreatorSource(
  value: string,
  fetcher: TikTokSourceFetch = fetch,
  limits: TikTokSourceLimits = { maxRedirects: 4, timeoutMs: 5_000 },
): Promise<CanonicalSource> {
  if (!Number.isInteger(limits.maxRedirects) || limits.maxRedirects < 1 || limits.maxRedirects > 5
    || !Number.isInteger(limits.timeoutMs) || limits.timeoutMs < 1 || limits.timeoutMs > 10_000) {
    throw new TikTokSourceError('Invalid TikTok resolver limits', 'INVALID_SOURCE');
  }
  const direct = canonical(value);
  if (direct) return direct;
  let current = shortUrl(value);
  for (let redirects = 0; redirects < limits.maxRedirects; redirects++) {
    let response: Response;
    try {
      response = await fetcher(current.href, {
        method: 'GET', redirect: 'manual', headers: { Accept: 'text/html' },
        signal: AbortSignal.timeout(limits.timeoutMs),
      });
    } catch {
      throw new TikTokSourceError('TikTok source is temporarily unavailable', 'SOURCE_UNAVAILABLE');
    }
    void response.body?.cancel().catch(() => {});
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      throw new TikTokSourceError('TikTok source is temporarily unavailable', 'SOURCE_UNAVAILABLE');
    }
    const location = response.headers.get('location');
    if (!location) throw new TikTokSourceError('Invalid TikTok redirect', 'INVALID_SOURCE');
    let next: URL;
    try { next = safeTikTokRedirect(new URL(location, current)); }
    catch (error) {
      if (error instanceof TikTokSourceError) throw error;
      throw new TikTokSourceError('Invalid TikTok redirect', 'INVALID_SOURCE');
    }
    const resolved = canonical(next.href);
    if (resolved) return resolved;
    current = next;
  }
  throw new TikTokSourceError('TikTok redirect limit exceeded', 'INVALID_SOURCE');
}
