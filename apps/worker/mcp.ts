import type { createPipelineOperations } from '../../packages/application/creator-pipeline.ts';
import type { CreatorJobStatusView, CreatorJobView } from '../../packages/contracts/creator-pipeline.ts';
import type { createRiffCreatorOperations } from '../../packages/application/riff-creator.ts';
import type { createRiffVideoOperations } from '../../packages/application/riff-videos.ts';
import type { createRiffWorkStateOperations } from '../../packages/application/riff-work-state.ts';
import { registerCreatorPipelineResource } from './creator-pipeline-resource.ts';
import type { createCreatorOperations } from '../../packages/application/creator-operations.ts';
import type { CreatorDnaView } from '../../packages/contracts/creator-operations.ts';
import { registerCreatorReviewResource } from './creator-review-resource.ts';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CONTRACT_VERSION, type Account, type Failure, type Project } from '../../packages/contracts/index.ts';
import { OpenAIProfile } from '../../packages/contracts/openai-profile.ts';

import { registerProjectReviewResource } from './project-review-resource.ts';
import { registerRiffOnboardingResource } from './riff-onboarding-resource.ts';
import { registerRiffHomeResource } from './riff-home-resource.ts';
import {
  ACCOUNT_CONTRACT, CREATOR_TOOLS, DIAGNOSTIC_REGISTRATION, HOME_REGISTRATION,
  PIPELINE_TOOLS, PRODUCT_TOOLS, PROFILE_REGISTRATION, RIFF_CREATOR_TOOLS, RIFF_VIDEO_TOOLS, RIFF_WORK_STATE_TOOLS,
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
  riffWorkStateOperations?:ReturnType<typeof createRiffWorkStateOperations>;
}
const MCP_INSTRUCTIONS = [
  'When the user invokes or tags Riff without a more specific request, open Riff immediately with `open_riff`.',
  'Do not call the diagnostic, profile, or account-state tools before `open_riff`.',
  'After `open_riff`, inspect its structured account result. When `onboarding_seen_at` is null, call `show_riff_welcome` once in the same originating response so the inline Paper welcome appears in chat while Home remains usable on the right.',
  'Never call `mark_riff_onboarding_seen` from the model; only the welcome app may call it after the user finishes the visible final step.',
  'When `onboarding_seen_at` is already set, call `show_riff_welcome` only if the user explicitly asks to replay the guide.',
  'When the user explicitly asks to analyze a public TikTok profile or video URL, call `start_riff_creator` directly.',
].join(' ');

const RECOVERY_SUMMARIES: Record<Failure['error']['recovery'], string> = {
  reauthorize: 'Connect or reauthorize your Riff account.',
  correct_input: 'Check the requested values and try again.',
  reload: 'Reload the latest saved state before trying again.',
  retry_same_request: 'Retry using the same request ID.',
  contact_support: 'This action is not permitted for this account.',
};

function summarizeFailure(result: Failure): string {
  return `Riff request failed (${result.error.code}). ${RECOVERY_SUMMARIES[result.error.recovery]}`;
}

function count(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

type ProductSummaryData =
  | { account: Pick<Account, 'state' | 'onboarding_seen_at'>; entitlements: { status: string }; usage: { status: string } }
  | { onboarding_seen_at: string }
  | { project: Pick<Project, 'current_version'>; request_id?: string };

function summarizeProductSuccess(operation: string, data: ProductSummaryData): string {
  if ('account' in data) {
    const onboarding = data.account.onboarding_seen_at === null ? 'not complete' : 'complete';
    return `Riff account is ${data.account.state}; onboarding is ${onboarding}. Entitlements: ${data.entitlements.status.replaceAll('_', ' ')}. Usage: ${data.usage.status.replaceAll('_', ' ')}.`;
  }
  if ('onboarding_seen_at' in data) return 'Riff onboarding is complete.';
  return `${operation === 'save_project' ? 'Saved' : 'Opened'} Riff project at version ${data.project.current_version}.`;
}

type CreatorDnaSummaryData = { dna: CreatorDnaView; request_id?: string };

function summarizeCreatorDna(operation: string, data: CreatorDnaSummaryData): string {
  const { dna } = data;
  const action = operation === 'correct_creator_dna' ? 'Saved' : 'Loaded';
  return `${action} Creator DNA version ${dna.version} with ${count(dna.claims.length, 'claim')}, ${count(dna.evidence.length, 'evidence item')}, and ${count(dna.limitations.length, 'limitation')}.`;
}

function summarizeCreatorJob(data: { job: CreatorJobView } | { status: CreatorJobStatusView }): string {
  const job = 'job' in data ? data.job : data.status;
  let detail: string;
  if ('result' in job && job.result) {
    if (job.result.kind === 'scan') {
      detail = `DNA version: ${job.result.dna.version}; claims: ${job.result.dna.claims.length}; evidence items: ${job.result.dna.evidence.length}`;
    } else if (job.result.kind === 'recommendations') {
      detail = `DNA version: ${job.result.batch.dna_version}; ideas: ${job.result.batch.ideas.length}; references: ${job.result.batch.references.length}`;
    } else {
      detail = `script version: ${job.result.scripts.version}; variants: ${job.result.scripts.variants.length}`;
    }
  } else if (job.progress.kind === 'scan') {
    detail = `videos: ${job.progress.videos.length}`;
  } else if (job.progress.kind === 'recommendations') {
    detail = `identified references: ${job.progress.identities.length}; enriched references: ${job.progress.references.length}`;
  } else {
    detail = `limitations: ${job.progress.limitations.length}`;
  }
  return `Creator ${job.kind} job — state: ${job.state}; stage: ${job.stage}; revision: ${job.revision}; ${detail}.`;
}

type RiffCreatorSummaryData =
  | { project: Pick<Project, 'current_version'>; job: CreatorJobView; source: { kind: 'profile' | 'video' } }
  | { work: Array<{ state: CreatorJobView['state'] }> };

function summarizeRiffCreator(data: RiffCreatorSummaryData): string {
  if ('work' in data) {
    if (data.work.length === 0) return 'Found 0 recent Riff work items.';
    const states: CreatorJobView['state'][] = ['queued', 'running', 'succeeded', 'failed', 'needs_reconciliation'];
    const counts = states.map(state => [state, data.work.filter(item => item.state === state).length] as const)
      .filter(([, total]) => total > 0)
      .map(([state, total]) => `${state.replaceAll('_', ' ')}: ${total}`)
      .join('; ');
    return `Found ${count(data.work.length, 'recent Riff work item')} (${counts}).`;
  }
  return `Riff creator analysis — source: ${data.source.kind}; project version: ${data.project.current_version}; job state: ${data.job.state}; stage: ${data.job.stage}; revision: ${data.job.revision}.`;
}

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
        if (!result.ok) return {content:[{type:'text' as const,text:summarizeFailure(result)}],structuredContent:result,isError:true,
          ...(needsAuth?{_meta:{'mcp/www_authenticate':[challenge(auth.config,result.error.code==='FORBIDDEN'?'insufficient_scope':'invalid_token')]}}:{})};
        return {content:[{type:'text' as const,text:summarizeCreatorJob(result.data)}],structuredContent:result};
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
          content: [{ type: 'text' as const, text: summarizeFailure(result) }], structuredContent: result, isError: true,
          ...(needsAuth ? { _meta: { 'mcp/www_authenticate': [challenge(auth.config,
            result.error.code === 'FORBIDDEN' ? 'insufficient_scope' : 'invalid_token')] } } : {}),
        };
        return { content: [{ type: 'text' as const, text: summarizeRiffCreator(result.data) }], structuredContent: result };
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
  if(auth?.riffWorkStateOperations){
    for(const tool of RIFF_WORK_STATE_TOOLS){
      server.registerTool(tool.name,tool.registration,async(input:unknown)=>{
        const result=await auth.riffWorkStateOperations!.execute(token,input);
        const needsAuth=!result.ok&&(result.error.code==='UNAUTHENTICATED'||
          (result.error.code==='FORBIDDEN'&&token&&!(await auth.verifier.verify(token))?.scopes.includes(tool.contract.scope)));
        if(!result.ok)return {content:[{type:'text' as const,text:summarizeFailure(result)}],structuredContent:result,isError:true,
          ...(needsAuth?{_meta:{'mcp/www_authenticate':[challenge(auth.config,result.error.code==='FORBIDDEN'?'insufficient_scope':'invalid_token')]}}:{})};
        const state=result.data.work_state;
        return {content:[{type:'text' as const,text:`Riff work state is ${state.state} (version ${state.version}).`}],structuredContent:result};
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
          content: [{ type: 'text' as const, text: summarizeFailure(result) }], structuredContent: result, isError: true,
          ...(needsAuth ? { _meta: { 'mcp/www_authenticate': [challenge(auth.config,
            result.error.code === 'FORBIDDEN' ? 'insufficient_scope' : 'invalid_token')] } } : {}),
        };
        return { content: [{ type: 'text' as const, text: summarizeCreatorDna(tool.operation, result.data) }], structuredContent: result };
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
          content: [{ type: 'text' as const, text: summarizeFailure(result) }], structuredContent: result, isError: true,
          ...(needsAuth ? { _meta: { 'mcp/www_authenticate': [challenge(auth.config,
            result.error.code === 'FORBIDDEN' ? 'insufficient_scope' : 'invalid_token')] } } : {}),
        };
        return { content: [{ type: 'text' as const, text: summarizeProductSuccess(tool.operation, result.data) }], structuredContent: result };
      });
    }
    server.registerTool('get_riff_profile', PROFILE_REGISTRATION, async () => {
      const result = await auth.operations.execute('get_account_state', token, {});
      const needsAuth = !result.ok && (result.error.code === 'UNAUTHENTICATED'
        || (result.error.code === 'FORBIDDEN' && token && !(await auth.verifier.verify(token))?.scopes.includes(ACCOUNT_CONTRACT.scope)));
      if (!result.ok) return {
        content: [{ type: 'text' as const, text: summarizeFailure(result) }], isError: true,
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
        content: [{ type: 'text' as const, text: summarizeFailure(result) }], structuredContent: result, isError: true,
        ...(needsAuth ? { _meta: { 'mcp/www_authenticate': [challenge(auth.config,
          result.error.code === 'FORBIDDEN' ? 'insufficient_scope' : 'invalid_token')] } } : {}),
      };
      const firstOpen = result.data.account.onboarding_seen_at === null;
      const text = firstOpen
        ? 'Riff Home is open and usable on the right. This account has not completed the welcome: call `show_riff_welcome` once now so the Paper welcome appears in this same ChatGPT conversation. Only its visible final action may record completion.'
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
    riffWorkState:Boolean(auth?.riffWorkStateOperations),
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
