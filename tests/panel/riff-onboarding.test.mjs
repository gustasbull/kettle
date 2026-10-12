import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'esbuild';

test('Riff onboarding renders the approved Paper carousel without host chrome', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffOnboarding } from './apps/panel/riff-onboarding/index.ts';
    window.view = mountRiffOnboarding(document.getElementById('root'));
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
  const errors = [];
  const networkRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', request => {
    if (/^https?:/i.test(request.url())) networkRequests.push(request.url());
  });
  await page.setContent(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`);

  assert.equal(await page.getByRole('heading', { name: 'Welcome to Riff' }).count(), 1);
  assert.equal(await page.getByRole('heading', { name: 'Unlock your viral potential.' }).count(), 1);
  assert.equal(await page.getByRole('region', { name: 'How Riff works' }).count(), 1);
  assert.equal(await page.locator('.riff-onboarding__slide').count(), 3);
  assert.equal(await page.locator('.riff-onboarding__visual').count(), 3);
  assert.equal(await page.getByText('Start with what you have.').count(), 1);
  assert.equal(await page.getByText('Find your breakout idea.').count(), 1);
  assert.equal(await page.getByText('Make it yours.').count(), 1);
  assert.equal(await page.getByText('A TikTok or Instagram link').count(), 1);
  assert.equal(await page.getByText('“I’m launching a focus app. Help me find a video idea.”').count(), 1);
  assert.equal(await page.getByText('Your demo makes the benefit easy to see.').count(), 1);
  assert.equal(await page.getByText('Discover viral videos, hooks, and angles you can make your own.').count(), 1);
  assert.equal(await page.getByText('Your ready-to-film script').count(), 1);
  assert.equal(await page.getByText('Hook · “Still distracted after an hour?”').count(), 1);
  assert.equal(await page.getByText('Main content · Show one focused task.').count(), 1);
  assert.equal(await page.getByText('CTA · “Try it for your next session.”').count(), 1);
  assert.equal(await page.getByText('Turn your inspiration into a script that sounds like you—ready to film.').count(), 1);
  assert.equal(await page.getByText('How it works').count(), 1);
  assert.equal(await page.getByText('Ready for your next breakout?').count(), 1);
  assert.equal(await page.getByText('Share a video or profile link, or tell me your idea.').count(), 1);
  assert.equal(await page.getByText('Start here in chat or use the app on the right.').count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Next step' }).count(), 1);
  assert.equal(await page.getByRole('tab', { name: /Show .* step/ }).count(), 3);
  assert.equal(await page.getByRole('tab', { name: 'Start', exact: true }).count(), 0,
    'the old segmented Start/Find/Make control is not part of the approved design');
  assert.equal(await page.locator('svg[aria-label="Riff"]').count(), 0, 'inline cards rely on host attribution');
  assert.equal(await page.locator('textarea,input[type="text"],form').count(), 0, 'onboarding does not duplicate the composer');
  assert.equal(await page.locator('.riff-onboarding__sample-video .riff-onboarding__placeholder').count(), 1,
    'the first step uses a Riff-owned neutral placeholder in the Paper-shaped frame');
  assert.equal(await page.locator('.riff-onboarding img').count(), 0,
    'illustrative Paper media is never redistributed by onboarding');

  const exactMetrics = await page.evaluate(() => {
    const box = selector => document.querySelector(selector).getBoundingClientRect();
    const style = selector => getComputedStyle(document.querySelector(selector));
    const typeMetrics = selector => {
      const value = style(selector);
      return [value.fontSize, value.fontWeight, value.lineHeight];
    };
    const cardStyle = style('.riff-onboarding__card');
    return {
      card: box('.riff-onboarding__card'), viewport: box('.riff-onboarding__viewport'),
      slide: box('.riff-onboarding__slide'), visual: box('.riff-onboarding__visual'),
      media: box('.riff-onboarding__sample-video'), eyebrow: typeMetrics('.riff-onboarding__eyebrow'),
      headline: typeMetrics('.riff-onboarding__headline'),
      cardStyle: {
        borderRadius: cardStyle.borderRadius, paddingTop: cardStyle.paddingTop,
        backgroundColor: cardStyle.backgroundColor, backgroundImage: cardStyle.backgroundImage,
      },
    };
  });
  assert.equal(Math.round(exactMetrics.card.width), 576);
  assert.equal(Math.round(exactMetrics.viewport.width), 526);
  assert.equal(Math.round(exactMetrics.slide.width), 454);
  assert.equal(Math.round(exactMetrics.visual.height), 184);
  assert.deepEqual([Math.round(exactMetrics.media.width), Math.round(exactMetrics.media.height)], [80, 124]);
  assert.deepEqual(exactMetrics.eyebrow, ['18px', '500', '26px']);
  assert.deepEqual(exactMetrics.headline, ['34px', '600', '42px']);
  assert.equal(exactMetrics.cardStyle.borderRadius, '24px');
  assert.equal(exactMetrics.cardStyle.paddingTop, '28px');
  assert.equal(exactMetrics.cardStyle.backgroundColor, 'rgb(252, 252, 254)');
  assert.equal((exactMetrics.cardStyle.backgroundImage.match(/radial-gradient/g) ?? []).length, 4);
  for (const fragment of ['circle', '10% 70%', '70% 65%', '92% 30%', 'rgb(220, 235, 250)', 'rgb(230, 221, 246)', 'rgb(245, 226, 239)']) {
    assert.match(exactMetrics.cardStyle.backgroundImage, new RegExp(fragment.replace(/[()]/g, '\\$&')));
  }
  const targets = await page.locator('.riff-onboarding button:visible').evaluateAll(nodes => nodes.map(node => {
    const box = node.getBoundingClientRect();
    return { label: node.getAttribute('aria-label'), width: box.width, height: box.height };
  }));
  assert.equal(targets.every(target => target.width >= 44 && target.height >= 44), true, JSON.stringify(targets));
  assert.deepEqual(networkRequests, []);

  const viewport = await page.locator('.riff-onboarding__viewport').boundingBox();
  const first = await page.locator('.riff-onboarding__slide').nth(0).boundingBox();
  const second = await page.locator('.riff-onboarding__slide').nth(1).boundingBox();
  assert.ok(viewport && first && second);
  assert.ok(second.x > first.x && second.x < viewport.x + viewport.width,
    'the next step peeks into the carousel exactly as the approved composition shows');

  assert.equal(await page.getByRole('tab').first().getAttribute('aria-selected'), 'true');
  await page.getByRole('button', { name: 'Next step' }).click();
  assert.equal(await page.getByRole('tab').nth(1).getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('.riff-onboarding__slide').nth(1).getAttribute('aria-current'), 'step');
  await page.getByRole('tab', { name: 'Show Make step' }).click();
  assert.equal(await page.getByRole('tab').last().getAttribute('aria-selected'), 'true');

  const firstTab = page.getByRole('tab').first();
  const secondTab = page.getByRole('tab').nth(1);
  const lastTab = page.getByRole('tab').last();
  await firstTab.click();
  assert.equal(await firstTab.getAttribute('aria-selected'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'riff-onboarding-dot-1');
  await page.keyboard.press('ArrowRight');
  assert.equal(await secondTab.getAttribute('aria-selected'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'riff-onboarding-dot-2',
    'ArrowRight on the tablist moves both selection and focus to the next tab');
  await page.keyboard.press('Home');
  assert.equal(await firstTab.getAttribute('aria-selected'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'riff-onboarding-dot-1');
  await page.keyboard.press('End');
  assert.equal(await lastTab.getAttribute('aria-selected'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'riff-onboarding-dot-3');
  await page.keyboard.press('ArrowRight');
  assert.equal(await lastTab.getAttribute('aria-selected'), 'true',
    'keyboard navigation stops at the last step');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'riff-onboarding-dot-3');

  await page.emulateMedia({ forcedColors: 'active' });
  const forcedColorDots = await page.locator('.riff-onboarding__dot').evaluateAll(nodes => nodes.map(node => {
    const style = getComputedStyle(node);
    const indicator = getComputedStyle(node, '::before');
    return {
      selected: node.getAttribute('aria-selected') === 'true',
      borderWidth: style.borderTopWidth,
      borderStyle: style.borderTopStyle,
      background: indicator.backgroundColor,
    };
  }));
  assert.equal(forcedColorDots.every(dot => dot.borderWidth !== '0px' && dot.borderStyle === 'solid'), true,
    JSON.stringify(forcedColorDots));
  assert.notEqual(
    forcedColorDots.find(dot => dot.selected)?.background,
    forcedColorDots.find(dot => !dot.selected)?.background,
    'forced-colors mode keeps the selected progress tab visibly distinct',
  );
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  assert.deepEqual(errors, []);
});

test('Riff onboarding keeps the approved composition usable in a 320px inline card', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffOnboarding } from './apps/panel/riff-onboarding/index.ts';
    window.view = mountRiffOnboarding(document.getElementById('root'));
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 320, height: 900 } });
  await page.setContent(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`);

  assert.equal(await page.getByRole('heading', { name: 'Unlock your viral potential.' }).isVisible(), true);
  assert.equal(await page.getByText('Start with what you have.').isVisible(), true);
  assert.equal(await page.getByRole('button', { name: 'Next step' }).isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
});

test('Riff onboarding follows dark host colors and keeps every required line readable at 320px with 200% text', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffOnboarding } from './apps/panel/riff-onboarding/index.ts';
    window.view = mountRiffOnboarding(document.getElementById('root'));
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 320, height: 1800 } });
  await page.setContent(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.style.setProperty('--color-background-primary', '#101318');
    document.documentElement.style.setProperty('--color-background-secondary', '#181d25');
    document.documentElement.style.setProperty('--color-text-primary', '#f6f7f9');
    document.documentElement.style.setProperty('--color-text-secondary', '#c1c8d2');
    document.documentElement.style.setProperty('--color-border-secondary', '#596273');
  });
  const dark = await page.locator('.riff-onboarding__card').evaluate(node => {
    const card = getComputedStyle(node);
    const heading = getComputedStyle(node.querySelector('.riff-onboarding__headline'));
    return { background: card.backgroundColor, color: heading.color };
  });
  assert.deepEqual(dark, { background: 'rgb(16, 19, 24)', color: 'rgb(246, 247, 249)' });

  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '.riff-onboarding :is(h1,h2,h3,p,strong,span,button){font-size:200%!important;line-height:1.5!important}';
    document.head.append(style);
  });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  const clipped = await page.locator('.riff-onboarding button:visible').evaluateAll(nodes => nodes.filter(node =>
    node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1,
  ).map(node => node.getAttribute('aria-label') || node.textContent?.trim()));
  assert.deepEqual(clipped, []);
  for (const step of ['Start','Find','Make']) {
    await page.getByRole('tab',{name:`Show ${step} step`}).click();
    const lost = await page.locator('.riff-onboarding__card').evaluate(card => {
      const cardRect=card.getBoundingClientRect();
      const active=card.querySelector('.riff-onboarding__slide[aria-current="step"]');
      const required=[...card.querySelectorAll('.riff-onboarding__intro h1,.riff-onboarding__intro h2,.riff-onboarding__closing strong,.riff-onboarding__closing p'),
        ...active.querySelectorAll('h3,p,.riff-onboarding__working-label,.riff-onboarding__working-copy,.riff-onboarding__chip')];
      return required.filter(node=>{
        const rect=node.getBoundingClientRect();const style=getComputedStyle(node);
        return style.visibility!=='hidden'&&(rect.left<cardRect.left-1||rect.right>cardRect.right+1||rect.top<cardRect.top-1||rect.bottom>cardRect.bottom+1);
      }).map(node=>node.textContent?.trim());
    });
    assert.deepEqual(lost,[],`${step} copy remains inside the visible welcome card`);
    assert.equal(await page.locator('.riff-onboarding__slide[aria-current="step"] .riff-onboarding__visual').evaluate(node=>node.scrollHeight<=node.clientHeight+1),true,
      `${step} informative example is not vertically clipped`);
  }
});

test('inline first-use onboarding completes only after the visible final step', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffOnboarding } from './apps/panel/riff-onboarding/index.ts';
    window.completions = 0;
    window.view = mountRiffOnboarding(document.getElementById('root'), {
      onComplete: async () => { window.completions++; return { status: 'sent', message: 'Welcome completed.' }; },
    });
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
  await page.setContent(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`);
  const next = page.getByRole('button', { name: 'Next step' });
  await next.click();
  assert.equal(await page.evaluate(() => window.completions), 0);
  await next.click();
  assert.equal(await page.evaluate(() => window.completions), 0);
  const finish = page.getByRole('button', { name: 'Finish welcome' });
  await finish.click();
  assert.equal(await page.evaluate(() => window.completions), 1);
  assert.equal(await page.getByRole('status').textContent(), 'Welcome completed.');
});
