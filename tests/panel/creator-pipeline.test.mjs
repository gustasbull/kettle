import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('Riff Analysis, Discovery, and Studio render only persisted creator-job facts', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountCreatorPipeline } from './apps/panel/creator-pipeline/index.ts';
    import { pipelineFixture } from './apps/panel/creator-pipeline/fixtures.ts';
    window.actions=[]; window.fullscreen=[];
    window.boot=(scenario='scan',mode='fullscreen')=>{
      window.view?.dispose();
      window.view=mountCreatorPipeline(document.getElementById('root'),{
        displayMode:mode,
        sendPrompt:async prompt=>{window.actions.push(prompt);return {status:'sent',message:'Sent to ChatGPT.'}},
        requestFullscreen:async()=>{window.fullscreen.push(true);window.view.setDisplayMode('fullscreen');return {status:'sent',message:'Opened fullscreen.'}},
      });
      window.job=pipelineFixture(scenario); window.view.render(window.job);
    };
    window.show=scenario=>{window.job=pipelineFixture(scenario);window.view.render(window.job)};
  ` }, bundle: true, format: 'iife', platform: 'browser', write: false });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const root = page.locator('#root');

  await t.test('live and recovery states are indeterminate and never imply retry', async () => {
    await page.evaluate(() => boot('queued', 'fullscreen'));
    assert.match(await root.textContent(), /Preparing|queued|saved job/i);
    assert.equal(await root.locator('[role="progressbar"]').count(), 1);
    assert.equal(await root.locator('[role="progressbar"][aria-valuenow]').count(), 0);
    assert.equal(await root.locator('button,a').count(), 0);
    await page.evaluate(() => show('running'));
    assert.doesNotMatch(await root.locator('.riff-pipeline').textContent(), /\d+%/);
    await page.evaluate(() => show('failed'));
    assert.match(await root.textContent(), /does not retry/i);
    assert.equal(await root.getByRole('button', { name: /retry/i }).count(), 0);
    await page.evaluate(() => show('needs_reconciliation'));
    assert.match(await root.textContent(), /reconcile.*before.*retry/i);
    assert.equal(await root.getByRole('button', { name: /retry/i }).count(), 0);
  });

  await t.test('fullscreen Analysis follows the six truthful dimensions and explicit handoffs', async () => {
    await page.evaluate(() => boot('scan', 'fullscreen'));
    assert.match(await root.getByRole('heading', { level: 1 }).textContent(), /Video analysis|Creator analysis/);
    for (const name of ['Hook', 'Content', 'Style & pacing', 'Voice & language', 'Script', 'CTA']) {
      assert.equal(await root.getByRole('heading', { name, exact: true }).count(), 1, name);
    }
    assert.match(await root.textContent(), /Observed|Inferred|User-corrected/);
    assert.doesNotMatch(await root.textContent(), /Working well|Needs attention/);
    assert.match(await root.textContent(), /unique video|coverage/i);
    assert.match(await root.textContent(), /Limitations/);
    for (const label of ['Rework this video', 'Explore viral formats', 'Create a video']) {
      assert.equal(await root.getByRole('button', { name: label }).count(), 1);
    }
    await root.getByRole('button', { name: 'Explore viral formats' }).click();
    assert.match((await page.evaluate(() => window.actions.at(-1))), /DNA version 1|creator job/i);
  });

  await t.test('inline Analysis stays compact with two actions and no duplicate attribution', async () => {
    await page.evaluate(() => boot('scan', 'inline'));
    assert.equal(await root.locator('svg[aria-label="Riff"]').count(), 0);
    assert.equal(await root.locator('button').count(), 2);
    assert.equal(await root.getByRole('button', { name: 'Open analysis' }).count(), 1);
    assert.equal(await root.getByRole('button', { name: 'Explore viral formats' }).count(), 1);
    assert.equal(await root.getByRole('heading', { name: 'Voice & language' }).count(), 0);
    await root.getByRole('button', { name: 'Open analysis' }).click();
    assert.equal(await page.evaluate(() => window.fullscreen.length), 1);
    assert.equal(await root.getByRole('heading', { name: 'Voice & language' }).count(), 1);
  });

  await t.test('fullscreen Discovery is a bounded real-count keyboard carousel', async () => {
    await page.evaluate(() => boot('three-ideas', 'fullscreen'));
    assert.equal(await root.getByRole('heading', { name: 'Find your next breakout idea.' }).count(), 1);
    assert.match(await root.textContent(), /3 ideas/);
    assert.equal(await root.locator('[data-library]').count(), 4);
    assert.match(await root.locator('[data-library="hooks"]').textContent(), /ChatGPT/);
    assert.doesNotMatch(await root.textContent(), /7 ideas|lift|likes/i);
    const region = root.locator('[data-discovery-carousel]');
    assert.match(await region.textContent(), /Fictional desk idea 1/);
    await region.focus(); await page.keyboard.press('ArrowRight');
    assert.match(await region.textContent(), /Fictional desk idea 2/);
    await root.getByRole('button', { name: 'Next idea' }).click();
    assert.match(await region.textContent(), /Fictional desk idea 3/);
    assert.match(await region.textContent(), /ViewsUnknown/);
    await root.getByRole('button', { name: 'Make it mine' }).click();
    assert.match((await page.evaluate(() => window.actions.at(-1))), /batch 00000000-0000-4000-8000-000000000600.*idea 00000000-0000-4000-8000-000000000702/i);
    await page.evaluate(() => show('empty'));
    assert.match(await root.textContent(), /No evidence-backed ideas/);
  });

  await t.test('inline Discovery is a summary and opens fullscreen without nested navigation', async () => {
    await page.evaluate(() => boot('ideas', 'inline'));
    assert.match(await root.textContent(), /1 idea/);
    assert.equal(await root.getByRole('button', { name: 'Open discovery' }).count(), 1);
    assert.equal(await root.locator('[role="tablist"],[data-discovery-carousel]').count(), 0);
    assert.ok(await root.locator('button').count() <= 2);
  });

  await t.test('fullscreen Studio maps actual variants into component tabs and honest state handoffs', async () => {
    await page.evaluate(() => boot('scripts', 'fullscreen'));
    assert.equal(await root.getByRole('heading', { name: 'Your script, ready to film.' }).count(), 1);
    assert.equal(await root.getByRole('tab').count(), 4);
    for (const tab of ['Full video', 'Hook', 'Main content', 'CTA']) assert.equal(await root.getByRole('tab', { name: tab }).count(), 1);
    assert.equal(await root.locator('[data-variant]').count(), 2);
    assert.match(await root.textContent(), /Reference-led|Creator Fit/);
    assert.match(await root.textContent(), /Caption.*not available|publishing fields.*not part/i);
    await root.getByRole('tab', { name: 'Hook' }).click();
    assert.match(await root.locator('[role="tabpanel"]:not([hidden])').textContent(), /One small change for this desk|Wide shot/);
    await root.getByRole('tab', { name: 'Main content' }).click();
    assert.match(await root.locator('[role="tabpanel"]:not([hidden])').textContent(), /Shots|B-roll|On-screen text|Showcase timing|Pacing/);
    await root.getByRole('tab', { name: 'CTA' }).click();
    assert.match(await root.locator('[role="tabpanel"]:not([hidden])').textContent(), /What would you change/);
    await root.getByRole('button', { name: 'Save for later' }).click();
    assert.match((await page.evaluate(() => window.actions.at(-1))), /save.*ChatGPT.*not.*saved/i);
    await root.getByRole('button', { name: 'I filmed it' }).click();
    assert.match((await page.evaluate(() => window.actions.at(-1))), /filmed.*ChatGPT.*not.*persisted/i);
  });

  await t.test('inline scripts remain one-action summaries; hostile text stays inert and layouts do not overflow', async () => {
    await page.evaluate(() => boot('three-variants', 'inline'));
    assert.match(await root.textContent(), /Your script, ready to film/);
    assert.equal(await root.getByRole('button', { name: 'Open Studio' }).count(), 1);
    assert.equal(await root.getByRole('tab').count(), 0);
    await page.evaluate(() => boot('hostile', 'fullscreen'));
    assert.match(await root.textContent(), /<img src=x onerror=alert\(1\)>/);
    assert.equal(await root.locator('img,iframe,script').count(), 0);
    for (const width of [320, 375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    }
  });

  await t.test('same-job selection/focus persists, a different job resets it, and disposal is final', async () => {
    await page.setViewportSize({ width: 900, height: 900 });
    await page.evaluate(() => boot('three-ideas', 'fullscreen'));
    await root.getByRole('button', { name: 'Next idea' }).click();
    await root.getByRole('button', { name: 'Make it mine' }).focus();
    const result = await page.evaluate(() => {
      window.job.revision += 1; window.view.render(window.job);
      const preserved = document.body.textContent.includes('Fictional desk idea 2') && document.activeElement.textContent === 'Make it mine';
      const other = structuredClone(window.job); other.id = '00000000-0000-4000-8000-000000000999'; window.view.render(other);
      const reset = document.body.textContent.includes('Fictional desk idea 1');
      window.view.dispose(); window.view.dispose(); window.view.render(other);
      return { preserved, reset, empty: document.getElementById('root').childElementCount === 0 };
    });
    assert.deepEqual(result, { preserved: true, reset: true, empty: true });
  });

  assert.deepEqual(errors, []);
});
