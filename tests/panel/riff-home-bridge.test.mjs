import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { build } from 'esbuild';

test('Riff Home keeps onboarding in chat and runs the creator happy path in the app', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffHomeBridge } from './apps/panel/riff-home-bridge.ts';
    import { pipelineFixture } from './apps/panel/creator-pipeline/fixtures.ts';
    window.fixtures={scan:pipelineFixture('video-analysis'),ideas:pipelineFixture('ideas')};
    window.bridge=mountRiffHomeBridge(document.getElementById('mount'), {timeoutMs:500,toolTimeoutMs:500,pollIntervalMs:20,maxPolls:2});
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/frame') return res.end(`<div id="mount"></div><script>${bundle.outputFiles[0].text}</script>`);
    res.end(`<script>
      window.messages=[]; window.calls=[]; window.ready=false;
      const frame=()=>document.querySelector('iframe').contentWindow;
      const result=(id,structuredContent)=>frame().postMessage({jsonrpc:'2.0',id,result:{content:[],structuredContent}},'*');
      addEventListener('message',e=>{const m=e.data;
        if(m.method==='ui/initialize') frame().postMessage({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params.protocolVersion,hostInfo:{name:'fixture',version:'1'},hostCapabilities:{serverTools:{},message:{text:{}},experimental:{'openai/message':{}}},hostContext:{theme:'dark',locale:'lt',safeAreaInsets:{top:7,right:8,bottom:9,left:10},styles:{variables:{'--color-background-primary':'#101010'},css:{fonts:'body{letter-spacing:.01px}'}}}}},'*');
        if(m.method==='ui/notifications/initialized'){frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ok:true,data:{account:{id:'00000000-0000-4000-8000-000000000001',display_name:'Fixture',state:'active',preferred_language:'en',created_at:'2026-01-01T00:00:00Z',onboarding_seen_at:null},entitlements:{status:'not_configured'},usage:{status:'not_configured',reset_at:null}}},content:[]}},'*');window.ready=true;}
        if(m.method==='ui/message'){window.messages.push(m.params);frame().postMessage({jsonrpc:'2.0',id:m.id,result:{}},'*');}
        if(m.method==='tools/call'){
          window.calls.push(m.params);
          if(m.params.name==='start_riff_creator') return result(m.id,{ok:true,data:{project:{id:frame().fixtures.scan.project_id},job:frame().fixtures.scan,source:{canonical_url:m.params.arguments.source_url}}});
          if(m.params.name==='start_creator_recommendations') return result(m.id,{ok:true,data:{job:frame().fixtures.ideas}});
          if(m.params.name==='get_creator_job') return result(m.id,{ok:true,data:{job:frame().fixtures.scan}});
          return result(m.id,{ok:true,data:{}});
        }
        if(m.id==='teardown')window.tornDown=true;
      });
    </script><iframe src="/frame"></iframe>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(4_000);
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.goto(base);
  await page.waitForFunction(() => window.ready);
  const frame = page.frames().find((item) => item.url().endsWith('/frame'));
  await frame.waitForFunction(() => document.body.textContent.includes('Fixture'));

  assert.equal(await frame.evaluate(() => document.documentElement.lang), 'lt');
  assert.equal(await frame.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.equal(await frame.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--riff-safe-top')), '7px');
  assert.equal(await frame.locator('#__mcp-host-fonts').count(), 1);
  assert.equal(await frame.getByRole('region', { name: 'Welcome to Riff' }).count(), 0, 'welcome never renders inside Home');
  assert.equal(await frame.getByPlaceholder('Share a video or profile link, or tell me what you want to make…').count(), 1);
  assert.equal(await page.evaluate(() => window.calls.some(call => call.name === 'mark_riff_onboarding_seen')), false,
    'Home does not mark onboarding before the chat welcome is delivered');

  await frame.getByRole('button', { name: 'Open Riff menu' }).click();
  await frame.getByRole('menuitem', { name: 'How Riff works' }).click();
  await page.waitForFunction(() => window.messages.length === 1);
  assert.match(await page.evaluate(() => window.messages[0].content[0].text), /welcome guide.*conversation/i);
  assert.equal(await page.evaluate(() => window.calls.some(call => call.name === 'show_riff_welcome')), false,
    'the app asks in the active conversation instead of trying to render onboarding inside itself');

  const source = 'https://vm.tiktok.com/ZN8kT9uhV/';
  const input = frame.getByPlaceholder('Share a video or profile link, or tell me what you want to make…');
  await input.fill(source); await input.press('Control+Enter');
  await page.waitForFunction(() => window.calls.some(call => call.name === 'start_riff_creator'));
  const start = await page.evaluate(() => window.calls.find(call => call.name === 'start_riff_creator'));
  assert.equal(start.arguments.source_url, source);
  assert.match(start.arguments.request_id, /^[0-9a-f-]{36}$/i);
  await frame.getByRole('heading', { name: 'Unlock your video’s viral potential.' }).waitFor();
  await page.waitForFunction(() => window.calls.filter(call => call.name === 'list_riff_work').length >= 2);

  await frame.getByRole('button', { name: 'Explore viral formats' }).click();
  await page.waitForFunction(() => window.calls.some(call => call.name === 'start_creator_recommendations'));
  await frame.getByRole('heading', { name: 'Find your next breakout idea.' }).waitFor();
  await frame.getByRole('button', { name: 'Make it mine' }).click();
  await page.waitForFunction(() => window.messages.length === 2);
  assert.match(await page.evaluate(() => window.messages[1].content[0].text), /save_creator_scripts/);

  await frame.waitForFunction(() => !document.querySelector('.riff-home__create')?.disabled);
  await frame.locator('header').getByRole('button', { name: 'Create a video' }).click();
  await frame.evaluate(() => { window.openai = { selectFiles: async () => [{fileId:'file_video',fileName:'clip.mp4',mimeType:'video/mp4'}] }; });
  await frame.getByRole('button', { name: 'Upload a video' }).click();
  await page.waitForFunction(() => window.messages.length === 3);
  assert.match(await page.evaluate(() => window.messages[2].content[0].text), /clip\.mp4.*file_video/i);

  await frame.waitForFunction(() => !document.querySelector('.riff-home__submit')?.disabled);
  await input.fill('A fast desk makeover with one surprising constraint'); await input.press('Control+Enter');
  await page.waitForFunction(() => window.messages.length === 4);
  assert.match(await page.evaluate(() => window.messages[3].content[0].text), /desk makeover.*clarifying/i);
  assert.equal(await page.evaluate(() => window.calls.filter(call => call.name === 'start_riff_creator').length), 1,
    'plain ideas continue in chat without spending provider credits');

  assert.deepEqual(await page.evaluate(() => window.messages.map(message => message._meta['openai/message'])),
    Array.from({ length: 4 }, () => ({ target: 'active', send: true })));
  await page.evaluate(() => frame().postMessage({jsonrpc:'2.0',id:'teardown',method:'ui/resource-teardown',params:{}},'*'));
  await page.waitForFunction(() => window.tornDown);
  await frame.waitForFunction(() => document.querySelector('#mount').textContent === '');
});

test('Riff Home reuses a logical request ID for ambiguous and retry-same-request outcomes', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffHomeBridge } from './apps/panel/riff-home-bridge.ts';
    window.bridge=mountRiffHomeBridge(document.getElementById('mount'), {
      timeoutMs:500, toolTimeoutMs:120, pollIntervalMs:20, maxPolls:1
    });
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/frame') return res.end(`<div id="mount"></div><script>${bundle.outputFiles[0].text}</script>`);
    res.end(`<script>
      window.starts=[]; window.ready=false;
      const frame=()=>document.querySelector('iframe').contentWindow;
      const result=(id,structuredContent)=>frame().postMessage({jsonrpc:'2.0',id,result:{content:[],structuredContent}},'*');
      addEventListener('message',e=>{const m=e.data;
        if(m.method==='ui/initialize') frame().postMessage({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params.protocolVersion,hostInfo:{name:'fixture',version:'1'},hostCapabilities:{serverTools:{},message:{text:{}}},hostContext:{}}},'*');
        if(m.method==='ui/notifications/initialized'){
          frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ok:true,data:{account:{id:'00000000-0000-4000-8000-000000000001',display_name:'Fixture',onboarding_seen_at:'2026-10-11T00:00:00Z'}}},content:[]}},'*');
          window.ready=true;
        }
        if(m.method==='tools/call'&&m.params.name==='list_riff_work') return result(m.id,{ok:true,data:{work:[]}});
        if(m.method==='tools/call'&&m.params.name==='start_riff_creator'){
          window.starts.push(m.params.arguments);
          if(window.starts.length===1||window.starts.length===4)return;
          if(window.starts.length===2)return result(m.id,{ok:false,error:{code:'UNAVAILABLE',message:'Retry the same request.',retryable:true,recovery:'retry_same_request'}});
          return result(m.id,{ok:false,error:{code:'VALIDATION_ERROR',message:'Correct the input.',retryable:false,recovery:'correct_input'}});
        }
      });
    </script><iframe src="/frame"></iframe>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage(); page.setDefaultTimeout(3_000);
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.ready);
  const frame = page.frames().find((item) => item.url().endsWith('/frame'));
  const input = frame.getByPlaceholder('Share a video or profile link, or tell me what you want to make…');
  const submit = frame.getByRole('button', { name: 'Find my next idea' });
  const firstSource = 'https://www.tiktok.com/@fixture/video/7000000000000000001';
  const secondSource = 'https://www.tiktok.com/@fixture/video/7000000000000000002';
  const start = async (source, count) => {
    await input.fill(source); await input.press('Control+Enter');
    await page.waitForFunction((expected) => window.starts.length === expected, count);
    await frame.waitForFunction(() => !document.querySelector('.riff-home__submit')?.disabled);
  };

  await start(firstSource, 1); // Timed out after the host may have accepted it.
  await start(firstSource, 2); // Explicit retry-same response retains the idempotency key.
  await start(firstSource, 3); // Definitive validation failure uses, then clears, that key.
  await start(firstSource, 4); // Same source now receives a fresh key; timeout retains it.
  await start(secondSource, 5); // Changed intent clears the ambiguous key.
  const ids = await page.evaluate(() => window.starts.map(call => call.request_id));
  assert.equal(ids[0], ids[1], 'ambiguous retry reuses the logical request ID');
  assert.equal(ids[1], ids[2], 'retry_same_request retains the logical request ID');
  assert.notEqual(ids[2], ids[3], 'a definitive non-retry failure clears the logical request ID');
  assert.notEqual(ids[3], ids[4], 'changing the source clears an ambiguous logical request ID');
  assert.equal(new Set(ids).size, 3);
  await frame.evaluate(() => window.bridge.dispose());
});

test('Riff Home tolerates a transient status-read failure and refreshes recents at start and completion', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffHomeBridge } from './apps/panel/riff-home-bridge.ts';
    import { pipelineFixture } from './apps/panel/creator-pipeline/fixtures.ts';
    window.complete=pipelineFixture('video-analysis');
    window.pending=structuredClone(window.complete); window.pending.state='queued'; window.pending.result=null; window.pending.revision=1;
    window.running=structuredClone(window.pending); window.running.state='running'; window.running.revision=2;
    window.bridge=mountRiffHomeBridge(document.getElementById('mount'), {
      timeoutMs:500, toolTimeoutMs:80, pollIntervalMs:100, maxPollIntervalMs:160, maxPolls:3
    });
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/frame') return res.end(`<div id="mount"></div><script>${bundle.outputFiles[0].text}</script>`);
    res.end(`<script>
      window.getCalls=0; window.listCalls=0; window.ready=false;
      const frame=()=>document.querySelector('iframe').contentWindow;
      const result=(id,structuredContent)=>frame().postMessage({jsonrpc:'2.0',id,result:{content:[],structuredContent}},'*');
      addEventListener('message',e=>{const m=e.data;
        if(m.method==='ui/initialize') frame().postMessage({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params.protocolVersion,hostInfo:{name:'fixture',version:'1'},hostCapabilities:{serverTools:{},message:{text:{}}},hostContext:{}}},'*');
        if(m.method==='ui/notifications/initialized'){
          frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ok:true,data:{account:{id:'00000000-0000-4000-8000-000000000001',display_name:'Fixture',onboarding_seen_at:'2026-10-11T00:00:00Z'}}},content:[]}},'*');
          window.ready=true;
        }
        if(m.method!=='tools/call')return;
        if(m.params.name==='list_riff_work'){window.listCalls++;return result(m.id,{ok:true,data:{work:[]}});}
        if(m.params.name==='start_riff_creator')return result(m.id,{ok:true,data:{job:frame().pending}});
        if(m.params.name==='get_creator_job'){
          window.getCalls++;
          if(window.getCalls===1)return;
          return result(m.id,{ok:true,data:{job:window.getCalls===2?frame().running:frame().complete}});
        }
      });
    </script><iframe src="/frame"></iframe>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(); page.setDefaultTimeout(4_000);
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.ready);
  const frame = page.frames().find((item) => item.url().endsWith('/frame'));
  const source = 'https://www.tiktok.com/@fixture/video/7000000000000000001';
  const input = frame.getByPlaceholder('Share a video or profile link, or tell me what you want to make…');
  await input.fill(source); await input.press('Control+Enter');
  await frame.getByRole('button', { name: /Refresh saved job/ }).waitFor();
  assert.match(await frame.locator('.riff-home__job-id').textContent(), /^Job [0-9a-f-]{36}$/i);
  await frame.getByRole('heading', { name: 'Unlock your video’s viral potential.' }).waitFor();
  assert.equal(await page.evaluate(() => window.getCalls), 3, 'a transient read timeout does not stop bounded polling');
  await page.waitForFunction(() => window.listCalls >= 3);
  await frame.evaluate(() => window.bridge.dispose());
});
