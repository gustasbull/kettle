import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { build } from 'esbuild';

const internalUuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const internalWorkflowLanguage = /\b(?:creator job|recommendation batch|DNA(?: ID)?|script set|variant|file ID|save_creator_scripts)\b|\bversion\s+\d+\b/i;

test('Riff Home keeps onboarding in chat and runs the creator happy path in the app', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffHomeBridge } from './apps/panel/riff-home-bridge.ts';
    import { pipelineFixture } from './apps/panel/creator-pipeline/fixtures.ts';
    window.fixtures={scan:pipelineFixture('video-analysis'),ideas:pipelineFixture('ideas')};
    window.fixtures.ideas.id='00000000-0000-4000-8000-000000000630';
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
        if(m.method==='ui/initialize') frame().postMessage({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params.protocolVersion,hostInfo:{name:'fixture',version:'1'},hostCapabilities:{serverTools:{},experimental:{'openai/message':{}}},hostContext:{theme:'dark',locale:'lt',safeAreaInsets:{top:7,right:8,bottom:9,left:10},styles:{variables:{'--color-background-primary':'#101010'},css:{fonts:'body{letter-spacing:.01px}'}}}}},'*');
        if(m.method==='ui/notifications/initialized'){frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ok:true,data:{account:{id:'00000000-0000-4000-8000-000000000001',display_name:'Fixture',state:'active',preferred_language:'en',created_at:'2026-01-01T00:00:00Z',onboarding_seen_at:null},entitlements:{status:'not_configured'},usage:{status:'not_configured',reset_at:null}}},content:[]}},'*');window.ready=true;}
        if(m.method==='ui/message'){window.messages.push(m.params);frame().postMessage({jsonrpc:'2.0',id:m.id,result:{}},'*');}
        if(m.method==='tools/call'){
          window.calls.push(m.params);
          if(m.params.name==='start_riff_creator') return result(m.id,{ok:true,data:{job:frame().fixtures.scan}});
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

  assert.equal(await page.evaluate(() => window.calls.some(call => call.name === 'show_riff_welcome')), false,
    'Home does not try to render onboarding inside itself');

  const input = frame.getByPlaceholder('Share a video or profile link, or tell me what you want to make…');
  await frame.evaluate(() => { window.openai = { selectFiles: async () => [{fileId:'file_video',fileName:'clip.mp4',mimeType:'video/mp4'}] }; });
  await frame.getByRole('button', { name: 'Upload a video' }).click();
  await page.waitForFunction(() => window.messages.length === 1);
  const uploadMessage = await page.evaluate(() => window.messages[0].content[0].text);
  assert.match(uploadMessage, /selected.*clip\.mp4.*analy[sz]e/i);
  assert.doesNotMatch(uploadMessage, /file_video/i);
  assert.doesNotMatch(uploadMessage, internalWorkflowLanguage);

  await input.fill('A fast desk makeover with one surprising constraint'); await input.press('Control+Enter');
  await page.waitForFunction(() => window.messages.length === 2);
  assert.match(await page.evaluate(() => window.messages[1].content[0].text), /desk makeover.*clarifying/i);
  assert.equal(await page.evaluate(() => window.calls.filter(call => call.name === 'start_riff_creator').length), 0,
    'plain ideas continue in chat without spending provider credits');

  const source = 'https://vm.tiktok.com/ZN8kT9uhV/';
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
  await page.waitForFunction(() => window.messages.length === 3);
  const selectionMessage = await page.evaluate(() => window.messages[2].content[0].text);
  assert.match(selectionMessage, /One useful desk change.*complete video direction/i);
  assert.match(selectionMessage, /two or three.*filming variants/i);
  assert.doesNotMatch(selectionMessage, internalUuid);
  assert.doesNotMatch(selectionMessage, internalWorkflowLanguage);
  assert.equal(await page.evaluate(() => window.calls.filter(call => call.name === 'start_riff_creator').length), 1,
    'plain ideas continue in chat without spending provider credits');

  await frame.getByRole('button', { name: 'Open Riff menu' }).click();
  await frame.getByRole('button', { name: 'Fixture account menu' }).click();
  for (const [label, expectedCount] of [['Account settings', 4], ['Dark mode', 5], ['Support', 6], ['Give feedback', 7]]) {
    await frame.getByRole('menuitem', { name: label, exact: true }).click();
    await page.waitForFunction(count => window.messages.length === count, expectedCount);
  }
  const menuMessages = await page.evaluate(() => window.messages.slice(3).map(message => message.content[0].text));
  assert.match(menuMessages[0], /account settings.*host confirms/i);
  assert.match(menuMessages[1], /appearance settings.*follows the host theme.*cannot change/i);
  assert.match(menuMessages[2], /support with Riff.*support handoff/i);
  assert.match(menuMessages[3], /give feedback.*ChatGPT handoff/i);
  assert.equal(await frame.getByRole('menu', { name: 'Account' }).isVisible(), true,
    'host handoffs remain available without pretending navigation completed');

  assert.deepEqual(await page.evaluate(() => window.messages.map(message => message._meta['openai/message'])),
    Array.from({ length: 7 }, () => ({ target: 'active', send: true })));
  await page.evaluate(() => frame().postMessage({jsonrpc:'2.0',id:'teardown',method:'ui/resource-teardown',params:{}},'*'));
  await page.waitForFunction(() => window.tornDown);
  await frame.waitForFunction(() => document.querySelector('#mount').textContent === '');
});

test('Riff Home uses the ChatGPT compatibility tool bridge when MCP Apps serverTools is absent', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffHomeBridge } from './apps/panel/riff-home-bridge.ts';
    import { pipelineFixture } from './apps/panel/creator-pipeline/fixtures.ts';
    window.compatCalls=[];
    const scan=pipelineFixture('video-analysis');
    window.openai={callTool:async(name,args)=>{
      window.compatCalls.push({name,args});
      if(name==='list_riff_work')return {structuredContent:{ok:true,data:{work:[]}}};
      if(name==='start_riff_creator')return {structuredContent:{ok:true,data:{job:scan}}};
      return {structuredContent:{ok:false,error:{code:'NOT_FOUND',message:'Missing',retryable:false,recovery:'reload'}}};
    }};
    window.bridge=mountRiffHomeBridge(document.getElementById('mount'), {timeoutMs:500,toolTimeoutMs:500,maxPolls:0});
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/frame') return res.end(`<div id="mount"></div><script>${bundle.outputFiles[0].text}</script>`);
    res.end(`<script>
      window.ready=false;const frame=()=>document.querySelector('iframe').contentWindow;
      addEventListener('message',e=>{const m=e.data;
        if(m.method==='ui/initialize')frame().postMessage({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params.protocolVersion,hostInfo:{name:'chatgpt-compat',version:'1'},hostCapabilities:{message:{text:{}}},hostContext:{}}},'*');
        if(m.method==='ui/notifications/initialized'){
          frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ok:true,data:{account:{id:'00000000-0000-4000-8000-000000000001',display_name:'Fixture',onboarding_seen_at:null}}},content:[]}},'*');
          window.ready=true;
        }
      });
    </script><iframe src="/frame"></iframe>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(); page.setDefaultTimeout(3_000);
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.ready);
  const frame = page.frames().find((item) => item.url().endsWith('/frame'));
  const source = 'https://vm.tiktok.com/ZN8kT9uhV/';
  await frame.getByPlaceholder('Share a video or profile link, or tell me what you want to make…').fill(source);
  await frame.getByRole('button', { name: 'Find my next idea' }).click();
  await frame.getByRole('heading', { name: 'Unlock your video’s viral potential.' }).waitFor();
  const start = await frame.evaluate(() => window.compatCalls.find(call => call.name === 'start_riff_creator'));
  assert.equal(start.args.source_url, source);
  assert.match(start.args.request_id, /^[0-9a-f-]{36}$/i);
  assert.ok(await frame.evaluate(() => window.compatCalls.some(call => call.name === 'list_riff_work')));
});

test('Riff Home bounds stalled compatibility calls and reports rejected ChatGPT handoffs honestly', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffHomeBridge } from './apps/panel/riff-home-bridge.ts';
    window.openai={
      callTool:async(name)=>name==='list_riff_work'
        ? {structuredContent:{ok:true,data:{work:[]}}}
        : new Promise(()=>{}),
      sendFollowUpMessage:async()=>{throw new Error('fixture rejection')},
    };
    window.bridge=mountRiffHomeBridge(document.getElementById('mount'), {timeoutMs:500,toolTimeoutMs:60,maxPolls:0});
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/frame') return res.end(`<div id="mount"></div><script>${bundle.outputFiles[0].text}</script>`);
    res.end(`<script>
      window.ready=false;const frame=()=>document.querySelector('iframe').contentWindow;
      addEventListener('message',e=>{const m=e.data;
        if(m.method==='ui/initialize')frame().postMessage({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params.protocolVersion,hostInfo:{name:'compat-timeout',version:'1'},hostCapabilities:{},hostContext:{}}},'*');
        if(m.method==='ui/notifications/initialized'){
          frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ok:true,data:{account:{id:'00000000-0000-4000-8000-000000000001',display_name:'Fixture',onboarding_seen_at:null}}},content:[]}},'*');
          window.ready=true;
        }
      });
    </script><iframe src="/frame"></iframe>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(); page.setDefaultTimeout(3_000);
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.ready);
  const frame = page.frames().find((item) => item.url().endsWith('/frame'));
  const input = frame.getByPlaceholder('Share a video or profile link, or tell me what you want to make…');
  const submit = frame.getByRole('button', { name: 'Find my next idea' });

  await input.fill('https://www.tiktok.com/@fixture/video/7000000000000000001'); await submit.click();
  await frame.getByText(/could not confirm whether this analysis started/i).waitFor();
  assert.equal(await submit.isEnabled(), true, 'a stalled compatibility tool cannot leave the action locked');

  await input.fill('A quick desk makeover'); await submit.click();
  await frame.getByText(/handoff failed/i).waitFor();
  assert.equal(await submit.isEnabled(), true);
});

test('Riff Home reconciles the exact reported link after a timed-out start persisted the saved job', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffHomeBridge } from './apps/panel/riff-home-bridge.ts';
    import { pipelineFixture } from './apps/panel/creator-pipeline/fixtures.ts';
    window.job=pipelineFixture('video-analysis'); window.calls=[];
    window.openai={callTool:async(name,args)=>{
      window.calls.push({name,args});
      if(name==='list_riff_work')return {structuredContent:{ok:true,data:{work:[]}}};
      if(name==='start_riff_creator')return new Promise(()=>{});
      if(name==='get_riff_creator_start')return {structuredContent:{ok:true,data:{job:window.job}}};
      return {structuredContent:{ok:false,error:{code:'NOT_FOUND',message:'Missing',retryable:false,recovery:'reload'}}};
    }};
    window.bridge=mountRiffHomeBridge(document.getElementById('mount'), {timeoutMs:500,toolTimeoutMs:60,maxPolls:0});
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/frame') return res.end(`<div id="mount"></div><script>${bundle.outputFiles[0].text}</script>`);
    res.end(`<script>
      window.ready=false;const frame=()=>document.querySelector('iframe').contentWindow;
      addEventListener('message',e=>{const m=e.data;
        if(m.method==='ui/initialize')frame().postMessage({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params.protocolVersion,hostInfo:{name:'reconcile',version:'1'},hostCapabilities:{},hostContext:{}}},'*');
        if(m.method==='ui/notifications/initialized'){
          frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ok:true,data:{account:{id:'00000000-0000-4000-8000-000000000001',display_name:'Fixture',onboarding_seen_at:null}}},content:[]}},'*');
          window.ready=true;
        }
      });
    </script><iframe src="/frame"></iframe>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(); page.setDefaultTimeout(3_000);
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.ready);
  const frame = page.frames().find((item) => item.url().endsWith('/frame'));
  const source = 'https://vm.tiktok.com/ZN8kT85EE/';
  await frame.getByPlaceholder('Share a video or profile link, or tell me what you want to make…').fill(source);
  await frame.getByRole('button', { name: 'Find my next idea' }).click();
  await frame.getByRole('heading', { name: 'Unlock your video’s viral potential.' }).waitFor();
  const calls = await frame.evaluate(() => window.calls.filter(call => call.name !== 'list_riff_work'));
  assert.deepEqual(calls.map(call => call.name), ['start_riff_creator', 'get_riff_creator_start']);
  assert.deepEqual(calls[1].args, calls[0].args, 'reconciliation uses the exact request ID and source input');
});

test('Riff Home reconciles a malformed start response when the saved job exists', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffHomeBridge } from './apps/panel/riff-home-bridge.ts';
    import { pipelineFixture } from './apps/panel/creator-pipeline/fixtures.ts';
    window.job=pipelineFixture('video-analysis'); window.calls=[];
    window.openai={callTool:async(name,args)=>{
      window.calls.push({name,args});
      if(name==='list_riff_work')return {structuredContent:{ok:true,data:{work:[]}}};
      if(name==='start_riff_creator')return {structuredContent:{ok:true,data:{}}};
      if(name==='get_riff_creator_start')return {structuredContent:{ok:true,data:{job:window.job}}};
      return {structuredContent:{ok:false,error:{code:'NOT_FOUND',message:'Missing',retryable:false,recovery:'reload'}}};
    }};
    window.bridge=mountRiffHomeBridge(document.getElementById('mount'), {timeoutMs:500,toolTimeoutMs:100,maxPolls:0});
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/frame') return res.end(`<div id="mount"></div><script>${bundle.outputFiles[0].text}</script>`);
    res.end(`<script>
      window.ready=false;const frame=()=>document.querySelector('iframe').contentWindow;
      addEventListener('message',e=>{const m=e.data;
        if(m.method==='ui/initialize')frame().postMessage({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params.protocolVersion,hostInfo:{name:'malformed-start',version:'1'},hostCapabilities:{},hostContext:{}}},'*');
        if(m.method==='ui/notifications/initialized'){
          frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ok:true,data:{account:{id:'00000000-0000-4000-8000-000000000001',display_name:'Fixture',onboarding_seen_at:null}}},content:[]}},'*');
          window.ready=true;
        }
      });
    </script><iframe src="/frame"></iframe>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(); page.setDefaultTimeout(3_000);
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.ready);
  const frame = page.frames().find((item) => item.url().endsWith('/frame'));
  const source = 'https://vm.tiktok.com/ZN8kT85EE/';
  await frame.getByPlaceholder('Share a video or profile link, or tell me what you want to make…').fill(source);
  await frame.getByRole('button', { name: 'Find my next idea' }).click();
  await frame.getByRole('heading', { name: 'Unlock your video’s viral potential.' }).waitFor();
  const calls = await frame.evaluate(() => window.calls.filter(call => call.name !== 'list_riff_work'));
  assert.deepEqual(calls.map(call => call.name), ['start_riff_creator', 'get_riff_creator_start']);
  assert.deepEqual(calls[1].args, calls[0].args, 'malformed start reconciliation uses the exact original input');
});

test('Riff Home preserves a definitely absent intent and maps returned application failures', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffHomeBridge } from './apps/panel/riff-home-bridge.ts';
    window.starts=[]; window.lookups=[];
    const failure=(code,recovery)=>({structuredContent:{ok:false,error:{code,message:'fixture detail',retryable:false,recovery}}});
    window.openai={callTool:async(name,args)=>{
      if(name==='list_riff_work')return {structuredContent:{ok:true,data:{work:[]}}};
      if(name==='get_riff_creator_start'){window.lookups.push(args);return failure('NOT_FOUND','reload');}
      if(name==='start_riff_creator'){
        window.starts.push(args);
        if(window.starts.length<=2)return new Promise(()=>{});
        if(window.starts.length===3)return failure('FORBIDDEN','contact_support');
        return failure('VALIDATION_ERROR','correct_input');
      }
    }};
    window.bridge=mountRiffHomeBridge(document.getElementById('mount'), {timeoutMs:500,toolTimeoutMs:60,maxPolls:0});
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/frame') return res.end(`<div id="mount"></div><script>${bundle.outputFiles[0].text}</script>`);
    res.end(`<script>
      window.ready=false;const frame=()=>document.querySelector('iframe').contentWindow;
      addEventListener('message',e=>{const m=e.data;
        if(m.method==='ui/initialize')frame().postMessage({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params.protocolVersion,hostInfo:{name:'absent',version:'1'},hostCapabilities:{},hostContext:{}}},'*');
        if(m.method==='ui/notifications/initialized'){
          frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ok:true,data:{account:{id:'00000000-0000-4000-8000-000000000001',display_name:'Fixture',onboarding_seen_at:null}}},content:[]}},'*');window.ready=true;
        }
      });
    </script><iframe src="/frame"></iframe>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(); page.setDefaultTimeout(3_000);
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.ready);
  const frame = page.frames().find((item) => item.url().endsWith('/frame'));
  const input = frame.getByPlaceholder('Share a video or profile link, or tell me what you want to make…');
  const submit = frame.getByRole('button', { name: 'Find my next idea' });
  const source = 'https://vm.tiktok.com/ZN8kT85EE/';
  await input.fill(source); await submit.click();
  await frame.getByText(/was not saved|did not save/i).waitFor();
  assert.equal(await input.inputValue(), source);
  assert.equal(await frame.evaluate(() => window.starts.length), 1);
  await frame.waitForTimeout(120);
  assert.equal(await frame.evaluate(() => window.starts.length), 1, 'a NOT_FOUND lookup never resubmits a start automatically');
  await submit.click();
  await frame.getByText(/was not saved|did not save/i).waitFor();
  let starts = await frame.evaluate(() => window.starts);
  assert.equal(starts[0].request_id, starts[1].request_id, 'exact explicit retry reuses the absent logical request ID');
  const equivalentSource = 'https://VM.TIKTOK.COM:443/ZN8kT85EE/';
  await input.fill(equivalentSource); await submit.click();
  await frame.getByText(/development access or trial allowance/i).waitFor();
  starts = await frame.evaluate(() => window.starts);
  assert.notEqual(starts[1].request_id, starts[2].request_id,
    'an exact-string edit receives a new request ID even when URL normalization is equivalent');
  assert.equal(starts[2].source_url, equivalentSource, 'the idempotency identity matches the exact transformed server input');
  assert.doesNotMatch(await frame.getByRole('status').textContent(), /unrecognized|public TikTok|could not confirm/i);
  const invalid = 'https://www.tiktok.com/@fixture/video/7000000000000000002';
  await input.fill(invalid); await submit.click();
  await frame.getByText(/Use a public TikTok video or creator-profile link/i).waitFor();
  starts = await frame.evaluate(() => window.starts);
  assert.notEqual(starts[2].request_id, starts[3].request_id);
});

test('Riff Home safely maps host-rejected allowance and validation failures without exception text', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffHomeBridge } from './apps/panel/riff-home-bridge.ts';
    window.bridge=mountRiffHomeBridge(document.getElementById('mount'), {timeoutMs:500,toolTimeoutMs:200,maxPolls:0});
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/frame') return res.end(`<div id="mount"></div><script>${bundle.outputFiles[0].text}</script>`);
    res.end(`<script>
      window.starts=0;window.lookups=0;window.ready=false;const frame=()=>document.querySelector('iframe').contentWindow;
      const failure=(code,recovery)=>({structuredContent:{ok:false,error:{code,message:'server-only detail',retryable:false,recovery}}});
      addEventListener('message',e=>{const m=e.data;
        if(m.method==='ui/initialize')frame().postMessage({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params.protocolVersion,hostInfo:{name:'rejected-errors',version:'1'},hostCapabilities:{serverTools:{}},hostContext:{}}},'*');
        if(m.method==='ui/notifications/initialized'){
          frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ok:true,data:{account:{id:'00000000-0000-4000-8000-000000000001',display_name:'Fixture',onboarding_seen_at:null}}},content:[]}},'*');window.ready=true;
        }
        if(m.method==='tools/call'&&m.params.name==='list_riff_work')return frame().postMessage({jsonrpc:'2.0',id:m.id,result:{content:[],structuredContent:{ok:true,data:{work:[]}}}},'*');
        if(m.method==='tools/call'&&m.params.name==='get_riff_creator_start'){window.lookups++;return;}
        if(m.method==='tools/call'&&m.params.name==='start_riff_creator'){
          window.starts++;const code=window.starts===1?'FORBIDDEN':'VALIDATION_ERROR';const recovery=window.starts===1?'contact_support':'correct_input';
          return frame().postMessage({jsonrpc:'2.0',id:m.id,error:{code:-32603,message:'SECRET host exception text',data:failure(code,recovery)}},'*');
        }
      });
    </script><iframe src="/frame"></iframe>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(); page.setDefaultTimeout(3_000);
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.ready);
  const frame = page.frames().find((item) => item.url().endsWith('/frame'));
  const input = frame.getByPlaceholder('Share a video or profile link, or tell me what you want to make…');
  const submit = frame.getByRole('button', { name: 'Find my next idea' });
  await input.fill('https://www.tiktok.com/@fixture/video/7000000000000000001'); await submit.click();
  await frame.getByText(/development access or trial allowance/i).waitFor();
  assert.doesNotMatch(await frame.getByRole('status').textContent(), /SECRET|could not confirm|public TikTok/i);
  await input.fill('https://www.tiktok.com/@fixture/video/7000000000000000002'); await submit.click();
  await frame.getByText(/Use a public TikTok video or creator-profile link/i).waitFor();
  assert.doesNotMatch(await frame.getByRole('status').textContent(), /SECRET|could not confirm/i);
  assert.equal(await page.evaluate(() => window.lookups), 0, 'definite application failures never enter ambiguous recovery');
});

test('Riff Home does not carry an ambiguous request ID across an account change', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffHomeBridge } from './apps/panel/riff-home-bridge.ts';
    window.starts=[];window.lookups=0;window.activeAccountId='00000000-0000-4000-8000-000000000001';
    const firstWork={
      project_id:'00000000-0000-4000-8000-000000000010',project_name:'First account work',
      job_id:'00000000-0000-4000-8000-000000000011',kind:'scan',state:'succeeded',updated_at:'2026-10-11T00:00:00Z',
      source:{platform:'tiktok',kind:'profile',handle:'old.creator',canonical_url:'https://www.tiktok.com/@old.creator',profile_url:'https://www.tiktok.com/@old.creator',video_url:null}
    };
    window.openai={callTool:async(name,args)=>{
      if(name==='list_riff_work')return {structuredContent:{ok:true,data:{work:window.activeAccountId.endsWith('1')?[firstWork]:[]}}};
      if(name==='get_riff_creator_start'){window.lookups++;return {structuredContent:{ok:false,error:{code:'NOT_FOUND',message:'Missing',retryable:false,recovery:'reload'}}};}
      if(name==='start_riff_creator'){
        window.starts.push(args);
        if(window.starts.length===1)return new Promise(()=>{});
        return {structuredContent:{ok:false,error:{code:'VALIDATION_ERROR',message:'Invalid',retryable:false,recovery:'correct_input'}}};
      }
    }};
    window.bridge=mountRiffHomeBridge(document.getElementById('mount'), {timeoutMs:500,toolTimeoutMs:90,maxPolls:0});
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/frame') return res.end(`<div id="mount"></div><script>${bundle.outputFiles[0].text}</script>`);
    res.end(`<script>
      window.ready=false;const frame=()=>document.querySelector('iframe').contentWindow;
      const account=id=>{frame().activeAccountId=id;frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ok:true,data:{account:{id,display_name:id.endsWith('1')?'First account':'Second account',onboarding_seen_at:'2026-10-11T00:00:00Z'}}},content:[]}},'*');};
      window.changeAccount=()=>account('00000000-0000-4000-8000-000000000002');
      addEventListener('message',e=>{const m=e.data;
        if(m.method==='ui/initialize')frame().postMessage({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params.protocolVersion,hostInfo:{name:'account-change',version:'1'},hostCapabilities:{},hostContext:{}}},'*');
        if(m.method==='ui/notifications/initialized'){account('00000000-0000-4000-8000-000000000001');window.ready=true;}
      });
    </script><iframe src="/frame"></iframe>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(); page.setDefaultTimeout(3_000);
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.ready);
  const frame = page.frames().find((item) => item.url().endsWith('/frame'));
  const input = frame.getByPlaceholder('Share a video or profile link, or tell me what you want to make…');
  const submit = frame.getByRole('button', { name: 'Find my next idea' });
  await frame.getByRole('button', { name: 'Open Riff menu' }).click();
  await frame.getByRole('button', { name: 'Open First account work — Analysis' }).waitFor();
  const drawer = frame.getByRole('dialog', { name: 'Riff menu' });
  await frame.getByRole('button', { name: 'Close Riff menu' }).last().click();
  const source = 'https://vm.tiktok.com/ZN8kT85EE/';
  await input.fill(source); await submit.click();
  await frame.waitForFunction(() => window.starts.length === 1);
  await frame.getByRole('button', { name: 'Open Riff menu' }).click();
  await page.evaluate(() => window.changeAccount());
  await frame.waitForFunction(() => document.querySelector('.riff-menu__account-trigger')?.getAttribute('aria-label') === 'Second account account menu');
  assert.equal(await drawer.isHidden(), true, 'account replacement closes the open menu');
  assert.equal(await frame.getByText('First account work').count(), 0,
    'account replacement clears old private recents before the new load completes');
  await frame.waitForFunction(() => !document.querySelector('.riff-home__submit')?.disabled);
  await frame.getByRole('button', { name: 'Open Riff menu' }).click();
  assert.equal(await frame.getByText('First account work').count(), 0,
    'the old account recent never returns in the replacement account drawer');
  await frame.getByRole('button', { name: 'Close Riff menu' }).last().click();
  await input.fill(source);
  await submit.click(); await frame.getByText(/Use a public TikTok video or creator-profile link/i).waitFor();
  const starts = await frame.evaluate(() => window.starts);
  assert.notEqual(starts[0].request_id, starts[1].request_id);
  assert.equal(await frame.evaluate(() => window.lookups), 0, 'the old account pending start is not reconciled under the new account');
});

test('Riff Home ignores a catalog response from the previous account', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffHomeBridge } from './apps/panel/riff-home-bridge.ts';
    window.catalogCalls=[];
    window.openai={callTool:async(name,args)=>{
      if(name==='list_riff_work')return {structuredContent:{ok:true,data:{work:[]}}};
      if(name==='list_riff_videos')return new Promise(resolve=>window.catalogCalls.push({args,resolve}));
      return {structuredContent:{ok:false,error:{code:'NOT_FOUND',message:'Missing',retryable:false,recovery:'reload'}}};
    }};
    window.bridge=mountRiffHomeBridge(document.getElementById('mount'), {timeoutMs:500,toolTimeoutMs:500,maxPolls:0});
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/frame') return res.end(`<div id="mount"></div><script>${bundle.outputFiles[0].text}</script>`);
    res.end(`<script>
      window.ready=false;const frame=()=>document.querySelector('iframe').contentWindow;
      window.account=id=>frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ok:true,data:{account:{id,display_name:'Fixture',onboarding_seen_at:null}}},content:[]}},'*');
      addEventListener('message',e=>{const m=e.data;
        if(m.method==='ui/initialize')frame().postMessage({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params.protocolVersion,hostInfo:{name:'catalog-account-change',version:'1'},hostCapabilities:{},hostContext:{}}},'*');
        if(m.method==='ui/notifications/initialized'){window.account('00000000-0000-4000-8000-000000000001');window.ready=true;}
      });
    </script><iframe src="/frame"></iframe>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(); page.setDefaultTimeout(3_000);
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.ready);
  const frame = page.frames().find((item) => item.url().endsWith('/frame'));
  await frame.getByRole('button', { name: 'Trending videos', exact: true }).click();
  await frame.waitForFunction(() => window.catalogCalls.length === 1);

  await page.evaluate(() => window.account('00000000-0000-4000-8000-000000000002'));
  await frame.getByRole('button', { name: 'Trending videos', exact: true }).waitFor();
  await frame.evaluate(() => window.catalogCalls[0].resolve({structuredContent:{ok:true,data:{
    cards:[{
      id:'00000000-0000-4000-8000-000000000801',platform:'tiktok',native_id:'9000000000000000801',
      canonical_url:'https://www.tiktok.com/@fictional_catalog/video/9000000000000000801',caption:'Account A secret',
      thumbnail_url:null,published_at:null,duration_seconds:null,
      metrics:{views:null,likes:null,comments:null,shares:null,saves:null},
      retrieved_at:'2026-10-11T12:00:00Z',source_observed_at:null,observed_at:'2026-10-11T12:00:00Z',
      origin:'fixture',role:'discovered_reference',permission_basis:'Authored browser fixture for safe rendering.',limitations:[],
    }],next_cursor:null,coverage:'Saved observations only.',freshness:'As last observed.',
  }}}));
  await frame.waitForTimeout(50);
  await frame.getByRole('button', { name: 'Trending videos', exact: true }).click();
  await frame.waitForFunction(() => window.catalogCalls.length === 2);
  assert.doesNotMatch(await frame.locator('body').textContent(), /Account A secret/,
    'a late catalog response cannot cross the account boundary or seed the next account cache');
});

test('Riff Home defers a catalog shortcut until the first account is ready', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffHomeBridge } from './apps/panel/riff-home-bridge.ts';
    window.catalogCalls=[];window.toolNames=[];
    const card=index=>({
      id:\`00000000-0000-4000-8000-0000000009\${String(index).padStart(2,'0')}\`,platform:'tiktok',native_id:\`90000000000000009\${index}\`,
      canonical_url:\`https://www.tiktok.com/@fictional_catalog/video/90000000000000009\${index}\`,caption:\`Home catalog caption \${index+1}\`,
      thumbnail_url:null,published_at:null,duration_seconds:null,metrics:{views:index,likes:null,comments:null,shares:null,saves:null},
      retrieved_at:'2026-10-11T12:00:00Z',source_observed_at:null,observed_at:'2026-10-11T12:00:00Z',origin:'fixture',
      role:'discovered_reference',permission_basis:'Authored browser fixture for safe rendering.',limitations:[],
    });
    window.openai={callTool:async(name,args)=>{
      window.toolNames.push(name);
      if(name==='list_riff_work')return {structuredContent:{ok:true,data:{work:[]}}};
      if(name==='list_riff_videos'){window.catalogCalls.push(args);return {structuredContent:{ok:true,data:{
        cards:Array.from({length:8},(_,offset)=>card(offset)),next_cursor:'page-2',
        coverage:'Saved observations only.',freshness:'As last observed.'}}};}
    }};
    window.bridge=mountRiffHomeBridge(document.getElementById('mount'), {timeoutMs:500,toolTimeoutMs:500,maxPolls:0});
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/frame') return res.end(`<div id="mount"></div><script>${bundle.outputFiles[0].text}</script>`);
    res.end(`<script>
      window.ready=false;window.initializeId=undefined;window.initializeVersion=undefined;const frame=()=>document.querySelector('iframe').contentWindow;
      window.sendAccount=()=>frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ok:true,data:{account:{id:'00000000-0000-4000-8000-000000000001',display_name:'Fixture',onboarding_seen_at:null}}},content:[]}},'*');
      window.finishConnect=()=>frame().postMessage({jsonrpc:'2.0',id:window.initializeId,result:{protocolVersion:window.initializeVersion,hostInfo:{name:'catalog-before-account',version:'1'},hostCapabilities:{},hostContext:{}}},'*');
      addEventListener('message',e=>{const m=e.data;
        if(m.method==='ui/initialize'){window.initializeId=m.id;window.initializeVersion=m.params.protocolVersion;window.ready=true;}
        if(m.method==='ui/notifications/initialized')window.sendAccount();
      });
    </script><iframe src="/frame"></iframe>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(); page.setDefaultTimeout(3_000);
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.ready);
  const frame = page.frames().find((item) => item.url().endsWith('/frame'));
  await frame.getByRole('button', { name: 'Trending videos', exact: true }).click();
  await frame.waitForTimeout(50);
  assert.equal(await frame.evaluate(() => window.catalogCalls.length),0,'no account-scoped read starts before the host connection and identity are ready');
  await page.evaluate(() => window.finishConnect());
  await frame.waitForFunction(() => window.catalogCalls.length === 1);
  assert.deepEqual(await frame.evaluate(() => window.catalogCalls[0]),{sort:'observed_at_desc',limit:8});
  await frame.waitForFunction(()=>document.querySelectorAll('[data-catalog-card]').length===8);
  for(let index=0;index<6;index+=1)await frame.getByRole('button',{name:'Next video'}).click();
  assert.equal(await frame.evaluate(()=>window.catalogCalls.length),1,'positions before the eighth card stay local');
  await frame.getByRole('button',{name:'Next video'}).click();
  assert.equal(await frame.evaluate(()=>window.catalogCalls.length),1,'the eighth card does not consume the retained cursor');
  assert.equal(await frame.locator('[data-catalog-card]').count(),8,'only one Paper page is rendered');
  await frame.getByRole('button',{name:'Next video'}).click();
  assert.match(await frame.locator('[data-active-catalog]').textContent(),/Home catalog caption 1/,
    'the one-page carousel wraps locally');
  await frame.getByRole('button',{name:'Previous video'}).click();
  assert.match(await frame.locator('[data-active-catalog]').textContent(),/Home catalog caption 8/);
  const callsAfterBrowsing=await frame.evaluate(()=>window.catalogCalls.length);
  await frame.getByRole('button',{name:'Quick demos',exact:true}).click();
  await frame.getByRole('button',{name:'For you',exact:true}).click();
  assert.equal(await frame.evaluate(()=>window.catalogCalls.length),callsAfterBrowsing,'loaded filters stay local');
  assert.equal(await frame.evaluate(()=>window.toolNames.some(name=>/^start_|refresh|discover|generate/.test(name))),false,
    'catalog browsing never invokes a provider-start tool');
});

test('Riff Home ignores an older start response after a newer creator intent wins', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffHomeBridge } from './apps/panel/riff-home-bridge.ts';
    import { pipelineFixture } from './apps/panel/creator-pipeline/fixtures.ts';
    window.video=pipelineFixture('video-analysis'); window.profile=pipelineFixture('scan'); window.pendingStarts=[];
    window.openai={callTool:async(name,args)=>{
      if(name==='list_riff_work')return {structuredContent:{ok:true,data:{work:[]}}};
      if(name==='start_riff_creator')return new Promise(resolve=>window.pendingStarts.push({args,resolve}));
      return {structuredContent:{ok:false,error:{code:'NOT_FOUND',message:'Missing',retryable:false,recovery:'reload'}}};
    }};
    window.bridge=mountRiffHomeBridge(document.getElementById('mount'), {timeoutMs:500,toolTimeoutMs:500,maxPolls:0});
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/frame') return res.end(`<div id="mount"></div><script>${bundle.outputFiles[0].text}</script>`);
    res.end(`<script>
      window.ready=false;const frame=()=>document.querySelector('iframe').contentWindow;
      addEventListener('message',e=>{const m=e.data;
        if(m.method==='ui/initialize')frame().postMessage({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params.protocolVersion,hostInfo:{name:'compat-ordering',version:'1'},hostCapabilities:{},hostContext:{}}},'*');
        if(m.method==='ui/notifications/initialized'){
          frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ok:true,data:{account:{id:'00000000-0000-4000-8000-000000000001',display_name:'Fixture',onboarding_seen_at:null}}},content:[]}},'*');
          window.ready=true;
        }
      });
    </script><iframe src="/frame"></iframe>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(); page.setDefaultTimeout(3_000);
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.ready);
  const frame = page.frames().find((item) => item.url().endsWith('/frame'));
  const input = frame.getByPlaceholder('Share a video or profile link, or tell me what you want to make…');
  await input.fill('https://www.tiktok.com/@fixture/video/7000000000000000001');
  await frame.locator('form').evaluate(form => form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true })));
  await frame.waitForFunction(() => window.pendingStarts.length === 1);
  await input.fill('https://www.tiktok.com/@fixture/video/7000000000000000002');
  await frame.locator('form').evaluate(form => form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true })));
  await frame.waitForFunction(() => window.pendingStarts.length === 2);

  await frame.evaluate(() => window.pendingStarts[1].resolve({structuredContent:{ok:true,data:{job:window.profile}}}));
  await frame.getByRole('heading', { name: 'Turn what’s working into your next breakout.' }).waitFor();
  await frame.evaluate(() => window.pendingStarts[0].resolve({structuredContent:{ok:true,data:{job:window.video}}}));
  await frame.waitForTimeout(100);
  assert.equal(await frame.getByRole('heading', { name: 'Turn what’s working into your next breakout.' }).count(), 1,
    'the older response cannot replace the newer selected workflow');
  assert.equal(await frame.getByRole('heading', { name: 'Unlock your video’s viral potential.' }).count(), 0);
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
    window.complete.revision=3;
    window.pending=structuredClone(window.complete); window.pending.state='queued'; window.pending.result=null; window.pending.revision=1;
    window.pending.stage='accepted'; window.pending.progress={kind:'scan',profile:null,videos:[],limitations:[]};
    window.running=structuredClone(window.pending); window.running.state='running'; window.running.revision=2; window.running.stage='reviewing_video';
    window.bridge=mountRiffHomeBridge(document.getElementById('mount'), {
      timeoutMs:500, toolTimeoutMs:80, pollIntervalMs:100, maxPollIntervalMs:160, maxPolls:3
    });
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/frame') return res.end(`<div id="mount"></div><script>${bundle.outputFiles[0].text}</script>`);
    res.end(`<script>
      window.statusCalls=0; window.fullCalls=0; window.listCalls=0; window.ready=false;
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
        if(m.params.name==='get_creator_job_status'){
          window.statusCalls++;
          if(window.statusCalls===1)return;
          const job=window.statusCalls===2?frame().running:frame().complete;
          return result(m.id,{ok:true,data:{status:{id:job.id,kind:job.kind,state:job.state,stage:job.stage,
            revision:job.revision,created_at:job.created_at,updated_at:job.updated_at,progress:job.progress,
            terminal_result_available:job.state==='succeeded'}}});
        }
        if(m.params.name==='get_creator_job'){window.fullCalls++;return result(m.id,{ok:true,data:{job:frame().complete}});}
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
  await frame.getByRole('heading', { name: 'Unlock your video’s viral potential.' }).waitFor();
  assert.equal(await frame.getByRole('button', { name: /Refresh saved job/ }).count(), 0);
  assert.equal(await frame.locator('.riff-home__job-id').count(), 0);
  assert.equal(await page.evaluate(() => window.statusCalls), 3, 'a transient compact-status timeout does not stop bounded polling');
  assert.equal(await page.evaluate(() => window.fullCalls), 1, 'the terminal result is read in full exactly once');
  await page.waitForFunction(() => window.listCalls >= 3);
  await frame.evaluate(() => window.bridge.dispose());
});
