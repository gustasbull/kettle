import { ToolSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import type { OpenAIUiToolMetadata } from '@openai/mcp-extensions/server';
import { z } from 'zod';
import { creatorContracts } from '../../packages/contracts/creator-operations.ts';
import { pipelineContracts } from '../../packages/contracts/creator-pipeline.ts';
import { riffCreatorContracts } from '../../packages/contracts/riff-creator.ts';
import { riffVideoContracts } from '../../packages/contracts/riff-videos.ts';
import { CONTRACT_VERSION, toolContracts } from '../../packages/contracts/index.ts';
import { OpenAIProfile } from '../../packages/contracts/openai-profile.ts';
import { oauthScopes } from '../../packages/auth/index.ts';
import { CREATOR_PIPELINE_URI } from './creator-pipeline-resource.ts';
import { CREATOR_REVIEW_URI } from './creator-review-resource.ts';
import { PROJECT_REVIEW_URI } from './project-review-resource.ts';
import { RIFF_HOME_URI } from './riff-home-resource.ts';
import { RIFF_ONBOARDING_URI } from './riff-onboarding-resource.ts';
import { PUBLISHED_RESULT_OUTPUT_SCHEMA } from './mcp-published-schema.ts';

type SecurityScheme = { type: string; scopes?: string[] };
export type AuthTool = Tool & { securitySchemes: SecurityScheme[] };
export type McpToolAvailability = {
  authenticated: boolean;
  creator: boolean;
  pipeline: boolean;
  riffCreator: boolean;
  riffVideos?: boolean;
};

function deepFreezePlain<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) deepFreezePlain(item);
    return Object.freeze(value);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  for (const item of Object.values(value as Record<string, unknown>)) deepFreezePlain(item);
  return Object.freeze(value);
}

function freezeTool<T extends {
  annotations: Record<string, unknown>;
  securitySchemes: SecurityScheme[];
  _meta: Record<string, unknown>;
  registration: Record<string, unknown>;
  ui?: { resourceUri: string };
}>(tool: T): T {
  deepFreezePlain(tool.annotations);
  deepFreezePlain(tool.securitySchemes);
  deepFreezePlain(tool._meta);
  deepFreezePlain(tool.registration);
  if (tool.ui) deepFreezePlain(tool.ui);
  return Object.freeze(tool);
}

const OAUTH_SECURITY = deepFreezePlain([
  { type: 'oauth2' as const, scopes: [...oauthScopes] },
]) as unknown as SecurityScheme[];
const NOAUTH_SECURITY = deepFreezePlain([{ type: 'noauth' }]) as unknown as SecurityScheme[];
const READ_ONLY = deepFreezePlain({
  readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false,
});

export const WELCOME_OUTPUT = z.strictObject({
  steps: z.tuple([z.literal('Start'), z.literal('Find'), z.literal('Make')]),
});
export const WELCOME_META = deepFreezePlain({
  securitySchemes: OAUTH_SECURITY,
  ui: { resourceUri: RIFF_ONBOARDING_URI },
});
export const WELCOME_REGISTRATION = deepFreezePlain({
  title: 'Welcome to Riff',
  description: 'Show the Riff guide: start with creator context, find an idea, and make it yours. Reads no account data and performs no writes.',
  inputSchema: z.strictObject({}),
  outputSchema: WELCOME_OUTPUT,
  annotations: READ_ONLY,
  _meta: WELCOME_META,
});
export const DIAGNOSTIC_REGISTRATION = deepFreezePlain({
  title: 'Check Riff connection',
  description: 'Check Riff connectivity. Returns no account data and performs no writes.',
  inputSchema: z.strictObject({}),
  outputSchema: z.object({ status: z.literal('ok'), contract_version: z.literal(CONTRACT_VERSION) }),
  annotations: READ_ONLY,
  _meta: { securitySchemes: NOAUTH_SECURITY },
});

export const PRODUCT_TOOLS = Object.freeze([
  ...Object.keys(toolContracts).map(name => ({
    name,
    operation: name as keyof typeof toolContracts,
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
].map(tool => {
  const contract = toolContracts[tool.operation];
  const annotations = { readOnlyHint: contract.readOnly, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const meta = { securitySchemes: OAUTH_SECURITY, ...(tool.ui ? { ui: tool.ui } : {}) };
  return freezeTool({ ...tool, contract, securitySchemes: OAUTH_SECURITY, annotations, _meta: meta,
    registration: { title: tool.title, description: tool.description, inputSchema: contract.input,
      outputSchema: contract.output.options[0], annotations, _meta: meta },
  });
}));

export const CREATOR_TOOLS = Object.freeze([
  { name: 'get_creator_dna', title: 'Read Creator DNA', operation: 'get_creator_dna' as const,
    description: 'Read saved Creator DNA by its explicit DNA ID, optionally at a historical version. Returns permitted evidence and limitations. Does not scan profiles or start research.', ui: undefined as { resourceUri: string } | undefined },
  { name: 'render_creator_dna', title: 'Show Creator DNA', operation: 'get_creator_dna' as const,
    description: 'Show saved Creator DNA as an inline review card using its explicit DNA ID. After a correction, call this to show the saved version. Does not scan, research or generate.', ui: { resourceUri: CREATOR_REVIEW_URI } },
  { name: 'correct_creator_dna', title: 'Correct Creator DNA', operation: 'correct_creator_dna' as const,
    description: 'Save user-requested corrections to existing Creator DNA traits. Read the current DNA first and use its claim IDs and version. Use a new request ID for each intended correction; reuse it only for an exact retry. On version conflict, reread and reconcile with the user before retrying. Preserves history; does not scan or generate.', ui: undefined },
].map(tool => {
  const contract = creatorContracts[tool.operation];
  const annotations = { readOnlyHint: contract.readOnly, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const meta = { securitySchemes: OAUTH_SECURITY, ...(tool.ui ? { ui: tool.ui } : {}) };
  return freezeTool({ ...tool, contract, securitySchemes: OAUTH_SECURITY, annotations, _meta: meta,
    registration: { title: tool.title, description: tool.description, inputSchema: contract.input,
      outputSchema: contract.output.options[0], annotations, _meta: meta },
  });
}));

const PIPELINE_DESCRIPTIONS = Object.freeze({
  start_creator_scan: 'Start a user-requested bounded TikTok review in an existing Riff project. Use a canonical profile URL, maximum ten videos/two pages, and pass the supplied video URL in seed_url. When seed_url is present, Lightreel reviews that exact video first; ScrapeCreators then supplies bounded profile/video metadata. Saved DNA includes the separate Lightreel review and its reported access limitations. Requires an allocated research allowance; can consume provider trial credits. Use a fresh request ID for a new intent and the identical ID/input only for an exact retry. Returns a durable job; read its status without restarting it.',
  start_creator_recommendations: 'Start user-requested reference research and personalized ideas from saved Creator DNA. Read and confirm the current DNA version first; pass expected_version. Can consume provider credits and requires a research allowance. Returns a durable job with zero to three evidence-backed ideas; fewer or no matches must be reported honestly.',
  start_creator_scripts: 'Backend API generation is disabled for the current trial. Use save_creator_scripts with variants drafted in this conversation. When enabled: generate two or three filming-script variants for the user-selected idea from an existing recommendation batch. Use its exact batch_id and idea_id; binds the original DNA version. Can consume model credits and requires a research allowance. Saves the result as a durable job. Never generate merely to refresh or reopen a card.',
  save_creator_scripts: 'Save two or three filming variants drafted in this ChatGPT conversation for a user-selected Riff idea. First read the successful recommendation job and its captured DNA. Draft the hook, opening visual, script, shots, B-roll, on-screen text, showcase timing, CTA, estimated duration and pacing. Also provide timed segments for hook, main_content and cta with start/end seconds and filming directions, plus a platform caption and hashtags. Supply per-segment reference_ids when the segment lineage is actually known; omit segment reference_ids when that lineage is unknown. Always retain the complete variant reference_ids, using only the selected idea reference IDs. Labels: Reference-led, Creator Fit, Experimental (two or three distinct labels). Pass batch_id, idea_id, variants and a new request_id; exact retries reuse that ID. Riff validates lineage and saves a durable script job without calling an external model or spending credits. Call render_creator_job with returned job_id to reopen.',
  get_creator_job: 'Read an existing creator scan, recommendation or script job by job_id, including its saved result. Does not call providers, spend credits, start or retry work. Preserve job_id to reopen in a later conversation.',
  get_creator_job_status: 'Read compact persisted progress for an existing creator job by job_id. Provider-free and read-only: it never dispatches, calls providers, reserves allowance, starts or retries work.',
});

export const PIPELINE_TOOLS = Object.freeze([
  ...Object.keys(pipelineContracts).filter(name => name !== 'start_creator_scripts').map(name => ({
    name, operation: name as keyof typeof pipelineContracts,
    title: name === 'start_creator_scan' ? 'Analyze creator video'
      : name === 'start_creator_recommendations' ? 'Discover video ideas'
        : name === 'save_creator_scripts' ? 'Save filming scripts'
          : name === 'get_creator_job_status' ? 'Read creator job progress' : 'Read creator job',
    ui: undefined as { resourceUri: string } | undefined,
  })),
  { name: 'render_creator_job', title: 'Show creator work', operation: 'get_creator_job' as const,
    ui: { resourceUri: CREATOR_PIPELINE_URI } },
].map(tool => {
  const contract = pipelineContracts[tool.operation];
  const description = tool.name === 'render_creator_job'
    ? 'Show an existing creator job and its saved DNA, ideas or scripts as an inline card. Read-only: refresh never starts research or generation. Use the explicit job_id.'
    : PIPELINE_DESCRIPTIONS[tool.operation];
  const annotations = { readOnlyHint: contract.readOnly, destructiveHint: false, idempotentHint: true,
    openWorldHint: !contract.readOnly && tool.operation !== 'save_creator_scripts' };
  const meta = { securitySchemes: OAUTH_SECURITY,
    ui: { ...(tool.ui ?? {}), visibility: ['model', 'app'] as const } };
  return freezeTool({ ...tool, contract, description, securitySchemes: OAUTH_SECURITY, annotations, _meta: meta,
    registration: { title: tool.title, description, inputSchema: contract.input, annotations, _meta: meta },
  });
}));

export const RIFF_CREATOR_TOOLS = Object.freeze([
  {
    name: 'start_riff_creator', operation: 'start_riff_creator' as const, title: 'Start creator analysis',
    description: 'Start the complete Riff analysis path from one public TikTok creator-profile or video URL, including bounded TikTok short-link resolution. Riff derives account ownership from OAuth, requires a separately provisioned account run grant, atomically creates or reuses the creator project and reserved allowance, queues one idempotent saved scan, and returns its job. This explicit action can access public providers and consume the pre-authorized trial grant.',
    ui: { resourceUri: CREATOR_PIPELINE_URI } as { resourceUri: string } | undefined,
  },
  {
    name: 'get_riff_creator_start', operation: 'get_riff_creator_start' as const, title: 'Recover creator analysis start',
    description: 'Read the signed-in account’s exact saved creator start by its original request ID and source URL. Provider-free and read-only: it never starts, retries, refills, dispatches, or spends provider allowance.',
    ui: undefined as { resourceUri: string } | undefined,
  },
  {
    name: 'list_riff_work', operation: 'list_riff_work' as const, title: 'List recent Riff work',
    description: 'List the signed-in account’s recent saved Riff creator jobs for Home. Reads owned summaries only; it does not call providers, start work, or spend credits.',
    ui: undefined as { resourceUri: string } | undefined,
  },
].map(tool => {
  const contract = riffCreatorContracts[tool.operation];
  const annotations = { readOnlyHint: contract.readOnly, destructiveHint: false, idempotentHint: true,
    openWorldHint: tool.operation === 'start_riff_creator' };
  const meta = { securitySchemes: OAUTH_SECURITY,
    ui: { ...(tool.ui ?? {}), visibility: ['model', 'app'] as const } };
  return freezeTool({ ...tool, contract, securitySchemes: OAUTH_SECURITY, annotations, _meta: meta,
    registration: { title: tool.title, description: tool.description, inputSchema: contract.input,
      annotations, _meta: meta },
  });
}));

export const RIFF_VIDEO_TOOLS=Object.freeze([{
  name:'list_riff_videos',operation:'list_riff_videos' as const,title:'List saved Riff videos',
  description:'List the signed-in account’s saved permitted TikTok video metadata, optionally filtered by owned project or source role. Provider-free and read-only: it never refreshes a provider, dispatches work, or spends allowance.',
}].map(tool=>{
  const contract=riffVideoContracts[tool.operation];
  const annotations={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
  const meta={securitySchemes:OAUTH_SECURITY,ui:{visibility:['model','app'] as const}};
  return freezeTool({...tool,contract,securitySchemes:OAUTH_SECURITY,annotations,_meta:meta,
    registration:{title:tool.title,description:tool.description,inputSchema:contract.input,annotations,_meta:meta}});
}));

export const ACCOUNT_CONTRACT = toolContracts.get_account_state;
const OPENAI_HOME_UI = deepFreezePlain({
  preferredModelDisplayMode: 'fullscreen',
  entrypoints: [{ type: 'global' }, { type: 'thread' }],
}) satisfies OpenAIUiToolMetadata;
export const PROFILE_META = deepFreezePlain({ securitySchemes: OAUTH_SECURITY, 'openai/profile': true });
export const HOME_META = deepFreezePlain({
  securitySchemes: OAUTH_SECURITY,
  ui: { resourceUri: RIFF_HOME_URI, visibility: ['model', 'app'] as const },
  'openai/ui': OPENAI_HOME_UI,
  'openai/widgetAccessible': true,
});
export const PROFILE_REGISTRATION = deepFreezePlain({
  title: 'Riff profile',
  description: 'Return the signed-in Riff account identity for ChatGPT account recognition. Returns only an opaque ID and display name.',
  inputSchema: z.strictObject({}), outputSchema: OpenAIProfile, annotations: READ_ONLY, _meta: PROFILE_META,
});
export const HOME_REGISTRATION = deepFreezePlain({
  title: 'Riff Home',
  description: 'Open Riff Home for creator input, idea discovery, and continuing into video creation. Reads account state only.',
  inputSchema: ACCOUNT_CONTRACT.input, outputSchema: ACCOUNT_CONTRACT.output.options[0],
  annotations: READ_ONLY, _meta: HOME_META,
});

const inputSchema = (schema: z.ZodType) =>
  ToolSchema.shape.inputSchema.parse({ ...z.toJSONSchema(schema), type: 'object' });
const outputSchema = (schema: z.ZodType) =>
  ToolSchema.shape.outputSchema.parse({ ...z.toJSONSchema(schema, { reused: 'ref' }), type: 'object' });
const descriptorFor = (tool: typeof PRODUCT_TOOLS[number] | typeof CREATOR_TOOLS[number]
  | typeof PIPELINE_TOOLS[number] | typeof RIFF_CREATOR_TOOLS[number] | typeof RIFF_VIDEO_TOOLS[number]): AuthTool => {
  return deepFreezePlain({
    name: tool.name, title: tool.title, description: tool.description,
    // Keep ChatGPT app refresh bounded while retaining the truthful result
    // discriminant. Runtime registrations and application operations still
    // validate their complete tool-specific success projections.
    inputSchema: inputSchema(tool.contract.input), outputSchema: PUBLISHED_RESULT_OUTPUT_SCHEMA,
    annotations: tool.annotations, securitySchemes: tool.securitySchemes, _meta: tool._meta,
  }) as AuthTool;
};

const DIAGNOSTIC_DESCRIPTOR = deepFreezePlain({
  name: 'kettle_diagnostic', title: DIAGNOSTIC_REGISTRATION.title,
  description: DIAGNOSTIC_REGISTRATION.description,
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  outputSchema: outputSchema(DIAGNOSTIC_REGISTRATION.outputSchema),
  annotations: READ_ONLY, securitySchemes: NOAUTH_SECURITY,
  _meta: { securitySchemes: NOAUTH_SECURITY },
}) as AuthTool;
const WELCOME_DESCRIPTOR = deepFreezePlain({
  name: 'show_riff_welcome', title: 'Welcome to Riff',
  description: 'Show the first-run Riff guide: start with creator context, find an idea, and make it yours. No account data or writes.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  outputSchema: outputSchema(WELCOME_OUTPUT), annotations: READ_ONLY,
  securitySchemes: OAUTH_SECURITY, _meta: WELCOME_META,
}) as AuthTool;
const PROFILE_DESCRIPTOR = deepFreezePlain({
  name: 'get_riff_profile', title: PROFILE_REGISTRATION.title, description: PROFILE_REGISTRATION.description,
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  outputSchema: outputSchema(OpenAIProfile), annotations: READ_ONLY,
  securitySchemes: OAUTH_SECURITY, _meta: PROFILE_META,
}) as AuthTool;
const HOME_DESCRIPTOR = deepFreezePlain({
  name: 'open_riff', title: HOME_REGISTRATION.title, description: HOME_REGISTRATION.description,
  inputSchema: inputSchema(ACCOUNT_CONTRACT.input), outputSchema: PUBLISHED_RESULT_OUTPUT_SCHEMA,
  annotations: READ_ONLY, securitySchemes: OAUTH_SECURITY, _meta: HOME_META,
}) as AuthTool;

const availabilityKey = (availability: McpToolAvailability) => {
  const authenticated = availability.authenticated;
  return [authenticated, authenticated && availability.creator, authenticated && availability.pipeline,
    authenticated && availability.riffCreator,authenticated && Boolean(availability.riffVideos)].map(Number).join('');
};
const catalogs: Record<string, readonly AuthTool[]> = {};
for (const authenticated of [false, true]) for (const creator of [false, true]) {
  for (const pipeline of [false, true]) for (const riffCreator of [false, true]) {
   for(const riffVideos of [false,true]){
    const descriptors: AuthTool[] = [DIAGNOSTIC_DESCRIPTOR];
    if (authenticated) {
      descriptors.push(WELCOME_DESCRIPTOR, ...PRODUCT_TOOLS.map(descriptorFor));
      if (creator) descriptors.push(...CREATOR_TOOLS.map(descriptorFor));
      if (pipeline) descriptors.push(...PIPELINE_TOOLS.map(descriptorFor));
      if (riffCreator) descriptors.push(...RIFF_CREATOR_TOOLS.map(descriptorFor));
      if(riffVideos)descriptors.push(...RIFF_VIDEO_TOOLS.map(descriptorFor));
      descriptors.push(PROFILE_DESCRIPTOR, HOME_DESCRIPTOR);
    }
    catalogs[availabilityKey({ authenticated, creator, pipeline, riffCreator, riffVideos })] = Object.freeze(descriptors);
   }
  }
}
const DESCRIPTOR_CATALOGS = Object.freeze(catalogs);

/** Selects a module-initialized descriptor set. It never captures request auth, tokens, or account state. */
export function selectMcpToolDescriptors(availability: McpToolAvailability): readonly AuthTool[] {
  return DESCRIPTOR_CATALOGS[availabilityKey(availability)]!;
}
