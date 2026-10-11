import {
  App, PostMessageTransport, applyDocumentTheme, applyHostFonts, applyHostStyleVariables,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps';
import { OpenAIExtensions } from '@openai/mcp-extensions/app';
import { mountCreatorPipeline } from './creator-pipeline/index.ts';
import { createCreatorPipelineController, creatorJobStructuredOutput, type CreatorPipelineLimits } from './creator-pipeline-controller.ts';

const WAIT_MS = 10_000;

/** Read-only persisted job view. No provider calls, storage or start/generate capability. */
export function mountCreatorPipelineBridge(root: HTMLElement, limits: CreatorPipelineLimits = {}) {
  const timeoutMs = limits.timeoutMs ?? WAIT_MS;
  const app = new App({ name: 'kettle-creator-pipeline', version: '1.0.0' },
    { availableDisplayModes: ['inline', 'fullscreen'] }, { autoResize: false });
  const extensions = new OpenAIExtensions(app);
  const doc = root.ownerDocument;
  const host = doc.createElement('section');
  host.setAttribute('aria-label', 'Riff creator job');
  host.style.cssText = 'font-family:system-ui,sans-serif;color:inherit;line-height:1.5';
  const message = doc.createElement('p');
  message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  message.tabIndex = -1;
  const card = doc.createElement('div');
  const refresh = doc.createElement('button');
  refresh.type = 'button'; refresh.textContent = 'Refresh job'; refresh.hidden = true;
  refresh.style.cssText = 'font:inherit;padding:8px 12px;margin:8px;border:1px solid currentColor;border-radius:8px;color:inherit;background:transparent;cursor:pointer';
  host.append(message, card, refresh); root.replaceChildren(host);
  let view: ReturnType<typeof mountCreatorPipeline> | undefined;
  function clearCard(text: string) {
    const hadFocus = host.contains(doc.activeElement);
    view?.dispose(); view = undefined; card.replaceChildren();
    refresh.hidden = true; message.textContent = text;
    if (hadFocus) message.focus({ preventScroll: true });
  }
  const messages = {
    reauthorize: 'Reconnect your Riff account through ChatGPT, then reopen this job.',
    unavailable: 'This creator job is unavailable. Ask Riff in ChatGPT to reopen it.',
    invalid: 'Riff returned invalid or mismatched job details. Reopen this job in ChatGPT.',
    connection: 'The connection could not load this Riff creator job. Reopen it in ChatGPT or reconnect Riff.',
  } as const;
  let bridgeReady = false;
  const sendPrompt = async (prompt: string) => {
    if (!bridgeReady || !app.getHostCapabilities()?.message?.text) return {
      status: 'unsupported' as const, message: 'Continue with this request in the ChatGPT composer.',
    };
    try {
      const params = { role: 'user' as const, content: [{ type: 'text' as const, text: prompt }] };
      const result = extensions.message
        ? await extensions.message.send({ ...params, _meta: { 'openai/message': { target: 'active', send: true } } })
        : await app.sendMessage(params);
      return result.isError
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
  const controller = createCreatorPipelineController({
    loading() { clearCard('Loading your saved creator job…'); },
    job(job, status) {
      view ??= mountCreatorPipeline(card, {
        displayMode: app.getHostContext()?.displayMode === 'fullscreen' ? 'fullscreen' : 'inline',
        sendPrompt, requestFullscreen,
      });
      view.render(job);
      message.textContent = status.notice ?? (status.refreshing ? 'Checking saved job status…' : '');
      refresh.hidden = !status.canRefresh; refresh.disabled = status.refreshing;
    },
    cleared(reason) { clearCard(messages[reason]); },
  }, async (input, signal) => creatorJobStructuredOutput(await app.callServerTool(
    { name: 'get_creator_job', arguments: input },
    { signal, timeout: timeoutMs + 1_000, maxTotalTimeout: timeoutMs + 1_000 })), limits);
  refresh.addEventListener('click', () => { void controller.refresh(); });
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
    view?.dispose(); view = undefined; host.remove();
    clearTimeout(initialTimer);
    window.removeEventListener('pagehide', dispose);
    app.ontoolinput = undefined;
    app.ontoolresult = undefined;
    app.ontoolcancelled = undefined;
    app.onhostcontextchanged = undefined;
    void app.close();
  }
  app.ontoolinput = (params) => controller.receiveInput(params.arguments);
  app.ontoolresult = (params) => controller.receiveResult(creatorJobStructuredOutput(params));
  app.ontoolcancelled = () => controller.connectionFailed();
  app.onhostcontextchanged = applyContext;
  app.onclose = () => { bridgeReady = false; stopResize(); if (!disposed) controller.connectionFailed(); };
  // Acknowledge teardown before closing the transport, so the host receives its response.
  app.onteardown = async () => { setTimeout(dispose, 0); return {}; };
  window.addEventListener('pagehide', dispose, { once: true });
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
