import { riffBaseStyles } from '../riff-ui/styles.ts';

const paperCreatorImage = 'data:image/jpeg;base64,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';

const onboardingStyles = riffBaseStyles + `
html, body { margin: 0; padding: 0; background: transparent; }
.riff-onboarding { display: flex; justify-content: center; padding: 4px; }
.riff-onboarding__card {
  display: flex; width: min(576px, 100%); min-width: 0; flex-direction: column; align-items: center;
  gap: 22px; overflow: hidden; padding: 28px 24px 24px; border: 1px solid #E5EAF3; border-radius: 24px;
  background:
    radial-gradient(circle, rgba(101, 86, 122, .06) .6px, transparent .85px) center / 16px 16px,
    radial-gradient(at 10% 70%, #DCEBFA 0%, transparent 60%) center / 100% 100%,
    radial-gradient(at 70% 65%, #E6DDF6 0%, transparent 58%) center / 100% 100%,
    radial-gradient(at 92% 30%, #F5E2EF 0%, transparent 55%) center / 100% 100%,
    #FCFCFE;
  box-shadow: 0 3px 6px #20355608, 0 12px 26px #20355610;
}
.riff-onboarding__intro {
  display: flex; width: 100%; flex-direction: column; align-items: center; gap: 8px; text-align: center;
}
.riff-onboarding__eyebrow {
  width: 100%; max-width: 480px; color: #202124; font-size: 18px; font-weight: 500;
  line-height: 26px; letter-spacing: -.02em;
}
.riff-onboarding__headline { width: 100%; color: #202124; font-size: 34px; font-weight: 600; line-height: 42px; }
.riff-onboarding__carousel { width: 526px; max-width: 100%; overflow: clip; padding: 8px 2px 20px; outline: 0; }
.riff-onboarding__track { display: flex; width: max-content; align-items: stretch; gap: 14px; }
.riff-onboarding__slide {
  display: flex; width: 454px; flex: 0 0 454px; flex-direction: column; padding: 8px;
  border-radius: 24px; background: #FFFFFF; box-shadow: 0 3px 6px #2035560A, 0 10px 18px #20355614;
}
.riff-onboarding__visual {
  display: flex; width: 100%; height: 184px; flex: 0 0 184px; flex-direction: column;
  justify-content: center; gap: 8px; overflow: hidden; padding: 16px 16px 28px;
  border-radius: 18px; background: #F0F3F7;
}
.riff-onboarding__start { display: flex; width: 100%; align-items: center; justify-content: center; gap: 12px; }
.riff-onboarding__sample-video {
  width: 80px; height: 124px; flex: 0 0 80px; overflow: hidden; border: 3px solid #FFFFFF;
  border-radius: 15px; background: #DCE3E8; box-shadow: 0 7px 16px #20355626;
}
.riff-onboarding__sample-video img { display: block; width: 100%; height: 100%; object-fit: cover; }
.riff-onboarding__prompts { display: flex; width: 250px; flex: 0 0 250px; flex-direction: column; gap: 8px; }
.riff-onboarding__prompt {
  padding: 12px 14px; border-radius: 13px; background: #FFFFFF; color: #000000;
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
  padding: 12px; border-radius: 12px; background: #FFFFFF; color: #000000;
  font-family: system-ui, sans-serif; font-size: 13px; line-height: 16px;
}
.riff-onboarding__chips { display: flex; justify-content: center; gap: 6px; }
.riff-onboarding__chip {
  padding: 8px 12px; border-radius: 999px; background: #FFFFFF; color: #6933A1;
  font-family: system-ui, sans-serif; font-size: 12px; line-height: 16px;
}
.riff-onboarding__script {
  display: flex; flex-direction: column; gap: 7px; padding: 14px; border-radius: 14px;
  background: #FFFFFF; box-shadow: 0 7px 16px #20355614;
}
.riff-onboarding__script p { color: #000000; font-family: system-ui, sans-serif; font-size: 13px; line-height: 19px; }
.riff-onboarding__script .riff-onboarding__script-title { color: #6933A1; font-weight: 600; }
.riff-onboarding__copy {
  display: flex; width: 100%; min-height: 110px; flex-direction: column; gap: 8px;
  margin-top: -18px; padding: 20px; border-radius: 22px 22px 16px 16px; background: #FFFFFF;
}
.riff-onboarding__copy h3 { color: #242426; font-family: system-ui, sans-serif; font-size: 22px; font-weight: 600; line-height: 28px; }
.riff-onboarding__copy p { color: #596273; font-family: system-ui, sans-serif; font-size: 14px; line-height: 21px; }
.riff-onboarding__footer { display: flex; width: 100%; flex-direction: column; align-items: center; gap: 18px; }
.riff-onboarding__progress { display: flex; align-items: center; gap: 16px; }
.riff-onboarding__controls-label { color: #596273; font-size: 12px; line-height: 18px; }
.riff-onboarding__dots { display: flex; align-items: center; gap: 6px; }
.riff-onboarding__dot {
  width: 5px; height: 5px; flex: 0 0 5px; padding: 0; border: 0; border-radius: 999px;
  background: #D9E1EE; cursor: pointer;
}
.riff-onboarding__dot[aria-selected="true"] { width: 20px; flex-basis: 20px; background: #7138D4; }
.riff-onboarding__next {
  display: flex; width: 32px; height: 32px; flex: 0 0 32px; align-items: center; justify-content: center;
  padding: 0; border: 1px solid #E3E8F1; border-radius: 999px; background: #F0F3F7; cursor: pointer;
}
.riff-onboarding__next svg { display: block; width: 16px; height: 16px; }
.riff-onboarding__closing { display: flex; flex-direction: column; align-items: center; gap: 5px; text-align: center; }
.riff-onboarding__closing strong { color: #242426; font-size: 15px; font-weight: 600; line-height: 21px; }
.riff-onboarding__closing p { width: 440px; max-width: 100%; color: #596273; font-size: 13px; line-height: 19px; }
.riff-onboarding__down { display: block; width: 18px; height: 18px; }
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
  .riff-onboarding__visual { height: 176px; flex-basis: 176px; padding: 14px 10px 24px; }
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
  const image = element(doc, 'img');
  image.src = paperCreatorImage;
  image.alt = '';
  video.append(image);
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

export function mountRiffOnboarding(root: HTMLElement): { dispose(): void } {
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
  footer.append(progress, closing);
  card.append(intro, carousel, footer);
  app.append(card);
  root.replaceChildren(style, app);

  let active = 0;
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
  const onNext = () => select((active + 1) % steps.length);
  const onKeydown = (event: KeyboardEvent) => {
    const index = event.key === 'ArrowRight' ? Math.min(steps.length - 1, active + 1)
      : event.key === 'ArrowLeft' ? Math.max(0, active - 1)
        : event.key === 'Home' ? 0 : event.key === 'End' ? steps.length - 1 : undefined;
    if (index === undefined) return;
    event.preventDefault();
    select(index);
  };
  const onResize = () => select(active);
  next.addEventListener('click', onNext);
  carousel.addEventListener('keydown', onKeydown);
  const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(onResize);
  resize?.observe(carousel);
  select(0);
  return {
    dispose() {
      resize?.disconnect();
      next.removeEventListener('click', onNext);
      carousel.removeEventListener('keydown', onKeydown);
      root.replaceChildren();
    },
  };
}
