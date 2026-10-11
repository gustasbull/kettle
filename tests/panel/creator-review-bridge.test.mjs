import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Real SDK + real component in an iframe; this is a local host fixture, not ChatGPT.
test('Creator DNA bridge parent transport, refresh, denial and teardown', async t => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountCreatorReviewBridge } from './apps/panel/creator-review-bridge.ts';
    window.bridge = mountCreatorReviewBridge(document.getElementById('review'), 500);
  ` }, bundle: true, format: 'iife', platform: 'browser', write: false });
  const fixture = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { creatorDnaViewFixture } from './evals/creator-loop/dna-view-fixtures.ts';
    import { creatorFailure } from './packages/application/creator-operations.ts';
    window.output = {ok:true,data:{dna:creatorDnaViewFixture()}};
    window.denied = creatorFailure('UNAUTHENTICATED');
  ` }, bundle: true, format: 'iife', platform: 'browser', write: false });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src 'self'; connect-src 'none'");
    if (req.url === '/frame') res.end(`<div id="review"></div><script>${bundle.outputFiles[0].text}</script>`);
    else res.end(`<script>${fixture.outputFiles[0].text}</script><script>
      window.calls=[]; window.sizes=[]; window.ready=false; window.respond=true;
      window.send=(method,params)=>document.querySelector('iframe').contentWindow.postMessage({jsonrpc:'2.0',method,params},'*');
      window.reply=(id,result)=>document.querySelector('iframe').contentWindow.postMessage({jsonrpc:'2.0',id,result},'*');
      addEventListener('message', e=>{
        const m=e.data;
        if(m.method==='ui/initialize' && location.search!=='?silent') window.reply(m.id,{protocolVersion:m.params.protocolVersion,
          hostInfo:{name:'local-fixture',version:'1'},hostCapabilities:location.search==='?no-tools'?{}:{serverTools:{}},hostContext:{theme:'dark',locale:'lt'}});
        if(m.method==='ui/notifications/initialized') {
          window.send('ui/notifications/tool-input',{arguments:{dna_id:window.output.data.dna.dna_id}});
          window.send('ui/notifications/tool-result',{structuredContent:window.output,content:[]}); window.ready=true;
        }
        if(m.method==='tools/call') { window.calls.push(m); if(window.respond) window.reply(m.id,{structuredContent:window.output,content:[]}); }
        if(m.method==='ui/notifications/size-changed') window.sizes.push(m.params);
        if(m.id==='teardown') window.tornDown=m;
      });
    </script><iframe src="/frame"></iframe>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({headless:true}); t.after(() => browser.close());
  const page = await browser.newPage();
  const errors=[], requests=[];
  page.on('pageerror', e=>errors.push(e.message));
  page.on('request', r=>requests.push(r.url()));
  const url=`http://127.0.0.1:${server.address().port}`;
  async function launch(query='') {
    await page.goto(url+'/'+query); await page.waitForFunction(()=>window.ready);
    const frame=page.frames().find(f=>f.url().endsWith('/frame'));
    await frame.waitForFunction(()=>document.querySelector('#review').textContent.includes('Saved version 1'));
    return frame;
  }
  let frame=await launch();
  await t.test('handshake renders without reread, applies theme/locale and sends sizes', async()=>{
    assert.equal(await page.evaluate(()=>window.calls.length),0);
    assert.equal(await frame.evaluate(()=>document.documentElement.lang),'lt');
    assert.equal(await frame.evaluate(()=>document.documentElement.dataset.theme),'dark');
    await page.waitForFunction(()=>window.sizes.length>0);
    // Same-window spoof is not the parent WindowProxy accepted by PostMessageTransport.
    await frame.evaluate(()=>window.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{isError:true,content:[]}},'*'));
    await frame.evaluate(()=>new Promise(resolve=>setTimeout(resolve,20)));
    assert.match(await frame.locator('#review').textContent(),/Saved version 1/);
  });
  await t.test('explicit refresh reads only get_creator_dna; duplicate calls suppressed',async()=>{
    await frame.evaluate(()=>Promise.all([window.bridge.refresh(),window.bridge.refresh()]));
    assert.deepEqual(await page.evaluate(()=>window.calls.map(m=>({name:m.params.name,arguments:m.params.arguments}))),[{name:'get_creator_dna',arguments:{dna_id:'00000000-0000-4000-8000-000000000004'}}]);
  });
  await t.test('timeout recovers with explicit retry and ignores late result',async()=>{
    await page.evaluate(()=>{window.respond=false;});
    await frame.evaluate(()=>window.bridge.refresh());
    assert.match(await frame.locator('#review').textContent(),/Refresh timed out/);
    await page.evaluate(()=>{window.reply(window.calls.at(-1).id,{structuredContent:window.output,content:[]});window.respond=true;});
    await frame.evaluate(()=>window.bridge.refresh());
    assert.match(await frame.locator('#review').textContent(),/Saved version 1/);
  });
  await t.test('auth failure clears data and late host output cannot restore it',async()=>{
    await page.evaluate(()=>window.send('ui/notifications/tool-result',{structuredContent:window.denied,isError:true,content:[]}));
    await frame.waitForFunction(()=>document.querySelector('#review').textContent.includes('Reconnect your Riff'));
    await page.evaluate(()=>window.send('ui/notifications/tool-result',{structuredContent:window.output,content:[]}));
    await frame.evaluate(()=>window.bridge.refresh());
    assert.doesNotMatch(await frame.locator('#review').textContent(),/Desk demonstrations|Saved version/);
  });
  await t.test('missing read capability retains display without sending tools',async()=>{
    frame=await launch('?no-tools');
    await frame.evaluate(()=>window.bridge.refresh());
    assert.equal(await page.evaluate(()=>window.calls.length),0);
    assert.match(await frame.locator('#review').textContent(),/Saved version 1/);
  });
  await t.test('missing handshake reaches recovery and top-level mounting fails closed',async()=>{
    await page.goto(url+'/?silent');
    frame=page.frames().find(f=>f.url().endsWith('/frame'));
    await frame.waitForFunction(()=>document.querySelector('#review').textContent.includes('connection could not load'));
    await page.goto(url+'/frame');
    assert.match(await page.locator('#review').textContent(),/connection could not load/);
    await page.evaluate(()=>window.bridge.dispose());
  });
  await t.test('teardown acknowledges and disposes DOM and resize notifications',async()=>{
    frame=await launch();
    await page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({jsonrpc:'2.0',id:'teardown',method:'ui/resource-teardown',params:{}},'*'));
    await page.waitForFunction(()=>window.tornDown);
    await frame.waitForFunction(()=>document.querySelector('#review').textContent==='');
    const count=await page.evaluate(()=>window.sizes.length);
    await frame.evaluate(()=>{document.body.style.height='1800px';});
    await page.waitForTimeout(40);
    assert.equal(await page.evaluate(()=>window.sizes.length),count);
  });
  assert.deepEqual(errors,[]);
  assert.ok(requests.every(r=>[url+'/',url+'/?no-tools',url+'/?silent',url+'/frame'].includes(r)));
});
