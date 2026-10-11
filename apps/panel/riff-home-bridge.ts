import {
  App, PostMessageTransport, applyDocumentTheme, applyHostFonts, applyHostStyleVariables,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps';
import { OpenAIExtensions } from '@openai/mcp-extensions/app';
import { mountRiffHome, riffHomeStructuredOutput } from './riff-home/index.ts';

export function mountRiffHomeBridge(root: HTMLElement, options: { timeoutMs?: number } = {}) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const app = new App({ name: 'riff-home', version: '1.0.0' }, { availableDisplayModes: ['fullscreen'] }, { autoResize: true });
  const extensions = new OpenAIExtensions(app);
  let connected = false;
  let disposed = false;
  let onboardingMarkNeeded = false;
  let onboardingMarkAttempted = false;
  const markFirstOpen = () => {
    if (!connected || disposed || !onboardingMarkNeeded || onboardingMarkAttempted) return;
    onboardingMarkAttempted = true;
    if (!app.getHostCapabilities()?.serverTools) return;
    void app.callServerTool({ name: 'mark_riff_onboarding_seen', arguments: {} }, {
      timeout: timeoutMs + 1_000, maxTotalTimeout: timeoutMs + 1_000,
    }).catch(() => {});
  };
  const action = async (prompt: string) => {
    if (!connected || !app.getHostCapabilities()?.message?.text) return {
      status: 'unsupported' as const,
      message: 'Continue in the ChatGPT composer with this request. This ChatGPT version cannot receive it from the panel.',
    };
    try {
      const params = { role: 'user' as const, content: [{ type: 'text' as const, text: prompt }] };
      const result = extensions.message
        ? await extensions.message.send({ ...params, _meta: { 'openai/message': { target: 'active', send: true } } })
        : await app.sendMessage(params);
      return result.isError
        ? { status: 'failed' as const, message: 'ChatGPT did not accept that handoff. Continue in the composer.' }
        : { status: 'sent' as const, message: 'Sent to ChatGPT. You can edit or continue there.' };
    } catch {
      return { status: 'failed' as const, message: 'The handoff failed. Continue in the ChatGPT composer.' };
    }
  };
  const showWelcome = async () => {
    if (!connected || !app.getHostCapabilities()?.serverTools) return {
      status: 'unsupported' as const,
      message: 'Ask ChatGPT to show the Riff welcome guide in this conversation.',
    };
    try {
      const result = await app.callServerTool({ name: 'show_riff_welcome', arguments: {} }, {
        timeout: timeoutMs + 1_000, maxTotalTimeout: timeoutMs + 1_000,
      });
      return result.isError
        ? { status: 'failed' as const, message: 'Riff could not open the welcome guide. Continue in the ChatGPT composer.' }
        : { status: 'sent' as const, message: 'Welcome opened in ChatGPT.' };
    } catch {
      return { status: 'failed' as const, message: 'Riff could not open the welcome guide. Continue in the ChatGPT composer.' };
    }
  };
  const view = mountRiffHome(root, action, showWelcome);
  view.render({ status: 'loading' });
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
  const timer = setTimeout(() => { if (!connected && !disposed) view.render({ status: 'error', message: 'Riff Home could not connect. Reopen it from ChatGPT.' }); }, timeoutMs);
  function dispose() {
    if (disposed) return;
    disposed = true; connected = false; clearTimeout(timer); handshake.abort(); view.dispose();
    window.removeEventListener('pagehide', dispose);
    app.ontoolresult = undefined; app.ontoolcancelled = undefined; app.onhostcontextchanged = undefined;
    void app.close();
  }
  app.ontoolresult = (params) => {
    const state = riffHomeStructuredOutput(params.structuredContent);
    view.render(state);
    onboardingMarkNeeded = state.status === 'ready' && state.account.onboarding_seen_at === null;
    markFirstOpen();
  };
  app.ontoolcancelled = () => view.render({ status: 'error', message: 'Riff Home was cancelled. Reopen it from ChatGPT.' });
  app.onhostcontextchanged = applyContext;
  app.onteardown = async () => { setTimeout(dispose, 0); return {}; };
  app.onclose = () => { connected = false; };
  window.addEventListener('pagehide', dispose, { once: true });
  if (window.parent === window) {
    clearTimeout(timer);
    view.render({ status: 'error', message: 'Preview mode. Open Riff from ChatGPT to connect your account.' });
  } else {
    void app.connect(new PostMessageTransport(window.parent, window.parent), {
      signal: handshake.signal, timeout: timeoutMs, maxTotalTimeout: timeoutMs,
    }).then(() => {
      if (disposed) return;
      connected = true; clearTimeout(timer); applyContext(app.getHostContext());
      markFirstOpen();
    }).catch(() => { if (!disposed) view.render({ status: 'error', message: 'Riff Home could not connect. Reopen it from ChatGPT.' }); });
  }
  return { dispose };
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('root');
  if (root) mountRiffHomeBridge(root);
}
