import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { build } from 'esbuild';

const internalUuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const internalWorkflowLanguage = /\b(?:creator job|recommendation batch|DNA(?: ID)?|script set|variant|file ID|save_creator_scripts)\b|\bversion\s+\d+\b/i;

test('raw open_riff keeps first-use Home usable while the separate welcome stays in chat', async (t) => {
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
          if(m.params.name==='mark_riff_onboarding_seen') return result(m.id,{ok:true,data:{onboarding_seen_at:'2026-01-01T00:01:00Z'}});
          if(m.params.name==='list_riff_work') return result(m.id,{ok:true,data:{work:[]}});
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
  assert.equal(await frame.getByRole('region', { name: 'Welcome to Riff' }).count(), 0,
    'the inline welcome belongs in the originating ChatGPT conversation, not Home');
  assert.equal(await frame.getByPlaceholder('Share a video or profile link, or tell me what you want to make…').isVisible(), true,
    'Home remains independently usable on first open');
  assert.equal(await page.evaluate(() => window.calls.some(call => call.name === 'mark_riff_onboarding_seen')), false,
    'Home never writes the welcome marker');
  assert.equal(await page.evaluate(() => window.calls.some(call => call.name === 'list_riff_work')), false,
    'private recent work waits until the separate welcome is completed');

  assert.equal(await page.evaluate(() => window.calls.some(call => call.name === 'show_riff_welcome')), false,
    'the resource does not depend on model-orchestrated welcome calls');

  const input = frame.getByPlaceholder('Share a video or profile link, or tell me what you want to make…');
  await frame.evaluate(() => { window.openai = { selectFiles: async () => [{fileId:'file_video',fileName:'clip.mp4',mimeType:'video/mp4'}] }; });
  await frame.getByRole('button', { name: 'Upload a video' }).click();
  await page.waitForFunction(() => window.messages.length === 1);
  const uploadMessage = await page.evaluate(() => window.messages[0].content[0].text);
  assert.match(uploadMessage, /selected.*clip\.mp4.*analy[sz]e/i);
  assert.doesNotMatch(uploadMessage, /file_video/i);
  assert.doesNotMatch(uploadMessage, internalWorkflowLanguage);

  await input.fill('A fast desk makeover with one surprising constraint'); await input.press('Control+Enter');
  assert.equal(await frame.getByRole('group', { name: 'What did you share?' }).count(), 1);
  assert.equal(await frame.getByRole('button', { name: 'Product description' }).count(), 1);
  assert.equal(await frame.getByRole('button', { name: 'Video idea' }).count(), 1);
  assert.equal(await page.evaluate(() => window.messages.length), 1,
    'non-URL text waits for an explicit local intent choice');
  assert.equal(await page.evaluate(() => window.calls.some(call => /provider|creator|recommendation/i.test(call.name))), false,
    'the local intent choice does not call a classifier, model, or provider');
  await frame.getByRole('button', { name: 'Video idea' }).click();
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
  assert.equal(await page.evaluate(() => window.calls.filter(call => call.name === 'list_riff_work').length),1,
    'an explicit creator action may refresh authenticated work without exposing first-use recents');
  assert.equal(await frame.getByRole('heading',{name:'Pick up where you left off'}).isHidden(),true,
    'a null first-use marker keeps private recents visually closed while the creator workflow remains usable');

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
  assert.deepEqual(await frame.getByRole('dialog', { name: 'Riff menu' }).evaluate(node => {
    const style=getComputedStyle(node);return {background:style.backgroundColor,color:style.color};
  }), {background:'rgb(16, 16, 16)',color:'rgb(246, 247, 249)'},
  'the real dark host context themes the menu surface and text');
  await frame.getByRole('button', { name: 'Fixture account menu' }).click();
  assert.equal(await frame.getByRole('menu', { name: 'Account' }).evaluate(node => getComputedStyle(node).backgroundColor),
    'rgb(16, 16, 16)');
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

test('Riff Home accepts only a coherent complete initial result and preserves the current account on malformed notifications',async t=>{
  const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:`
    import { mountRiffHomeBridge } from './apps/panel/riff-home-bridge.ts';
    window.calls=[];window.getterReads=0;
    const addWindowListener=window.addEventListener.bind(window);
    window.addEventListener=(type,listener,options)=>{
      if(type==='message')window.receiveHostMessage=listener;
      return addWindowListener(type,listener,options);
    };
    window.openai={callTool:async(name,args)=>{window.calls.push({name,args});return {structuredContent:{ok:true,data:{work:[]}}};}};
    window.emitResult=params=>window.receiveHostMessage({source:window.parent,data:{
      jsonrpc:'2.0',method:'ui/notifications/tool-result',params,
    }});
    window.accountContent=(id,name='Fixture')=>({ok:true,data:{account:{
      id,display_name:name,state:'active',preferred_language:'en',created_at:'2026-10-11T00:00:00Z',onboarding_seen_at:'2026-01-01T00:02:00Z',
    },entitlements:{status:'not_configured'},usage:{status:'not_configured',reset_at:null}}});
    window.accountResult=(id,name='Fixture')=>({structuredContent:window.accountContent(id,name),content:[],isError:false,_meta:{}});
    window.malformedAccountResults=id=>{
      const make=mutate=>{const content=structuredClone(window.accountContent(id,'Malformed account'));mutate(content);return {
        structuredContent:content,content:[],isError:false,_meta:{},
      };};
      return [
        make(content=>{content.data.account.id='';}),
        make(content=>{content.data.account.id='not-a-uuid';}),
        make(content=>{content.data.account.state='suspended';}),
        make(content=>{delete content.data.account.preferred_language;}),
        make(content=>{content.data.account.created_at='yesterday';}),
        make(content=>{content.data.account.onboarding_seen_at='not-a-timestamp';}),
        make(content=>{content.data.entitlements.status='configured';}),
        make(content=>{content.data.usage.reset_at='2026-10-12T00:00:00Z';}),
        make(content=>{content.data.account.private_owner='spoof';}),
        make(content=>{content.data.entitlements.private_plan='spoof';}),
        make(content=>{content.data.usage.private_total=1;}),
        make(content=>{content.data.private_account_id=id;}),
      ];
    };
    window.mutatingResult=(id)=>{
      const original={ok:true,data:{account:{id,display_name:'Injected account',onboarding_seen_at:'2026-01-01T00:02:00Z'}}};
      const injected={ok:false,error:{code:'VERSION_CONFLICT',message:'Injected.',retryable:false,recovery:'reload'}};
      const result={structuredContent:original,content:[],isError:true,_meta:{}};
      result._meta.mutator=new Proxy({}, {getPrototypeOf(){
        Object.defineProperty(result,'structuredContent',{configurable:true,enumerable:true,get(){
          window.getterReads++;
          Object.defineProperty(result,'structuredContent',{configurable:true,enumerable:true,writable:true,value:original});
          return injected;
        }});
        return Object.prototype;
      }});
      return result;
    };
    window.bridge=mountRiffHomeBridge(document.getElementById('mount'),{timeoutMs:500,toolTimeoutMs:500,maxPolls:0});
  `},bundle:true,platform:'browser',format:'iife',write:false});
  const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');
    if(req.url==='/frame')return res.end(`<div id="mount"></div><script>${bundle.outputFiles[0].text}</script>`);
    res.end(`<script>window.ready=false;const frame=()=>document.querySelector('iframe').contentWindow;
      addEventListener('message',event=>{const message=event.data;
        if(message.method==='ui/initialize')frame().postMessage({jsonrpc:'2.0',id:message.id,result:{protocolVersion:message.params.protocolVersion,
          hostInfo:{name:'strict-initial-result',version:'1'},hostCapabilities:{},hostContext:{}}},'*');
        if(message.method==='ui/notifications/initialized')window.ready=true;
      });</script><iframe src="/frame"></iframe>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage();page.setDefaultTimeout(4_000);
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.ready);
  const frame=page.frames().find(candidate=>candidate.url().endsWith('/frame'));
  const account1='00000000-0000-4000-8000-000000000001';
  const account2='00000000-0000-4000-8000-000000000002';
  await frame.evaluate(([first,second])=>{
    const valid=window.accountResult(first,'First account');
    const malformed=[
      {...valid,isError:true},
      {...valid,content:{}},
      {...valid,_meta:1},
      Object.assign(Object.create(null),valid),
      window.mutatingResult(second),
      ...window.malformedAccountResults(second),
    ];
    for(const result of malformed)window.emitResult(result);
  },[account1,account2]);
  await frame.waitForTimeout(50);
  assert.equal(await frame.getByPlaceholder('Share a video or profile link, or tell me what you want to make…').isVisible(),true,
    'an unreadable initial account result fails open to the recoverable Home surface');
  assert.equal(await frame.locator('.riff-home__account').textContent(),'Account unavailable');
  assert.match(await frame.locator('.riff-home__status').textContent(),/incomplete account details|could not read this account/i);
  assert.equal(await frame.evaluate(()=>window.calls.filter(call=>call.name==='list_riff_work').length),0,
    'malformed initial notifications cannot start an account-scoped list');
  assert.equal(await frame.evaluate(()=>document.querySelector('.riff-menu__account-trigger')?.getAttribute('aria-label')),'Riff account menu',
    'malformed initial notifications cannot establish an account');
  assert.equal(await frame.evaluate(()=>window.getterReads),0,'the restoring getter is never read');

  await frame.evaluate(id=>window.emitResult(window.accountResult(id,'First account')),account1);
  await frame.waitForFunction(()=>document.querySelector('.riff-menu__account-trigger')?.getAttribute('aria-label')==='First account account menu');
  await frame.waitForFunction(()=>window.calls.filter(call=>call.name==='list_riff_work').length===1);
  assert.equal(await frame.getByRole('region',{name:'Welcome to Riff'}).count(),0,
    'a valid first-use account still keeps the welcome in chat');
  const listCount=await frame.evaluate(()=>window.calls.filter(call=>call.name==='list_riff_work').length);

  await frame.evaluate(id=>{
    const valid=window.accountResult(id,'Second account');
    for(const result of [
      {...valid,isError:true},
      {...valid,content:{}},
      {...valid,_meta:1},
      Object.assign(Object.create(null),valid),
      window.mutatingResult(id),
      ...window.malformedAccountResults(id),
    ])window.emitResult(result);
  },account2);
  await frame.waitForTimeout(50);
  assert.equal(await frame.evaluate(()=>document.querySelector('.riff-menu__account-trigger')?.getAttribute('aria-label')),'First account account menu',
    'malformed replacement notifications do not invalidate the prior account');
  assert.equal(await frame.evaluate(()=>window.calls.filter(call=>call.name==='list_riff_work').length),listCount,
    'malformed replacements do not refresh account-scoped work');
  assert.equal(await frame.evaluate(()=>window.getterReads),0);
});

test('Riff Home fails open when the host handshake completes without an initial tool result',async t=>{
  const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:`
    import { mountRiffHomeBridge } from './apps/panel/riff-home-bridge.ts';
    window.bridge=mountRiffHomeBridge(document.getElementById('mount'),{timeoutMs:80,toolTimeoutMs:200,maxPolls:0});
  `},bundle:true,platform:'browser',format:'iife',write:false});
  const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');
    if(req.url==='/frame')return res.end(`<div id="mount"></div><script>${bundle.outputFiles[0].text}</script>`);
    res.end(`<script>window.ready=false;window.calls=[];const frame=()=>document.querySelector('iframe').contentWindow;
      window.emitAccount=()=>frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{
        structuredContent:{ok:true,data:{account:{id:'00000000-0000-4000-8000-000000000001',display_name:'Recovered account',state:'active',preferred_language:'en',created_at:'2026-01-01T00:00:00Z',onboarding_seen_at:'2026-01-01T00:02:00Z'},entitlements:{status:'not_configured'},usage:{status:'not_configured',reset_at:null}}},content:[],isError:false,_meta:{}
      }},'*');
      addEventListener('message',event=>{const message=event.data;
        if(message.method==='ui/initialize')frame().postMessage({jsonrpc:'2.0',id:message.id,result:{protocolVersion:message.params.protocolVersion,
          hostInfo:{name:'missing-initial-result',version:'1'},hostCapabilities:{serverTools:{}},hostContext:{}}},'*');
        if(message.method==='ui/notifications/initialized')window.ready=true;
        if(message.method==='tools/call'){
          window.calls.push(message.params);
          frame().postMessage({jsonrpc:'2.0',id:message.id,result:{structuredContent:{ok:true,data:{work:[]}},content:[],isError:false,_meta:{}}},'*');
        }
      });</script><iframe src="/frame"></iframe>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage();page.setDefaultTimeout(4_000);
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.ready);
  const frame=page.frames().find(candidate=>candidate.url().endsWith('/frame'));
  await frame.getByPlaceholder('Share a video or profile link, or tell me what you want to make…').waitFor();
  assert.equal(await frame.locator('.riff-home__account').textContent(),'Account unavailable');
  assert.match(await frame.locator('.riff-home__status').textContent(),/account details.*did not arrive/i);
  assert.equal(await frame.getByRole('button',{name:'Show welcome guide'}).isVisible(),true);
  assert.equal(await frame.locator('.riff-home__recents').getAttribute('aria-busy'),'false');
  assert.match(await frame.locator('.riff-home__recents').textContent(),/Recent work is unavailable/i);
  assert.doesNotMatch(await frame.locator('.riff-home__recents').textContent(),/Loading recent work/i);
  assert.deepEqual(await page.evaluate(()=>window.calls),[],'no account-scoped read runs without a verified account result');

  const input=frame.getByPlaceholder('Share a video or profile link, or tell me what you want to make…');
  await input.fill('https://www.tiktok.com/@fixture/video/7000000000000000001');
  await frame.getByRole('button',{name:'Find my next idea'}).click();
  await frame.getByRole('status').getByText(/account details are unavailable.*reopen Home/i).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.calls),[],
    'fail-open Home cannot start account-owned work before its credential-derived account binding arrives');

  await input.fill('Product description');await input.press('Control+Enter');
  await frame.getByRole('button',{name:'Product description'}).click();
  await frame.getByLabel('Product',{exact:true}).fill('FocusNest');
  await frame.getByLabel('Audience',{exact:true}).fill('Remote workers');
  await frame.getByLabel('Main benefit',{exact:true}).fill('Focus');
  await frame.getByLabel('Content style',{exact:true}).fill('Demo');
  await frame.getByLabel('Language',{exact:true}).fill('en');
  await frame.getByLabel('Duration in seconds',{exact:true}).fill('20');
  await frame.getByRole('button',{name:'Confirm context'}).click();
  await frame.getByRole('status').getByText(/account details are unavailable.*reopen Home/i).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.calls),[],
    'fail-open Home cannot save account-owned Product context before its account binding arrives');

  await page.evaluate(()=>window.emitAccount());
  await frame.waitForFunction(()=>document.querySelector('.riff-home__account')?.textContent==='Ready, Recovered account');
  assert.equal(await frame.locator('.riff-home__status').textContent(),'','recovery clears the stale watchdog status');
  assert.equal(await input.inputValue(),'','the first account binding clears any unbound private intent');
  await frame.locator('.riff-home__recents').getByText('No recent work yet.').waitFor();
  assert.deepEqual(await page.evaluate(()=>window.calls.map(call=>call.name)),['list_riff_work']);
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
          frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ok:true,data:{account:{id:'00000000-0000-4000-8000-000000000001',display_name:'Fixture',state:'active',preferred_language:'en',created_at:'2026-01-01T00:00:00Z',onboarding_seen_at:'2026-01-01T00:02:00Z'},entitlements:{status:'not_configured'},usage:{status:'not_configured',reset_at:null}}},content:[]}},'*');
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

test('Riff Home rejects unsafe URL authority components before tools or chat and keys allowed queries by the safe projection',async t=>{
  const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:`
    import { mountRiffHomeBridge } from './apps/panel/riff-home-bridge.ts';
    window.calls=[];window.messages=[];
    const failure={structuredContent:{ok:false,error:{code:'UNAVAILABLE',message:'Retry.',retryable:true,recovery:'retry_same_request'}}};
    window.openai={
      callTool:async(name,args)=>{window.calls.push({name,args});return name==='list_riff_work'?{structuredContent:{ok:true,data:{work:[]}}}:failure},
      sendFollowUpMessage:async input=>{window.messages.push(input);return {}},
    };
    window.bridge=mountRiffHomeBridge(document.getElementById('mount'),{timeoutMs:500,toolTimeoutMs:500,maxPolls:0});
  `},bundle:true,platform:'browser',format:'iife',write:false});
  const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');
    if(req.url==='/frame')return res.end(`<div id="mount"></div><script>${bundle.outputFiles[0].text}</script>`);
    res.end(`<script>window.ready=false;const frame=()=>document.querySelector('iframe').contentWindow;
      addEventListener('message',event=>{const message=event.data;
        if(message.method==='ui/initialize')frame().postMessage({jsonrpc:'2.0',id:message.id,result:{protocolVersion:message.params.protocolVersion,hostInfo:{name:'safe-url-boundary',version:'1'},hostCapabilities:{},hostContext:{}}},'*');
        if(message.method==='ui/notifications/initialized'){
          frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ok:true,data:{account:{id:'00000000-0000-4000-8000-000000000001',display_name:'Fixture',state:'active',preferred_language:'en',created_at:'2026-01-01T00:00:00Z',onboarding_seen_at:'2026-10-11T00:00:00Z'},entitlements:{status:'not_configured'},usage:{status:'not_configured',reset_at:null}}},content:[]}},'*');window.ready=true;
        }
      });</script><iframe src="/frame"></iframe>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage();page.setDefaultTimeout(4_000);
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.ready);
  const frame=page.frames().find(candidate=>candidate.url().endsWith('/frame'));
  const input=frame.getByPlaceholder('Share a video or profile link, or tell me what you want to make…');
  const submit=frame.getByRole('button',{name:'Find my next idea'});
  const send=async source=>{await input.fill(source);await submit.click();await frame.waitForFunction(()=>!document.querySelector('.riff-home__submit')?.disabled)};

  const unsafe=[
    'https://fixture-user:credential-secret@www.tiktok.com/@fixture/video/7000000000000000001?share=1',
    'https://example.com:444/reference?keep=1',
    'https://www.tiktok.com/@fixture/video/7000000000000000001#private-fragment',
    'https://www.tiktok.com/@fixture/video/7000000000000000001#',
  ];
  for(const source of unsafe)await send(source);
  const unsafeActivity=await frame.evaluate(()=>({
    tools:window.calls.filter(call=>call.name!=='list_riff_work').length,
    messages:window.messages.length,
    serialized:JSON.stringify({calls:window.calls,messages:window.messages}),
  }));
  assert.deepEqual({tools:unsafeActivity.tools,messages:unsafeActivity.messages},{tools:0,messages:0});
  assert.doesNotMatch(unsafeActivity.serialized,/fixture-user|credential-secret|private-fragment/);

  await frame.evaluate(()=>{window.calls=[];window.messages=[]});
  const submitted='https://WWW.TIKTOK.COM:443/@fixture/video/7000000000000000002?share_app_id=123&utm_source=copy';
  const canonical='https://www.tiktok.com/@fixture/video/7000000000000000002?share_app_id=123&utm_source=copy';
  await send(submitted);await send(canonical);
  const starts=await frame.evaluate(()=>window.calls.filter(call=>call.name==='start_riff_creator').map(call=>call.args));
  assert.equal(starts.length,2);
  assert.deepEqual(starts.map(call=>call.source_url),[canonical,canonical],'the accepted query is preserved without interpreting it');
  assert.equal(starts[0].request_id,starts[1].request_id,'canonical equivalents reuse one safe intent key');
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
          frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ok:true,data:{account:{id:'00000000-0000-4000-8000-000000000001',display_name:'Fixture',state:'active',preferred_language:'en',created_at:'2026-01-01T00:00:00Z',onboarding_seen_at:'2026-01-01T00:02:00Z'},entitlements:{status:'not_configured'},usage:{status:'not_configured',reset_at:null}}},content:[]}},'*');
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
  await frame.getByRole('button', { name: 'Video idea' }).click();
  await frame.getByText(/handoff failed/i).waitFor();
  assert.equal(await submit.isEnabled(), true);
});

test('Riff Home rejects the whole recent-work result when one sibling violates the public contract', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffHomeBridge } from './apps/panel/riff-home-bridge.ts';
    const recent={project_id:'00000000-0000-4000-8000-000000000100',project_name:'Valid recent work',
      job_id:'00000000-0000-4000-8000-000000000620',kind:'scan',state:'succeeded',updated_at:'2026-10-11T12:00:00Z',
      source:{platform:'tiktok',kind:'profile',handle:'fixture',canonical_url:'https://www.tiktok.com/@fixture',
        profile_url:'https://www.tiktok.com/@fixture',video_url:null},variant_id:null,work_state:null};
    const invalid={...structuredClone(recent),project_name:'Invalid sibling',updated_at:'2026-02-30T12:00:00Z'};
    window.openai={callTool:async name=>name==='list_riff_work'
      ? {structuredContent:{ok:true,data:{work:[recent,invalid]}},content:[]}
      : {structuredContent:{ok:false,error:{code:'NOT_FOUND',message:'Missing',retryable:false,recovery:'reload'}},content:[]}};
    window.bridge=mountRiffHomeBridge(document.getElementById('mount'),{timeoutMs:500,toolTimeoutMs:200,maxPolls:0});
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/frame') return res.end(`<div id="mount"></div><script>${bundle.outputFiles[0].text}</script>`);
    res.end(`<script>
      window.ready=false;const frame=()=>document.querySelector('iframe').contentWindow;
      addEventListener('message',event=>{const message=event.data;
        if(message.method==='ui/initialize')frame().postMessage({jsonrpc:'2.0',id:message.id,result:{protocolVersion:message.params.protocolVersion,
          hostInfo:{name:'strict-recents',version:'1'},hostCapabilities:{},hostContext:{}}},'*');
        if(message.method==='ui/notifications/initialized'){
          frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ok:true,data:{account:{
            id:'00000000-0000-4000-8000-000000000001',display_name:'Fixture',state:'active',preferred_language:'en',
            created_at:'2026-01-01T00:00:00Z',onboarding_seen_at:'2026-10-11T00:00:00Z'},
            entitlements:{status:'not_configured'},usage:{status:'not_configured',reset_at:null}}},content:[]}},'*');window.ready=true;
        }
      });
    </script><iframe src="/frame"></iframe>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage();page.setDefaultTimeout(3_000);
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.ready);
  const frame=page.frames().find(candidate=>candidate.url().endsWith('/frame'));
  await frame.getByText('Recent work is temporarily unavailable.',{exact:true}).waitFor();
  assert.equal(await frame.getByText('Valid recent work',{exact:true}).count(),0,
    'a valid sibling is never salvaged from an invalid result');
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
          frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ok:true,data:{account:{id:'00000000-0000-4000-8000-000000000001',display_name:'Fixture',state:'active',preferred_language:'en',created_at:'2026-01-01T00:00:00Z',onboarding_seen_at:'2026-01-01T00:02:00Z'},entitlements:{status:'not_configured'},usage:{status:'not_configured',reset_at:null}}},content:[]}},'*');
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
          frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ok:true,data:{account:{id:'00000000-0000-4000-8000-000000000001',display_name:'Fixture',state:'active',preferred_language:'en',created_at:'2026-01-01T00:00:00Z',onboarding_seen_at:'2026-01-01T00:02:00Z'},entitlements:{status:'not_configured'},usage:{status:'not_configured',reset_at:null}}},content:[]}},'*');
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
          frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ok:true,data:{account:{id:'00000000-0000-4000-8000-000000000001',display_name:'Fixture',state:'active',preferred_language:'en',created_at:'2026-01-01T00:00:00Z',onboarding_seen_at:'2026-01-01T00:02:00Z'},entitlements:{status:'not_configured'},usage:{status:'not_configured',reset_at:null}}},content:[]}},'*');window.ready=true;
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
  assert.equal(starts[1].request_id, starts[2].request_id,
    'canonical-equivalent public URLs reuse the same logical request ID');
  assert.equal(starts[2].source_url, source,'the server input is the canonical safe projection');
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
          frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ok:true,data:{account:{id:'00000000-0000-4000-8000-000000000001',display_name:'Fixture',state:'active',preferred_language:'en',created_at:'2026-01-01T00:00:00Z',onboarding_seen_at:'2026-01-01T00:02:00Z'},entitlements:{status:'not_configured'},usage:{status:'not_configured',reset_at:null}}},content:[]}},'*');window.ready=true;
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
      source:{platform:'tiktok',kind:'profile',handle:'old.creator',canonical_url:'https://www.tiktok.com/@old.creator',profile_url:'https://www.tiktok.com/@old.creator',video_url:null},
      variant_id:null,work_state:null
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
      const account=id=>{frame().activeAccountId=id;frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ok:true,data:{account:{id,display_name:id.endsWith('1')?'First account':'Second account',state:'active',preferred_language:'en',created_at:'2026-01-01T00:00:00Z',onboarding_seen_at:'2026-10-11T00:00:00Z'},entitlements:{status:'not_configured'},usage:{status:'not_configured',reset_at:null}}},content:[]}},'*');};
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
  const drawer = frame.getByRole('dialog', { name: 'Riff menu' });
  await drawer.getByRole('button', { name: 'Open First account work — Analysis ready' }).waitFor();
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
      window.account=id=>frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ok:true,data:{account:{id,display_name:'Fixture',state:'active',preferred_language:'en',created_at:'2026-01-01T00:00:00Z',onboarding_seen_at:'2026-01-01T00:02:00Z'},entitlements:{status:'not_configured'},usage:{status:'not_configured',reset_at:null}}},content:[]}},'*');
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

test('Riff Home keeps catalog shortcuts private until the first account is ready', async (t) => {
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
      window.sendAccount=()=>frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ok:true,data:{account:{id:'00000000-0000-4000-8000-000000000001',display_name:'Fixture',state:'active',preferred_language:'en',created_at:'2026-01-01T00:00:00Z',onboarding_seen_at:'2026-01-01T00:02:00Z'},entitlements:{status:'not_configured'},usage:{status:'not_configured',reset_at:null}}},content:[]}},'*');
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
  assert.equal(await frame.getByRole('button', { name: 'Trending videos', exact: true }).isHidden(),true);
  assert.equal(await frame.evaluate(() => window.catalogCalls.length),0,'no account-scoped read starts before the host connection and identity are ready');
  await page.evaluate(() => window.finishConnect());
  await frame.getByRole('button', { name: 'Trending videos', exact: true }).waitFor({state:'visible'});
  await frame.getByRole('button', { name: 'Trending videos', exact: true }).click();
  await frame.waitForFunction(() => window.catalogCalls.length === 1);
  assert.deepEqual(await frame.evaluate(() => window.catalogCalls[0]),{role:'discovered_reference',sort:'observed_at_desc',limit:8});
  await frame.waitForFunction(()=>document.querySelectorAll('[data-catalog-card]').length===5);
  for(let index=0;index<6;index+=1)await frame.getByRole('button',{name:'Next video'}).click();
  assert.equal(await frame.evaluate(()=>window.catalogCalls.length),1,'positions before the eighth card stay local');
  await frame.getByRole('button',{name:'Next video'}).click();
  assert.equal(await frame.evaluate(()=>window.catalogCalls.length),1,'the eighth card does not consume the retained cursor');
  assert.equal(await frame.locator('[data-catalog-card]').count(),5,'only the five-card Paper stage is rendered');
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
          frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ok:true,data:{account:{id:'00000000-0000-4000-8000-000000000001',display_name:'Fixture',state:'active',preferred_language:'en',created_at:'2026-01-01T00:00:00Z',onboarding_seen_at:'2026-01-01T00:02:00Z'},entitlements:{status:'not_configured'},usage:{status:'not_configured',reset_at:null}}},content:[]}},'*');
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
          frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ok:true,data:{account:{id:'00000000-0000-4000-8000-000000000001',display_name:'Fixture',state:'active',preferred_language:'en',created_at:'2026-01-01T00:00:00Z',onboarding_seen_at:'2026-10-11T00:00:00Z'},entitlements:{status:'not_configured'},usage:{status:'not_configured',reset_at:null}}},content:[]}},'*');
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
          frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ok:true,data:{account:{id:'00000000-0000-4000-8000-000000000001',display_name:'Fixture',state:'active',preferred_language:'en',created_at:'2026-01-01T00:00:00Z',onboarding_seen_at:'2026-10-11T00:00:00Z'},entitlements:{status:'not_configured'},usage:{status:'not_configured',reset_at:null}}},content:[]}},'*');
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

test('Riff Home refreshes recent truth after every Studio state change and reopens the selected variant',async t=>{
  const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:`
    import { mountRiffHomeBridge } from './apps/panel/riff-home-bridge.ts';
    import { pipelineFixture } from './apps/panel/creator-pipeline/fixtures.ts';
    window.job=pipelineFixture('scripts');window.variant=window.job.result.scripts.variants[1];
    window.job.work_states=[{job_id:window.job.id,variant_id:window.variant.id,state:'active',version:1,updated_at:'2026-10-11T12:00:01Z'}];
    window.calls=[];window.listFailNext=false;window.workStateSpoof='none';window.getterReads=0;
    const wrapped=value=>({structuredContent:value,content:[]});
    const failure=()=>wrapped({ok:false,error:{code:'UNAVAILABLE',message:'Fixture list failure.',retryable:true,recovery:'retry_same_request'}});
    const recent=()=>({project_id:window.job.project_id,project_name:'Saved Studio',job_id:window.job.id,kind:'scripts',state:'succeeded',
      updated_at:window.job.updated_at,source:{platform:'tiktok',kind:'profile',handle:'fixture',canonical_url:'https://www.tiktok.com/@fixture',
        profile_url:'https://www.tiktok.com/@fixture',video_url:null},variant_id:window.variant.id,work_state:window.job.work_states[0]});
    window.openai={callTool:async(name,args)=>{
      window.calls.push({name,args});
      if(name==='list_riff_work'){
        if(window.listFailNext){window.listFailNext=false;return failure();}
        return wrapped({ok:true,data:{work:[recent()]}});
      }
      if(name==='get_creator_job')return wrapped({ok:true,data:{job:window.job}});
      if(name==='set_riff_work_state'){
        const previous=window.job.work_states.find(item=>item.variant_id.toLowerCase()===args.variant_id.toLowerCase());
        const conflict={ok:false,error:{code:'VERSION_CONFLICT',message:'Spoofed failure.',retryable:false,recovery:'reload'}};
        const spoofReceipt={ok:true,data:{work_state:{job_id:window.job.id.toLowerCase(),variant_id:args.variant_id.toLowerCase(),state:args.state,
          version:(previous?.version??0)+1,updated_at:'2026-10-11T12:00:02Z'}}};
        if(window.workStateSpoof==='proxy-outer')return new Proxy(wrapped(conflict),{getPrototypeOf(){throw new Error('hostile outer proxy');}});
        if(window.workStateSpoof==='proxy-inner')return wrapped(new Proxy(conflict,{getPrototypeOf(){throw new Error('hostile inner proxy');}}));
        if(window.workStateSpoof==='mutating-proxy'){
          const original=spoofReceipt,result={structuredContent:original,content:[],isError:true,_meta:{}};
          result._meta.mutator=new Proxy({}, {getPrototypeOf(){
            Object.defineProperty(result,'structuredContent',{configurable:true,enumerable:true,get(){
              window.getterReads++;
              Object.defineProperty(result,'structuredContent',{configurable:true,enumerable:true,writable:true,value:original});
              return conflict;
            }});
            return Object.prototype;
          }});
          return result;
        }
        if(window.workStateSpoof==='sibling-mutating-proxy'){
          const successData=spoofReceipt.data,structuredContent={ok:true,data:successData};
          let prototypeReads=0;
          const replace=next=>{for(const key of Reflect.ownKeys(structuredContent))delete structuredContent[key];Object.assign(structuredContent,next);};
          const mutator=new Proxy({}, {
            getPrototypeOf(){prototypeReads++;replace(prototypeReads%2===1?conflict:{ok:true,data:successData});return Object.prototype;},
            get(){window.getterReads++;return undefined;},
          });
          return {_meta:{mutator},structuredContent,content:[],isError:true};
        }
        if(window.workStateSpoof==='null-outer')return Object.assign(Object.create(null),wrapped(conflict));
        if(window.workStateSpoof==='null-inner')return wrapped(Object.assign(Object.create(null),conflict));
        if(window.workStateSpoof==='false-failure')return {...wrapped(conflict),isError:false};
        if(window.workStateSpoof==='true-success')return {...wrapped(spoofReceipt),isError:true};
        if((previous?.version??0)!==args.expected_version)return wrapped({ok:false,error:{code:'VERSION_CONFLICT',message:'Changed.',retryable:false,recovery:'reload'}});
        const work_state={job_id:window.job.id.toLowerCase(),variant_id:args.variant_id.toLowerCase(),state:args.state,
          version:(previous?.version??0)+1,updated_at:'2026-10-11T12:00:0'+((previous?.version??0)+1)+'Z'};
        window.job={...window.job,work_states:[work_state]};return wrapped({ok:true,data:{work_state}});
      }
      return failure();
    }};
    window.bridge=mountRiffHomeBridge(document.getElementById('mount'),{timeoutMs:500,toolTimeoutMs:500,maxPolls:0});
  `},bundle:true,platform:'browser',format:'iife',write:false});
  const server=createServer((req,res)=>{
    res.setHeader('Content-Type','text/html');
    if(req.url==='/frame')return res.end(`<div id="mount"></div><script>${bundle.outputFiles[0].text}</script>`);
    res.end(`<script>
      window.ready=false;const frame=()=>document.querySelector('iframe').contentWindow;
      addEventListener('message',event=>{const message=event.data;
        if(message.method==='ui/initialize')frame().postMessage({jsonrpc:'2.0',id:message.id,result:{protocolVersion:message.params.protocolVersion,
          hostInfo:{name:'work-state-fixture',version:'1'},hostCapabilities:{message:{text:{}}},hostContext:{}}},'*');
        if(message.method==='ui/notifications/initialized'){
          frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ok:true,data:{account:{
            id:'00000000-0000-4000-8000-000000000001',display_name:'Fixture',state:'active',preferred_language:'en',
            created_at:'2026-01-01T00:00:00Z',onboarding_seen_at:'2026-10-11T00:00:00Z'},
            entitlements:{status:'not_configured'},usage:{status:'not_configured',reset_at:null}}},content:[]}},'*');window.ready=true;
        }
      });
    </script><iframe src="/frame"></iframe>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1200,height:850}});page.setDefaultTimeout(4_000);
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.ready);
  const frame=page.frames().find(candidate=>candidate.url().endsWith('/frame'));
  const openRecent=async stage=>{const card=frame.getByRole('button',{name:new RegExp(`Open Saved Studio — ${stage}`)});await card.waitFor();await card.click();
    await frame.getByRole('heading',{name:'Your script, ready to film.'}).waitFor();
    assert.equal(await frame.getByRole('radio',{name:'Creator Fit'}).getAttribute('aria-checked'),'true');};
  const goHome=async()=>{await frame.getByRole('button',{name:'Open Riff menu'}).click();await frame.getByRole('navigation',{name:'Riff navigation'}).getByRole('button',{name:'Home',exact:true}).click();};

  await openRecent('Continue script');
  const callsBeforeSpoof=await frame.evaluate(()=>({
    reads:window.calls.filter(call=>call.name==='get_creator_job').length,
    lists:window.calls.filter(call=>call.name==='list_riff_work').length,
  }));
  for(const mode of ['proxy-outer','proxy-inner','null-outer','null-inner','false-failure','true-success','mutating-proxy','sibling-mutating-proxy']){
    const writesBefore=await frame.evaluate(()=>window.calls.filter(call=>call.name==='set_riff_work_state').length);
    await frame.evaluate(mode=>{window.workStateSpoof=mode;},mode);
    await frame.getByRole('button',{name:'Save for later'}).click();
    await frame.waitForFunction(expected=>window.calls.filter(call=>call.name==='set_riff_work_state').length===expected,writesBefore+1);
    await frame.waitForFunction(()=>[...document.querySelectorAll('button')]
      .some(button=>button.textContent==='Save for later'&&!button.disabled));
    assert.equal(await frame.locator('.riff-pipeline__status').textContent(),
      'Riff could not confirm that change. Try the same action again safely.',mode);
    assert.deepEqual(await frame.evaluate(()=>({
      reads:window.calls.filter(call=>call.name==='get_creator_job').length,
      lists:window.calls.filter(call=>call.name==='list_riff_work').length,
    })),callsBeforeSpoof,`${mode} cannot authorize a reread or recent-work refresh`);
    assert.deepEqual(await frame.evaluate(()=>window.job.work_states.map(({state,version})=>({state,version}))),
      [{state:'active',version:1}],`${mode} cannot mutate persisted work-state truth`);
  }
  assert.equal(await frame.evaluate(()=>window.getterReads),0,'work-state validation never reads the restoring getter');
  await frame.evaluate(()=>{window.workStateSpoof='none';});
  await frame.getByRole('button',{name:'Save for later'}).click();await frame.getByRole('heading',{name:'Your viral script, saved.'}).waitFor();
  await frame.getByRole('button',{name:'Open vault'}).click();
  const savedCard=frame.getByRole('button',{name:/Open Saved Studio — Ideas saved/});await savedCard.waitFor();
  assert.match(await frame.evaluate(()=>document.activeElement?.getAttribute('aria-label')??''),/Ideas saved/);

  await savedCard.click();await frame.getByRole('button',{name:'Undo save'}).click();await frame.getByRole('button',{name:'Save for later'}).waitFor();
  await goHome();await frame.getByRole('button',{name:/Open Saved Studio — Continue script/}).waitFor();
  await openRecent('Continue script');
  await frame.getByRole('button',{name:'I filmed it'}).click();await frame.getByText('Marked as filmed.').waitFor();
  await goHome();await frame.getByRole('button',{name:/Open Saved Studio — Filmed/}).waitFor();
  await openRecent('Filmed');
  assert.equal(await frame.getByRole('button',{name:'I filmed it'}).count(),0);
  await frame.getByRole('button',{name:'Undo filmed'}).click();await frame.getByText('Marked as not filmed.').waitFor();
  await frame.getByRole('button',{name:'I filmed it'}).waitFor();
  await goHome();await frame.getByRole('button',{name:/Open Saved Studio — Continue script/}).waitFor();
  await openRecent('Continue script');

  await frame.evaluate(()=>{window.listFailNext=true;});
  await frame.getByRole('button',{name:'Save for later'}).click();await frame.getByRole('heading',{name:'Your viral script, saved.'}).waitFor();
  assert.match(await frame.locator('.riff-pipeline__status').textContent(),/saved.*recent work could not be refreshed/i);
  await frame.getByRole('button',{name:'Open vault'}).click();
  await frame.locator('.riff-home__status').getByText('My videos opened, but saved work could not be refreshed.').waitFor();
  const workStateCalls=await frame.evaluate(()=>window.calls.filter(call=>call.name==='set_riff_work_state').map(call=>call.args));
  assert.deepEqual(workStateCalls.map(call=>call.state),['saved','saved','saved','saved','saved','saved','saved','saved','saved','active','filmed','active','saved']);
  for(const retry of workStateCalls.slice(1,9))
    assert.deepEqual(retry,workStateCalls[0],'every legitimate or rejected retry preserves the exact ambiguous write intent');
  assert.ok(await frame.evaluate(()=>window.calls.filter(call=>call.name==='list_riff_work').length)>=6,'initial load plus every confirmed mutation');
  await frame.evaluate(()=>window.bridge.dispose());
});

test('Riff Product context saves only on confirmation, retries exactly, updates, and hands off the exact saved snapshot', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffHomeBridge } from './apps/panel/riff-home-bridge.ts';
    window.calls=[];window.prompts=[];window.saveMode='unavailable';window.latest=undefined;
    window.openai={
      callTool:async(name,args)=>{
        window.calls.push({name,args:structuredClone(args)});
        if(name==='list_riff_work')return {structuredContent:{ok:true,data:{work:[]}}};
        if(name==='save_project'){
          if(window.saveMode==='unavailable')return {structuredContent:{ok:false,error:{code:'UNAVAILABLE',message:'private',retryable:true,recovery:'retry_same_request'}}};
          if(window.saveMode==='malformed')return {structuredContent:{ok:true,data:{}}};
          if(window.saveMode==='conflict')return {structuredContent:{ok:false,error:{code:'VERSION_CONFLICT',message:'private',retryable:false,recovery:'reload'}}};
          const created='2026-10-11T10:00:00Z';const id=args.project_id??'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';const version=args.expected_version+1;
          const project={id,name:args.name,project_type:'brand',current_version:version,created_at:created,updated_at:created,
            brief_version:{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',project_id:id,version,name:args.name,brief:structuredClone(args.brief),created_at:created}};
          window.latest=project;return {structuredContent:{ok:true,data:{project,request_id:args.request_id}}};
        }
        if(name==='get_project')return {structuredContent:{ok:true,data:{project:window.latest}}};
        return {structuredContent:{ok:false,error:{code:'NOT_FOUND',message:'private',retryable:false,recovery:'reload'}}};
      },
      sendFollowUpMessage:async({prompt})=>{window.prompts.push(prompt);return {};},
    };
    window.bridge=mountRiffHomeBridge(document.getElementById('mount'),{timeoutMs:500,toolTimeoutMs:500,maxPolls:0});
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/frame') return res.end(`<div id="mount"></div><script>${bundle.outputFiles[0].text}</script>`);
    res.end(`<script>
      window.ready=false;const frame=()=>document.querySelector('iframe').contentWindow;
      window.account=id=>frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ok:true,data:{account:{id,display_name:'Fixture',state:'active',preferred_language:'en',created_at:'2026-01-01T00:00:00Z',onboarding_seen_at:'2026-10-11T00:00:00Z'},entitlements:{status:'not_configured'},usage:{status:'not_configured',reset_at:null}}},content:[]}},'*');
      addEventListener('message',e=>{const m=e.data;
        if(m.method==='ui/initialize')frame().postMessage({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params.protocolVersion,hostInfo:{name:'product',version:'1'},hostCapabilities:{},hostContext:{}}},'*');
        if(m.method==='ui/notifications/initialized'){window.account('00000000-0000-4000-8000-000000000001');window.ready=true;}
      });
    </script><iframe src="/frame"></iframe>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } }); page.setDefaultTimeout(4_000);
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.ready);
  const frame = page.frames().find(item => item.url().endsWith('/frame'));
  const input = frame.getByPlaceholder('Share a video or profile link, or tell me what you want to make…');
  const rawDescription = '  A user-written focus app description.  ';
  await input.fill(rawDescription); await input.press('Control+Enter');
  assert.equal(await frame.getByRole('group', { name: 'What did you share?' }).count(), 1);
  assert.equal(await frame.evaluate(() => window.calls.filter(call => call.name !== 'list_riff_work').length), 0);
  assert.equal(await frame.evaluate(() => window.prompts.length), 0);
  await frame.getByRole('button', { name: 'Product description' }).click();
  await frame.getByRole('heading', { name: 'Give your product viral potential.' }).waitFor();
  assert.equal(await frame.getByLabel('Description', { exact: true }).inputValue(), rawDescription);
  assert.equal(await frame.evaluate(() => window.calls.some(call => call.name === 'get_project')), false,
    'open_riff without a trusted project ID never guesses or lists a product project');
  await frame.getByLabel('Product', { exact: true }).fill('FocusNest');
  await frame.getByLabel('Audience', { exact: true }).fill('Remote workers');
  await frame.getByLabel('Main benefit', { exact: true }).fill('Protect focused work');
  await frame.getByLabel('Content style', { exact: true }).fill('Simple product demos');
  await frame.getByLabel('Language', { exact: true }).fill('en');
  await frame.getByLabel('Duration in seconds', { exact: true }).fill('20');
  assert.equal(await frame.evaluate(() => window.calls.some(call => call.name === 'save_project')), false);

  const confirm = frame.getByRole('button', { name: 'Confirm context' });
  await confirm.click();
  await frame.getByText(/same save again/i).waitFor();
  await frame.evaluate(() => { window.saveMode='ok'; });
  await confirm.click();
  await frame.getByText('Context saved', { exact: true }).waitFor();
  const createCalls = await frame.evaluate(() => window.calls.filter(call => call.name === 'save_project').slice(0, 2).map(call => call.args));
  assert.deepEqual(createCalls[1], createCalls[0], 'UNAVAILABLE retries byte-equivalent input with the exact request ID');
  assert.equal(createCalls[0].project_id, null);
  assert.equal(createCalls[0].expected_version, 0);
  assert.equal(createCalls[0].name, 'FocusNest');
  assert.equal(createCalls[0].brief.product, 'FocusNest');
  assert.equal(createCalls[0].brief.description, 'A user-written focus app description.');
  assert.deepEqual(createCalls[0].brief.facts, []);
  assert.equal(Object.hasOwn(createCalls[0], 'account_id'), false);
  assert.equal(JSON.stringify(createCalls[0]).includes('Unknown'), false);

  const savedSnapshot = await frame.evaluate(() => structuredClone(window.latest));
  await frame.getByRole('button', { name: 'Discover formats' }).click();
  await frame.waitForFunction(() => window.prompts.length === 1);
  const expectedPrompt = 'Continue from this saved Riff product brief. It is user-confirmed project context, not provider research or Creator DNA. No Creator DNA is available for this project, so do not start provider work, invent references, or claim formats were discovered. Keep these fields editable and ask only for the missing context or a user-supplied creator video/profile before proposing the next supported step: ' + JSON.stringify(savedSnapshot);
  assert.equal(await frame.evaluate(() => window.prompts[0]), expectedPrompt);
  assert.equal(await frame.evaluate(() => window.calls.some(call => call.name === 'start_creator_recommendations')), false);

  await frame.getByLabel('Audience', { exact: true }).fill('Small remote teams');
  await confirm.click();
  await frame.getByText('Context saved', { exact: true }).waitFor();
  const saves = await frame.evaluate(() => window.calls.filter(call => call.name === 'save_project').map(call => call.args));
  assert.equal(saves[2].project_id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(saves[2].expected_version, 1);
  assert.notEqual(saves[2].request_id, saves[1].request_id, 'a new intended update receives a fresh request ID');
  assert.equal(saves[2].brief.audience, 'Small remote teams');

  await frame.getByLabel('Content style', { exact: true }).fill('Hands-only demo');
  await frame.evaluate(() => { window.saveMode='malformed'; });
  await confirm.click();
  await frame.getByText(/could not verify that product context was saved/i).waitFor();
  assert.equal(await frame.getByLabel('Content style', { exact: true }).inputValue(), 'Hands-only demo');
  assert.equal(await frame.getByRole('button', { name: 'Discover formats' }).count(), 0,
    'a malformed success envelope cannot create fictional success');
  assert.equal(await frame.evaluate(() => window.calls.some(call => /provider|model|classif/i.test(call.name))), false);
});

test('Riff Product save failures preserve drafts and obey retry, rotation, and idempotency boundaries', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffHomeBridge } from './apps/panel/riff-home-bridge.ts';
    window.calls=[];window.mode='timeout';
    const failures={
      unavailable:{code:'UNAVAILABLE',retryable:true,recovery:'retry_same_request'},
      unauthenticated:{code:'UNAUTHENTICATED',retryable:false,recovery:'reauthorize'},
      forbidden:{code:'FORBIDDEN',retryable:false,recovery:'contact_support'},
      validation:{code:'VALIDATION_ERROR',retryable:false,recovery:'correct_input'},
      notfound:{code:'NOT_FOUND',retryable:false,recovery:'reload'},
      idempotency:{code:'IDEMPOTENCY_CONFLICT',retryable:false,recovery:'correct_input'},
    };
    window.openai={callTool:async(name,args)=>{window.calls.push({name,args:structuredClone(args)});
      if(name==='list_riff_work')return {structuredContent:{ok:true,data:{work:[]}}};
      if(name!=='save_project')return {structuredContent:{ok:false,error:{code:'NOT_FOUND',message:'private',retryable:false,recovery:'reload'}}};
      if(window.mode==='timeout')return new Promise(()=>{});
      if(window.mode==='transport')throw new Error('private transport detail');
      const failure=failures[window.mode];return {structuredContent:{ok:false,error:{...failure,message:'private'}}};
    }};
    window.bridge=mountRiffHomeBridge(document.getElementById('mount'),{timeoutMs:500,toolTimeoutMs:40,maxPolls:0});
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');
    if(req.url==='/frame')return res.end(`<div id="mount"></div><script>${bundle.outputFiles[0].text}</script>`);
    res.end(`<script>window.ready=false;const frame=()=>document.querySelector('iframe').contentWindow;
      addEventListener('message',e=>{const m=e.data;if(m.method==='ui/initialize')frame().postMessage({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params.protocolVersion,hostInfo:{name:'product-errors',version:'1'},hostCapabilities:{},hostContext:{}}},'*');
      if(m.method==='ui/notifications/initialized'){frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ok:true,data:{account:{id:'00000000-0000-4000-8000-000000000001',display_name:'Fixture',state:'active',preferred_language:'en',created_at:'2026-01-01T00:00:00Z',onboarding_seen_at:'2026-10-11T00:00:00Z'},entitlements:{status:'not_configured'},usage:{status:'not_configured',reset_at:null}}},content:[]}},'*');window.ready=true;}});</script><iframe src="/frame"></iframe>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();page.setDefaultTimeout(4_000);
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.ready);const frame=page.frames().find(item=>item.url().endsWith('/frame'));
  const input=frame.getByPlaceholder('Share a video or profile link, or tell me what you want to make…');
  await input.fill('A product description');await input.press('Control+Enter');await frame.getByRole('button',{name:'Product description'}).click();
  await frame.getByRole('heading',{name:'Give your product viral potential.'}).waitFor();
  await frame.getByLabel('Product',{exact:true}).fill('FocusNest');await frame.getByLabel('Audience',{exact:true}).fill('Remote workers');
  await frame.getByLabel('Main benefit',{exact:true}).fill('Focus');await frame.getByLabel('Content style',{exact:true}).fill('Demo');
  await frame.getByLabel('Language',{exact:true}).fill('en');await frame.getByLabel('Duration in seconds',{exact:true}).fill('20');
  const confirm=frame.getByRole('button',{name:'Confirm context'});
  const attempt=async(mode,pattern)=>{const expected=await frame.evaluate(()=>window.calls.filter(call=>call.name==='save_project').length+1);
    await frame.evaluate(value=>{window.mode=value},mode);await confirm.click();
    await frame.waitForFunction(count=>window.calls.filter(call=>call.name==='save_project').length===count,expected);
    await frame.waitForFunction(()=>document.querySelector('form[aria-label="Your product brief"]')?.getAttribute('aria-busy')==='false');
    assert.match(await frame.getByRole('status').textContent(),pattern);
  };
  await attempt('timeout',/could not verify/i);
  await attempt('transport',/could not verify/i);
  await attempt('unavailable',/same save again/i);
  await attempt('unauthenticated',/Reconnect Riff.*product context/i);
  await attempt('forbidden',/cannot save this product context/i);
  await attempt('validation',/product brief/i);
  await attempt('notfound',/saved product context is unavailable/i);
  assert.equal(await frame.evaluate(()=>window.calls.some(call=>call.name==='get_project')),false,
    'create failures have no trusted project ID to reread');
  await attempt('idempotency',/change.*confirm/i);
  const beforeBlockedRetry=await frame.evaluate(()=>window.calls.filter(call=>call.name==='save_project').length);
  await confirm.click();await frame.waitForTimeout(50);
  assert.equal(await frame.evaluate(()=>window.calls.filter(call=>call.name==='save_project').length),beforeBlockedRetry,
    'the exact same intent is blocked after idempotency conflict');
  assert.match(await frame.getByRole('status').textContent(),/change.*confirm/i);

  await frame.getByLabel('Audience',{exact:true}).fill('Small remote teams');
  await attempt('unavailable',/same save again/i);
  const saves=await frame.evaluate(()=>window.calls.filter(call=>call.name==='save_project').map(call=>call.args));
  assert.equal(new Set(saves.slice(0,4).map(call=>call.request_id)).size,1,
    'timeout, transport, unavailable, and the following definitive attempt reuse the pending request');
  for(let index=4;index<saves.length;index++)assert.notEqual(saves[index].request_id,saves[index-1].request_id,
    `definitive failure ${index} rotates the next request ID`);
  assert.equal(await frame.getByLabel('Audience',{exact:true}).inputValue(),'Small remote teams');
  assert.equal(await frame.getByRole('button',{name:'Discover formats'}).count(),0);
});

test('Riff Product context rereads only a receipt-trusted conflict ID and invalidates late private work on account change', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffHomeBridge } from './apps/panel/riff-home-bridge.ts';
    window.calls=[];window.mode='ok';window.pending=[];window.getterReads=0;
    const make=(args,version=args.expected_version+1)=>{const id=args.project_id??'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';return {id,name:args.name,project_type:'brand',current_version:version,
      created_at:'2026-10-11T10:00:00Z',updated_at:'2026-10-11T11:00:00Z',brief_version:{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',project_id:id,version,name:args.name,
      brief:structuredClone(args.brief),created_at:'2026-10-11T11:00:00Z'}}};
    const failure=code=>({ok:false,error:{code,message:'private',retryable:false,recovery:'reload'}});
    const accessorArray=(...values)=>{const result=[];values.forEach((value,index)=>Object.defineProperty(result,String(index),{configurable:true,enumerable:true,get:()=>value}));return result;};
    const customPrototypeArray=(...values)=>{const result=[...values];Object.setPrototypeOf(result,Object.create(Array.prototype));return result;};
    const spoof=(mode,args)=>{const code=/notfound/i.test(mode)?'NOT_FOUND':'VERSION_CONFLICT';const inner=failure(code);
      if(mode==='directConflict')return inner;
      if(mode==='unknownNotFound')return {structuredContent:inner,extra:true};
      if(mode==='accessorConflict')return Object.defineProperty({},'structuredContent',{get:()=>inner,enumerable:true});
      if(mode==='symbolNotFound')return {structuredContent:inner,[Symbol('smuggled')]:true};
      if(mode==='hiddenConflict')return Object.defineProperty({structuredContent:inner},'hidden',{value:true});
      if(mode==='invalidIsErrorNotFound')return {structuredContent:inner,isError:'true'};
      if(mode==='undefinedContentConflict')return {structuredContent:inner,content:undefined};
      if(mode==='invalidContentNotFound')return {structuredContent:inner,content:{}};
      if(mode==='innerSymbolConflict')return {structuredContent:{...inner,[Symbol('smuggled')]:true}};
      if(mode==='innerHiddenNotFound')return {structuredContent:Object.defineProperty({...inner},'hidden',{value:true})};
      if(mode==='metaAccessorConflict')return {structuredContent:inner,_meta:{trace:accessorArray('sampled')}};
      if(mode==='contentPrototypeNotFound')return {structuredContent:inner,content:customPrototypeArray({type:'text',text:'Missing.'})};
      if(mode==='constraintsAccessorSuccess'){const project=make(args);project.brief_version.brief.filming_constraints=accessorArray(...args.brief.filming_constraints);return {structuredContent:{ok:true,data:{project,request_id:args.request_id}}};}
      if(mode==='constraintsPrototypeSuccess'){const project=make(args);project.brief_version.brief.filming_constraints=customPrototypeArray(...args.brief.filming_constraints);return {structuredContent:{ok:true,data:{project,request_id:args.request_id}}};}
      if(mode==='factsPrototypeSuccess'){const project=make(args);project.brief_version.brief.facts=customPrototypeArray(...args.brief.facts);return {structuredContent:{ok:true,data:{project,request_id:args.request_id}}};}
      if(mode==='mutatingProxyConflict'){
        const original={ok:true,data:{ignored:true}},result={structuredContent:original,content:[],isError:true,_meta:{}};
        result._meta.mutator=new Proxy({}, {getPrototypeOf(){
          Object.defineProperty(result,'structuredContent',{configurable:true,enumerable:true,get(){
            window.getterReads++;
            Object.defineProperty(result,'structuredContent',{configurable:true,enumerable:true,writable:true,value:original});
            return inner;
          }});
          return Object.prototype;
        }});
        return result;
      }
      if(mode==='siblingMutatingProxyConflict'){
        const successData={ignored:true},structuredContent={ok:true,data:successData};let prototypeReads=0;
        const replace=next=>{for(const key of Reflect.ownKeys(structuredContent))delete structuredContent[key];Object.assign(structuredContent,next);};
        const mutator=new Proxy({}, {
          getPrototypeOf(){prototypeReads++;replace(prototypeReads%2===1?inner:{ok:true,data:successData});return Object.prototype;},
          get(){window.getterReads++;return undefined;},
        });
        return {_meta:{mutator},structuredContent,content:[],isError:true};
      }
    };
    window.openai={callTool:async(name,args)=>{window.calls.push({name,args:structuredClone(args)});
      if(name==='list_riff_work')return {structuredContent:{ok:true,data:{work:[]}}};
      if(name==='get_project')return {content:[{type:'text',text:'Project loaded.'}],structuredContent:{ok:true,data:{project:window.latest}},isError:false,_meta:{}};
      if(name==='save_project'){
        if(window.mode==='conflict'){window.latest=make(args,2);return {content:[{type:'text',text:'Conflict.'}],structuredContent:failure('VERSION_CONFLICT'),isError:true,_meta:{}};}
        if(window.mode==='notfound')return {content:[],structuredContent:failure('NOT_FOUND'),isError:true};
        if(window.mode!=='ok'&&window.mode!=='pending')return spoof(window.mode,args);
        if(window.mode==='pending')return new Promise(resolve=>window.pending.push({args,resolve}));
        window.latest=make(args);return {structuredContent:{ok:true,data:{project:window.latest,request_id:args.request_id}}};
      }}};
    window.bridge=mountRiffHomeBridge(document.getElementById('mount'),{timeoutMs:500,toolTimeoutMs:500,maxPolls:0});
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const server = createServer((req,res)=>{res.setHeader('Content-Type','text/html');
    if(req.url==='/frame')return res.end(`<div id="mount"></div><script>${bundle.outputFiles[0].text}</script>`);
    res.end(`<script>window.ready=false;const frame=()=>document.querySelector('iframe').contentWindow;
      window.account=id=>frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ok:true,data:{account:{id,display_name:'Fixture',state:'active',preferred_language:'en',created_at:'2026-01-01T00:00:00Z',onboarding_seen_at:'2026-10-11T00:00:00Z'},entitlements:{status:'not_configured'},usage:{status:'not_configured',reset_at:null}}},content:[]}},'*');
      addEventListener('message',e=>{const m=e.data;if(m.method==='ui/initialize')frame().postMessage({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params.protocolVersion,hostInfo:{name:'product-boundary',version:'1'},hostCapabilities:{},hostContext:{}}},'*');
      if(m.method==='ui/notifications/initialized'){window.account('00000000-0000-4000-8000-000000000001');window.ready=true;}});</script><iframe src="/frame"></iframe>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();page.setDefaultTimeout(4_000);
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.ready);const frame=page.frames().find(item=>item.url().endsWith('/frame'));
  const enter=async()=>{const input=frame.getByPlaceholder('Share a video or profile link, or tell me what you want to make…');await input.fill('Product description');await input.press('Control+Enter');await frame.getByRole('button',{name:'Product description'}).click();await frame.getByRole('heading',{name:'Give your product viral potential.'}).waitFor();
    await frame.getByLabel('Product',{exact:true}).fill('FocusNest');await frame.getByLabel('Audience',{exact:true}).fill('Remote workers');await frame.getByLabel('Main benefit',{exact:true}).fill('Focus');await frame.getByLabel('Content style',{exact:true}).fill('Demo');await frame.getByLabel('Language',{exact:true}).fill('en');await frame.getByLabel('Duration in seconds',{exact:true}).fill('20');await frame.getByRole('button',{name:'Add filming constraint'}).click();await frame.getByLabel('Filming constraint 1').fill('Home desk');};
  await enter();const confirm=frame.getByRole('button',{name:'Confirm context'});await confirm.click();await frame.getByText('Context saved',{exact:true}).waitFor();
  await frame.getByLabel('Audience',{exact:true}).fill('Unsaved local audience');
  const spoofModes=['directConflict','unknownNotFound','accessorConflict','symbolNotFound','hiddenConflict','invalidIsErrorNotFound','undefinedContentConflict','invalidContentNotFound','innerSymbolConflict','innerHiddenNotFound','metaAccessorConflict','contentPrototypeNotFound','constraintsAccessorSuccess','constraintsPrototypeSuccess','factsPrototypeSuccess','mutatingProxyConflict','siblingMutatingProxyConflict'];
  for(const mode of spoofModes){const expected=await frame.evaluate(()=>window.calls.filter(call=>call.name==='save_project').length+1);
    await frame.evaluate(value=>{window.mode=value},mode);await confirm.click();
    await frame.waitForFunction(count=>window.calls.filter(call=>call.name==='save_project').length===count,expected);
    await frame.waitForFunction(()=>document.querySelector('form[aria-label="Your product brief"]')?.getAttribute('aria-busy')==='false');
    assert.match(await frame.getByRole('status').textContent(),/could not verify that product context was saved/i,mode);
  }
  assert.equal(await frame.evaluate(()=>window.calls.filter(call=>call.name==='get_project').length),0,
    'malformed Product failures never authorize reconciliation reads');
  assert.equal(await frame.evaluate(()=>window.getterReads),0,
    'Product validation never reads a restoring getter that could inject a conflict');
  const spoofIds=await frame.evaluate(()=>window.calls.filter(call=>call.name==='save_project').slice(1).map(call=>call.args.request_id));
  assert.equal(new Set(spoofIds).size,1,'all malformed Product failures retain the exact ambiguous request ID');

  await frame.evaluate(()=>{window.mode='conflict';});await confirm.click();
  await frame.getByText(/newer saved version is available/i).waitFor();
  assert.equal(await frame.getByLabel('Audience',{exact:true}).inputValue(),'Unsaved local audience');
  const getCalls=await frame.evaluate(()=>window.calls.filter(call=>call.name==='get_project').map(call=>call.args));
  assert.deepEqual(getCalls,[{project_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}]);
  assert.equal(Object.hasOwn(getCalls[0],'account_id'),false);

  await frame.evaluate(()=>{window.mode='notfound';});await confirm.click();
  await frame.getByText(/saved product context is unavailable/i).waitFor();
  assert.equal(await frame.getByLabel('Audience',{exact:true}).inputValue(),'Unsaved local audience');
  const notFoundGets=await frame.evaluate(()=>window.calls.filter(call=>call.name==='get_project').map(call=>call.args));
  assert.deepEqual(notFoundGets,[
    {project_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},
    {project_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},
  ]);

  await frame.evaluate(()=>{window.mode='pending';});await confirm.click();await frame.waitForFunction(()=>window.pending.length===1);
  await page.evaluate(()=>window.account('00000000-0000-4000-8000-000000000002'));
  await frame.getByRole('heading',{name:'Let’s make your next video go viral.'}).waitFor();
  await frame.evaluate(()=>{const pending=window.pending[0];const args=pending.args;const id=args.project_id;const version=args.expected_version+1;
    pending.resolve({structuredContent:{ok:true,data:{request_id:args.request_id,project:{id,name:args.name,project_type:'brand',current_version:version,created_at:'2026-10-11T10:00:00Z',updated_at:'2026-10-11T12:00:00Z',brief_version:{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',project_id:id,version,name:args.name,brief:args.brief,created_at:'2026-10-11T12:00:00Z'}}}}});});
  await frame.waitForTimeout(100);
  assert.equal(await frame.getByText('Unsaved local audience').count(),0,'late account-A work cannot reappear for account B');
  assert.equal(await frame.getByText('Context saved',{exact:true}).count(),0);
});
