import type { CreatorJobView, PipelineReference } from '../../../packages/contracts/creator-pipeline.ts';
import type { CreatorDnaView } from '../../../packages/contracts/creator-operations.ts';
import { seedVideoAccessMessage } from '../seed-video-review.ts';
import { riffLockup } from '../riff-ui/brand.ts';
import { formatRiffDate, safeHttpUrl, type RiffActionResult, type RiffPanelAction } from '../riff-ui/dom.ts';
import { riffBaseStyles } from '../riff-ui/styles.ts';
import { creatorPipelineStyles } from './styles.ts';

export type RiffCreatorDisplayMode = 'inline' | 'fullscreen';
export type CreatorPipelineOptions = {
  displayMode?: RiffCreatorDisplayMode;
  sendPrompt?: RiffPanelAction;
  requestFullscreen?: () => Promise<RiffActionResult>;
};

const unavailable: RiffPanelAction = async () => ({
  status: 'unsupported', message: 'Continue with this request in the ChatGPT composer.',
});

/** Pure presentation plus explicit host handoffs. It never fetches, saves, retries, or starts provider work. */
export function mountCreatorPipeline(root: HTMLElement, options: CreatorPipelineOptions = {}): {
  render(job: CreatorJobView): void;
  setDisplayMode(mode: RiffCreatorDisplayMode): void;
  dispose(): void;
} {
  const doc = root.ownerDocument;
  const sendPrompt = options.sendPrompt ?? unavailable;
  const requestFullscreen = options.requestFullscreen ?? (async () => ({
    status: 'unsupported' as const, message: 'Open this result fullscreen from ChatGPT to continue.',
  }));
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className = '') => {
    const node = doc.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const style = el('style'); style.textContent = riffBaseStyles + creatorPipelineStyles;
  const wrapper = el('div', undefined, 'riff-app riff-pipeline');
  const card = el('section', undefined, 'riff-pipeline__surface');
  card.setAttribute('aria-label', 'Riff creator job');
  const content = el('div', undefined, 'riff-pipeline__content');
  const status = el('p', 'Waiting for saved job details.', 'riff-pipeline__status');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
  card.append(content, status); wrapper.append(card); root.replaceChildren(style, wrapper);

  let disposed = false;
  let mode: RiffCreatorDisplayMode = options.displayMode ?? 'inline';
  let current: CreatorJobView | undefined;
  let identity: string | undefined;
  let ideaIndex = 0;
  let variantIndex = 0;
  let studioTab = 0;

  const setStatus = (text: string) => { if (status.textContent !== text) status.textContent = text; };
  const rows = (values: Array<[string, string]>) => {
    const list = el('dl', undefined, 'riff-facts');
    for (const [label, value] of values) {
      const row = el('div', undefined, 'riff-fact'); row.append(el('dt', label), el('dd', value)); list.append(row);
    }
    return list;
  };
  const list = (title: string, values: string[], className = '') => {
    const group = el('section', undefined, className);
    group.append(el('h3', title));
    if (!values.length) group.append(el('p', 'None reported.', 'riff-muted'));
    else { const items = el('ul'); values.forEach(value => items.append(el('li', value))); group.append(items); }
    return group;
  };
  const button = (label: string, className: string, handler: () => void, focus: string) => {
    const control = el('button', label, className); control.type = 'button'; control.dataset.focus = focus;
    control.addEventListener('click', handler); return control;
  };
  const run = async (action: () => Promise<RiffActionResult>) => {
    setStatus('Handing this off to ChatGPT…');
    try { setStatus((await action()).message); }
    catch { setStatus('The handoff failed. Continue in the ChatGPT composer.'); }
  };
  const actions = (...controls: HTMLButtonElement[]) => {
    const group = el('div', undefined, 'riff-actions'); group.append(...controls); return group;
  };
  const brand = () => {
    const node = el('div', undefined, 'riff-pipeline__brand'); node.append(riffLockup(doc)); return node;
  };
  const title = (text: string, eyebrow?: string) => {
    const group = el('div', undefined, 'riff-title');
    if (eyebrow) group.append(el('p', eyebrow, 'riff-eyebrow'));
    const heading = el('h1', text); heading.tabIndex = -1; group.append(heading); return { group, heading };
  };
  const addFullscreenBrand = () => { if (mode === 'fullscreen') content.append(brand()); };
  const provenance = (fictional: boolean) => el('p', fictional
    ? 'Contains fictional test data. This is not live provider evidence.'
    : 'Based on saved evidence. Opening this view does not fetch current data.', 'riff-notice');
  const lineage = (version: number, dnaId: string, createdAt: string) => rows([
    ['Captured DNA version', String(version)], ['DNA ID', dnaId], ['Created', formatRiffDate(createdAt)],
  ]);
  const safeReference = (reference: PipelineReference, fictional: boolean) => {
    const item = el('article', undefined, 'riff-reference');
    const media = el('div', 'Preview unavailable', 'riff-reference__media');
    const body = el('div', undefined, 'riff-reference__body');
    body.append(el('p', reference.caption ?? 'Caption unknown', 'riff-reference__caption'), rows([
      ['Published', formatRiffDate(reference.published_at)],
      ['Retrieved', formatRiffDate(reference.retrieved_at)],
      ['Views', reference.views === null ? 'Unknown' : String(reference.views)],
    ]));
    const href = fictional ? undefined : safeHttpUrl(reference.url);
    if (href) {
      const link = el('a', 'Open TikTok reference', 'riff-link');
      link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer';
      body.append(link);
    } else body.append(el('p', fictional ? `Fictional source · ${reference.url}` : 'Source link unavailable.', 'riff-muted'));
    if (reference.limitations.length) body.append(list('Reference limitations', reference.limitations, 'riff-compact-list'));
    item.append(media, body); return item;
  };

  function renderPending(job: CreatorJobView) {
    addFullscreenBrand();
    const copy = job.kind === 'scan' ? 'Analyzing your creator context…'
      : job.kind === 'recommendations' ? 'Finding your next directions…' : 'Building your filming variants…';
    const { group, heading } = title(copy, 'Saved Riff job'); content.append(group);
    const progress = el('div', undefined, 'riff-progress'); progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-label', 'Work in progress');
    content.append(progress, el('p', job.message ?? (job.state === 'queued'
      ? 'This job is queued. Riff will read its saved status without starting it again.'
      : 'Riff is checking the saved job. No completion percentage is available.'), 'riff-lede'));
    setStatus(`${heading.textContent} ${job.state === 'queued' ? 'Queued.' : 'In progress.'}`);
    return heading;
  }

  function renderFailure(job: CreatorJobView) {
    addFullscreenBrand();
    const reconcile = job.state === 'needs_reconciliation';
    const { group, heading } = title(reconcile ? 'This outcome needs review.' : 'This job could not finish.', 'Riff job status');
    content.append(group, el('p', job.message ?? 'No additional failure detail was saved.', 'riff-lede'), el('p', reconcile
      ? 'Ask Riff in ChatGPT to reconcile the saved outcome before retrying or starting paid work. This view does not retry it.'
      : 'Review the failure in ChatGPT before starting another request. This view does not retry it.', 'riff-notice'));
    setStatus(`${heading.textContent} ${reconcile ? 'Reconcile the outcome before retrying.' : 'Review the failure in ChatGPT.'}`);
    return heading;
  }

  function renderAnalysis(job: CreatorJobView & { result: { kind: 'scan'; dna: CreatorDnaView } }) {
    const dna = job.result.dna;
    const headingText = dna.seed_review ? 'Video analysis' : 'Creator analysis';
    if (mode === 'inline') {
      const { group, heading } = title(headingText, 'Riff analysis'); content.append(group,
        el('p', `${dna.claims.length} saved ${dna.claims.length === 1 ? 'signal' : 'signals'} across ${dna.coverage.unique_videos} unique ${dna.coverage.unique_videos === 1 ? 'video' : 'videos'}.`, 'riff-lede'),
        el('p', `Captured DNA version ${dna.version}. ${dna.coverage_limited ? 'Coverage is a bounded sample.' : ''}`, 'riff-muted'),
        actions(
          button('Open analysis', 'riff-button riff-button--primary', () => void run(requestFullscreen), 'open-analysis'),
          button('Explore viral formats', 'riff-button', () => void run(() => sendPrompt(`Use Riff to explore viral formats from creator job ${job.id} and captured DNA version ${dna.version}. Do not start provider work without my explicit confirmation.`)), 'explore-formats'),
        ));
      setStatus(`${headingText} ready. Captured DNA version ${dna.version}.`); return heading;
    }
    addFullscreenBrand();
    const { group, heading } = title(headingText, `${dna.profile.platform} · ${dna.profile.native_id}`);
    content.append(group, provenance(dna.contains_fixture_data), rows([
      ['Source', `${dna.profile.platform} · ${dna.profile.native_id}`],
      ['Coverage', `${dna.coverage.unique_videos} unique ${dna.coverage.unique_videos === 1 ? 'video' : 'videos'} of up to ${dna.requested_videos} requested`],
      ['Oldest post', formatRiffDate(dna.coverage.oldest_published_at)],
      ['Newest post', formatRiffDate(dna.coverage.newest_published_at)],
      ['Analysis created', formatRiffDate(dna.created_at)],
    ]));
    if (dna.seed_review) {
      const review = dna.seed_review;
      const seedPanel = el('section', undefined, 'riff-seed');
      seedPanel.setAttribute('aria-label', 'Lightreel review of supplied video');
      seedPanel.append(el('p', 'Supplied video review', 'riff-eyebrow'), el('h2', review.summary),
        el('p', 'This review concerns the supplied video only. Profile-wide Creator DNA is shown separately.', 'riff-muted'));
      if (review.origin === 'fixture') seedPanel.append(el('p', 'Fictional test review. This is not live provider evidence.', 'riff-notice'));
      seedPanel.append(el('p', seedVideoAccessMessage(review.access_basis), 'riff-notice'),
        rows([['Provider', review.provider], ['Source', review.url], ['Retrieved', review.retrieved_at.replace('T', ' ').replace(/Z$/, ' UTC')]]),
        list('Review limitations', review.limitations, 'riff-compact-list'));
      const href = review.origin === 'live' ? safeHttpUrl(review.url) : undefined;
      if (href) { const link = el('a', 'Open supplied video', 'riff-link'); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer'; seedPanel.append(link); }
      content.append(seedPanel);
    }
    const dimensions: Array<[string, CreatorDnaView['claims'][number]['dimension'][]]> = [
      ['Hook', ['hooks']], ['Content', ['topics', 'formats']], ['Style & pacing', ['duration', 'pacing']],
      ['Voice & language', []], ['Script', ['structure']], ['CTA', ['cta']],
    ];
    const grid = el('section', undefined, 'riff-analysis-grid'); grid.setAttribute('aria-label', 'Analysis dimensions');
    const basis = { observed: 'Observed', inferred: 'Inferred', user_corrected: 'User-corrected' } as const;
    for (const [label, sourceDimensions] of dimensions) {
      const panel = el('article', undefined, 'riff-dimension'); panel.append(el('h2', label));
      const claims = dna.claims.filter(claim => sourceDimensions.includes(claim.dimension));
      if (!claims.length) panel.append(el('p', 'Unavailable from saved evidence.', 'riff-muted'));
      for (const claim of claims) panel.append(el('p', basis[claim.basis], 'riff-basis'), el('p', claim.statement),
        el('p', `${claim.method} · ${claim.uncertainty}`, 'riff-muted'));
      grid.append(panel);
    }
    content.append(grid, list('Limitations', dna.limitations), lineage(dna.version, dna.dna_id, dna.created_at), actions(
      button('Rework this video', 'riff-button riff-button--primary', () => void run(() => sendPrompt(`Use Riff to rework the analyzed creator video from job ${job.id}, grounded in DNA ${dna.dna_id} version ${dna.version}. Ask what I want to change before drafting.`)), 'rework-video'),
      button('Explore viral formats', 'riff-button', () => void run(() => sendPrompt(`Use Riff to explore viral formats from creator job ${job.id} and captured DNA version ${dna.version}. Do not start provider work without my explicit confirmation.`)), 'explore-formats'),
      button('Create a video', 'riff-button riff-button--quiet', () => void run(() => sendPrompt(`Use Riff to create a video from creator job ${job.id} and captured DNA version ${dna.version}. Continue in ChatGPT and ask me to choose a direction.`)), 'create-video'),
    ));
    setStatus(`${headingText} shown. ${dna.claims.length} saved signals. Captured DNA version ${dna.version}.`); return heading;
  }

  function renderDiscovery(job: CreatorJobView & { result: { kind: 'recommendations' } }) {
    const batch = job.result.batch;
    const references = new Map(batch.references.map(reference => [reference.id, reference]));
    const valid = batch.ideas.filter(idea => idea.reference_ids.every(id => references.has(id)));
    const fictional = batch.contains_fixture_data || batch.references.some(reference => reference.origin === 'fixture');
    if (mode === 'inline') {
      const { group, heading } = title('Discovery', 'Riff ideas');
      const count = valid.length;
      content.append(group, el('p', count ? `${count} evidence-backed ${count === 1 ? 'idea' : 'ideas'} ready to explore.` : 'No evidence-backed ideas returned.', 'riff-lede'));
      if (batch.limitations.length) content.append(el('p', batch.limitations.join(' '), 'riff-muted'));
      content.append(actions(button('Open discovery', 'riff-button riff-button--primary', () => void run(requestFullscreen), 'open-discovery')));
      setStatus(`${count} ${count === 1 ? 'idea' : 'ideas'} available. Captured DNA version ${batch.dna_version}.`); return heading;
    }
    addFullscreenBrand();
    const { group, heading } = title('Find your next breakout idea.', `${valid.length} ${valid.length === 1 ? 'idea' : 'ideas'} · captured DNA version ${batch.dna_version}`);
    content.append(group, provenance(fictional));
    const libraries = el('nav', undefined, 'riff-libraries'); libraries.setAttribute('aria-label', 'Discovery libraries');
    const libraryData = [
      ['videos', 'Videos', false], ['hooks', 'Hooks · ChatGPT', true],
      ['showcases', 'Product showcases · ChatGPT', true], ['ctas', 'CTAs · ChatGPT', true],
    ] as const;
    for (const [kind, label, handoff] of libraryData) {
      const control = button(label, `riff-library${kind === 'videos' ? ' riff-library--active' : ''}`, () => {
        if (handoff) void run(() => sendPrompt(`Use Riff to explore ${kind === 'showcases' ? 'product showcases' : kind} for recommendation batch ${batch.id}. This category continues in ChatGPT because the saved batch has no category-specific results.`));
      }, `library-${kind}`);
      control.dataset.library = kind; if (!handoff) control.setAttribute('aria-current', 'page'); libraries.append(control);
    }
    content.append(libraries);
    if (!valid.length) {
      content.append(el('p', 'No evidence-backed ideas returned. Review the saved limitations in ChatGPT or choose another direction.', 'riff-notice'));
    } else {
      ideaIndex = Math.min(ideaIndex, valid.length - 1);
      const selected = valid[ideaIndex]!;
      const carousel = el('section', undefined, 'riff-discovery'); carousel.dataset.discoveryCarousel = '';
      carousel.dataset.focus = 'discovery-carousel'; carousel.tabIndex = 0; carousel.setAttribute('aria-label', `Idea ${ideaIndex + 1} of ${valid.length}`);
      carousel.addEventListener('keydown', event => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault(); ideaIndex = (ideaIndex + (event.key === 'ArrowRight' ? 1 : -1) + valid.length) % valid.length; render(job);
      });
      const top = el('div', undefined, 'riff-discovery__top');
      top.append(el('p', `Idea ${ideaIndex + 1} / ${valid.length}`, 'riff-eyebrow'), el('h2', selected.title));
      const controls = actions(
        button('Previous idea', 'riff-icon-button', () => { ideaIndex = (ideaIndex - 1 + valid.length) % valid.length; render(job); }, 'previous-idea'),
        button('Next idea', 'riff-icon-button', () => { ideaIndex = (ideaIndex + 1) % valid.length; render(job); }, 'next-idea'),
      );
      top.append(controls);
      const body = el('div', undefined, 'riff-discovery__body');
      body.append(rows([['Concept', selected.concept], ['Why it fits', selected.creator_fit], ['Evidence', selected.evidence_summary], ['How to film it', selected.execution]]));
      if (selected.limitations.length) body.append(list('Idea limitations', selected.limitations, 'riff-compact-list'));
      const sources = el('section', undefined, 'riff-reference-grid'); sources.append(el('h3', 'Sources'));
      selected.reference_ids.forEach(id => sources.append(safeReference(references.get(id)!, fictional)));
      carousel.append(top, body, sources, actions(
        button('Make it mine', 'riff-button riff-button--primary', () => void run(() => sendPrompt(`Use Riff to make batch ${batch.id} idea ${selected.id} mine. Draft two or three filmable variants from the captured DNA and cited references, then let me choose.`)), 'make-it-mine'),
        button('Create a video', 'riff-button riff-button--quiet', () => void run(() => sendPrompt(`Use Riff to create a video from batch ${batch.id} idea ${selected.id}. Continue in ChatGPT without claiming anything has been saved.`)), 'create-video'),
      ));
      content.append(carousel);
    }
    if (batch.ideas.length !== valid.length) content.append(el('p', `${batch.ideas.length - valid.length} idea was withheld because its supporting reference was unavailable.`, 'riff-notice'));
    content.append(list('Batch limitations', batch.limitations), lineage(batch.dna_version, batch.dna_id, batch.created_at));
    setStatus(`${valid.length} ${valid.length === 1 ? 'idea' : 'ideas'} shown. Captured DNA version ${batch.dna_version}.`); return heading;
  }

  function renderStudio(job: CreatorJobView & { result: { kind: 'scripts' } }) {
    const scripts = job.result.scripts;
    if (mode === 'inline') {
      const { group, heading } = title('Your script, ready to film.', 'Riff Studio');
      content.append(group, el('p', `${scripts.variants.length} saved filming ${scripts.variants.length === 1 ? 'variant' : 'variants'} · captured DNA version ${scripts.dna_version}.`, 'riff-lede'),
        actions(button('Open Studio', 'riff-button riff-button--primary', () => void run(requestFullscreen), 'open-studio')));
      setStatus(`${scripts.variants.length} filming variants ready.`); return heading;
    }
    addFullscreenBrand();
    const { group, heading } = title('Your script, ready to film.', `Studio · ${scripts.variants.length} variants`); content.append(group, provenance(scripts.contains_fixture_data));
    variantIndex = Math.min(variantIndex, scripts.variants.length - 1);
    const variants = el('div', undefined, 'riff-variants'); variants.setAttribute('aria-label', 'Filming variants');
    scripts.variants.forEach((variant, index) => {
      const control = button(variant.label, `riff-variant${index === variantIndex ? ' riff-variant--active' : ''}`, () => { variantIndex = index; render(job); }, `variant-${variant.id}`);
      control.dataset.variant = variant.id; control.setAttribute('aria-pressed', String(index === variantIndex)); variants.append(control);
    });
    content.append(variants);
    const variant = scripts.variants[variantIndex]!;
    const tabNames = ['Full video', 'Hook', 'Main content', 'CTA'] as const;
    const tabs = el('div', undefined, 'riff-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Script components');
    const panels: HTMLElement[] = [];
    tabNames.forEach((name, index) => {
      const tab = button(name, 'riff-tab', () => { studioTab = index; render(job); }, `studio-tab-${index}`);
      tab.id = `riff-studio-tab-${index}`; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(index === studioTab));
      tab.setAttribute('aria-controls', `riff-studio-panel-${index}`); tab.tabIndex = index === studioTab ? 0 : -1;
      tab.addEventListener('keydown', event => {
        if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); studioTab = event.key === 'Home' ? 0 : event.key === 'End' ? 3
          : (studioTab + (event.key === 'ArrowRight' ? 1 : -1) + tabNames.length) % tabNames.length; render(job);
      });
      tabs.append(tab);
      const panel = el('section', undefined, 'riff-studio-panel'); panel.id = `riff-studio-panel-${index}`;
      panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', tab.id); panel.hidden = index !== studioTab; panels.push(panel);
    });
    const field = (parent: HTMLElement, name: string, value: string) => {
      const section = el('section', undefined, 'riff-script-field'); section.append(el('h3', name), el('p', value)); parent.append(section);
    };
    const bullets = (parent: HTMLElement, name: string, values: string[]) => parent.append(list(name, values, 'riff-script-field'));
    const full = panels[0]!;
    full.append(rows([['Variant', variant.label], ['Estimated duration', `${variant.estimated_duration_seconds} seconds`], ['Script version', String(scripts.version)]]));
    field(full, 'Hook', variant.hook); field(full, 'Opening visual', variant.opening_visual); field(full, 'Script', variant.script);
    bullets(full, 'Shots', variant.shots); bullets(full, 'B-roll', variant.b_roll); bullets(full, 'On-screen text', variant.on_screen_text);
    field(full, 'Showcase timing', variant.showcase_timing); field(full, 'Call to action', variant.cta); field(full, 'Pacing', variant.pacing);
    field(panels[1]!, 'Hook', variant.hook); field(panels[1]!, 'Opening visual', variant.opening_visual);
    field(panels[2]!, 'Script', variant.script); bullets(panels[2]!, 'Shots', variant.shots); bullets(panels[2]!, 'B-roll', variant.b_roll);
    bullets(panels[2]!, 'On-screen text', variant.on_screen_text); field(panels[2]!, 'Showcase timing', variant.showcase_timing); field(panels[2]!, 'Pacing', variant.pacing);
    field(panels[3]!, 'Call to action', variant.cta);
    panels[studioTab]!.append(el('p', 'Caption and platform publishing fields are not part of this saved script.', 'riff-notice'));
    content.append(tabs, ...panels, list('Variant limitations', variant.limitations), list('Script set limitations', scripts.limitations),
      lineage(scripts.dna_version, scripts.dna_id, scripts.created_at), actions(
        button('Save for later', 'riff-button', () => void run(() => sendPrompt(`Help me save variant ${variant.id} for later in ChatGPT. Riff has not saved this action because no save-state tool is available.`)), 'save-later'),
        button('I filmed it', 'riff-button', () => void run(() => sendPrompt(`I filmed variant ${variant.id}. Record that acknowledgement in ChatGPT only; it is not persisted in Riff because no filmed-state tool is available.`)), 'filmed-it'),
        button('Create a video', 'riff-button riff-button--primary', () => void run(() => sendPrompt(`Use Riff to refine filming variant ${variant.id} from script set ${scripts.id}. Continue in ChatGPT.`)), 'create-video'),
      ));
    setStatus(`${variant.label} shown in Studio. Captured DNA version ${scripts.dna_version}.`); return heading;
  }

  function render(job: CreatorJobView) {
    if (disposed) return;
    const nextIdentity = `${job.project_id}:${job.id}`;
    const same = identity === nextIdentity;
    const active = doc.activeElement as HTMLElement | null;
    const hadFocus = !!active && content.contains(active);
    const focusKey = same && hadFocus ? active?.dataset.focus : undefined;
    if (!same) { ideaIndex = 0; variantIndex = 0; studioTab = 0; }
    identity = nextIdentity; current = job; wrapper.dataset.mode = mode; content.replaceChildren();
    let heading: HTMLElement;
    if (job.state === 'queued' || job.state === 'running') heading = renderPending(job);
    else if (job.state === 'failed' || job.state === 'needs_reconciliation') heading = renderFailure(job);
    else if (job.result?.kind === 'scan') heading = renderAnalysis(job as CreatorJobView & { result: { kind: 'scan'; dna: CreatorDnaView } });
    else if (job.result?.kind === 'recommendations') heading = renderDiscovery(job as CreatorJobView & { result: { kind: 'recommendations' } });
    else if (job.result?.kind === 'scripts') heading = renderStudio(job as CreatorJobView & { result: { kind: 'scripts' } });
    else { const result = title('Saved result unavailable.', 'Riff creator job'); content.append(result.group); heading = result.heading; setStatus('Saved result unavailable.'); }
    if (hadFocus) ([...content.querySelectorAll<HTMLElement>('[data-focus]')].find(node => node.dataset.focus === focusKey) ?? heading).focus({ preventScroll: true });
  }
  return {
    render,
    setDisplayMode(nextMode) { if (disposed || mode === nextMode) return; mode = nextMode; if (current) render(current); },
    dispose() { if (disposed) return; disposed = true; current = undefined; root.replaceChildren(); },
  };
}
