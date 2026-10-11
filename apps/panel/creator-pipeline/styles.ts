export const creatorPipelineStyles = `
html, body { margin: 0; background: transparent; }
.riff-pipeline { min-width: 0; }
.riff-pipeline__surface { min-width: 0; overflow: hidden; background: var(--riff-surface); }
.riff-pipeline[data-mode="inline"] .riff-pipeline__surface { padding: 20px; border: 1px solid var(--riff-line); border-radius: var(--riff-radius-surface); }
.riff-pipeline[data-mode="fullscreen"] { min-height: 100vh; background: var(--riff-canvas); }
.riff-pipeline[data-mode="fullscreen"] .riff-pipeline__surface { width: min(100%, 1180px); min-height: 100vh; margin: 0 auto; padding: clamp(22px, 4vw, 48px); background: transparent; }
.riff-pipeline__content > * + * { margin-top: 24px; }
.riff-pipeline__brand { width: 108px; height: 40px; margin-bottom: clamp(36px, 7vw, 76px); color: var(--riff-ink); }
.riff-title { max-width: 880px; }
.riff-title h1 { margin-top: 6px; font-size: clamp(30px, 6vw, 72px); line-height: .98; letter-spacing: -.055em; text-wrap: balance; }
.riff-pipeline[data-mode="inline"] .riff-title h1 { font-size: clamp(24px, 7cqi, 34px); line-height: 1.06; }
.riff-eyebrow { color: var(--riff-primary); font-size: 12px; font-weight: 750; letter-spacing: .085em; text-transform: uppercase; }
.riff-lede { max-width: 760px; color: var(--riff-muted); font-size: 17px; }
.riff-muted { color: var(--riff-muted); font-size: 13px; }
.riff-notice { padding: 13px 16px; border: 1px solid var(--riff-line); border-radius: 14px; color: var(--riff-muted); background: color-mix(in srgb, var(--riff-surface) 75%, transparent); }
.riff-pipeline__status { min-height: 22px; margin-top: 18px !important; color: var(--riff-muted); font-size: 13px; }
.riff-progress { width: 100%; height: 7px; overflow: hidden; border-radius: 999px; background: var(--riff-line); }
.riff-progress::after { display: block; width: 38%; height: 100%; border-radius: inherit; background: var(--riff-primary); animation: riff-progress 1.35s ease-in-out infinite alternate; content: ""; }
@keyframes riff-progress { from { transform: translateX(-15%); } to { transform: translateX(180%); } }
.riff-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 24px; }
.riff-fact { min-width: 0; padding: 11px 0; border-bottom: 1px solid var(--riff-line); }
.riff-fact dt { color: var(--riff-muted); font-size: 12px; }
.riff-fact dd { margin-top: 2px; white-space: pre-wrap; }
.riff-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.riff-button, .riff-icon-button, .riff-library, .riff-variant, .riff-tab { min-height: 44px; padding: 9px 16px; border: 1px solid var(--riff-line); border-radius: var(--riff-radius-control); color: var(--riff-ink); background: var(--riff-surface); cursor: pointer; }
.riff-button--primary { color: #fff; border-color: var(--riff-primary); background: var(--riff-primary); }
.riff-button--quiet { color: var(--riff-muted); background: transparent; }
.riff-icon-button { padding-inline: 14px; }
.riff-analysis-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.riff-dimension { min-height: 180px; padding: 18px; border: 1px solid var(--riff-line); border-radius: var(--riff-radius-surface); background: var(--riff-surface); }
.riff-dimension h2 { font-size: 18px; letter-spacing: -.02em; }
.riff-dimension > * + * { margin-top: 10px; }
.riff-basis { display: inline-block; padding: 3px 9px; border-radius: var(--riff-radius-control); color: var(--riff-primary); background: color-mix(in srgb, var(--riff-primary) 10%, transparent); font-size: 12px; font-weight: 700; }
.riff-seed { padding: 22px; border-radius: var(--riff-radius-surface); color: #fff; background: #242426; }
.riff-seed .riff-muted, .riff-seed dt { color: #c7c7ca; }
.riff-seed .riff-fact { border-color: #4a4a4d; }
.riff-seed h2 { margin-top: 8px; font-size: clamp(22px, 4vw, 36px); line-height: 1.12; }
.riff-pipeline ul { margin: 10px 0 0; padding-left: 20px; }
.riff-pipeline li + li { margin-top: 7px; }
.riff-compact-list h3 { font-size: 15px; }
.riff-libraries { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.riff-library { border-radius: 14px; text-align: left; }
.riff-library--active { color: #fff; border-color: var(--riff-primary); background: var(--riff-primary); }
.riff-discovery { padding: clamp(18px, 4vw, 34px); border: 1px solid var(--riff-line); border-radius: 24px; background: var(--riff-surface); }
.riff-discovery__top { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 18px; align-items: start; }
.riff-discovery__top h2 { margin-top: 6px; font-size: clamp(28px, 5vw, 52px); line-height: 1; letter-spacing: -.045em; }
.riff-discovery__body { margin-top: 24px; }
.riff-reference-grid { margin-top: 26px; }
.riff-reference-grid > h3 { margin-bottom: 12px; }
.riff-reference { display: grid; grid-template-columns: minmax(150px, .42fr) minmax(0, 1fr); gap: 18px; padding: 14px 0; border-top: 1px solid var(--riff-line); }
.riff-reference__media { display: grid; min-height: 150px; place-items: center; border-radius: 14px; color: var(--riff-muted); background: var(--riff-canvas); font-size: 13px; }
.riff-reference__body > * + * { margin-top: 12px; }
.riff-reference__caption { font-weight: 650; }
.riff-link { color: var(--riff-primary); text-underline-offset: 3px; }
.riff-variants { display: flex; flex-wrap: wrap; gap: 10px; }
.riff-variant--active { color: #fff; border-color: var(--riff-ink); background: var(--riff-ink); }
.riff-tabs { display: flex; max-width: 100%; gap: 6px; padding: 5px; overflow-x: auto; border: 1px solid var(--riff-line); border-radius: var(--riff-radius-control); background: var(--riff-surface); scrollbar-width: none; }
.riff-tab { flex: 1 0 auto; border-color: transparent; background: transparent; }
.riff-tab[aria-selected="true"] { color: #fff; background: var(--riff-primary); }
.riff-studio-panel { min-height: 300px; padding: clamp(18px, 4vw, 34px); border: 1px solid var(--riff-line); border-radius: var(--riff-radius-surface); background: var(--riff-surface); }
.riff-studio-panel > * + *, .riff-script-field > * + * { margin-top: 12px; }
.riff-script-field + .riff-script-field { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--riff-line); }
.riff-script-field h3 { font-size: 16px; }
@media (max-width: 760px) {
  .riff-analysis-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .riff-libraries { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 480px) {
  .riff-pipeline[data-mode="fullscreen"] .riff-pipeline__surface { padding: 18px 16px 28px; }
  .riff-facts, .riff-analysis-grid, .riff-discovery__top, .riff-reference { grid-template-columns: minmax(0, 1fr); }
  .riff-libraries { grid-template-columns: 1fr; }
  .riff-dimension { min-height: 0; }
  .riff-reference__media { min-height: 110px; }
}
@media (forced-colors: active) {
  .riff-button--primary, .riff-library--active, .riff-variant--active, .riff-tab[aria-selected="true"] { border: 2px solid ButtonText; }
}
`;
