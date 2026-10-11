import type { Failure, Project } from '../../packages/contracts/index.ts';
import { projectReviewStyles } from './project-review-styles.ts';

export type ProjectReviewState =
  | { kind: 'loading' }
  | { kind: 'ready'; project: Project; refreshing: boolean; warning?: string }
  | { kind: 'error'; message: string; recovery: Failure['error']['recovery'] | 'reopen' };

const recoveryText: Record<Failure['error']['recovery'] | 'reopen', string> = {
  reauthorize: 'Reconnect Riff through ChatGPT, then ask to reopen this brief.',
  correct_input: 'Tell Riff what needs correcting in chat, then ask to reopen the brief.',
  reload: 'Ask Riff to reopen this brief in chat.',
  retry_same_request: 'Ask Riff to try opening this brief again in chat.',
  contact_support: 'If this continues, contact Riff support.',
  reopen: 'Ask Riff to reopen this brief in chat.',
};

/** No navigation is performed until a user follows a vetted source link. */
function safeSourceUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return;
    return url.href;
  } catch { return; }
}

export function mountProjectReview(
  root: HTMLElement,
  actions: { onRefresh: () => void },
): { render(state: ProjectReviewState): void; dispose(): void } {
  const doc = root.ownerDocument;
  function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string) {
    const node = doc.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  const wrapper = element('div', 'kettle-review');
  const style = element('style', '', projectReviewStyles);
  const card = element('section', 'kr-card');
  card.setAttribute('aria-label', 'Your project brief');
  const content = element('div');
  const status = element('p', 'kr-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  card.append(content, status);
  wrapper.append(style, card);
  root.replaceChildren(wrapper);
  let disposed = false;
  let currentProjectId: string | undefined;
  let refresh: HTMLButtonElement | undefined;
  let canRefresh = false;

  const click = (event: Event) => {
    if (disposed || !canRefresh || event.target !== refresh) return;
    // Prevent repeat activation even before the bridge renders its pending state.
    canRefresh = false;
    refresh?.setAttribute('aria-disabled', 'true');
    actions.onRefresh();
  };
  wrapper.addEventListener('click', click);

  function render(state: ProjectReviewState) {
    if (disposed) return;
    const focused = doc.activeElement;
    const restoreRefresh = focused === refresh;
    const oldDetails = content.querySelector('details');
    const restoreDetails = focused === oldDetails?.querySelector('summary');
    const sameProject = state.kind === 'ready' && currentProjectId === state.project.id;
    const wasOpen = sameProject && (oldDetails?.open ?? false);
    content.replaceChildren(element('h2', '', 'Your project brief'));
    refresh = undefined;
    canRefresh = false;
    currentProjectId = state.kind === 'ready' ? state.project.id : undefined;
    if (state.kind === 'loading') {
      status.textContent = 'Loading your saved brief…';
      return;
    }
    if (state.kind === 'error') {
      content.append(element('p', 'kr-message', state.message), element('p', 'kr-help', recoveryText[state.recovery]));
      status.textContent = `Brief unavailable. ${state.message} ${recoveryText[state.recovery]}`;
      return;
    }
    const { project, refreshing, warning } = state;
    const brief = project.brief_version.brief;
    const product = element('div', 'kr-product');
    const mark = element('span', 'kr-mark', '▤');
    mark.setAttribute('aria-hidden', 'true');
    const copy = element('div', 'kr-product-copy');
    copy.append(element('h3', '', project.name), element('p', 'kr-version', `Saved version ${project.current_version}`), element('p', 'kr-summary', brief.product));
    product.append(mark, copy);
    const rows = element('dl');
    function row(label: string, value: string | string[]) {
      const entry = element('div', 'kr-row');
      const description = element('dd');
      if (Array.isArray(value)) {
        const list = element('ul');
        value.forEach(item => list.append(element('li', '', item)));
        description.append(list);
      } else description.textContent = value;
      entry.append(element('dt', '', label), description);
      rows.append(entry);
    }
    row('Audience', brief.audience);
    row('Goal', brief.goal);
    row('Tone', brief.tone);
    row('Language', brief.language);
    row('Target duration', `${brief.duration_seconds} seconds`);
    row('Filming constraints', brief.filming_constraints.length ? brief.filming_constraints : 'No constraints recorded');
    content.append(product, rows);
    if (brief.facts.length) {
      const details = element('details', 'kr-facts');
      details.open = wasOpen;
      details.append(element('summary', '', `Supplied facts (${brief.facts.length})`));
      const list = element('ul');
      for (const fact of brief.facts) {
        const item = element('li', 'kr-fact');
        item.append(element('p', '', fact.statement));
        const source = element('span', 'kr-meta', `${fact.user_confirmed ? 'User-confirmed' : 'Unconfirmed'} · ${fact.source.kind === 'user' ? 'User supplied' : 'URL source'} · Captured `);
        // Keep the source's calendar date and full timestamp available, without locale ambiguity.
        const date = element('time', '', fact.source.captured_at.slice(0, 10));
        date.dateTime = fact.source.captured_at;
        date.title = fact.source.captured_at;
        source.append(date);
        if (fact.source.kind === 'url') {
          const href = safeSourceUrl(fact.source.url);
          if (href) {
            const link = element('a', 'kr-meta', fact.source.url);
            link.href = href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.referrerPolicy = 'no-referrer';
            link.setAttribute('aria-label', `Source: ${fact.source.url} (opens in a new tab)`);
            source.append(link);
          } else source.append(element('span', 'kr-meta', 'Source link unavailable'));
        }
        item.append(source);
        list.append(item);
      }
      details.append(list);
      content.append(details);
    } else content.append(element('p', 'kr-help kr-facts', 'No supporting facts recorded'));
    if (warning) content.append(element('p', 'kr-notice', `Previously loaded snapshot. ${warning}`));
    const footer = element('footer', 'kr-footer');
    footer.append(element('p', 'kr-help', 'Tell me what to change in chat. Refresh after your changes are saved.'));
    refresh = element('button', '', refreshing ? 'Refreshing brief…' : 'Refresh brief');
    refresh.type = 'button';
    refresh.setAttribute('aria-disabled', String(refreshing));
    canRefresh = !refreshing;
    footer.append(refresh);
    content.append(footer);
    status.textContent = refreshing ? 'Refreshing your brief. Previously loaded snapshot shown.' : warning ? `Refresh failed. ${warning}` : `Saved version ${project.current_version} loaded.`;
    if (sameProject && restoreRefresh) refresh.focus({ preventScroll: true });
    else if (sameProject && restoreDetails) content.querySelector('summary')?.focus({ preventScroll: true });
  }
  render({ kind: 'loading' });
  return {
    render,
    dispose() {
      disposed = true;
      canRefresh = false;
      wrapper.removeEventListener('click', click);
      wrapper.remove();
      refresh = undefined;
      currentProjectId = undefined;
    },
  };
}
