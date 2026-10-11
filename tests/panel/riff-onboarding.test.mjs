import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'esbuild';

test('Riff onboarding renders the exact three-step keyboard carousel without host chrome', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffOnboarding } from './apps/panel/riff-onboarding/index.ts';
    window.view = mountRiffOnboarding(document.getElementById('root'));
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 320, height: 600 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`);

  assert.equal(await page.getByRole('heading', { name: 'Welcome to Riff' }).count(), 1);
  assert.equal(await page.getByRole('tab').count(), 3);
  assert.equal(await page.locator('[role="tabpanel"]').count(), 3);
  assert.equal(await page.getByText('Unlock your viral potential.').count(), 1);
  assert.equal(await page.getByText('Start with what you have.').count(), 1);
  assert.equal(await page.getByText('Find your breakout idea.').count(), 1);
  assert.equal(await page.getByText('Make it yours.').count(), 1);
  assert.equal(await page.locator('svg[aria-label="Riff"]').count(), 0, 'inline cards rely on host attribution');
  assert.equal(await page.locator('textarea,input[type="text"],form').count(), 0, 'onboarding does not duplicate the composer');

  await page.getByRole('tab').first().focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('tab').nth(1).getAttribute('aria-selected'), 'true');
  await page.keyboard.press('End');
  assert.equal(await page.getByRole('tab').last().getAttribute('aria-selected'), 'true');
  assert.match(await page.locator('[role="tabpanel"]:not([hidden])').innerText(), /Make it yours/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  assert.deepEqual(errors, []);
});
