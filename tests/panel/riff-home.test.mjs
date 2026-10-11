import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'esbuild';

test('Riff Home keeps creator input available and uses honest ChatGPT handoffs', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffHome } from './apps/panel/riff-home/index.ts';
    window.prompts=[];
    window.view=mountRiffHome(document.getElementById('root'), async prompt => {
      window.prompts.push(prompt); return {status:'sent',message:'Sent to ChatGPT.'};
    });
    window.view.render({status:'ready',account:{id:'00000000-0000-4000-8000-000000000001',name:'Fictional Creator'}});
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  for (const viewport of [{ width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    const page = await browser.newPage({ viewport });
    await page.setContent(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`);
    assert.equal(await page.getByRole('heading', { name: /Let.s make your next video go viral/ }).count(), 1);
    const creatorInput = page.getByPlaceholder('Share a video or profile link, or tell me what you want to make…');
    assert.equal(await creatorInput.count(), 1);
    const creatorForm = page.getByRole('form', { name: 'Start with Riff' });
    assert.equal(await creatorForm.getByRole('button', { name: 'Upload a video' }).count(), 1);
    assert.equal(await creatorForm.getByRole('button', { name: 'Find my next idea' }).count(), 1);
    for (const name of ['Trending videos', 'Hooks', 'Product showcases', 'Calls to action']) {
      assert.equal(await creatorForm.getByRole('button', { name, exact: true }).count(), 1);
    }
    assert.equal(await page.getByText('Pick up where you left off').count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Create a video' }).count(), 1);
    assert.equal(await page.locator('input[type="file"]').count(), 0);
    assert.equal(await page.locator('[data-library]').count(), 4);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    await creatorInput.fill('<img src=x onerror=alert(1)> https://tiktok.com/@creator/video/1');
    await creatorInput.press('Control+Enter');
    assert.equal((await page.evaluate(() => window.prompts))[0], 'Use Riff to help me make my next video from this input:\n\n<img src=x onerror=alert(1)> https://tiktok.com/@creator/video/1');
    assert.equal(await page.locator('img[src="x"]').count(), 0);
    await creatorForm.getByRole('button', { name: 'Upload a video' }).click();
    assert.match((await page.evaluate(() => window.prompts)).at(-1), /attach.*video.*ChatGPT/i);
    await page.close();
  }
});

test('Riff Home distinguishes first run, returning accounts, and unavailable onboarding state', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffHome, riffHomeStructuredOutput } from './apps/panel/riff-home/index.ts';
    window.welcomeCalls=0;
    window.view=mountRiffHome(document.getElementById('root'), async () => ({status:'sent',message:'Sent.'}), async () => {
      window.welcomeCalls++; return {status:'sent',message:'Welcome opened.'};
    });
    window.renderAccount=(marker,include=true)=>window.view.render(riffHomeStructuredOutput({ok:true,data:{account:{
      id:'00000000-0000-4000-8000-000000000001',display_name:'Fictional Creator',
      ...(include?{onboarding_seen_at:marker}:{})
    }}}));
    window.renderError=()=>window.view.render(riffHomeStructuredOutput({ok:false,error:{code:'UNAVAILABLE'}}));
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await page.setContent(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`);
  const creatorInput = page.getByPlaceholder('Share a video or profile link, or tell me what you want to make…');

  await page.evaluate(() => window.renderAccount(null));
  assert.equal(await page.getByRole('region', { name: 'Welcome to Riff' }).count(), 1);
  assert.equal(await creatorInput.count(), 1);
  await page.getByRole('button', { name: 'Show welcome' }).click();
  assert.equal(await page.evaluate(() => window.welcomeCalls), 1);

  await page.evaluate(() => window.renderAccount('2026-10-11T12:00:00Z'));
  assert.equal(await page.getByRole('region', { name: 'Welcome to Riff' }).count(), 0);
  assert.equal(await creatorInput.count(), 1);

  await page.evaluate(() => window.renderAccount(undefined, false));
  assert.equal(await page.getByRole('region', { name: 'Welcome to Riff' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Show welcome' }).count(), 1);
  assert.equal(await creatorInput.count(), 1);

  await page.evaluate(() => window.renderError());
  assert.equal(await page.getByRole('button', { name: 'Show welcome' }).count(), 1);
  assert.equal(await creatorInput.count(), 1);
});
