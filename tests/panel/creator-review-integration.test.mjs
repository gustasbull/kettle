import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

// Test-only composition. No test fixtures, server or script are production entries.
test('filtered DNA controller renders the real saved-view component without host/provider side effects', async t => {
  const bundle = await build({
    stdin: { resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'ts', contents: `
      import { mountSavedCreatorReview } from './apps/panel/creator-review.ts';
      import { creatorDnaViewFixture } from './evals/creator-loop/dna-view-fixtures.ts';
      import { creatorFailure } from './packages/application/creator-operations.ts';
      window.calls = [];
      window.makeResult = (version = 1) => {
        const dna = creatorDnaViewFixture(); dna.version = version;
        dna.snapshot_id = '00000000-0000-4000-8000-' + String(200 + version).padStart(12, '0');
        return {ok:true, data:{dna}};
      };
      window.mount = (timeout = 10000) => {
        window.review?.dispose(); window.calls = [];
        window.review = mountSavedCreatorReview(document.querySelector('#root'), (input, signal) =>
          new Promise((resolve, reject) => window.calls.push({input, signal, resolve, reject})), timeout);
      };
      window.launch = (tools = true) => {
        const output = window.makeResult();
        window.review.receiveInput({dna_id:output.data.dna.dna_id});
        window.review.receiveResult(output); window.review.connected(tools);
      };
      window.failure = creatorFailure;
      window.mount();
    ` }, bundle: true, format: 'iife', platform: 'browser', write: false,
  });
  const server = createServer((req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'");
    if (req.url === '/entry.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(bundle.outputFiles[0].text); }
    else if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width"><div id="root"></div><script src="/entry.js"></script>'); }
    else { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [], unexpected = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (![base + '/', base + '/entry.js'].includes(request.url())) unexpected.push(request.url()); });
  await page.goto(base);
  const root = page.locator('#root');

  await t.test('real saved state uses public fixture with zero initial reads and inert provider links', async () => {
    assert.match(await root.textContent(), /Loading/);
    await page.evaluate(() => window.launch());
    assert.match(await root.textContent(), /Saved version 1/);
    assert.match(await root.textContent(), /Contains fictional test data/);
    assert.match(await root.textContent(), /Desk demonstrations appear/);
    assert.doesNotMatch(await root.textContent(), /authored-fixture|fixture\/profile/);
    assert.equal(await root.locator('a,button,input,textarea').count(), 0);
    assert.equal(await page.evaluate(() => window.calls.length), 0);
  });
  await t.test('explicit refresh calls only the supplied read and preserves evidence focus', async () => {
    await root.locator('summary').first().click();
    await page.evaluate(() => { window.pending = window.review.refresh(); void window.review.refresh(); });
    assert.equal(await page.evaluate(() => window.calls.length), 1);
    assert.deepEqual(await page.evaluate(() => window.calls[0].input), { dna_id: '00000000-0000-4000-8000-000000000004' });
    await page.evaluate(async () => { window.calls[0].resolve(window.makeResult(2)); await window.pending; });
    assert.match(await root.textContent(), /Saved version 2/);
    assert.equal(await root.locator('details').first().evaluate(el => el.open), true);
    assert.equal(await root.locator('summary').first().evaluate(el => el === document.activeElement), true);
  });
  await t.test('auth loss clears the real DOM and an outstanding response cannot restore it', async () => {
    await page.evaluate(() => { window.pending = window.review.refresh(); window.review.receiveResult(window.failure('UNAUTHENTICATED')); });
    assert.match(await root.textContent(), /Reconnect your Riff account/);
    assert.doesNotMatch(await root.textContent(), /Desk demonstrations|Saved version/);
    await page.evaluate(async () => { window.calls[1].resolve(window.makeResult(3)); await window.pending; });
    assert.equal(await page.evaluate(() => window.calls[1].signal.aborted), true);
    assert.doesNotMatch(await root.textContent(), /Desk demonstrations/);
  });
  await t.test('timeout maps to supported recovery UI and explicit retry restores saved view', async () => {
    await page.evaluate(() => { window.mount(20); window.launch(); });
    await page.evaluate(() => window.review.refresh());
    assert.match(await root.textContent(), /Refresh timed out/);
    assert.match(await root.textContent(), /Ask Riff in chat to reopen/);
    assert.doesNotMatch(await root.textContent(), /Desk demonstrations/);
    await page.evaluate(async () => { const p = window.review.refresh(); window.calls[1].resolve(window.makeResult(2)); await p; });
    assert.match(await root.textContent(), /Saved version 2/);
  });
  await t.test('capability absence stays readable; wrong ID clears; disposal removes view and callbacks', async () => {
    await page.evaluate(() => { window.mount(); window.launch(false); });
    await page.evaluate(() => window.review.refresh());
    assert.match(await root.textContent(), /Saved version 1/);
    assert.equal(await page.evaluate(() => window.calls.length), 0);
    await page.evaluate(() => {
      const result = window.makeResult(); result.data.dna.dna_id = '00000000-0000-4000-8000-000000009999';
      window.review.receiveResult(result);
    });
    assert.match(await root.textContent(), /mismatched/);
    await page.evaluate(() => { window.review.dispose(); window.review.dispose(); window.review.receiveResult(window.makeResult()); });
    assert.equal(await root.textContent(), '');
  });
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
});
