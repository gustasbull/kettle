import {
  App, PostMessageTransport, applyDocumentTheme, applyHostFonts, applyHostStyleVariables,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps/app-with-deps';
import type { CreatorJobView } from '../../packages/contracts/creator-pipeline.ts';
import { Failure } from '../../packages/contracts/index.ts';
import { mountRiffHome, riffHomeStructuredOutput, type RiffHomeState } from './riff-home/index.ts';

type OpenAIFile = { fileId: string; fileName?: string; mimeType?: string };
type OpenAIHost = {
  selectFiles?: () => Promise<OpenAIFile[]>;
  uploadFile?: (file: File, options?: { library?: boolean }) => Promise<{ fileId: string }>;
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

type ToolCallOutcome =
  | { status: 'response'; value: unknown }
  | { status: 'ambiguous' };

const active = (job: CreatorJobView) => job.state === 'queued' || job.state === 'running';
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const envelope = (raw: unknown) => {
  const outer = object(raw);
  return object(outer?.structuredContent) ?? outer;
};

function readJob(raw: unknown): CreatorJobView | undefined {
  const result = envelope(raw); const data = object(result?.data); const job = object(data?.job);
  if (result?.ok !== true || !job || typeof job.id !== 'string' || typeof job.project_id !== 'string'
    || typeof job.revision !== 'number' || !['scan', 'recommendations', 'scripts'].includes(String(job.kind))
    || !['queued', 'running', 'succeeded', 'failed', 'needs_reconciliation'].includes(String(job.state))
    || typeof job.created_at !== 'string' || typeof job.updated_at !== 'string') return undefined;
  if (job.state === 'succeeded' ? !object(job.result) : job.result !== null) return undefined;
  return job as CreatorJobView;
}

function failureMessage(raw: unknown, fallback: string) {
  const parsed = Failure.safeParse(envelope(raw));
  if (!parsed.success) return fallback;
  const code = parsed.data.error.code;
  if (code === 'UNAUTHENTICATED') return 'Reconnect Riff in ChatGPT, then try again.';
  if (code === 'FORBIDDEN') return 'Riff’s development access or trial allowance is not available for this account.';
  if (code === 'VALIDATION_ERROR') return 'Use a public TikTok video or creator-profile link.';
  if (code === 'UNAVAILABLE') return 'Riff could not complete that request. Try the same action again safely.';
  return fallback;
}

/** Unknown/malformed responses are ambiguous too: retaining the key is safer than duplicating work. */
function retainRequestId(raw: unknown) {
  const parsed = Failure.safeParse(envelope(raw));
  return !parsed.success || parsed.data.error.recovery === 'retry_same_request';
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
  const timeoutMs = options.timeoutMs ?? 10_000;
  const toolTimeoutMs = options.toolTimeoutMs ?? 45_000;
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  const maxPollIntervalMs = options.maxPollIntervalMs ?? 15_000;
  // With the defaults, bounded polling spans more than the provider's 540-second SLA.
  const maxPolls = options.maxPolls ?? 42;
  const app = new App({ name: 'riff-home', version: '1.1.0' }, { availableDisplayModes: ['fullscreen'] }, { autoResize: true });
  let connected = false;
  let disposed = false;
  let homeState: RiffHomeState = { status: 'loading' };
  let initialWorkLoadStarted = false;
  let workLoadEpoch = 0;
  let pollEpoch = 0;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let creatorRequest: { key: string; requestId: string } | undefined;
  let recommendationRequest: { key: string; requestId: string } | undefined;
  const terminalWorkRefreshes = new Set<string>();

  const callTool = async (name: string, args: Record<string, unknown>): Promise<ToolCallOutcome> => {
    if (!connected || !app.getHostCapabilities()?.serverTools) return { status: 'ambiguous' };
    try {
      const value = await app.callServerTool({ name, arguments: args }, {
        timeout: toolTimeoutMs, maxTotalTimeout: toolTimeoutMs,
      });
      return { status: 'response', value };
    } catch { return { status: 'ambiguous' }; }
  };

  const send = async (prompt: string) => {
    if (!connected || !app.getHostCapabilities()?.message?.text) return {
      status: 'unsupported' as const,
      message: 'Continue in the ChatGPT composer with this request.',
    };
    try {
      const params = {
        role: 'user' as const, content: [{ type: 'text' as const, text: prompt }],
        _meta: { 'openai/message': { target: 'active', send: true } },
      };
      const result = await app.sendMessage(params);
      return result.isError
        ? { status: 'failed' as const, message: 'ChatGPT did not accept that request. Continue in the composer.' }
        : { status: 'sent' as const, message: 'Sent to this ChatGPT conversation.' };
    } catch {
      return { status: 'failed' as const, message: 'The ChatGPT handoff failed. Continue in the composer.' };
    }
  };

  const view = mountRiffHome(root, {
    async start(rawSource) {
      const trimmed = rawSource.trim();
      const sourceUrl = /^@[\w.]{1,100}$/.test(trimmed) ? `https://www.tiktok.com/${trimmed}` : trimmed;
      let parsed: URL | undefined;
      try { parsed = new URL(sourceUrl); } catch { /* An idea is not a URL. */ }
      const intentKey = parsed ? `url:${parsed.href}` : `idea:${trimmed}`;
      if (creatorRequest && creatorRequest.key !== intentKey) creatorRequest = undefined;
      if (!parsed || creatorRequest?.key !== intentKey) recommendationRequest = undefined;
      if (!parsed) return send(`Use Riff to develop my next creator-video idea. My idea is: ${JSON.stringify(trimmed)}. Start by clarifying only the missing context, then help me find an evidence-grounded direction without claiming provider research has run.`);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
      if (parsed.protocol !== 'https:') return { status: 'failed', message: 'Use a public HTTPS link, or describe the idea without a URL.' };
      if (!['tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'].includes(host)) return send(
        `Use Riff to start from this user-supplied link: ${parsed.href}. Determine whether it is a creator profile, video, product, or reference. The currently connected direct provider path supports public TikTok only, so explain any limitation plainly and collect the minimum context needed without claiming analysis has run.`,
      );
      if (!creatorRequest || creatorRequest.key !== intentKey) {
        creatorRequest = { key: intentKey, requestId: crypto.randomUUID() };
      }
      const pendingRequest = creatorRequest;
      const outcome = await callTool('start_riff_creator', { request_id: pendingRequest.requestId, source_url: sourceUrl });
      if (outcome.status === 'ambiguous') return {
        status: 'failed',
        message: 'Riff could not confirm whether this analysis started. Try the same link again safely.',
      };
      const job = readJob(outcome.value);
      if (!job) {
        if (!retainRequestId(outcome.value)) creatorRequest = undefined;
        return { status: 'failed', message: failureMessage(outcome.value, 'Riff could not confirm a valid saved job. Try this same link again safely.') };
      }
      creatorRequest = undefined;
      view.showJob(job); observe(job); if (active(job)) void loadWork();
      return { status: 'sent', message: 'Analysis started. Riff will update this saved job here.' };
    },
    send,
    async upload() {
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
        return send(`I selected the ChatGPT video file “${label}” (file ID ${selected.fileId}) for Riff. Help me analyze it. If Riff cannot yet pass this file to its analysis tools, say so plainly and ask me for a public TikTok link; do not claim the file was processed.`);
      } catch { return { status: 'failed', message: 'The file picker could not complete. Attach the video in ChatGPT instead.' }; }
    },
    showWelcome: () => send('Show me the Riff welcome guide in this ChatGPT conversation. Keep the introduction in chat, then leave Riff Home open on the right.'),
    async openRecent(jobId) {
      const outcome = await callTool('get_creator_job', { job_id: jobId });
      if (outcome.status === 'ambiguous') return { status: 'failed', message: 'Riff could not confirm the latest saved state. Try again.' };
      const job = readJob(outcome.value);
      if (!job) return { status: 'failed', message: failureMessage(outcome.value, 'That saved Riff job could not be opened.') };
      view.showJob(job); observe(job); return { status: 'sent', message: 'Saved Riff work opened.' };
    },
    refreshRecents: () => loadWork(),
    async refreshJob(savedJob) {
      const outcome = await callTool('get_creator_job', { job_id: savedJob.id });
      if (outcome.status === 'ambiguous') return { status: 'failed', message: 'The refresh could not be confirmed. Your saved job is unchanged; try again.' };
      const job = readJob(outcome.value);
      if (!job) return { status: 'failed', message: failureMessage(outcome.value, 'Riff could not refresh this saved job.') };
      if (job.id !== savedJob.id || job.project_id !== savedJob.project_id || job.kind !== savedJob.kind) {
        return { status: 'failed', message: 'Riff returned a different saved job, so this view was not changed.' };
      }
      view.showJob(job); observe(job);
      return { status: 'sent', message: active(job) ? 'Saved job refreshed. Work is still in progress.' : 'Saved job refreshed.' };
    },
    async startRecommendations({ dna }) {
      const intentKey = `${dna.dna_id}:${dna.version}`;
      if (!recommendationRequest || recommendationRequest.key !== intentKey) {
        recommendationRequest = { key: intentKey, requestId: crypto.randomUUID() };
      }
      const pendingRequest = recommendationRequest;
      const outcome = await callTool('start_creator_recommendations', {
        dna_id: dna.dna_id, expected_version: dna.version, request_id: pendingRequest.requestId,
      });
      if (outcome.status === 'ambiguous') return {
        status: 'failed',
        message: 'Riff could not confirm whether discovery started. Try this same analysis again safely.',
      };
      const job = readJob(outcome.value);
      if (!job) {
        if (!retainRequestId(outcome.value)) recommendationRequest = undefined;
        return { status: 'failed', message: failureMessage(outcome.value, 'Riff could not confirm a valid discovery job. Try this same analysis again safely.') };
      }
      recommendationRequest = undefined;
      view.showJob(job); observe(job); if (active(job)) void loadWork();
      return { status: 'sent', message: 'Discovery started. Riff will update this saved job here.' };
    },
    makeMine: ({ job, batch, idea }) => send(
      `Continue this Riff workflow using creator job ${job.id}, recommendation batch ${batch.id}, and selected idea ${idea.id} (“${idea.title}”). Draft two or three evidence-grounded filming variants, then call save_creator_scripts with a fresh request ID and render the saved scripts in Studio. Do not invent references or claim anything was saved before the tool succeeds.`,
    ),
  });
  view.render(homeState);

  function observe(job: CreatorJobView) {
    const epoch = ++pollEpoch; clearTimeout(pollTimer);
    if (!active(job)) { refreshTerminalWork(job); return; }
    if (maxPolls < 1) return;
    let polls = 0;
    const schedule = () => {
      const delay = Math.min(maxPollIntervalMs, Math.round(pollIntervalMs * (1.6 ** polls)));
      pollTimer = setTimeout(() => void poll(), delay);
    };
    const poll = async () => {
      if (disposed || epoch !== pollEpoch || polls >= maxPolls) return;
      polls++;
      const outcome = await callTool('get_creator_job', { job_id: job.id });
      if (disposed || epoch !== pollEpoch) return;
      const next = outcome.status === 'response' ? readJob(outcome.value) : undefined;
      if (!next || next.id !== job.id || next.project_id !== job.project_id || next.kind !== job.kind) {
        if (polls < maxPolls) schedule();
        return;
      }
      view.showJob(next);
      if (active(next)) { if (polls < maxPolls) schedule(); }
      else refreshTerminalWork(next);
    };
    schedule();
  }

  function refreshTerminalWork(job: CreatorJobView) {
    if (active(job)) return;
    const key = `${job.id}:${job.revision}:${job.state}`;
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
    if (outcome.status === 'ambiguous') {
      view.setRecentsState({ status: 'error', message: 'Recent work is temporarily unavailable. Your saved jobs were not changed.' });
      return { status: 'failed', message: 'Recent work could not be refreshed. Try again.' };
    }
    const result = envelope(outcome.value); const data = object(result?.data);
    if (result?.ok !== true || !Array.isArray(data?.work)) {
      view.setRecentsState({ status: 'error', message: failureMessage(outcome.value, 'Recent work is temporarily unavailable.') });
      return { status: 'failed', message: 'Recent work could not be refreshed. Try again.' };
    }
    const items = data.work.flatMap(item => {
      const work = object(item);
      if (!work || typeof work.job_id !== 'string' || typeof work.project_name !== 'string'
        || typeof work.updated_at !== 'string' || !['scan', 'recommendations', 'scripts'].includes(String(work.kind))
        || !['queued', 'running', 'succeeded', 'failed', 'needs_reconciliation'].includes(String(work.state))) return [];
      return [{ job_id: work.job_id, title: work.project_name, updated_at: work.updated_at,
        stage: work.kind === 'recommendations' ? 'Discovery' : work.kind === 'scripts' ? 'Studio' : 'Analysis',
        state: work.state as CreatorJobView['state'] }];
    });
    view.setRecents(items);
    return { status: 'sent', message: items.length ? 'Recent work refreshed.' : 'No recent work yet.' };
  }

  const ensureInitialWork = () => {
    if (!connected || disposed || initialWorkLoadStarted) return;
    initialWorkLoadStarted = true; void loadWork();
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
    if (!connected && !disposed) view.render({ status: 'error', message: 'Riff Home could not connect. Reopen it from ChatGPT.' });
  }, timeoutMs);
  function dispose() {
    if (disposed) return;
    disposed = true; connected = false; pollEpoch++; clearTimeout(pollTimer); clearTimeout(timer); handshake.abort(); view.dispose();
    window.removeEventListener('pagehide', dispose);
    app.ontoolresult = undefined; app.ontoolcancelled = undefined; app.onhostcontextchanged = undefined;
    void app.close();
  }
  app.ontoolresult = (params) => {
    homeState = riffHomeStructuredOutput(params.structuredContent); view.render(homeState);
    ensureInitialWork();
  };
  app.ontoolcancelled = () => view.render({ status: 'error', message: 'Riff Home was cancelled. Reopen it from ChatGPT.' });
  app.onhostcontextchanged = applyContext;
  app.onteardown = async () => { setTimeout(dispose, 0); return {}; };
  app.onclose = () => { connected = false; };
  window.addEventListener('pagehide', dispose, { once: true });
  if (window.parent === window) {
    clearTimeout(timer); view.render({ status: 'error', message: 'Preview mode. Open Riff from ChatGPT to connect your account.' });
  } else {
    void app.connect(new PostMessageTransport(window.parent, window.parent), {
      signal: handshake.signal, timeout: timeoutMs, maxTotalTimeout: timeoutMs,
    }).then(() => {
      if (disposed) return;
      connected = true; clearTimeout(timer); applyContext(app.getHostContext());
      ensureInitialWork();
    }).catch(() => { if (!disposed) view.render({ status: 'error', message: 'Riff Home could not connect. Reopen it from ChatGPT.' }); });
  }
  return { dispose };
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('root');
  if (root) mountRiffHomeBridge(root);
}
