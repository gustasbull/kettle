import { riffSymbol } from '../riff-ui/brand.ts';
import { safeHttpUrl, type RiffActionResult } from '../riff-ui/dom.ts';
import { riffMenuStyles } from './styles.ts';

export type RiffMenuRoute = 'home' | 'discover' | 'analysis' | 'studio';
export type RiffMenuAccount = {
  id: string;
  name: string;
  onboarding_seen_at?: string | null;
  allowance_remaining?: number | null;
};
export type RiffMenuRecent = {
  id: string;
  title: string;
  stage: string;
  platform?: 'tiktok' | 'instagram';
  thumbnail_url?: string;
};
type MenuAction = () => void | RiffActionResult | Promise<void | RiffActionResult>;
export type RiffMenuOptions = {
  account?: RiffMenuAccount;
  recents: RiffMenuRecent[];
  activeRoute: RiffMenuRoute;
  onNavigate: (route: 'home' | 'discover') => void;
  onOpenRecent: (recent: RiffMenuRecent) => void;
  onCreate: () => void;
  onClose: () => void;
  onAccountSettings?: MenuAction;
  onSupport?: MenuAction;
  onFeedback?: MenuAction;
  onRequestTheme?: MenuAction;
};
export type RiffMenuRenderState = Partial<Pick<RiffMenuOptions, 'account' | 'recents' | 'activeRoute'>>;

const SVG_NS = 'http://www.w3.org/2000/svg';

export function mountRiffMenu(host: HTMLElement, options: RiffMenuOptions): {
  render(state: RiffMenuRenderState): void;
  dispose(): void;
} {
  const doc = host.ownerDocument;
  const scope = host.closest<HTMLElement>('.riff-menu-scope, .riff-home, .riff-pipeline') ?? host.parentElement;
  if (!scope) throw new Error('Riff menu requires a panel-owned scope');
  scope.classList.add('riff-menu-scope');
  const html = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className = '') => {
    const element = doc.createElement(tag); element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const svg = (viewBox = '0 0 24 24', className = '') => {
    const element = doc.createElementNS(SVG_NS, 'svg');
    element.setAttribute('viewBox', viewBox); element.setAttribute('aria-hidden', 'true');
    if (className) element.setAttribute('class', className);
    return element;
  };
  const path = (parent: SVGElement, d: string, attributes: Record<string, string> = {}) => {
    const element = doc.createElementNS(SVG_NS, 'path'); element.setAttribute('d', d);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    parent.append(element); return parent;
  };
  const lineIcon = (d: string) => {
    const icon = svg(); path(icon, d, { fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    return icon;
  };
  const style = html('style'); style.textContent = riffMenuStyles;
  const trigger = html('button', undefined, 'riff-menu-trigger'); trigger.type = 'button';
  trigger.setAttribute('aria-label', 'Open Riff menu'); trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-expanded', 'false');
  const triggerIcon = svg();
  const rect = doc.createElementNS(SVG_NS, 'rect');
  for (const [name, value] of Object.entries({ x:'3', y:'4', width:'18', height:'16', rx:'3', fill:'none', stroke:'currentColor', 'stroke-width':'1.7' })) rect.setAttribute(name, value);
  triggerIcon.append(rect); path(triggerIcon, 'M9 4v16', { fill:'none', stroke:'currentColor', 'stroke-width':'1.7' }); trigger.append(triggerIcon);
  host.replaceChildren(style, trigger);

  const backdrop = html('button', undefined, 'riff-menu__backdrop'); backdrop.type = 'button'; backdrop.tabIndex = -1;
  backdrop.setAttribute('aria-label', 'Close Riff menu'); backdrop.hidden = true;
  const drawer = html('aside', undefined, 'riff-menu__drawer'); drawer.hidden = true;
  drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-modal', 'true'); drawer.setAttribute('aria-label', 'Riff menu');
  const header = html('div', undefined, 'riff-menu__header');
  const accountTrigger = html('button', undefined, 'riff-menu__account-trigger'); accountTrigger.type = 'button';
  accountTrigger.setAttribute('aria-haspopup', 'menu'); accountTrigger.setAttribute('aria-expanded', 'false');
  const logo = riffSymbol(doc); logo.setAttribute('aria-hidden', 'true'); logo.removeAttribute('aria-label'); logo.removeAttribute('role');
  const accountName = html('span', 'Riff', 'riff-menu__account-name');
  const chevron = lineIcon('m6 9 6 6 6-6'); chevron.setAttribute('class', 'riff-menu__chevron');
  accountTrigger.append(logo, accountName, chevron);
  const close = html('button', undefined, 'riff-menu__close'); close.type = 'button'; close.setAttribute('aria-label', 'Close Riff menu');
  close.append(lineIcon('M4 4l16 16M20 4 4 20'));
  header.append(accountTrigger, close);

  const navigation = html('nav', undefined, 'riff-menu__nav'); navigation.setAttribute('aria-label', 'Riff navigation');
  const home = html('button', undefined, 'riff-menu__nav-button'); home.type = 'button'; home.dataset.route = 'home';
  home.append(lineIcon('M3 10l9-7 9 7v11h-6v-7H9v7H3z'), html('span', 'Home'));
  const discover = html('button', undefined, 'riff-menu__nav-button'); discover.type = 'button'; discover.dataset.route = 'discover';
  discover.append(lineIcon('m4 17 6-6 4 4 6-10m-6 0h6v6'), html('span', 'Discover videos'));
  navigation.append(home, discover);

  const recentsSection = html('section', undefined, 'riff-menu__recents');
  recentsSection.append(html('p', 'Recents', 'riff-menu__section-label'));
  const recentsList = html('div', undefined, 'riff-menu__recent-list'); recentsList.setAttribute('aria-label', 'Recent Riff work'); recentsSection.append(recentsList);
  const spacer = html('div', undefined, 'riff-menu__spacer');
  const accountMenu = html('div', undefined, 'riff-menu__account-menu'); accountMenu.hidden = true;
  accountMenu.setAttribute('role', 'menu'); accountMenu.setAttribute('aria-label', 'Account');
  const status = html('p', '', 'riff-menu__status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const create = html('button', undefined, 'riff-menu__create'); create.type = 'button'; create.append(lineIcon('M12 5v14M5 12h14'), html('span', 'Create a video'));
  drawer.append(header, navigation, recentsSection, spacer, accountMenu, create, status);
  scope.append(backdrop, drawer);

  let state = { account: options.account, recents: [...options.recents], activeRoute: options.activeRoute };
  let disposed = false;
  let returnFocus: HTMLElement | null = null;

  const menuItem = (label: string, icon: SVGElement, action: MenuAction | undefined, extra?: HTMLElement) => {
    const button = html('button', undefined, 'riff-menu__account-action'); button.type = 'button'; button.setAttribute('role', 'menuitem');
    button.append(icon, html('span', label)); if (extra) button.append(extra);
    button.addEventListener('click', () => void invoke(action, `${label} is available through ChatGPT.`));
    return button;
  };
  const accountHome = html('button', undefined, 'riff-menu__account-home'); accountHome.type = 'button'; accountHome.setAttribute('role', 'menuitem');
  const accountHomeArrow = html('span', '→'); accountHomeArrow.setAttribute('aria-hidden', 'true');
  accountHome.append(lineIcon('M3 10l9-7 9 7v11h-6v-7H9v7H3z'), html('span', 'Home'), accountHomeArrow);
  const usage = html('div', undefined, 'riff-menu__usage'); usage.append(html('span', 'Usage'), html('span', 'Usage unavailable', 'riff-menu__usage-state'));
  const themeSwitch = html('span', undefined, 'riff-menu__theme-switch'); themeSwitch.setAttribute('aria-hidden', 'true');
  const accountSettings = menuItem('Account settings', lineIcon('M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1zm3 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6'), options.onAccountSettings);
  const theme = menuItem('Dark mode', lineIcon('M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5M17.5 6.5 19 5m-11 7a4 4 0 1 0 8 0 4 4 0 0 0-8 0'), options.onRequestTheme, themeSwitch);
  theme.setAttribute('aria-pressed', String(doc.documentElement.dataset.theme === 'dark'));
  const support = menuItem('Support', lineIcon('M4 13v-1a8 8 0 0 1 16 0v1M4 12H2v7h4v-7zm16 0h2v7h-4v-7zm0 7c0 3-4 3-8 3'), options.onSupport);
  const feedback = menuItem('Give feedback', lineIcon('M21 11a9 9 0 0 1-9 9H8l-5 2 1.5-5A9 9 0 1 1 21 11zM8 9h8M8 13h5'), options.onFeedback);
  accountMenu.append(accountHome, usage, accountSettings, theme, support, feedback);

  async function invoke(action: MenuAction | undefined, fallback: string) {
    if (disposed) return;
    if (!action) { status.textContent = fallback; return; }
    try {
      const result = await action();
      if (!disposed && result && typeof result === 'object' && typeof result.message === 'string') status.textContent = result.message;
    } catch { if (!disposed) status.textContent = 'Continue with this action in ChatGPT.'; }
  }

  const closeAccountMenu = (focusTrigger = false) => {
    if (accountMenu.hidden) return;
    accountMenu.hidden = true; accountTrigger.setAttribute('aria-expanded', 'false');
    if (focusTrigger) accountTrigger.focus({ preventScroll: true });
  };
  const closeDrawer = (restoreFocus = true) => {
    if (drawer.hidden) return;
    closeAccountMenu(); drawer.hidden = true; backdrop.hidden = true; trigger.setAttribute('aria-expanded', 'false');
    options.onClose();
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  };
  const openDrawer = () => {
    if (disposed || !drawer.hidden) return;
    returnFocus = doc.activeElement instanceof HTMLElement ? doc.activeElement : trigger;
    drawer.hidden = false; backdrop.hidden = false; trigger.setAttribute('aria-expanded', 'true');
    close.focus({ preventScroll: true });
  };
  const activateRoute = (route: 'home' | 'discover') => {
    closeDrawer(); options.onNavigate(route);
  };

  trigger.addEventListener('click', openDrawer);
  close.addEventListener('click', () => closeDrawer());
  backdrop.addEventListener('click', () => closeDrawer());
  home.addEventListener('click', () => activateRoute('home'));
  discover.addEventListener('click', () => activateRoute('discover'));
  accountHome.addEventListener('click', () => activateRoute('home'));
  create.addEventListener('click', () => { closeDrawer(); options.onCreate(); });
  accountTrigger.addEventListener('click', () => {
    const opening = accountMenu.hidden;
    theme.setAttribute('aria-pressed', String(doc.documentElement.dataset.theme === 'dark'));
    accountMenu.hidden = !opening; accountTrigger.setAttribute('aria-expanded', String(opening));
    if (opening) accountMenu.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  });

  const visibleFocus = () => [...drawer.querySelectorAll<HTMLElement>('button:not([hidden]),a[href],[tabindex]:not([tabindex="-1"])')]
    .filter(element => !element.closest('[hidden]') && !element.hasAttribute('disabled'));
  const onKeyDown = (event: KeyboardEvent) => {
    if (disposed || drawer.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!accountMenu.hidden) closeAccountMenu(true); else closeDrawer();
      return;
    }
    if (!accountMenu.hidden && accountMenu.contains(doc.activeElement)
      && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      const items = [...accountMenu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
      if (!items.length) return;
      event.preventDefault();
      const current = Math.max(0, items.indexOf(doc.activeElement as HTMLElement));
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : event.key === 'ArrowDown' ? (current + 1) % items.length : (current - 1 + items.length) % items.length;
      items[next]!.focus({ preventScroll: true });
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = visibleFocus(); if (!focusable.length) return;
    const first = focusable[0]!; const last = focusable.at(-1)!;
    if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const onFocusIn = (event: FocusEvent) => {
    if (!drawer.hidden && event.target instanceof Node && !drawer.contains(event.target)) close.focus({ preventScroll: true });
  };
  const onPointerDown = (event: Event) => {
    if (accountMenu.hidden || !(event.target instanceof Node)) return;
    if (!accountMenu.contains(event.target) && !accountTrigger.contains(event.target)) closeAccountMenu();
  };
  doc.addEventListener('keydown', onKeyDown);
  doc.addEventListener('focusin', onFocusIn);
  drawer.addEventListener('pointerdown', onPointerDown);

  function renderRecents() {
    recentsList.replaceChildren();
    const show = state.account?.onboarding_seen_at !== null;
    recentsSection.hidden = !show;
    if (!show) return;
    if (!state.recents.length) { recentsList.append(html('p', 'No recent work yet.', 'riff-menu__empty')); return; }
    for (const recent of state.recents.slice(0, 4)) {
      const button = html('button', undefined, 'riff-menu__recent'); button.type = 'button';
      button.setAttribute('aria-label', `Open ${recent.title} — ${recent.stage}`);
      const source = html('span', undefined, 'riff-menu__recent-source');
      const thumbnail = recent.thumbnail_url && safeHttpUrl(recent.thumbnail_url);
      if (thumbnail) { const image = html('img'); image.src = thumbnail; image.alt = ''; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; source.append(image); }
      if (recent.platform === 'tiktok') {
        const badge = html('span', undefined, 'riff-menu__platform'); badge.setAttribute('aria-hidden', 'true');
        badge.append(path(svg(), 'M14 3h3c.4 2.4 1.7 3.8 4 4v3a9 9 0 0 1-4-1v7a6 6 0 1 1-6-6v3a3 3 0 1 0 3 3V3Z', { fill:'currentColor' })); button.append(badge);
      }
      const copy = html('span', undefined, 'riff-menu__recent-copy'); copy.append(html('span', recent.title, 'riff-menu__recent-title'), html('span', recent.stage, 'riff-menu__recent-stage'));
      button.prepend(source); button.append(copy);
      button.addEventListener('click', () => { closeDrawer(); options.onOpenRecent(recent); });
      recentsList.append(button);
    }
  }
  function renderState() {
    accountName.textContent = 'Riff';
    accountTrigger.setAttribute('aria-label', state.account ? `${state.account.name} account menu` : 'Riff account menu');
    for (const control of [home, discover]) control.removeAttribute('aria-current');
    if (state.activeRoute === 'home') home.setAttribute('aria-current', 'page');
    if (state.activeRoute === 'discover') discover.setAttribute('aria-current', 'page');
    const allowance = state.account?.allowance_remaining;
    const usageState = usage.querySelector<HTMLElement>('.riff-menu__usage-state')!;
    usageState.textContent = typeof allowance === 'number' && Number.isSafeInteger(allowance) && allowance >= 0
      ? `${allowance} ${allowance === 1 ? 'run' : 'runs'} available` : 'Usage unavailable';
    theme.setAttribute('aria-pressed', String(doc.documentElement.dataset.theme === 'dark'));
    renderRecents();
  }
  renderState();

  return {
    render(next) {
      if (disposed) return;
      const hasAccount = Object.prototype.hasOwnProperty.call(next, 'account');
      const accountChanged = hasAccount && state.account?.id !== next.account?.id;
      if (accountChanged) {
        closeDrawer();
        state = { account: next.account, recents: [], activeRoute: next.activeRoute ?? state.activeRoute };
      } else {
        state = {
          account: hasAccount ? next.account : state.account,
          recents: next.recents ? [...next.recents] : state.recents,
          activeRoute: next.activeRoute ?? state.activeRoute,
        };
      }
      renderState();
    },
    dispose() {
      if (disposed) return; disposed = true;
      doc.removeEventListener('keydown', onKeyDown); doc.removeEventListener('focusin', onFocusIn); drawer.removeEventListener('pointerdown', onPointerDown);
      backdrop.remove(); drawer.remove(); host.replaceChildren();
    },
  };
}
