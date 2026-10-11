import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'esbuild';

test('Riff Home reproduces the Paper Home surface without app-owned chrome', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffHome } from './apps/panel/riff-home/index.ts';
    import { pipelineFixture } from './apps/panel/creator-pipeline/fixtures.ts';
    window.events=[];
    window.view=mountRiffHome(document.getElementById('root'), {
      start: async source=>{ window.events.push({kind:'start',source}); return {status:'sent',message:'Analysis started.'}; },
      send: async prompt=>{ window.events.push({kind:'message',prompt}); return {status:'sent',message:'Sent to ChatGPT.'}; },
      upload: async()=>{ window.events.push({kind:'upload'}); return {status:'sent',message:'Video selected.'}; },
      showWelcome: async()=>{ window.events.push({kind:'welcome'}); return {status:'sent',message:'Welcome requested in chat.'}; },
      openRecent: async jobId=>{ window.events.push({kind:'recent',jobId}); return {status:'sent',message:'Opening saved work.'}; },
      refreshJob: async job=>{ window.events.push({kind:'refresh-job',jobId:job.id}); return {status:'sent',message:'Saved job refreshed.'}; },
      startRecommendations: async ({job,dna})=>{ window.events.push({kind:'recommendations',jobId:job.id,dnaId:dna.dna_id}); return {status:'sent',message:'Discovery started.'}; },
      makeMine: async ({job,batch,idea})=>{ window.events.push({kind:'make-mine',jobId:job.id,batchId:batch.id,ideaId:idea.id}); return {status:'sent',message:'Continue in ChatGPT.'}; },
    });
    window.view.render({status:'ready',account:{id:'00000000-0000-4000-8000-000000000001',name:'Fictional Creator',onboarding_seen_at:null}});
    window.fixture=scenario=>pipelineFixture(scenario);
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());

  for (const viewport of [{ width: 320, height: 700 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    const page = await browser.newPage({ viewport });
    await page.setContent(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`);
    assert.equal(await page.getByRole('navigation', { name: 'Riff navigation' }).count(), 0,
      'Paper marks the panel chrome as ChatGPT-owned, so the app must not duplicate it');
    assert.equal(await page.getByRole('button', { name: 'Create a video' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Open Riff menu' }).count(), 0);
    assert.equal(await page.getByRole('heading', { name: 'Let’s make your next video go viral.' }).count(), 1);
    assert.equal(await page.getByRole('region', { name: 'Welcome to Riff' }).count(), 0, 'welcome belongs in chat, not Home');
    const creatorInput = page.getByPlaceholder('Share a video or profile link, or tell me what you want to make…');
    assert.equal(await creatorInput.count(), 1);
    const creatorForm = page.getByRole('form', { name: 'Start with Riff' });
    for (const name of ['Upload a video', 'Find my next idea']) {
      assert.equal(await creatorForm.getByRole('button', { name }).count(), 1);
    }
    const paperIcons = new Map([
      ['Trending videos', 'm3 17 6-6 4 3 8-10'],
      ['Hooks', 'm13 2-9 12h7l-1 8 10-12h-7l1-8Z'],
      ['Product showcases', 'M8 7V5a4 4 0 0 1 8 0v2'],
      ['Calls to action', 'm5 3 14 9-7 1-3 7-4-17Z'],
    ]);
    for (const [name, path] of paperIcons) {
      const chip = page.getByRole('button', { name, exact: true });
      assert.equal(await chip.count(), 1);
      assert.equal(await chip.locator('svg').count(), 1, `${name} uses the Paper SVG icon`);
      assert.equal(await chip.locator(`path[d="${path}"]`).count(), 1);
    }
    assert.equal(await creatorForm.getByRole('button', { name: 'Upload a video' }).locator('svg').count(), 1,
      'Paper upload icon is visible');
    assert.equal(await page.getByRole('button', { name: 'View recent work' }).locator('svg').count(), 1,
      'Paper recent-work arrow is visible');
    const messageCount = await page.evaluate(() => window.events.filter(event => event.kind === 'message').length);
    const trending = page.getByRole('button', { name: 'Trending videos', exact: true });
    await trending.click();
    assert.equal(await trending.getAttribute('aria-pressed'), 'true');
    assert.match(await page.getByRole('status').textContent(), /add a public TikTok profile or video link/i);
    const hooks = page.getByRole('button', { name: 'Hooks', exact: true });
    await hooks.click();
    assert.equal(await trending.getAttribute('aria-pressed'), 'false');
    assert.equal(await hooks.getAttribute('aria-pressed'), 'true');
    assert.match(await page.getByRole('status').textContent(), /hook analysis.*link/i);
    assert.equal(await page.evaluate(() => window.events.filter(event => event.kind === 'message').length), messageCount,
      'library navigation stays inside Riff instead of starting a slow model turn');
    assert.equal(await page.getByText('Pick up where you left off').count(), 1);
    assert.equal(await page.getByText('Loading recent work…').count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);

    if (viewport.width === 1440) {
      assert.equal(await page.locator('.riff-home__hero-mark').evaluate(node => getComputedStyle(node).width), '104px');
      assert.equal(await page.getByRole('heading', { name: 'Let’s make your next video go viral.' }).evaluate(node => getComputedStyle(node).fontSize), '40px');
      assert.equal(await page.locator('.riff-home__composer').evaluate(node => getComputedStyle(node).width), '760px');
    }

    await page.evaluate(() => window.view.showJob(window.fixture('queued')));
    assert.equal(await page.getByText(/^Job [0-9a-f-]{36}$/).count(), 0, 'Paper has no app-owned job chrome');
    assert.equal(await page.getByRole('button', { name: /Refresh saved job/ }).count(), 0);
    await page.evaluate(() => window.view.showHome());

    await creatorInput.fill('https://vm.tiktok.com/ZN8kT9uhV/');
    await creatorInput.press('Control+Enter');
    assert.deepEqual((await page.evaluate(() => window.events.at(-1))), {
      kind: 'start', source: 'https://vm.tiktok.com/ZN8kT9uhV/',
    });
    assert.match(await page.getByRole('status').textContent(), /Analysis started/);
    assert.equal(await creatorInput.inputValue(), 'https://vm.tiktok.com/ZN8kT9uhV/',
      'the typed source remains until a saved job is visibly mounted');

    await page.evaluate(() => window.view.showJob(window.fixture('video-analysis')));
    assert.equal(await page.getByRole('heading', { name: 'Unlock your video’s viral potential.' }).count(), 1);
    assert.equal(await page.getByPlaceholder('Share a video or profile link, or tell me what you want to make…').count(), 0);
    await page.evaluate(() => window.view.showHome());
    assert.equal(await page.getByPlaceholder('Share a video or profile link, or tell me what you want to make…').count(), 1);
    assert.equal(await page.getByPlaceholder('Share a video or profile link, or tell me what you want to make…').inputValue(), '',
      'mounting the saved job clears the completed source intent');
    await page.close();
  }
});

test('Riff Home renders Paper-shaped owned recents and account recovery without fictional rows', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffHome, riffHomeStructuredOutput } from './apps/panel/riff-home/index.ts';
    window.events=[];
    window.view=mountRiffHome(document.getElementById('root'), {
      start:async()=>({status:'sent',message:'Started.'}),
      send:async prompt=>{window.events.push({kind:'message',prompt});return {status:'sent',message:'Sent.'}},
      showWelcome:async()=>{window.events.push({kind:'welcome'});return {status:'sent',message:'Requested in chat.'}},
      openRecent:async jobId=>{window.events.push({kind:'recent',jobId});return {status:'sent',message:'Opened.'}},
      refreshRecents:async()=>{window.events.push({kind:'refresh-recents'});return {status:'sent',message:'Recent work refreshed.'}},
    });
    window.renderAccount=(marker,include=true)=>window.view.render(riffHomeStructuredOutput({ok:true,data:{account:{
      id:'00000000-0000-4000-8000-000000000001',display_name:'Fictional Creator',
      ...(include?{onboarding_seen_at:marker}:{})
    }}}));
    window.renderError=()=>window.view.render(riffHomeStructuredOutput({ok:false,error:{code:'UNAVAILABLE'}}));
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1000, height: 812 } });
  await page.setContent(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`);

  assert.equal(await page.getByText('Loading recent work…').count(), 1);
  await page.evaluate(() => window.view.setRecentsState({status:'error',message:'Recent work is temporarily unavailable.'}));
  assert.equal(await page.getByText('Recent work is temporarily unavailable.').count(), 1);
  await page.getByRole('button', { name: 'View recent work' }).click();
  assert.equal((await page.evaluate(() => window.events.at(-1))).kind, 'refresh-recents');

  await page.evaluate(() => {
    window.renderAccount(null);
    window.view.setRecents([
      {job_id:'00000000-0000-4000-8000-000000000101',title:'@alex.focus',stage:'Analysis ready',state:'succeeded',updated_at:'2026-10-11T12:00:00Z',platform:'tiktok',handle:'alex.focus'},
      {job_id:'00000000-0000-4000-8000-000000000102',title:'FocusNest',stage:'Ideas saved',state:'succeeded',updated_at:'2026-10-11T11:00:00Z',platform:'tiktok',handle:'focusnest'},
    ]);
  });
  assert.equal(await page.getByRole('button', { name: /Open @alex.focus/ }).count(), 1);
  assert.equal(await page.getByText('No recent work yet.').count(), 0);
  await page.getByRole('button', { name: /Open @alex.focus/ }).click();
  assert.equal((await page.evaluate(() => window.events.at(-1))).kind, 'recent');

  assert.equal(await page.getByRole('button', { name: 'Open Riff menu' }).count(), 0);
  assert.equal(await page.getByRole('menu').count(), 0);

  await page.evaluate(() => window.renderAccount('2026-10-11T12:00:00Z'));
  assert.equal(await page.locator('.riff-home__account').textContent(), 'Ready, Fictional Creator');
  await page.evaluate(() => window.renderError());
  assert.match(await page.getByRole('status').textContent(), /could not read this account/i);
  assert.equal(await page.getByPlaceholder('Share a video or profile link, or tell me what you want to make…').count(), 1);
});
