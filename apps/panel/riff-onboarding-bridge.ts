import {
  App, PostMessageTransport, applyDocumentTheme, applyHostFonts, applyHostStyleVariables,
  type McpUiHostContext,
} from './mcp-app-lite.ts';
import { mountRiffOnboarding } from './riff-onboarding/index.ts';

export function mountRiffOnboardingBridge(root: HTMLElement, options: { timeoutMs?: number } = {}) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const app = new App({ name: 'riff-onboarding', version: '1.0.0' }, { availableDisplayModes: ['inline'] }, { autoResize: false });
  const view = mountRiffOnboarding(root);
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
    disposed = true; handshake.abort(); resize?.disconnect();
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
    view.dispose(); window.removeEventListener('pagehide', dispose);
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
