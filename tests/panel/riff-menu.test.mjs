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
  await trigger.click();
  assert.equal(await page.getByText('Verified project').count(), 0,
    'account replacement clears prior private recents before render');
  assert.equal(await page.getByText('Second account').count(), 1);
});
