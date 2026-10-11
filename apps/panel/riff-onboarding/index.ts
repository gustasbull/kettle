import { riffBaseStyles } from '../riff-ui/styles.ts';

const onboardingStyles = `
${riffBaseStyles}
html, body { margin: 0; padding: 0; background: transparent; }
.riff-onboarding { padding: 4px; }
.riff-onboarding__card {
  min-width: 0; overflow: hidden; padding: 24px; border: 1px solid var(--riff-line);
  border-radius: var(--riff-radius-surface); background: var(--riff-surface);
}
.riff-onboarding__eyebrow { color: var(--riff-primary); font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.riff-onboarding__headline { margin-top: 6px; font-size: clamp(24px, 7cqi, 34px); font-weight: 750; line-height: 1.08; letter-spacing: -.035em; }
.riff-onboarding__promise { margin-top: 10px; color: var(--riff-muted); }
.riff-onboarding__tabs { display: flex; gap: 8px; margin-top: 22px; }
.riff-onboarding__tab { width: 32px; height: 8px; padding: 0; border: 0; border-radius: 999px; background: var(--riff-line); cursor: pointer; }
.riff-onboarding__tab[aria-selected="true"] { width: 52px; background: var(--riff-primary); }
.riff-onboarding__panel { min-height: 128px; padding-top: 22px; }
.riff-onboarding__number { color: var(--riff-muted); font-size: 13px; font-weight: 650; }
.riff-onboarding__panel h2 { margin-top: 4px; font-size: 22px; line-height: 1.18; letter-spacing: -.025em; }
.riff-onboarding__panel p { margin-top: 8px; color: var(--riff-muted); }
.riff-onboarding__hint { padding-top: 16px; border-top: 1px solid var(--riff-line); font-size: 13px; color: var(--riff-muted); }
@container riff-app (max-width: 320px) { .riff-onboarding__card { padding: 20px; } }
`;

const steps = [
  { title: 'Start with what you have.', body: 'Share a creator profile, video link, or the idea already in your head.' },
  { title: 'Find your breakout idea.', body: 'Riff turns creator evidence into focused directions you can actually make.' },
  { title: 'Make it yours.', body: 'Choose a direction, then shape the hook, main content, showcase, and call to action in Studio.' },
] as const;

export function mountRiffOnboarding(root: HTMLElement): { dispose(): void } {
  const doc = root.ownerDocument;
  const style = doc.createElement('style');
  style.textContent = onboardingStyles;
  const app = doc.createElement('div');
  app.className = 'riff-app riff-onboarding';
  const card = doc.createElement('section');
  card.className = 'riff-onboarding__card';
  card.setAttribute('aria-label', 'Welcome to Riff');
  const eyebrow = doc.createElement('h1');
  eyebrow.className = 'riff-onboarding__eyebrow';
  eyebrow.textContent = 'Welcome to Riff';
  const heading = doc.createElement('p');
  heading.className = 'riff-onboarding__headline';
  heading.textContent = 'Unlock your viral potential.';
  const promise = doc.createElement('p');
  promise.className = 'riff-onboarding__promise';
  promise.textContent = 'Your creator workflow, from first signal to a filmable script.';
  const tabs = doc.createElement('div');
  tabs.className = 'riff-onboarding__tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'How Riff works');
  const panels: HTMLElement[] = [];
  const buttons: HTMLButtonElement[] = [];
  let active = 0;
  const select = (index: number, focus = false) => {
    active = Math.max(0, Math.min(steps.length - 1, index));
    buttons.forEach((button, position) => {
      const selected = position === active;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      panels[position]!.hidden = !selected;
    });
    if (focus) buttons[active]!.focus();
  };
  steps.forEach((step, index) => {
    const tab = doc.createElement('button');
    tab.type = 'button';
    tab.className = 'riff-onboarding__tab';
    tab.id = `riff-onboarding-tab-${index + 1}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-label', `Step ${index + 1}: ${step.title}`);
    tab.setAttribute('aria-controls', `riff-onboarding-panel-${index + 1}`);
    tab.addEventListener('click', () => select(index));
    tab.addEventListener('keydown', (event) => {
      const next = event.key === 'ArrowRight' ? (active + 1) % steps.length
        : event.key === 'ArrowLeft' ? (active - 1 + steps.length) % steps.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? steps.length - 1 : undefined;
      if (next !== undefined) { event.preventDefault(); select(next, true); }
    });
    buttons.push(tab);
    tabs.append(tab);
    const panel = doc.createElement('article');
    panel.className = 'riff-onboarding__panel';
    panel.id = `riff-onboarding-panel-${index + 1}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    const number = doc.createElement('p');
    number.className = 'riff-onboarding__number';
    number.textContent = `0${index + 1} / 03`;
    const title = doc.createElement('h2');
    title.textContent = step.title;
    const body = doc.createElement('p');
    body.textContent = step.body;
    panel.append(number, title, body);
    panels.push(panel);
  });
  const hint = doc.createElement('p');
  hint.className = 'riff-onboarding__hint';
  hint.textContent = 'Open Riff from ChatGPT whenever you want to start, find, or make. Use the ChatGPT composer to add links or attachments.';
  card.append(eyebrow, heading, promise, tabs, ...panels, hint);
  app.append(card);
  root.replaceChildren(style, app);
  select(0);
  return { dispose() { root.replaceChildren(); } };
}
