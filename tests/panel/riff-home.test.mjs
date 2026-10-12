import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'esbuild';

test('Riff Home reproduces the Paper Home surface with only the CURRENT breadcrumb chrome', async (t) => {
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
      proposeCatalogReference: async proposal=>{ window.events.push({kind:'catalog-proposal',proposal}); return {status:'sent',message:'Proposal sent.'}; },
      onDiscoveryOpen: ()=>{ window.events.push({kind:'catalog-open'}); },
    });
    window.view.render({status:'ready',account:{id:'00000000-0000-4000-8000-000000000001',name:'Fictional Creator',onboarding_seen_at:'2026-10-11T12:00:00Z'}});
    window.fixture=scenario=>pipelineFixture(scenario);
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());

  for (const viewport of [{ width: 320, height: 700 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    const page = await browser.newPage({ viewport });
    await page.setContent(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`);
    assert.equal(await page.getByRole('button', { name: 'Open Riff menu' }).count(), 1,
      'the panel owns only its reusable Riff drawer trigger, not ChatGPT chrome');
    await page.getByRole('button', { name: 'Open Riff menu' }).click();
    assert.equal(await page.getByRole('navigation', { name: 'Riff navigation' }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Create a video' }).count(), 1);
    await page.keyboard.press('Escape');
    assert.match(await page.locator('.riff-home__chrome').textContent(),/Riff\s*\/\s*Home/);
    const brandGeometry = await page.locator('.riff-home__brand').evaluate(node => ({
      height: node.getBoundingClientRect().height,
      textHeight: node.querySelector('span').getBoundingClientRect().height,
      logoWidth: node.querySelector('svg').getBoundingClientRect().width,
    }));
    assert.ok(brandGeometry.height <= 24, `Home breadcrumb brand wrapped to ${brandGeometry.height}px`);
    assert.ok(brandGeometry.textHeight <= 20, `Home breadcrumb text wrapped to ${brandGeometry.textHeight}px`);
    assert.equal(Math.round(brandGeometry.logoWidth), 22);
    assert.equal(await page.locator('.riff-home').evaluate(node=>getComputedStyle(node).padding),'12px');
    assert.match(await page.locator('.riff-home').evaluate(node=>getComputedStyle(node).backgroundImage),/radial-gradient/);
    assert.equal(await page.locator('.riff-home__composer').evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(240, 246, 250)');
    assert.equal(await page.locator('.riff-home__submit').evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(113, 56, 212)');
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
    const actionCount = await page.evaluate(() => window.events.filter(event => event.kind !== 'catalog-open').length);
    const trending = page.getByRole('button', { name: 'Trending videos', exact: true });
    await trending.click();
    assert.equal(await page.locator('button[data-library="videos"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByRole('heading', { name: 'Find your next breakout idea.' }).count(), 1);
    assert.equal(await page.evaluate(() => window.events.filter(event => event.kind === 'catalog-open').length), 1,
      'the Videos shortcut may read the one cached catalog page');
    await page.evaluate(() => window.view.showHome());
    const hooks = page.getByRole('button', { name: 'Hooks', exact: true });
    await hooks.click();
    assert.equal(await page.locator('button[data-library="videos"]').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('button[data-library="hooks"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByRole('heading', { name: 'Stop the scroll.' }).count(), 1);
    assert.equal(await page.locator('[data-idea-card], [data-catalog-card]').count(), 0);
    assert.equal(await page.evaluate(() => window.events.filter(event => event.kind === 'catalog-open').length), 2,
      'the supported Hooks shortcut requests the same bounded saved-reference page without starting provider work');
    assert.equal(await page.evaluate(() => window.events.filter(event => event.kind !== 'catalog-open').length), actionCount,
      'shortcut navigation stays inside Riff instead of starting a tool or model turn');
    await page.evaluate(() => window.view.showHome());
    assert.equal(await page.getByText('Pick up where you left off').count(), 1);
    assert.equal(await page.getByText('Loading recent work…').count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);

    if (viewport.width === 1440) {
      assert.equal(await page.locator('.riff-home__hero-mark').evaluate(node => getComputedStyle(node).width), '104px');
      assert.equal(await page.getByRole('heading', { name: 'Let’s make your next video go viral.' }).evaluate(node => getComputedStyle(node).fontSize), '40px');
      assert.equal(await page.locator('.riff-home__composer').evaluate(node => getComputedStyle(node).width), '760px');
      await page.evaluate(()=>{
        window.studioJob=window.fixture('scripts');window.view.showJob(window.studioJob);
        window.homeRefreshCard={id:'00000000-0000-4000-8000-000000000966',platform:'tiktok',native_id:'9000000000000000966',
          canonical_url:'https://www.tiktok.com/@fictional_catalog/video/9000000000000000966',caption:'Home boundary reference',thumbnail_url:null,
          published_at:null,duration_seconds:null,metrics:{views:0,likes:null,comments:null,shares:null,saves:null},
          retrieved_at:'2026-10-11T12:00:00Z',source_observed_at:null,observed_at:'2026-10-11T12:00:00Z',origin:'fixture',role:'discovered_reference',
          permission_basis:'Authored Home boundary fixture.',limitations:[]};
      });
      await page.getByRole('tab',{name:'Hook',exact:true}).click();await page.getByRole('button',{name:'Explore hooks'}).click();
      await page.evaluate(()=>window.view.setCatalogState({status:'ready',page:{cards:[window.homeRefreshCard],next_cursor:null,coverage:'Saved only.',freshness:'As observed.'}}));
      await page.evaluate(()=>{window.view.showHome();window.view.showJob(window.studioJob);});
      assert.equal(await page.getByRole('tab',{name:'Hook',exact:true}).count(),1,'Home navigation clears the prior Studio catalog screen');
      await page.evaluate(()=>window.view.showCatalog('hooks'));
      await page.evaluate(()=>window.view.setCatalogState({status:'ready',page:{cards:[window.homeRefreshCard],next_cursor:null,coverage:'Saved only.',freshness:'As observed.'}}));
      await page.getByRole('button',{name:'Use this hook'}).click();
      assert.equal((await page.evaluate(()=>window.events.filter(event=>event.kind==='catalog-proposal').at(-1).proposal)).studioExplore,undefined,
        'reopening the same job/catalog after Home cannot restore stale Studio context');
      await page.evaluate(()=>window.view.showHome());
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
    assert.equal(await page.getByPlaceholder('Share a video or profile link, or tell me what you want to make…').count(), 1);
    assert.equal(await page.getByPlaceholder('Share a video or profile link, or tell me what you want to make…').isVisible(), false);
    assert.equal(await page.locator('.riff-pipeline').getAttribute('data-embedded'),'true');
    assert.equal(await page.locator('.riff-pipeline').evaluate(node=>getComputedStyle(node).padding),'0px');
    await page.evaluate(() => {
      document.querySelector('#riff-home-input').value='https://vm.tiktok.com/edited-draft/';
      window.view.acknowledgeStart('https://vm.tiktok.com/ZN8kT9uhV/');
    });
    await page.evaluate(() => window.view.showHome());
    assert.equal(await page.getByPlaceholder('Share a video or profile link, or tell me what you want to make…').count(), 1);
    assert.equal(await page.getByPlaceholder('Share a video or profile link, or tell me what you want to make…').inputValue(), 'https://vm.tiktok.com/edited-draft/',
      'a late acknowledgement cannot erase a newer exact draft');
    await creatorInput.fill('https://vm.tiktok.com/ZN8kT9uhV/');
    await page.evaluate(() => { window.view.showJob(window.fixture('video-analysis'));window.view.acknowledgeStart('https://vm.tiktok.com/ZN8kT9uhV/');window.view.showHome(); });
    assert.equal(await creatorInput.inputValue(),'', 'only the exact acknowledged source is cleared');
    await page.close();
  }
});

test('embedded Open vault returns to Home and focuses the matching visible saved work',async t=>{
  const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:`
    import { mountRiffHome } from './apps/panel/riff-home/index.ts';
    import { pipelineFixture } from './apps/panel/creator-pipeline/fixtures.ts';
    window.job=pipelineFixture('scripts');
    window.variant=window.job.result.scripts.variants[1];
    window.view=mountRiffHome(document.getElementById('root'),{
      start:async()=>({status:'sent',message:'Started.'}),send:async()=>({status:'sent',message:'Sent.'}),
      setVariantState:async({job,variant,state})=>{
        const previous=job.work_states.find(item=>item.variant_id.toLowerCase()===variant.id.toLowerCase());
        const workState={job_id:job.id.toLowerCase(),variant_id:variant.id.toLowerCase(),state,version:(previous?.version??0)+1,updated_at:'2026-10-11T12:00:00Z'};
        window.job={...job,work_states:[...job.work_states.filter(item=>item.variant_id.toLowerCase()!==variant.id.toLowerCase()),workState]};
        window.view.setRecents([{job_id:job.id,title:'Saved Studio',stage:state==='saved'?'Ideas saved':'Continue script',state:'succeeded',
          updated_at:workState.updated_at,platform:'tiktok',handle:'fixture',variant_id:workState.variant_id,work_state:workState}]);
        return {status:'confirmed',message:state==='saved'?'Saved for later.':'Save undone.',workState,job:window.job};
      },
    });
    window.view.render({status:'ready',account:{id:'00000000-0000-4000-8000-000000000001',name:'Fixture',onboarding_seen_at:'2026-10-11T00:00:00Z'}});
    window.view.setRecents([{job_id:window.job.id,title:'Saved Studio',stage:'Continue script',state:'succeeded',updated_at:window.job.updated_at,
      platform:'tiktok',handle:'fixture',variant_id:window.variant.id,work_state:null}]);
    window.view.showJob(window.job,{variantId:window.variant.id});
  `},bundle:true,platform:'browser',format:'iife',write:false});
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1200,height:850}});
  await page.setContent(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`);
  await page.getByRole('button',{name:'Save for later'}).click();
  await page.getByRole('button',{name:'Open vault'}).click();
  assert.equal(await page.getByRole('heading',{name:'Let’s make your next video go viral.'}).count(),1);
  assert.match(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')??''),/Open Saved Studio — Ideas saved/);
  assert.match(await page.locator('.riff-home__status').textContent(),/My videos.*opened.*saved script/i);
});

test('Riff Home drawer recents clear Studio discovery context for current and different jobs', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffHome } from './apps/panel/riff-home/index.ts';
    import { pipelineFixture } from './apps/panel/creator-pipeline/fixtures.ts';
    window.events=[];
    window.currentJob=pipelineFixture('scripts');
    window.currentJob.id='00000000-0000-4000-8000-000000000975';
    window.differentJob=structuredClone(window.currentJob);
    window.differentJob.id='00000000-0000-4000-8000-000000000976';
    window.differentJob.project_id='00000000-0000-4000-8000-000000000977';
    window.jobs=new Map([[window.currentJob.id,window.currentJob],[window.differentJob.id,window.differentJob]]);
    window.view=mountRiffHome(document.getElementById('root'), {
      start:async()=>({status:'sent',message:'Started.'}),
      send:async()=>({status:'sent',message:'Sent.'}),
      openRecent:async jobId=>{window.events.push({kind:'recent',jobId});window.view.showJob(window.jobs.get(jobId));return {status:'sent',message:'Opened.'}},
      proposeCatalogReference:async proposal=>{window.events.push({kind:'catalog-proposal',proposal});return {status:'sent',message:'Proposed.'}},
    });
    window.view.render({status:'ready',account:{id:'00000000-0000-4000-8000-000000000001',name:'Fictional Creator',onboarding_seen_at:'2026-10-11T12:00:00Z'}});
    window.view.setRecents([
      {job_id:window.currentJob.id,title:'Current Studio',stage:'Script ready',state:'succeeded',updated_at:'2026-10-11T12:00:00Z'},
      {job_id:window.differentJob.id,title:'Different Studio',stage:'Script ready',state:'succeeded',updated_at:'2026-10-11T11:00:00Z'},
    ]);
    window.reference={id:'00000000-0000-4000-8000-000000000978',platform:'tiktok',native_id:'9000000000000000978',
      canonical_url:'https://www.tiktok.com/@fictional_catalog/video/9000000000000000978',caption:'Recent navigation reference',thumbnail_url:null,
      published_at:null,duration_seconds:null,metrics:{views:0,likes:null,comments:null,shares:null,saves:null},
      retrieved_at:'2026-10-11T12:00:00Z',source_observed_at:null,observed_at:'2026-10-11T12:00:00Z',origin:'fixture',role:'discovered_reference',
      permission_basis:'Authored recent navigation fixture.',limitations:[]};
    window.readyCatalog=()=>window.view.setCatalogState({status:'ready',page:{cards:[window.reference],next_cursor:null,coverage:'Saved only.',freshness:'As observed.'}});
    window.view.showJob(window.currentJob);window.readyCatalog();
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
  await page.setContent(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`);

  const enterHookCatalog = async () => {
    await page.getByRole('tab',{name:'Hook',exact:true}).click();
    await page.getByRole('button',{name:'Explore hooks'}).click();
    await page.evaluate(()=>window.readyCatalog());
  };
  const openDrawerRecent = async (name) => {
    await page.getByRole('button',{name:'Open Riff menu'}).click();
    await page.getByRole('dialog',{name:'Riff menu'}).getByRole('button',{name}).click();
  };

  await enterHookCatalog();
  await openDrawerRecent(/Open Current Studio/);
  assert.equal(await page.getByRole('tab',{name:'Hook',exact:true}).count(),1,
    'selecting the current Studio job is navigation and must not restore its old catalog');
  assert.equal(await page.getByRole('heading',{name:'Stop the scroll.'}).count(),0);
  await page.evaluate(()=>{window.view.showCatalog('hooks');window.readyCatalog();});
  await page.getByRole('button',{name:'Use this hook'}).click();
  assert.equal((await page.evaluate(()=>window.events.filter(event=>event.kind==='catalog-proposal').at(-1).proposal)).studioExplore,undefined,
    'a catalog opened after current-job Recent navigation has no stale Studio intent');

  await page.evaluate(()=>window.view.showJob(window.currentJob));
  await enterHookCatalog();
  await openDrawerRecent(/Open Different Studio/);
  assert.equal(await page.getByRole('tab',{name:'Hook',exact:true}).count(),1,
    'different-job Recent navigation also returns to the selected Studio job');
  assert.equal(await page.getByRole('heading',{name:'Stop the scroll.'}).count(),0);
  assert.deepEqual(await page.evaluate(()=>window.events.filter(event=>event.kind==='recent').map(event=>event.jobId)),
    ['00000000-0000-4000-8000-000000000975','00000000-0000-4000-8000-000000000976']);
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
      state:'active',preferred_language:'en',created_at:'2026-01-01T00:00:00Z',
      ...(include?{onboarding_seen_at:marker}:{})
    },entitlements:{status:'not_configured'},usage:{status:'not_configured',reset_at:null}}}));
    window.renderError=()=>window.view.render(riffHomeStructuredOutput({ok:false,error:{code:'UNAVAILABLE'}}));
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1000, height: 812 } });
  page.setDefaultTimeout(4_000);
  await page.setContent(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`);

  assert.equal(await page.getByText('Loading recent work…').count(), 1);
  assert.equal(await page.getByRole('button', { name: 'View recent work' }).isHidden(), true,
    'Home controls stay private until the account result is validated');
  await page.evaluate(() => window.renderAccount('2026-10-11T12:00:00Z'));
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
  assert.equal(await page.getByRole('button', { name: /Open @alex.focus/ }).count(), 0,
    'an explicit null marker hides private recents until the separate welcome is complete');
  assert.equal(await page.getByRole('region', { name: 'Welcome to Riff' }).count(), 0,
    'the welcome belongs in the originating ChatGPT conversation, never inside Home');
  assert.equal(await page.getByPlaceholder('Share a video or profile link, or tell me what you want to make…').isVisible(), true);

  await page.evaluate(() => window.renderError());
  assert.equal(await page.getByRole('button', { name: /Open @alex.focus/ }).count(), 1,
    'an unreadable marker fails open to normal Home rather than leaving recents blocked');
  await page.getByRole('button',{name:'Show welcome guide'}).click();
  assert.equal((await page.evaluate(()=>window.events.at(-1))).kind,'welcome',
    'an unreadable marker offers the welcome as secondary help without blocking Home');

  await page.evaluate(() => window.renderAccount('2026-10-11T12:00:00Z'));
  assert.equal(await page.getByRole('button', { name: /Open @alex.focus/ }).count(), 1);
  assert.equal(await page.getByText('No recent work yet.').count(), 0);

  await page.evaluate(() => window.renderAccount(undefined, false));
  assert.equal(await page.getByRole('button', { name: /Open @alex.focus/ }).count(), 1,
    'historical account payloads that omit the marker fail open to normal Home recents');
  await page.getByRole('button', { name: /Open @alex.focus/ }).click();
  assert.equal((await page.evaluate(() => window.events.at(-1))).kind, 'recent');

  assert.equal(await page.getByRole('button', { name: 'Open Riff menu' }).count(), 1);
  await page.getByRole('button', { name: 'Open Riff menu' }).click();
  assert.equal(await page.getByRole('dialog', { name: 'Riff menu' }).count(), 1);
  assert.equal(await page.getByRole('dialog', { name: 'Riff menu' }).getByRole('button', { name: /Open @alex.focus/ }).count(), 1);
  await page.keyboard.press('Escape');

  await page.evaluate(() => window.renderAccount('2026-10-11T12:00:00Z'));
  assert.equal(await page.locator('.riff-home__account').textContent(), 'Ready, Fictional Creator');
  await page.evaluate(() => window.renderError());
  assert.match(await page.getByRole('status').textContent(), /could not read this account/i);
  assert.equal(await page.getByPlaceholder('Share a video or profile link, or tell me what you want to make…').count(), 1);
});
