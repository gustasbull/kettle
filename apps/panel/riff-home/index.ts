import type { CreatorJobView } from '../../../packages/contracts/creator-pipeline.ts';
import { mountCreatorPipeline, type RiffDiscoverySelection } from '../creator-pipeline/index.ts';
import { riffLockup } from '../riff-ui/brand.ts';
import type { RiffActionResult, RiffPanelAction } from '../riff-ui/dom.ts';
import { riffBaseStyles } from '../riff-ui/styles.ts';

export type RiffHomeState =
  | { status: 'loading' }
  | { status: 'ready'; account: { id: string; name: string; onboarding_seen_at?: string | null } }
  | { status: 'error'; message: string };

export type RiffRecentWork = {
  job_id: string;
  title: string;
  stage: string;
  state: CreatorJobView['state'];
  updated_at: string;
  platform?: 'tiktok';
  handle?: string;
};

export type RiffRecentsState =
  | { status: 'loading' }
  | { status: 'ready'; items: RiffRecentWork[] }
  | { status: 'error'; message: string };

type RecommendationResult = Extract<NonNullable<CreatorJobView['result']>, { kind: 'recommendations' }>;
type ScriptResult = Extract<NonNullable<CreatorJobView['result']>, { kind: 'scripts' }>;

export type RiffHomeActions = {
  start(source: string): Promise<RiffActionResult>;
  inputChanged?: (source: string) => void;
  send: RiffPanelAction;
  upload?: () => Promise<RiffActionResult>;
  showWelcome?: () => Promise<RiffActionResult>;
  openRecent?: (jobId: string) => Promise<RiffActionResult>;
  refreshRecents?: () => Promise<RiffActionResult>;
  refreshJob?: (job: CreatorJobView) => Promise<RiffActionResult>;
  startRecommendations?: (context: {
    job: CreatorJobView;
    dna: Extract<NonNullable<CreatorJobView['result']>, { kind: 'scan' }>['dna'];
  }) => Promise<RiffActionResult>;
  makeMine?: (context: RiffDiscoverySelection) => Promise<RiffActionResult>;
  setVariantState?: (context: {
    job: CreatorJobView;
    scripts: ScriptResult['scripts'];
    variant: ScriptResult['scripts']['variants'][number];
    state: 'saved' | 'filmed';
  }) => Promise<RiffActionResult>;
};

export function riffHomeStructuredOutput(value: unknown): RiffHomeState {
  if (!value || typeof value !== 'object') return { status: 'error', message: 'Riff could not read this account. Reopen it from ChatGPT.' };
  const result = value as { ok?: unknown; data?: unknown; error?: unknown };
  if (result.ok !== true || !result.data || typeof result.data !== 'object') {
    const code = result.error && typeof result.error === 'object' ? (result.error as { code?: unknown }).code : undefined;
    return { status: 'error', message: code === 'UNAUTHENTICATED' || code === 'FORBIDDEN'
      ? 'Reconnect your Riff account in ChatGPT, then reopen Home.'
      : 'Riff could not read this account. Reopen it from ChatGPT.' };
  }
  const account = (result.data as { account?: unknown }).account;
  if (!account || typeof account !== 'object') return { status: 'error', message: 'Riff returned incomplete account details. Reopen Home.' };
  const { id, display_name: name, onboarding_seen_at: rawOnboardingSeenAt } = account as {
    id?: unknown; display_name?: unknown; onboarding_seen_at?: unknown;
  };
  if (typeof id !== 'string' || typeof name !== 'string' || !name.trim()) {
    return { status: 'error', message: 'Riff returned incomplete account details. Reopen Home.' };
  }
  const onboardingSeenAt = rawOnboardingSeenAt === null ? null
    : typeof rawOnboardingSeenAt === 'string' && !Number.isNaN(Date.parse(rawOnboardingSeenAt))
      ? rawOnboardingSeenAt : undefined;
  return { status: 'ready', account: { id, name: name.trim(), onboarding_seen_at: onboardingSeenAt } };
}

const homeStyles = `
${riffBaseStyles}
html, body { margin: 0; min-height: 100%; background: #FFFFFF; }
body { min-height: 100vh; }
.riff-home { min-height: 100vh; background: #FFFFFF; color: #242426; }
.riff-home__account { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.riff-home__home { display: flex; min-height: 100vh; width: 100%; align-items: center; flex-direction: column; gap: 20px; padding: calc(28px + var(--riff-safe-top, 0px)) calc(28px + var(--riff-safe-right, 0px)) calc(40px + var(--riff-safe-bottom, 0px)) calc(28px + var(--riff-safe-left, 0px)); border-radius: 0 0 24px 24px; background: #FFFFFF; }
.riff-home__hero { display: flex; width: 100%; align-items: center; flex-direction: column; gap: 16px; padding: 12px 0 4px; text-align: center; }
.riff-home__hero-mark { width: 104px; height: 38px; flex: 0 0 auto; color: #0D0E12; }
.riff-home h1 { width: fit-content; max-width: 100%; color: #202124; font-size: 40px; font-weight: 600; line-height: 48px; letter-spacing: -.02em; text-align: center; text-wrap: balance; }
.riff-home__composer { display: flex; width: 760px; max-width: 100%; flex-direction: column; gap: 12px; padding: 14px; border: 0; border-radius: 20px; background: #EFF4FF; box-shadow: 0 3px 6px #20355608, 0 12px 24px #20355610; }
.riff-home__label { display: none; }
.riff-home__chips { display: flex; width: 100%; flex-wrap: wrap; justify-content: center; gap: 8px; }
.riff-home__chip, .riff-home__upload, .riff-home__submit, .riff-home__recent-next, .riff-home__recent-card { appearance: none; border: 0; cursor: pointer; }
.riff-home__chip { display: flex; height: 32px; flex: 0 0 auto; align-items: center; justify-content: center; gap: 6px; padding: 6px 12px; border: 1px solid #DDE5F1; border-radius: 999px; color: #425779; background: #FFFFFFA6; font-size: 12px; font-weight: 400; line-height: 18px; }
.riff-home__chip svg { width: 14px; height: 14px; flex: 0 0 auto; }
.riff-home__input-shell { display: flex; width: 100%; flex-direction: column; gap: 22px; padding: 18px; border: 1px solid #DDE5F4; border-radius: 14px; background: #FFFFFF; }
.riff-home__composer textarea { display: block; width: 100%; height: 22px; min-height: 22px; resize: none; overflow: auto; padding: 0; border: 0; outline: 0; color: #242426; background: transparent; font-size: 15px; line-height: 22px; }
.riff-home__composer textarea::placeholder { color: #687386; opacity: 1; }
.riff-home__composer-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.riff-home__upload { display: flex; min-width: 0; align-items: center; gap: 7px; padding: 0; color: #566279; background: transparent; font-size: 13px; font-weight: 400; line-height: 20px; }
.riff-home__upload svg { width: 16px; height: 16px; flex: 0 0 auto; }
.riff-home__submit { display: flex; height: 40px; flex: 0 0 auto; align-items: center; justify-content: center; padding: 0 22px; border-radius: 999px; color: #FFFFFF; background: linear-gradient(in oklab 180deg, oklab(60.9% -0.012 -0.211) 0%, oklab(56.7% -0.015 -0.224) 100%); box-shadow: inset 0 1px 0 #FFFFFF40, 0 2px 3px #254BCC33, 0 6px 12px #3865F840; font-size: 14px; font-weight: 600; line-height: 20px; }
.riff-home__composer textarea:focus-visible { outline: 3px solid var(--color-ring-primary, #3865F8); outline-offset: 3px; border-radius: 2px; }
.riff-home__chip:disabled, .riff-home__upload:disabled, .riff-home__submit:disabled, .riff-home__recent-next:disabled, .riff-home__recent-card:disabled { cursor: wait; opacity: .62; }
.riff-home__status { width: 760px; max-width: 100%; color: #596273; font-size: 13px; line-height: 19px; text-align: left; }
.riff-home__status:empty { display: none; }
.riff-home__section { display: flex; width: 760px; max-width: 100%; flex-direction: column; gap: 12px; padding-top: 8px; }
.riff-home__section-head { display: flex; align-items: center; justify-content: space-between; }
.riff-home__section h2 { color: #202124; font-size: 15px; font-weight: 600; line-height: 22px; letter-spacing: 0; }
.riff-home__recent-next { display: flex; width: 32px; height: 32px; flex: 0 0 auto; align-items: center; justify-content: center; padding: 0; border: 1px solid #E3E8F1; border-radius: 999px; color: #35578B; background: #F3F6FC; box-shadow: 0 2px 4px #2035560A; }
.riff-home__recent-next svg { width: 16px; height: 16px; flex: 0 0 auto; }
.riff-home__recents { display: flex; width: 100%; gap: 14px; overflow-x: auto; padding: 2px 0 12px 2px; scrollbar-width: none; scroll-snap-type: x proximity; }
.riff-home__recents::-webkit-scrollbar { display: none; }
.riff-home__recent-card { display: flex; width: 220px; min-width: 0; flex: 0 0 220px; align-items: center; gap: 10px; padding: 12px; border: 1px solid #E4E8EF; border-radius: 14px; color: #242931; text-align: left; background: #FFFFFF; box-shadow: 0 2px 4px #18243A07, 0 5px 12px #18243A09; scroll-snap-align: start; }
.riff-home__recent-source { position: relative; display: flex; width: 36px; height: 40px; flex: 0 0 auto; }
.riff-home__recent-thumbnail { width: 32px; height: 36px; flex: 0 0 auto; border: 2px solid #FFFFFF; border-radius: 8px; background: #F3F6FC; box-shadow: 0 1px 3px #18243A14; }
.riff-home__platform { position: absolute; z-index: 2; top: 24px; left: 22px; display: flex; width: 16px; height: 16px; align-items: center; justify-content: center; border: 2px solid #FFFFFF; border-radius: 999px; background: #101114; box-shadow: 0 1px 3px #18243A20; }
.riff-home__platform svg { width: 12px; height: 12px; flex: 0 0 auto; }
.riff-home__recent-copy { display: flex; min-width: 0; flex: 1 1 0; flex-direction: column; gap: 3px; }
.riff-home__recent-title { display: -webkit-box; overflow: hidden; color: #242931; font-size: 13px; font-weight: 600; line-height: 18px; -webkit-box-orient: vertical; -webkit-line-clamp: 1; }
.riff-home__recent-stage { color: #667285; font-size: 11px; font-weight: 400; line-height: 16px; }
.riff-home__recent-state { flex: 0 0 auto; padding: 12px 0; color: #667285; font-size: 13px; line-height: 18px; }
.riff-home__workflow { width: 100%; min-height: 100vh; background: #FFFFFF; }
@media (max-width: 480px) {
  .riff-home__home { padding-inline: calc(16px + var(--riff-safe-left, 0px)) calc(16px + var(--riff-safe-right, 0px)); }
  .riff-home h1 { font-size: 34px; line-height: 41px; }
  .riff-home__composer-footer { align-items: stretch; flex-direction: column; }
  .riff-home__upload, .riff-home__submit { width: 100%; justify-content: center; }
}
`;

const libraries = [
  ['videos', 'Trending videos', 'Add a public TikTok profile or video link below. Riff will analyze it, then find evidence-backed video directions here.'],
  ['hooks', 'Hooks', 'Hook analysis starts from a public TikTok profile or video link. Add one below to keep the workflow inside Riff.'],
  ['showcases', 'Product showcases', 'Showcase analysis starts from a public TikTok profile or video link. Add one below to keep the workflow inside Riff.'],
  ['ctas', 'Calls to action', 'CTA analysis starts from a public TikTok profile or video link. Add one below to keep the workflow inside Riff.'],
] as const;

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgNode<K extends keyof SVGElementTagNameMap>(
  doc: Document,
  tag: K,
  attributes: Record<string, string>,
): SVGElementTagNameMap[K] {
  const element = doc.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

function iconRoot(doc: Document) {
  return svgNode(doc, 'svg', {
    xmlns: SVG_NS,
    width: '16',
    height: '16',
    viewBox: '0 0 24 24',
    'aria-hidden': 'true',
    focusable: 'false',
  });
}

function paperShortcutIcon(doc: Document, kind: typeof libraries[number][0]) {
  const svg = iconRoot(doc);
  const shared = {
    fill: 'none',
    stroke: '#5375BC',
    'stroke-width': '1.7',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  };
  if (kind === 'videos') svg.append(
    svgNode(doc, 'path', { ...shared, d: 'm3 17 6-6 4 3 8-10' }),
    svgNode(doc, 'path', { ...shared, d: 'M15 4h6v6' }),
  );
  if (kind === 'hooks') svg.append(svgNode(doc, 'path', { ...shared, d: 'm13 2-9 12h7l-1 8 10-12h-7l1-8Z' }));
  if (kind === 'showcases') svg.append(
    svgNode(doc, 'rect', { ...shared, x: '4', y: '6', width: '16', height: '15', rx: '3' }),
    svgNode(doc, 'path', { ...shared, d: 'M8 7V5a4 4 0 0 1 8 0v2' }),
  );
  if (kind === 'ctas') svg.append(svgNode(doc, 'path', { ...shared, d: 'm5 3 14 9-7 1-3 7-4-17Z' }));
  return svg;
}

function paperUploadIcon(doc: Document) {
  const svg = iconRoot(doc);
  svg.append(svgNode(doc, 'path', {
    d: 'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6',
    fill: 'none',
    stroke: 'rgb(86 98 121)',
    'stroke-width': '1.7',
  }));
  return svg;
}

function paperRecentArrow(doc: Document) {
  const svg = iconRoot(doc);
  svg.append(svgNode(doc, 'path', {
    d: 'M5 12h14m-6-6 6 6-6 6',
    fill: 'none',
    stroke: '#35578B',
    'stroke-width': '1.7',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  }));
  return svg;
}

function tiktokBadge(doc: Document) {
  const svg = iconRoot(doc);
  const d = 'M14 3h3c.4 2.4 1.7 3.8 4 4v3a9 9 0 0 1-4-1v7a6 6 0 1 1-6-6v3a3 3 0 1 0 3 3V3Z';
  svg.append(
    svgNode(doc, 'path', { transform: 'translate(-1 .7)', d, fill: '#25F4EE' }),
    svgNode(doc, 'path', { transform: 'translate(1 -.3)', d, fill: '#FE2C55' }),
    svgNode(doc, 'path', { d, fill: '#FFFFFF' }),
  );
  return svg;
}

export function mountRiffHome(root: HTMLElement, actions: RiffHomeActions): {
  render(state: RiffHomeState): void;
  setRecents(items: RiffRecentWork[]): void;
  setRecentsState(state: RiffRecentsState): void;
  setBusy(message: string): void;
  showJob(job: CreatorJobView): void;
  showHome(): void;
  dispose(): void;
} {
  const doc = root.ownerDocument;
  let invocationEpoch = 0;
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className = '') => {
    const item = doc.createElement(tag); item.className = className;
    if (text !== undefined) item.textContent = text;
    return item;
  };
  const style = node('style'); style.textContent = homeStyles;
  const app = node('main', undefined, 'riff-app riff-home');
  const account = node('p', 'Connecting…', 'riff-home__account');
  const home = node('section', undefined, 'riff-home__home');
  const hero = node('section', undefined, 'riff-home__hero');
  const heroBrand = node('div', undefined, 'riff-home__hero-mark'); heroBrand.append(riffLockup(doc));
  hero.append(heroBrand, node('h1', 'Let’s make your next video go viral.'));

  const form = node('form', undefined, 'riff-home__composer'); form.setAttribute('aria-label', 'Start with Riff');
  const label = node('label', 'Your next video starts here', 'riff-home__label');
  const input = node('textarea'); input.id = 'riff-home-input'; label.htmlFor = input.id;
  input.setAttribute('aria-label', 'Your next video starts here');
  input.placeholder = 'Share a video or profile link, or tell me what you want to make…';
  const chips = node('div', undefined, 'riff-home__chips');
  const libraryControls: HTMLButtonElement[] = [];
  for (const [kind, title, guidance] of libraries) {
    const chip = node('button', undefined, 'riff-home__chip'); chip.type = 'button'; chip.dataset.library = kind;
    chip.append(paperShortcutIcon(doc, kind), node('span', title));
    chip.setAttribute('aria-pressed', 'false');
    chip.addEventListener('click', () => {
      if (disposed) return;
      invocationEpoch++;
      for (const control of libraryControls) control.setAttribute('aria-pressed', String(control === chip));
      status.textContent = guidance;
      input.focus({ preventScroll: true });
    });
    libraryControls.push(chip); chips.append(chip);
  }
  const inputShell = node('div', undefined, 'riff-home__input-shell');
  const footer = node('div', undefined, 'riff-home__composer-footer');
  const upload = node('button', undefined, 'riff-home__upload'); upload.type = 'button';
  upload.append(paperUploadIcon(doc), node('span', 'Upload a video'));
  const submit = node('button', 'Find my next idea', 'riff-home__submit'); submit.type = 'submit';
  footer.append(upload, submit); inputShell.append(input, footer); form.append(label, chips, inputShell);
  const status = node('p', '', 'riff-home__status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');

  const recentSection = node('section', undefined, 'riff-home__section');
  recentSection.setAttribute('aria-labelledby', 'riff-home-recents-title');
  const recentHead = node('div', undefined, 'riff-home__section-head');
  const recentNext = node('button', undefined, 'riff-home__recent-next'); recentNext.type = 'button';
  recentNext.setAttribute('aria-label', 'View recent work'); recentNext.append(paperRecentArrow(doc));
  const recentTitle = node('h2', 'Pick up where you left off'); recentTitle.id = 'riff-home-recents-title';
  recentHead.append(recentTitle, recentNext);
  const recents = node('div', undefined, 'riff-home__recents');
  recentSection.append(recentHead, recents);
  home.append(hero, form, status, recentSection);

  const workflow = node('section', undefined, 'riff-home__workflow'); workflow.hidden = true;
  const workflowRoot = node('div'); workflow.append(workflowRoot);
  app.append(account, home, workflow); root.replaceChildren(style, app);

  let disposed = false;
  let pipeline: ReturnType<typeof mountCreatorPipeline> | undefined;
  let recentsState: RiffRecentsState = { status: 'loading' };
  const invoke = async (action: () => Promise<RiffActionResult>, pending: string, control?: HTMLButtonElement) => {
    if (disposed) return;
    const epoch = ++invocationEpoch;
    status.textContent = pending;
    if (control) control.disabled = true;
    try {
      const result = await action();
      if (!disposed && epoch === invocationEpoch) status.textContent = result.message;
    } catch {
      if (!disposed && epoch === invocationEpoch) status.textContent = 'Riff could not complete that action. Continue in the ChatGPT conversation.';
    }
    finally { if (control) control.disabled = false; }
  };
  const showHome = () => {
    if (disposed) return;
    invocationEpoch++;
    if (!home.isConnected) app.insertBefore(home, workflow);
    home.hidden = false; workflow.hidden = true;
  };

  form.addEventListener('submit', event => {
    event.preventDefault(); const value = input.value.trim();
    if (!value) { status.textContent = 'Add a video link, profile link, or idea first.'; input.focus(); return; }
    void invoke(() => actions.start(value), 'Starting your Riff analysis…', submit);
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) form.requestSubmit();
  });
  input.addEventListener('input', () => actions.inputChanged?.(input.value));
  upload.addEventListener('click', () => void invoke(
    actions.upload ?? (() => actions.send('I want to analyze a video with Riff. Help me attach it through ChatGPT, and do not claim it was uploaded until the host confirms the file.')),
    'Opening the ChatGPT file picker…',
    upload,
  ));

  recentNext.addEventListener('click', () => {
    if (disposed) return;
    if (recentsState.status === 'error' && actions.refreshRecents) {
      void invoke(actions.refreshRecents, 'Refreshing recent work…', recentNext);
      return;
    }
    recents.scrollBy({ left: 234, behavior: 'smooth' });
  });

  function renderRecentsState(state: RiffRecentsState) {
    recentsState = state;
    recents.replaceChildren();
    recents.setAttribute('aria-busy', String(state.status === 'loading'));
    if (state.status === 'loading') {
      recents.append(node('p', 'Loading recent work…', 'riff-home__recent-state')); return;
    }
    if (state.status === 'error') {
      recents.append(node('p', state.message, 'riff-home__recent-state')); return;
    }
    const items = state.items;
    if (!items.length) {
      recents.append(node('p', 'No recent work yet.', 'riff-home__recent-state')); return;
    }
    for (const item of items.slice(0, 4)) {
      const card = node('button', undefined, 'riff-home__recent-card'); card.type = 'button';
      card.setAttribute('aria-label', `Open ${item.title} — ${item.stage}`);
      const source = node('span', undefined, 'riff-home__recent-source');
      source.append(node('span', undefined, 'riff-home__recent-thumbnail'));
      if (item.platform === 'tiktok') {
        const platform = node('span', undefined, 'riff-home__platform');
        platform.setAttribute('aria-hidden', 'true'); platform.append(tiktokBadge(doc)); source.append(platform);
      }
      const copy = node('span', undefined, 'riff-home__recent-copy');
      copy.append(node('span', item.title, 'riff-home__recent-title'), node('span', item.stage, 'riff-home__recent-stage'));
      card.append(source, copy);
      card.addEventListener('click', () => void invoke(
        actions.openRecent ? () => actions.openRecent!(item.job_id) : () => actions.send(`Open my saved Riff work, “${item.title}”.`),
        `Opening ${item.title}…`,
        card,
      ));
      recents.append(card);
    }
  }
  renderRecentsState({ status: 'loading' });

  return {
    render(state) {
      if (disposed) return;
      if (state.status === 'loading') { account.textContent = 'Connecting…'; return; }
      if (state.status === 'error') { account.textContent = 'Account unavailable'; status.textContent = state.message; return; }
      account.textContent = `Ready, ${state.account.name}`;
      if (/Reconnect|incomplete|could not/i.test(status.textContent)) status.textContent = '';
    },
    setRecents(items) { if (!disposed) renderRecentsState({ status: 'ready', items }); },
    setRecentsState(state) { if (!disposed) renderRecentsState(state); },
    setBusy(message) { if (!disposed) status.textContent = message; },
    showJob(job) {
      if (disposed) return;
      invocationEpoch++;
      input.value = '';
      home.remove(); workflow.hidden = false;
      pipeline ??= mountCreatorPipeline(workflowRoot, {
        displayMode: 'fullscreen', sendPrompt: actions.send,
        requestFullscreen: async () => ({ status: 'sent', message: 'Already open in Riff.' }),
        startRecommendations: actions.startRecommendations,
        makeMine: actions.makeMine,
        setVariantState: actions.setVariantState,
      });
      pipeline.render(job);
      workflow.scrollIntoView({ block: 'start' });
    },
    showHome,
    dispose() {
      if (disposed) return; disposed = true; pipeline?.dispose(); pipeline = undefined; root.replaceChildren();
    },
  };
}
