import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { creatorPreviewServer } from '../../apps/panel/creator-loop/preview-server.mjs';

test('filtered saved DNA accessibility and recovery', async t => {
  const server = await creatorPreviewServer();
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport:{width:672,height:1100}});
  const external = [], errors = [];
  page.on('request', r => { if (!r.url().startsWith(base)) external.push(r.url()); });
  page.on('pageerror', e => errors.push(e.message));
  const screenshots = fileURLToPath(new URL('../../.context/creator-loop-saved-review/',import.meta.url));
  await mkdir(screenshots,{recursive:true});
  try {
    const bundle = await build({stdin:{contents:`
      import { mountCreatorReview } from './apps/panel/creator-loop/index.ts';
      import { creatorDnaViewFixture } from './evals/creator-loop/dna-view-fixtures.ts';
      import { CreatorDnaView } from './packages/contracts/creator-operations.ts';
      const ui = mountCreatorReview(document.querySelector('#review'));
      window.savedTest = { ui, fixture:creatorDnaViewFixture, render(dna, preview=true) {
        ui.render({kind:'saved',dna:CreatorDnaView.parse(dna),preview});
      }};`,resolveDir:fileURLToPath(new URL('../../',import.meta.url))},bundle:true,write:false,format:'iife',platform:'browser'});
    await page.route(`${base}/saved-test.js`,route=>route.fulfill({contentType:'text/javascript',body:bundle.outputFiles[0].text}));
    await page.goto(base);
    await page.addScriptTag({url:`${base}/saved-test.js`});
    const review = page.locator('#review');
    const reset = () => page.evaluate(()=>savedTest.render(savedTest.fixture()));
    await t.test('named keyboard controls, focus recovery and stable status',async()=> {
      await reset();
      // Verify the native summary name in Chromium's accessibility tree as well as keyboard use.
      const control = review.locator('summary').filter({hasText:'Evidence (1) for Topics, trait 1'});
      assert.equal(await control.count(),1);
      assert.match(await control.ariaSnapshot(),/Evidence \(1\) for Topics, trait 1/);
      await control.focus(); await page.keyboard.press('Enter');
      assert.equal(await review.locator('details').evaluate(n=>n.open),true);
      const result = await page.evaluate(()=> {
        const status=document.querySelector('#review [role=status]');
        const observer=new MutationObserver(()=>{}); observer.observe(status,{childList:true,characterData:true,subtree:true});
        savedTest.render(savedTest.fixture());
        const sameStatusMutations=observer.takeRecords().length; observer.disconnect();
        const sameFocus=document.activeElement.tagName==='SUMMARY';
        const sameOpen=document.querySelector('#review details').open;
        const corrected=savedTest.fixture(); corrected.version=2;
        corrected.claims[0]={...corrected.claims[0],id:'00000000-0000-4000-8000-000000000900',basis:'user_corrected',
          evidence:[],supersedes_claim_id:corrected.claims[0].id,statement:'User corrected context'};
        savedTest.render(corrected);
        return {sameStatusMutations,sameFocus,sameOpen,fallback:document.activeElement.textContent};
      });
      assert.deepEqual(result,{sameStatusMutations:0,sameFocus:true,sameOpen:true,fallback:'Creator DNA'});
      assert.match(await review.getByRole('status').textContent(),/version 2/);
      assert.doesNotMatch(await review.textContent(),/latest|current version/i);
      // Same DNA ID in a different project must not reuse disclosure state.
      await reset(); await review.locator('summary').focus(); await page.keyboard.press('Space');
      await page.evaluate(()=>{const d=savedTest.fixture();d.project_id='00000000-0000-4000-8000-000000000901';savedTest.render(d);});
      assert.equal(await review.locator('details').evaluate(n=>n.open),false);
    });
    await t.test('public coverage, dates, unknown metrics and withheld/missing evidence',async()=> {
      await reset(); await review.locator('summary').click();
      assert.match(await review.textContent(),/bounded sample/i);
      assert.match(await review.textContent(),/Fictional fixture/);
      assert.match(await review.textContent(),/Likes0.*SharesUnknown/s);
      assert.match(await review.textContent(),/Retrieved2026-10-09 12:00:00 UTC/);
      await page.evaluate(()=>{const d=savedTest.fixture();d.evidence[0].metrics=null;d.limitations=[];savedTest.render(d);});
      assert.match(await review.textContent(),/Metrics not supplied/);
      assert.match(await review.textContent(),/bounded sample/i);
      await page.evaluate(()=>{const d=savedTest.fixture();d.claims=[];d.evidence=[];d.withheld_claim_count=1;savedTest.render(d);});
      assert.match(await review.textContent(),/1 trait withheld/);
      assert.match(await review.textContent(),/Fictional preview/);
      assert.equal(await review.locator('a,summary').count(),0);
      await page.evaluate(()=>{const d=savedTest.fixture();d.evidence=[];savedTest.render(d);});
      assert.match(await review.textContent(),/Trait withheld: supporting evidence is unavailable/);
      assert.doesNotMatch(await review.textContent(),/Desk demonstrations appear/);
      assert.doesNotMatch(await review.textContent(),/Biography|Provider|requested_cursor|authored-fixture/);
    });
    await t.test('saved fictional data remains saved, including corrected or withheld empty evidence',async()=> {
      // Use the shared schema for every provenance/persistence combination.
      for (const variant of ['fixture', 'withheld', 'corrected', 'evidence-fallback', 'provider']) {
        await page.evaluate(variant=> {
          const d=savedTest.fixture();
          d.contains_fixture_data=variant!=='provider' && variant!=='evidence-fallback';
          if (variant==='withheld') { d.claims=[];d.evidence=[];d.withheld_claim_count=1; }
          if (variant==='corrected') {
            d.claims[0]={...d.claims[0],basis:'user_corrected',evidence:[],supersedes_claim_id:d.claims[0].id};
            d.evidence=[];
          }
          if (variant==='provider') d.evidence.forEach(e=>e.origin='live');
          savedTest.render(d,false);
        },variant);
        if (variant==='fixture') {
          for (const width of [320,640]) for (const theme of ['light','dark']) {
            await page.setViewportSize({width:width===640?672:320,height:1100});
            await page.selectOption('#theme',theme);
            assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
            await review.screenshot({path:`${screenshots}/saved-fictional-${width}-${theme}.png`});
          }
        }
        assert.match(await review.textContent(),/Saved version 1/);
        assert.match(await review.getByRole('status').textContent(),/Saved DNA version 1 shown/);
        assert.doesNotMatch(await review.textContent(),/No live scan or saved changes|Fictional preview|Preview version/);
        if (variant==='provider') {
          assert.doesNotMatch(await review.textContent(),/Contains fictional test data/);
          assert.equal(await review.locator('a').count(),1);
        } else {
          assert.match(await review.textContent(),/Contains fictional test data/);
          assert.match(await review.getByRole('status').textContent(),/Contains fictional test data/);
          assert.equal(await review.locator('a').count(),0);
        }
      }
      await reset();
      assert.match(await review.textContent(),/Fictional preview.*No live scan or saved changes/s);
      assert.match(await review.textContent(),/Preview version 1/);
      assert.match(await review.getByRole('status').textContent(),/Preview DNA version 1/);
    });
    await t.test('auth/error clears output, keeps recovery accessible and never steals external focus',async()=> {
      await reset(); await review.locator('summary').focus();
      await page.evaluate(()=>savedTest.ui.render({kind:'error',message:'Reconnect Riff in ChatGPT, then reopen this review.'}));
      assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Creator review');
      assert.match(await review.getByRole('status').textContent(),/Reconnect Riff/);
      assert.equal(await review.locator('details,article,a').count(),0);
      assert.doesNotMatch(await review.textContent(),/Desk demonstrations|version 1/);
      await page.locator('#theme').focus(); await reset();
      assert.equal(await page.evaluate(()=>document.activeElement.id),'theme');
      await page.evaluate(()=>savedTest.ui.render({kind:'loading'}));
      assert.doesNotMatch(await review.textContent(),/Desk demonstrations|version 1/);
      await reset();
      assert.equal(await review.locator('details').evaluate(n=>n.open),false);
    });
    await t.test('filtered view narrow/light/dark, long text, zoom, hostile text and teardown',async()=> {
      for (const width of [320,640]) for (const theme of ['light','dark']) {
        await page.setViewportSize({width:width===640?672:320,height:1100});
        await page.selectOption('#theme',theme); await reset();
        await review.locator('summary').click();
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        await review.screenshot({path:`${screenshots}/${width}-${theme}.png`});
        await page.evaluate(()=>{const d=savedTest.fixture();d.claims[0].statement='LongUnbrokenText'.repeat(100);savedTest.render(d);});
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      }
      await page.setViewportSize({width:320,height:1100});
      await page.addStyleTag({content:'.kettle-creator :is(h2,h3,h4,p,dt,dd,summary) {font-size:200% !important;line-height:1.5 !important}'});
      await reset(); await review.locator('summary').click();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.evaluate(()=>{const d=savedTest.fixture();d.claims[0].statement='<img src=x onerror=alert(1)>';savedTest.render(d);});
      assert.match(await review.textContent(),/<img src=x/);
      assert.equal(await review.locator('img,script,iframe,a').count(),0);
      await page.evaluate(()=>{savedTest.ui.dispose();savedTest.ui.dispose();savedTest.render(savedTest.fixture());});
      assert.equal(await review.locator('*').count(),0);
    });
    assert.deepEqual(errors,[]); assert.deepEqual(external,[]);
  } finally { await browser.close();await new Promise(resolve=>server.close(resolve)); }
});
