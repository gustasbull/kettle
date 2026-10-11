import {
  App, PostMessageTransport, applyDocumentTheme, applyHostFonts, applyHostStyleVariables,
  type McpUiHostContext,
} from './mcp-app-lite.ts';
import type { OpenAIMessageParams } from '@openai/mcp-extensions/app';
import type { CreatorJobView } from '../../packages/contracts/creator-pipeline.ts';
import { mountRiffHome, riffHomeStructuredOutput, type RiffHomeState } from './riff-home/index.ts';
import { riffCatalogProposalHandoff } from './creator-pipeline/index.ts';
import { createCreatorPipelineController, creatorJobStatusStructuredOutput, creatorJobStructuredOutput } from './creator-pipeline-controller.ts';
import { createRiffVideoCatalogLoader } from './riff-video-catalog-loader.ts';
import { panelPerformanceFromDocument } from './creator-performance.ts';
import {
  parseProductGetResult,
  parseProductSaveResult,
  productFailureMessage,
  validateProductDraft,
  type ProductDraft,
} from './riff-product-context-validation.ts';
import { riffRecentLabel } from './riff-home-validation.ts';
import type { Project, SaveProjectInput } from '../../packages/contracts/index.ts';
import { createRiffWorkStateClient,parseRiffWorkState } from './riff-work-state-client.ts';
import {
  cloneStrictJsonObject,isBusinessResultFlagCoherent,parseStrictCallToolResult,strictObjectShape,
} from './call-tool-result-validation.ts';

type OpenAIFile = { fileId: string; fileName?: string; mimeType?: string };
type OpenAIHost = {
  selectFiles?: () => Promise<OpenAIFile[]>;
  uploadFile?: (file: File, options?: { library?: boolean }) => Promise<{ fileId: string }>;
  callTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  sendFollowUpMessage?: (input: { prompt: string; scrollToBottom?: boolean }) => Promise<unknown>;
};

declare global { interface Window { openai?: OpenAIHost } }

type BridgeOptions = {
  /** Host handshake deadline. Tool calls use their own, deliberately longer deadline. */
  timeoutMs?: number;
  toolTimeoutMs?: number;
  pollIntervalMs?: number;
  maxPollIntervalMs?: number;
  maxPolls?: number;
};

type SafeFailure = { code: string; recovery: string };
type CompleteSafeFailure=SafeFailure&{message:string;retryable:boolean};
const MCP_REQUEST_TIMEOUT = -32_001;
type ToolCallOutcome =
  | { status: 'response'; value: unknown; diagnostic: 'success' }
  | { status: 'application_error'; failure: CompleteSafeFailure; diagnostic: 'returned_error' | 'host_rejected_error' }
  | { status: 'timeout'; diagnostic: 'timeout' }
  | { status: 'transport_error'; diagnostic: 'transport_error' };

const active = (job: CreatorJobView) => job.state === 'queued' || job.state === 'running';
const uuid=/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;
const uuidKey=(value:string)=>value.toLowerCase();
const sameUuid=(left:string,right:string)=>uuidKey(left)===uuidKey(right);
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
function readJob(raw: unknown): CreatorJobView | undefined {
  const result=creatorJobStructuredOutput(raw);
  return result?.ok?result.data.job:undefined;
}

const failureCodes = new Set([
  'UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION_ERROR', 'NOT_FOUND',
  'VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'UNAVAILABLE',
]);
const recoveryKinds = new Set(['reauthorize', 'contact_support', 'correct_input', 'reload', 'retry_same_request']);
function readFailure(raw: unknown): CompleteSafeFailure | undefined {
  const envelope = parseStrictCallToolResult(raw);
  const result = strictObjectShape(envelope?.structuredContent, ['ok', 'error']);
  const error = strictObjectShape(result?.error, ['code', 'message', 'retryable', 'recovery']);
  if (!envelope || !result || result.ok !== false || !isBusinessResultFlagCoherent(envelope, false)
    || !error || typeof error.code !== 'string' || !failureCodes.has(error.code)
    || typeof error.recovery !== 'string' || !recoveryKinds.has(error.recovery)
    || typeof error.message !== 'string' || !error.message.trim() || error.message.length > 500
    || typeof error.retryable !== 'boolean') return undefined;
  return { code: error.code, message:error.message, retryable:error.retryable, recovery: error.recovery };
}

function failureMessage(failure: SafeFailure | undefined, fallback: string) {
  if (!failure) return fallback;
  const code = failure.code;
  if (code === 'UNAUTHENTICATED') return 'Reconnect Riff in ChatGPT, then try again.';
  if (code === 'FORBIDDEN') return 'Riff’s development access or trial allowance is not available for this account.';
  if (code === 'VALIDATION_ERROR') return 'Use a public TikTok video or creator-profile link.';
  if (code === 'UNAVAILABLE') return 'Riff could not complete that request. Try the same action again safely.';
  return fallback;
}

/** Unknown/malformed responses are ambiguous too: retaining the key is safer than duplicating work. */
function retainRequestId(failure: SafeFailure | undefined) {
  return !failure || failure.recovery === 'retry_same_request';
}

function rejectedFailure(error: unknown) {
  try {
    if (error === null || typeof error !== 'object') return;
    const descriptor = Object.getOwnPropertyDescriptor(error, 'data');
    if (!descriptor || !('value' in descriptor)) return;
    const data = cloneStrictJsonObject(descriptor.value); if (!data) return;
    const nested = strictObjectShape(data, ['result']);
    return readFailure(data) ?? readFailure(nested?.result);
  } catch { return; }
}

function creatorIntent(rawSource: string) {
  const trimmed = rawSource.trim();
  const sourceUrl = /^@[\w.]{1,100}$/.test(trimmed) ? `https://www.tiktok.com/${trimmed}` : trimmed;
  let parsed: URL | undefined;
  try { parsed = new URL(sourceUrl); } catch { /* An idea is not a URL. */ }
  return { trimmed, sourceUrl, parsed, key: parsed ? `url:${sourceUrl}` : `idea:${trimmed}` };
}

function pickLocalVideo(doc: Document): Promise<File | undefined> {
  return new Promise(resolve => {
    const input = doc.createElement('input'); input.type = 'file'; input.accept = 'video/*'; input.hidden = true;
    let settled = false;
    const finish = (file?: File) => { if (settled) return; settled = true; input.remove(); resolve(file); };
    input.addEventListener('change', () => finish(input.files?.[0]), { once: true });
    doc.body.append(input); input.click();
    window.addEventListener('focus', () => setTimeout(() => finish(input.files?.[0]), 250), { once: true });
  });
}

export function mountRiffHomeBridge(root: HTMLElement, options: BridgeOptions = {}) {
  const localPerformance = panelPerformanceFromDocument(root.ownerDocument, performance);
  const timeoutMs = options.timeoutMs ?? 10_000;
  const toolTimeoutMs = options.toolTimeoutMs ?? 45_000;
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  const maxPollIntervalMs = options.maxPollIntervalMs ?? 15_000;
  const maxPolls = options.maxPolls ?? 42;
  const app = new App({ name: 'riff-home', version: '1.1.0' }, { availableDisplayModes: ['fullscreen'] }, { autoResize: true });
  let connected = false;
  let disposed = false;
  let homeState: RiffHomeState = { status: 'loading' };
  let initialWorkLoadStarted = false;
  let workLoadEpoch = 0;
  let activeAccountId: string | undefined;
  let creatorRequest: { accountId: string | undefined; key: string; requestId: string } | undefined;
  let productSaveRequest: { accountId: string | undefined; key: string; input: SaveProjectInput } | undefined;
  let blockedProductIntentKey: string | undefined;
  let recommendationRequest: { key: string; requestId: string } | undefined;
  let actionEpoch = 0;
  const terminalWorkRefreshes = new Set<string>();
  const sourceByJob=new Map<string,string>();
  const selectedVariantByJob=new Map<string,string>();
  let activeWorkStateJobId:string|undefined;
  let catalogDeferred:{projectId?:string}|undefined;
  let controller!:ReturnType<typeof createCreatorPipelineController>;

  type DeadlineResult<T> = { status: 'resolved'; value: T } | { status: 'rejected'; reason: unknown } | { status: 'timeout' };
  const withDeadline = <T>(promise: Promise<T>, deadlineMs: number): Promise<DeadlineResult<T>> => new Promise(resolve => {
    let settled = false;
    const finish = (result: DeadlineResult<T>) => {
      if (settled) return;
      settled = true; clearTimeout(timer); resolve(result);
    };
    const timer = setTimeout(() => finish({ status: 'timeout' }), deadlineMs);
    promise.then(value => finish({ status: 'resolved', value }), reason => finish({ status: 'rejected', reason }));
  });

  const callToolUnmeasured = async (
    name: string,
    args: Record<string, unknown>,
    deadlineMs = toolTimeoutMs,
    interpretApplicationErrors = true,
  ): Promise<ToolCallOutcome> => {
    if (!connected) return { status: 'transport_error', diagnostic: 'transport_error' };
    try {
      let value: unknown;
      if (app.getHostCapabilities()?.serverTools) {
        value = await app.callServerTool({ name, arguments: args }, { timeout: deadlineMs, maxTotalTimeout: deadlineMs });
      } else if (window.openai?.callTool) {
        const outcome = await withDeadline(window.openai.callTool(name, args), deadlineMs);
        if (outcome.status === 'timeout') return { status: 'timeout', diagnostic: 'timeout' };
        if (outcome.status === 'rejected') {
          if (!interpretApplicationErrors) return { status: 'transport_error', diagnostic: 'transport_error' };
          const failure = rejectedFailure(outcome.reason);
          return failure
            ? { status: 'application_error', failure, diagnostic: 'host_rejected_error' }
            : { status: 'transport_error', diagnostic: 'transport_error' };
        }
        value = outcome.value;
      }
      if (value === undefined) return { status: 'transport_error', diagnostic: 'transport_error' };
      const failure = interpretApplicationErrors ? readFailure(value) : undefined;
      return failure
        ? { status: 'application_error', failure, diagnostic: 'returned_error' }
        : { status: 'response', value, diagnostic: 'success' };
    } catch (error) {
      if (!interpretApplicationErrors) return object(error)?.code === MCP_REQUEST_TIMEOUT
        ? { status: 'timeout', diagnostic: 'timeout' }
        : { status: 'transport_error', diagnostic: 'transport_error' };
      const failure = rejectedFailure(error);
      if (failure) return { status: 'application_error', failure, diagnostic: 'host_rejected_error' };
      return object(error)?.code === MCP_REQUEST_TIMEOUT
        ? { status: 'timeout', diagnostic: 'timeout' }
        : { status: 'transport_error', diagnostic: 'transport_error' };
    }
  };
  const callTool = async (
    name: string,
    args: Record<string, unknown>,
    deadlineMs = toolTimeoutMs,
    interpretApplicationErrors = true,
  ): Promise<ToolCallOutcome> => {
    const finish = localPerformance.start('tool_call');
    const outcome = await callToolUnmeasured(name, args, deadlineMs, interpretApplicationErrors);
    finish(outcome.status === 'timeout' ? 'timeout' : outcome.status === 'response' ? 'ok' : 'error');
    return outcome;
  };
  const callProductTool = (name: 'save_project' | 'get_project', args: Record<string, unknown>) =>
    callTool(name, args, toolTimeoutMs, false);

  const send = async (prompt: string) => {
    if (!connected) return {
      status: 'unsupported' as const,
      message: 'Continue in the ChatGPT composer with this request.',
    };
    try {
      let request: Promise<unknown>;
      const params: OpenAIMessageParams = {
        role: 'user' as const, content: [{ type: 'text' as const, text: prompt }],
        _meta: { 'openai/message': { target: 'active' as const, send: true as const } },
      };
      // ChatGPT can advertise its active-conversation extension independently
      // of the generic MCP Apps message capability. Prefer that exact surface;
      // the window alias remains a compatibility fallback for older hosts.
      const capabilities = app.getHostCapabilities();
      if (capabilities?.experimental?.['openai/message'] != null || capabilities?.message?.text) {
        request = app.sendMessage(params as Parameters<typeof app.sendMessage>[0]);
      }
      else if (window.openai?.sendFollowUpMessage) {
        request = window.openai.sendFollowUpMessage({ prompt, scrollToBottom: false });
      } else return {
        status: 'unsupported' as const, message: 'Continue in the ChatGPT composer with this request.',
      };
      // A host can keep ui/message open for the full model turn. Wait briefly
      // for acceptance/rejection, then report a truthful pending state.
      const outcome = await withDeadline(request, Math.min(toolTimeoutMs, 750));
      if (outcome.status === 'rejected') return {
        status: 'failed' as const, message: 'The ChatGPT handoff failed. Continue in the composer.',
      };
      if (outcome.status === 'timeout') return {
        status: 'pending' as const,
        message: 'Sending this request to ChatGPT. If it does not appear, continue in the composer.',
      };
      if (object(outcome.value)?.isError === true) return {
        status: 'failed' as const, message: 'ChatGPT did not accept that request. Continue in the composer.',
      };
      return { status: 'sent' as const, message: 'Sent to this ChatGPT conversation.' };
    } catch {
      return { status: 'failed' as const, message: 'The ChatGPT handoff failed. Continue in the composer.' };
    }
  };

  type StartReconciliation =
    | { status: 'found'; job: CreatorJobView }
    | { status: 'absent' }
    | { status: 'application_error'; failure: SafeFailure }
    | { status: 'ambiguous' };
  const reconcileStart = async (input: { request_id: string; source_url: string }): Promise<StartReconciliation> => {
    const lookupDeadlineMs = Math.min(toolTimeoutMs, 2_000);
    for (let attempt = 0; attempt < 2; attempt++) {
      const outcome = await callTool('get_riff_creator_start', input, lookupDeadlineMs);
      if (outcome.status === 'response') {
        const job = readJob(outcome.value);
        if (job) return { status: 'found', job };
      } else if (outcome.status === 'application_error') {
        if (outcome.failure.code === 'NOT_FOUND') return { status: 'absent' };
        if (outcome.failure.code !== 'UNAVAILABLE') return { status: 'application_error', failure: outcome.failure };
      }
      if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 150));
    }
    return { status: 'ambiguous' };
  };

  const workStateClient=createRiffWorkStateClient<CreatorJobView>(async input=>{
    const outcome=await callTool('set_riff_work_state',input,toolTimeoutMs,false);
    if(outcome.status==='response')return outcome.value;
    throw new Error('Ambiguous work-state write');
  },async jobId=>{
    const outcome=await callTool('get_creator_job',{job_id:jobId});
    return outcome.status==='response'?readJob(outcome.value):undefined;
  });

  let view!:ReturnType<typeof mountRiffHome>;
  const catalogLoader=createRiffVideoCatalogLoader(async args=>{
    const outcome=await callTool('list_riff_videos',args);
    return outcome.status==='response'?outcome.value:undefined;
  },state=>view.setCatalogState(state));
  view = mountRiffHome(root, {
    inputChanged(rawSource) {
      if (creatorRequest && creatorRequest.key !== creatorIntent(rawSource).key) {
        actionEpoch++;
        creatorRequest = undefined;
      }
      productSaveRequest = undefined;
      blockedProductIntentKey = undefined;
    },
    async saveProduct(context: { draft: ProductDraft; project: Project | null }) {
      const accountId = activeAccountId;
      const intentKey = JSON.stringify({
        accountId,
        projectId: context.project?.id ?? null,
        expectedVersion: context.project?.current_version ?? 0,
        draft: context.draft,
      });
      if (blockedProductIntentKey === intentKey) return {
        status: 'failed',
        message: productFailureMessage('IDEMPOTENCY_CONFLICT'),
      };
      if (productSaveRequest?.accountId !== accountId || productSaveRequest?.key !== intentKey) {
        const validation = validateProductDraft(context.draft, context.project, crypto.randomUUID());
        if (!validation.ok) return { status: 'failed', message: 'Review the highlighted product brief fields, then confirm again.' };
        productSaveRequest = { accountId, key: intentKey, input: validation.input };
      }
      const pending = productSaveRequest;
      const epoch = ++actionEpoch;
      const outcome = await callProductTool('save_project', pending.input);
      if (disposed || epoch !== actionEpoch || activeAccountId !== accountId) return {
        status: 'failed', message: 'A newer Riff account or action is already shown.',
      };
      let failure: SafeFailure | undefined;
      if (outcome.status === 'response') {
        const parsed = parseProductSaveResult(outcome.value, pending.input);
        if (parsed.status === 'saved') {
          if (productSaveRequest === pending) productSaveRequest = undefined;
          blockedProductIntentKey = undefined;
          return parsed;
        }
        if (parsed.status === 'failure') {
          failure = parsed.failure;
        } else {
          return { status: 'failed', message: productFailureMessage('MALFORMED') };
        }
      } else {
        return { status: 'failed', message: productFailureMessage('MALFORMED') };
      }
      if ((failure.code === 'VERSION_CONFLICT' || failure.code === 'NOT_FOUND') && context.project) {
        if (productSaveRequest === pending) productSaveRequest = undefined;
        const trustedProjectId = context.project.id;
        const reread = await callProductTool('get_project', { project_id: trustedProjectId });
        if (disposed || epoch !== actionEpoch || activeAccountId !== accountId) return {
          status: 'failed', message: 'A newer Riff account or action is already shown.',
        };
        if (reread.status === 'response') {
          const parsed = parseProductGetResult(reread.value, trustedProjectId);
          if (parsed.status === 'loaded') return {
            status: 'conflict', latest: parsed.project, message: productFailureMessage(failure.code),
          };
          if (parsed.status === 'failure') return { status: 'failed', message: productFailureMessage(parsed.failure.code) };
        }
        return { status: 'failed', message: productFailureMessage(failure.code) };
      }
      if (failure.code === 'IDEMPOTENCY_CONFLICT') {
        if (productSaveRequest === pending) productSaveRequest = undefined;
        blockedProductIntentKey = intentKey;
      } else if (!retainRequestId(failure) && productSaveRequest === pending) {
        productSaveRequest = undefined;
      }
      return { status: 'failed', message: productFailureMessage(failure.code) };
    },
    discoverProduct(project) {
      actionEpoch++;
      return send('Continue from this saved Riff product brief. It is user-confirmed project context, not provider research or Creator DNA. No Creator DNA is available for this project, so do not start provider work, invent references, or claim formats were discovered. Keep these fields editable and ask only for the missing context or a user-supplied creator video/profile before proposing the next supported step: ' + JSON.stringify(project));
    },
    async start(rawSource) {
      const epoch = ++actionEpoch;
      productSaveRequest = undefined;
      blockedProductIntentKey = undefined;
      const { trimmed, sourceUrl, parsed, key: intentKey } = creatorIntent(rawSource);
      if (creatorRequest?.accountId !== activeAccountId) creatorRequest = undefined;
      if (creatorRequest && creatorRequest.key !== intentKey) creatorRequest = undefined;
      if (!parsed || creatorRequest?.key !== intentKey) recommendationRequest = undefined;
      if (!parsed) return send(`Use Riff to develop my next creator-video idea. My idea is: ${JSON.stringify(trimmed)}. Start by clarifying only the missing context, then help me find an evidence-grounded direction without claiming provider research has run.`);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
      if (parsed.protocol !== 'https:') return { status: 'failed', message: 'Use a public HTTPS link, or describe the idea without a URL.' };
      if (!['tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'].includes(host)) return send(
        `Use Riff to start from this user-supplied link: ${parsed.href}. Determine whether it is a creator profile, video, product, or reference. The currently connected direct provider path supports public TikTok only, so explain any limitation plainly and collect the minimum context needed without claiming analysis has run.`,
      );
      if (!creatorRequest || creatorRequest.key !== intentKey) {
        creatorRequest = { accountId: activeAccountId, key: intentKey, requestId: crypto.randomUUID() };
      }
      const pendingRequest = creatorRequest;
      const exactInput = { request_id: pendingRequest.requestId, source_url: sourceUrl };
      const outcome = await callTool('start_riff_creator', exactInput);
      if (epoch !== actionEpoch) return { status: 'pending', message: 'A newer Riff action is already shown.' };
      if (outcome.status === 'application_error') {
        if (!retainRequestId(outcome.failure) && creatorRequest === pendingRequest) creatorRequest = undefined;
        return { status: 'failed', message: failureMessage(outcome.failure,
          'Riff could not confirm a valid saved job. Try this same link again safely.') };
      }
      const job = outcome.status === 'response' ? readJob(outcome.value) : undefined;
      if (!job) {
        const reconciled = await reconcileStart(exactInput);
        if (epoch !== actionEpoch) return { status: 'pending', message: 'A newer Riff action is already shown.' };
        if (reconciled.status === 'found') {
          if (creatorRequest === pendingRequest) creatorRequest = undefined;
          observe(reconciled.job,sourceUrl);view.acknowledgeStart(rawSource);if (active(reconciled.job)) void loadWork();
          return { status: 'sent', message: 'Analysis started. Riff recovered the saved job here.' };
        }
        if (reconciled.status === 'application_error') {
          if (!retainRequestId(reconciled.failure) && creatorRequest === pendingRequest) creatorRequest = undefined;
          return { status: 'failed', message: failureMessage(reconciled.failure,
            'Riff could not confirm whether this analysis was saved. Try the same link again safely.') };
        }
        if (reconciled.status === 'absent') return {
          status: 'failed',
          message: 'Riff did not save this analysis. The link is still here; try it again to reuse the same request safely.',
        };
        return { status: 'failed', message: 'Riff could not confirm whether this analysis started. Try the same link again safely.' };
      }
      if (creatorRequest === pendingRequest) creatorRequest = undefined;
      observe(job,sourceUrl);view.acknowledgeStart(rawSource);if (active(job)) void loadWork();
      return { status: 'sent', message: 'Analysis started. Riff will update this saved job here.' };
    },
    send,
    accountSettings: () => send('Open my Riff account settings in ChatGPT. Do not claim a setting changed until the host confirms it.'),
    support: () => send('I need support with Riff. Help me describe the issue and show the available support handoff.'),
    feedback: () => send('I want to give feedback about Riff. Help me send it through the available ChatGPT handoff.'),
    requestTheme: () => send('Open ChatGPT appearance settings. Riff follows the host theme and cannot change ChatGPT’s theme itself.'),
    async upload() {
      actionEpoch++;
      const host = window.openai;
      try {
        let selected: OpenAIFile | undefined;
        if (host?.selectFiles) selected = (await host.selectFiles()).find(file => !file.mimeType || file.mimeType.startsWith('video/'));
        else if (host?.uploadFile) {
          const file = await pickLocalVideo(root.ownerDocument);
          if (!file) return { status: 'unsupported', message: 'No video was selected.' };
          const uploaded = await host.uploadFile(file, { library: true });
          selected = { ...uploaded, fileName: file.name, mimeType: file.type };
        }
        if (!selected) return send('I want to analyze a video with Riff. Help me attach it in this ChatGPT conversation. Do not claim it was uploaded or analyzed until the host confirms the file.');
        const label = selected.fileName?.trim() || 'selected video';
        return send(`I selected “${label}” in ChatGPT for Riff. Help me analyze this video. If Riff cannot yet pass the selected file to its analysis tools, say so plainly and ask me for a public TikTok link; do not claim the file was processed.`);
      } catch { return { status: 'failed', message: 'The file picker could not complete. Attach the video in ChatGPT instead.' }; }
    },
    showWelcome: () => { actionEpoch++; return send('Show me the Riff welcome guide in this ChatGPT conversation. Keep the introduction in chat, then leave Riff Home open on the right.'); },
    async openRecent(jobId,variantId) {
      const epoch = ++actionEpoch;
      const outcome = await callTool('get_creator_job', { job_id: jobId });
      if (epoch !== actionEpoch) return { status: 'pending', message: 'A newer Riff action is already shown.' };
      if (outcome.status === 'application_error') return {
        status: 'failed', message: failureMessage(outcome.failure, 'That saved Riff job could not be opened.'),
      };
      if (outcome.status !== 'response') return { status: 'failed', message: 'Riff could not confirm the latest saved state. Try again.' };
      const job = readJob(outcome.value);
      if (!job) return { status: 'failed', message: 'That saved Riff job could not be opened.' };
      if(variantId)selectedVariantByJob.set(uuidKey(jobId),variantId);else selectedVariantByJob.delete(uuidKey(jobId));
      controller.reset();observe(job);return { status: 'sent', message: 'Saved Riff work opened.' };
    },
    refreshRecents: () => loadWork(),
    async refreshJob(savedJob) {
      actionEpoch++;await controller.refresh();
      return {status:'sent',message:active(savedJob)?'Saved job refreshed. Work is still in progress.':'Saved job refreshed.'};
    },
    async startRecommendations({ dna }) {
      const epoch = ++actionEpoch;
      const intentKey = `${dna.dna_id}:${dna.version}`;
      if (!recommendationRequest || recommendationRequest.key !== intentKey) {
        recommendationRequest = { key: intentKey, requestId: crypto.randomUUID() };
      }
      const pendingRequest = recommendationRequest;
      const outcome = await callTool('start_creator_recommendations', {
        dna_id: dna.dna_id, expected_version: dna.version, request_id: pendingRequest.requestId,
      });
      if (epoch !== actionEpoch) return { status: 'pending', message: 'A newer Riff action is already shown.' };
      if (outcome.status === 'application_error') {
        if (!retainRequestId(outcome.failure) && recommendationRequest === pendingRequest) recommendationRequest = undefined;
        return { status: 'failed', message: failureMessage(outcome.failure,
          'Riff could not confirm a valid discovery job. Try this same analysis again safely.') };
      }
      if (outcome.status !== 'response') return {
        status: 'failed',
        message: 'Riff could not confirm whether discovery started. Try this same analysis again safely.',
      };
      const job = readJob(outcome.value);
      if (!job) {
        return { status: 'failed', message: 'Riff could not confirm a valid discovery job. Try this same analysis again safely.' };
      }
      if (recommendationRequest === pendingRequest) recommendationRequest = undefined;
      observe(job);if (active(job)) void loadWork();
      return { status: 'sent', message: 'Discovery started. Riff will update this saved job here.' };
    },
    makeMine: ({ library, intent }) => {
      actionEpoch++;
      if (library !== 'videos') return send(intent);
      return send(`${intent} Create two or three evidence-grounded filming variants with timed hook, main-content, and CTA sections, concrete filming directions, a platform caption, and hashtags. Save them in Studio only if Riff confirms the write; otherwise show them in chat and say they are not saved.`);
    },
    onDiscoveryOpen:({projectId}={})=>void loadCatalog(projectId),
    proposeCatalogReference:proposal=>send(riffCatalogProposalHandoff(proposal)),
    retryCatalog:()=>void catalogLoader.retry(),
    async setVariantState({job,variant,state}){
      const result=await workStateClient.set(job,variant.id,state);
      if(result.status!=='confirmed'&&result.status!=='conflict')return result;
      selectedVariantByJob.set(uuidKey(result.job.id),variant.id);
      const refreshed=await loadWork();
      controller.reset();observe(result.job);
      return refreshed.status==='failed'?{...result,message:`${result.message} Recent work could not be refreshed.`}:result;
    },
  });
  const render = (state: RiffHomeState) => { const finish = localPerformance.start('panel_render'); view.render(state); finish('ok'); };
  render(homeState);

  const controllerTool=async(name:'get_creator_job_status'|'get_creator_job',input:{job_id:string},signal:AbortSignal)=>{
    if(!connected)throw new Error('Disconnected');
    if(app.getHostCapabilities()?.serverTools)return app.callServerTool({name,arguments:input},{signal,timeout:toolTimeoutMs,maxTotalTimeout:toolTimeoutMs});
    if(!window.openai?.callTool)throw new Error('Read tools unavailable');
    return Promise.race([window.openai.callTool(name,input),new Promise<never>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('Cancelled')),{once:true}))]);
  };
  controller=createCreatorPipelineController({
    loading(){view.setBusy('Loading your saved creator job…');},
    job(snapshot){
      const snapshotKey=uuidKey(snapshot.job.id);
      if(activeWorkStateJobId&&activeWorkStateJobId!==snapshotKey){
        workStateClient.invalidate();
        const selected=selectedVariantByJob.get(snapshotKey);selectedVariantByJob.clear();
        if(selected)selectedVariantByJob.set(snapshotKey,selected);
      }
      activeWorkStateJobId=snapshotKey;
      const source=sourceByJob.get(snapshot.job.id);
      const latestVariant=[...snapshot.job.work_states].sort((left,right)=>
        right.updated_at.localeCompare(left.updated_at)||right.version-left.version||left.variant_id.localeCompare(right.variant_id))[0]?.variant_id;
      view.showJob(snapshot.job,{...(snapshot.status?{status:snapshot.status}:{}),...(source?{sourceUrl:source}:{}),
        ...((selectedVariantByJob.get(snapshotKey)??latestVariant)?{variantId:selectedVariantByJob.get(snapshotKey)??latestVariant}:{})});
      const observedState=snapshot.status?.state??snapshot.job.state;
      if(snapshot.status?.progress.kind==='scan'&&snapshot.status.progress.videos.length||observedState!=='queued'&&observedState!=='running')sourceByJob.delete(snapshot.job.id);
      if(observedState!=='queued'&&observedState!=='running')refreshTerminalWork(snapshot.job,observedState,snapshot.status?.revision);
    },
    notice(message){view.setWorkflowNotice(message);},
    cleared(reason){
      const messages={reauthorize:'Reconnect Riff in ChatGPT, then reopen this saved work.',unavailable:'This saved Riff work is unavailable.',invalid:'Riff returned mismatched saved work. Reopen it from ChatGPT.',connection:'Riff lost the saved-work connection. Reopen it from ChatGPT.'} as const;
      if(reason==='reauthorize')view.clearPrivate();else view.showHome();view.setBusy(messages[reason]);
    },
  },{
    readStatus:async(input,signal)=>creatorJobStatusStructuredOutput(await controllerTool('get_creator_job_status',input,signal)),
    readFull:async(input,signal)=>creatorJobStructuredOutput(await controllerTool('get_creator_job',input,signal)),
  },{timeoutMs:Math.min(toolTimeoutMs,10_000),pollIntervalMs,maxPollIntervalMs,maxPolls,pollWindowMs:600_000,performance:localPerformance});
  controller.reset();

  function observe(job:CreatorJobView,submittedUrl?:string){
    if(/^https:\/\/www\.tiktok\.com\/@[\w.]+\/video\/\d{1,30}$/.test(submittedUrl??''))sourceByJob.set(job.id,submittedUrl!);
    controller.receiveInput({job_id:job.id});controller.receiveResult({ok:true,data:{job}});
  }

  async function loadCatalog(projectId?:string){
    if(disposed)return;
    const deferred={...(projectId?{projectId}:{})};
    if(!connected){catalogDeferred=deferred;return;}
    const accountId=activeAccountId;
    if(!accountId){catalogDeferred=deferred;return;}
    catalogDeferred=undefined;
    await catalogLoader.load({ownerKey:accountId,...(projectId?{projectId}:{})});
  }

  function refreshTerminalWork(job: CreatorJobView,state=job.state,revision=job.revision) {
    if (state==='queued'||state==='running') return;
    const key = `${job.id}:${revision}:${state}`;
    if (terminalWorkRefreshes.has(key)) return;
    terminalWorkRefreshes.add(key); void loadWork();
  }

  async function loadWork(): Promise<{ status: 'sent' | 'failed'; message: string }> {
    if (disposed || !connected) {
      view.setRecentsState({ status: 'error', message: 'Reconnect Riff in ChatGPT, then try again.' });
      return { status: 'failed', message: 'Reconnect Riff in ChatGPT, then try again.' };
    }
    const epoch = ++workLoadEpoch;
    view.setRecentsState({ status: 'loading' });
    const outcome = await callTool('list_riff_work', { limit: 4 });
    if (disposed || epoch !== workLoadEpoch) return { status: 'sent', message: 'A newer recent-work refresh is already shown.' };
    if (outcome.status === 'application_error') {
      view.setRecentsState({ status: 'error', message: failureMessage(outcome.failure, 'Recent work is temporarily unavailable.') });
      return { status: 'failed', message: 'Recent work could not be refreshed. Try again.' };
    }
    if (outcome.status !== 'response') {
      view.setRecentsState({ status: 'error', message: 'Recent work is temporarily unavailable. Your saved jobs were not changed.' });
      return { status: 'failed', message: 'Recent work could not be refreshed. Try again.' };
    }
    const envelope = parseStrictCallToolResult(outcome.value);
    const result = envelope?.structuredContent; const data = object(result?.data);
    if (!envelope || result?.ok !== true || !isBusinessResultFlagCoherent(envelope, true)
      || !Array.isArray(data?.work) || data.work.length > 20) {
      view.setRecentsState({ status: 'error', message: 'Recent work is temporarily unavailable.' });
      return { status: 'failed', message: 'Recent work could not be refreshed. Try again.' };
    }
    const items = data.work.flatMap(item => {
      const work = object(item); const source = object(work?.source);
      if (!work || typeof work.job_id !== 'string' || !uuid.test(work.job_id)
        || typeof work.project_name !== 'string' || !work.project_name.trim() || work.project_name.length > 120
        || typeof work.updated_at !== 'string' || Number.isNaN(Date.parse(work.updated_at))
        || !['scan', 'recommendations', 'scripts'].includes(String(work.kind))
        || !['queued', 'running', 'succeeded', 'failed', 'needs_reconciliation'].includes(String(work.state))
        || source?.platform !== 'tiktok' || typeof source.handle !== 'string' || !/^[\w.]{1,100}$/.test(source.handle)) return [];
      const parsedWorkState=work.work_state===null||work.work_state===undefined?null:parseRiffWorkState(work.work_state);
      if(work.work_state!==null&&work.work_state!==undefined&&!parsedWorkState)return [];
      const variantId=work.variant_id===null||work.variant_id===undefined?null:typeof work.variant_id==='string'&&uuid.test(work.variant_id)?work.variant_id:undefined;
      if(variantId===undefined)return [];
      if((variantId===null)!==(parsedWorkState===null)||parsedWorkState&&
        (!sameUuid(parsedWorkState.job_id,work.job_id)||!sameUuid(parsedWorkState.variant_id,variantId!)))return [];
      return [{ job_id: work.job_id, title: work.project_name, updated_at: work.updated_at,
        stage:riffRecentLabel(work.kind as CreatorJobView['kind'],work.state as CreatorJobView['state'],parsedWorkState?.state??null),
        state: work.state as CreatorJobView['state'], platform: 'tiktok' as const, handle: source.handle,
        variant_id:variantId,work_state:parsedWorkState,
      }];
    });
    view.setRecents(items);
    return { status: 'sent', message: items.length ? 'Recent work refreshed.' : 'No recent work yet.' };
  }

  const ensureInitialWork = () => {
    if (!connected || disposed || initialWorkLoadStarted) return;
    initialWorkLoadStarted = true; void loadWork();
  };

  const invalidateAccountBoundary = () => {
    if (disposed) return;
    actionEpoch++;
    creatorRequest = undefined;
    productSaveRequest = undefined;
    blockedProductIntentKey = undefined;
    recommendationRequest = undefined;
    workLoadEpoch++;
    controller.reset();sourceByJob.clear();catalogDeferred=undefined;catalogLoader.reset();
    workStateClient.invalidate();selectedVariantByJob.clear();
    terminalWorkRefreshes.clear();
    initialWorkLoadStarted = false;
    view.clearPrivate();
  };

  const applyContext = (context: McpUiHostContext | undefined) => {
    if (context?.theme) applyDocumentTheme(context.theme);
    if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
    if (context?.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
    if (context?.locale) document.documentElement.lang = context.locale;
    const insets = context?.safeAreaInsets;
    if (insets) for (const [name, value] of Object.entries(insets)) {
      if (Number.isFinite(value)) document.documentElement.style.setProperty(`--riff-safe-${name}`, `${Math.max(0, value)}px`);
    }
  };
  const handshake = new AbortController();
  const timer = setTimeout(() => {
    if (!connected && !disposed) render({ status: 'error', message: 'Riff Home could not connect. Reopen it from ChatGPT.' });
  }, timeoutMs);
  function dispose() {
    if (disposed) return;
    disposed = true; connected = false;controller.dispose();workStateClient.invalidate();clearTimeout(timer); handshake.abort(); view.dispose();
    window.removeEventListener('pagehide', dispose);
    root.ownerDocument.removeEventListener('visibilitychange',visibilityChanged);
    app.ontoolresult = undefined; app.ontoolcancelled = undefined; app.onhostcontextchanged = undefined;
    void app.close();
  }
  app.ontoolresult = (params) => {
    const nextState = riffHomeStructuredOutput(params.structuredContent);
    const nextAccountId = nextState.status === 'ready' ? nextState.account.id : undefined;
    const pendingAccountChanged = (creatorRequest !== undefined && creatorRequest.accountId !== nextAccountId)
      || (productSaveRequest !== undefined && productSaveRequest.accountId !== nextAccountId);
    if (pendingAccountChanged || (activeAccountId !== undefined && activeAccountId !== nextAccountId)) {
      invalidateAccountBoundary();
    }
    activeAccountId = nextAccountId;
    homeState = nextState; render(homeState);
    if (catalogDeferred && activeAccountId) void loadCatalog(catalogDeferred.projectId);
    ensureInitialWork();
  };
  app.ontoolcancelled = () => render({ status: 'error', message: 'Riff Home was cancelled. Reopen it from ChatGPT.' });
  app.onhostcontextchanged = applyContext;
  app.onteardown = async () => { setTimeout(dispose, 0); return {}; };
  app.onclose = () => {
    connected = false;
    activeAccountId = undefined;
    invalidateAccountBoundary();
  };
  window.addEventListener('pagehide', dispose, { once: true });
  const visibilityChanged=()=>controller.visibilityChanged(root.ownerDocument.hidden);
  root.ownerDocument.addEventListener('visibilitychange',visibilityChanged);
  if (window.parent === window) {
    clearTimeout(timer); render({ status: 'error', message: 'Preview mode. Open Riff from ChatGPT to connect your account.' });
  } else {
    void app.connect(new PostMessageTransport(window.parent, window.parent), {
      signal: handshake.signal, timeout: timeoutMs, maxTotalTimeout: timeoutMs,
    }).then(() => {
      if (disposed) return;
      connected = true; clearTimeout(timer); applyContext(app.getHostContext());
      controller.connected(!!app.getHostCapabilities()?.serverTools||!!window.openai?.callTool);
      if (catalogDeferred && activeAccountId) void loadCatalog(catalogDeferred.projectId);
      ensureInitialWork();
    }).catch(() => { if (!disposed) render({ status: 'error', message: 'Riff Home could not connect. Reopen it from ChatGPT.' }); });
  }
  return { dispose };
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('root');
  if (root) mountRiffHomeBridge(root);
}
