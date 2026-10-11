import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { build } from 'esbuild';

test('Riff Home bridge receives account state, host styles, messages, and teardown', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffHomeBridge } from './apps/panel/riff-home-bridge.ts';
    window.bridge=mountRiffHomeBridge(document.getElementById('mount'), {timeoutMs:500});
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/frame') return res.end(`<div id="mount"></div><script>${bundle.outputFiles[0].text}</script>`);
    res.end(`<script>
      window.messages=[]; window.calls=[]; window.ready=false;
      const frame=()=>document.querySelector('iframe').contentWindow;
      addEventListener('message',e=>{const m=e.data;
        if(m.method==='ui/initialize') frame().postMessage({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params.protocolVersion,hostInfo:{name:'fixture',version:'1'},hostCapabilities:{serverTools:{},message:{text:{}},experimental:{'openai/message':{}}},hostContext:{theme:'dark',locale:'lt',safeAreaInsets:{top:7,right:8,bottom:9,left:10},styles:{variables:{'--color-background-primary':'#101010'},css:{fonts:'body{letter-spacing:.01px}'}}}}},'*');
        if(m.method==='ui/notifications/initialized'){frame().postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ok:true,data:{account:{id:'00000000-0000-4000-8000-000000000001',display_name:'Fixture',state:'active',preferred_language:'en',created_at:'2026-01-01T00:00:00Z',onboarding_seen_at:null},entitlements:{status:'not_configured'},usage:{status:'not_configured',reset_at:null}}},content:[]}},'*');window.ready=true;}
        if(m.method==='ui/message'){window.messages.push(m.params);frame().postMessage({jsonrpc:'2.0',id:m.id,result:{}},'*');}
        if(m.method==='tools/call'){window.calls.push(m.params);frame().postMessage({jsonrpc:'2.0',id:m.id,result:{content:[],structuredContent:{steps:['Start','Find','Make']}}},'*');}
        if(m.id==='teardown')window.tornDown=true;
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
  await page.waitForFunction(() => window.ready);
  const frame = page.frames().find((item) => item.url().endsWith('/frame'));
  await frame.waitForFunction(() => document.body.textContent.includes('Fixture'));
  assert.equal(await frame.evaluate(() => document.documentElement.lang), 'lt');
  assert.equal(await frame.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.equal(await frame.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--riff-safe-top')), '7px');
  assert.equal(await frame.locator('#__mcp-host-fonts').count(), 1);
  assert.equal(await frame.getByRole('region', { name: 'Welcome to Riff' }).count(), 1);
  assert.equal(await frame.getByPlaceholder('Share a video or profile link, or tell me what you want to make…').count(), 1);
  await page.waitForFunction(() => window.calls.length === 1);
  assert.deepEqual(await page.evaluate(() => window.calls.map(({ name, arguments: args }) => ({ name, arguments: args }))),
    [{ name: 'mark_riff_onboarding_seen', arguments: {} }]);
  await frame.getByRole('button', { name: 'Show welcome' }).click();
  await page.waitForFunction(() => window.calls.length === 2);
  assert.deepEqual(await page.evaluate(() => window.calls.map(({ name, arguments: args }) => ({ name, arguments: args }))),
    [{ name: 'mark_riff_onboarding_seen', arguments: {} }, { name: 'show_riff_welcome', arguments: {} }]);
  await frame.getByRole('button', { name: 'Trending videos' }).click();
  await page.waitForFunction(() => window.messages.length === 1);
  assert.deepEqual(await page.evaluate(() => window.messages[0]._meta['openai/message']), { target: 'active', send: true });
  await page.evaluate(() => frame().postMessage({jsonrpc:'2.0',id:'teardown',method:'ui/resource-teardown',params:{}},'*'));
  await page.waitForFunction(() => window.tornDown);
  await frame.waitForFunction(() => document.querySelector('#mount').textContent === '');
});
