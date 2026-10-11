import { reconcileCreatorDispatches } from './creator-pipeline-runtime.ts';
export { CreatorPipelineWorkflow } from './creator-pipeline-runtime.ts';
import { handleMcp } from './mcp.ts';
import { withMcpCors } from './mcp-cors.ts';
import { website } from '../web/index.ts';
import { authServices, websiteAccountReader } from './auth.ts';
import { authConfig, isWebsiteAuthPath } from './auth-config.ts';
import { protectedResource } from '../../packages/auth/index.ts';
import { createSupabaseWebsiteAuthClient, handleWebsiteAuth, websiteAuthUnavailable } from '../../packages/auth/website.ts';
export { FoundationWorkflow } from './workflow.ts';

export default {
  async scheduled(_event: ScheduledController, env: Env) { await reconcileCreatorDispatches(env); },
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const config = authConfig(env);
    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ status: 'ok', service: 'kettle', stage: 2, auth: config ? 'configured' : 'not_configured' });
    }
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response(website(config !== null), { headers: {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      } });
    }
    if (url.pathname === '/.well-known/oauth-protected-resource' || url.pathname === '/.well-known/oauth-protected-resource/mcp') {
      return config && request.method === 'GET' ? Response.json(protectedResource(config.mcp)) : new Response('Not configured', { status: 404 });
    }
    if (url.pathname === '/mcp') {
      return withMcpCors(request, env.MCP_CORS_ORIGINS, async () => {
        try {
          if (config && url.origin !== new URL(config.mcp.resource).origin) return new Response('Invalid resource origin', { status: 400 });
          return await handleMcp(request, config ? await authServices(env, config) : undefined);
        } catch { return new Response('Authentication service unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
      });
    }
    if (isWebsiteAuthPath(url)) {
      if (!config) return new Response('Sign-in is not configured for this development build.', {
        status: 503, headers: { 'Cache-Control': 'no-store' },
      });
      try {
        return await handleWebsiteAuth(
          request,
          config.website,
          createSupabaseWebsiteAuthClient(config.website),
          websiteAccountReader(env, config),
        );
      } catch { return websiteAuthUnavailable(request, config.website); }
    }
    return new Response('Not found', { status: 404 });
  },
};
