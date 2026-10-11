import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fixtureServer } from '../../apps/panel/fixtures/serve.mjs';
// Use an externally installed Playwright; this workstream does not change dependencies.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

test('project-review real-browser component acceptance', async () => {
  const server = fixtureServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage({viewport:{width:900,height:1200}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const externalRequests = [];
    page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:')) externalRequests.push(request.url()); });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const card = page.locator('.kr-card');
    await page.getByRole('button', {name:'Refresh brief',exact:true}).waitFor();
    assert.match(await card.textContent(), /Saved version 3/);
    for (const field of ['Audience','Goal','Tone','Language','Target duration','20 seconds','Filming constraints']) assert.match(await card.textContent(), new RegExp(field));
    await page.locator('summary').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('details').getAttribute('open'), '');
    assert.match(await card.textContent(), /User-confirmed.*User supplied/s);
    assert.match(await card.textContent(), /Unconfirmed.*URL source/s);
    assert.equal(await card.locator('a').getAttribute('href'), 'https://example.com/daylight');
    assert.equal(await card.locator('a').getAttribute('rel'), 'noopener noreferrer');
    await page.getByRole('button',{name:'Refresh brief',exact:true}).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#count').textContent(),'1');
    assert.match(await card.textContent(), /Previously loaded snapshot shown/);
    await page.waitForTimeout(900);
    assert.equal(await page.locator('details').getAttribute('open'), '');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent),'Refresh brief');
    await page.selectOption('#scenario','warning');
    assert.match(await card.textContent(),/Previously loaded snapshot/);
    assert.equal(await card.locator('button').getAttribute('aria-disabled'),'false');
    await page.selectOption('#scenario','loading');
    assert.doesNotMatch(await card.textContent(),/Daylight/);
    assert.equal(await card.locator('button').count(),0);
    await page.selectOption('#scenario','auth');
    assert.doesNotMatch(await card.textContent(),/Daylight/);
    assert.match(await card.textContent(),/Reconnect Riff through ChatGPT/);
    await page.selectOption('#scenario','error');
    assert.match(await card.textContent(),/This project is unavailable/);
    await page.selectOption('#scenario','empty');
    assert.match(await card.textContent(),/No constraints recorded/);
    assert.match(await card.textContent(),/No supporting facts recorded/);
    await page.selectOption('#scenario','hostile');
    await card.locator('summary').click();
    assert.match(await card.textContent(), /<img src=x/);
    assert.match(await card.textContent(), /<svg onload/);
    assert.equal(await card.locator('img,svg,script').count(),0);
    await mkdir('.context/project-review', {recursive:true});
    for (const width of [640,320]) for (const theme of ['light','dark']) {
      await page.setViewportSize({width:width === 320 ? 320 : 900,height:1200});
      await page.selectOption('#scenario','ready');
      await page.selectOption('#width',String(width));
      await page.selectOption('#theme',theme);
      if (!(await page.locator('details').evaluate(node => node.open))) await card.locator('summary').click();
      assert.equal(await page.locator('#preview').evaluate(node => Math.round(node.getBoundingClientRect().width)),width);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await card.screenshot({path:`.context/project-review/${width}-${theme}.png`});
      await page.selectOption('#scenario','long');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.locator('details').evaluate(node => { node.open = true; });
      assert.equal(await card.locator('.kr-fact').count(),50);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    // Text-only zoom, narrow card, and reduced-motion preference.
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.addStyleTag({content:'.kettle-review :is(h2,h3,p,dt,dd,li,summary,button,span,a,time) { font-size:200% !important; line-height:1.5 !important; }'});
    await page.selectOption('#scenario','ready');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    // Direct seam checks, isolated from preview controls.
    const result = await page.evaluate(async () => {
      const {mountProjectReview} = await import('/apps/panel/project-review.ts');
      const {project} = await import('/apps/panel/fixtures/projects.ts');
      const root = document.createElement('div'); document.body.append(root);
      let calls = 0;
      const ui = mountProjectReview(root,{onRefresh(){calls++;}});
      const loading = root.textContent.includes('Loading your saved brief');
      const bad = structuredClone(project);
      bad.brief_version.brief.facts[1].source.url = 'javascript:alert(1)';
      ui.render({kind:'ready',project:bad,refreshing:false});
      const unsafeLinks = root.querySelectorAll('a').length;
      const button = root.querySelector('button'); button.click(); button.click();
      ui.dispose(); button.click();
      ui.render({kind:'ready',project,refreshing:false});
      const empty = root.childElementCount === 0;
      root.remove();
      return {loading,unsafeLinks,calls,empty};
    });
    assert.deepEqual(result,{loading:true,unsafeLinks:0,calls:1,empty:true});
    assert.deepEqual(errors,[]);
    assert.deepEqual(externalRequests,[]);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
