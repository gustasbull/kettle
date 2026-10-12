import {
  App, PostMessageTransport, applyDocumentTheme, applyHostFonts, applyHostStyleVariables,
  type McpUiHostContext,
} from './mcp-app-lite.ts';
import type { OpenAIMessageParams } from '@openai/mcp-extensions/app';
import { mountCreatorPipeline, riffCatalogProposalHandoff } from './creator-pipeline/index.ts';
import { createCreatorPipelineController, creatorJobStatusStructuredOutput, creatorJobStructuredOutput, type CreatorPipelineLimits } from './creator-pipeline-controller.ts';
import { panelPerformanceFromDocument } from './creator-performance.ts';
import { parseStartRiffCreatorInput } from './creator-pipeline-validation.ts';
import { createRiffVideoCatalogLoader } from './riff-video-catalog-loader.ts';
import { createRiffWorkStateClient } from './riff-work-state-client.ts';

const WAIT_MS = 10_000;
const sameUuid=(left:string,right:string)=>left.toLowerCase()===right.toLowerCase();

/** Provider-free persisted-job reads. Only explicit Studio state controls may
 * request a receipt-backed durable write; this bridge never starts provider or generation work. */
export function mountCreatorPipelineBridge(root: HTMLElement, limits: CreatorPipelineLimits = {}) {
  const localPerformance = panelPerformanceFromDocument(root.ownerDocument, performance);
  const timeoutMs = limits.timeoutMs ?? WAIT_MS;
  const app = new App({ name: 'kettle-creator-pipeline', version: '1.0.0' },
    { availableDisplayModes: ['inline', 'fullscreen'] }, { autoResize: false });
  const doc = root.ownerDocument;
  const host = doc.createElement('section');
  host.setAttribute('aria-label', 'Riff creator job');
  host.style.cssText = 'font-family:system-ui,sans-serif;color:inherit;line-height:1.5';
  const message = doc.createElement('p');
  message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  message.tabIndex = -1;
  message.hidden = true;
  message.style.cssText = 'margin:12px 20px;color:var(--color-text-secondary,#6d6d72);font-size:13px;line-height:20px';
  const card = doc.createElement('div');
  host.append(card, message); root.replaceChildren(host);
  let view: ReturnType<typeof mountCreatorPipeline> | undefined;
  let currentProjectId:string|undefined;
  let currentJobId:string|undefined;
  const catalogOwnerKey=`authenticated-bridge:${crypto.randomUUID()}`;
  const sourceByJob=new Map<string,string>();let pendingSource:string|undefined;
  function clearCard(text: string) {
    const hadFocus = host.contains(doc.activeElement);
    view?.dispose(); view = undefined; card.replaceChildren();
    message.hidden = false; message.textContent = text;
    if (hadFocus) message.focus({ preventScroll: true });
  }
  const messages = {
    reauthorize: 'Reconnect your Riff account through ChatGPT, then reopen this job.',
    unavailable: 'This creator job is unavailable. Ask Riff in ChatGPT to reopen it.',
    invalid: 'Riff returned invalid or mismatched job details. Reopen this job in ChatGPT.',
    connection: 'The connection could not load this Riff creator job. Reopen it in ChatGPT or reconnect Riff.',
  } as const;
  let bridgeReady = false;
  type DeadlineResult<T> = { status: 'resolved'; value: T } | { status: 'rejected' } | { status: 'timeout' };
  const withDeadline = <T>(promise: Promise<T>, deadlineMs: number): Promise<DeadlineResult<T>> => new Promise(resolve => {
    let settled = false;
    const finish = (result: DeadlineResult<T>) => {
      if (settled) return;
      settled = true; clearTimeout(timer); resolve(result);
    };
    const timer = setTimeout(() => finish({ status: 'timeout' }), deadlineMs);
    promise.then(value => finish({ status: 'resolved', value }), () => finish({ status: 'rejected' }));
  });
  const sendPrompt = async (prompt: string) => {
    const capabilities = app.getHostCapabilities();
    if (!bridgeReady || (capabilities?.experimental?.['openai/message'] == null && !capabilities?.message?.text)) return {
      status: 'unsupported' as const, message: 'Continue with this request in the ChatGPT composer.',
    };
    try {
      const params: OpenAIMessageParams = {
        role: 'user',
        content: [{ type: 'text', text: prompt }],
        _meta: { 'openai/message': { target: 'active', send: true } },
      };
      const outcome = await withDeadline(
        app.sendMessage(params as Parameters<typeof app.sendMessage>[0]),
        Math.min(timeoutMs, 750),
      );
      if (outcome.status === 'timeout') return {
        status: 'pending' as const,
        message: 'Sending this request to ChatGPT. If it does not appear, continue in the composer.',
      };
      if (outcome.status === 'rejected') return {
        status: 'failed' as const, message: 'The handoff failed. Continue in the ChatGPT composer.',
      };
      return outcome.value.isError
        ? { status: 'failed' as const, message: 'ChatGPT did not accept that handoff. Continue in the composer.' }
        : { status: 'sent' as const, message: 'Sent to ChatGPT. Continue there when you are ready.' };
    } catch {
      return { status: 'failed' as const, message: 'The handoff failed. Continue in the ChatGPT composer.' };
    }
  };
  const requestFullscreen = async () => {
    const context = app.getHostContext();
    if (!bridgeReady || !context?.availableDisplayModes?.includes('fullscreen')) return {
      status: 'unsupported' as const, message: 'Fullscreen is unavailable in this ChatGPT version. Continue from the inline summary.',
    };
    try {
      const result = await app.requestDisplayMode({ mode: 'fullscreen' });
      view?.setDisplayMode(result.mode === 'fullscreen' ? 'fullscreen' : 'inline');
      return result.mode === 'fullscreen'
        ? { status: 'sent' as const, message: 'Opened fullscreen.' }
        : { status: 'unsupported' as const, message: 'ChatGPT kept this result inline.' };
    } catch {
      return { status: 'failed' as const, message: 'Fullscreen could not open. Continue from the inline summary.' };
    }
  };
  const catalogLoader=createRiffVideoCatalogLoader(
    args=>app.callServerTool({name:'list_riff_videos',arguments:args},
      {timeout:timeoutMs+1_000,maxTotalTimeout:timeoutMs+1_000}),
    state=>view?.setCatalogState(state),
  );
  const loadCatalog=(projectId=currentProjectId)=>{
    if(!projectId||projectId!==currentProjectId||!bridgeReady)return;
    return catalogLoader.load({ownerKey:catalogOwnerKey,projectId});
  };
  const workStateClient=createRiffWorkStateClient(
    input=>app.callServerTool({name:'set_riff_work_state',arguments:input},{timeout:timeoutMs+1_000,maxTotalTimeout:timeoutMs+1_000}),
    async jobId=>{
      const result=creatorJobStructuredOutput(await app.callServerTool({name:'get_creator_job',arguments:{job_id:jobId}},
        {timeout:timeoutMs+1_000,maxTotalTimeout:timeoutMs+1_000}));
      return result?.ok?result.data.job:undefined;
    },
  );
  const controller = createCreatorPipelineController({
    loading() { clearCard('Loading your saved creator job…'); },
    job(snapshot, status) {
      if(currentJobId&&!sameUuid(currentJobId,snapshot.job.id))workStateClient.invalidate();
      currentJobId=snapshot.job.id;
      const latestVariant=[...snapshot.job.work_states].sort((left,right)=>
        right.updated_at.localeCompare(left.updated_at)||right.version-left.version||left.variant_id.localeCompare(right.variant_id))[0]?.variant_id;
      view ??= mountCreatorPipeline(card, {
        displayMode: app.getHostContext()?.displayMode === 'fullscreen' ? 'fullscreen' : 'inline',
        sendPrompt, requestFullscreen,
        onDiscoveryOpen:({projectId}={})=>void loadCatalog(projectId),
        proposeCatalogReference:proposal=>sendPrompt(riffCatalogProposalHandoff(proposal)),
        onCatalogRetry:()=>void catalogLoader.retry(),
        setVariantState:({job,variant,state})=>workStateClient.set(job,variant.id,state),
        openVault:({job,variant})=>sendPrompt(`Open Riff Home and show My videos with saved job ${job.id} and script variant ${variant.id} selected. Treat both IDs as exact handoff context, and do not claim navigation succeeded unless the host confirms it.`),
      });
      if(currentProjectId!==snapshot.job.project_id){
        currentProjectId=snapshot.job.project_id;catalogLoader.reset();
      }
      view.render(snapshot.job,{...(snapshot.status?{status:snapshot.status}:{}),...(sourceByJob.get(snapshot.job.id)?{sourceUrl:sourceByJob.get(snapshot.job.id)}:{}),
        ...(latestVariant?{variantId:latestVariant}:{})});
      if(snapshot.status?.progress.kind==='scan'&&snapshot.status.progress.videos.length)sourceByJob.delete(snapshot.job.id);
      message.textContent = status.notice ?? '';
      message.hidden = !status.notice;
    },
    notice(text){message.textContent=text;message.hidden=false;view?.setNotice(text);},
    cleared(reason) { clearCard(messages[reason]); },
  }, {
    readStatus:async(input,signal)=>creatorJobStatusStructuredOutput(await app.callServerTool({name:'get_creator_job_status',arguments:input},
      {signal,timeout:timeoutMs+1_000,maxTotalTimeout:timeoutMs+1_000})),
    readFull:async(input,signal)=>creatorJobStructuredOutput(await app.callServerTool({name:'get_creator_job',arguments:input},
      {signal,timeout:timeoutMs+1_000,maxTotalTimeout:timeoutMs+1_000})),
  }, { ...limits, performance: localPerformance });
  // Receiving a job before initialization must not cancel the handshake deadline.
  const initialTimer = setTimeout(() => controller.connectionFailed(), timeoutMs);
  const applyContext = (context: McpUiHostContext | undefined) => {
    if (context?.theme) applyDocumentTheme(context.theme);
    if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
    if (context?.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
    if (context?.locale) document.documentElement.lang = context.locale;
    view?.setDisplayMode(context?.displayMode === 'fullscreen' ? 'fullscreen' : 'inline');
    if (context?.safeAreaInsets) for (const [name, value] of Object.entries(context.safeAreaInsets)) {
      if (Number.isFinite(value)) document.documentElement.style.setProperty(`--riff-safe-${name}`, `${Math.max(0, value)}px`);
    }
  };
  let disposed = false;
  let resizeObserver: ResizeObserver | undefined;
  let resizeFrame: number | undefined;
  let lastSize = '';
  function stopResize() {
    resizeObserver?.disconnect();
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
    resizeFrame = undefined;
  }
  function scheduleSize() {
    if (disposed || !bridgeReady || resizeFrame !== undefined) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = undefined;
      if (disposed || !bridgeReady) return;
      const element = document.documentElement;
      const previousHeight = element.style.height;
      element.style.height = 'max-content';
      const height = Math.ceil(element.getBoundingClientRect().height);
      element.style.height = previousHeight;
      const width = Math.ceil(window.innerWidth);
      const size = `${width}:${height}`;
      if (size === lastSize) return;
      lastSize = size;
      // ext-apps 1.7.5's autoResize does not retain its cleanup callback or
      // cancel queued animation frames on close. Own this lifecycle explicitly.
      void app.sendSizeChanged({ width, height }).catch(() => {});
    });
  }
  const handshake = new AbortController();
  function dispose() {
    if (disposed) return;
    disposed = true;
    handshake.abort();
    stopResize();
    controller.dispose();
    workStateClient.invalidate();
    view?.dispose(); view = undefined; host.remove();
    clearTimeout(initialTimer);
    window.removeEventListener('pagehide', dispose);
    doc.removeEventListener('visibilitychange',visibilityChanged);
    app.ontoolinput = undefined;
    app.ontoolresult = undefined;
    app.ontoolcancelled = undefined;
    app.onhostcontextchanged = undefined;
    void app.close();
  }
  app.ontoolinput = (params) => {
    // start_riff_creator has no job ID until its result arrives. Keep the
    // loading state alive rather than rejecting a valid direct-start launch.
    const start=parseStartRiffCreatorInput(params.arguments);
    pendingSource=start&&/^https:\/\/www\.tiktok\.com\/@[\w.]+\/video\/\d{1,30}$/.test(start.source_url)?start.source_url:undefined;
    if (!start) controller.receiveInput(params.arguments);
  };
  app.ontoolresult = (params) => {
    const output = creatorJobStructuredOutput(params);
    if (output?.ok){controller.receiveInput({ job_id: output.data.job.id });if(pendingSource)sourceByJob.set(output.data.job.id,pendingSource);pendingSource=undefined;}
    controller.receiveResult(output);
  };
  app.ontoolcancelled = () => controller.connectionFailed();
  app.onhostcontextchanged = applyContext;
  app.onclose = () => { bridgeReady = false; stopResize(); if (!disposed) controller.connectionFailed(); };
  // Acknowledge teardown before closing the transport, so the host receives its response.
  app.onteardown = async () => { setTimeout(dispose, 0); return {}; };
  window.addEventListener('pagehide', dispose, { once: true });
  const visibilityChanged=()=>controller.visibilityChanged(doc.hidden);
  doc.addEventListener('visibilitychange',visibilityChanged);
  if (window.parent === window) {
    controller.connectionFailed();
  } else {
    void app.connect(new PostMessageTransport(window.parent, window.parent),
      { signal: handshake.signal, timeout: timeoutMs, maxTotalTimeout: timeoutMs }).then(() => {
      if (disposed) return;
      clearTimeout(initialTimer);
      bridgeReady = true;
      resizeObserver = new ResizeObserver(scheduleSize);
      resizeObserver.observe(document.documentElement);
      resizeObserver.observe(document.body);
      scheduleSize();
      applyContext(app.getHostContext());
      controller.connected(!!app.getHostCapabilities()?.serverTools);
    }).catch(() => { if (!disposed) controller.connectionFailed(); });
  }
  return { dispose, refresh: controller.refresh };
}

// Bundling this module is the browser entry. Imports in Node tests have no side effects.
if (typeof document !== 'undefined') {
  const root = document.getElementById('root');
  if (root) mountCreatorPipelineBridge(root);
}
