import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Synthetic provider summary only. No Lightreel or source requests.
test('saved DNA and scan cards separate Lightreel supplied-video review from profile claims',async t=>{
  const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:`
    import { mountSavedCreatorReview } from './apps/panel/creator-review.ts';
    import { mountCreatorPipeline } from './apps/panel/creator-pipeline/index.ts';
    import { creatorDnaViewFixture } from './evals/creator-loop/dna-view-fixtures.ts';
    import { creatorJobFixture } from './evals/creator-loop/pipeline-fixtures.ts';
    import { CreatorDnaView } from './packages/contracts/creator-operations.ts';
    import { CreatorJobView } from './packages/contracts/creator-pipeline.ts';
    import { failure } from './packages/application/operations.ts';
    let saved,pipeline;
    window.renderReview=(seed)=>{
      saved?.dispose();pipeline?.dispose();
      const dna=CreatorDnaView.parse({...creatorDnaViewFixture(),...(seed?{seed_review:seed}:{})});
      saved=mountSavedCreatorReview(document.getElementById('saved'),async()=>({ok:true,data:{dna}}));
      saved.receiveInput({dna_id:dna.dna_id});saved.receiveResult({ok:true,data:{dna}});saved.connected(true);
      pipeline=mountCreatorPipeline(document.getElementById('pipeline'),{displayMode:'fullscreen'});
      pipeline.render(CreatorJobView.parse({...creatorJobFixture('scan'),result:{kind:'scan',dna}}));
    };
    window.clearReviews=()=>{
      saved.receiveResult(failure('UNAUTHENTICATED'));
      pipeline.render({...creatorJobFixture('scan'),state:'failed',result:null});
    };
    window.disposeReviews=()=>{saved?.dispose();pipeline?.dispose();};
  `},bundle:true,format:'iife',platform:'browser',write:false});
  const server=createServer((_req,res)=>{
    res.setHeader('Content-Type','text/html');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; img-src 'none'; base-uri 'none'");
    res.end(`<meta name="viewport" content="width=device-width, initial-scale=1"><div id="saved"></div><div id="pipeline"></div><script>${bundle.outputFiles[0].text}</script>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser=await chromium.launch();t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:640,height:1000}});
  const requests=[],errors=[];page.on('request',r=>requests.push(r.url()));page.on('pageerror',e=>errors.push(e.message));
  const base=`http://127.0.0.1:${server.address().port}/`;await page.goto(base);
  const seed={url:'https://www.tiktok.com/@fictional_kettle_creator/video/9000000000000000011',provider:'lightreel',summary:'Synthetic supplied-video analysis: <img src=x onerror=alert(1)>',access_basis:'video_access_reported',limitations:['Synthetic response; access is not independently proven.'],retrieved_at:'2026-10-09T12:00:00Z',origin:'live'};
  const sections=page.getByRole('region',{name:'Lightreel review of supplied video',exact:true});
  await t.test('exact source, inert summary, date and limitations appear separately in both views',async()=>{
    await page.evaluate(seed=>window.renderReview(seed),seed);assert.equal(await sections.count(),2);
    for(const section of await sections.all()){
      assert.match(await section.textContent(),/supplied video only.*Profile-wide Creator DNA is shown separately/s);
      assert.match(await section.textContent(),/has not independently verified that access/);
      assert.match(await section.textContent(),/Synthetic supplied-video analysis: <img/);
      assert.match(await section.textContent(),/Retrieved:?\s*2026-10-09 12:00:00 UTC/);
      assert.match(await section.textContent(),/Review limitations.*access is not independently proven/s);
      const link=section.getByRole('link');assert.equal(await link.getAttribute('href'),seed.url);assert.equal(await link.getAttribute('rel'),'noopener noreferrer');assert.equal(await link.getAttribute('referrerpolicy'),'no-referrer');
      assert.equal(await section.locator('img,iframe,script').count(),0);
      assert.equal(await section.locator('.kc-claim').count(),0,'review is not rendered as an observed DNA claim');
    }
    assert.equal(await page.getByRole('heading',{name:'Creator DNA',exact:true}).count(),1);
    assert.equal(await page.getByRole('heading',{name:'Video analysis',exact:true}).count(),1);
  });
  await t.test('access wording reports only supplied basis and fictional URLs are inert',async()=>{
    for(const [access_basis,phrase] of [['transcript_or_caption_only','transcript or caption access only'],['unavailable','video was unavailable'],['unknown','Video access is unverified']]){
      await page.evaluate(seed=>window.renderReview(seed),{...seed,access_basis});
      for(const section of await sections.all())assert.ok((await section.textContent()).includes(phrase));
    }
    await page.evaluate(seed=>window.renderReview(seed),{...seed,origin:'fixture'});
    assert.equal(await sections.locator('a').count(),0);
    for(const section of await sections.all())assert.match(await section.textContent(),/Fictional test review.*not live provider evidence/s);
  });
  await t.test('no-review path, private clearing and disposal remove supplied review content',async()=>{
    await page.evaluate(()=>window.renderReview());assert.equal(await sections.count(),0);
    assert.equal(await page.getByRole('heading',{name:'Creator DNA',exact:true}).count(),1);
    assert.equal(await page.getByRole('heading',{name:'Creator analysis',exact:true}).count(),1);
    await page.evaluate(seed=>window.renderReview(seed),seed);await page.evaluate(()=>window.clearReviews());
    assert.equal(await sections.count(),0);assert.doesNotMatch(await page.locator('body').innerText(),/Synthetic supplied-video analysis/);
    await page.evaluate(seed=>window.renderReview(seed),seed);await page.evaluate(()=>window.disposeReviews());
    assert.equal(await page.locator('#saved,#pipeline').evaluateAll(nodes=>nodes.every(n=>n.childElementCount===0)),true);
  });
  await t.test('narrow long summaries wrap without external assets or connections',async()=>{
    await page.setViewportSize({width:320,height:1000});
    await page.evaluate(seed=>window.renderReview(seed),{...seed,summary:'LongUnbrokenSyntheticText'.repeat(100)});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await sections.count(),2);
  });
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[base]);
});
