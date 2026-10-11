/** @internal Transport mechanics only. Call exclusively inside the application's durable attempt guard. */
export type Fetch = (input: string, init: RequestInit) => Promise<Response>;
export type HttpEvidence = {
  status: number | null; body: string; retrieved_at: string; latency_ms: number;
  failure: 'timeout' | 'network' | 'oversized' | 'malformed' | 'http' | null;
};
const endpoints = new Map([
  ['api.scrapecreators.com', /^\/v(?:1\/tiktok\/profile|3\/tiktok\/profile\/videos|2\/tiktok\/video)$/],
  ['api.lightreel.ai', /^\/v1\/chat(?:\/[\w-]{1,200})?$/],
  ['api.openai.com', /^\/v1\/responses$/],
]);

/** No redirects, retries, logs, global fetch, arbitrary hosts, or unbounded response buffers. */
export async function boundedJson(fetcher: Fetch, url: URL, init: RequestInit,
  limits: { timeoutMs: number; maxBytes?: number }): Promise<HttpEvidence> {
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash ||
      !endpoints.get(url.hostname)?.test(url.pathname)) throw new Error('Invalid provider endpoint');
  const maxBytes = limits.maxBytes ?? 262_144;
  if (!Number.isInteger(limits.timeoutMs) || limits.timeoutMs < 1 || limits.timeoutMs > 600_000 ||
      !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > (url.hostname === 'api.scrapecreators.com' && url.pathname === '/v3/tiktok/profile/videos' ? 2_097_152 : 262_144)) throw new Error('Invalid transport limits');
  const started = performance.now();
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let status: number | null = null;
  const evidence = (failure: HttpEvidence['failure'], body = ''): HttpEvidence => ({
    status, failure, body, retrieved_at: new Date().toISOString(),
    latency_ms: Math.max(0, Math.round(performance.now() - started)),
  });
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<HttpEvidence>(resolve => {
    timer = setTimeout(() => { controller.abort(); void reader?.cancel().catch(() => {});
      resolve(evidence('timeout')); }, limits.timeoutMs);
  });
  try {
    return await Promise.race([deadline, (async () => {
      try {
        // Workers supports manual/follow only. Manual preserves no-redirect safety;
        // 3xx responses fail the status check below without forwarding credentials.
        const response = await fetcher(url.href, { ...init, redirect: 'manual', signal: controller.signal });
        if (controller.signal.aborted) {
          void response.body?.cancel().catch(() => {}); return evidence('timeout');
        }
        status = response.status;
        if (!response.ok) { void response.body?.cancel().catch(() => {}); return evidence('http'); }
        const length = response.headers.get('content-length');
        if (length !== null && Number(length) > maxBytes) {
          void response.body?.cancel().catch(() => {}); return evidence('oversized');
        }
        if (!response.body) return evidence('malformed');
        reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > maxBytes) { void reader.cancel().catch(() => {}); return evidence('oversized'); }
          chunks.push(value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        let body: string;
        try { body = new TextDecoder('utf-8', { fatal: true }).decode(bytes); JSON.parse(body); }
        catch { return evidence('malformed'); }
        return evidence(null, body);
      } catch { return evidence(controller.signal.aborted ? 'timeout' : 'network'); }
    })()]);
  } finally { clearTimeout(timer!); }
}
