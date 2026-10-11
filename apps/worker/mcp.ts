import { pipelineContracts } from '../../packages/contracts/creator-pipeline.ts';
import type { createPipelineOperations } from '../../packages/application/creator-pipeline.ts';
import { registerCreatorPipelineResource, CREATOR_PIPELINE_URI } from './creator-pipeline-resource.ts';
import { creatorContracts } from '../../packages/contracts/creator-operations.ts';
import type { createCreatorOperations } from '../../packages/application/creator-operations.ts';
import { registerCreatorReviewResource, CREATOR_REVIEW_URI } from './creator-review-resource.ts';
import { ListToolsRequestSchema, ToolSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { CONTRACT_VERSION, toolContracts } from '../../packages/contracts/index.ts';
import { OpenAIProfile } from '../../packages/contracts/openai-profile.ts';
import type { OpenAIUiToolMetadata } from '@openai/mcp-extensions/server';

import { registerProjectReviewResource, PROJECT_REVIEW_URI } from './project-review-resource.ts';
import { registerRiffOnboardingResource, RIFF_ONBOARDING_URI } from './riff-onboarding-resource.ts';
import { registerRiffHomeResource, RIFF_HOME_URI } from './riff-home-resource.ts';

import type { createOperations, IdentityVerifier } from '../../packages/application/operations.ts';
import { bearer, challenge, oauthScopes, type AuthConfig } from '../../packages/auth/index.ts';

export interface McpAuth {
  config: AuthConfig;
  verifier: IdentityVerifier;
  operations: ReturnType<typeof createOperations>;
  pipelineOperations?: ReturnType<typeof createPipelineOperations>;
  creatorOperations?: ReturnType<typeof createCreatorOperations>;
}
export async function handleMcp(request: Request, auth?: McpAuth): Promise<Response> {
  const token = bearer(request);
  if (auth && request.headers.has('authorization') && (!token || !await auth.verifier.verify(token))) {
    return new Response('Authentication required', { status: 401, headers: {
      'WWW-Authenticate': challenge(auth.config), 'Cache-Control': 'no-store',
    } });
  }
  const server = new McpServer({ name: 'kettle-foundation', version: '0.1.0' });
  server.registerTool('kettle_diagnostic', {
    title: 'Check Riff connection',
    description: 'Check Riff connectivity. Returns no account data and performs no writes.',
    inputSchema: z.strictObject({}),
    outputSchema: z.object({ status: z.literal('ok'), contract_version: z.literal(CONTRACT_VERSION) }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { securitySchemes: [{ type: 'noauth' }] },
  }, async () => ({
    content: [{ type: 'text', text: auth ? 'Riff is reachable. Account tools require authorization.' : 'Riff foundation is reachable. Account tools are not enabled yet.' }],
    structuredContent: { status: 'ok', contract_version: CONTRACT_VERSION },
  }));
  const welcomeOutput = z.strictObject({ steps: z.tuple([z.literal('Start'), z.literal('Find'), z.literal('Make')]) });
  const welcomeSecurity = [{ type: 'oauth2' as const, scopes: [...oauthScopes] }];
  const welcomeMeta = { securitySchemes: welcomeSecurity, ui: { resourceUri: RIFF_ONBOARDING_URI } };
  if (auth) {
    registerRiffOnboardingResource(server);
    server.registerTool('show_riff_welcome', {
      title: 'Welcome to Riff',
      description: 'Show the Riff guide: start with creator context, find an idea, and make it yours. Reads no account data and performs no writes.',
      inputSchema: z.strictObject({}), outputSchema: welcomeOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: welcomeMeta,
    }, async () => {
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
  // One definition drives both registration and the overridden tools/list.
  // The render tool is a transport alias, never a new application operation.
  const productTools = [
    ...Object.keys(toolContracts).map((name) => ({
      name, operation: name as keyof typeof toolContracts,
      title: name === 'get_account_state' ? 'Riff account status'
        : name === 'mark_riff_onboarding_seen' ? 'Finish Riff welcome'
          : name === 'get_project' ? 'Open Riff project' : 'Save Riff project',
      description: name === 'save_project' ? 'Save a complete project brief in your Riff account with version and request-ID checks.'
        : name === 'get_project' ? 'Reopen a saved project in your Riff account.'
          : name === 'mark_riff_onboarding_seen' ? 'Record that the signed-in account has seen the first-run Riff guide. Safe to retry.'
            : 'Read your Riff account status.',
      ui: undefined as { resourceUri: string } | undefined,
    })),
    {
      name: 'show_project_brief', title: 'Show project brief', operation: 'get_project' as const,
      description: 'Show the saved brief for an existing Riff project as an inline review card. Use its explicit project ID. After saving corrections, call this tool to show the saved version. This tool does not generate content or save changes.',
      ui: { resourceUri: PROJECT_REVIEW_URI },
    },
  ].map((tool) => {
    const contract = toolContracts[tool.operation];
    const securitySchemes = [{ type: 'oauth2', scopes: [...oauthScopes] }];
    return { ...tool, contract, securitySchemes,
      annotations: { readOnlyHint: contract.readOnly, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { securitySchemes, ...(tool.ui ? { ui: tool.ui } : {}) },
    };
  });
  const creatorTools = [
    { name: 'get_creator_dna', title: 'Read Creator DNA', operation: 'get_creator_dna' as const,
      description: 'Read saved Creator DNA by its explicit DNA ID, optionally at a historical version. Returns permitted evidence and limitations. Does not scan profiles or start research.', ui: undefined as { resourceUri: string } | undefined },
    { name: 'render_creator_dna', title: 'Show Creator DNA', operation: 'get_creator_dna' as const,
      description: 'Show saved Creator DNA as an inline review card using its explicit DNA ID. After a correction, call this to show the saved version. Does not scan, research or generate.', ui: { resourceUri: CREATOR_REVIEW_URI } },
    { name: 'correct_creator_dna', title: 'Correct Creator DNA', operation: 'correct_creator_dna' as const,
      description: 'Save user-requested corrections to existing Creator DNA traits. Read the current DNA first and use its claim IDs and version. Use a new request ID for each intended correction; reuse it only for an exact retry. On version conflict, reread and reconcile with the user before retrying. Preserves history; does not scan or generate.', ui: undefined },
  ].map(tool => {
    const contract = creatorContracts[tool.operation];
    const securitySchemes = [{ type: 'oauth2', scopes: [...oauthScopes] }];
    return { ...tool, contract, securitySchemes,
      annotations: { readOnlyHint: contract.readOnly, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { securitySchemes, ...(tool.ui ? { ui: tool.ui } : {}) },
    };
  });
  const pipelineDescriptions = {
    start_creator_scan: 'Start a user-requested bounded TikTok review in an existing Riff project. Use a canonical profile URL, maximum ten videos/two pages, and pass the supplied video URL in seed_url. When seed_url is present, Lightreel reviews that exact video first; ScrapeCreators then supplies bounded profile/video metadata. Saved DNA includes the separate Lightreel review and its reported access limitations. Requires an allocated research allowance; can consume provider trial credits. Use a fresh request ID for a new intent and the identical ID/input only for an exact retry. Returns a durable job; read its status without restarting it.',
    start_creator_recommendations: 'Start user-requested reference research and personalized ideas from saved Creator DNA. Read and confirm the current DNA version first; pass expected_version. Can consume provider credits and requires a research allowance. Returns a durable job with zero to three evidence-backed ideas; fewer or no matches must be reported honestly.',
    start_creator_scripts: 'Backend API generation is disabled for the current trial. Use save_creator_scripts with variants drafted in this conversation. When enabled: generate two or three filming-script variants for the user-selected idea from an existing recommendation batch. Use its exact batch_id and idea_id; binds the original DNA version. Can consume model credits and requires a research allowance. Saves the result as a durable job. Never generate merely to refresh or reopen a card.',
    save_creator_scripts: 'Save two or three filming variants drafted in this ChatGPT conversation for a user-selected Riff idea. First read the successful recommendation job and its captured DNA. Draft original hook, opening visual, script, shots, B-roll, on-screen text, showcase timing, CTA, estimated duration and pacing; use only the selected idea reference IDs. Labels: Reference-led, Creator Fit, Experimental (two or three distinct labels). Pass batch_id, idea_id, variants and a new request_id; exact retries reuse that ID. Riff validates lineage and saves a durable script job without calling an external model or spending credits. Call render_creator_job with returned job_id to reopen.',
    get_creator_job: 'Read an existing creator scan, recommendation or script job by job_id, including its saved result. Does not call providers, spend credits, start or retry work. Preserve job_id to reopen in a later conversation.',
  };
  const pipelineTools = [
    ...Object.keys(pipelineContracts).filter(name=>name!=='start_creator_scripts').map(name => ({name, operation:name as keyof typeof pipelineContracts,
      title: name === 'start_creator_scan' ? 'Analyze creator video'
        : name === 'start_creator_recommendations' ? 'Discover video ideas'
          : name === 'save_creator_scripts' ? 'Save filming scripts' : 'Read creator job',
      ui:undefined as {resourceUri:string}|undefined})),
    {name:'render_creator_job',title:'Show creator work',operation:'get_creator_job' as const,ui:{resourceUri:CREATOR_PIPELINE_URI}},
  ].map(tool=>{
    const contract=pipelineContracts[tool.operation];
    const securitySchemes=[{type:'oauth2',scopes:[...oauthScopes]}];
    return {...tool,contract,securitySchemes,description:tool.name==='render_creator_job'?'Show an existing creator job and its saved DNA, ideas or scripts as an inline card. Read-only: refresh never starts research or generation. Use the explicit job_id.':pipelineDescriptions[tool.operation],
      annotations:{readOnlyHint:contract.readOnly,destructiveHint:false,idempotentHint:true,openWorldHint:!contract.readOnly&&tool.operation!=='save_creator_scripts'},
      _meta:{securitySchemes,...(tool.ui?{ui:tool.ui}:{})}};
  });
  const accountContract = toolContracts.get_account_state;
  const riffSecurity = [{ type: 'oauth2' as const, scopes: [...oauthScopes] }];
  const openaiHomeUi = {
    preferredModelDisplayMode: 'fullscreen',
    entrypoints: [{ type: 'global' }, { type: 'thread' }],
  } satisfies OpenAIUiToolMetadata;
  const profileMeta = { securitySchemes: riffSecurity, 'openai/profile': true };
  const homeMeta = {
    securitySchemes: riffSecurity, ui: { resourceUri: RIFF_HOME_URI }, 'openai/ui': openaiHomeUi,
  };
  if(auth?.pipelineOperations){
    registerCreatorPipelineResource(server);
    for(const tool of pipelineTools){
      const contract=tool.contract;
      server.registerTool(tool.name,{title:tool.title,description:tool.description,inputSchema:contract.input,outputSchema:contract.output.options[0],annotations:tool.annotations,_meta:tool._meta},async(input:unknown)=>{
        const result=await auth.pipelineOperations!.execute(tool.operation,token,input);
        const needsAuth=!result.ok&&(result.error.code==='UNAUTHENTICATED'||(result.error.code==='FORBIDDEN'&&token&&!(await auth.verifier.verify(token))?.scopes.includes(contract.scope)));
        if (!result.ok) return {content:[{type:'text' as const,text:JSON.stringify(result)}],isError:true,
          ...(needsAuth?{_meta:{'mcp/www_authenticate':[challenge(auth.config,result.error.code==='FORBIDDEN'?'insufficient_scope':'invalid_token')]}}:{})};
        return {content:[{type:'text' as const,text:JSON.stringify(result)}],structuredContent:result};
      });
    }
  }
  if (auth?.creatorOperations) {
    const operations = auth.creatorOperations;
    registerCreatorReviewResource(server);
    for (const tool of creatorTools) {
      const { contract } = tool;
      server.registerTool(tool.name, {
        title: tool.title, description: tool.description, inputSchema: contract.input,
        outputSchema: contract.output.options[0], annotations: tool.annotations, _meta: tool._meta,
      }, async (input: unknown) => {
        const result = await operations.execute(tool.operation, token, input);
        const needsAuth = !result.ok && (result.error.code === 'UNAUTHENTICATED'
          || (result.error.code === 'FORBIDDEN' && token && !(await auth.verifier.verify(token))?.scopes.includes(contract.scope)));
        if (!result.ok) return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }], isError: true,
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
    for (const tool of productTools) {
      const { contract } = tool;
      server.registerTool(tool.name, {
        title: tool.title,
        description: tool.description,
        inputSchema: contract.input,
        // SDK 1.32 validates successful results as object schemas and skips
        // validation for isError results. A discriminated union crashes its
        // object normalizer. The application still validates the full v1 union;
        // tools/list below publishes that unchanged union for clients.
        outputSchema: contract.output.options[0],
        annotations: tool.annotations, _meta: tool._meta,
      }, async (input: unknown) => {
        const result = await auth.operations.execute(tool.operation, token, input);
        const needsAuth = !result.ok && (result.error.code === 'UNAUTHENTICATED'
          || (result.error.code === 'FORBIDDEN' && token && !(await auth.verifier.verify(token))?.scopes.includes(contract.scope)));
        if (!result.ok) return {
          content: [{ type: 'text' as const, text: result.error.message }], isError: true,
          ...(needsAuth ? { _meta: { 'mcp/www_authenticate': [challenge(auth.config,
            result.error.code === 'FORBIDDEN' ? 'insufficient_scope' : 'invalid_token')] } } : {}),
        };
        return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }], structuredContent: result };
      });
    }
    server.registerTool('get_riff_profile', {
      title: 'Riff profile',
      description: 'Return the signed-in Riff account identity for ChatGPT account recognition. Returns only an opaque ID and display name.',
      inputSchema: z.strictObject({}), outputSchema: OpenAIProfile,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: profileMeta,
    }, async () => {
      const result = await auth.operations.execute('get_account_state', token, {});
      const needsAuth = !result.ok && (result.error.code === 'UNAUTHENTICATED'
        || (result.error.code === 'FORBIDDEN' && token && !(await auth.verifier.verify(token))?.scopes.includes(accountContract.scope)));
      if (!result.ok) return {
        content: [{ type: 'text' as const, text: result.error.message }], isError: true,
        ...(needsAuth ? { _meta: { 'mcp/www_authenticate': [challenge(auth.config,
          result.error.code === 'FORBIDDEN' ? 'insufficient_scope' : 'invalid_token')] } } : {}),
      };
      const profile = OpenAIProfile.parse({ id: result.data.account.id, name: result.data.account.display_name });
      return { content: [{ type: 'text' as const, text: JSON.stringify(profile) }], structuredContent: profile };
    });
    server.registerTool('open_riff', {
      title: 'Riff Home',
      description: 'Open Riff Home for creator input, idea discovery, and continuing into video creation. Reads account state only.',
      inputSchema: accountContract.input, outputSchema: accountContract.output.options[0],
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: homeMeta,
    }, async () => {
      const result = await auth.operations.execute('get_account_state', token, {});
      const needsAuth = !result.ok && (result.error.code === 'UNAUTHENTICATED'
        || (result.error.code === 'FORBIDDEN' && token && !(await auth.verifier.verify(token))?.scopes.includes(accountContract.scope)));
      if (!result.ok) return {
        content: [{ type: 'text' as const, text: result.error.message }], isError: true,
        ...(needsAuth ? { _meta: { 'mcp/www_authenticate': [challenge(auth.config,
          result.error.code === 'FORBIDDEN' ? 'insufficient_scope' : 'invalid_token')] } } : {}),
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }], structuredContent: result };
    });
  }
  // SDK 1.32's high-level registration only serializes _meta. Publish the
  // standard top-level securitySchemes as well, using its public list handler API.
  type AuthTool = Tool & { securitySchemes: ({ type: string; scopes?: string[] })[] };
  const diagnostic: AuthTool = {
    name: 'kettle_diagnostic', title: 'Check Riff connection', description: 'Check Riff connectivity. Returns no account data and performs no writes.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: { type: 'object', properties: { status: { const: 'ok' }, contract_version: { const: CONTRACT_VERSION } }, required: ['status', 'contract_version'] },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    securitySchemes: [{ type: 'noauth' }], _meta: { securitySchemes: [{ type: 'noauth' }] },
  };
  const welcomeDescriptor: AuthTool = {
    name: 'show_riff_welcome', title: 'Welcome to Riff',
    description: 'Show the first-run Riff guide: start with creator context, find an idea, and make it yours. No account data or writes.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: ToolSchema.shape.outputSchema.parse({ ...z.toJSONSchema(welcomeOutput), type: 'object' }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    securitySchemes: welcomeSecurity, _meta: welcomeMeta,
  };
  const descriptors: AuthTool[] = [diagnostic];
  if (auth) descriptors.push(welcomeDescriptor);
  if (auth) for (const tool of productTools) {
    descriptors.push({ name: tool.name, title: tool.title, description: tool.description,
      inputSchema: ToolSchema.shape.inputSchema.parse({ ...z.toJSONSchema(tool.contract.input), type: 'object' }),
      outputSchema: ToolSchema.shape.outputSchema.parse({ ...z.toJSONSchema(tool.contract.output), type: 'object' }),
      annotations: tool.annotations, securitySchemes: tool.securitySchemes, _meta: tool._meta,
    });
  }
  if (auth?.creatorOperations) for (const tool of creatorTools) {
    descriptors.push({ name: tool.name, title: tool.title, description: tool.description,
      inputSchema: ToolSchema.shape.inputSchema.parse({ ...z.toJSONSchema(tool.contract.input), type: 'object' }),
      outputSchema: ToolSchema.shape.outputSchema.parse({ ...z.toJSONSchema(tool.contract.output), type: 'object' }),
      annotations: tool.annotations, securitySchemes: tool.securitySchemes, _meta: tool._meta,
    });
  }
  if(auth?.pipelineOperations)for(const tool of pipelineTools){
    descriptors.push({name:tool.name,title:tool.title,description:tool.description,
      inputSchema:ToolSchema.shape.inputSchema.parse({...z.toJSONSchema(tool.contract.input),type:'object'}),
      outputSchema:ToolSchema.shape.outputSchema.parse({...z.toJSONSchema(tool.contract.output),type:'object'}),
      annotations:tool.annotations,securitySchemes:tool.securitySchemes,_meta:tool._meta});
  }
  if (auth) {
    descriptors.push({
      name: 'get_riff_profile', title: 'Riff profile',
      description: 'Return the signed-in Riff account identity for ChatGPT account recognition. Returns only an opaque ID and display name.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      outputSchema: ToolSchema.shape.outputSchema.parse({ ...z.toJSONSchema(OpenAIProfile), type: 'object' }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      securitySchemes: riffSecurity, _meta: profileMeta,
    }, {
      name: 'open_riff', title: 'Riff Home',
      description: 'Open Riff Home for creator input, idea discovery, and continuing into video creation. Reads account state only.',
      inputSchema: ToolSchema.shape.inputSchema.parse({ ...z.toJSONSchema(accountContract.input), type: 'object' }),
      outputSchema: ToolSchema.shape.outputSchema.parse({ ...z.toJSONSchema(accountContract.output), type: 'object' }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      securitySchemes: riffSecurity, _meta: homeMeta,
    });
  }
  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: descriptors }));
  // A new stateless transport per request works across Worker isolates. Product
  // state will live in Postgres, not an MCP session or an isolate global.
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true, maxRequestBodySize: 128 * 1024,
  });
  await server.connect(transport);
  try { return await transport.handleRequest(request); }
  finally { await server.close(); }
}
