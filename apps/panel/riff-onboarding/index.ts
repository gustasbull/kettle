import { riffBaseStyles } from '../riff-ui/styles.ts';


const onboardingStyles = riffBaseStyles + `
html, body { margin: 0; padding: 0; background: transparent; }
.riff-onboarding {
  --riff-onboarding-card: var(--color-background-primary, #FCFCFE);
  --riff-onboarding-surface: var(--color-background-primary, #FFFFFF);
  --riff-onboarding-canvas: var(--color-background-secondary, #F0F3F7);
  --riff-onboarding-ink: var(--color-text-primary, #202124);
  --riff-onboarding-muted: var(--color-text-secondary, #596273);
  --riff-onboarding-line: var(--color-border-secondary, #E5EAF3);
  --riff-onboarding-wash-a: #DCEBFA;
  --riff-onboarding-wash-b: #E6DDF6;
  --riff-onboarding-wash-c: #F5E2EF;
  display: flex; justify-content: center; padding: 4px;
}
.riff-onboarding__card {
  display: flex; width: min(576px, 100%); min-width: 0; flex-direction: column; align-items: center;
  gap: 22px; overflow: hidden; padding: 28px 24px 24px; border: 1px solid var(--riff-onboarding-line); border-radius: 24px;
  background:
    radial-gradient(circle, rgba(101, 86, 122, .06) .6px, transparent .85px) center / 16px 16px,
    radial-gradient(at 10% 70%, var(--riff-onboarding-wash-a) 0%, transparent 60%) center / 100% 100%,
    radial-gradient(at 70% 65%, var(--riff-onboarding-wash-b) 0%, transparent 58%) center / 100% 100%,
    radial-gradient(at 92% 30%, var(--riff-onboarding-wash-c) 0%, transparent 55%) center / 100% 100%,
    var(--riff-onboarding-card);
  box-shadow: 0 3px 6px #20355608, 0 12px 26px #20355610;
}
.riff-onboarding__intro {
  display: flex; width: 100%; flex-direction: column; align-items: center; gap: 8px; text-align: center;
}
.riff-onboarding__eyebrow {
  width: 100%; max-width: 480px; color: var(--riff-onboarding-ink); font-size: 18px; font-weight: 500;
  line-height: 26px; letter-spacing: -.02em;
}
.riff-onboarding__headline { width: 100%; color: var(--riff-onboarding-ink); font-size: 34px; font-weight: 600; line-height: 42px; }
.riff-onboarding__carousel { width: 526px; max-width: 100%; overflow: clip; padding: 8px 2px 20px; outline: 0; }
.riff-onboarding__track { display: flex; width: max-content; align-items: stretch; gap: 14px; }
.riff-onboarding__slide {
  display: flex; width: 454px; flex: 0 0 454px; flex-direction: column; padding: 8px;
  border-radius: 24px; background: var(--riff-onboarding-surface); box-shadow: 0 3px 6px #2035560A, 0 10px 18px #20355614;
}
.riff-onboarding__visual {
  display: flex; width: 100%; min-height: 184px; flex: 0 0 auto; flex-direction: column;
  justify-content: center; gap: 8px; overflow: hidden; padding: 16px 16px 28px;
  border-radius: 18px; background: var(--riff-onboarding-canvas);
}
.riff-onboarding__start { display: flex; width: 100%; align-items: center; justify-content: center; gap: 12px; }
.riff-onboarding__sample-video {
  width: 80px; height: 124px; flex: 0 0 80px; overflow: hidden; border: 3px solid #FFFFFF;
  border-radius: 15px; background: #DCE3E8; box-shadow: 0 7px 16px #20355626;
}
.riff-onboarding__placeholder {
  position: relative; display: block; width: 100%; height: 100%; overflow: hidden;
  background:
    radial-gradient(circle at 68% 20%, #F5D9EE 0 12%, transparent 13%),
    linear-gradient(145deg, #B6D5F3 0 38%, #CFBCEB 39% 67%, #F0C8D9 68% 100%);
}
.riff-onboarding__placeholder::before {
  position: absolute; inset: 16px 11px 30px; border: 1px solid #FFFFFFB8; border-radius: 9px;
  background: linear-gradient(160deg, #FFFFFFB8, #FFFFFF4D); box-shadow: 0 5px 12px #3B436A2A; content: "";
}
.riff-onboarding__placeholder::after {
  position: absolute; right: 11px; bottom: 10px; left: 11px; height: 12px; border-radius: 999px;
  background: linear-gradient(90deg, #FFFFFFE8 0 58%, #FFFFFF70 58%); content: "";
}
.riff-onboarding__prompts { display: flex; width: 250px; flex: 0 0 250px; flex-direction: column; gap: 8px; }
.riff-onboarding__prompt {
  padding: 12px 14px; border-radius: 13px; background: var(--riff-onboarding-surface); color: var(--riff-onboarding-ink);
  font-family: system-ui, sans-serif; font-size: 13px; line-height: 19px; box-shadow: 0 3px 8px #2035560D;
}
.riff-onboarding__insight { display: flex; width: 100%; flex-direction: column; gap: 8px; }
.riff-onboarding__working {
  display: flex; flex-direction: column; padding-top: 7px; border-radius: 12px; background: #EAF3ED;
  box-shadow: 0 4px 10px #20355614;
}
.riff-onboarding__working-label {
  padding: 0 12px 7px; color: #42664E; font-family: system-ui, sans-serif;
  font-size: 12px; font-weight: 600; line-height: 16px;
}
.riff-onboarding__working-copy {
  padding: 12px; border-radius: 12px; background: var(--riff-onboarding-surface); color: var(--riff-onboarding-ink);
  font-family: system-ui, sans-serif; font-size: 13px; line-height: 16px;
}
.riff-onboarding__chips { display: flex; justify-content: center; gap: 6px; }
.riff-onboarding__chip {
  padding: 8px 12px; border-radius: 999px; background: var(--riff-onboarding-surface); color: #6933A1;
  font-family: system-ui, sans-serif; font-size: 12px; line-height: 16px;
}
.riff-onboarding__script {
  display: flex; flex-direction: column; gap: 7px; padding: 14px; border-radius: 14px;
  background: var(--riff-onboarding-surface); box-shadow: 0 7px 16px #20355614;
}
.riff-onboarding__script p { color: var(--riff-onboarding-ink); font-family: system-ui, sans-serif; font-size: 13px; line-height: 19px; }
.riff-onboarding__script .riff-onboarding__script-title { color: #6933A1; font-weight: 600; }
.riff-onboarding__copy {
  display: flex; width: 100%; min-height: 110px; flex-direction: column; gap: 8px;
  margin-top: -18px; padding: 20px; border-radius: 22px 22px 16px 16px; background: var(--riff-onboarding-surface);
}
.riff-onboarding__copy h3 { color: var(--riff-onboarding-ink); font-family: system-ui, sans-serif; font-size: 22px; font-weight: 600; line-height: 28px; }
.riff-onboarding__copy p { color: var(--riff-onboarding-muted); font-family: system-ui, sans-serif; font-size: 14px; line-height: 21px; }
.riff-onboarding__footer { display: flex; width: 100%; flex-direction: column; align-items: center; gap: 18px; }
.riff-onboarding__progress { display: flex; align-items: center; gap: 16px; }
.riff-onboarding__controls-label { color: var(--riff-onboarding-muted); font-size: 12px; line-height: 18px; }
.riff-onboarding__status { min-height: 18px; color: var(--riff-onboarding-muted); font-size: 12px; line-height: 18px; text-align: center; }
.riff-onboarding__status:empty { display: none; }
.riff-onboarding__dots { display: flex; align-items: center; gap: 0; }
.riff-onboarding__dot {
  display: flex; width: 44px; height: 44px; flex: 0 0 44px; align-items: center; justify-content: center;
  padding: 0; border: 0; border-radius: 999px; background: transparent; cursor: pointer;
}
.riff-onboarding__dot::before { width: 5px; height: 5px; border-radius: 999px; background: #D9E1EE; content: ""; }
.riff-onboarding__dot[aria-selected="true"]::before { width: 20px; background: #7138D4; }
@media (forced-colors: active) {
  .riff-onboarding__dot {
    border: 1px solid CanvasText; background: Canvas; forced-color-adjust: none;
  }
  .riff-onboarding__dot::before { background: CanvasText; }
  .riff-onboarding__dot[aria-selected="true"]::before { background: Highlight; }
}
.riff-onboarding__next {
  display: flex; width: 44px; height: 44px; flex: 0 0 44px; align-items: center; justify-content: center;
  padding: 0; border: 1px solid var(--riff-onboarding-line); border-radius: 999px; background: var(--riff-onboarding-canvas); cursor: pointer;
}
.riff-onboarding__next svg { display: block; width: 16px; height: 16px; }
.riff-onboarding__closing { display: flex; width:100%; min-width:0; flex-direction: column; align-items: center; gap: 5px; text-align: center; }
.riff-onboarding__closing strong { color: var(--riff-onboarding-ink); font-size: 15px; font-weight: 600; line-height: 21px; }
.riff-onboarding__closing p { width: 440px; max-width: 100%; color: var(--riff-onboarding-muted); font-size: 13px; line-height: 19px; }
.riff-onboarding__down { display: block; width: 18px; height: 18px; }
:root[data-theme="dark"] .riff-onboarding {
  --riff-onboarding-card: var(--color-background-primary, #101318);
  --riff-onboarding-surface: var(--color-background-secondary, #181D25);
  --riff-onboarding-canvas: #242832;
  --riff-onboarding-ink: var(--color-text-primary, #F6F7F9);
  --riff-onboarding-muted: var(--color-text-secondary, #C1C8D2);
  --riff-onboarding-line: var(--color-border-secondary, #596273);
  --riff-onboarding-wash-a: #162433;
  --riff-onboarding-wash-b: #221D31;
  --riff-onboarding-wash-c: #2E1E2A;
}
:root[data-theme="dark"] .riff-onboarding__working { background: #1F3527; }
:root[data-theme="dark"] .riff-onboarding__working-label { color: #A9D5B7; }
:root[data-theme="dark"] .riff-onboarding__chip,
:root[data-theme="dark"] .riff-onboarding__script-title { color: #C8A8FF; }
@container riff-app (max-width: 520px) {
  .riff-onboarding__card { padding-inline: 18px; }
  .riff-onboarding__headline { font-size: 30px; line-height: 38px; }
  .riff-onboarding__slide { width: calc(100cqi - 58px); flex-basis: calc(100cqi - 58px); }
  .riff-onboarding__visual { padding-inline: 12px; }
  .riff-onboarding__sample-video { width: 68px; height: 112px; flex-basis: 68px; }
  .riff-onboarding__prompts { width: auto; flex: 1 1 0; }
  .riff-onboarding__prompt { padding: 10px 11px; font-size: 12px; line-height: 17px; }
}
@container riff-app (max-width: 350px) {
  .riff-onboarding__card { gap: 18px; padding: 24px 14px 20px; }
  .riff-onboarding__headline { font-size: 28px; line-height: 35px; }
  .riff-onboarding__carousel { padding-inline: 0; }
  .riff-onboarding__slide { width: calc(100cqi - 46px); flex-basis: calc(100cqi - 46px); padding: 7px; }
  .riff-onboarding__visual { min-height: 176px; padding: 14px 10px 24px; }
  .riff-onboarding__start { gap: 8px; }
  .riff-onboarding__sample-video { width: 56px; height: 100px; flex-basis: 56px; border-width: 2px; }
  .riff-onboarding__prompt { padding: 8px 9px; font-size: 11px; line-height: 15px; }
  .riff-onboarding__copy { padding: 17px; }
  .riff-onboarding__progress { gap: 12px; }
}
`;

type OnboardingStep = {
  label: 'Start' | 'Find' | 'Make';
  title: string;
  body: string;
  visual: 'start' | 'find' | 'make';
};

const steps: readonly OnboardingStep[] = [
  { label: 'Start', visual: 'start', title: 'Start with what you have.', body: 'Share a video, profile, or idea. Let’s find your next move.' },
  { label: 'Find', visual: 'find', title: 'Find your breakout idea.', body: 'Discover viral videos, hooks, and angles you can make your own.' },
  { label: 'Make', visual: 'make', title: 'Make it yours.', body: 'Turn your inspiration into a script that sounds like you—ready to film.' },
] as const;

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  return node;
}

function startVisual(doc: Document) {
  const visual = element(doc, 'div', 'riff-onboarding__visual');
  const content = element(doc, 'div', 'riff-onboarding__start');
  const video = element(doc, 'div', 'riff-onboarding__sample-video');
  const placeholder = element(doc, 'span', 'riff-onboarding__placeholder');
  placeholder.setAttribute('aria-hidden', 'true');
  video.append(placeholder);
  const prompts = element(doc, 'div', 'riff-onboarding__prompts');
  const link = element(doc, 'p', 'riff-onboarding__prompt');
  link.textContent = 'A TikTok or Instagram link';
  const idea = element(doc, 'p', 'riff-onboarding__prompt');
  idea.textContent = '“I’m launching a focus app. Help me find a video idea.”';
  prompts.append(link, idea);
  content.append(video, prompts);
  visual.append(content);
  return visual;
}

function findVisual(doc: Document) {
  const visual = element(doc, 'div', 'riff-onboarding__visual');
  const insight = element(doc, 'div', 'riff-onboarding__insight');
  const working = element(doc, 'div', 'riff-onboarding__working');
  const label = element(doc, 'div', 'riff-onboarding__working-label');
  label.textContent = 'Working well';
  const copy = element(doc, 'div', 'riff-onboarding__working-copy');
  copy.textContent = 'Your demo makes the benefit easy to see.';
  working.append(label, copy);
  const chips = element(doc, 'div', 'riff-onboarding__chips');
  for (const value of ['Hooks', 'Showcases', 'CTAs']) {
    const chip = element(doc, 'div', 'riff-onboarding__chip');
    chip.textContent = value;
    chips.append(chip);
  }
  insight.append(working, chips);
  visual.append(insight);
  return visual;
}

function makeVisual(doc: Document) {
  const visual = element(doc, 'div', 'riff-onboarding__visual');
  const script = element(doc, 'div', 'riff-onboarding__script');
  const lines = [
    ['Your ready-to-film script', 'riff-onboarding__script-title'],
    ['Hook · “Still distracted after an hour?”', ''],
    ['Main content · Show one focused task.', ''],
    ['CTA · “Try it for your next session.”', ''],
  ] as const;
  for (const [value, className] of lines) {
    const line = element(doc, 'p', className);
    line.textContent = value;
    script.append(line);
  }
  visual.append(script);
  return visual;
}

function nextIcon(doc: Document) {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'm9 5 7 7-7 7');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#35578B');
  path.setAttribute('stroke-width', '1.7');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

function downIcon(doc: Document) {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'riff-onboarding__down');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M12 4v16m-6-6 6 6 6-6');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#3865F8');
  path.setAttribute('stroke-width', '1.7');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

type RiffOnboardingCompletion = { status: 'sent' | 'failed'; message: string };

export function mountRiffOnboarding(
  root: HTMLElement,
  options: { onComplete?: () => Promise<RiffOnboardingCompletion> } = {},
): { dispose(): void } {
  const doc = root.ownerDocument;
  const style = element(doc, 'style');
  style.textContent = onboardingStyles;
  const app = element(doc, 'div', 'riff-app riff-onboarding');
  const card = element(doc, 'section', 'riff-onboarding__card');
  card.setAttribute('aria-label', 'Welcome to Riff');
  const intro = element(doc, 'header', 'riff-onboarding__intro');
  const eyebrow = element(doc, 'h1', 'riff-onboarding__eyebrow');
  eyebrow.textContent = 'Welcome to Riff';
  const headline = element(doc, 'h2', 'riff-onboarding__headline');
  headline.textContent = 'Unlock your viral potential.';
  intro.append(eyebrow, headline);

  const carousel = element(doc, 'section', 'riff-onboarding__carousel riff-onboarding__viewport');
  carousel.setAttribute('role', 'region');
  carousel.setAttribute('aria-label', 'How Riff works');
  carousel.tabIndex = 0;
  const track = element(doc, 'div', 'riff-onboarding__track');
  const slides: HTMLElement[] = [];
  const dots: HTMLButtonElement[] = [];
  steps.forEach((step, index) => {
    const slide = element(doc, 'article', 'riff-onboarding__slide');
    slide.id = 'riff-onboarding-slide-' + (index + 1);
    slide.setAttribute('role', 'tabpanel');
    slide.setAttribute('aria-label', step.label + ': ' + step.title);
    const visual = step.visual === 'start' ? startVisual(doc) : step.visual === 'find' ? findVisual(doc) : makeVisual(doc);
    const copy = element(doc, 'div', 'riff-onboarding__copy');
    const title = element(doc, 'h3');
    title.textContent = step.title;
    const body = element(doc, 'p');
    body.textContent = step.body;
    copy.append(title, body);
    slide.append(visual, copy);
    slides.push(slide);
    track.append(slide);
  });
  carousel.append(track);

  const footer = element(doc, 'div', 'riff-onboarding__footer');
  const progress = element(doc, 'div', 'riff-onboarding__progress');
  const controlsLabel = element(doc, 'span', 'riff-onboarding__controls-label');
  controlsLabel.textContent = 'How it works';
  const dotList = element(doc, 'div', 'riff-onboarding__dots');
  dotList.setAttribute('role', 'tablist');
  dotList.setAttribute('aria-label', 'Onboarding steps');
  const next = element(doc, 'button', 'riff-onboarding__next');
  next.type = 'button';
  next.setAttribute('aria-label', 'Next step');
  next.append(nextIcon(doc));
  progress.append(controlsLabel, dotList, next);
  const completionStatus = element(doc, 'p', 'riff-onboarding__status');
  completionStatus.setAttribute('role', 'status');
  completionStatus.setAttribute('aria-live', 'polite');
  const closing = element(doc, 'footer', 'riff-onboarding__closing');
  const closingTitle = element(doc, 'strong');
  closingTitle.textContent = 'Ready for your next breakout?';
  const closingCopy = element(doc, 'p');
  closingCopy.append(
    doc.createTextNode('Share a video or profile link, or tell me your idea.'),
    element(doc, 'br'),
    doc.createTextNode('Start here in chat or use the app on the right.'),
  );
  closing.append(closingTitle, closingCopy, downIcon(doc));
  footer.append(progress, completionStatus, closing);
  card.append(intro, carousel, footer);
  app.append(card);
  root.replaceChildren(style, app);

  let active = 0;
  let completing = false;
  let disposed = false;
  const select = (index: number, focus = false) => {
    active = Math.max(0, Math.min(steps.length - 1, index));
    const offset = slides[active]!.offsetLeft - slides[0]!.offsetLeft;
    track.style.transform = 'translateX(' + (-offset) + 'px)';
    slides.forEach((slide, position) => {
      if (position === active) slide.setAttribute('aria-current', 'step');
      else slide.removeAttribute('aria-current');
      slide.setAttribute('aria-hidden', String(position !== active));
    });
    dots.forEach((dot, position) => {
      dot.setAttribute('aria-selected', String(position === active));
      dot.tabIndex = position === active ? 0 : -1;
    });
    next.setAttribute('aria-label', options.onComplete && active === steps.length - 1 ? 'Finish welcome' : 'Next step');
    if (focus) dots[active]!.focus();
  };
  steps.forEach((step, index) => {
    const dot = element(doc, 'button', 'riff-onboarding__dot');
    dot.type = 'button';
    dot.id = 'riff-onboarding-dot-' + (index + 1);
    dot.setAttribute('role', 'tab');
    dot.setAttribute('aria-label', 'Show ' + step.label + ' step');
    dot.setAttribute('aria-controls', slides[index]!.id);
    slides[index]!.setAttribute('aria-labelledby', dot.id);
    dot.addEventListener('click', () => select(index));
    dots.push(dot);
    dotList.append(dot);
  });
  const onNext = async () => {
    if (completing || disposed) return;
    if (!options.onComplete || active < steps.length - 1) {
      select((active + 1) % steps.length);
      return;
    }
    completing = true;
    next.disabled = true;
    completionStatus.textContent = 'Finishing your welcome…';
    try {
      const result = await options.onComplete();
      if (disposed) return;
      completionStatus.textContent = result.message;
      if (result.status === 'failed') {
        completing = false;
        next.disabled = false;
      }
    } catch {
      if (disposed) return;
      completionStatus.textContent = 'Riff could not finish the welcome. Try again.';
      completing = false;
      next.disabled = false;
    }
  };
  const onKeydown = (event: KeyboardEvent) => {
    const index = event.key === 'ArrowRight' ? Math.min(steps.length - 1, active + 1)
      : event.key === 'ArrowLeft' ? Math.max(0, active - 1)
        : event.key === 'Home' ? 0 : event.key === 'End' ? steps.length - 1 : undefined;
    if (index === undefined) return;
    event.preventDefault();
    select(index, true);
  };
  const onResize = () => select(active);
  next.addEventListener('click', onNext);
  carousel.addEventListener('keydown', onKeydown);
  dotList.addEventListener('keydown', onKeydown);
  const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(onResize);
  resize?.observe(carousel);
  select(0);
  return {
    dispose() {
      disposed = true;
      resize?.disconnect();
      next.removeEventListener('click', onNext);
      carousel.removeEventListener('keydown', onKeydown);
      dotList.removeEventListener('keydown', onKeydown);
      root.replaceChildren();
    },
  };
}
