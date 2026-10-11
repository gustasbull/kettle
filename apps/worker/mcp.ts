import type { createPipelineOperations } from '../../packages/application/creator-pipeline.ts';
import type { createRiffCreatorOperations } from '../../packages/application/riff-creator.ts';
import type { createRiffVideoOperations } from '../../packages/application/riff-videos.ts';
import { registerCreatorPipelineResource } from './creator-pipeline-resource.ts';
import type { createCreatorOperations } from '../../packages/application/creator-operations.ts';
import { registerCreatorReviewResource } from './creator-review-resource.ts';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CONTRACT_VERSION } from '../../packages/contracts/index.ts';
import { OpenAIProfile } from '../../packages/contracts/openai-profile.ts';

import { registerProjectReviewResource } from './project-review-resource.ts';
import { registerRiffOnboardingResource } from './riff-onboarding-resource.ts';
import { registerRiffHomeResource } from './riff-home-resource.ts';
import {
  ACCOUNT_CONTRACT, CREATOR_TOOLS, DIAGNOSTIC_REGISTRATION, HOME_REGISTRATION,
  PIPELINE_TOOLS, PRODUCT_TOOLS, PROFILE_REGISTRATION, RIFF_CREATOR_TOOLS, RIFF_VIDEO_TOOLS,
  WELCOME_REGISTRATION, selectMcpToolDescriptors,
} from './mcp-definitions.ts';
export { selectMcpToolDescriptors } from './mcp-definitions.ts';

import type { createOperations, IdentityVerifier } from '../../packages/application/operations.ts';
import { bearer, challenge, type AuthConfig } from '../../packages/auth/index.ts';
import type { CreatorLatencyObserver } from '../../packages/application/creator-observability.ts';

export interface McpAuth {
  config: AuthConfig;
  verifier: IdentityVerifier;
  operations: ReturnType<typeof createOperations>;
  pipelineOperations?: ReturnType<typeof createPipelineOperations>;
  creatorOperations?: ReturnType<typeof createCreatorOperations>;
  riffCreatorOperations?: ReturnType<typeof createRiffCreatorOperations>;
  riffVideoOperations?:ReturnType<typeof createRiffVideoOperations>;
}
const MCP_INSTRUCTIONS = [
  'When the user invokes or tags Riff without a more specific request, open Riff immediately with `open_riff`.',
  'Do not call the diagnostic, profile, or account-state tools before `open_riff`.',
  'When the user explicitly asks to analyze a public TikTok profile or video URL, call `start_riff_creator` directly.',
  'Use `show_riff_welcome` only for first-use onboarding or when the user asks to replay it.',
].join(' ');

export async function handleMcp(request: Request, auth?: McpAuth, telemetry?: CreatorLatencyObserver): Promise<Response> {
  const token = bearer(request);
  // MCP discovery and UI resources contain no account data. Authentication is
  // enforced inside every protected tool invocation, which avoids resolving a
  // Supabase identity for initialize, tools/list, and resources/read requests.
  const server = new McpServer(
    { name: 'kettle-foundation', version: '0.1.0' },
    { instructions: MCP_INSTRUCTIONS },
  );
  server.registerTool('kettle_diagnostic', DIAGNOSTIC_REGISTRATION, async () => ({
    content: [{ type: 'text', text: auth ? 'Riff is reachable. Account tools require authorization.' : 'Riff foundation is reachable. Account tools are not enabled yet.' }],
    structuredContent: { status: 'ok', contract_version: CONTRACT_VERSION },
  }));
  if (auth) {
    registerRiffOnboardingResource(server);
    server.registerTool('show_riff_welcome', WELCOME_REGISTRATION, async () => {
      if (!token || !await auth.verifier.verify(token)) return {
        content: [{ type: 'text' as const, text: 'Connect or reauthorize your Riff account.' }],
        isError: true,
        _meta: { 'mcp/www_authenticate': [challenge(auth.config)] },
      };
      return {
        content: [{ type: 'text' as const, text: 'Riff works in three steps: Start with what you have, Find your breakout idea, then Make it yours.' }],
        structuredContent: { steps: ['Start', 'Find', 'Make'] as ['Start', 'Find', 'Make'] },
      };
    });
  }
  if (auth?.pipelineOperations || auth?.riffCreatorOperations) registerCreatorPipelineResource(server);
  if(auth?.pipelineOperations){
    for(const tool of PIPELINE_TOOLS){
      const contract=tool.contract;
      // The published descriptor below advertises the complete success/failure
      // union. Omit the SDK's success-only validator so retry semantics can also
      // reach the bound MCP App as structured content.
      server.registerTool(tool.name,tool.registration,async(input:unknown)=>{
        const result=await auth.pipelineOperations!.execute(tool.operation,token,input);
        const needsAuth=!result.ok&&(result.error.code==='UNAUTHENTICATED'||(result.error.code==='FORBIDDEN'&&token&&!(await auth.verifier.verify(token))?.scopes.includes(contract.scope)));
        if (!result.ok) return {content:[{type:'text' as const,text:JSON.stringify(result)}],structuredContent:result,isError:true,
          ...(needsAuth?{_meta:{'mcp/www_authenticate':[challenge(auth.config,result.error.code==='FORBIDDEN'?'insufficient_scope':'invalid_token')]}}:{})};
        return {content:[{type:'text' as const,text:JSON.stringify(result)}],structuredContent:result};
      });
    }
  }
  if (auth?.riffCreatorOperations) {
    for (const tool of RIFF_CREATOR_TOOLS) {
      const { contract } = tool;
      server.registerTool(tool.name, tool.registration, async (input: unknown) => {
        const result = await auth.riffCreatorOperations!.execute(tool.operation, token, input);
        const needsAuth = !result.ok && (result.error.code === 'UNAUTHENTICATED'
          || (result.error.code === 'FORBIDDEN' && token && !(await auth.verifier.verify(token))?.scopes.includes(contract.scope)));
        if (!result.ok) return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result, isError: true,
          ...(needsAuth ? { _meta: { 'mcp/www_authenticate': [challenge(auth.config,
            result.error.code === 'FORBIDDEN' ? 'insufficient_scope' : 'invalid_token')] } } : {}),
        };
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result };
      });
    }
  }
  if(auth?.riffVideoOperations){
    for(const tool of RIFF_VIDEO_TOOLS){const {contract}=tool;
      server.registerTool(tool.name,tool.registration,async(input:unknown)=>{
        const result=await auth.riffVideoOperations!.execute(tool.operation,token,input);
        const needsAuth=!result.ok&&(result.error.code==='UNAUTHENTICATED'||
          (result.error.code==='FORBIDDEN'&&token&&!(await auth.verifier.verify(token))?.scopes.includes(contract.scope)));
        if(!result.ok)return {content:[{type:'text' as const,text:result.error.message}],structuredContent:result,isError:true,
          ...(needsAuth?{_meta:{'mcp/www_authenticate':[challenge(auth.config,result.error.code==='FORBIDDEN'?'insufficient_scope':'invalid_token')]}}:{})};
        return {content:[{type:'text' as const,text:`Returned ${result.data.cards.length} saved Riff video cards; no provider refresh was performed.`}],structuredContent:result};
      });
    }
  }
  if (auth?.creatorOperations) {
    const operations = auth.creatorOperations;
    registerCreatorReviewResource(server);
    for (const tool of CREATOR_TOOLS) {
      const { contract } = tool;
      server.registerTool(tool.name, tool.registration, async (input: unknown) => {
        const result = await operations.execute(tool.operation, token, input);
        const needsAuth = !result.ok && (result.error.code === 'UNAUTHENTICATED'
          || (result.error.code === 'FORBIDDEN' && token && !(await auth.verifier.verify(token))?.scopes.includes(contract.scope)));
        if (!result.ok) return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result, isError: true,
          ...(needsAuth ? { _meta: { 'mcp/www_authenticate': [challenge(auth.config,
            result.error.code === 'FORBIDDEN' ? 'insufficient_scope' : 'invalid_token')] } } : {}),
        };
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result };
      });
    }
  }
  if (auth) {
    registerProjectReviewResource(server);
    registerRiffHomeResource(server);
    for (const tool of PRODUCT_TOOLS) {
      const { contract } = tool;
      server.registerTool(tool.name, tool.registration, async (input: unknown) => {
        const result = await auth.operations.execute(tool.operation, token, input);
        const needsAuth = !result.ok && (result.error.code === 'UNAUTHENTICATED'
          || (result.error.code === 'FORBIDDEN' && token && !(await auth.verifier.verify(token))?.scopes.includes(contract.scope)));
        if (!result.ok) return {
          content: [{ type: 'text' as const, text: result.error.message }], structuredContent: result, isError: true,
          ...(needsAuth ? { _meta: { 'mcp/www_authenticate': [challenge(auth.config,
            result.error.code === 'FORBIDDEN' ? 'insufficient_scope' : 'invalid_token')] } } : {}),
        };
        return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }], structuredContent: result };
      });
    }
    server.registerTool('get_riff_profile', PROFILE_REGISTRATION, async () => {
      const result = await auth.operations.execute('get_account_state', token, {});
      const needsAuth = !result.ok && (result.error.code === 'UNAUTHENTICATED'
        || (result.error.code === 'FORBIDDEN' && token && !(await auth.verifier.verify(token))?.scopes.includes(ACCOUNT_CONTRACT.scope)));
      if (!result.ok) return {
        content: [{ type: 'text' as const, text: result.error.message }], isError: true,
        ...(needsAuth ? { _meta: { 'mcp/www_authenticate': [challenge(auth.config,
          result.error.code === 'FORBIDDEN' ? 'insufficient_scope' : 'invalid_token')] } } : {}),
      };
      const profile = OpenAIProfile.parse({ id: result.data.account.id, name: result.data.account.display_name });
      return { content: [{ type: 'text' as const, text: JSON.stringify(profile) }], structuredContent: profile };
    });
    server.registerTool('open_riff', HOME_REGISTRATION, async () => {
      const result = await auth.operations.execute('get_account_state', token, {});
      const needsAuth = !result.ok && (result.error.code === 'UNAUTHENTICATED'
        || (result.error.code === 'FORBIDDEN' && token && !(await auth.verifier.verify(token))?.scopes.includes(ACCOUNT_CONTRACT.scope)));
      if (!result.ok) return {
        content: [{ type: 'text' as const, text: result.error.message }], structuredContent: result, isError: true,
        ...(needsAuth ? { _meta: { 'mcp/www_authenticate': [challenge(auth.config,
          result.error.code === 'FORBIDDEN' ? 'insufficient_scope' : 'invalid_token')] } } : {}),
      };
      const firstOpen = result.data.account.onboarding_seen_at === null;
      const text = firstOpen
        ? 'Welcome to Riff — unlock your viral potential. Start with what you have: a public creator video, profile, or idea. Find your evidence-backed breakout direction. Make it yours as a filmable script in Studio. Your first-use guide belongs here in ChatGPT, and Riff Home is open on the right.'
        : 'Riff Home is open on the right. Start with a public creator video or profile, or pick up saved creator work.';
      return { content: [{ type: 'text' as const, text }], structuredContent: result };
    });
  }
  // Definitions and JSON schemas are initialized once per isolate. Only the
  // request's capability booleans select a catalog; no token or account state is cached.
  const descriptors = selectMcpToolDescriptors({
    authenticated: Boolean(auth),
    creator: Boolean(auth?.creatorOperations),
    pipeline: Boolean(auth?.pipelineOperations),
    riffCreator: Boolean(auth?.riffCreatorOperations),
    riffVideos:Boolean(auth?.riffVideoOperations),
  });
  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...descriptors] }));
  // A new stateless transport per request works across Worker isolates. Product
  // state will live in Postgres, not an MCP session or an isolate global.
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true, maxRequestBodySize: 128 * 1024,
  });
  await server.connect(transport);
  try { return await (telemetry ? telemetry.measure(
    { stage: 'mcp_route', clock: 'monotonic', operation: 'read', endpoint: 'mcp_transport' },
    () => transport.handleRequest(request)) : transport.handleRequest(request)); }
  finally { await server.close(); }
}
