import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const account = { id: '00000000-0000-4000-8000-000000000001', name: 'Verified Creator' };
const recent = {
  id: '00000000-0000-4000-8000-000000000101',
  title: 'Verified project',
  stage: 'Analysis',
  platform: 'tiktok',
};

test('shared Riff menu matches Paper geometry and keeps every row actionable', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffMenu } from './apps/panel/riff-shell/menu.ts';
    window.events=[];
    window.menu=mountRiffMenu(document.getElementById('menu-host'), {
      account:${JSON.stringify(account)}, recents:[${JSON.stringify(recent)}], activeRoute:'discover',
      onNavigate:route=>window.events.push({kind:'navigate',route}),
      onOpenRecent:item=>window.events.push({kind:'recent',id:item.id}),
      onCreate:()=>window.events.push({kind:'create'}),
      onClose:()=>window.events.push({kind:'close'}),
      onAccountSettings:()=>{window.events.push({kind:'account'});return {status:'sent',message:'Account settings opened in ChatGPT.'};},
      onSupport:()=>{window.events.push({kind:'support'});return {status:'sent',message:'Support opened in ChatGPT.'};},
      onFeedback:()=>{window.events.push({kind:'feedback'});return {status:'sent',message:'Feedback opened in ChatGPT.'};},
      onRequestTheme:()=>{window.events.push({kind:'theme'});return {status:'unsupported',message:'Choose your theme in ChatGPT settings. Riff follows the host theme.'};},
    });
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 920, height: 792 } });
  await page.setContent(`<div id="host-owned">ChatGPT composer</div><main class="riff-app riff-menu-scope" style="position:relative;min-height:768px"><header><span id="menu-host"></span></header><section id="riff-owned">Riff content</section></main><script>${bundle.outputFiles[0].text}</script>`);

  const trigger = page.getByRole('button', { name: 'Open Riff menu' });
  await trigger.focus();
  await trigger.click();
  const drawer = page.getByRole('dialog', { name: 'Riff menu' });
  assert.equal(await drawer.evaluate(node => getComputedStyle(node).width), '288px');
  assert.equal(await page.locator('.riff-menu__backdrop').count(), 1);
  assert.equal(await page.locator('#host-owned .riff-menu__backdrop').count(), 0,
    'the backdrop stays inside Riff-owned panel content');
  assert.equal(await page.getByRole('navigation', { name: 'Riff navigation' }).count(), 1);
  assert.equal(await page.getByRole('button', { name: /Verified project/ }).count(), 1);
  assert.equal(await page.getByText(/10 (?:runs|analysis) left/i).count(), 0);
  assert.equal(await page.getByText('Usage unavailable').count(), 1);
  assert.equal(await page.locator('.riff-menu__nav-button[aria-current="page"]').textContent(), 'Discover videos');
  assert.equal(await page.locator('.riff-menu__account-name').textContent(), 'Riff',
    'the Paper trigger keeps the visible Riff product name');
  assert.equal(await page.getByRole('button', { name: 'Verified Creator account menu' }).count(), 1,
    'the account identity remains available to assistive technology');
  assert.equal(await page.evaluate(() => document.querySelector('[role="dialog"]').contains(document.activeElement)), true,
    'opening the drawer moves focus inside it');
  await page.getByRole('button', { name: 'Create a video' }).focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.getByRole('button', { name: 'Verified Creator account menu' }).evaluate(node => node === document.activeElement), true,
    'Tab stays contained within the drawer');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.getByRole('button', { name: 'Create a video' }).evaluate(node => node === document.activeElement), true,
    'Shift+Tab stays contained within the drawer');

  await page.getByRole('button', { name: 'Verified Creator account menu' }).click();
  const accountMenu = page.getByRole('menu', { name: 'Account' });
  assert.equal(await accountMenu.evaluate(node => getComputedStyle(node).width), '256px');
  for (const label of ['Account settings', 'Dark mode', 'Support', 'Give feedback']) {
    assert.equal(await accountMenu.getByRole('menuitem', { name: label, exact: true }).count(), 1);
  }
  await page.keyboard.press('ArrowDown');
  assert.equal(await accountMenu.getByRole('menuitem', { name: 'Account settings', exact: true }).evaluate(node => node === document.activeElement), true);
  await page.keyboard.press('ArrowUp');
  assert.equal(await accountMenu.getByRole('menuitem', { name: 'Home', exact: true }).evaluate(node => node === document.activeElement), true);
  await page.keyboard.press('End');
  assert.equal(await accountMenu.getByRole('menuitem', { name: 'Give feedback', exact: true }).evaluate(node => node === document.activeElement), true);
  await page.keyboard.press('Home');
  assert.equal(await accountMenu.getByRole('menuitem', { name: 'Home', exact: true }).evaluate(node => node === document.activeElement), true);
  await accountMenu.getByRole('menuitem', { name: 'Account settings', exact: true }).click();
  await accountMenu.getByRole('menuitem', { name: 'Dark mode', exact: true }).click();
  assert.match(await page.getByRole('status').textContent(), /follows the host theme/i);
  await accountMenu.getByRole('menuitem', { name: 'Support', exact: true }).click();
  await accountMenu.getByRole('menuitem', { name: 'Give feedback', exact: true }).click();
  assert.deepEqual((await page.evaluate(() => window.events.slice(-4))).map(event => event.kind),
    ['account', 'theme', 'support', 'feedback']);

  await page.keyboard.press('Escape');
  assert.equal(await accountMenu.isHidden(), true, 'Escape dismisses the account dropdown first');
  assert.equal(await drawer.isVisible(), true);
  await page.keyboard.press('Escape');
  assert.equal(await drawer.isHidden(), true);
  assert.equal(await trigger.evaluate(node => node === document.activeElement), true, 'drawer dismissal returns focus');

  await trigger.click();
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.events.at(-1)), {kind:'navigate',route:'home'});

  await trigger.click();
  await page.getByRole('button', { name: 'Discover videos', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.events.at(-1)), {kind:'navigate',route:'discover'});

  await trigger.click();
  await page.getByRole('button', { name: /Verified project/ }).click();
  assert.deepEqual(await page.evaluate(() => window.events.at(-1)), {kind:'recent',id:recent.id});
  assert.equal(await drawer.isHidden(), true);

  await trigger.click();
  await page.getByRole('button', { name: 'Create a video' }).click();
  assert.equal((await page.evaluate(() => window.events.at(-1))).kind, 'create');
  assert.equal(await drawer.isHidden(), true);

  await trigger.click();
  await page.locator('.riff-menu__backdrop').click({ position: { x: 600, y: 300 } });
  assert.equal(await drawer.isHidden(), true, 'backdrop click dismisses the drawer');
});

test('shared Riff menu suppresses first-use recents and clears old account content before replacement', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffMenu } from './apps/panel/riff-shell/menu.ts';
    const old=${JSON.stringify(account)};
    const recent=${JSON.stringify(recent)};
    window.menu=mountRiffMenu(document.getElementById('menu-host'), {
      account:{...old,onboarding_seen_at:null},recents:[recent],activeRoute:'home',
      onNavigate:()=>{},onOpenRecent:()=>{},onCreate:()=>{},onClose:()=>{},
    });
    window.showReturning=()=>window.menu.render({account:old,recents:[recent],activeRoute:'home'});
    window.replaceAccount=()=>window.menu.render({account:{id:'00000000-0000-4000-8000-000000000002',name:'Second account'},activeRoute:'home'});
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(`<main class="riff-app riff-menu-scope" style="position:relative;min-height:700px"><span id="menu-host"></span></main><script>${bundle.outputFiles[0].text}</script>`);
  const trigger = page.getByRole('button', { name: 'Open Riff menu' });
  await trigger.click();
  assert.equal(await page.getByText('Verified project').count(), 0,
    'an explicit null onboarding marker hides recents in the drawer');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.showReturning());
  await trigger.click();
  assert.equal(await page.getByText('Verified project').count(), 1,
    'an omitted marker fails open to truthful validated recents');
  await page.evaluate(() => window.replaceAccount());
  assert.equal(await page.getByRole('dialog', { name: 'Riff menu' }).isHidden(), true,
    'account replacement closes the drawer');
  assert.equal(await trigger.evaluate(node => node === document.activeElement), true,
    'account replacement never leaves focus inside the hidden drawer');
  await trigger.click();
  assert.equal(await page.getByText('Verified project').count(), 0,
    'account replacement clears prior private recents before render');
  assert.equal(await page.locator('.riff-menu__account-name').textContent(), 'Riff');
  assert.equal(await page.getByRole('button', { name: 'Second account account menu' }).count(), 1);
});

test('shared Riff menu follows dark host tokens and remains visible at 200% text and in forced colors', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffMenu } from './apps/panel/riff-shell/menu.ts';
    document.documentElement.dataset.theme='dark';
    for (const [name,value] of Object.entries({
      '--color-background-primary':'#101318','--color-background-secondary':'#181d25',
      '--color-text-primary':'#f6f7f9','--color-text-secondary':'#c1c8d2','--color-border-secondary':'#596273',
      '--font-text-md-size':'32px'
    })) document.documentElement.style.setProperty(name,value);
    window.menu=mountRiffMenu(document.getElementById('menu-host'), {
      account:${JSON.stringify(account)},recents:[${JSON.stringify(recent)}],activeRoute:'home',
      onNavigate:()=>{},onOpenRecent:()=>{},onCreate:()=>{},onClose:()=>{},
    });
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 700, height: 1000 } });
  await page.setContent(`<main class="riff-app riff-menu-scope" style="position:relative;min-height:976px"><span id="menu-host"></span></main><script>${bundle.outputFiles[0].text}</script>`);
  await page.getByRole('button', { name: 'Open Riff menu' }).click();
  const drawer = page.getByRole('dialog', { name: 'Riff menu' });
  const recentCard = drawer.getByRole('button', { name: /Verified project/ });
  assert.deepEqual(await drawer.evaluate(node => {
    const style=getComputedStyle(node);return {background:style.backgroundColor,color:style.color};
  }), {background:'rgb(16, 19, 24)',color:'rgb(246, 247, 249)'});
  assert.equal(await recentCard.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(16, 19, 24)');
  await page.getByRole('button', { name: 'Verified Creator account menu' }).click();
  const accountMenu = page.getByRole('menu', { name: 'Account' });
  assert.equal(await accountMenu.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(16, 19, 24)');
  assert.equal(await accountMenu.getByRole('menuitem', { name: 'Dark mode', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await accountMenu.getByRole('menuitem', { name: 'Account settings', exact: true }).evaluate(node => getComputedStyle(node).fontSize), '28px');
  assert.ok(await accountMenu.getByRole('menuitem', { name: 'Account settings', exact: true }).evaluate(node => node.getBoundingClientRect().height > 40));
  assert.ok(await page.getByRole('button', { name: 'Create a video' }).evaluate(node => node.getBoundingClientRect().height > 48));
  assert.equal(await page.evaluate(() => {
    const trigger=document.querySelector('.riff-menu__account-trigger').getBoundingClientRect();
    const menu=document.querySelector('.riff-menu__account-menu').getBoundingClientRect();
    return menu.top >= trigger.bottom;
  }), true, 'scaled account menu starts below its trigger');
  assert.equal(await accountMenu.evaluate(node => node.scrollWidth <= node.clientWidth), true);
  assert.equal(await drawer.evaluate(node => node.scrollWidth <= node.clientWidth), true);
  for (const item of await accountMenu.getByRole('menuitem').all()) {
    assert.equal(await item.evaluate(node => node.scrollHeight <= node.clientHeight), true, 'scaled account row does not clip its label');
  }
  await page.close();

  const forced = await browser.newPage({ viewport: { width: 700, height: 900 } });
  await forced.emulateMedia({ forcedColors: 'active' });
  await forced.setContent(`<main class="riff-app riff-menu-scope" style="position:relative;min-height:876px"><span id="menu-host"></span></main><script>${bundle.outputFiles[0].text}</script>`);
  await forced.getByRole('button', { name: 'Open Riff menu' }).click();
  await forced.getByRole('button', { name: 'Verified Creator account menu' }).click();
  for (const locator of [
    forced.getByRole('menu', { name: 'Account' }),
    forced.getByRole('menuitem', { name: 'Account settings', exact: true }),
    forced.locator('.riff-menu__nav-button[aria-current="page"]'),
  ]) {
    assert.deepEqual(await locator.evaluate(node => {
      const style=getComputedStyle(node);return {width:style.borderTopWidth,style:style.borderTopStyle};
    }), {width:'1px',style:'solid'});
  }
});

test('standalone pipeline reports unsupported or failed Home, Create, and recent handoffs', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountCreatorPipeline } from './apps/panel/creator-pipeline/index.ts';
    import { pipelineFixture } from './apps/panel/creator-pipeline/fixtures.ts';
    window.prompts=[];
    const sendPrompt=async prompt=>{
      window.prompts.push(prompt);
      if(prompt.startsWith('Start a fresh'))return {status:'failed',message:'Create handoff failed. Continue in the composer.'};
      if(prompt.startsWith('Open my saved'))return {status:'unsupported',message:'Recent handoff is unsupported. Continue in the composer.'};
      return {status:'unsupported',message:'Home handoff is unsupported. Continue in the composer.'};
    };
    window.view=mountCreatorPipeline(document.getElementById('root'),{
      displayMode:'fullscreen',sendPrompt,
      menu:{account:${JSON.stringify(account)},recents:[${JSON.stringify(recent)}]},
    });
    window.view.render(pipelineFixture('video-analysis'));
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
  await page.setContent(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`);
  const status = page.locator('.riff-pipeline__status');
  for (const [label,message] of [
    ['Home','Home handoff is unsupported. Continue in the composer.'],
    ['Create a video','Create handoff failed. Continue in the composer.'],
    [/Verified project/,'Recent handoff is unsupported. Continue in the composer.'],
  ]) {
    await page.getByRole('button', { name: 'Open Riff menu' }).click();
    await page.getByRole('button', { name: label, exact: typeof label === 'string' }).click();
    await assert.doesNotReject(status.getByText(message, { exact: true }).waitFor());
  }
  assert.equal(await page.evaluate(() => window.prompts.length), 3,
    'every standalone action performs one truthful host handoff');
});
