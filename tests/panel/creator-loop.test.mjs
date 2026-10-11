import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { creatorPreviewServer } from '../../apps/panel/creator-loop/preview-server.mjs';

test('creator-loop read-only component acceptance', async t => {
  const server = await creatorPreviewServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 1100 } });
  const errors = [], external = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', request => { if (!request.url().startsWith(base)) external.push(request.url()); });
  const captureDirectory = fileURLToPath(new URL('../../.context/creator-loop/', import.meta.url));
  await mkdir(captureDirectory, { recursive:true });
  try {
    await page.goto(base);
    const review = page.locator('#review');
    const scan = review.getByRole('region', { name: 'Scan results', exact:true });
    const dna = review.getByRole('region', { name: 'Creator DNA', exact:true });
    const scenario = async name => { await page.selectOption('#scenario', name); };
    await t.test('coverage, dated evidence, unknown/zero, provenance and chat-only correction', async () => {
      assert.match(await review.textContent(), /Fictional preview.*No live scan or saved changes/s);
      assert.match(await scan.textContent(), /1 unique video returned · up to 10 requested/);
      assert.match(await scan.textContent(), /bounded sample, not proof of complete profile coverage/);
      await scan.locator('summary').focus();
      await page.keyboard.press('Enter');
      assert.equal(await scan.locator('details').evaluate(n => n.open), true);
      const rows = scan.locator('.kc-row');
      assert.equal(await rows.filter({has:page.locator('dt', {hasText:/^Likes$/})}).locator('dd').textContent(), '0');
      assert.equal(await rows.filter({has:page.locator('dt', {hasText:/^Shares$/})}).locator('dd').textContent(), 'Unknown');
      assert.equal(await rows.filter({has:page.locator('dt', {hasText:/^Followers$/})}).locator('dd').textContent(), 'Unknown');
      assert.match(await scan.textContent(), /Retrieved2026-10-09 12:00:00 UTC/);
      assert.match(await scan.textContent(), /Source observedUnknown/);
      assert.match(await dna.textContent(), /Observed.*Inferred.*User-corrected/s);
      assert.match(await dna.textContent(), /Snapshot version 1/);
      assert.doesNotMatch(await dna.textContent(), /Saved version/);
      assert.match(await dna.textContent(), /UncertaintyOne caption does not establish a recurring pattern/);
      assert.match(await dna.textContent(), /Audience and visual pacing are unknown/);
      assert.match(await dna.textContent(), /tell Riff in chat/);
      assert.equal(await review.locator('button,input,textarea,a').count(), 0);
      const evidence = dna.locator('summary').first();
      await evidence.focus(); await page.keyboard.press('Space');
      assert.equal(await dna.locator('details').first().evaluate(n=>n.open), true);
      assert.equal(await evidence.evaluate(n=>n === document.activeElement), true);
      assert.ok(await evidence.evaluate(n=>n.getBoundingClientRect().height >= 44));
      await page.keyboard.press('Tab');
      assert.equal(await dna.locator('summary').nth(1).evaluate(n=>n === document.activeElement), true);
      await dna.locator('summary').last().click();
      assert.match(await dna.locator('details').last().textContent(), /No observation evidence attached/);
    });
    await t.test('partial, unavailable, failed, empty, loading and safe error states', async () => {
      await scenario('partial');
      assert.match(await scan.textContent(), /Partial scan/);
      assert.match(await scan.textContent(), /Provider pagination coverage is unknown/);
      assert.equal(await dna.count(), 0);
      await scenario('unavailable');
      assert.match(await scan.textContent(), /Profile unavailable/);
      assert.match(await scan.textContent(), /No observations available/);
      assert.match(await scan.textContent(), /0 unique videos returned/);
      await scenario('failed');
      assert.match(await scan.textContent(), /Scan failed.*Request timed out/s);
      assert.match(await scan.textContent(), /does not retry it/);
      assert.equal(await review.locator('button').count(), 0);
      await scenario('empty');
      assert.match(await dna.textContent(), /No DNA traits supplied/);
      await scenario('loading');
      assert.equal(await review.getByRole('status').textContent(), 'Loading scan and Creator DNA…');
      assert.doesNotMatch(await review.textContent(), /Desk demonstrations|Snapshot version/);
      await scenario('error');
      assert.match(await review.textContent(), /Ask Riff in chat to reopen/);
      assert.equal(await review.locator('details').count(), 0);
    });
    await t.test('untrusted content and unavailable display permissions', async () => {
      await scenario('hostile'); await scan.locator('summary').click();
      assert.match(await scan.textContent(), /<img src=x onerror=alert/);
      assert.match(await dna.textContent(), /<svg onload=alert/);
      assert.equal(await review.locator('img,svg,script,iframe').count(), 0);
      await scenario('withheld');
      assert.match(await review.textContent(), /Observation withheld/);
      assert.match(await dna.textContent(), /Trait withheld/);
      assert.doesNotMatch(await scan.textContent(), /Authored fixture: tidy desk demonstration/);
      assert.doesNotMatch(await dna.textContent(), /Desk demonstrations appear/);
    });
    await t.test('narrow/light/dark, expanded evidence, long text and text enlargement', async () => {
      for (const width of [640,320]) for (const theme of ['light','dark']) {
        await page.setViewportSize({ width:width === 640 ? 672 : 320, height:1100 });
        await page.selectOption('#theme',theme); await scenario('review');
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth));
        await review.locator('details').evaluateAll(nodes => nodes.forEach(n => { n.open = false; }));
        await review.screenshot({ path:`${captureDirectory}/${width}-${theme}.png` });
        await dna.screenshot({ path:`${captureDirectory}/dna-${width}-${theme}.png` });
        await scan.locator('summary').click();
        await dna.locator('summary').first().click();
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth));
        await scenario('long');
        await scan.locator('summary').click();
        assert.equal(await dna.locator('article').count(), 20);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth));
      }
      await scenario('review');
      await page.emulateMedia({ reducedMotion:'reduce' });
      await page.addStyleTag({ content:'.kettle-creator :is(h2,h3,h4,p,dt,dd,li,summary) {font-size:200% !important;line-height:1.5 !important}' });
      await scan.locator('summary').click();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth));
    });
    await t.test('lifecycle preserves disclosures/focus only for same scan and makes no calls', async () => {
      // Test-only browser entry. Production exports have no globals or fixture dependency.
      const bundle = await build({ stdin:{contents:`import { mountCreatorReview } from './apps/panel/creator-loop/index.ts';
        import { fixtureState } from './apps/panel/creator-loop/fixtures.ts';
        window.creatorTest = { mountCreatorReview, fixtureState };`, resolveDir:fileURLToPath(new URL('../../', import.meta.url))},
        bundle:true, write:false, format:'iife', platform:'browser' });
      await page.route(`${base}/test.js`, route => route.fulfill({contentType:'text/javascript',body:bundle.outputFiles[0].text}));
      await page.addScriptTag({url:`${base}/test.js`});
      const result = await page.evaluate(() => {
        const { mountCreatorReview, fixtureState } = window.creatorTest;
        const root = document.createElement('div'); document.body.append(root);
        let calls = 0;
        const oldFetch = window.fetch;
        window.fetch = () => { calls++; throw Error('No calls allowed'); };
        const ui = mountCreatorReview(root);
        const loading = root.textContent.includes('Loading scan');
        const state = fixtureState('review'); ui.render(state);
        const region = root.querySelector('[aria-label="Creator DNA"]');
        const detail = region.querySelector('details'); detail.open = true; detail.querySelector('summary').focus();
        ui.render(state);
        const preserved = root.querySelector('[aria-label="Creator DNA"] details').open && document.activeElement?.textContent === 'Evidence (1)';
        const next = structuredClone(state); next.analysis.scan.id = 'new-scan'; next.analysis.dna.source_scan_id = 'new-scan';
        ui.render(next);
        const reset = root.querySelectorAll('details[open]').length === 0;
        ui.render({kind:'error', message:'<img src=x onerror=alert(1)>'});
        const cleared = !root.textContent.includes('Desk demonstrations') && root.querySelectorAll('img').length === 0;
        // Defense in depth for links; production boundary still validates complete D0 values.
        const live = structuredClone(state); live.preview = false;
        for (const o of [...live.analysis.scan.profile_observations,...live.analysis.scan.video_observations]) {
          o.provenance.origin = 'live'; o.provenance.permission.status = 'approved';
          o.canonical_url = 'javascript:alert(1)'; o.provenance.source_url = 'https://user:secret@example.com';
        }
        live.analysis.scan.request.supplied_url = 'data:text/html,unsafe';
        ui.render(live);
        const unsafeLinks = root.querySelectorAll('a').length;
        live.analysis.scan.request.supplied_url = 'https://example.com/source'; ui.render(live);
        const link = root.querySelector('a');
        const safe = link?.href === 'https://example.com/source' && link.rel === 'noopener noreferrer';
        ui.dispose(); ui.dispose(); ui.render(state);
        const empty = root.childElementCount === 0;
        window.fetch = oldFetch; root.remove();
        return { loading, preserved, reset, cleared, unsafeLinks, safe, empty, calls };
      });
      assert.deepEqual(result, {loading:true,preserved:true,reset:true,cleared:true,unsafeLinks:0,safe:true,empty:true,calls:0});
    });
    await t.test('filtered storage view renders without internal analysis and survives narrow/dark layout', async () => {
      await scenario('saved');
      assert.match(await dna.textContent(), /Preview version 1/);
      assert.match(await review.textContent(), /Fictional preview/);
      await dna.locator('summary').first().click();
      assert.match(await dna.textContent(), /Likes0/);
      assert.match(await dna.textContent(), /SharesUnknown/);
      assert.doesNotMatch(await review.textContent(), /Biography|Provider|permission_basis|requested_cursor/);
      assert.equal(await review.locator('a').count(), 0);
      await page.setViewportSize({width:320,height:1100});
      await page.selectOption('#theme','dark');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({path:`${captureDirectory}/saved-320-dark.png`,fullPage:true});
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
