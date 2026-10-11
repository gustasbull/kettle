import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unstable_dev } from 'wrangler';
// Bangkok owns repository dependency integration. An existing external browser
// installation can run this check without modifying package.json or lockfile.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function toolResult(version = 1) {
  return { content: [], structuredContent: { ok: true, data: { project: {
    id: projectId, name: 'Fictional lamp', project_type: 'brand', current_version: version,
    created_at: '2026-10-06T00:00:00Z', updated_at: '2026-10-06T00:00:00Z',
    brief_version: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', project_id: projectId,
      version, name: 'Fictional lamp', created_at: '2026-10-06T00:00:00Z', brief: {
        product: 'A fictional lamp <script>untrusted()</script>', audience: 'Remote workers',
        goal: 'Show a desk setup', tone: 'Practical', language: 'en', duration_seconds: 20,
        filming_constraints: [], facts: [],
      } },
  } } } };
}

test('workerd serves the real bundle; browser exercises the MCP Apps parent bridge', { timeout: 90_000 }, async () => {
  process.env.WRANGLER_SEND_METRICS = 'false';
  const state = await mkdtemp(join(tmpdir(), 'kettle-review-runtime-'));
  const worker = await unstable_dev('tests/integration/project-review-worker.ts', {
    config: 'wrangler.jsonc', local: true, ip: '127.0.0.1', port: 0, inspectorPort: 0,
    persistTo: state, logLevel: 'error',
    experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false },
  });
  let browser;
  try {
    const rpc = async (method, params) => {
      const response = await worker.fetch('/mcp', { method: 'POST', headers: {
        'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      assert.equal(response.status, 200); return response.json();
    };
    const list = await rpc('tools/list', {});
    const tool = list.result.tools.find(t => t.name === 'show_project_brief');
    assert.equal(tool._meta.ui.resourceUri, 'ui://kettle/project-review-v1.html');
    const resource = (await rpc('resources/read', { uri: tool._meta.ui.resourceUri })).result.contents[0];
    assert.equal(resource.mimeType, 'text/html;profile=mcp-app');
    assert.deepEqual(resource._meta.ui.csp.connectDomains, []);
    assert.deepEqual(resource._meta.ui.csp.resourceDomains, []);
    const anonymous = await rpc('tools/call', { name: 'show_project_brief', arguments: { project_id: projectId } });
    assert.equal(anonymous.result.isError, true);
    assert.equal('structuredContent' in anonymous.result, false);
    assert.equal(anonymous.result.content[0].text, 'Connect or reauthorize your Riff account.');
    assert.ok(anonymous.result._meta['mcp/www_authenticate']);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 680, height: 950 } });
    const errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => requests.push(r.url()));
    await page.setContent('<!doctype html><title>MCP Apps local fixture host</title>');
    await page.evaluate(({ html, initial }) => {
      window.calls = [];
      window.supportsTools = true;
      window.initializeEnabled = true;
      window.notifications = [];
      window.send = message => window.card.contentWindow.postMessage({ jsonrpc: '2.0', ...message }, '*');
      window.addEventListener('message', event => {
        if (event.source !== window.card.contentWindow) return;
        const message = event.data;
        if (message.method === 'ui/initialize') {
          if (!window.initializeEnabled) return;
          window.initialization = message.params;
          window.send({ id: message.id, result: { protocolVersion: '2026-01-26',
            hostInfo: { name: 'local-fixture', version: '1' }, hostCapabilities: window.supportsTools ? { serverTools: {} } : {},
            hostContext: { theme: 'light', displayMode: 'inline', availableDisplayModes: ['inline'] },
          } });
        } else if (message.method === 'ui/notifications/initialized') {
          window.send({ method: 'ui/notifications/tool-input', params: { arguments: { project_id: initial.structuredContent.data.project.id } } });
          window.send({ method: 'ui/notifications/tool-result', params: initial });
        } else if (message.method === 'tools/call') window.calls.push(message);
        else window.notifications.push(message);
      });
      window.card = document.createElement('iframe');
      window.card.style.cssText = 'width:640px;height:900px;border:0';
      // Emulate the host's no-network policy and prohibit unsafe-eval. This is
      // a browser fixture policy, not evidence of ChatGPT's sandbox application.
      window.card.srcdoc = html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">`);
      document.body.append(window.card);
    }, { html: resource.text, initial: toolResult() });
    const card = page.frameLocator('iframe');
    await card.getByText('Saved version 1', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.calls.length), 0, 'launch must not reread');
    assert.deepEqual(await page.evaluate(() => window.initialization.appCapabilities.availableDisplayModes), ['inline']);
    assert.match(await card.locator('.kr-card').textContent(), /<script>untrusted\(\)<\/script>/);
    assert.equal(await card.locator('script').count(), 1, 'only the resource script exists');
    await card.getByRole('button', { name: 'Refresh brief', exact: true }).click();
    await page.waitForFunction(() => window.calls.length === 1);
    assert.deepEqual(await page.evaluate(() => ({ name: window.calls[0].params.name, arguments: window.calls[0].params.arguments })), { name: 'get_project', arguments: { project_id: projectId } });
    await card.getByRole('button', { name: 'Refreshing brief…', exact: true }).click({ force: true });
    assert.equal(await page.evaluate(() => window.calls.length), 1);
    await page.evaluate(result => window.send({ id: window.calls[0].id, result }), toolResult(2));
    await card.getByText('Saved version 2', { exact: true }).waitFor();

    // A sibling frame can post valid-looking JSON-RPC, but is not the bridge peer.
    await page.evaluate(result => {
      const sibling = document.createElement('iframe'); document.body.append(sibling);
      sibling.contentWindow.eval(`parent.card.contentWindow.postMessage(${JSON.stringify({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: result })}, '*')`);
      sibling.remove();
    }, toolResult(9));
    await page.waitForTimeout(50);
    assert.equal(await card.getByText('Saved version 2', { exact: true }).count(), 1);
    await page.evaluate(() => window.send({ method: 'ui/notifications/host-context-changed', params: { theme: 'dark' } }));
    await page.waitForFunction(() => window.card.contentDocument.documentElement.style.colorScheme === 'dark');
    await mkdir('.context/project-review-integration', { recursive: true });
    await page.screenshot({ path: '.context/project-review-integration/local-host-dark.png', fullPage: true });

    await card.getByRole('button', { name: 'Refresh brief', exact: true }).click();
    await page.waitForFunction(() => window.calls.length === 2);
    // Exercise the production ten-second timeout and recovery on the real SDK.
    await card.getByRole('button', { name: 'Refresh brief', exact: true }).waitFor({ timeout: 15_000 });
    assert.match(await card.locator('.kr-notice').textContent(), /Previously loaded/);
    await card.getByRole('button', { name: 'Refresh brief', exact: true }).click();
    await page.waitForFunction(() => window.calls.length === 3);
    await page.evaluate(result => window.send({ id: window.calls[2].id, result }), toolResult(3));
    await card.getByText('Saved version 3', { exact: true }).waitFor();
    await page.evaluate(result => window.send({ id: window.calls[1].id, result }), toolResult(2));
    await page.waitForTimeout(50);
    assert.equal(await card.getByText('Saved version 3', { exact: true }).count(), 1);

    await card.getByRole('button', { name: 'Refresh brief', exact: true }).click();
    await page.waitForFunction(() => window.calls.length === 4);
    await page.evaluate(() => window.send({ id: window.calls[3].id, result: {
      content: [], isError: true, _meta: { 'mcp/www_authenticate': ['Bearer realm="fixture"'] },
      structuredContent: { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Reconnect', retryable: false, recovery: 'reauthorize' } },
    } }));
    await card.getByText('Reconnect your Riff account through ChatGPT, then reopen this brief.', { exact: true }).waitFor();
    assert.equal(await card.getByText('Fictional lamp', { exact: true }).count(), 0);
    assert.equal(await card.getByRole('button').count(), 0);
    await page.evaluate(() => window.send({ id: 'teardown', method: 'ui/resource-teardown', params: {} }));
    await page.waitForFunction(() => window.notifications.some(m => m.id === 'teardown' && m.result));
    await page.waitForFunction(() => !window.card.contentDocument.querySelector('.kr-card'));
    // Reopen the real resource under an incapable host and then a silent host.
    await page.evaluate(html => { window.supportsTools = false; window.card.srcdoc = html; }, resource.text);
    await card.getByText('This host cannot refresh project briefs. Ask Riff to reopen this project brief in chat.', { exact: true }).waitFor();
    assert.equal(await card.getByRole('button').count(), 0);
    await page.evaluate(html => { window.initializeEnabled = false; window.card.srcdoc = html; }, resource.text);
    await card.getByText(/The (project brief did not load in time|ChatGPT connection is unavailable)/).first().waitFor({ timeout: 15_000 });
    assert.equal(await card.getByRole('button').count(), 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, [], 'UI performs no network requests');
  } finally {
    await browser?.close(); await worker.stop(); await rm(state, { recursive: true, force: true });
  }
});
