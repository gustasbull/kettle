import type { CreatorJobView } from '../../../packages/contracts/creator-pipeline.ts';
import { mountCreatorPipeline } from '../creator-pipeline/index.ts';
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
};

export type RiffRecentsState =
  | { status: 'loading' }
  | { status: 'ready'; items: RiffRecentWork[] }
  | { status: 'error'; message: string };

type RecommendationResult = Extract<NonNullable<CreatorJobView['result']>, { kind: 'recommendations' }>;
type ScriptResult = Extract<NonNullable<CreatorJobView['result']>, { kind: 'scripts' }>;

export type RiffHomeActions = {
  start(source: string): Promise<RiffActionResult>;
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
  makeMine?: (context: {
    job: CreatorJobView;
    batch: RecommendationResult['batch'];
    idea: RecommendationResult['batch']['ideas'][number];
  }) => Promise<RiffActionResult>;
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
html, body { margin: 0; min-height: 100%; background: var(--riff-canvas, #F4F5F7); }
body { min-height: 100vh; }
.riff-home { min-height: 100vh; padding: calc(12px + var(--riff-safe-top, 0px)) calc(12px + var(--riff-safe-right, 0px)) calc(12px + var(--riff-safe-bottom, 0px)) calc(12px + var(--riff-safe-left, 0px)); background: var(--riff-canvas); }
.riff-home__frame { position: relative; min-height: calc(100vh - 24px); overflow: hidden; border-radius: 24px; background: var(--riff-surface); box-shadow: 0 2px 4px #18243A0A, 0 12px 24px #18243A14; }
.riff-home__chrome { position: sticky; z-index: 5; top: 0; display: grid; grid-template-columns: minmax(140px, 1fr) auto minmax(140px, 1fr); align-items: center; gap: 18px; min-height: 72px; padding: 16px 24px 8px; border-bottom: 1px solid var(--riff-line); background: color-mix(in srgb, var(--riff-surface) 94%, transparent); backdrop-filter: blur(18px); }
.riff-home__identity { display: flex; min-width: 0; align-items: center; gap: 14px; }
.riff-home__brand { width: 76px; height: 28px; flex: 0 0 auto; color: var(--riff-ink); }
.riff-home__breadcrumb { min-width: 0; overflow: hidden; color: var(--riff-muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.riff-home__nav { display: flex; align-items: center; justify-content: center; gap: 4px; padding: 4px; border-radius: var(--riff-radius-control); background: #F4F5F7; }
.riff-home__nav button, .riff-home__create, .riff-home__menu-button, .riff-home__chip, .riff-home__upload, .riff-home__submit, .riff-home__recent-card, .riff-home__menu-item, .riff-home__empty-action { border: 0; color: var(--riff-ink); background: transparent; cursor: pointer; }
.riff-home__nav button { min-height: 34px; padding: 6px 14px; border-radius: var(--riff-radius-control); color: var(--riff-muted); font-size: 13px; font-weight: 600; }
.riff-home__nav button[aria-current="page"] { color: var(--riff-ink); background: var(--riff-surface); box-shadow: 0 1px 3px #18243A18; }
.riff-home__actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.riff-home__create { min-height: 38px; padding: 8px 15px; border-radius: var(--riff-radius-control); color: #fff; background: var(--riff-primary); font-size: 13px; font-weight: 700; box-shadow: 0 6px 12px #3865F830; }
.riff-home__menu-button { width: 38px; height: 38px; display: grid; place-items: center; border: 1px solid var(--riff-line); border-radius: 50%; font-weight: 750; }
.riff-home__account { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.riff-home__body { min-height: calc(100vh - 96px); padding: clamp(28px, 5vw, 52px) clamp(20px, 5vw, 52px) 52px; }
.riff-home__home, .riff-home__workflow { width: min(100%, 999px); margin: 0 auto; }
.riff-home__hero { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: clamp(20px, 4vw, 44px) 0 26px; text-align: center; }
.riff-home__hero-mark { width: 68px; height: 25px; color: var(--riff-ink); }
.riff-home h1 { max-width: 780px; font-size: clamp(31px, 4.2vw, 46px); font-weight: 700; line-height: 1.08; letter-spacing: -.05em; text-wrap: balance; }
.riff-home__intro { max-width: 620px; color: var(--riff-muted); font-size: 14px; line-height: 21px; }
.riff-home__composer { width: min(100%, 760px); margin: 0 auto; padding: 12px; border: 1px solid #DFE7F6; border-radius: 20px; background: #EFF4FF; box-shadow: 0 3px 6px #2035560A, 0 12px 24px #20355614; }
.riff-home__label { display: block; padding: 4px 8px 10px; color: #425779; font-size: 12px; font-weight: 700; }
.riff-home__chips { display: flex; overflow-x: auto; gap: 8px; padding: 0 0 10px; scrollbar-width: none; }
.riff-home__chips::-webkit-scrollbar { display: none; }
.riff-home__chip { min-height: 32px; flex: 0 0 auto; padding: 6px 12px; border: 1px solid #DDE5F1; border-radius: var(--riff-radius-control); color: #425779; background: rgba(255,255,255,.8); font-size: 12px; font-weight: 600; }
.riff-home__input-shell { overflow: hidden; border: 1px solid #DDE5F4; border-radius: 14px; background: var(--riff-surface); }
.riff-home__composer textarea { display: block; width: 100%; min-height: 82px; resize: vertical; padding: 17px 18px 8px; border: 0; outline: 0; color: var(--riff-ink); background: transparent; line-height: 22px; }
.riff-home__composer textarea::placeholder { color: var(--riff-muted); opacity: 1; }
.riff-home__composer-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 4px 10px 10px 18px; }
.riff-home__upload { min-height: 40px; padding: 8px 0; color: var(--riff-muted); font-size: 13px; }
.riff-home__submit { min-height: 40px; padding: 8px 18px; border-radius: var(--riff-radius-control); color: #fff; background: var(--riff-primary); font-size: 13px; font-weight: 700; box-shadow: 0 6px 12px #3865F830; }
.riff-home__status { width: min(100%, 760px); min-height: 22px; margin: 10px auto 0 !important; color: var(--riff-muted); font-size: 13px; text-align: left; }
.riff-home__section { padding-top: 42px; }
.riff-home__section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 15px; }
.riff-home__section h2 { font-size: 20px; line-height: 26px; letter-spacing: -.025em; }
.riff-home__section-note { color: var(--riff-muted); font-size: 12px; }
.riff-home__recents { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.riff-home__recent-card { min-width: 0; min-height: 118px; padding: 16px; border: 1px solid var(--riff-line); border-radius: var(--riff-radius-surface); text-align: left; background: var(--riff-surface); box-shadow: 0 2px 4px #18243A0A; }
.riff-home__recent-card:hover { border-color: #C7D3EA; transform: translateY(-1px); }
.riff-home__recent-title { display: block; overflow: hidden; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.riff-home__recent-stage { display: block; margin-top: 4px; color: var(--riff-muted); font-size: 13px; }
.riff-home__recent-time { display: block; margin-top: 22px; color: #8B8D93; font-size: 11px; }
.riff-home__empty { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 22px; border: 1px solid var(--riff-line); border-radius: var(--riff-radius-surface); background: var(--riff-surface); }
.riff-home__empty p { margin-top: 4px; color: var(--riff-muted); font-size: 13px; }
.riff-home__empty-action { min-height: 40px; flex: 0 0 auto; padding: 8px 15px; border: 1px solid var(--riff-line); border-radius: var(--riff-radius-control); font-weight: 650; }
.riff-home__recent-state { color: var(--riff-muted); font-size: 13px; }
.riff-home__recent-state strong { display: block; color: var(--riff-ink); font-size: 14px; }
.riff-home__workflow { min-height: 540px; }
.riff-home__workflow-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
.riff-home__workflow-label { color: var(--riff-muted); font-size: 12px; }
.riff-home__workflow-meta { display: flex; min-width: 0; align-items: center; justify-content: flex-end; gap: 10px; }
.riff-home__job-id { max-width: min(48vw, 390px); overflow: hidden; color: var(--riff-muted); font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; text-overflow: ellipsis; white-space: nowrap; }
.riff-home__refresh { min-height: 36px; padding: 7px 13px; border: 1px solid var(--riff-line); border-radius: var(--riff-radius-control); color: var(--riff-ink); background: var(--riff-surface); cursor: pointer; font-size: 12px; font-weight: 700; }
.riff-home__workflow-status { min-height: 18px; color: var(--riff-muted); font-size: 12px; text-align: right; }
.riff-home__menu { position: absolute; z-index: 10; top: 64px; right: 20px; width: min(288px, calc(100% - 40px)); padding: 10px; border: 1px solid var(--riff-line); border-radius: 18px; background: var(--riff-surface); box-shadow: 0 12px 32px #18243A24; }
.riff-home__menu-item { display: flex; width: 100%; min-height: 42px; align-items: center; justify-content: space-between; padding: 9px 12px; border-radius: 10px; text-align: left; font-size: 13px; }
.riff-home__menu-item:hover { background: var(--riff-canvas); }
.riff-home__menu-rule { height: 1px; margin: 7px 4px; background: var(--riff-line); }
@media (max-width: 820px) {
  .riff-home__chrome { grid-template-columns: 1fr auto; padding-inline: 16px; }
  .riff-home__nav { grid-column: 1 / -1; grid-row: 2; justify-self: stretch; overflow-x: auto; }
  .riff-home__nav button { flex: 1 0 auto; }
  .riff-home__breadcrumb { display: none; }
  .riff-home__body { min-height: calc(100vh - 134px); padding-top: 24px; }
  .riff-home__recents { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 480px) {
  .riff-home { padding: 0; }
  .riff-home__frame { min-height: 100vh; border-radius: 0; }
  .riff-home__chrome { padding: 12px 14px 8px; gap: 10px; }
  .riff-home__brand { width: 65px; }
  .riff-home__create { min-height: 36px; padding-inline: 12px; }
  .riff-home__body { padding: 18px 14px 36px; }
  .riff-home__hero { align-items: flex-start; padding-top: 18px; text-align: left; }
  .riff-home__hero-mark { display: none; }
  .riff-home h1 { font-size: 34px; }
  .riff-home__composer { padding: 9px; border-radius: 17px; }
  .riff-home__composer-footer { align-items: stretch; flex-direction: column; padding-left: 10px; }
  .riff-home__upload, .riff-home__submit { width: 100%; }
  .riff-home__recents { grid-template-columns: 1fr; }
  .riff-home__empty { align-items: flex-start; flex-direction: column; }
  .riff-home__workflow-head { align-items: flex-start; flex-direction: column; }
  .riff-home__workflow-meta { width: 100%; justify-content: space-between; }
  .riff-home__job-id { max-width: calc(100vw - 120px); }
}
`;

const libraries = [
  ['videos', 'Trending videos', 'evidence-backed trending videos'],
  ['hooks', 'Hooks', 'opening hooks'],
  ['showcases', 'Product showcases', 'product showcases'],
  ['ctas', 'Calls to action', 'calls to action'],
] as const;

function formatRelativeDate(value: string) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return 'Saved work';
  const delta = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
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
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className = '') => {
    const item = doc.createElement(tag); item.className = className;
    if (text !== undefined) item.textContent = text;
    return item;
  };
  const style = node('style'); style.textContent = homeStyles;
  const app = node('main', undefined, 'riff-app riff-home');
  const frame = node('div', undefined, 'riff-home__frame');
  const chrome = node('header', undefined, 'riff-home__chrome');
  const identity = node('div', undefined, 'riff-home__identity');
  const brand = node('div', undefined, 'riff-home__brand'); brand.append(riffLockup(doc));
  const breadcrumb = node('p', 'Riff / Home', 'riff-home__breadcrumb');
  const account = node('p', 'Connecting…', 'riff-home__account');
  identity.append(brand, breadcrumb, account);
  const nav = node('nav', undefined, 'riff-home__nav'); nav.setAttribute('aria-label', 'Riff navigation');
  const navButtons = new Map<string, HTMLButtonElement>();
  for (const label of ['Home', 'Discover', 'Studio'] as const) {
    const control = node('button', label); control.type = 'button';
    if (label === 'Home') control.setAttribute('aria-current', 'page');
    nav.append(control); navButtons.set(label, control);
  }
  const headerActions = node('div', undefined, 'riff-home__actions');
  const create = node('button', 'Create a video', 'riff-home__create'); create.type = 'button';
  const menuButton = node('button', 'R', 'riff-home__menu-button'); menuButton.type = 'button';
  menuButton.setAttribute('aria-label', 'Open Riff menu'); menuButton.setAttribute('aria-expanded', 'false');
  headerActions.append(create, menuButton); chrome.append(identity, nav, headerActions);

  const menu = node('div', undefined, 'riff-home__menu'); menu.hidden = true; menu.setAttribute('role', 'menu');
  const menuItem = (label: string, handler: () => void) => {
    const item = node('button', label, 'riff-home__menu-item'); item.type = 'button'; item.setAttribute('role', 'menuitem');
    item.addEventListener('click', () => { menu.hidden = true; menuButton.setAttribute('aria-expanded', 'false'); handler(); });
    menu.append(item); return item;
  };

  const body = node('div', undefined, 'riff-home__body');
  const home = node('section', undefined, 'riff-home__home');
  const hero = node('section', undefined, 'riff-home__hero');
  const heroBrand = node('div', undefined, 'riff-home__hero-mark'); heroBrand.append(riffLockup(doc));
  hero.append(heroBrand, node('h1', 'Let’s make your next video go viral.'),
    node('p', 'Start with a video, a profile, or an idea. Riff keeps the analysis, discovery, and making flow together.', 'riff-home__intro'));

  const form = node('form', undefined, 'riff-home__composer'); form.setAttribute('aria-label', 'Start with Riff');
  const label = node('label', 'Your next video starts here', 'riff-home__label');
  const input = node('textarea'); input.id = 'riff-home-input'; label.htmlFor = input.id;
  input.placeholder = 'Share a video or profile link, or tell me what you want to make…';
  const chips = node('div', undefined, 'riff-home__chips');
  for (const [kind, title, request] of libraries) {
    const chip = node('button', title, 'riff-home__chip'); chip.type = 'button'; chip.dataset.library = kind;
    chip.addEventListener('click', () => void invoke(() => actions.send(
      `Use Riff to explore ${request} for my next creator video. Ground suggestions in my saved creator context and current evidence.`,
    ), `Opening ${title.toLowerCase()} in ChatGPT…`));
    chips.append(chip);
  }
  const inputShell = node('div', undefined, 'riff-home__input-shell');
  const footer = node('div', undefined, 'riff-home__composer-footer');
  const upload = node('button', 'Upload a video', 'riff-home__upload'); upload.type = 'button';
  const submit = node('button', 'Find my next idea', 'riff-home__submit'); submit.type = 'submit';
  footer.append(upload, submit); inputShell.append(input, footer); form.append(label, chips, inputShell);
  const status = node('p', '', 'riff-home__status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');

  const recentSection = node('section', undefined, 'riff-home__section');
  const recentHead = node('div', undefined, 'riff-home__section-head');
  recentHead.append(node('h2', 'Pick up where you left off'), node('span', 'Your latest saved Riff work', 'riff-home__section-note'));
  const recents = node('div', undefined, 'riff-home__recents');
  recentSection.append(recentHead, recents);
  home.append(hero, form, status, recentSection);

  const workflow = node('section', undefined, 'riff-home__workflow'); workflow.hidden = true;
  const workflowHead = node('div', undefined, 'riff-home__workflow-head');
  const workflowLabel = node('p', 'Riff / Creator workflow', 'riff-home__workflow-label');
  const workflowMeta = node('div', undefined, 'riff-home__workflow-meta');
  workflowHead.append(workflowLabel, workflowMeta);
  const workflowStatus = node('p', '', 'riff-home__workflow-status');
  workflowStatus.setAttribute('role', 'status'); workflowStatus.setAttribute('aria-live', 'polite');
  const workflowRoot = node('div'); workflow.append(workflowHead, workflowRoot);
  workflow.append(workflowStatus);
  body.append(home, workflow); frame.append(chrome, menu, body); app.append(frame); root.replaceChildren(style, app);

  let disposed = false;
  let pipeline: ReturnType<typeof mountCreatorPipeline> | undefined;
  let currentJob: CreatorJobView | undefined;
  const setCurrentNav = (label: 'Home' | 'Discover' | 'Studio') => {
    for (const [name, control] of navButtons) {
      if (name === label) control.setAttribute('aria-current', 'page'); else control.removeAttribute('aria-current');
    }
    breadcrumb.textContent = label === 'Home' ? 'Riff / Home' : `Riff / ${label}`;
  };
  const disableControls = (disabled: boolean) => {
    const controls = new Set<HTMLButtonElement | HTMLTextAreaElement>([
      ...app.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>('button, textarea'),
      ...home.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>('button, textarea'),
    ]);
    for (const control of controls) control.disabled = disabled;
  };
  const invoke = async (action: () => Promise<RiffActionResult>, pending: string) => {
    if (disposed) return;
    status.textContent = pending; disableControls(true);
    try { status.textContent = (await action()).message; }
    catch { status.textContent = 'Riff could not complete that action. Continue in the ChatGPT conversation.'; }
    finally { disableControls(false); }
  };
  const showHome = () => {
    if (disposed) return;
    if (!home.isConnected) body.insertBefore(home, workflow);
    home.hidden = false; workflow.hidden = true; setCurrentNav('Home');
  };
  const startNew = () => { showHome(); input.focus({ preventScroll: true }); input.scrollIntoView({ block: 'center' }); };
  create.addEventListener('click', startNew);
  navButtons.get('Home')!.addEventListener('click', showHome);
  navButtons.get('Discover')!.addEventListener('click', () => {
    if (currentJob?.result?.kind === 'recommendations') { home.hidden = true; workflow.hidden = false; setCurrentNav('Discover'); }
    else void invoke(() => actions.send('Open Riff discovery for my current creator work. If no analyzed creator context is saved, ask me to start with a video or profile.'), 'Opening discovery in ChatGPT…');
  });
  navButtons.get('Studio')!.addEventListener('click', () => {
    if (currentJob?.result?.kind === 'scripts') { home.hidden = true; workflow.hidden = false; setCurrentNav('Studio'); }
    else void invoke(() => actions.send('Open Riff Studio for my current saved script. If no script is saved, help me choose a discovery idea first.'), 'Opening Studio in ChatGPT…');
  });
  menuButton.addEventListener('click', () => {
    menu.hidden = !menu.hidden; menuButton.setAttribute('aria-expanded', String(!menu.hidden));
  });
  menuItem('Home', showHome);
  menuItem('Discover videos', () => navButtons.get('Discover')!.click());
  menuItem('Recents', () => { showHome(); recentSection.scrollIntoView({ block: 'start' }); });
  menu.append(node('div', undefined, 'riff-home__menu-rule'));
  menuItem('How Riff works', () => void invoke(
    actions.showWelcome ?? (() => actions.send('Show me the Riff welcome guide in this ChatGPT conversation.')),
    'Requesting the welcome guide in ChatGPT…',
  ));
  menuItem('Support', () => void invoke(() => actions.send('I need help using Riff. Diagnose the current step and give me one recovery action.'), 'Opening support in ChatGPT…'));

  form.addEventListener('submit', event => {
    event.preventDefault(); const value = input.value.trim();
    if (!value) { status.textContent = 'Add a video link, profile link, or idea first.'; input.focus(); return; }
    void invoke(() => actions.start(value), 'Starting your Riff analysis…');
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) form.requestSubmit();
  });
  upload.addEventListener('click', () => void invoke(
    actions.upload ?? (() => actions.send('I want to analyze a video with Riff. Help me attach it through ChatGPT, and do not claim it was uploaded until the host confirms the file.')),
    'Opening the ChatGPT file picker…',
  ));

  function renderRecentsState(state: RiffRecentsState) {
    recents.replaceChildren();
    recents.style.display = 'block';
    if (state.status === 'loading') {
      const loading = node('div', undefined, 'riff-home__empty riff-home__recent-state');
      loading.append(node('strong', 'Loading recent work…'), node('p', 'Reading your saved Riff jobs.'));
      recents.append(loading); return;
    }
    if (state.status === 'error') {
      const error = node('div', undefined, 'riff-home__empty riff-home__recent-state');
      const copy = node('div'); copy.append(node('strong', 'Recent work is unavailable.'), node('p', state.message));
      const retry = node('button', 'Try again', 'riff-home__empty-action'); retry.type = 'button';
      retry.addEventListener('click', () => void invoke(
        actions.refreshRecents ?? (async () => ({ status: 'unsupported', message: 'Reopen Riff Home to retry recent work.' })),
        'Refreshing recent work…',
      ));
      error.append(copy, retry); recents.append(error); return;
    }
    const items = state.items;
    if (!items.length) {
      const empty = node('div', undefined, 'riff-home__empty');
      const copy = node('div'); copy.append(node('strong', 'No recent work yet.'), node('p', 'Start with a public creator video or profile. Your saved analysis will appear here.'));
      const action = node('button', 'Start a video', 'riff-home__empty-action'); action.type = 'button'; action.addEventListener('click', startNew);
      empty.append(copy, action); recents.append(empty); recents.style.display = 'block'; return;
    }
    recents.style.display = '';
    for (const item of items.slice(0, 4)) {
      const card = node('button', undefined, 'riff-home__recent-card'); card.type = 'button';
      card.setAttribute('aria-label', `Open ${item.title} — ${item.stage}`);
      card.append(node('span', item.title, 'riff-home__recent-title'), node('span', item.stage, 'riff-home__recent-stage'),
        node('span', formatRelativeDate(item.updated_at), 'riff-home__recent-time'));
      card.addEventListener('click', () => void invoke(
        actions.openRecent ? () => actions.openRecent!(item.job_id) : () => actions.send(`Open my saved Riff creator job ${item.job_id}.`),
        `Opening ${item.title}…`,
      ));
      recents.append(card);
    }
  }
  renderRecentsState({ status: 'loading' });

  function renderWorkflowMeta(job: CreatorJobView) {
    workflowMeta.replaceChildren(); workflowStatus.textContent = '';
    const jobId = node('code', `Job ${job.id}`, 'riff-home__job-id'); jobId.title = job.id;
    workflowMeta.append(jobId);
    if ((job.state === 'queued' || job.state === 'running') && actions.refreshJob) {
      const refresh = node('button', 'Refresh', 'riff-home__refresh'); refresh.type = 'button';
      refresh.setAttribute('aria-label', `Refresh saved job ${job.id}`);
      refresh.addEventListener('click', async () => {
        if (disposed) return;
        workflowStatus.textContent = 'Refreshing saved job…'; disableControls(true);
        try { workflowStatus.textContent = (await actions.refreshJob!(job)).message; }
        catch { workflowStatus.textContent = 'Riff could not refresh this saved job. Try again.'; }
        finally { disableControls(false); }
      });
      workflowMeta.append(refresh);
    }
  }

  return {
    render(state) {
      if (disposed) return;
      if (state.status === 'loading') { account.textContent = 'Connecting…'; return; }
      if (state.status === 'error') { account.textContent = 'Account unavailable'; status.textContent = state.message; return; }
      account.textContent = `Ready, ${state.account.name}`;
      menuButton.textContent = state.account.name.trim().slice(0, 1).toUpperCase() || 'R';
      menuButton.title = `Ready, ${state.account.name}`;
      if (/Reconnect|incomplete|could not/i.test(status.textContent)) status.textContent = '';
    },
    setRecents(items) { if (!disposed) renderRecentsState({ status: 'ready', items }); },
    setRecentsState(state) { if (!disposed) renderRecentsState(state); },
    setBusy(message) { if (!disposed) status.textContent = message; },
    showJob(job) {
      if (disposed) return;
      currentJob = job; home.remove(); workflow.hidden = false;
      renderWorkflowMeta(job);
      const stage = job.result?.kind === 'recommendations' ? 'Discover' : job.result?.kind === 'scripts' ? 'Studio' : 'Home';
      setCurrentNav(stage);
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
