import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'esbuild';

test('Riff Home follows the canonical shell and starts work inside the app', async (t) => {
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
    assert.equal(await page.getByRole('navigation', { name: 'Riff navigation' }).count(), 1);
    for (const name of ['Home', 'Discover', 'Studio']) {
      assert.equal(await page.getByRole('button', { name, exact: true }).count(), 1);
    }
    assert.equal(await page.getByRole('heading', { name: 'Let’s make your next video go viral.' }).count(), 1);
    assert.equal(await page.getByRole('region', { name: 'Welcome to Riff' }).count(), 0, 'welcome belongs in chat, not Home');
    const creatorInput = page.getByPlaceholder('Share a video or profile link, or tell me what you want to make…');
    assert.equal(await creatorInput.count(), 1);
    const creatorForm = page.getByRole('form', { name: 'Start with Riff' });
    for (const name of ['Upload a video', 'Find my next idea']) {
      assert.equal(await creatorForm.getByRole('button', { name }).count(), 1);
    }
    for (const name of ['Trending videos', 'Hooks', 'Product showcases', 'Calls to action']) {
      assert.equal(await page.getByRole('button', { name, exact: true }).count(), 1);
    }
    assert.equal(await page.getByText('Pick up where you left off').count(), 1);
    assert.equal(await page.getByText('Loading recent work…').count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Create a video' }).count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);

    const pendingId = await page.evaluate(() => { const job=window.fixture('queued'); window.view.showJob(job); return job.id; });
    assert.equal(await page.getByText(`Job ${pendingId}`).count(), 1);
    await page.getByRole('button', { name: `Refresh saved job ${pendingId}` }).click();
    assert.deepEqual((await page.evaluate(() => window.events.at(-1))), { kind: 'refresh-job', jobId: pendingId });
    await page.getByRole('button', { name: 'Create a video' }).click();

    await creatorInput.fill('https://vm.tiktok.com/ZN8kT9uhV/');
    await creatorInput.press('Control+Enter');
    assert.deepEqual((await page.evaluate(() => window.events.at(-1))), {
      kind: 'start', source: 'https://vm.tiktok.com/ZN8kT9uhV/',
    });
    assert.match(await page.getByRole('status').textContent(), /Analysis started/);

    await page.evaluate(() => window.view.showJob(window.fixture('video-analysis')));
    assert.equal(await page.getByRole('heading', { name: 'Unlock your video’s viral potential.' }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Create a video' }).count(), 1, 'new-video entry stays available');
    assert.equal(await page.getByPlaceholder('Share a video or profile link, or tell me what you want to make…').count(), 0);
    await page.getByRole('button', { name: 'Create a video' }).click();
    assert.equal(await page.getByPlaceholder('Share a video or profile link, or tell me what you want to make…').count(), 1);
    await page.close();
  }
});

test('Riff Home renders owned recents, menu actions, and account recovery without fictional rows', async (t) => {
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
  await page.getByRole('button', { name: 'Try again' }).click();
  assert.equal((await page.evaluate(() => window.events.at(-1))).kind, 'refresh-recents');

  await page.evaluate(() => {
    window.renderAccount(null);
    window.view.setRecents([
      {job_id:'00000000-0000-4000-8000-000000000101',title:'@alex.focus',stage:'Analysis ready',state:'succeeded',updated_at:'2026-10-11T12:00:00Z'},
      {job_id:'00000000-0000-4000-8000-000000000102',title:'FocusNest',stage:'Ideas saved',state:'succeeded',updated_at:'2026-10-11T11:00:00Z'},
    ]);
  });
  assert.equal(await page.getByRole('button', { name: /Open @alex.focus/ }).count(), 1);
  assert.equal(await page.getByText('No recent work yet.').count(), 0);
  await page.getByRole('button', { name: /Open @alex.focus/ }).click();
  assert.equal((await page.evaluate(() => window.events.at(-1))).kind, 'recent');

  await page.getByRole('button', { name: 'Open Riff menu' }).click();
  assert.equal(await page.getByRole('menu').count(), 1);
  await page.getByRole('menuitem', { name: 'How Riff works' }).click();
  assert.equal((await page.evaluate(() => window.events.at(-1))).kind, 'welcome');

  await page.evaluate(() => window.renderAccount('2026-10-11T12:00:00Z'));
  assert.match(await page.getByText(/Ready, Fictional Creator/).textContent(), /Fictional Creator/);
  await page.evaluate(() => window.renderError());
  assert.match(await page.getByRole('status').textContent(), /could not read this account/i);
  assert.equal(await page.getByPlaceholder('Share a video or profile link, or tell me what you want to make…').count(), 1);
});
