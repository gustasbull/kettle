import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import {
  PAPER_CURRENT,
  allRiffCoreFixtures,
  riffCoreWorkflowFixtures,
} from './fixtures/riff-core-workflows.ts';

const expectedFixtureIds = [
  'account-first', 'account-returning', 'account-malformed-marker', 'account-b',
  'home-empty', 'home-loading', 'home-error', 'home-recents',
  'job-fetch', 'job-analyze', 'job-profile', 'job-product', 'job-discovery',
  'scan-video-full', 'scan-video-partial', 'scan-tiktok', 'scan-instagram',
  'product-draft', 'product-validated', 'product-save-receipt', 'product-conflict',
  'recommendations-four-libraries',
  'catalog-loading', 'catalog-empty', 'catalog-error', 'catalog-one', 'catalog-five', 'catalog-eight',
  'scripts-three-variants', 'scripts-segments', 'scripts-legacy', 'scripts-missing-optional',
  'work-state-active', 'work-state-saved', 'work-state-filmed', 'work-state-replay', 'work-state-stale', 'work-state-foreign',
  'host-fake', 'host-timeout', 'host-late', 'host-hostile',
].map(id => `paper-current-${id}-v1`);

test('Paper CURRENT acceptance fixtures are complete, parsed, cited, and unmistakably test-only', () => {
  assert.deepEqual(PAPER_CURRENT, {
    file_id: '01M39TTB7DKFHZY2JVDMAEDZ81', page_id: 'p-5-0', artboard_id: 'Z9H-0', token_hash: '17cc259e',
  });
  const fixtures = allRiffCoreFixtures();
  assert.deepEqual(fixtures.map(item => item.fixture_id).sort(), expectedFixtureIds.sort());
  for (const item of fixtures) {
    assert.equal(item.origin, 'fixture');
    assert.equal(item.contains_fixture_data, true);
    assert.match(item.fixture_id, /^paper-current-[a-z0-9-]+-v1$/);
    assert.match(item.paper_node, /[A-Z0-9]+-0/);
    assert.notEqual(item.value, undefined);
  }
  assert.equal(riffCoreWorkflowFixtures.scans.videoFull.value.result?.kind, 'scan');
  assert.equal(riffCoreWorkflowFixtures.recommendations.fourLibraries.value.result?.kind, 'recommendations');
  assert.equal(riffCoreWorkflowFixtures.scripts.segments.value.result?.kind, 'scripts');
  assert.equal(riffCoreWorkflowFixtures.product.validated.value.current_version, 1);
  assert.equal(riffCoreWorkflowFixtures.workState.saved.value.state, 'saved');
  assert.equal(riffCoreWorkflowFixtures.catalog.eight.value.page.cards.length, 8);
  assert.equal(riffCoreWorkflowFixtures.accounts.malformedMarker.value.result.status, 'error');
});

async function browserBundle() {
  const result = await build({
    stdin: {
      resolveDir: process.cwd(), loader: 'ts', contents: `
        import { mountRiffOnboarding } from './apps/panel/riff-onboarding/index.ts';
        import { mountRiffHome } from './apps/panel/riff-home/index.ts';
        import { mountRiffMenu } from './apps/panel/riff-shell/menu.ts';
        import { mountCreatorPipeline } from './apps/panel/creator-pipeline/index.ts';
        import { mountRiffProductContext } from './apps/panel/riff-product-context/index.ts';
        import { riffHomeStructuredOutput } from './apps/panel/riff-home/index.ts';
        import { riffDiscoveryCatalogStructuredOutput } from './apps/panel/creator-pipeline-validation.ts';
        import { CreatorJobView } from './packages/contracts/creator-pipeline.ts';
        import { riffCoreWorkflowFixtures as f } from './tests/panel/fixtures/riff-core-workflows.ts';
        window.events=[]; window.external=[]; window.imageSources=[]; window.__riffExecuted=false; window.productMode='saved';
        const nativeImageSrc=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
        Object.defineProperty(HTMLImageElement.prototype,'src',{configurable:true,enumerable:nativeImageSrc.enumerable,
          get(){return nativeImageSrc.get.call(this)},set(value){window.imageSources.push(String(value));nativeImageSrc.set.call(this,value)}});
        window.fetch=(...args)=>{window.external.push({kind:'fetch',args});return Promise.reject(new Error('blocked authored request'));};
        window.open=(...args)=>{window.external.push({kind:'open',args});return null;};
        window.XMLHttpRequest=class { open(...args){window.external.push({kind:'xhr',args})} send(){} setRequestHeader(){} };
        window.WebSocket=class { constructor(...args){window.external.push({kind:'websocket',args})} close(){} };
        window.EventSource=class { constructor(...args){window.external.push({kind:'eventsource',args})} close(){} };
        const root=()=>document.getElementById('root');
        const reset=()=>{ window.view?.dispose?.(); window.view=undefined; root().replaceChildren(); window.events=[]; };
        const action=(kind)=>async (...args)=>{ window.events.push({kind,args}); return {status:'sent',message:kind+' confirmed by the authored bridge fake.'}; };
        window.bootOnboarding=()=>{reset();window.view=mountRiffOnboarding(root());};
        window.bootMenu=(platform='instagram',hostile=false)=>{reset(); const shell=document.createElement('main');shell.className='riff-app riff-menu-scope';shell.style.cssText='position:relative;min-height:792px';const host=document.createElement('span');host.id='menu-host';shell.append(host);root().append(shell);
          const item={...f.home.recents.value[1],platform,...(hostile?{title:f.host.hostile.value.text,thumbnail_url:f.host.hostile.value.url}:{})};
          window.view=mountRiffMenu(host,{account:f.accounts.returning.value,recents:[item],activeRoute:'home',onNavigate:route=>events.push({kind:'navigate',route}),onOpenRecent:item=>events.push({kind:'recent',item}),onCreate:()=>events.push({kind:'create'}),onClose:()=>events.push({kind:'close'}),onAccountSettings:action('account'),onSupport:action('support'),onFeedback:action('feedback'),onRequestTheme:action('theme')});
          window.replaceMenuAccount=()=>window.view.render({account:f.accounts.accountB.value,activeRoute:'home'});
        };
        const recents=()=>f.home.recents.value.map((item,index)=>({job_id:item.id,title:item.title,stage:item.stage,state:'succeeded',updated_at:'2026-10-11T12:00:00Z',...(item.platform==='tiktok'?{platform:'tiktok'}:{}),variant_id:index===0?'00000000-0000-4000-8000-000000000701':null,work_state:null}));
        const homeActions=()=>({start:action('start'),send:action('send'),upload:action('upload'),openRecent:action('recent'),accountSettings:action('account'),support:action('support'),feedback:action('feedback'),requestTheme:action('theme'),saveProduct:async()=>({status:'failed',message:'Authored save is intentionally controlled.'})});
        window.bootHome=(account='returning',recentState='recents')=>{reset();window.view=mountRiffHome(root(),homeActions());window.view.render({status:'ready',account:f.accounts[account].value});
          if(recentState==='loading')window.view.setRecentsState(f.home.loading.value);else if(recentState==='error')window.view.setRecentsState(f.home.error.value);else if(recentState==='empty')window.view.setRecents(f.home.empty.value);else window.view.setRecents(recents());};
        window.bootHomeEnvelopeState=state=>{reset();window.view=mountRiffHome(root(),homeActions());if(state==='loading')window.view.render({status:'loading'});else if(state==='error')window.view.render({status:'error',message:'Authored account unavailable.'});else window.view.render(f.accounts.malformedMarker.value.result);window.view.setRecentsState(state==='loading'?f.home.loading.value:state==='error'?f.home.error.value:{status:'ready',items:recents()});};
        window.bootAsyncHome=()=>{reset();window.pending=[];window.view=mountRiffHome(root(),{...homeActions(),start:source=>new Promise(resolve=>window.pending.push({source,resolve}))});window.view.render({status:'ready',account:f.accounts.returning.value});window.view.setRecents([]);};
        window.switchAsyncHomeAccount=()=>{window.view.clearPrivate();window.view.render({status:'ready',account:f.accounts.accountB.value});window.view.setRecents([])};
        window.bootTimeoutHome=()=>{reset();window.view=mountRiffHome(root(),{...homeActions(),start:async source=>{window.events.push({kind:'timeout-start',source,fixture:f.host.timeout.fixture_id});await new Promise(resolve=>setTimeout(resolve,20));return {status:'failed',message:'Riff could not confirm whether this analysis started. Try the same action again safely.'}}});window.view.render({status:'ready',account:f.accounts.returning.value});window.view.setRecents([]);};
        window.parseHome=value=>riffHomeStructuredOutput(value);
        window.parseCatalog=value=>riffDiscoveryCatalogStructuredOutput(value);
        window.bootProduct=(source='draft',mode='saved')=>{reset();window.productMode=mode;window.productCalls=[];window.productFrames=[];window.productLate=[];
          window.requestAnimationFrame=callback=>{window.productFrames.push(callback);return window.productFrames.length};window.cancelAnimationFrame=()=>{};
          window.view=mountRiffProductContext(root(),{onSave:async context=>{window.productCalls.push(context);
            if(window.productMode==='timeout')return new Promise(resolve=>window.productLate.push(resolve));
            if(window.productMode==='conflict')return {status:'conflict',latest:f.product.validated.value,message:'A newer saved version is available. Review your local edits and confirm again.'};
            if(window.productMode==='failed')return {status:'failed',message:'Authored save could not be confirmed.'};
            return {status:'saved',project:f.product.validated.value,requestId:f.product.saveReceipt.value.request_id};
          },onDiscover:async project=>{window.events.push({kind:'discover-product',project});return {status:'sent',message:'Saved context sent to ChatGPT.'};}});
          window.view.start(source==='saved'?{kind:'saved',project:f.product.validated.value}:{kind:'unsaved',description:f.product.draft.value.description});
          window.advanceProduct=()=>window.productFrames.shift()?.(performance.now());
        };
        const withState=(job,state)=>{const next=structuredClone(job);const variant=next.result.scripts.variants[0];const exact=f.workState[state]?.value;const prior=next.work_states.find(item=>item.variant_id===variant.id);next.work_states=next.work_states.filter(item=>item.variant_id!==variant.id);next.work_states.push(exact&&exact.job_id===next.id&&exact.variant_id===variant.id?structuredClone(exact):{job_id:next.id,variant_id:variant.id,state,version:(prior?.version??0)+1,updated_at:'2026-10-11T12:02:00Z'});return CreatorJobView.parse(next)};
        window.bootPipeline=(state,workOutcome='normal')=>{reset();window.workOutcome=workOutcome;window.view=mountCreatorPipeline(root(),{displayMode:'fullscreen',sendPrompt:action('message'),startRecommendations:async context=>{window.events.push({kind:'recommendations',args:[context]});return context.dna.profile.platform==='instagram'?{status:'unsupported',message:'Instagram provider analysis is unavailable in this development route.'}:{status:'sent',message:'Recommendations confirmed by the authored bridge fake.'}},makeMine:action('make-mine'),proposeCatalogReference:action('proposal'),onCatalogRetry:()=>events.push({kind:'catalog-retry'}),openVault:action('open-vault'),setVariantState:async ({job,variant,state})=>{window.events.push({kind:'work-state',state,jobId:job.id,variantId:variant.id,outcome:window.workOutcome});
            if(window.workOutcome==='foreign')return {status:'failed',message:'Saved work was not found for this account.'};
            if(window.workOutcome==='stale'){const next=withState(job,'saved');window.lastWorkJob=next;return {status:'conflict',message:'Riff changed elsewhere. The latest saved state is shown.',job:next};}
            const next=withState(job,state);window.lastWorkJob=next;return {status:'confirmed',message:(window.workOutcome==='replay'?'Exact replay confirmed. ': '')+state+' confirmed.',workState:next.work_states.find(item=>item.variant_id===variant.id),job:next};}});
          if(state==='fetch')window.view.render(f.scans.videoFull.value,{status:f.jobs.fetch.value});
          else if(state==='analyze')window.view.render(f.scans.videoFull.value,{status:f.jobs.analyze.value});
          else if(state==='profile-loading')window.view.render(f.scans.tiktok.value,{status:f.jobs.profile.value});
          else if(state==='discovery-loading')window.view.render(f.recommendations.fourLibraries.value,{status:f.jobs.discovery.value});
          else if(state==='video')window.view.render(f.scans.videoFull.value);
          else if(state==='partial')window.view.render(f.scans.videoPartial.value);
          else if(state==='tiktok')window.view.render(f.scans.tiktok.value);
          else if(state==='instagram')window.view.render(f.scans.instagram.value);
          else if(state==='discovery')window.view.render(f.recommendations.fourLibraries.value);
          else if(state==='studio')window.view.render(f.scripts.segments.value);
          else if(state==='studio-three')window.view.render(f.scripts.threeVariants.value);
          else if(state==='studio-legacy')window.view.render(f.scripts.legacy.value);
          else if(state==='studio-missing')window.view.render(f.scripts.missingOptional.value);
          else if(state==='saved')window.view.render(withState(f.scripts.segments.value,'saved'));
          else if(state==='filmed')window.view.render(withState(f.scripts.segments.value,'filmed'));
          else if(state==='hostile'){const job=structuredClone(f.recommendations.fourLibraries.value);job.result.batch.ideas[0].title=f.host.hostile.value.text;window.view.render(CreatorJobView.parse(job));}
          else if(state.startsWith('catalog-')){window.view.render(f.recommendations.fourLibraries.value);window.view.showCatalog('videos',{accountWide:true});window.view.setCatalogState(f.catalog[state.slice(8)].value);}
        };
      `,
    },
    bundle: true, platform: 'browser', format: 'iife', write: false,
  });
  return result.outputFiles[0].text;
}

const noDocumentOverflow = async page => assert.equal(await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);

const assertNamedNativeControls = async page => {
  const invalid = await page.locator('button,a[href],input,textarea,select').evaluateAll(nodes => nodes.filter(node => {
    const label = node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent ||
      (node.labels ? [...node.labels].map(item => item.textContent).join(' ') : '');
    return !label.trim();
  }).map(node => node.outerHTML));
  assert.deepEqual(invalid, []);
};

const assertActiveControlsWithinViewport = async page => {
  const clipped = await page.locator('button:not([hidden]),a[href]:not([hidden]),input:not([hidden]),textarea:not([hidden]),select:not([hidden])').evaluateAll(nodes => nodes.flatMap(node => {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || node.tabIndex < 0 || node.closest('[aria-hidden="true"]')) return [];
    node.focus({ preventScroll: true });
    node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const box = node.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return [];
    return box.left < -1 || box.right > document.documentElement.clientWidth + 1
      ? [{ label: node.getAttribute('aria-label') || node.textContent?.trim(), left: box.left, right: box.right, viewport: document.documentElement.clientWidth }]
      : [];
  }));
  assert.deepEqual(clipped, []);
};

const assertSafeImages = async page => {
  const imageSources = await page.evaluate(() => window.imageSources ?? []);
  for (const source of imageSources) {
    const url = new URL(source);
    if (url.protocol === 'data:') {
      assert.match(source, /^data:image\/(?:jpeg|png|webp);base64,/);
      continue;
    }
    assert.equal(url.protocol, 'https:');
    assert.equal(url.username, '');
    assert.equal(url.password, '');
    assert.ok(url.hostname === 'tiktokcdn.com' || url.hostname.endsWith('.tiktokcdn.com')
      || url.hostname === 'tiktokcdn-us.com' || url.hostname.endsWith('.tiktokcdn-us.com'),
    `unexpected image host ${url.hostname}`);
  }
};

const boxSummary = locator => locator.evaluate(node => {
  const box = node.getBoundingClientRect();
  const style = getComputedStyle(node);
  return {
    width: Math.round(box.width), height: Math.round(box.height), padding: style.padding,
    radius: style.borderRadius, gap: style.gap,
  };
});

test('Product loading and context require explicit validation plus a receipt, and preserve retryable drafts', async t => {
  const script = await browserBundle();
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1304, height: 900 } });
  await page.setContent(`<div id="root"></div><script>${script}</script>`);

  await page.evaluate(() => window.bootProduct('draft', 'saved'));
  const pending = page.locator('[data-product-state="pending"]');
  assert.equal(await pending.count(), 1);
  assert.equal(await page.getByRole('heading', { name: 'Understanding your product' }).count(), 1);
  assert.match(await pending.textContent(), /Preparing your editable brief….*Description received.*Preparing your brief/s);
  assert.deepEqual(await pending.evaluate(node => { const s=getComputedStyle(node);return {width:s.width,padding:s.padding,radius:s.borderRadius,gap:s.gap}; }),
    {width:'540px',padding:'22px',radius:'20px',gap:'18px'});
  assert.equal(Math.round((await pending.boundingBox()).height), 181);
  assert.equal(await pending.locator('.riff-product__pending-track').evaluate(node => getComputedStyle(node).height), '8px');
  assert.deepEqual(await pending.locator('.riff-product__pending-segment').evaluate(node => {
    const style=getComputedStyle(node);return {left:Math.round(parseFloat(style.left)),width:Math.round(parseFloat(style.width))};
  }), {left:139,width:159});
  assert.equal(await page.evaluate(() => window.productFrames.length), 1, 'product loading is a next-paint transition, never a fabricated timer');
  await page.evaluate(() => window.advanceProduct());

  const panel = page.locator('.riff-product__panel');
  assert.deepEqual(await panel.evaluate(node => {const s=getComputedStyle(node);return {width:s.width,padding:s.padding,gap:s.gap,radius:s.borderRadius};}),
    {width:'905px',padding:'28px 52px',gap:'24px',radius:'0px 0px 24px 24px'});
  assert.equal(await page.locator('.riff-product__brief').evaluate(node => getComputedStyle(node).width), '540px');
  assert.equal(await page.locator('.riff-product__identity').isHidden(), true);
  assert.equal(await page.getByLabel('Description', { exact:true }).inputValue(), 'Authored product description');
  await page.getByRole('button', { name:'Confirm context' }).focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.getByLabel('Product', { exact:true }).getAttribute('aria-invalid'), 'true');
  assert.equal(await page.evaluate(() => window.productCalls.length), 0, 'invalid unknown fields never cross the bridge');

  await page.evaluate(() => window.bootProduct('saved', 'saved'));
  const confirm = page.getByRole('button', { name:'Confirm context' });
  await confirm.focus(); await page.keyboard.press('Enter');
  await page.getByText('Context saved', { exact:true }).waitFor();
  assert.equal(await page.evaluate(() => window.productCalls.length), 1);
  assert.deepEqual(await page.evaluate(() => ({
    version:window.productCalls[0].project.current_version,
    product:window.productCalls[0].draft.product,
  })), {version:1,product:'Authored desk light'});
  const discover = page.getByRole('button', { name:'Discover formats' });
  assert.equal(await discover.isVisible(), true, 'only a parsed receipt-backed save enables discovery');
  await discover.focus(); await page.keyboard.press('Space');
  assert.equal(await page.evaluate(() => window.events.filter(event => event.kind==='discover-product').length), 1);

  await page.evaluate(() => window.bootProduct('saved', 'conflict'));
  await page.getByLabel('Audience', { exact:true }).fill('Local authored audience edit');
  await page.getByRole('button', { name:'Confirm context' }).click();
  await page.getByText(/newer saved version is available/i).waitFor();
  assert.equal(await page.getByLabel('Audience', { exact:true }).inputValue(), 'Local authored audience edit');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Confirm context');
  await page.evaluate(() => window.productMode='saved');
  await page.getByRole('button', { name:'Confirm context' }).click();
  await page.getByText('Context saved', { exact:true }).waitFor();
  assert.equal(await page.evaluate(() => window.productCalls.length), 2, 'conflict recovery performs one explicit retry');

  await page.evaluate(() => window.bootProduct('saved', 'timeout'));
  await page.getByRole('button', { name:'Confirm context' }).click();
  assert.match(await page.getByRole('status').textContent(), /Saving your product context/);
  assert.equal(await page.getByRole('form', { name:'Your product brief' }).getAttribute('aria-busy'), 'true');
  await page.evaluate(() => { const resolve=window.productLate[0]; window.view.dispose(); resolve({status:'saved',project:{},requestId:'late'}); });
  assert.equal(await page.locator('#root').textContent(), '', 'a late receipt cannot repopulate a disposed or switched surface');
  assert.equal(await page.evaluate(() => window.external.length), 0);
});

test('all five Paper loading rows have exact stage copy, geometry, opacity lanes, and static reduced-motion truth', async t => {
  const script = await browserBundle();
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 640, height: 424 } });
  await page.setContent(`<div id="root"></div><script>${script}</script>`);

  const stages = [
    {
      state: 'fetch', height: 301, title: 'Fetching your video',
      subtitle: 'Opening your link and loading the available video details.',
      activity: 'Loading the video and its captions…', done: 'Link received', next: 'Analyzing next',
      preview: '.riff-loading-video', previewSize: '496x102', source: 'Your videoLoading your linked video…',
    },
    {
      state: 'analyze', height: 301, title: 'Analyzing your video',
      subtitle: 'Reviewing the opening, delivery and call to action.',
      activity: 'Analyzing hooks and pacing…', done: 'Video fetched', next: 'Preparing your analysis',
      preview: '.riff-loading-video', previewSize: '496x102', source: 'Your videoHook · Content · Pacing · Voice · CTA',
    },
    {
      state: 'profile-loading', height: 309, title: 'Getting to know your profile',
      subtitle: 'Loading available posts and performance from your profile.',
      activity: 'Fetching your recent videos…', done: 'Profile found', next: 'Analyzing your content',
      preview: '.riff-loading-profile', previewSize: '496x110', opacities: ['1', '1', '0.65', '0.65', '0.35', '0.35'],
    },
    {
      state: 'discovery-loading', height: 309, title: 'Finding videos for your next idea',
      subtitle: 'Looking through relevant creators, videos and formats.',
      activity: 'Comparing hooks and product showcases…', done: 'Your brief is ready', next: 'Choosing matching references',
      preview: '.riff-loading-references', previewSize: '496x110', opacities: ['1', '1', '1', '0.65', '0.65', '0.35', '0.35'],
    },
  ];
  for (const row of stages) {
    await page.evaluate(state => window.bootPipeline(state), row.state);
    const card = page.locator('.riff-loading-card');
    assert.deepEqual(await boxSummary(card), { width: 540, height: row.height, padding: '22px', radius: '20px', gap: '18px' }, row.state);
    assert.equal(await page.getByRole('heading', { name: row.title, exact: true }).count(), 1);
    assert.equal(await page.getByText(row.subtitle, { exact: true }).count(), 1);
    assert.equal(await page.locator('.riff-loading-activity').textContent(), row.activity);
    assert.equal(await page.locator('.riff-loading-complete').textContent(), row.done);
    assert.equal(await page.locator('.riff-loading-footer > span').last().textContent(), row.next);
    assert.equal(await page.locator(row.preview).evaluate(node => {
      const box=node.getBoundingClientRect();return `${Math.round(box.width)}x${Math.round(box.height)}`;
    }), row.previewSize);
    if (row.source) assert.equal(await page.locator('.riff-loading-video__copy').textContent(), row.source);
    if (row.opacities) assert.deepEqual(await page.locator('.riff-loading-reference').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).opacity)), row.opacities);
    assert.equal(await page.locator('.riff-progress').evaluate(node => getComputedStyle(node).height), '8px');
    assert.deepEqual(await page.locator('.riff-progress').evaluate(node => {
      const style=getComputedStyle(node,'::after');return {left:Math.round(parseFloat(style.left)),width:Math.round(parseFloat(style.width))};
    }), { left: 139, width: 159 });
    assert.equal(await page.locator('.riff-pipeline__content').getAttribute('data-stage'),
      row.state === 'fetch' ? 'reviewing_video' : row.state === 'analyze' ? 'building_analysis' : row.state === 'profile-loading' ? 'reading_profile' : 'researching_formats');
    assert.equal(await card.locator('button,a[href],input,textarea').count(), 0, 'the loading card has no dead action');
  }

  await page.evaluate(() => window.bootProduct('draft', 'saved'));
  const product = page.locator('.riff-product__pending');
  assert.deepEqual(await boxSummary(product), { width: 540, height: 181, padding: '22px', radius: '20px', gap: '18px' });
  assert.match(await product.textContent(), /Understanding your product.*Turning your description into an editable brief.*Preparing your editable brief….*Description received.*Preparing your brief/s);
  assert.equal(await page.locator('.riff-product__pending-track').evaluate(node => getComputedStyle(node).height), '8px');

  const reduced = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await reduced.emulateMedia({ reducedMotion: 'reduce' });
  await reduced.setContent(`<div id="root"></div><script>${script}</script>`);
  for (const state of ['fetch', 'analyze', 'profile-loading', 'discovery-loading']) {
    await reduced.evaluate(value => window.bootPipeline(value), state);
    assert.equal(await reduced.locator('.riff-loading-spinner').evaluate(node => getComputedStyle(node).animationName), 'none');
    assert.equal(await reduced.locator('.riff-progress').evaluate(node => getComputedStyle(node, '::after').animationName), 'none');
    assert.match(await reduced.getByRole('status').textContent(), /In progress|Authored fixture/i);
  }
  await reduced.evaluate(() => window.bootProduct('draft', 'saved'));
  assert.equal(await reduced.locator('.riff-product__spinner').evaluate(node => getComputedStyle(node).animationName), 'none');
  assert.equal(await reduced.locator('.riff-product__pending-segment').evaluate(node => getComputedStyle(node).animationName), 'none');
  await assertSafeImages(page);
  await assertSafeImages(reduced);
  assert.equal(await page.evaluate(() => window.external.length), 0);
  assert.equal(await reduced.evaluate(() => window.external.length), 0);
});

test('partial and full video rows match Paper geometry, evidence omissions, semantic bands, and keyboard actions', async t => {
  const script = await browserBundle();
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1504, height: 832 } });
  await page.setContent(`<div id="root"></div><script>${script}</script>`);

  await page.evaluate(() => window.bootPipeline('partial'));
  const partial = page.locator('.riff-partial-analysis-card');
  assert.deepEqual(await boxSummary(partial), { width: 656, height: 202, padding: '24px', radius: '18px', gap: '20px' });
  assert.match(await partial.textContent(), /We could read the words, not the visuals.*We can help with the wording.*Upload the video file in chat.*Work on the script/s);
  const partialAction = page.getByRole('button', { name: 'Work on the script', exact: true });
  assert.ok((await partialAction.boundingBox()).height >= 44);
  assert.equal(await partialAction.evaluate(node => getComputedStyle(node).borderColor), 'rgb(167, 134, 233)');
  await partialAction.focus(); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.events.filter(event => event.kind === 'message').length), 1);
  assert.match(await page.evaluate(() => window.events.at(-1).args[0]), /transcript or captions.*Do not make claims about shots or pacing/i);
  assert.equal(await page.evaluate(() => window.events.some(event => event.kind === 'work-state')), false);

  await page.evaluate(() => window.bootPipeline('video'));
  assert.equal(await page.getByRole('heading', { name: 'Unlock your video’s viral potential.', exact: true }).count(), 1);
  assert.equal(await page.locator('.riff-analysis-card').evaluate(node => Math.round(node.getBoundingClientRect().width)), 900);
  assert.equal(await page.locator('.riff-analysis-media').evaluate(node => {
    const box=node.getBoundingClientRect();return `${Math.round(box.width)}x${Math.round(box.height)}`;
  }), '313x556');
  assert.equal(await page.locator('.riff-analysis-video').evaluate(node => {
    const box=node.getBoundingClientRect();return `${Math.round(box.width)}x${Math.round(box.height)}`;
  }), '277x492');
  assert.deepEqual(await page.locator('.riff-metric__copy').evaluateAll(nodes => nodes.map(node => node.textContent)), ['120Views', '0Likes']);
  assert.equal(await page.locator('.riff-metric--saves').count(), 0, 'null/unobserved saves are omitted instead of synthesized');
  assert.deepEqual(await page.locator('.riff-analysis-row__head h2').allTextContents(), ['Hook', 'Content', 'Style & pacing', 'Voice & language', 'Script', 'CTA']);
  assert.deepEqual(await page.locator('.riff-analysis-row__status').allTextContents(), ['Needs attention', 'Working well', 'Limited', 'Working well', 'Needs rework', 'Needs attention']);
  const bands = await page.locator('.riff-analysis-row').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor));
  assert.deepEqual(bands, ['rgb(247, 240, 222)', 'rgb(234, 243, 237)', 'rgb(226, 233, 245)', 'rgb(234, 243, 237)', 'rgb(247, 234, 232)', 'rgb(247, 240, 222)']);
  for (const [name, kind] of [['Rework this video', 'message'], ['Explore viral formats', 'recommendations']]) {
    const control = page.getByRole('button', { name, exact: true });
    await control.focus(); await page.keyboard.press(name.startsWith('Rework') ? 'Enter' : 'Space');
    assert.equal(await page.evaluate(expected => window.events.at(-1).kind === expected, kind), true);
  }
  assert.equal(await page.evaluate(() => window.events.filter(event => event.kind === 'recommendations').at(-1).args[0].job.id), riffCoreWorkflowFixtures.scans.videoFull.value.id);
  await assertNamedNativeControls(page);
  await assertSafeImages(page);
  assert.equal(await page.evaluate(() => window.external.length), 0);
});

test('TikTok and Instagram profile rows stay platform-specific, omit absent data, and expose provider limits', async t => {
  const script = await browserBundle();
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1504, height: 763 } });
  await page.setContent(`<div id="root"></div><script>${script}</script>`);

  for (const row of [
    { state: 'tiktok', heading: 'Turn what’s working into your next breakout.', platform: 'tiktok', top: 'Top videos', reviewed: /TikTok video(?:s)? reviewed/, unavailable: false },
    { state: 'instagram', heading: 'Turn your best results into more reach.', platform: 'instagram', top: 'Top Reels', reviewed: /Instagram Reel(?:s)? reviewed/, unavailable: true },
  ]) {
    await page.evaluate(state => window.bootPipeline(state), row.state);
    assert.equal(await page.getByRole('heading', { name: row.heading, exact: true }).count(), 1);
    assert.equal(await page.locator('.riff-profile-shell').evaluate(node => Math.round(node.getBoundingClientRect().width)), 900);
    assert.equal(await page.locator('.riff-profile-card').evaluate(node => Math.round(node.getBoundingClientRect().width)), 320);
    assert.equal(await page.locator(`.riff-profile-platform--${row.platform}`).count(), 1);
    assert.equal(await page.getByRole('heading', { name: row.top, exact: true }).count(), 1);
    assert.match(await page.locator('.riff-profile-reviewed').textContent(), row.reviewed);
    assert.deepEqual(await page.locator('.riff-profile-analysis article > header h2').allTextContents(), ['What’s working', 'What to improve', 'Your next move']);
    assert.deepEqual(await page.locator('.riff-profile-insight > header span').allTextContents(), ['Working well', 'Needs attention']);
    assert.equal(await page.locator('.riff-profile-metric').count(), 1, 'only the one validated projected aggregate renders');
    assert.equal(await page.locator('.riff-profile-metric').textContent(),'120Views');
    assert.equal(await page.locator('.riff-profile-metric').filter({ hasText: /Shares|Saves|Comments/ }).count(), 0);
    assert.equal(await page.locator('.riff-profile-identity').evaluate((identity, reviewed) =>
      identity.getBoundingClientRect().bottom <= reviewed.getBoundingClientRect().top,
    await page.locator('.riff-profile-reviewed').elementHandle()), true, 'profile identity never collides with reviewed coverage');
    const action = page.getByRole('button', { name: 'Find my next breakout idea', exact: true });
    await action.focus(); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.events.at(-1).kind), 'recommendations');
    if (row.unavailable) assert.match(await page.getByRole('status').textContent(), /Instagram provider analysis is unavailable/i);
    else assert.match(await page.getByRole('status').textContent(), /Recommendations confirmed/i);
  }
  assert.equal(await page.locator('.riff-profile-shell').textContent().then(text => /TikTok/.test(text)), false, 'Instagram result contains no TikTok-only copy');
  await assertSafeImages(page);
  assert.equal(await page.evaluate(() => window.external.length), 0);
});

test('onboarding, Home, recents, shortcuts, upload, and the complete drawer are keyboard-operable and truthful', async t => {
  const script = await browserBundle();
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1504, height: 902 } });
  await page.setContent(`<div id="root"></div><script>${script}</script>`);

  await page.evaluate(() => window.bootOnboarding());
  const card = page.locator('.riff-onboarding__card');
  assert.deepEqual(await card.evaluate(node => {
    const style=getComputedStyle(node);return {width:style.width,padding:style.padding,radius:style.borderRadius,gap:style.gap,border:style.borderTopWidth+' '+style.borderTopColor};
  }), { width:'576px',padding:'28px 24px 24px',radius:'24px',gap:'22px',border:'1px rgb(229, 234, 243)' });
  assert.equal(await page.locator('.riff-onboarding__carousel').evaluate(node => Math.round(node.getBoundingClientRect().width)), 526);
  for (const copy of ['Welcome to Riff', 'Unlock your viral potential.', 'Start with what you have.', 'Find your breakout idea.', 'Make it yours.', 'Ready for your next breakout?', 'Start here in chat or use the app on the right.']) {
    assert.ok((await page.locator('body').textContent()).includes(copy), copy);
  }
  const carousel = page.getByRole('region', { name: 'How Riff works' });
  await carousel.focus(); await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('tab', { name: 'Show Find step' }).getAttribute('aria-selected'), 'true');
  await page.getByRole('button', { name: 'Next step' }).focus(); await page.keyboard.press('Enter');
  assert.equal(await page.getByRole('tab', { name: 'Show Make step' }).getAttribute('aria-selected'), 'true');
  await page.getByRole('tab', { name: 'Show Make step' }).focus(); await page.keyboard.press('Home');
  assert.equal(await page.getByRole('tab', { name: 'Show Start step' }).evaluate(node => node === document.activeElement), true);

  await page.evaluate(() => window.bootHome('first', 'recents'));
  assert.equal(await page.getByRole('heading', { name: 'Pick up where you left off' }).isHidden(), true);
  await page.evaluate(() => window.bootHomeEnvelopeState('malformed'));
  assert.equal(await page.getByText('Riff returned incomplete account details. Reopen Home.', { exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: /Open Authored recent/ }).count(), 4, 'an unreadable marker fails open to truthful server recents');

  for (const [state, copy] of [['loading','Loading recent work…'], ['error','Authored recents could not load.'], ['empty','No recent work yet.']]) {
    await page.evaluate(value => window.bootHome('returning', value), state);
    assert.equal(await page.locator('.riff-home__recents').getByText(copy, { exact: true }).count(), 1);
  }
  await page.evaluate(() => window.bootHome('returning', 'recents'));
  const home = page.locator('.riff-home__home');
  assert.deepEqual(await home.evaluate(node => {const s=getComputedStyle(node);return {paddingTop:s.paddingTop,paddingRight:s.paddingRight,paddingBottom:s.paddingBottom,gap:s.gap,radius:s.borderRadius};}),
    {paddingTop:'28px',paddingRight:'28px',paddingBottom:'40px',gap:'20px',radius:'0px 0px 24px 24px'});
  assert.equal(await page.getByRole('button', { name: /Open Authored recent/ }).count(), 4);
  const input = page.getByRole('textbox', { name: 'Your next video starts here' });
  await input.fill('https://www.tiktok.com/@fixture/video/9000000000000000001');
  await page.getByRole('button', { name: 'Find my next idea' }).focus(); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.events.at(-1).kind), 'start');
  await input.fill('https://www.tiktok.com/@fixture/video/9000000000000000002'); await page.keyboard.press('Control+Enter');
  assert.equal(await page.evaluate(() => window.events.at(-1).kind), 'start');
  await page.getByRole('button', { name: 'Upload a video' }).focus(); await page.keyboard.press('Space');
  assert.equal(await page.evaluate(() => window.events.at(-1).kind), 'upload');
  assert.match(await page.getByRole('status').textContent(), /upload confirmed by the authored bridge fake/i);
  for (const [shortcut, heading] of [['Trending videos','Find your next breakout idea.'],['Hooks','Stop the scroll.'],['Product showcases','Make your product stand out.'],['Calls to action','Turn views into action.']]) {
    await page.evaluate(() => window.view.showHome());
    await page.getByRole('button', { name: shortcut, exact: true }).focus(); await page.keyboard.press('Enter');
    assert.equal(await page.getByRole('heading', { name: heading, exact: true }).count(), 1);
  }
  await page.evaluate(() => window.view.showHome());
  await page.getByRole('button', { name: /Open Authored recent 1/ }).focus(); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.events.at(-1).kind), 'recent');

  await input.fill('draft that Create must clear');
  const trigger = page.getByRole('button', { name: 'Open Riff menu' });
  await trigger.focus(); await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: 'Riff menu' });
  assert.equal(await drawer.evaluate(node => getComputedStyle(node).width), '288px');
  assert.equal(await page.locator('.riff-menu__backdrop').count(), 1);
  for (const name of ['Home','Discover videos','Create a video']) assert.equal(await drawer.getByRole('button', { name, exact:true }).count(), 1);
  assert.equal(await drawer.getByRole('button', { name: /Open Authored recent/ }).count(), 4);
  assert.equal((await drawer.textContent()).includes('10 analysis left'), false);
  await drawer.getByRole('button', { name: 'Create a video' }).focus(); await page.keyboard.press('Tab');
  assert.equal(await page.getByRole('button', { name: 'Authored Creator A account menu' }).evaluate(node => node === document.activeElement), true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await drawer.getByRole('button', { name: 'Create a video' }).evaluate(node => node === document.activeElement), true);
  await page.keyboard.press('Enter');
  assert.equal(await input.inputValue(), '');
  assert.equal(await drawer.isHidden(), true);

  await trigger.click(); await drawer.getByRole('button', { name: 'Discover videos', exact:true }).click();
  assert.equal(await page.getByRole('heading', { name: 'Find your next breakout idea.' }).count(), 1);
  await page.getByRole('button', { name: 'Open Riff menu' }).click(); await drawer.getByRole('button', { name:'Home', exact:true }).click();
  assert.equal(await page.getByRole('heading', { name: 'Let’s make your next video go viral.' }).count(), 1);
  await trigger.click();
  await page.getByRole('button', { name: 'Authored Creator A account menu' }).click();
  const accountMenu = page.getByRole('menu', { name: 'Account' });
  for (const [label, kind] of [['Account settings','account'],['Dark mode','theme'],['Support','support'],['Give feedback','feedback']]) {
    await accountMenu.getByRole('menuitem', { name: label, exact:true }).focus(); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(expected => window.events.at(-1).kind === expected, kind), true);
  }
  await page.keyboard.press('Escape'); assert.equal(await accountMenu.isHidden(), true); assert.equal(await drawer.isVisible(), true);
  await page.keyboard.press('Escape'); assert.equal(await drawer.isHidden(), true); assert.equal(await trigger.evaluate(node => node === document.activeElement), true);
  await trigger.click(); await page.locator('.riff-menu__backdrop').click({position:{x:1000,y:300}}); assert.equal(await drawer.isHidden(), true);
  assert.equal(await page.evaluate(() => window.events.some(event => /mark_riff_onboarding_seen/i.test(event.kind))), false, 'Home cannot mark welcome delivery');
  await assertNamedNativeControls(page); await assertActiveControlsWithinViewport(page); await assertSafeImages(page);
  assert.equal(await page.evaluate(() => window.external.length), 0);
});

test('Discovery proves all four creative lenses, catalog truth states, geometry, keyboard routes, and browse-only actions', async t => {
  const script = await browserBundle();
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1504, height: 902 } });
  await page.setContent(`<div id="root"></div><script>${script}</script>`);
  await page.evaluate(() => window.bootPipeline('discovery'));

  assert.equal(await page.locator('.riff-discovery-header').evaluate(node => Math.round(node.getBoundingClientRect().width)), 999);
  assert.equal(await page.locator('.riff-discovery-stage').evaluate(node => {
    const box=node.getBoundingClientRect();return `${Math.round(box.width)}x${Math.round(box.height)}`;
  }), '999x566');
  assert.deepEqual(await page.locator('.riff-libraries').evaluate(node => {const s=getComputedStyle(node);return {background:s.backgroundColor,height:s.height};}),
    {background:'rgb(240, 240, 242)',height:'44px'});

  const libraries = [
    ['Videos','Find your next breakout idea.','Make it mine'],
    ['Hooks','Stop the scroll.','Use this hook'],
    ['Product showcases','Make your product stand out.','Use this showcase'],
    ['CTAs','Turn views into action.','Use this CTA'],
  ];
  for (const [tabName,title,action] of libraries) {
    await page.getByRole('tab', { name:tabName, exact:true }).click();
    assert.equal(await page.getByRole('heading', { name:title, exact:true }).count(), 1);
    assert.equal(await page.getByRole('button', { name:action, exact:true }).count(), 1);
    await page.getByRole('button', { name:action, exact:true }).click();
  }
  assert.deepEqual(await page.evaluate(() => window.events.filter(event=>event.kind==='make-mine').map(event=>event.args[0].library)),
    ['videos','hooks','showcases','ctas']);
  const active = page.locator('.riff-library[aria-selected="true"]');
  assert.deepEqual(await active.evaluate(node => {const s=getComputedStyle(node);return {color:s.color,background:s.backgroundColor};}),
    {color:'rgb(105, 51, 161)',background:'rgb(255, 255, 255)'});
  await active.focus(); await page.keyboard.press('Home');
  assert.equal(await page.getByRole('tab', { name:'Videos' }).evaluate(node=>node===document.activeElement), true);
  const carousel = page.locator('[data-discovery-carousel]');
  await carousel.focus(); const before=await carousel.getAttribute('aria-label'); await page.keyboard.press('ArrowRight');
  assert.notEqual(await page.locator('[data-discovery-carousel]').getAttribute('aria-label'), before);

  await page.evaluate(() => window.bootPipeline('catalog-loading'));
  assert.equal(await page.locator('.riff-pipeline__content').getAttribute('aria-busy'), 'true');
  assert.match(await page.getByRole('status').last().textContent(), /Loading saved reference videos/);
  await page.evaluate(() => window.bootPipeline('catalog-empty'));
  assert.match(await page.locator('.riff-catalog-state').textContent(), /No saved permitted reference videos/);
  await page.evaluate(() => window.bootPipeline('catalog-error'));
  await page.getByRole('button', { name:'Retry' }).click();
  assert.equal(await page.evaluate(() => window.events.at(-1).kind), 'catalog-retry');
  for (const count of ['one','five','eight']) {
    await page.evaluate(value => window.bootPipeline(`catalog-${value}`), count);
    assert.equal(await page.locator('[data-active-catalog]').count(), 1);
    assert.equal(await page.getByRole('button', { name:'Make it mine' }).count(), 1);
  }
  assert.equal(await page.locator('[data-active-catalog]').getByLabel('0 views').count(), 1, 'an observed zero is rendered rather than treated as absent');
  assert.equal(await page.locator('[data-active-catalog] .riff-idea-stat').count(), 1, 'null metrics remain omitted');
  await page.getByRole('button', { name:'Make it mine' }).click();
  assert.equal(await page.evaluate(() => window.events.filter(event=>event.kind==='proposal').length), 1);
  assert.equal(await page.evaluate(() => window.events.filter(event=>event.kind==='make-mine').length), 0,
    'catalog browsing produces only a no-write proposal handoff');
  assert.equal(await page.evaluate(() => window.external.length), 0);
});

test('Studio four-part semantics, variants, lineage, local format, and receipt-backed saved/filmed/undo/resume are live', async t => {
  const script = await browserBundle();
  const browser = await chromium.launch({ headless:true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport:{width:1504,height:968} });
  await page.setContent(`<div id="root"></div><script>${script}</script>`);
  await page.evaluate(() => window.bootPipeline('studio'));
  const shell=page.locator('.riff-studio-shell');
  assert.equal(await shell.evaluate(node=>Math.round(node.getBoundingClientRect().width)),900);
  assert.equal(await page.locator('.riff-studio-player').evaluate(node=>{const b=node.getBoundingClientRect();return `${Math.round(b.width)}x${Math.round(b.height)}`;}),'240x427');
  assert.equal(await page.locator('.riff-studio-tab').evaluateAll(nodes=>nodes.map(node=>Math.round(node.getBoundingClientRect().height)).every(height=>height===36)),true);
  assert.equal(await page.locator('.riff-script-part').count(),4,'full view keeps two hook beats plus main and CTA');
  assert.ok(await page.locator('.riff-studio-reference').count() >= 2);

  const parts=[
    ['Full video','Your complete video','Explore videos','videos'],
    ['Hook','Your hook','Explore hooks','hooks'],
    ['Main content','Your main content','Explore main content','showcases'],
    ['CTA','Your call to action','Explore CTAs','ctas'],
  ];
  for(const [tab,title,explore,selectedLibrary] of parts){
    await page.evaluate(() => window.bootPipeline('studio'));
    await page.getByRole('tab',{name:tab,exact:true}).click();
    assert.equal(await page.getByRole('heading',{name:title,exact:true}).count(),1);
    assert.match(await page.locator('.riff-studio-player__time').textContent(),/\d:\d{2} \/ \d:\d{2}/);
    await page.getByRole('button',{name:explore,exact:true}).click();
    assert.equal(await page.getByRole('tab',{name:selectedLibrary==='videos'?'Videos':selectedLibrary==='hooks'?'Hooks':selectedLibrary==='showcases'?'Product showcases':'CTAs'}).getAttribute('aria-selected'),'true');
    assert.equal(await page.evaluate(()=>window.events.filter(event=>event.kind==='work-state').length),0,'part exploration does not persist a replacement');
  }

  await page.evaluate(() => window.bootPipeline('studio-three'));
  assert.equal(await page.getByRole('radio').count(),3);
  const firstVariant=page.getByRole('radio').first(); await firstVariant.focus(); await page.keyboard.press('End');
  assert.equal(await page.getByRole('radio').last().getAttribute('aria-checked'),'true');
  assert.equal(await page.getByRole('radio').last().evaluate(node=>node===document.activeElement),true);

  await page.evaluate(() => window.bootPipeline('studio'));
  await page.getByRole('button',{name:'Reels'}).click();
  assert.equal(await page.getByRole('button',{name:'Reels'}).getAttribute('aria-pressed'),'true');
  assert.match(await page.locator('.riff-pipeline__status').textContent(),/local format guidance.*not saved or published/i);
  assert.equal(await page.evaluate(()=>window.events.length),0,'local TikTok/Reels guidance never calls a provider or write');

  await page.getByRole('button',{name:'Save for later'}).click();
  await page.getByRole('heading',{name:'Your viral script, saved.'}).waitFor();
  const saved=page.locator('.riff-saved-confirmation');
  assert.deepEqual(await boxSummary(saved),{width:576,height:170,padding:'24px',radius:'18px',gap:'12px'});
  assert.deepEqual(await saved.locator('.riff-button').evaluateAll(nodes=>nodes.map(node=>({height:Math.round(node.getBoundingClientRect().height),whiteSpace:getComputedStyle(node).whiteSpace}))),
    [{height:44,whiteSpace:'nowrap'},{height:44,whiteSpace:'nowrap'}]);
  await saved.getByRole('button',{name:'Open vault'}).click();
  assert.equal(await page.evaluate(()=>window.events.at(-1).kind),'open-vault');
  await saved.getByRole('button',{name:'Undo save'}).focus(); await page.keyboard.press('Enter');
  await page.getByRole('button',{name:'Save for later'}).waitFor();
  assert.equal(await page.evaluate(()=>window.events.filter(event=>event.kind==='work-state').map(event=>event.state).join(',')),'saved,active');
  await page.getByRole('button',{name:'I filmed it'}).focus(); await page.keyboard.press('Space');
  await page.getByText('Marked as filmed in Riff.',{exact:true}).waitFor();

  await page.evaluate(() => window.bootPipeline('saved'));
  assert.equal(await page.getByRole('heading',{name:'Your viral script, saved.'}).count(),1,'receipt-backed saved state resumes directly');
  await page.evaluate(() => window.bootPipeline('filmed'));
  assert.equal(await page.getByText('Marked as filmed in Riff.',{exact:true}).count(),1);
  await page.evaluate(() => window.bootPipeline('studio-legacy'));
  assert.ok(await page.locator('.riff-filming-tip--legacy').count() >= 1,'legacy scripts fall back to script-level references and guidance');
  await page.evaluate(() => window.bootPipeline('studio-missing'));
  assert.equal(await page.getByRole('button',{name:'Copy caption'}).count(),0,'absent optional caption controls are omitted');
  assert.equal(await page.evaluate(()=>window.external.length),0);
});

test('active, saved, filmed, replay, stale, and foreign work-state fixtures drive only receipt-backed UI', async t => {
  const script=await browserBundle();
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1200,height:900}});
  await page.setContent(`<div id="root"></div><script>${script}</script>`);

  await page.evaluate(()=>window.bootPipeline('studio'));
  await page.getByRole('button',{name:'Save for later'}).click();
  assert.equal(await page.evaluate(()=>window.events.at(-1).outcome),'normal');
  assert.deepEqual(await page.evaluate(()=>window.lastWorkJob.work_states.find(item=>item.state==='saved')),
    riffCoreWorkflowFixtures.workState.saved.value);
  await page.getByRole('button',{name:'Undo save'}).click();
  assert.equal(await page.evaluate(()=>window.events.at(-1).outcome),'normal');
  assert.deepEqual(await page.evaluate(()=>window.lastWorkJob.work_states.find(item=>item.state==='active')),
    riffCoreWorkflowFixtures.workState.active.value);

  await page.evaluate(()=>window.bootPipeline('studio'));
  await page.getByRole('button',{name:'I filmed it'}).click();
  assert.equal(await page.evaluate(()=>window.events.at(-1).outcome),'normal');
  assert.deepEqual(await page.evaluate(()=>window.lastWorkJob.work_states.find(item=>item.state==='filmed')),
    riffCoreWorkflowFixtures.workState.filmed.value);
  assert.equal(await page.getByText('Marked as filmed in Riff.',{exact:true}).count(),1);

  await page.evaluate(()=>window.bootPipeline('studio','replay'));
  await page.getByRole('button',{name:'Save for later'}).click();
  assert.equal(await page.evaluate(()=>window.events.at(-1).outcome),'replay');
  assert.equal(await page.getByRole('heading',{name:'Your viral script, saved.'}).count(),1);
  assert.match(await page.getByRole('status').textContent(),/Exact replay confirmed/);
  assert.deepEqual(await page.evaluate(()=>window.lastWorkJob.work_states.find(item=>item.state==='saved')),
    riffCoreWorkflowFixtures.workState.replay.value);

  await page.evaluate(()=>window.bootPipeline('studio','stale'));
  await page.getByRole('button',{name:'Save for later'}).click();
  assert.equal(await page.evaluate(()=>window.events.at(-1).outcome),'stale');
  assert.equal(await page.getByRole('heading',{name:'Your viral script, saved.'}).count(),1);
  assert.match(await page.getByRole('status').textContent(),/changed elsewhere/i);
  assert.equal(riffCoreWorkflowFixtures.workState.stale.value.code,'VERSION_CONFLICT');

  await page.evaluate(()=>window.bootPipeline('studio','foreign'));
  await page.getByRole('button',{name:'Save for later'}).click();
  assert.equal(await page.evaluate(()=>window.events.at(-1).outcome),'foreign');
  assert.equal(await page.getByRole('heading',{name:'Your script, ready to film.'}).count(),1);
  assert.equal(await page.getByRole('heading',{name:'Your viral script, saved.'}).count(),0);
  assert.match(await page.locator('.riff-pipeline__status').textContent(),/not found for this account/i);
  assert.equal(riffCoreWorkflowFixtures.workState.foreign.value.code,'NOT_FOUND');
  assert.equal(await page.evaluate(()=>window.external.length),0);
});

test('Hostile, malformed, timeout, late, and account-switch inputs fail closed without stale private UI or browser I/O', async t => {
  const script=await browserBundle();
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:320,height:812}});
  await page.setContent(`<div id="root"></div><script>${script}</script>`);

  await page.evaluate(()=>window.bootMenu('instagram',true));
  await page.getByRole('button',{name:'Open Riff menu'}).focus();await page.keyboard.press('Enter');
  assert.match(await page.locator('.riff-menu__recent-title').textContent(),/<img src=x onerror=/);
  assert.match(await page.locator('.riff-menu__recent-title').textContent(),/UnbrokenHostileValueUnbrokenHostileValue/);
  assert.equal(await page.locator('.riff-menu__recent img').count(),0,'javascript: thumbnails are rejected rather than assigned');
  assert.equal(await page.evaluate(()=>window.imageSources.some(source=>source.startsWith('javascript:'))),false);
  assert.equal(await page.evaluate(()=>window.__riffExecuted),false);
  await page.getByRole('button',{name:'Authored Creator A account menu'}).click();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('menu',{name:'Account'}).isHidden(),true);
  assert.equal(await page.getByRole('dialog',{name:'Riff menu'}).isVisible(),true);
  await page.evaluate(()=>window.replaceMenuAccount());
  assert.equal(await page.getByRole('dialog',{name:'Riff menu'}).isHidden(),true);
  await page.getByRole('button',{name:'Open Riff menu'}).click();
  assert.equal(await page.locator('.riff-menu__recent').count(),0,'account B never inherits account A recents');
  await page.keyboard.press('Escape');

  assert.deepEqual(await page.evaluate(()=>window.parseHome({ok:true,data:{account:{id:'injected'},unknown:true}})),
    {status:'error',message:'Riff returned incomplete account details. Reopen Home.'});
  assert.deepEqual(await page.evaluate(()=>window.parseHome(window.__missingMarkerInput={ok:true,data:{account:{id:'00000000-0000-4000-8000-000000000001',display_name:'Authored Creator A',state:'active',preferred_language:'en',created_at:'2026-10-11T12:00:00Z'},entitlements:{status:'not_configured'},usage:{status:'not_configured',reset_at:null}}})),
    riffCoreWorkflowFixtures.accounts.malformedMarker.value.result);
  assert.equal(await page.evaluate(value=>window.parseCatalog(value)?.ok??false,{content:[],structuredContent:{ok:true,data:riffCoreWorkflowFixtures.catalog.one.value.page},isError:false,_meta:{}}),true);
  await page.evaluate(()=>window.bootAsyncHome());
  const input=page.getByRole('textbox',{name:'Your next video starts here'});
  await input.fill('https://www.tiktok.com/@fixture/video/9000000000000000001');
  await page.getByRole('button',{name:'Find my next idea'}).click();
  assert.match(await page.getByRole('status').textContent(),/Starting your Riff analysis/);
  assert.equal(await page.evaluate(()=>window.pending.length),1);
  await page.evaluate(()=>window.switchAsyncHomeAccount());
  await page.evaluate(()=>window.pending[0].resolve({status:'sent',message:'LATE PRIVATE SUCCESS MUST NOT RENDER'}));
  await page.waitForTimeout(0);
  assert.doesNotMatch(await page.locator('body').textContent(),/LATE PRIVATE SUCCESS/);
  assert.equal(await page.locator('.riff-home__account').textContent(),'Ready, Authored Creator B');

  await page.evaluate(()=>window.bootTimeoutHome());
  const timeoutInput=page.getByRole('textbox',{name:'Your next video starts here'});
  await timeoutInput.fill('https://www.tiktok.com/@fixture/video/9000000000000000002');
  await page.getByRole('button',{name:'Find my next idea'}).click();
  assert.match(await page.getByRole('status').textContent(),/Starting your Riff analysis/);
  await page.getByText(/could not confirm whether this analysis started/i).waitFor();
  assert.equal(await page.getByRole('button',{name:'Find my next idea'}).isEnabled(),true);
  assert.equal(await page.evaluate(()=>window.events.at(-1).fixture),riffCoreWorkflowFixtures.host.timeout.fixture_id);

  await page.evaluate(()=>window.bootPipeline('hostile'));
  assert.match(await page.locator('.riff-pipeline__content').textContent(),/<img src=x onerror=/);
  assert.equal(await page.locator('.riff-pipeline__content img').count(),0);
  assert.equal(await page.evaluate(()=>window.__riffExecuted),false);
  await noDocumentOverflow(page);
  await assertSafeImages(page);
  assert.equal(await page.evaluate(()=>window.external.length),0);
  assert.doesNotMatch(await page.locator('.riff-pipeline__content').textContent(),/Bearer should-never-render|service[_ -]?role|postgres(?:ql)?:\/\//i);
});

test('Every major Riff-owned surface stays reachable without horizontal overflow at 320/375/768/1440', async t=>{
  const script=await browserBundle();const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:320,height:812}});await page.setContent(`<div id="root"></div><script>${script}</script>`);
  for(const viewport of [{width:320,height:812},{width:375,height:812},{width:768,height:1024},{width:1440,height:900}]){
    await page.setViewportSize(viewport);
    const routes=[
      ['onboarding',async()=>page.evaluate(()=>window.bootOnboarding())],
      ['home-empty',async()=>page.evaluate(()=>window.bootHome('returning','empty'))],
      ['home-loading',async()=>page.evaluate(()=>window.bootHome('returning','loading'))],
      ['home-error',async()=>page.evaluate(()=>window.bootHome('returning','error'))],
      ['home-recents',async()=>page.evaluate(()=>window.bootHome('returning','recents'))],
      ['menu',async()=>{await page.evaluate(()=>window.bootMenu('instagram'));await page.getByRole('button',{name:'Open Riff menu'}).click();}],
      ['account-dropdown',async()=>{await page.evaluate(()=>window.bootMenu('instagram'));await page.getByRole('button',{name:'Open Riff menu'}).click();await page.getByRole('button',{name:'Authored Creator A account menu'}).click();}],
      ['fetch',async()=>page.evaluate(()=>window.bootPipeline('fetch'))],
      ['analyze',async()=>page.evaluate(()=>window.bootPipeline('analyze'))],
      ['profile-loading',async()=>page.evaluate(()=>window.bootPipeline('profile-loading'))],
      ['product-loading',async()=>page.evaluate(()=>window.bootProduct('draft','saved'))],
      ['discovery-loading',async()=>page.evaluate(()=>window.bootPipeline('discovery-loading'))],
      ['partial',async()=>page.evaluate(()=>window.bootPipeline('partial'))],
      ['video',async()=>page.evaluate(()=>window.bootPipeline('video'))],
      ['tiktok',async()=>page.evaluate(()=>window.bootPipeline('tiktok'))],
      ['instagram',async()=>page.evaluate(()=>window.bootPipeline('instagram'))],
      ['product',async()=>{await page.evaluate(()=>window.bootProduct('saved','saved'));}],
      ...['Videos','Hooks','Product showcases','CTAs'].map(label=>[`discovery-${label}`,async()=>{await page.evaluate(()=>window.bootPipeline('discovery'));await page.getByRole('tab',{name:label,exact:true}).click();}]),
      ...['loading','empty','error','one','five','eight'].map(state=>[`catalog-${state}`,async()=>page.evaluate(value=>window.bootPipeline('catalog-'+value),state)]),
      ...['Full video','Hook','Main content','CTA'].map(label=>[`studio-${label}`,async()=>{await page.evaluate(()=>window.bootPipeline('studio'));await page.getByRole('tab',{name:label,exact:true}).click();}]),
      ['filmed',async()=>page.evaluate(()=>window.bootPipeline('filmed'))],
      ['saved',async()=>page.evaluate(()=>window.bootPipeline('saved'))],
    ];
    for(const [name,route] of routes){await route();const fit=await page.evaluate(()=>({fits:document.documentElement.scrollWidth<=document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,widest:[...document.querySelectorAll('*')].map(node=>({tag:node.tagName,cls:node.className?.toString?.()??'',right:node.getBoundingClientRect().right,width:node.getBoundingClientRect().width})).filter(item=>item.right>document.documentElement.clientWidth+1).sort((a,b)=>b.right-a.right).slice(0,3)}));assert.equal(fit.fits,true,`${name} overflows at ${viewport.width}px: ${JSON.stringify(fit)}`);await assertNamedNativeControls(page);if(viewport.width===320){await assertActiveControlsWithinViewport(page);const dialog=page.locator('[role="dialog"]:visible');const scope=await dialog.count()?dialog:page;const first=scope.locator('button:not([disabled]):visible,a[href]:visible,input:visible,textarea:visible').first();if(await first.count()){await first.focus();assert.equal(await first.evaluate(node=>node===document.activeElement),true,`${name} retains a keyboard focus target at 320px`);}}}
    await assertSafeImages(page);
    assert.equal(await page.evaluate(()=>window.external.length),0);
  }
});

test('integrated Riff-owned CURRENT routes retain Paper geometry, semantics, keyboard paths, and safe requests', async t => {
  const script = await browserBundle();
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const requests = [];
  page.on('request', request => { if (!request.url().startsWith('data:') && request.url() !== 'about:blank') requests.push(request.url()); });
  await page.setContent(`<div id="root"></div><script>${script}</script>`);

  await page.evaluate(() => window.bootOnboarding());
  const card = page.locator('.riff-onboarding__card');
  assert.deepEqual(await card.evaluate(node => { const s=getComputedStyle(node);return {width:s.width,padding:s.padding,radius:s.borderRadius,gap:s.gap}; }),
    {width:'576px',padding:'28px 24px 24px',radius:'24px',gap:'22px'});
  assert.equal(await page.locator('.riff-onboarding__carousel').evaluate(node => getComputedStyle(node).width), '526px');
  assert.equal(await page.getByRole('heading', { name: 'Welcome to Riff' }).count(), 1);
  assert.equal(await page.getByText('Unlock your viral potential.', { exact: true }).count(), 1);
  await page.getByRole('tab', { name: 'Show Start step' }).focus();
  await page.keyboard.press('End');
  assert.equal(await page.getByRole('tab', { name: 'Show Make step' }).getAttribute('aria-selected'), 'true');

  await page.evaluate(() => window.bootHome('first'));
  assert.equal(await page.getByRole('heading', { name: 'Let’s make your next video go viral.' }).count(), 1);
  assert.equal(await page.getByRole('heading', { name: 'Pick up where you left off' }).isHidden(), true);
  await page.evaluate(() => window.bootHome('returning'));
  assert.equal(await page.getByRole('button', { name: /Open Authored recent/ }).count(), 4);
  const home = page.locator('.riff-home__home');
  assert.deepEqual(await home.evaluate(node => {const s=getComputedStyle(node);return {gap:s.gap,radius:s.borderRadius,paddingTop:s.paddingTop,paddingBottom:s.paddingBottom};}),
    {gap:'20px',radius:'0px 0px 24px 24px',paddingTop:'28px',paddingBottom:'40px'});
  const input = page.getByRole('textbox', { name: 'Your next video starts here' });
  await input.fill('A fixture-only desk light description');
  await page.keyboard.press('Control+Enter');
  await page.getByRole('button', { name: 'Product description' }).click();
  await page.getByRole('heading', { name: 'Give your product viral potential.' }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Give your product viral potential.' }).count(), 1);

  await page.evaluate(() => window.bootMenu('instagram'));
  await page.getByRole('button', { name: 'Open Riff menu' }).click();
  assert.equal(await page.getByRole('dialog', { name: 'Riff menu' }).evaluate(node => getComputedStyle(node).width), '288px');
  assert.equal(await page.locator('.riff-menu__platform[data-platform="instagram"]').count(), 1,
    'Instagram recent work carries the Paper platform badge instead of TikTok-only chrome');
  assert.equal(await page.locator('.riff-menu__platform[data-platform="instagram"]').evaluate(node => {
    const box=node.getBoundingClientRect();const drawer=node.closest('.riff-menu__drawer').getBoundingClientRect();
    return box.width>0&&box.height>0&&box.left>=drawer.left&&box.right<=drawer.right&&getComputedStyle(node).visibility==='visible';
  }), true, 'the Instagram badge is not clipped by the thumbnail frame');
  await page.getByRole('button', { name: 'Authored Creator A account menu' }).click();
  assert.equal(await page.getByRole('menu', { name: 'Account' }).evaluate(node => getComputedStyle(node).width), '256px');
  await page.keyboard.press('End');
  assert.equal(await page.getByRole('menuitem', { name: 'Give feedback' }).evaluate(node => node === document.activeElement), true);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');

  const pending = [
    ['fetch','Fetching your video'], ['analyze','Analyzing your video'],
    ['profile-loading','Getting to know your profile'], ['discovery-loading','Finding videos for your next idea'],
  ];
  for (const [state, heading] of pending) {
    await page.evaluate(value => window.bootPipeline(value), state);
    assert.equal(await page.getByRole('heading', { name: heading }).count(), 1);
    const loading = page.locator('.riff-loading-card');
    assert.equal(await loading.evaluate(node => getComputedStyle(node).width), '540px');
    assert.equal(await loading.evaluate(node => getComputedStyle(node).borderRadius), '20px');
  }

  for (const [state, heading] of [
    ['partial','We could read the words, not the visuals.'],
    ['video','Unlock your video’s viral potential.'],
    ['tiktok','Turn what’s working into your next breakout.'],
    ['instagram','Turn your best results into more reach.'],
  ]) {
    await page.evaluate(value => window.bootPipeline(value), state);
    assert.equal(await page.getByRole('heading', { name: heading }).count(), 1, state);
  }
  await page.evaluate(() => window.bootPipeline('instagram'));
  assert.match(await page.locator('.riff-pipeline__content').textContent(), /Instagram|Reels/);

  await page.evaluate(() => window.bootPipeline('discovery'));
  for (const name of ['Videos','Hooks','Product showcases','CTAs']) {
    const tab = page.getByRole('tab', { name }); assert.equal(await tab.count(), 1); await tab.click();
  }
  await page.keyboard.press('Home');
  assert.equal(await page.getByRole('tab', { name: 'Videos' }).evaluate(node => node === document.activeElement), true);

  for (const catalog of ['loading','empty','error','one','five','eight']) {
    await page.evaluate(value => window.bootPipeline(`catalog-${value}`), catalog);
    assert.equal(await page.locator('.riff-paper--discovery').count(), 1, catalog);
  }

  await page.evaluate(() => window.bootPipeline('studio'));
  for (const name of ['Full video','Hook','Main content','CTA']) {
    const tab = page.getByRole('tab', { name }); assert.equal(await tab.count(), 1); await tab.click();
  }
  assert.equal(await page.getByRole('button', { name: 'Save for later' }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'I filmed it' }).count(), 1);

  for (const viewport of [{width:320,height:812},{width:375,height:812},{width:768,height:1024},{width:1440,height:900}]) {
    await page.setViewportSize(viewport); await page.evaluate(() => window.bootPipeline('studio'));
    await noDocumentOverflow(page); await assertNamedNativeControls(page);
  }
  assert.equal(await page.evaluate(() => window.__riffExecuted), false);
  assert.equal(requests.length, 0, `static fixtures made external requests: ${requests.join(', ')}`);
  assert.doesNotMatch(await page.locator('.riff-pipeline__content').textContent(), /Bearer |service[_ -]?role|postgres(?:ql)?:\/\//i);
});

test('key CURRENT routes retain semantics, boundaries, focus, and unclipped controls in dark, forced, reduced, and 200% text modes', async t => {
  const script = await browserBundle();
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  for (const mode of ['reduced', 'dark', 'forced', 'text'] ) {
    const page = await browser.newPage({ viewport: { width: mode === 'dark' ? 1440 : 320, height: 900 } });
    if (mode === 'reduced') await page.emulateMedia({ reducedMotion: 'reduce' });
    if (mode === 'forced') await page.emulateMedia({ forcedColors: 'active' });
    await page.setContent(`<div id="root"></div><script>${script}</script>`);
    if (mode === 'dark') await page.evaluate(() => {
      document.documentElement.dataset.theme='dark';
      document.documentElement.style.setProperty('--color-background-primary','#101318');
      document.documentElement.style.setProperty('--color-text-primary','#f6f7f9');
      document.documentElement.style.setProperty('--color-background-secondary','#181d25');
      document.documentElement.style.setProperty('--color-border-secondary','#596273');
    });
    if (mode === 'text') await page.evaluate(() => {
      const style=document.createElement('style');style.id='task8-text-200';
      style.textContent='.riff-app :is(h1,h2,h3,p,label,legend,strong,small):not(:has(*)),.riff-app :is(button,a):not(:has(span)),.riff-app span:not(:has(*)),.riff-app :is(input,textarea){font-size:200%!important;line-height:1.5!important}';
      document.head.append(style);
    });
    const routes = [
      ['home', async()=>page.evaluate(()=>window.bootHome('returning','recents'))],
      ['menu', async()=>{await page.evaluate(()=>window.bootMenu('instagram'));await page.getByRole('button',{name:'Open Riff menu'}).click();}],
      ['loading', async()=>page.evaluate(()=>window.bootPipeline('fetch'))],
      ['analysis', async()=>page.evaluate(()=>window.bootPipeline('video'))],
      ['product', async()=>{await page.evaluate(()=>window.bootProduct('saved','saved'));await page.evaluate(()=>window.advanceProduct());}],
      ['discovery', async()=>page.evaluate(()=>window.bootPipeline('discovery'))],
      ['studio', async()=>page.evaluate(()=>window.bootPipeline('studio'))],
      ['saved', async()=>page.evaluate(()=>window.bootPipeline('saved'))],
    ];
    for (const [route, mount] of routes) {
      await mount();
      const fit=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,
        widest:[...document.querySelectorAll('*')].map(node=>{const box=node.getBoundingClientRect();return {tag:node.tagName,cls:node.className?.toString?.()??'',left:box.left,right:box.right,width:box.width}}).filter(item=>item.left < -1 || item.right > document.documentElement.clientWidth+1).sort((a,b)=>b.width-a.width).slice(0,5)}));
      assert.equal(fit.scroll<=fit.client,true,`${mode}/${route} overflows: ${JSON.stringify(fit)}`);
      await assertNamedNativeControls(page);
      await assertActiveControlsWithinViewport(page);
      assert.ok(await page.locator('h1,[role="dialog"]').count(), `${mode}/${route} keeps a semantic route landmark`);
      const dialog=page.locator('[role="dialog"]:visible');const scope=await dialog.count()?dialog:page;
      const first = scope.locator('button:not([disabled]):visible,a[href]:visible,input:visible,textarea:visible').first();
      if (await first.count()) { await first.focus(); assert.equal(await first.evaluate(node=>node===document.activeElement),true,`${mode}/${route} keeps visible focus`); }
      if (mode === 'text') {
        const clippedText = await page.locator('button:visible').evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1).map(node => node.getAttribute('aria-label') || node.textContent?.trim()));
        assert.deepEqual(clippedText, [], `200% text clips controls on ${route}`);
        const clippedFields = await page.locator('input:visible,textarea:visible').evaluateAll(nodes => nodes.filter(node => {
          const lineHeight = Number.parseFloat(getComputedStyle(node).lineHeight);
          return Number.isFinite(lineHeight) && node.clientHeight + 1 < lineHeight;
        }).map(node => node.getAttribute('aria-label') || node.getAttribute('placeholder')));
        assert.deepEqual(clippedFields, [], `200% text clips fields on ${route}`);
      }
    }
    if (mode === 'reduced') {
      await page.evaluate(()=>window.bootPipeline('fetch'));
      assert.equal(await page.locator('.riff-loading-spinner').evaluate(node=>getComputedStyle(node).animationName),'none');
      assert.equal(await page.locator('.riff-progress').evaluate(node=>getComputedStyle(node,'::after').animationName),'none');
    }
    if (mode === 'forced') {
      await page.evaluate(()=>window.bootPipeline('studio'));
      assert.equal(await page.getByRole('tab',{name:'Full video'}).evaluate(node=>getComputedStyle(node).borderTopStyle),'solid');
      assert.ok(parseFloat(await page.getByRole('tab',{name:'Full video'}).evaluate(node=>getComputedStyle(node).borderTopWidth)) >= 2);
    }
    if (mode === 'dark') {
      await page.evaluate(()=>window.bootHome('returning','recents'));
      assert.deepEqual(await page.locator('.riff-home').evaluate(node=>({background:getComputedStyle(node).backgroundColor,color:getComputedStyle(node).color})),
        {background:'rgb(16, 19, 24)',color:'rgb(246, 247, 249)'});
      assert.deepEqual(await page.locator('.riff-home__input-shell').evaluate(node=>({background:getComputedStyle(node).backgroundColor,color:getComputedStyle(node).color})),
        {background:'rgb(24, 29, 37)',color:'rgb(246, 247, 249)'});
      await page.evaluate(()=>window.bootPipeline('studio'));
      assert.deepEqual(await page.locator('.riff-studio-shell').evaluate(node=>({background:getComputedStyle(node).backgroundColor,color:getComputedStyle(node).color})),
        {background:'rgb(36, 40, 50)',color:'rgb(244, 245, 247)'});
    }
    await assertSafeImages(page);
    assert.equal(await page.evaluate(()=>window.external.length),0);
    await page.close();
  }
});

test('the generated Home v4 resource and real bridge keep one root through Home, product, loading, analysis, Discovery, Studio, Saved, and resume', async t => {
  const { RIFF_HOME_DOCUMENT } = await import('../../apps/worker/riff-home-resource.ts');
  const scan = structuredClone(riffCoreWorkflowFixtures.scans.videoFull.value);
  scan.revision = 2;
  const running = structuredClone(scan);
  running.state = 'running'; running.stage = 'reviewing_video'; running.revision = 1;
  running.result = null; running.message = null; running.work_states = [];
  running.progress = { kind:'scan',profile:null,videos:[],limitations:[] };
  const status = {
    id: scan.id, kind: scan.kind, state:'succeeded', stage:'saving', revision:scan.revision,
    created_at:scan.created_at,updated_at:scan.updated_at,progress:scan.progress,terminal_result_available:true,
  };
  const recommendations = structuredClone(riffCoreWorkflowFixtures.recommendations.fourLibraries.value);
  recommendations.id = '00000000-0000-4000-8000-000000000630';
  const scripts = structuredClone(riffCoreWorkflowFixtures.scripts.segments.value);
  scripts.id = '00000000-0000-4000-8000-000000000640';
  const catalog = structuredClone(riffCoreWorkflowFixtures.catalog.one.value.page);
  const payload = JSON.stringify({ running, scan, status, recommendations, scripts, catalog }).replaceAll('<', '\\u003c');
  const account = {
    ok:true,data:{account:{
      id:'00000000-0000-4000-8000-000000000001',display_name:'Authored Resource Creator',state:'active',
      preferred_language:'en',created_at:'2026-10-11T12:00:00Z',onboarding_seen_at:'2026-10-11T12:00:00Z',
    },entitlements:{status:'not_configured'},usage:{status:'not_configured',reset_at:null}},
  };
  const accountPayload = JSON.stringify(account);
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    if (request.url === '/frame') return response.end(RIFF_HOME_DOCUMENT);
    response.end(`<!doctype html><script>
      const fixture=${payload};const account=${accountPayload};window.calls=[];window.messages=[];window.ready=false;window.workState=null;window.scriptJob=fixture.scripts;
      const frame=()=>document.querySelector('iframe').contentWindow;
      const respond=(id,structuredContent,isError=false)=>frame().postMessage({jsonrpc:'2.0',id,result:{content:[],structuredContent,isError,_meta:{}}},'*');
      const work=()=>[{job_id:window.scriptJob.id,project_name:'Authored Studio',kind:'scripts',state:'succeeded',updated_at:window.scriptJob.updated_at,
        source:{platform:'tiktok',handle:'authored.resource'},variant_id:window.workState?.variant_id??null,work_state:window.workState}];
      addEventListener('message',event=>{const message=event.data;
        if(message.method==='ui/initialize')return frame().postMessage({jsonrpc:'2.0',id:message.id,result:{protocolVersion:message.params.protocolVersion,
          hostInfo:{name:'task8-resource-host',version:'1'},hostCapabilities:{serverTools:{},experimental:{'openai/message':{}}},hostContext:{theme:'light',locale:'en'}}},'*');
        if(message.method==='ui/notifications/initialized'){
          frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{content:[],structuredContent:account,isError:false,_meta:{}}},'*');window.ready=true;return;
        }
        if(message.method==='ui/message'){window.messages.push(message.params);return frame().postMessage({jsonrpc:'2.0',id:message.id,result:{}},'*');}
        if(message.method!=='tools/call')return;
        const call=message.params;window.calls.push(structuredClone(call));
        if(call.name==='list_riff_work')return respond(message.id,{ok:true,data:{work:work()}});
        if(call.name==='save_project'){
          const args=call.arguments;const id='00000000-0000-4000-8000-000000000201';const now='2026-10-12T08:00:00Z';
          const project={id,name:args.name,project_type:'brand',current_version:args.expected_version+1,created_at:now,updated_at:now,
            brief_version:{id:'00000000-0000-4000-8000-000000000202',project_id:id,version:args.expected_version+1,name:args.name,brief:structuredClone(args.brief),created_at:now}};
          return respond(message.id,{ok:true,data:{project,request_id:args.request_id}});
        }
        if(call.name==='start_riff_creator')return respond(message.id,{ok:true,data:{job:fixture.running}});
        if(call.name==='get_creator_job_status')return setTimeout(()=>respond(message.id,{ok:true,data:{status:fixture.status}}),60);
        if(call.name==='get_creator_job')return respond(message.id,{ok:true,data:{job:call.arguments.job_id===fixture.scan.id?fixture.scan:window.scriptJob}});
        if(call.name==='start_creator_recommendations')return respond(message.id,{ok:true,data:{job:fixture.recommendations}});
        if(call.name==='list_riff_videos')return respond(message.id,{ok:true,data:fixture.catalog});
        if(call.name==='set_riff_work_state'){
          const args=call.arguments;window.workState={job_id:args.job_id,variant_id:args.variant_id,state:args.state,version:args.expected_version+1,updated_at:'2026-10-12T08:01:00Z'};
          window.scriptJob=structuredClone(window.scriptJob);window.scriptJob.work_states=window.scriptJob.work_states.filter(item=>item.variant_id.toLowerCase()!==args.variant_id.toLowerCase());window.scriptJob.work_states.push(window.workState);
          return respond(message.id,{ok:true,data:{work_state:window.workState}});
        }
        return respond(message.id,{ok:false,error:{code:'NOT_FOUND',message:'Authored missing tool.',retryable:false,recovery:'reload'}},true);
      });
    </script><iframe src="/frame" style="width:100%;height:1000px;border:0"></iframe>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({ headless:true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport:{width:1440,height:1000} }); page.setDefaultTimeout(12_000);
  await page.addInitScript(() => {
    window.__task8ImageSources=[];
    const descriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
    Object.defineProperty(HTMLImageElement.prototype,'src',{configurable:true,enumerable:descriptor.enumerable,get(){return descriptor.get.call(this)},set(value){window.__task8ImageSources.push(String(value));descriptor.set.call(this,value)}});
  });
  const network=[];page.on('request',request=>network.push(request.url()));
  const base=`http://127.0.0.1:${server.address().port}`;
  await page.goto(base); await page.waitForFunction(()=>window.ready);
  const frame=page.frames().find(candidate=>candidate.url().endsWith('/frame'));
  await frame.waitForFunction(()=>document.querySelector('.riff-home__account')?.textContent?.includes('Authored Resource Creator'));
  await frame.evaluate(()=>{window.__task8Root=document.getElementById('root')});

  const input=frame.getByRole('textbox',{name:'Your next video starts here'});
  await input.fill('A fixture-only adjustable light for a small desk.');await input.press('Control+Enter');
  await frame.evaluate(()=>{
    window.__task8NativeRaf=window.requestAnimationFrame.bind(window);window.__task8ProductFrames=[];
    window.requestAnimationFrame=callback=>{window.__task8ProductFrames.push(callback);return window.__task8ProductFrames.length};
  });
  await frame.getByRole('button',{name:'Product description'}).click();
  await frame.getByRole('heading',{name:'Understanding your product'}).waitFor();
  await frame.evaluate(()=>{const callbacks=window.__task8ProductFrames.splice(0);window.requestAnimationFrame=window.__task8NativeRaf;callbacks.forEach(callback=>callback(performance.now()))});
  await frame.getByRole('heading',{name:'Give your product viral potential.'}).waitFor();
  await frame.getByLabel('Product',{exact:true}).fill('Authored desk light');
  await frame.getByLabel('Audience',{exact:true}).fill('People working at compact desks');
  await frame.getByLabel('Main benefit',{exact:true}).fill('Show the visible before and after');
  await frame.getByLabel('Content style',{exact:true}).fill('Warm and practical');
  await frame.getByLabel('Language',{exact:true}).fill('English');
  await frame.getByLabel('Duration in seconds',{exact:true}).fill('22');
  await frame.getByRole('button',{name:'Confirm context'}).click();await frame.getByText('Context saved',{exact:true}).waitFor();
  await frame.getByRole('button',{name:'Discover formats'}).click();await page.waitForFunction(()=>window.messages.length===1);
  assert.match(await page.evaluate(()=>window.messages[0].content[0].text),/user-confirmed project context.*No Creator DNA.*do not start provider work/i);

  await frame.getByRole('button',{name:'Open Riff menu'}).click();await frame.getByRole('dialog',{name:'Riff menu'}).getByRole('button',{name:'Home',exact:true}).click();
  const source='https://www.tiktok.com/@fixture/video/9000000000000000001';await input.fill(source);await input.press('Control+Enter');
  await frame.getByRole('heading',{name:'Fetching your video'}).waitFor();
  await frame.getByRole('heading',{name:'Unlock your video’s viral potential.'}).waitFor();
  await frame.getByRole('button',{name:'Explore viral formats'}).click();
  await frame.getByRole('heading',{name:'Find your next breakout idea.'}).waitFor();
  await frame.getByRole('button',{name:'Make it mine'}).click();await page.waitForFunction(()=>window.messages.length===2);
  await frame.getByRole('button',{name:'Open Riff menu'}).click();await frame.getByRole('dialog',{name:'Riff menu'}).getByRole('button',{name:'Home',exact:true}).click();
  await frame.getByRole('button',{name:/Open Authored Studio/}).click();
  await frame.getByRole('heading',{name:'Your script, ready to film.'}).waitFor();
  await frame.getByRole('button',{name:'Save for later'}).click();
  await frame.getByRole('heading',{name:'Your viral script, saved.'}).waitFor();
  await frame.getByRole('button',{name:'Open vault'}).click();
  await frame.getByRole('heading',{name:'Let’s make your next video go viral.'}).waitFor();
  assert.match(await frame.evaluate(()=>document.activeElement?.getAttribute('aria-label')??''),/Open Authored Studio/);
  await frame.getByRole('button',{name:/Open Authored Studio/}).click();
  await frame.getByRole('heading',{name:'Your viral script, saved.'}).waitFor();

  assert.equal(await frame.evaluate(()=>document.getElementById('root')===window.__task8Root),true,'the resource bridge preserves one root element for the complete route');
  assert.equal(await frame.locator('#root').count(),1);
  assert.deepEqual(await page.evaluate(()=>window.calls.filter(call=>['save_project','start_riff_creator','start_creator_recommendations','set_riff_work_state'].includes(call.name)).map(call=>call.name)),
    ['save_project','start_riff_creator','start_creator_recommendations','set_riff_work_state']);
  assert.equal(await page.evaluate(()=>window.calls.some(call=>Object.hasOwn(call.arguments??{},'account_id'))),false);
  assert.equal(await page.evaluate(()=>window.calls.find(call=>call.name==='list_riff_videos').arguments.role),'discovered_reference');
  assert.match(await frame.locator('meta[name="riff-bundle-version"]').getAttribute('data-resource-version'),/^riff-home-v4$/);
  assert.equal(await frame.evaluate(()=>window.__task8ImageSources.some(source=>/^javascript:|^https?:\/\/(?![^/]*(?:tiktokcdn\.com|tiktokcdn-us\.com))/i.test(source))),false);
  assert.deepEqual(network.filter(url=>!url.startsWith(base)&&url!=='about:blank'),[]);
  assert.doesNotMatch(await frame.locator('body').textContent(),/Bearer |service[_ -]?role|postgres(?:ql)?:\/\//i);
});
