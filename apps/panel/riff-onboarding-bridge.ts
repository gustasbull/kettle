import {
  App, PostMessageTransport, applyDocumentTheme, applyHostFonts, applyHostStyleVariables,
  type McpUiHostContext,
} from './mcp-app-lite.ts';
import { mountRiffOnboarding } from './riff-onboarding/index.ts';
import { parseOnboardingSeenResult } from './riff-home-validation.ts';
import { parseWelcomeAccountBinding } from './riff-onboarding-validation.ts';

type OpenAIHost = { callTool?: (name: string, args: Record<string, unknown>) => Promise<unknown> };

export function mountRiffOnboardingBridge(root: HTMLElement, options: { timeoutMs?: number; toolTimeoutMs?: number } = {}) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const toolTimeoutMs = options.toolTimeoutMs ?? 45_000;
  const app = new App({ name: 'riff-onboarding', version: '1.0.0' }, { availableDisplayModes: ['inline'] }, { autoResize: false });
  let connected = false;
  let expectedAccountId: string | undefined;
  const finishWelcome = async () => {
    const completionAccountId = expectedAccountId;
    if (!connected || !completionAccountId) return { status: 'failed' as const, message: 'Riff could not confirm welcome completion. Try the same action again safely.' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), toolTimeoutMs);
    try {
      let result: unknown;
      if (app.getHostCapabilities()?.serverTools) {
        result = await app.callServerTool(
          { name: 'mark_riff_onboarding_seen', arguments: { expected_account_id: completionAccountId } },
          { signal: controller.signal, timeout: toolTimeoutMs, maxTotalTimeout: toolTimeoutMs },
        );
      } else if ((window as Window & { openai?: OpenAIHost }).openai?.callTool) {
        const callTool = (window as Window & { openai?: OpenAIHost }).openai!.callTool!;
        result = await Promise.race([
          callTool('mark_riff_onboarding_seen', { expected_account_id: completionAccountId }),
          new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true })),
        ]);
      } else return { status: 'failed' as const, message: 'Riff could not confirm welcome completion. Try the same action again safely.' };
      return parseOnboardingSeenResult(result)
        ? { status: 'sent' as const, message: 'Welcome completed. Riff Home is ready on the right.' }
        : { status: 'failed' as const, message: 'Riff could not confirm welcome completion. Try the same action again safely.' };
    } catch {
      return { status: 'failed' as const, message: 'Riff could not confirm welcome completion. Try the same action again safely.' };
    } finally { clearTimeout(timer); }
  };
  const view = mountRiffOnboarding(root, { onComplete: finishWelcome });
  let disposed = false;
  let resize: ResizeObserver | undefined;
  let resizeFrame: number | undefined;
  let lastSize = '';
  const handshake = new AbortController();
  const reportSize = () => {
    if (disposed || resizeFrame !== undefined) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = undefined;
      if (disposed) return;
      const documentRoot = document.documentElement;
      const previousHeight = documentRoot.style.height;
      documentRoot.style.height = 'max-content';
      const height = Math.ceil(documentRoot.getBoundingClientRect().height);
      documentRoot.style.height = previousHeight;
      const width = Math.ceil(window.innerWidth);
      const nextSize = `${width}:${height}`;
      if (nextSize === lastSize) return;
      lastSize = nextSize;
      void app.sendSizeChanged({ width, height }).catch(() => {});
    });
  };
  const applyContext = (context: McpUiHostContext | undefined) => {
    if (context?.theme) applyDocumentTheme(context.theme);
    if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
    if (context?.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
    if (context?.locale) document.documentElement.lang = context.locale;
  };
  function dispose() {
    if (disposed) return;
    disposed = true; connected = false; handshake.abort(); resize?.disconnect();
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
    view.dispose(); window.removeEventListener('pagehide', dispose);
    app.ontoolresult = undefined; app.onhostcontextchanged = undefined; void app.close();
  }
  app.onhostcontextchanged = applyContext;
  app.ontoolresult = (result) => {
    const binding = parseWelcomeAccountBinding(result);
    // Bind this mounted welcome to its first coherent server issuance. A later
    // account switch must reopen the guide rather than retarget a stale panel.
    if (binding && expectedAccountId === undefined) expectedAccountId = binding;
  };
  app.onclose = () => { connected = false; };
  app.onteardown = async () => { setTimeout(dispose, 0); return {}; };
  window.addEventListener('pagehide', dispose, { once: true });
  if (window.parent !== window) void app.connect(new PostMessageTransport(window.parent, window.parent), {
    signal: handshake.signal, timeout: timeoutMs, maxTotalTimeout: timeoutMs,
  }).then(() => {
    if (disposed) return;
    connected = true;
    applyContext(app.getHostContext());
    resize = new ResizeObserver(reportSize);
    resize.observe(document.documentElement);
    resize.observe(document.body);
    reportSize();
  }).catch(() => {});
  return { dispose };
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('root');
  if (root) mountRiffOnboardingBridge(root);
}
