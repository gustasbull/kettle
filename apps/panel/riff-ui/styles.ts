export const riffBaseStyles = `
.riff-app {
  --riff-canvas: var(--color-background-secondary, #F4F5F7);
  --riff-surface: var(--color-background-primary, #FFFFFF);
  --riff-ink: var(--color-text-primary, #242426);
  --riff-muted: var(--color-text-secondary, #6D6D72);
  --riff-line: var(--color-border-secondary, #E5E5E7);
  --riff-primary: #3865F8;
  --riff-hook: #66509A;
  --riff-hook-soft: #F0EAFB;
  --riff-showcase: #276C59;
  --riff-showcase-soft: #E4F3EC;
  --riff-cta: #925035;
  --riff-cta-soft: #FCEADD;
  --riff-space-tight: 8px;
  --riff-space-related: 16px;
  --riff-space-section: 24px;
  --riff-space-region: 32px;
  --riff-radius-control: var(--border-radius-full, 999px);
  --riff-radius-surface: 18px;
  container: riff-app / inline-size;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  color: var(--riff-ink);
  font-family: var(--font-sans, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  font-size: var(--font-text-md-size, 16px);
  line-height: var(--font-text-md-line-height, 24px);
  overflow-wrap: anywhere;
  text-rendering: optimizeLegibility;
}
.riff-app, .riff-app * { box-sizing: border-box; }
.riff-app :is(h1, h2, h3, p, ul, ol, dl, dd) { margin: 0; }
.riff-app button, .riff-app input, .riff-app textarea { font: inherit; }
.riff-app button { touch-action: manipulation; }
.riff-app :is(button, a, input, textarea, [tabindex]):focus-visible {
  outline: 3px solid var(--color-ring-primary, var(--riff-primary));
  outline-offset: 3px;
}
.riff-app .riff-logo { display: block; width: auto; height: 100%; color: currentColor; }
.riff-app [hidden] { display: none !important; }
@container riff-app (max-width: 320px) {
  .riff-app { --riff-space-section: 20px; --riff-space-region: 24px; }
}
@media (prefers-reduced-motion: reduce) {
  .riff-app *, .riff-app *::before, .riff-app *::after {
    scroll-behavior: auto !important;
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
  }
}
@media (forced-colors: active) {
  .riff-app :is(button, input, textarea, article, section) { border-color: CanvasText; }
  .riff-app :is(button, a, input, textarea, [tabindex]):focus-visible { outline-color: Highlight; }
}
`;

