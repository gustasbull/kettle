import type { Project } from '../../../packages/contracts/index.ts';
import type { RiffActionResult } from '../riff-ui/dom.ts';
import {
  emptyProductDraft,
  productDraftFromProject,
  validateProductDraft,
  type ProductDraft,
} from '../riff-product-context-validation.ts';
import { riffProductContextStyles } from './styles.ts';

export type ProductContextSaveOutcome =
  | { status: 'saved'; project: Project; requestId: string }
  | { status: 'conflict'; latest: Project; message: string }
  | { status: 'failed'; message: string };

export type ProductContextSource =
  | { kind: 'unsaved'; description: string }
  | { kind: 'saved'; project: Project };

type ProductContextActions = {
  onSave(context: { draft: ProductDraft; project: Project | null }): Promise<ProductContextSaveOutcome>;
  onDiscover(project: Project): Promise<RiffActionResult>;
};

const validationRequestId = '00000000-0000-4000-8000-000000000000';
const fieldOrder: Array<keyof ProductDraft> = [
  'product', 'description', 'audience', 'goal', 'tone', 'language', 'duration_seconds', 'filming_constraints',
];

export function mountRiffProductContext(root: HTMLElement, actions: ProductContextActions) {
  const doc = root.ownerDocument;
  const style = doc.createElement('style'); style.textContent = riffProductContextStyles;
  let disposed = false;
  let generation = 0;
  let draft = emptyProductDraft('');
  let project: Project | null = null;
  let savedProject: Project | null = null;
  let busy = false;
  let pendingFrame: number | undefined;

  function cancelPendingFrame() {
    if (pendingFrame === undefined) return;
    root.ownerDocument.defaultView?.cancelAnimationFrame?.(pendingFrame);
    pendingFrame = undefined;
  }

  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className = '') => {
    const node = doc.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const pencil = () => {
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'm15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15v5Z');
    path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round'); svg.append(path); return svg;
  };

  function pending() {
    const main = element('main', undefined, 'riff-product');
    const panel = element('section', undefined, 'riff-product__pending'); panel.dataset.productState = 'pending';
    const intro = element('div', undefined, 'riff-product__pending-intro');
    intro.append(element('h1', 'Understanding your product'),
      element('p', 'Turning your description into an editable brief.'));
    const progress = element('div', undefined, 'riff-product__pending-progress');
    const line = element('div', undefined, 'riff-product__pending-line');
    const spinner = element('span', undefined, 'riff-product__spinner'); spinner.setAttribute('aria-hidden', 'true');
    const live = element('p', 'Preparing your editable brief…'); live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
    line.append(spinner, live);
    const track = element('div', undefined, 'riff-product__pending-track'); track.setAttribute('aria-hidden', 'true');
    track.append(element('span', undefined, 'riff-product__pending-segment'));
    const footer = element('div', undefined, 'riff-product__pending-footer');
    const received = element('span', undefined, 'riff-product__pending-received'); received.append(element('span', '✓'), doc.createTextNode('Description received'));
    footer.append(received, element('span', 'Preparing your brief'));
    progress.append(line, track, footer); panel.append(intro, progress); main.append(panel);
    root.replaceChildren(style, main);
  }

  function editor(moveFocus: boolean) {
    const main = element('main', undefined, 'riff-product');
    const panel = element('section', undefined, 'riff-product__panel'); panel.dataset.productState = 'editing';
    const header = element('header', undefined, 'riff-product__header');
    const heading = element('h1', 'Give your product viral potential.'); heading.tabIndex = -1;
    header.append(heading, element('p', 'Fine-tune your brief. We’ll find video ideas that bring your product to life.'));
    const content = element('div', undefined, 'riff-product__content');
    const identity = element('aside', undefined, 'riff-product__identity'); identity.setAttribute('aria-label', 'Product summary');
    const mark = element('span', undefined, 'riff-product__identity-mark'); mark.setAttribute('aria-hidden', 'true');
    const markSvg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); markSvg.setAttribute('viewBox', '0 0 32 32');
    markSvg.innerHTML = '<path d="M12 5H6V11M20 5H26V11M6 21V27H12M26 21V27H20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><rect x="12" y="12" width="8" height="8" rx="3" fill="currentColor"/>';
    mark.append(markSvg);
    const identityName = element('strong'); const identityDescription = element('p');
    identity.append(mark, identityName, identityDescription);

    const form = element('form', undefined, 'riff-product__brief'); form.setAttribute('aria-label', 'Your product brief');
    form.noValidate = true;
    const formHeader = element('div', 'Your product brief', 'riff-product__brief-header');
    const inner = element('div', undefined, 'riff-product__brief-inner');
    const errorSummary = element('div', undefined, 'riff-product__errors'); errorSummary.tabIndex = -1;
    errorSummary.setAttribute('role', 'alert'); errorSummary.hidden = true;
    const controls = new Map<keyof ProductDraft, HTMLElement>();
    const errors = new Map<keyof ProductDraft, HTMLElement>();
    let validationRevealed = false;

    const row = (labelText: string, field: keyof ProductDraft, control: HTMLInputElement | HTMLTextAreaElement) => {
      const wrapper = element('div', undefined, 'riff-product__row');
      const label = element('label', labelText, 'riff-product__label'); label.htmlFor = control.id;
      control.setAttribute('aria-label', labelText); control.placeholder = 'Unknown — add a value';
      const controlWrap = element('div', undefined, 'riff-product__control');
      const error = element('p', '', 'riff-product__field-error'); error.id = `${control.id}-error`; error.hidden = true;
      controlWrap.append(control, error); wrapper.append(label, controlWrap, pencil()); inner.append(wrapper);
      controls.set(field, control); errors.set(field, error);
      control.addEventListener('input', () => {
        if (field === 'duration_seconds') draft.duration_seconds = control.value;
        else (draft as Record<string, unknown>)[field] = control.value;
        changed(field); updateIdentity(); updateValidity();
      });
    };
    const input = (id: string, value: string, maximum: number) => {
      const control = element('input'); control.id = id; control.value = value; control.maxLength = maximum;
      control.autocomplete = 'off'; return control;
    };
    row('Product', 'product', input('riff-product-product', draft.product, 120));
    const description = element('textarea'); description.id = 'riff-product-description'; description.value = draft.description; description.maxLength = 4_000;
    row('Description', 'description', description);
    row('Audience', 'audience', input('riff-product-audience', draft.audience, 1_000));
    row('Main benefit', 'goal', input('riff-product-goal', draft.goal, 1_000));
    row('Content style', 'tone', input('riff-product-tone', draft.tone, 200));
    row('Language', 'language', input('riff-product-language', draft.language, 35));
    const duration = input('riff-product-duration', draft.duration_seconds, 3); duration.type = 'number'; duration.min = '5'; duration.max = '180'; duration.step = '1';
    row('Duration in seconds', 'duration_seconds', duration);

    const constraintRow = element('fieldset', undefined, 'riff-product__constraints');
    const legend = element('legend', 'Filming constraints'); constraintRow.append(legend);
    const constraintList = element('div', undefined, 'riff-product__constraint-list');
    const constraintError = element('p', '', 'riff-product__field-error'); constraintError.id = 'riff-product-constraints-error'; constraintError.hidden = true;
    errors.set('filming_constraints', constraintError); controls.set('filming_constraints', constraintRow);
    const addConstraint = element('button', 'Add filming constraint', 'riff-product__secondary'); addConstraint.type = 'button';
    constraintRow.append(constraintList, constraintError, addConstraint); inner.append(constraintRow);
    function renderConstraints(focusIndex?: number) {
      constraintList.replaceChildren();
      draft.filming_constraints.forEach((value, index) => {
        const item = element('div', undefined, 'riff-product__constraint');
        const control = input(`riff-product-constraint-${index}`, value, 500);
        control.setAttribute('aria-label', `Filming constraint ${index + 1}`);
        control.addEventListener('input', () => { draft.filming_constraints[index] = control.value; changed('filming_constraints'); updateValidity(); });
        const remove = element('button', `Remove filming constraint ${index + 1}`, 'riff-product__remove'); remove.type = 'button';
        remove.addEventListener('click', () => { draft.filming_constraints.splice(index, 1); changed('filming_constraints'); renderConstraints(); updateValidity(); addConstraint.focus({ preventScroll: true }); });
        item.append(control, remove); constraintList.append(item);
      });
      if (focusIndex !== undefined) constraintList.querySelector<HTMLInputElement>(`#riff-product-constraint-${focusIndex}`)?.focus({ preventScroll: true });
    }
    addConstraint.addEventListener('click', () => {
      if (draft.filming_constraints.length >= 21) return;
      draft.filming_constraints.push(''); changed('filming_constraints'); renderConstraints(draft.filming_constraints.length - 1); updateValidity();
    });
    renderConstraints();

    const help = element('p', '', 'riff-product__validation-help'); help.dataset.productValidationHelp = '';
    help.id = 'riff-product-validation-help';
    const actionsRow = element('div', undefined, 'riff-product__actions');
    const confirm = element('button', 'Confirm context', 'riff-product__primary'); confirm.type = 'submit'; confirm.setAttribute('aria-describedby', help.id);
    const discover = element('button', 'Discover formats', 'riff-product__primary'); discover.type = 'button'; discover.hidden = true;
    actionsRow.append(confirm, discover); inner.append(errorSummary, help, actionsRow); form.append(formHeader, inner); content.append(identity, form); panel.append(header, content);
    const live = element('p', '', 'riff-product__live'); live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite'); live.setAttribute('aria-atomic', 'true');
    panel.append(live); main.append(panel); root.replaceChildren(style, main);

    function updateIdentity() {
      const name = draft.product.trim();
      const show = !!name && !/^unknown(?:\s*[—-]\s*add a value)?$/i.test(name);
      identity.hidden = !show; identityName.textContent = show ? name : '';
      identityDescription.textContent = show ? draft.description.trim() : '';
    }
    function changed(field: keyof ProductDraft) {
      savedProject = null;
      discover.hidden = true;
      live.textContent = '';
      const error = errors.get(field); if (error) { error.hidden = true; error.textContent = ''; }
      const control = controls.get(field); control?.removeAttribute('aria-invalid'); control?.removeAttribute('aria-describedby');
      errorSummary.hidden = true; errorSummary.textContent = '';
    }
    function currentValidation() { return validateProductDraft(draft, project, validationRequestId); }
    function clearErrors() {
      for (const field of fieldOrder) {
        const error = errors.get(field); if (error) { error.hidden = true; error.textContent = ''; }
        const control = controls.get(field); control?.removeAttribute('aria-invalid'); control?.removeAttribute('aria-describedby');
      }
      errorSummary.hidden = true; errorSummary.textContent = '';
    }
    function showErrors(validation: Extract<ReturnType<typeof validateProductDraft>, { ok: false }>, moveFocus: boolean) {
      clearErrors();
      errorSummary.hidden = false; errorSummary.textContent = 'Review the highlighted product context fields.';
      for (const field of fieldOrder) {
        const message = validation.errors[field]; if (!message) continue;
        const error = errors.get(field); const control = controls.get(field); if (!error || !control) continue;
        error.textContent = message; error.hidden = false; control.setAttribute('aria-invalid', 'true'); control.setAttribute('aria-describedby', error.id);
      }
      if (moveFocus) {
        const first = fieldOrder.find(field => validation.errors[field]);
        if (first === 'filming_constraints') {
          (constraintList.querySelector<HTMLInputElement>('input') ?? addConstraint).focus({ preventScroll: true });
        } else controls.get(first ?? 'product')?.focus({ preventScroll: true });
        live.textContent = 'Product context needs corrections before it can be saved.';
      }
    }
    function updateValidity() {
      const validation = currentValidation(); confirm.disabled = busy;
      addConstraint.disabled = busy || draft.filming_constraints.length > 20;
      help.textContent = validation.ok ? 'All required context is ready to confirm.'
        : Object.values(validation.errors).filter(Boolean).join(' ');
      if (validationRevealed) {
        if (validation.ok) clearErrors(); else showErrors(validation, false);
      }
    }
    function setBusy(next: boolean) {
      busy = next; form.setAttribute('aria-busy', String(next));
      form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>('input,textarea,button').forEach(control => { control.disabled = next; });
      if (!next) updateValidity();
    }
    form.addEventListener('submit', event => {
      event.preventDefault(); if (busy) return;
      const validation = currentValidation();
      if (!validation.ok) { validationRevealed = true; showErrors(validation, true); return; }
      const current = generation; setBusy(true); live.textContent = 'Saving your product context…';
      const submitted = structuredClone(draft);
      void actions.onSave({ draft: submitted, project }).then(outcome => {
        if (disposed || current !== generation) return;
        setBusy(false);
        if (outcome.status === 'saved') {
          project = outcome.project; savedProject = outcome.project; discover.hidden = false;
          live.textContent = 'Context saved'; discover.focus({ preventScroll: true }); return;
        }
        if (outcome.status === 'conflict') project = outcome.latest;
        live.textContent = outcome.message; confirm.focus({ preventScroll: true });
      }).catch(() => {
        if (disposed || current !== generation) return;
        setBusy(false); live.textContent = 'Riff could not verify that product context was saved. Your local draft is still here.';
        confirm.focus({ preventScroll: true });
      });
    });
    discover.addEventListener('click', () => {
      if (!savedProject || busy) return;
      const current = generation; discover.disabled = true; live.textContent = 'Sending saved context to ChatGPT…';
      void actions.onDiscover(savedProject).then(result => {
        if (disposed || current !== generation) return; discover.disabled = false; live.textContent = result.message;
      }).catch(() => {
        if (disposed || current !== generation) return; discover.disabled = false; live.textContent = 'The ChatGPT handoff failed. Continue in the composer.';
      });
    });
    updateIdentity(); updateValidity(); if (savedProject) discover.hidden = false;
    if (moveFocus) heading.focus({ preventScroll: true });
  }

  return {
    start(source: ProductContextSource) {
      if (disposed) return;
      cancelPendingFrame();
      const current = ++generation; busy = false;
      if (source.kind === 'saved') {
        project = source.project; savedProject = source.project; draft = productDraftFromProject(source.project); editor(true); return;
      }
      project = null; savedProject = null; draft = emptyProductDraft(source.description); pending();
      const advance = () => {
        pendingFrame = undefined;
        if (!disposed && current === generation) editor(true);
      };
      const view = doc.defaultView;
      if (view?.requestAnimationFrame) pendingFrame = view.requestAnimationFrame(advance);
      else queueMicrotask(advance);
    },
    dispose() { if (disposed) return; disposed = true; generation++; cancelPendingFrame(); root.replaceChildren(); },
  };
}
