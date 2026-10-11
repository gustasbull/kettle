const allowedMethods = 'POST, OPTIONS';
const allowedHeaders = 'Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id';
const exposedHeaders = 'MCP-Session-Id';
const allowedHeaderNames = new Set(allowedHeaders.toLowerCase().split(', '));

function originValue(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/'
      || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

function configuredOrigins(value: string | undefined): Set<string> {
  return new Set((value ?? '').split(',').map((entry) => originValue(entry.trim())).filter((entry): entry is string => entry !== null));
}

function responseWithOrigin(response: Response, origin: string): Response {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Expose-Headers', exposedHeaders);
  headers.set('Vary', 'Origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** Apply the exact-origin browser boundary before invoking the MCP transport. */
export async function withMcpCors(request: Request, configured: string | undefined,
  next: () => Promise<Response>): Promise<Response> {
  const rawOrigin = request.headers.get('Origin');
  if (!rawOrigin) {
    if (request.method === 'OPTIONS') return new Response('Origin required', { status: 403 });
    return next();
  }
  const origin = originValue(rawOrigin);
  const sameOrigin = origin !== null && origin === new URL(request.url).origin;
  if (!origin || (!sameOrigin && !configuredOrigins(configured).has(origin))) {
    return new Response('Origin not allowed', { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  if (request.method === 'OPTIONS') {
    const requestedMethod = request.headers.get('Access-Control-Request-Method');
    const requestedHeaders = (request.headers.get('Access-Control-Request-Headers') ?? '')
      .split(',').map((header) => header.trim().toLowerCase()).filter(Boolean);
    if (requestedMethod?.toUpperCase() !== 'POST'
      || requestedHeaders.some((header) => !allowedHeaderNames.has(header))) {
      return new Response('Preflight not allowed', { status: 403, headers: { 'Cache-Control': 'no-store' } });
    }
    return new Response(null, { status: 204, headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': allowedMethods,
      'Access-Control-Allow-Headers': allowedHeaders,
      'Cache-Control': 'no-store',
      Vary: 'Origin',
    } });
  }
  return responseWithOrigin(await next(), origin);
}
