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

test('Riff onboarding stays static after a real mounted handshake and never calls a server tool', async (t) => {
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
        if(message.method==='ui/notifications/initialized') window.ready=true;
        if(message.method==='tools/call') window.calls.push(message.params);
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
});
