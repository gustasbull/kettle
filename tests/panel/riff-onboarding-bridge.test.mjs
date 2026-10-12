import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { build } from 'esbuild';

test('Riff onboarding bridge mounts safely without a parent host and disposes', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffOnboardingBridge } from './apps/panel/riff-onboarding-bridge.ts';
    window.bridge=mountRiffOnboardingBridge(document.getElementById('mount'), {timeoutMs:25});
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(`<div id="mount"></div><script>${bundle.outputFiles[0].text}</script>`);
  assert.equal(await page.getByRole('heading', { name: 'Welcome to Riff' }).count(), 1);
  await page.evaluate(() => window.bridge.dispose());
  assert.equal(await page.locator('#mount').textContent(), '');
});

test('Riff onboarding marks only from its visible final step after a real mounted handshake', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffOnboardingBridge } from './apps/panel/riff-onboarding-bridge.ts';
    window.bridge=mountRiffOnboardingBridge(document.getElementById('mount'), {timeoutMs:250});
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/frame') return res.end(`<div id="mount"></div><script>${bundle.outputFiles[0].text}</script>`);
    res.end(`<script>
      window.calls=[]; window.methods=[]; window.sizes=[]; window.ready=false;
      const frame=()=>document.querySelector('iframe').contentWindow;
      addEventListener('message',event=>{const message=event.data;
        window.methods.push(message.method||('response:'+message.id));
        if(message.method==='ui/initialize') frame().postMessage({jsonrpc:'2.0',id:message.id,result:{
          protocolVersion:message.params.protocolVersion,hostInfo:{name:'fixture',version:'1'},
          hostCapabilities:{serverTools:{}},hostContext:{theme:'light',locale:'en'}
        }},'*');
        if(message.method==='ui/notifications/initialized') {
          frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{
            structuredContent:{steps:['Start','Find','Make'],expected_account_id:'11111111-1111-4111-8111-111111111111'},content:[],isError:false,_meta:{}
          }},'*');
          window.ready=true;
        }
        if(message.method==='tools/call') {
          window.calls.push(message.params);
          frame().postMessage({jsonrpc:'2.0',id:message.id,result:{
            structuredContent:{ok:true,data:{onboarding_seen_at:'2026-10-11T08:05:00Z'}},content:[],isError:false,_meta:{}
          }},'*');
        }
        if(message.method==='ui/notifications/size-changed') window.sizes.push(message.params);
      });
    </script><iframe src="/frame"></iframe>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const base = `http://127.0.0.1:${server.address().port}`;

  await page.goto(base);
  await page.waitForFunction(() => window.ready, undefined, { timeout: 2_000 });
  await page.waitForTimeout(80);
  const frame = page.frames().find((item) => item.url().endsWith('/frame'));
  assert.equal(await frame.getByRole('heading', { name: 'Welcome to Riff' }).count(), 1);
  const trace = await page.evaluate(() => ({ calls: window.calls, methods: window.methods, sizes: window.sizes }));
  assert.deepEqual(trace.calls, [], JSON.stringify(trace.methods));
  assert.equal(trace.methods.includes('tools/call'), false, JSON.stringify(trace.methods));
  assert.equal(trace.methods.includes('ui/notifications/size-changed'), true,
    'the dependency-light bridge still reports the inline Paper card size to its host');
  assert.ok(trace.sizes.some(size => size.width > 0 && size.height >= 647), JSON.stringify(trace.sizes));
  await frame.getByRole('button',{name:'Next step'}).click();
  await frame.getByRole('button',{name:'Next step'}).click();
  assert.deepEqual(await page.evaluate(()=>window.calls),[], 'viewing the guide does not mark onboarding');
  await frame.getByRole('button',{name:'Finish welcome'}).click();
  await frame.getByRole('status').getByText(/Welcome completed.*Home is ready/i).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.calls),[{name:'mark_riff_onboarding_seen',arguments:{
    expected_account_id:'11111111-1111-4111-8111-111111111111',
  }}]);
});

test('Riff onboarding keeps completion retryable across unsupported, malformed, rejected, and timed-out writes',async t=>{
  const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:`
    import { mountRiffOnboardingBridge } from './apps/panel/riff-onboarding-bridge.ts';
    window.mode='extra';window.markCalls=0;
    const install=()=>window.openai={callTool:async(name,args)=>{
      if(name!=='mark_riff_onboarding_seen')throw new Error('unexpected tool');
      window.markCalls++;
      if(window.mode==='reject')throw new Error('fixture rejection');
      if(window.mode==='timeout')return new Promise(()=>{});
      if(window.mode==='invalid')return {structuredContent:{ok:true,data:{onboarding_seen_at:'0'}},content:[]};
      if(window.mode==='extra')return {structuredContent:{ok:true,data:{onboarding_seen_at:'2026-01-01T00:01:00Z',private:true}},content:[]};
      if(window.mode==='errorflag')return {structuredContent:{ok:true,data:{onboarding_seen_at:'2026-01-01T00:01:00Z'}},content:[],isError:true};
      return {structuredContent:{ok:true,data:{onboarding_seen_at:'2026-01-01T00:01:00Z'}},content:[],isError:false,_meta:{}};
    }};
    install();window.setMode=mode=>{window.mode=mode;if(mode==='unsupported')delete window.openai;else install();};
    window.bridge=mountRiffOnboardingBridge(document.getElementById('mount'),{timeoutMs:300,toolTimeoutMs:60});
  `},bundle:true,platform:'browser',format:'iife',write:false});
  const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');
    if(req.url==='/frame')return res.end(`<div id="mount"></div><script>${bundle.outputFiles[0].text}</script>`);
    res.end(`<script>window.ready=false;const frame=()=>document.querySelector('iframe').contentWindow;
      addEventListener('message',event=>{const message=event.data;
        if(message.method==='ui/initialize')frame().postMessage({jsonrpc:'2.0',id:message.id,result:{protocolVersion:message.params.protocolVersion,hostInfo:{name:'welcome-failures',version:'1'},hostCapabilities:{},hostContext:{}}},'*');
        if(message.method==='ui/notifications/initialized'){
          frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{
            structuredContent:{steps:['Start','Find','Make'],expected_account_id:'11111111-1111-4111-8111-111111111111'},content:[],isError:false,_meta:{}
          }},'*');window.ready=true;
        }
      });</script><iframe src="/frame"></iframe>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage();page.setDefaultTimeout(4_000);
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.ready);
  const frame=page.frames().find(candidate=>candidate.url().endsWith('/frame'));
  await frame.getByRole('button',{name:'Next step'}).click();await frame.getByRole('button',{name:'Next step'}).click();
  for(const mode of ['unsupported','extra','invalid','errorflag','reject','timeout']){
    await frame.evaluate(value=>window.setMode(value),mode);
    await frame.getByRole('button',{name:'Finish welcome'}).click();
    await frame.getByRole('status').getByText(/could not confirm/i).waitFor();
    assert.equal(await frame.getByRole('region',{name:'Welcome to Riff'}).isVisible(),true,mode);
    assert.equal(await frame.getByRole('button',{name:'Finish welcome'}).isEnabled(),true,mode);
  }
  await frame.evaluate(()=>window.setMode('success'));
  await frame.getByRole('button',{name:'Finish welcome'}).click();
  await frame.getByRole('status').getByText(/Welcome completed.*Home is ready/i).waitFor();
  assert.equal(await frame.evaluate(()=>window.markCalls),6,
    'unsupported transport never reached a tool; five failed attempts and one confirmed retry did');
});

test('Riff onboarding tells an unbound or stale-account welcome to reopen for the current account',async t=>{
  const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:`
    import { mountRiffOnboardingBridge } from './apps/panel/riff-onboarding-bridge.ts';
    window.bridge=mountRiffOnboardingBridge(document.getElementById('mount'),{timeoutMs:300,toolTimeoutMs:200});
  `},bundle:true,platform:'browser',format:'iife',write:false});
  const accountA='11111111-1111-4111-8111-111111111111',accountB='22222222-2222-4222-8222-222222222222';
  const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');
    if(req.url==='/frame')return res.end(`<div id="mount"></div><script>${bundle.outputFiles[0].text}</script>`);
    res.end(`<script>
      window.ready=false;window.calls=[];window.writes=[];window.activeAccount='${accountB}';
      const frame=()=>document.querySelector('iframe').contentWindow;
      window.issue=value=>frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:value},'*');
      window.useAccount=value=>window.activeAccount=value;
      addEventListener('message',event=>{const message=event.data;
        if(message.method==='ui/initialize')frame().postMessage({jsonrpc:'2.0',id:message.id,result:{
          protocolVersion:message.params.protocolVersion,hostInfo:{name:'account-switch',version:'1'},
          hostCapabilities:{serverTools:{}},hostContext:{}
        }},'*');
        if(message.method==='ui/notifications/initialized'){
          window.issue({structuredContent:{steps:['Start','Find','Make']},content:[]});window.ready=true;
        }
        if(message.method==='tools/call'){
          window.calls.push(message.params);const expected=message.params.arguments.expected_account_id;
          if(expected!==window.activeAccount){
            frame().postMessage({jsonrpc:'2.0',id:message.id,result:{structuredContent:{ok:false,error:{
              code:'VERSION_CONFLICT',message:'Riff state changed.',retryable:false,recovery:'reload'
            }},content:[],isError:true,_meta:{}}},'*');return;
          }
          window.writes.push(window.activeAccount);
          frame().postMessage({jsonrpc:'2.0',id:message.id,result:{structuredContent:{ok:true,data:{
            onboarding_seen_at:'2026-10-11T08:05:00Z'
          }},content:[],isError:false,_meta:{}}},'*');
        }
      });
    </script><iframe src="/frame"></iframe>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage();page.setDefaultTimeout(4_000);
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.ready);
  const frame=page.frames().find(candidate=>candidate.url().endsWith('/frame'));
  await frame.getByRole('button',{name:'Next step'}).click();await frame.getByRole('button',{name:'Next step'}).click();

  await frame.getByRole('button',{name:'Finish welcome'}).click();
  await frame.getByRole('status').getByText(/not bound.*current Riff account.*reopen the welcome guide/i).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.calls),[],'missing account binding must not invoke a write');

  await page.evaluate(value=>window.issue({structuredContent:{
    steps:['Start','Find','Make'],expected_account_id:value,
  },content:[],isError:false,_meta:{}}),accountA);
  await frame.getByRole('button',{name:'Finish welcome'}).click();
  await frame.getByRole('status').getByText(/belongs to another Riff account.*reopen the welcome guide.*current account/i).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.writes),[],'account switch rejection leaves both accounts unmarked');
  assert.deepEqual(await page.evaluate(()=>window.calls),[{name:'mark_riff_onboarding_seen',arguments:{expected_account_id:accountA}}]);
  assert.equal(await frame.getByRole('button',{name:'Finish welcome'}).isEnabled(),true);
});
