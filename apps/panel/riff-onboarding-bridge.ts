import {
  App, PostMessageTransport, applyDocumentTheme, applyHostFonts, applyHostStyleVariables,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps';
import { mountRiffOnboarding } from './riff-onboarding/index.ts';

export function mountRiffOnboardingBridge(root: HTMLElement, options: { timeoutMs?: number } = {}) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const app = new App({ name: 'riff-onboarding', version: '1.0.0' }, { availableDisplayModes: ['inline'] }, { autoResize: true });
  const view = mountRiffOnboarding(root);
  let disposed = false;
  let markAttempted = false;
  const handshake = new AbortController();
  const applyContext = (context: McpUiHostContext | undefined) => {
    if (context?.theme) applyDocumentTheme(context.theme);
    if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
    if (context?.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
    if (context?.locale) document.documentElement.lang = context.locale;
  };
  function dispose() {
    if (disposed) return;
    disposed = true; handshake.abort(); view.dispose(); window.removeEventListener('pagehide', dispose);
    app.onhostcontextchanged = undefined; void app.close();
  }
  app.onhostcontextchanged = applyContext;
  app.onteardown = async () => { setTimeout(dispose, 0); return {}; };
  window.addEventListener('pagehide', dispose, { once: true });
  if (window.parent !== window) void app.connect(new PostMessageTransport(window.parent, window.parent), {
    signal: handshake.signal, timeout: timeoutMs, maxTotalTimeout: timeoutMs,
  }).then(() => {
    if (disposed) return;
    applyContext(app.getHostContext());
    if (markAttempted) return;
    markAttempted = true;
    if (!app.getHostCapabilities()?.serverTools) return;
    void app.callServerTool({ name: 'mark_riff_onboarding_seen', arguments: {} }, {
      signal: handshake.signal, timeout: timeoutMs + 1_000, maxTotalTimeout: timeoutMs + 1_000,
    }).catch(() => {});
  }).catch(() => {});
  return { dispose };
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('root');
  if (root) mountRiffOnboardingBridge(root);
}
