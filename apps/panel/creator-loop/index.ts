import type { CreatorDnaView } from '../../../packages/contracts/creator-operations.ts';
import type {
  CreatorAnalysis, ProfileScanResult, ProfileObservation, VideoObservation, DnaClaim,
} from '../../../packages/contracts/creator-profile.ts';
import { creatorReviewStyles } from './styles.ts';

/** Presentation states only. Berlin must validate D0 envelopes and authorize display. */
export type CreatorReviewState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'saved'; dna: CreatorDnaView; preview: boolean }
  | { kind: 'scan'; scan: ProfileScanResult; preview: boolean }
  | { kind: 'analysis'; analysis: CreatorAnalysis; preview: boolean };

type Observation = ProfileObservation | VideoObservation;
const dimensions: Record<DnaClaim['dimension'], string> = {
  topics: 'Topics', formats: 'Formats', hooks: 'Hooks', showcase: 'Showcase', cta: 'Call to action',
  structure: 'Structure', duration: 'Duration', pacing: 'Pacing', relative_performance: 'Relative performance', audience: 'Audience',
};
const basis: Record<DnaClaim['basis'], string> = {
  observed: 'Observed', inferred: 'Inferred', user_corrected: 'User-corrected',
};
const scanLabels: Record<ProfileScanResult['status'], string> = {
  complete: 'Bounded sample complete', partial: 'Partial scan', unavailable: 'Profile unavailable', failed: 'Scan failed',
};
const reasons: Record<ProfileScanResult['coverage']['stop_reason'], string> = {
  exhausted: 'Provider feed exhausted', limit: 'Requested limit reached', unknown: 'Unknown',
  inaccessible: 'Profile inaccessible', error: 'Provider error',
};
const errorLabels: Record<ProfileScanResult['coverage']['errors'][number]['code'], string> = {
  private: 'Private profile', not_found: 'Profile not found', rate_limited: 'Rate limited', timeout: 'Request timed out',
  malformed: 'Invalid provider response', provider_failure: 'Provider failed',
};
function displayable(o: Observation): boolean {
  return o.provenance.permission.status !== 'needs_review' && o.provenance.permission.permitted_uses.includes('display');
}
function safeUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return url.href;
  } catch { /* Non-links stay inert. */ }
}

/** No network, host, storage, mutation or chat calls. Owns only the supplied root. */
export function mountCreatorReview(root: HTMLElement): {
  render(state: CreatorReviewState): void;
  dispose(): void;
} {
  const doc = root.ownerDocument;
  function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className = '') {
    const node = doc.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  const wrapper = el('div', undefined, 'kettle-creator');
  const card = el('section', undefined, 'kc-card');
  card.setAttribute('aria-label', 'Creator scan and DNA review');
  const content = el('div', undefined, 'kc-stack');
  const status = el('p', undefined, 'kc-meta kc-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  card.append(content, status);
  wrapper.append(el('style', creatorReviewStyles), card);
  root.replaceChildren(wrapper);
  let disposed = false;
  let identity: string | undefined;

  function rows(values: Array<[string, string]>) {
    const list = el('dl');
    for (const [label, value] of values) {
      const row = el('div', undefined, 'kc-row');
      row.append(el('dt', label), el('dd', value));
      list.append(row);
    }
    return list;
  }
  function notes(title: string, values: string[]) {
    const group = el('div');
    group.append(el('h4', title));
    if (!values.length) group.append(el('p', 'None reported.', 'kc-meta'));
    else {
      const list = el('ul');
      values.forEach(value => list.append(el('li', value, 'kc-text')));
      group.append(list);
    }
    return group;
  }
  function details(label: string, key: string, accessibleName?: string) {
    const node = el('details');
    node.dataset.key = key;
    const summary = el('summary', accessibleName ?? label);
    summary.dataset.focus = key;
    node.append(summary);
    return node;
  }
  function date(value: string | null): string {
    return value === null ? 'Unknown' : value.replace('T', ' ').replace(/Z$/, ' UTC');
  }
  function number(value: number | null): string { return value === null ? 'Unknown' : String(value); }
  function source(parent: HTMLElement, url: string, fictional: boolean, key: string) {
    // Fictional platform handles are never links to potentially real accounts.
    const href = fictional ? undefined : safeUrl(url);
    if (!href) {
      parent.append(el('p', fictional ? `Fictional source: ${url}` : 'Source link unavailable', 'kc-meta kc-text'));
    } else {
      const link = el('a', 'Open source (new tab)', 'kc-source');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.referrerPolicy = 'no-referrer';
      link.dataset.focus = key;
      parent.append(link, el('p', url, 'kc-meta'));
    }
  }
  function observation(o: Observation, fictional: boolean, key: string) {
    const group = el('div', undefined, 'kc-observation kc-stack');
    if (!displayable(o)) {
      group.append(el('p', 'Observation withheld: display permission is not available.', 'kc-meta'));
      return group;
    }
    const p = o.provenance;
    if ('video' in o) {
      group.append(el('h4', 'Video observation'), el('p', o.caption ?? 'Caption unknown', 'kc-text'));
      group.append(rows([
        ['Published', date(o.published_at)], ['Duration', o.duration_seconds === null ? 'Unknown' : `${o.duration_seconds} seconds`],
        ['Views', number(o.metrics.views)], ['Likes', number(o.metrics.likes)],
        ['Comments', number(o.metrics.comments)], ['Shares', number(o.metrics.shares)],
      ]));
    } else {
      group.append(el('h4', o.display_name ?? o.handle), el('p', `@${o.handle}`, 'kc-meta'),
        el('p', o.bio ?? 'Biography unknown', 'kc-text'), rows([['Followers', number(o.follower_count)]]));
    }
    group.append(rows([
      ['Evidence origin', p.origin === 'fixture' ? 'Fictional fixture' : 'Provider observation'],
      ['Provider', p.provider], ['Retrieved', date(p.retrieved_at)], ['Source observed', date(p.source_observed_at)],
      ['Available evidence', p.modalities.join(', ')],
    ]));
    source(group, o.canonical_url, fictional || p.origin === 'fixture', `${key}-source`);
    if (p.source_url !== o.canonical_url) {
      group.append(el('p', 'Provenance source', 'kc-meta'));
      source(group, p.source_url, fictional || p.origin === 'fixture', `${key}-provenance`);
    }
    return group;
  }
  function render(state: CreatorReviewState) {
    if (disposed) return;
    const scan = state.kind === 'analysis' ? state.analysis.scan : state.kind === 'scan' ? state.scan : undefined;
    const nextIdentity = state.kind === 'saved' ? `saved:${state.dna.project_id}:${state.dna.dna_id}` : scan ? `${scan.id}:${scan.profile?.platform}:${scan.profile?.native_id}` : undefined;
    const same = !!identity && identity === nextIdentity;
    const open = new Set(same ? [...content.querySelectorAll<HTMLDetailsElement>('details[open]')].map(n => n.dataset.key) : []);
    const hadFocus = content.contains(doc.activeElement);
    const focused = same && hadFocus ? (doc.activeElement as HTMLElement).dataset.focus : undefined;
    content.replaceChildren(el('h2', 'Creator review'));
    identity = nextIdentity;
    function restoreFocus(fallback: HTMLElement) {
      if (!hadFocus) return;
      const target = focused ? [...content.querySelectorAll<HTMLElement>('[data-focus]')].find(n => n.dataset.focus === focused) : undefined;
      if (!target) fallback.tabIndex = -1;
      (target ?? fallback).focus({ preventScroll: true });
    }
    function announce(message: string) {
      if (status.textContent !== message) status.textContent = message;
    }
    if (state.kind === 'loading') {
      announce('Loading scan and Creator DNA…');
      restoreFocus(content.querySelector('h2')!);
      return;
    }
    if (state.kind === 'error') {
      content.append(el('p', state.message, 'kc-notice kc-text'), el('p', 'Ask Riff in chat to reopen this review.', 'kc-meta'));
      announce(`Creator review unavailable. ${state.message} Ask Riff in chat to reopen this review.`);
      restoreFocus(content.querySelector('h2')!);
      return;
    }
    if (state.kind === 'saved') {
      const dna = state.dna;
      const fictional = dna.contains_fixture_data || dna.evidence.some(e => e.origin === 'fixture');
      content.append(el('p', state.preview ? 'Fictional preview · No live scan or saved changes.'
        : fictional ? 'Saved Creator DNA · Contains fictional test data. This is not live provider evidence.'
        : 'Saved Creator DNA · Corrections are made through chat.', 'kc-notice'));
      const review = el('section', undefined, 'kc-stack');
      review.setAttribute('aria-label', 'Creator DNA');
      review.append(el('h3', 'Creator DNA'), el('p', `${state.preview ? 'Preview' : 'Saved'} version ${dna.version} · Created ${date(dna.created_at)}`, 'kc-meta'),
        rows([['Scan', scanLabels[dna.scan_status]],
          ['Video coverage', `${dna.coverage.unique_videos} unique ${dna.coverage.unique_videos === 1 ? 'video' : 'videos'} returned · up to ${dna.requested_videos} requested`],
          ['Oldest post', date(dna.coverage.oldest_published_at)], ['Newest post', date(dna.coverage.newest_published_at)]]),
        notes('Limitations', dna.limitations),
        el('p', 'To correct a trait, tell Riff in chat which statement to change. This review does not save corrections.', 'kc-notice'));
      if (dna.coverage_limited) review.append(el('p', 'Coverage: bounded sample.', 'kc-meta'));
      if (dna.withheld_claim_count) review.append(el('p', `${dna.withheld_claim_count} ${dna.withheld_claim_count === 1 ? 'trait' : 'traits'} withheld because source display permission is unavailable.`, 'kc-meta'));
      if (!dna.claims.length) review.append(el('p', 'No displayable DNA traits supplied.', 'kc-meta'));
      const byId = new Map(dna.evidence.map(e => [e.observation_id, e]));
      for (const [claimIndex, claim] of dna.claims.entries()) {
        const block = el('article', undefined, 'kc-claim');
        block.append(el('h4', dimensions[claim.dimension]));
        if (claim.evidence.some(e => !byId.has(e.observation_id))) {
          block.append(el('p', 'Trait withheld: supporting evidence is unavailable.', 'kc-meta'));
        } else {
          block.append(el('p', basis[claim.basis], 'kc-basis'), el('p', claim.statement, 'kc-text'),
            rows([['Method', claim.method], ['Uncertainty', claim.uncertainty]]));
          const evidence = details(`Evidence (${claim.evidence.length})`, `claim-${claim.id}`,
            `Evidence (${claim.evidence.length}) for ${dimensions[claim.dimension]}, trait ${claimIndex + 1}`);
          if (!claim.evidence.length) evidence.append(el('p', 'User-supplied correction; no observation evidence attached.', 'kc-meta'));
          for (const [i, ref] of claim.evidence.entries()) {
            const o = byId.get(ref.observation_id)!;
            const group = el('div', undefined, 'kc-observation kc-stack');
            group.append(el('p', `Evidence ${i + 1} · ${ref.modality}${ref.start_seconds !== null ? ` · ${ref.start_seconds}–${ref.end_seconds} seconds` : ''}`, 'kc-meta'),
              rows([['Evidence origin', o.origin === 'fixture' ? 'Fictional fixture' : 'Provider observation'],
                ['Published', date(o.published_at)], ['Retrieved', date(o.retrieved_at)], ['Source observed', date(o.source_observed_at)]]));
            if (o.metrics) group.append(rows([['Views', number(o.metrics.views)], ['Likes', number(o.metrics.likes)],
              ['Comments', number(o.metrics.comments)], ['Shares', number(o.metrics.shares)]]));
            else group.append(el('p', 'Metrics not supplied for this evidence.', 'kc-meta'));
            source(group, o.url, state.preview || fictional || o.origin === 'fixture', `claim-${claim.id}-${ref.observation_id}`);
            evidence.append(group);
          }
          block.append(evidence);
        }
        review.append(block);
      }
      content.append(review);
      for (const node of content.querySelectorAll<HTMLDetailsElement>('details')) node.open = open.has(node.dataset.key);
      restoreFocus(review.querySelector('h3')!);
      announce(`${state.preview ? 'Preview' : 'Saved'} DNA version ${dna.version} shown.${fictional ? ' Contains fictional test data.' : ''}`);
      return;
    }
    // These branches deliberately accept only D0 entities, never a copied view schema.
    const result = state.kind === 'analysis' ? state.analysis.scan : state.scan;
    const observations = [...result.profile_observations, ...result.video_observations];
    const fictional = state.preview || observations.some(o => o.provenance.origin === 'fixture');
    content.append(el('p', fictional
      ? 'Fictional preview · No live scan or saved changes. This data is not evidence of persistence.'
      : 'Snapshot supplied for review. This view does not verify persistence or fetch current data.', 'kc-notice'));
    const section = el('section', undefined, 'kc-stack');
    section.setAttribute('aria-label', 'Scan results');
    section.append(el('h3', 'Scan results'), el('p', scanLabels[result.status], 'kc-basis'),
      el('p', `Created ${date(result.created_at)}`, 'kc-meta'));
    source(section, result.request.supplied_url, fictional, 'supplied-url');
    section.append(rows([
      ['Video coverage', `${result.coverage.unique_videos} unique ${result.coverage.unique_videos === 1 ? 'video' : 'videos'} returned · up to ${result.request.max_videos} requested`],
      ['Page coverage', `${result.coverage.pages_received} ${result.coverage.pages_received === 1 ? 'page' : 'pages'} received · up to ${result.request.max_pages} requested`],
      ['Rejected items', String(result.coverage.rejected_items)],
      ['Pagination', { exhausted: 'Provider reports no more pages', more: 'More pages available', unknown: 'Unknown' }[result.coverage.pagination]],
      ['Stopped because', reasons[result.coverage.stop_reason]],
      ['Oldest post', date(result.coverage.oldest_published_at)], ['Newest post', date(result.coverage.newest_published_at)],
    ]));
    section.append(el('p', 'This is a bounded sample, not proof of complete profile coverage. Missing metrics remain unknown; zero means a reported zero.', 'kc-meta'),
      notes('Scan limitations', result.limitations), notes('Omissions', result.coverage.omissions));
    if (result.coverage.errors.length) section.append(notes('Reported scan errors', result.coverage.errors.map(e => errorLabels[e.code])));
    if (result.status === 'failed' || result.status === 'unavailable') section.append(el('p', 'Share a description of what you create in chat, or ask Riff about this scan. Opening this review does not retry it.', 'kc-notice'));
    const allEvidence = details(`Scan evidence (${observations.length} observations)`, 'scan-evidence');
    if (!observations.length) allEvidence.append(el('p', 'No observations available.', 'kc-meta'));
    observations.forEach(o => allEvidence.append(observation(o, fictional, `scan-${o.id}`)));
    section.append(allEvidence);
    content.append(section);
    if (state.kind === 'analysis') {
      const dna = state.analysis.dna;
      const review = el('section', undefined, 'kc-section kc-stack');
      review.setAttribute('aria-label', 'Creator DNA');
      review.append(el('h3', 'Creator DNA'), el('p', `Snapshot version ${dna.version} · Created ${date(dna.created_at)}`, 'kc-meta'),
        el('p', 'To correct a trait, tell Riff in chat which statement to change. This review does not save corrections.', 'kc-notice'),
        notes('DNA limitations', dna.limitations));
      if (!dna.claims.length) review.append(el('p', 'No DNA traits supplied. Ask Riff in chat for the available context.', 'kc-meta'));
      const byId = new Map(observations.map(o => [o.id, o]));
      dna.claims.forEach(claim => {
        const block = el('article', undefined, 'kc-claim');
        block.append(el('h4', dimensions[claim.dimension]));
        // Valid envelopes may still contain evidence not permitted for display.
        if (claim.evidence.some(e => !byId.has(e.observation_id) || !displayable(byId.get(e.observation_id)!))) {
          block.append(el('p', 'Trait withheld: supporting evidence is not available for display.', 'kc-meta'));
        } else {
          block.append(el('p', basis[claim.basis], 'kc-basis'), el('p', claim.statement, 'kc-text'),
            rows([['Method', claim.method], ['Uncertainty', claim.uncertainty]]));
          if (claim.basis === 'user_corrected') block.append(el('p', 'User correction replaces an earlier claim; it is not independent provider verification.', 'kc-meta'));
          const evidence = details(`Evidence (${claim.evidence.length})`, `claim-${claim.id}`);
          if (!claim.evidence.length) evidence.append(el('p', 'No observation evidence attached to this user correction.', 'kc-meta'));
          claim.evidence.forEach((ref, i) => {
            const o = byId.get(ref.observation_id)!;
            evidence.append(el('p', `Evidence ${i + 1} · ${ref.modality}${ref.start_seconds !== null ? ` · ${ref.start_seconds}–${ref.end_seconds} seconds` : ''}`, 'kc-meta'));
            evidence.append(observation(o, fictional, `claim-${claim.id}-${i}`));
          });
          block.append(evidence);
        }
        review.append(block);
      });
      content.append(review);
    } else content.append(el('p', 'Creator DNA is not included in this scan result.', 'kc-meta'));
    for (const node of content.querySelectorAll<HTMLDetailsElement>('details')) node.open = open.has(node.dataset.key);
    if (focused) [...content.querySelectorAll<HTMLElement>('[data-focus]')].find(n => n.dataset.focus === focused)?.focus({ preventScroll: true });
    status.textContent = `${scanLabels[result.status]} shown.${state.kind === 'analysis' ? ` DNA snapshot version ${state.analysis.dna.version}.` : ''}${fictional ? ' Fictional preview.' : ''}`;
  }
  render({ kind: 'loading' });
  return { render, dispose() { disposed = true; identity = undefined; wrapper.remove(); } };
}
