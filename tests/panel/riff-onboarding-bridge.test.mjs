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

test('Riff onboarding marks a real mounted handshake once and does not retry a failed mark', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffOnboardingBridge } from './apps/panel/riff-onboarding-bridge.ts';
    window.bridge=mountRiffOnboardingBridge(document.getElementById('mount'), {timeoutMs:250});
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/frame') return res.end(`<div id="mount"></div><script>${bundle.outputFiles[0].text}</script>`);
    res.end(`<script>
      window.calls=[]; window.methods=[]; window.ready=false;
      const frame=()=>document.querySelector('iframe').contentWindow;
      addEventListener('message',event=>{const message=event.data;
        window.methods.push(message.method||('response:'+message.id));
        if(message.method==='ui/initialize') frame().postMessage({jsonrpc:'2.0',id:message.id,result:{
          protocolVersion:message.params.protocolVersion,hostInfo:{name:'fixture',version:'1'},
          hostCapabilities:{serverTools:{}},hostContext:{theme:'light',locale:'en'}
        }},'*');
        if(message.method==='ui/notifications/initialized') window.ready=true;
        if(message.method==='tools/call'){
          window.calls.push(message.params);
          const failed=location.search==='?fail';
          frame().postMessage({jsonrpc:'2.0',id:message.id,result:failed
            ?{content:[],isError:true,structuredContent:{ok:false,error:{code:'UNAVAILABLE',message:'Unavailable',retryable:true,recovery:'retry_same_request'}}}
            :{content:[],structuredContent:{ok:true,data:{onboarding_seen_at:'2026-10-11T12:00:00Z'}}}},'*');
        }
      });
    </script><iframe src="/frame"></iframe>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const base = `http://127.0.0.1:${server.address().port}`;

  for (const query of ['', '?fail']) {
    await page.goto(`${base}/${query}`);
    await page.waitForFunction(() => window.ready, undefined, { timeout: 2_000 });
    await page.waitForTimeout(80);
    const frame = page.frames().find((item) => item.url().endsWith('/frame'));
    assert.equal(await frame.getByRole('heading', { name: 'Welcome to Riff' }).count(), 1);
    const trace = await page.evaluate(() => ({
      calls: window.calls.map(({ name, arguments: args }) => ({ name, arguments: args })), methods: window.methods,
    }));
    assert.deepEqual(trace.calls, [{ name: 'mark_riff_onboarding_seen', arguments: {} }], JSON.stringify(trace.methods));
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => window.calls.length), 1);
  }
});
