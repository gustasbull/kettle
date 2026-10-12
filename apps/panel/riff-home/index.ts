import type { CreatorJobStatusView, CreatorJobView } from '../../../packages/contracts/creator-pipeline.ts';
import { mountCreatorPipeline, type RiffCatalogProposal, type RiffDiscoveryLibrary, type RiffDiscoverySelection } from '../creator-pipeline/index.ts';
import type { RiffVideoCatalogState } from '../riff-video-catalog-loader.ts';
import {
  mountRiffProductContext,
  type ProductContextSaveOutcome,
} from '../riff-product-context/index.ts';
import type { ProductDraft } from '../riff-product-context-validation.ts';
import type { Project } from '../../../packages/contracts/index.ts';
import type { RiffWorkState } from '../../../packages/contracts/riff-work-state.ts';
import { cloneStrictJsonObject, strictObjectShape } from '../call-tool-result-validation.ts';
import { mountRiffMenu } from '../riff-shell/menu.ts';
import { riffLockup, riffSymbol } from '../riff-ui/brand.ts';
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
  variant_id?:string|null;
  work_state?:RiffWorkState|null;
};

export type RiffRecentsState =
  | { status: 'loading' }
  | { status: 'ready'; items: RiffRecentWork[] }
  | { status: 'error'; message: string };

type RecommendationResult = Extract<NonNullable<CreatorJobView['result']>, { kind: 'recommendations' }>;
type ScriptResult = Extract<NonNullable<CreatorJobView['result']>, { kind: 'scripts' }>;
const sameUuid=(left:string|undefined|null,right:string|undefined|null)=>!!left&&!!right&&left.toLowerCase()===right.toLowerCase();
const uuid=/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;
const timestamp=/^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|02-(?:0[1-9]|1\d|2[0-8])))T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

export type RiffHomeActions = {
  start(source: string): Promise<RiffActionResult>;
  saveProduct?: (context: { draft: ProductDraft; project: Project | null }) => Promise<ProductContextSaveOutcome>;
  discoverProduct?: (project: Project) => Promise<RiffActionResult>;
  inputChanged?: (source: string) => void;
  send: RiffPanelAction;
  upload?: () => Promise<RiffActionResult>;
  showWelcome?: () => Promise<RiffActionResult>;
  accountSettings?: () => Promise<RiffActionResult>;
  support?: () => Promise<RiffActionResult>;
  feedback?: () => Promise<RiffActionResult>;
  requestTheme?: () => Promise<RiffActionResult>;
  openRecent?: (jobId: string,variantId?:string) => Promise<RiffActionResult>;
  refreshRecents?: () => Promise<RiffActionResult>;
  refreshJob?: (job: CreatorJobView) => Promise<RiffActionResult>;
  startRecommendations?: (context: {
    job: CreatorJobView;
    dna: Extract<NonNullable<CreatorJobView['result']>, { kind: 'scan' }>['dna'];
  }) => Promise<RiffActionResult>;
  makeMine?: (context: RiffDiscoverySelection) => Promise<RiffActionResult>;
  proposeCatalogReference?: (context:RiffCatalogProposal)=>Promise<RiffActionResult>;
  retryCatalog?:()=>void;
  setVariantState?: (context: {
    job: CreatorJobView;
    scripts: ScriptResult['scripts'];
    variant: ScriptResult['scripts']['variants'][number];
    state: 'active' | 'saved' | 'filmed';
  }) => ReturnType<NonNullable<import('../creator-pipeline/index.ts').CreatorPipelineOptions['setVariantState']>>;
  onDiscoveryOpen?:(scope:{projectId?:string})=>void;
};

export function riffHomeStructuredOutput(value: unknown): RiffHomeState {
  const canonical = cloneStrictJsonObject(value);
  const success = strictObjectShape(canonical, ['ok', 'data']);
  if (!success || success.ok !== true) {
    const failure = strictObjectShape(canonical, ['ok', 'error']);
    const error = strictObjectShape(failure?.error, ['code'], ['message', 'retryable', 'recovery']);
    const code = error?.code;
    return { status: 'error', message: code === 'UNAUTHENTICATED' || code === 'FORBIDDEN'
      ? 'Reconnect your Riff account in ChatGPT, then reopen Home.'
      : 'Riff could not read this account. Reopen it from ChatGPT.' };
  }
  const data = strictObjectShape(success.data, ['account', 'entitlements', 'usage']);
  const account = strictObjectShape(data?.account,
    ['id', 'display_name', 'state', 'preferred_language', 'created_at', 'onboarding_seen_at']);
  const entitlements = strictObjectShape(data?.entitlements, ['status']);
  const usage = strictObjectShape(data?.usage, ['status', 'reset_at']);
  if (!data || !account || !entitlements || !usage
    || typeof account.id !== 'string' || !uuid.test(account.id)
    || typeof account.display_name !== 'string' || !account.display_name.trim() || account.display_name.trim().length > 120
    || account.state !== 'active'
    || typeof account.preferred_language !== 'string' || !account.preferred_language.trim()
    || account.preferred_language.trim().length > 35
    || typeof account.created_at !== 'string' || !timestamp.test(account.created_at)
    || account.onboarding_seen_at !== null
      && (typeof account.onboarding_seen_at !== 'string' || !timestamp.test(account.onboarding_seen_at))
    || entitlements.status !== 'not_configured'
    || usage.status !== 'not_configured' || usage.reset_at !== null) {
    return { status: 'error', message: 'Riff returned incomplete account details. Reopen Home.' };
  }
  return { status: 'ready', account: {
    id: account.id,
    name: account.display_name.trim(),
    onboarding_seen_at: account.onboarding_seen_at as string | null,
  } };
}

const homeStyles = `
${riffBaseStyles}
html, body { margin: 0; min-height: 100%; background: #FCFCFE; }
body { min-height: 100vh; }
.riff-home { min-height: 100vh; padding: 12px; background: radial-gradient(circle, rgba(101,86,122,.06) .6px, transparent .85px) center/16px 16px, radial-gradient(at 10% 70%, #DCEBFA 0%, transparent 60%), radial-gradient(at 70% 65%, #E6DDF6 0%, transparent 58%), radial-gradient(at 92% 30%, #F5E2EF 0%, transparent 55%), #FCFCFE; color: #242426; }
.riff-home__account { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.riff-home__chrome { display:flex; width:100%; flex:0 0 auto; align-items:center; justify-content:space-between; padding:calc(16px + var(--riff-safe-top,0px)) 24px 8px; border-radius:24px 24px 0 0; }
.riff-home__chrome-trail { display:flex; width:fit-content; height:44px; flex:0 0 auto; align-items:center; gap:14px; white-space:nowrap; }
.riff-home__rail-symbol { display:flex; width:36px; height:36px; flex:0 0 auto; align-items:center; justify-content:center; border:1px solid #E3E7EE; border-radius:10px; background:#FFF; box-shadow:0 1px 3px #18243A08; }
.riff-home__rail-symbol svg { width:18px;height:18px; }
.riff-home__brand { display:flex;flex:0 0 auto;align-items:center;gap:8px;color:#242426;font-size:14px;font-weight:600;line-height:20px;overflow-wrap:normal;white-space:nowrap; }
.riff-home__brand svg, .riff-home__brand > span { flex:0 0 auto; }
.riff-app .riff-home__brand .riff-logo { width:22px;height:22px; }
.riff-home__separator { color:#ABB0B9;font-size:14px;line-height:20px; }
.riff-home__location { color:#242426;font-size:13px;line-height:20px; }
.riff-home__home { display: flex; min-height: calc(100vh - 92px); width: 100%; align-items: center; flex-direction: column; gap: 20px; padding: 28px calc(28px + var(--riff-safe-right, 0px)) calc(40px + var(--riff-safe-bottom, 0px)) calc(28px + var(--riff-safe-left, 0px)); border-radius: 0 0 24px 24px; background: transparent; }
.riff-home__hero { display: flex; width: 100%; align-items: center; flex-direction: column; gap: 16px; padding: 12px 0 4px; text-align: center; }
.riff-home__hero-mark { width: 104px; height: 38px; flex: 0 0 auto; color: #0D0E12; }
.riff-home h1 { width: fit-content; max-width: 100%; color: #202124; font-size: 40px; font-weight: 600; line-height: 48px; letter-spacing: -.02em; text-align: center; text-wrap: balance; }
.riff-home__composer { display: flex; width: 760px; max-width: 100%; flex-direction: column; gap: 12px; padding: 14px; border: 0; border-radius: 20px; background: linear-gradient(150deg, #E6EDF033, #FAFBFC66), #F0F6FA; box-shadow: inset 0 1px 0 #FFFFFFAA, 0 8px 18px #396E9012; }
.riff-home__label { display: none; }
.riff-home__chips { display: flex; width: 100%; flex-wrap: wrap; justify-content: center; gap: 8px; }
.riff-home__chip, .riff-home__upload, .riff-home__submit, .riff-home__recent-next, .riff-home__recent-card { appearance: none; border: 0; cursor: pointer; }
.riff-home__chip { display: flex; min-height: 44px; max-width: 100%; flex: 0 1 auto; align-items: center; justify-content: center; gap: 6px; padding: 6px 12px; border: 1px solid #DDE5F1; border-radius: 999px; color: #6933A1; background: #FFFFFFA6; font-size: 12px; font-weight: 400; line-height: 18px; white-space: normal; }
.riff-home__chip svg { width: 14px; height: 14px; flex: 0 0 auto; }
.riff-home__input-shell { display: flex; width: 100%; flex-direction: column; gap: 22px; padding: 18px; border: 1px solid #DDE5F4; border-radius: 14px; background: #FFFFFF; }
.riff-home__composer textarea { display: block; width: 100%; height: 1.5em; min-height: 1.5em; resize: none; overflow: auto; padding: 0; border: 0; outline: 0; color: #242426; background: transparent; font-size: 15px; line-height: 22px; }
.riff-home__composer textarea::placeholder { color: #687386; opacity: 1; }
.riff-home__composer-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.riff-home__upload { display: flex; min-width: 0; min-height: 44px; align-items: center; gap: 7px; padding: 0; color: #566279; background: transparent; font-size: 13px; font-weight: 400; line-height: 20px; }
.riff-home__upload svg { width: 16px; height: 16px; flex: 0 0 auto; }
.riff-home__submit { display: flex; min-height: 44px; flex: 0 0 auto; align-items: center; justify-content: center; padding: 10px 22px; border-radius: 999px; color: #FFFFFF; background: radial-gradient(circle farthest-corner at 50% 45% in oklab, oklab(46.1% .087 -.206) 0%, oklab(50.7% .09 -.203) 55%, oklab(61.7% .089 -.17) 100%), #7138D4; box-shadow: inset 0 1px 2px #FFFFFF55, 0 4px 8px #54259B33, 0 10px 20px #7444CD33; font-size: 14px; font-weight: 600; line-height: 20px; white-space: normal; }
.riff-home__composer textarea:focus-visible { outline: 3px solid var(--color-ring-primary, #3865F8); outline-offset: 3px; border-radius: 2px; }
.riff-home__chip:disabled, .riff-home__upload:disabled, .riff-home__submit:disabled, .riff-home__recent-next:disabled, .riff-home__recent-card:disabled { cursor: wait; opacity: .62; }
.riff-home__status { width: 760px; max-width: 100%; color: #596273; font-size: 13px; line-height: 19px; text-align: left; }
.riff-home__status:empty { display: none; }
.riff-home__welcome-help { display:flex; min-height:44px; align-items:center; justify-content:center; align-self:center; padding:10px 18px; border:1px solid #D6DDEA; border-radius:999px; color:#492481; background:#FFF; font:600 13px/20px inherit; cursor:pointer; }
.riff-home__welcome-help[hidden] { display:none; }
.riff-home__intent { display:flex; width:760px; max-width:100%; align-items:center; justify-content:center; flex-wrap:wrap; gap:10px; padding:14px; border:1px solid #DDE5F1; border-radius:16px; background:#FFFFFFCC; }
.riff-home__intent[hidden] { display:none; }
.riff-home__intent legend { width:100%; padding:0; color:#363B45; font-size:13px; font-weight:600; line-height:20px; text-align:center; }
.riff-home__intent button { min-height:44px; padding:10px 18px; border:1px solid #D6DDEA; border-radius:999px; color:#492481; background:#FFF; font:600 13px/20px inherit; cursor:pointer; }
.riff-home__intent button:hover { background:#F5F0FC; }
.riff-home__section { display: flex; width: 760px; max-width: 100%; flex-direction: column; gap: 12px; padding-top: 8px; }
.riff-home__section-head { display: flex; align-items: center; justify-content: space-between; }
.riff-home__section h2 { color: #202124; font-size: 15px; font-weight: 600; line-height: 22px; letter-spacing: 0; }
.riff-home__recent-next { display: flex; width: 44px; height: 44px; flex: 0 0 auto; align-items: center; justify-content: center; padding: 0; border: 1px solid #E3E8F1; border-radius: 999px; color: #35578B; background: #F0F3F7; box-shadow: 0 2px 4px #2035560A; }
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
.riff-home__workflow { width: 100%; min-height: calc(100vh - 92px); background: transparent; }
:root[data-theme="dark"], :root[data-theme="dark"] body { background:#101318; }
:root[data-theme="dark"] .riff-home { color:#F6F7F9; background:radial-gradient(circle,rgba(255,255,255,.05) .6px,transparent .85px) center/16px 16px,radial-gradient(at 10% 70%,#162433 0%,transparent 60%),radial-gradient(at 70% 65%,#221D31 0%,transparent 58%),radial-gradient(at 92% 30%,#2E1E2A 0%,transparent 55%),#101318; }
:root[data-theme="dark"] .riff-home__rail-symbol,
:root[data-theme="dark"] .riff-home__input-shell,
:root[data-theme="dark"] .riff-home__recent-card { color:#F6F7F9; border-color:#596273; background:#181D25; }
:root[data-theme="dark"] .riff-home__brand,
:root[data-theme="dark"] .riff-home__location,
:root[data-theme="dark"] .riff-home h1,
:root[data-theme="dark"] .riff-home__section h2,
:root[data-theme="dark"] .riff-home__recent-title,
:root[data-theme="dark"] .riff-home__composer textarea { color:#F6F7F9; }
:root[data-theme="dark"] .riff-home__hero-mark { color:#F6F7F9; }
:root[data-theme="dark"] .riff-home__separator,
:root[data-theme="dark"] .riff-home__upload,
:root[data-theme="dark"] .riff-home__status,
:root[data-theme="dark"] .riff-home__recent-stage,
:root[data-theme="dark"] .riff-home__recent-state,
:root[data-theme="dark"] .riff-home__composer textarea::placeholder { color:#C1C8D2; }
:root[data-theme="dark"] .riff-home__composer { background:linear-gradient(150deg,#24283288,#181D25CC),#181D25; box-shadow:inset 0 1px 0 #FFFFFF18,0 8px 18px #00000033; }
:root[data-theme="dark"] .riff-home__chip { color:#C8A8FF; border-color:#596273; background:#242832; }
:root[data-theme="dark"] .riff-home__recent-next { color:#C8A8FF; border-color:#596273; background:#242832; }
:root[data-theme="dark"] .riff-home__recent-thumbnail { border-color:#181D25; background:#242832; }
:root[data-theme="dark"] .riff-home__platform { border-color:#181D25; }
:root[data-theme="dark"] .riff-home__intent { border-color:#596273; background:#181D25; }
:root[data-theme="dark"] .riff-home__intent legend { color:#F6F7F9; }
:root[data-theme="dark"] .riff-home__intent button { color:#C8A8FF; border-color:#596273; background:#242832; }
:root[data-theme="dark"] .riff-home__intent button:hover { background:#303643; }
:root[data-theme="dark"] .riff-home__welcome-help { color:#D8B4FE; border-color:#596273; background:#242832; }
@media (max-width: 480px) {
  .riff-home__chrome { padding-inline: 12px; }
  .riff-home__chrome-trail { height: auto; max-width: 100%; flex-wrap: wrap; gap: 6px 8px; white-space: normal; }
  .riff-home__home { padding-inline: calc(16px + var(--riff-safe-left, 0px)) calc(16px + var(--riff-safe-right, 0px)); }
  .riff-home h1 { font-size: 34px; line-height: 41px; }
  .riff-home__composer-footer { align-items: stretch; flex-direction: column; }
  .riff-home__upload, .riff-home__submit { width: 100%; justify-content: center; }
}
`;

const libraries = [
  ['videos', 'Trending videos'],
  ['hooks', 'Hooks'],
  ['showcases', 'Product showcases'],
  ['ctas', 'Calls to action'],
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
  showJob(job: CreatorJobView, presentation?:{status?:CreatorJobStatusView;sourceUrl?:string}): void;
  acknowledgeStart(source:string):void;
  setCatalogState(state:RiffVideoCatalogState):void;
  showCatalog(library?:RiffDiscoveryLibrary):void;
  setWorkflowNotice(message:string):void;
  clearPrivate():void;
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
  const app = node('main', undefined, 'riff-app riff-home riff-menu-scope');
  const chrome=node('header',undefined,'riff-home__chrome');const trail=node('div',undefined,'riff-home__chrome-trail');
  const menuHost=node('span');
  const brand=node('span',undefined,'riff-home__brand');const symbol=riffSymbol(doc);symbol.setAttribute('aria-hidden','true');symbol.removeAttribute('aria-label');symbol.removeAttribute('role');brand.append(symbol,node('span','Riff'));
  const separator=node('span','/','riff-home__separator');const location=node('span','Home','riff-home__location');trail.append(menuHost,brand,separator,location);chrome.append(trail);
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
  for (const [kind, title] of libraries) {
    const chip = node('button', undefined, 'riff-home__chip'); chip.type = 'button'; chip.dataset.library = kind;
    chip.append(paperShortcutIcon(doc, kind), node('span', title));
    chip.setAttribute('aria-pressed', 'false');
    chip.addEventListener('click', () => {
      if (disposed) return;
      invocationEpoch++;
      for (const control of libraryControls) control.setAttribute('aria-pressed', String(control === chip));
      showCatalog(kind);
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
  const welcomeHelp = node('button', 'Show welcome guide', 'riff-home__welcome-help'); welcomeHelp.type = 'button'; welcomeHelp.hidden = true;
  const intent = doc.createElement('fieldset'); intent.className = 'riff-home__intent'; intent.hidden = true;
  const intentLegend = node('legend', 'What did you share?');
  const productChoice = node('button', 'Product description'); productChoice.type = 'button';
  const ideaChoice = node('button', 'Video idea'); ideaChoice.type = 'button';
  intent.append(intentLegend, productChoice, ideaChoice);

  const recentSection = node('section', undefined, 'riff-home__section');
  recentSection.setAttribute('aria-labelledby', 'riff-home-recents-title');
  const recentHead = node('div', undefined, 'riff-home__section-head');
  const recentNext = node('button', undefined, 'riff-home__recent-next'); recentNext.type = 'button';
  recentNext.setAttribute('aria-label', 'View recent work'); recentNext.append(paperRecentArrow(doc));
  const recentTitle = node('h2', 'Pick up where you left off'); recentTitle.id = 'riff-home-recents-title';
  recentHead.append(recentTitle, recentNext);
  const recents = node('div', undefined, 'riff-home__recents');
  recentSection.append(recentHead, recents);
  home.append(hero, form, intent, status, welcomeHelp, recentSection);

  const workflow = node('section', undefined, 'riff-home__workflow'); workflow.hidden = true;
  const workflowRoot = node('div'); workflow.append(workflowRoot);
  chrome.hidden=true;home.hidden=true;
  app.append(chrome,account, home, workflow); root.replaceChildren(style, app);

  let disposed = false;
  let pipeline: ReturnType<typeof mountCreatorPipeline> | undefined;
  let product: ReturnType<typeof mountRiffProductContext> | undefined;
  let pendingIntent = '';
  let menu!: ReturnType<typeof mountRiffMenu>;
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
    chrome.hidden=false;
    pipeline?.leaveCatalog();
    if (product) { product.dispose(); product = undefined; workflowRoot.replaceChildren(); }
    location.textContent='Home';home.hidden = false; workflow.hidden = true;
    menu?.render({ activeRoute: 'home' });
  };
  const openVault:NonNullable<import('../creator-pipeline/index.ts').CreatorPipelineOptions['openVault']>=async({job,variant})=>{
    const finish=(result:RiffActionResult)=>{status.textContent=result.message;return result;};
    showHome();
    if(disposed)return finish({status:'failed',message:'My videos could not be opened because this Riff view closed.'});
    if(recentsState.status==='loading')return finish({status:'pending',message:'My videos opened. Saved work is still loading.'});
    if(recentsState.status==='error')return finish({status:'failed',message:'My videos opened, but saved work could not be refreshed.'});
    const item=recentsState.items.find(candidate=>sameUuid(candidate.job_id,job.id)&&sameUuid(candidate.variant_id,variant.id));
    if(!item)return finish({status:'failed',message:'My videos opened, but this saved script is not visible in the latest recent work.'});
    const target=[...recents.querySelectorAll<HTMLButtonElement>('.riff-home__recent-card')]
      .find(card=>sameUuid(card.dataset.jobId,item.job_id)&&sameUuid(card.dataset.variantId,item.variant_id));
    if(!target)return finish({status:'failed',message:'My videos opened, but this saved script could not be focused.'});
    target.focus({preventScroll:true});target.scrollIntoView({block:'nearest',inline:'nearest'});
    return finish({status:'sent',message:'My videos opened with the saved script selected.'});
  };
  const ensurePipeline=()=>{
    product?.dispose(); product=undefined;
    return pipeline??=mountCreatorPipeline(workflowRoot,{
    displayMode:'fullscreen',sendPrompt:actions.send,embeddedChrome:false,
    requestFullscreen:async()=>({status:'sent',message:'Already open in Riff.'}),
    startRecommendations:actions.startRecommendations,makeMine:actions.makeMine,
    proposeCatalogReference:actions.proposeCatalogReference,onCatalogRetry:actions.retryCatalog,
    setVariantState:actions.setVariantState,onDiscoveryOpen:actions.onDiscoveryOpen,openVault,
    });
  };
  const showProduct=(description:string)=>{
    if(disposed)return;
    invocationEpoch++; pipeline?.dispose(); pipeline=undefined; workflowRoot.replaceChildren();
    location.textContent='Product context'; home.hidden=true; workflow.hidden=false;
    menu?.render({activeRoute:'home'});
    product=mountRiffProductContext(workflowRoot,{
      onSave:actions.saveProduct??(async()=>({status:'failed',message:'Riff cannot save product context in this host.'})),
      onDiscover:actions.discoverProduct??(project=>actions.send(`Continue from this saved Riff product brief: ${JSON.stringify(project)}`)),
    });
    product.start({kind:'unsaved',description}); workflow.scrollIntoView({block:'start'});
  };
  const showCatalog=(library:RiffDiscoveryLibrary='videos')=>{
    if(disposed)return;
    invocationEpoch++;location.textContent='Discover videos';home.hidden=true;workflow.hidden=false;
    menu?.render({ activeRoute: 'discover' });
    ensurePipeline().showCatalog(library,{accountWide:true});workflow.scrollIntoView({block:'start'});
  };
  menu=mountRiffMenu(menuHost,{
    account:undefined,recents:[],activeRoute:'home',
    onNavigate(route){if(route==='home')showHome();else showCatalog('videos');},
    onOpenRecent(recent){
      const item=recentsState.status==='ready'?recentsState.items.find(candidate=>sameUuid(candidate.job_id,recent.id)):undefined;
      if(!item)return;
      pipeline?.leaveCatalog();
      void invoke(actions.openRecent?()=>actions.openRecent!(item.job_id,item.variant_id??undefined):()=>actions.send(`Open my saved Riff work, “${item.title}”.`),`Opening ${item.title}…`);
    },
    onCreate(){
      invocationEpoch++;input.value='';pendingIntent='';intent.hidden=true;actions.inputChanged?.('');status.textContent='';showHome();input.focus({preventScroll:true});
    },
    onClose(){ /* Closing the local drawer does not mutate workflow state. */ },
    onAccountSettings:actions.accountSettings ?? (()=>actions.send('Open my Riff account settings in ChatGPT. Do not claim a setting changed until the host confirms it.')),
    onSupport:actions.support ?? (()=>actions.send('I need support with Riff. Help me describe the issue and show the available support handoff.')),
    onFeedback:actions.feedback ?? (()=>actions.send('I want to give feedback about Riff. Help me send it through the available ChatGPT handoff.')),
    onRequestTheme:actions.requestTheme ?? (()=>actions.send('Open ChatGPT appearance settings. Riff follows the host theme and cannot change ChatGPT’s theme itself.')),
  });

  form.addEventListener('submit', event => {
    event.preventDefault(); const rawValue=input.value;
    if (!rawValue.trim()) { status.textContent = 'Add a video link, profile link, or idea first.'; input.focus(); return; }
    let parsed: URL | undefined; try { parsed = new URL(rawValue.trim()); } catch { /* Explicit choice below. */ }
    if (!parsed) {
      pendingIntent=rawValue; intent.hidden=false;
      status.textContent='Choose how Riff should use this text. Nothing runs until you choose.';
      productChoice.focus(); return;
    }
    pendingIntent='';intent.hidden=true;
    void invoke(() => actions.start(rawValue), 'Starting your Riff analysis…', submit);
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) form.requestSubmit();
  });
  input.addEventListener('input', () => {
    pendingIntent=''; intent.hidden=true; status.textContent=''; actions.inputChanged?.(input.value);
  });
  productChoice.addEventListener('click',()=>{
    if(disposed||!pendingIntent)return;
    const description=pendingIntent;pendingIntent='';intent.hidden=true;showProduct(description);
  });
  ideaChoice.addEventListener('click',()=>{
    if(disposed||!pendingIntent)return;
    const idea=pendingIntent;pendingIntent='';intent.hidden=true;
    void invoke(()=>actions.start(idea),'Sending your video idea to ChatGPT…',ideaChoice);
  });
  upload.addEventListener('click', () => void invoke(
    actions.upload ?? (() => actions.send('I want to analyze a video with Riff. Help me attach it through ChatGPT, and do not claim it was uploaded until the host confirms the file.')),
    'Opening the ChatGPT file picker…',
    upload,
  ));
  welcomeHelp.addEventListener('click', () => void invoke(
    actions.showWelcome ?? (() => actions.send('Show me the Riff welcome guide in this ChatGPT conversation. Keep Riff Home open and usable on the right.')),
    'Opening the welcome guide in ChatGPT…',
    welcomeHelp,
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
    menu.render({ recents: items.map(item=>({id:item.job_id,title:item.title,stage:item.stage,platform:item.platform})) });
    if (!items.length) {
      recents.append(node('p', 'No recent work yet.', 'riff-home__recent-state')); return;
    }
    for (const item of items.slice(0, 4)) {
      const card = node('button', undefined, 'riff-home__recent-card'); card.type = 'button';
      card.dataset.jobId=item.job_id;if(item.variant_id)card.dataset.variantId=item.variant_id;
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
        actions.openRecent ? () => actions.openRecent!(item.job_id,item.variant_id??undefined) : () => actions.send(`Open my saved Riff work, “${item.title}”.`),
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
      if (state.status === 'loading') {
        account.textContent = 'Connecting…';welcomeHelp.hidden=true;chrome.hidden=true;home.hidden=true;workflow.hidden=true;return;
      }
      if (state.status === 'error') {
        chrome.hidden=false;home.hidden=false;workflow.hidden=true;
        account.textContent = 'Account unavailable';
        status.textContent = state.message;
        welcomeHelp.hidden = false;
        recentSection.hidden = false;
        return;
      }
      account.textContent = `Ready, ${state.account.name}`;
      welcomeHelp.hidden = true;
      recentSection.hidden = state.account.onboarding_seen_at === null;
      menu.render({ account: state.account });
      if (/Reconnect|incomplete|could not/i.test(status.textContent)) status.textContent = '';
      chrome.hidden=false;
      if(home.hidden&&workflow.hidden)showHome();
    },
    setRecents(items) { if (!disposed) renderRecentsState({ status: 'ready', items }); },
    setRecentsState(state) { if (!disposed) renderRecentsState(state); },
    setBusy(message) { if (!disposed) status.textContent = message; },
    showJob(job,presentation={}) {
      if (disposed) return;
      invocationEpoch++;
      location.textContent=job.kind==='recommendations'?'Discover videos':job.kind==='scripts'?'Studio':'Analysis';
      menu.render({ activeRoute: job.kind==='recommendations'?'discover':job.kind==='scripts'?'studio':'analysis' });
      home.hidden=true; workflow.hidden = false;
      ensurePipeline().render(job,presentation);
      workflow.scrollIntoView({ block: 'start' });
    },
    acknowledgeStart(source){if(!disposed&&input.value===source)input.value='';},
    setCatalogState(state){pipeline?.setCatalogState(state);},
    showCatalog,
    setWorkflowNotice(message){pipeline?.setNotice(message);},
    clearPrivate(){if(disposed)return;input.value='';pendingIntent='';intent.hidden=true;welcomeHelp.hidden=true;menu.render({account:undefined,recents:[],activeRoute:'home'});pipeline?.dispose();pipeline=undefined;product?.dispose();product=undefined;workflowRoot.replaceChildren();showHome();},
    showHome,
    dispose() {
      if (disposed) return; disposed = true; menu.dispose(); pipeline?.dispose(); product?.dispose(); pipeline = undefined; product=undefined; root.replaceChildren();
    },
  };
}
