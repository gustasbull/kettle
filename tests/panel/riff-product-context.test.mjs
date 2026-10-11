import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'esbuild';

const description = '  Blocks distracting sites so a person can focus on one task.  ';

test('Product context renders the truthful Paper flow as an accessible controlled editor', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffProductContext } from './apps/panel/riff-product-context/index.ts';
    window.saves=[]; window.discovers=[];
    window.product=mountRiffProductContext(document.getElementById('root'), {
      onSave(context){ return new Promise(resolve=>window.saves.push({context,resolve})); },
      async onDiscover(project){ window.discovers.push(project); return {status:'failed',message:'The ChatGPT handoff failed. Continue in the composer.'}; },
    });
    window.start=description=>window.product.start({kind:'unsaved',description});
    window.makeProject=(context,version=1)=>({
      id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:context.draft.product.trim(),project_type:'brand',current_version:version,
      created_at:'2026-10-11T10:00:00Z',updated_at:'2026-10-11T10:00:00Z',
      brief_version:{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',project_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        version,name:context.draft.product.trim(),brief:{product:context.draft.product.trim(),description:context.draft.description.trim(),
          audience:context.draft.audience.trim(),goal:context.draft.goal.trim(),tone:context.draft.tone.trim(),language:context.draft.language.trim(),
          duration_seconds:Number(context.draft.duration_seconds),filming_constraints:[...context.draft.filming_constraints],facts:[]},
        created_at:'2026-10-11T10:00:00Z'}
    });
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());

  for (const viewport of [{ width: 320, height: 900 }, { width: 768, height: 1024 }, { width: 1440, height: 1000 }]) {
    const page = await browser.newPage({ viewport });
    await page.setContent(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`);
    await page.evaluate((value) => window.start(value), description);
    await page.getByRole('heading', { name: 'Give your product viral potential.' }).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Give your product viral potential.');
    assert.match(await page.locator('body').textContent(), /Fine-tune your brief\. We’ll find video ideas that bring your product to life\./);
    assert.equal(await page.getByRole('form', { name: 'Your product brief' }).count(), 1);
    for (const name of ['Product', 'Description', 'Audience', 'Main benefit', 'Content style', 'Language', 'Duration in seconds']) {
      assert.equal(await page.getByLabel(name, { exact: true }).count(), 1, name);
    }
    assert.equal(await page.getByLabel('Description', { exact: true }).inputValue(), description,
      'the exact submitted text remains editable');
    assert.equal(await page.locator('input[placeholder="Unknown — add a value"], textarea[placeholder="Unknown — add a value"]').count() >= 5, true);
    assert.equal(await page.locator('.riff-product__identity').isHidden(), true,
      'illustrative identity/category data is never shown before a user product name');
    assert.equal(await page.getByRole('button', { name: 'Confirm context' }).isEnabled(), true,
      'Confirm remains reachable so validation can explain every invalid field');
    assert.match(await page.locator('[data-product-validation-help]').textContent(),
      /Product name is required.*Audience is required.*Main benefit is required.*Content style is required.*Language is required.*Duration must be/s);

    await page.getByRole('button', { name: 'Confirm context' }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Product');
    assert.equal(await page.getByLabel('Product', { exact: true }).getAttribute('aria-invalid'), 'true');
    const productError = await page.getByLabel('Product', { exact: true }).getAttribute('aria-describedby');
    assert.ok(productError);
    assert.match(await page.locator(`#${productError.split(' ')[0]}`).textContent(), /product name/i);

    await page.getByLabel('Product', { exact: true }).fill('FocusNest');
    assert.equal(await page.locator('.riff-product__identity').isVisible(), true);
    assert.match(await page.locator('.riff-product__identity').textContent(), /FocusNest/);
    await page.getByLabel('Audience', { exact: true }).fill('Freelancers who get distracted online.');
    await page.getByLabel('Main benefit', { exact: true }).fill('Fewer distractions and more focused work.');
    await page.getByLabel('Content style', { exact: true }).fill('Relatable distractions and simple product demos.');
    await page.getByLabel('Language', { exact: true }).fill('en');
    await page.getByLabel('Duration in seconds', { exact: true }).fill('20');

    const addConstraint = page.getByRole('button', { name: 'Add filming constraint' });
    await addConstraint.focus(); await page.keyboard.press('Enter');
    await page.getByLabel('Filming constraint 1').fill('Home desk');
    const removeConstraint = page.getByRole('button', { name: 'Remove filming constraint 1' });
    assert.ok((await removeConstraint.boundingBox()).height >= 44);
    await removeConstraint.focus(); await page.keyboard.press('Space');
    assert.equal(await page.getByLabel('Filming constraint 1').count(), 0);

    const confirm = page.getByRole('button', { name: 'Confirm context' });
    assert.equal(await confirm.isEnabled(), true);
    await confirm.click();
    await page.waitForFunction(() => window.saves.length === 1);
    assert.equal(await page.getByRole('form', { name: 'Your product brief' }).getAttribute('aria-busy'), 'true');
    assert.equal(await page.getByLabel('Product', { exact: true }).isDisabled(), true);
    assert.match(await page.getByRole('status').textContent(), /Saving your product context/);
    await page.evaluate(() => {
      const save=window.saves[0]; save.resolve({status:'saved',project:window.makeProject(save.context),requestId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'});
    });
    await page.getByText('Context saved', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Discover formats' }).isEnabled(), true);
    await page.getByRole('button', { name: 'Discover formats' }).click();
    assert.equal(await page.evaluate(() => window.discovers.length), 1);
    assert.match(await page.getByRole('status').textContent(), /handoff failed/i);
    assert.equal(await page.getByRole('heading', { name: 'Give your product viral potential.' }).count(), 1,
      'a rejected handoff keeps saved context visible');

    await page.getByLabel('Audience', { exact: true }).fill('Small remote teams');
    assert.equal(await page.getByRole('button', { name: 'Discover formats' }).count(), 0,
      'editing a receipt-backed snapshot requires confirmation again');
    assert.equal(await confirm.isEnabled(), true);

    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    if (viewport.width === 1440) {
      assert.equal(await page.locator('.riff-product__panel').evaluate(node => Math.round(node.getBoundingClientRect().width)), 905);
      assert.equal(await page.locator('.riff-product__brief').evaluate(node => Math.round(node.getBoundingClientRect().width)), 540);
      assert.equal(await page.getByRole('heading', { name: 'Give your product viral potential.' }).evaluate(node => getComputedStyle(node).fontSize), '25px');
    }
    if (viewport.width === 320) {
      assert.equal(await page.locator('.riff-product__content').evaluate(node => getComputedStyle(node).flexDirection), 'column');
    }

    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce', forcedColors: 'active' });
    assert.equal(await page.locator('.riff-product').evaluate(node => getComputedStyle(node).overflowX), 'hidden');
    await page.addStyleTag({ content: '.riff-product :is(h1,h2,p,label,input,textarea,button,legend,span){font-size:200% !important;line-height:1.5 !important}' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    await page.close();
  }
});

test('Product context exposes complete inline validation through real keyboard and click submission', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffProductContext } from './apps/panel/riff-product-context/index.ts';
    const product=mountRiffProductContext(document.getElementById('root'),{
      async onSave(){throw new Error('invalid drafts must not save')},
      async onDiscover(){return {status:'sent',message:'Sent.'}},
    });
    product.start({kind:'unsaved',description:'Initial description'});
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 768, height: 1000 } });
  await page.setContent(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`);
  await page.getByRole('heading', { name: 'Give your product viral potential.' }).waitFor();
  await page.getByLabel('Product', { exact: true }).fill('Unknown');
  await page.getByLabel('Description', { exact: true }).fill('Unknown — add a value');
  await page.getByLabel('Audience', { exact: true }).evaluate((control) => {
    control.value = 'a'.repeat(1001); control.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.getByLabel('Main benefit', { exact: true }).fill('A real benefit');
  await page.getByLabel('Content style', { exact: true }).fill('Demo');
  await page.getByLabel('Language', { exact: true }).fill('en');
  await page.getByLabel('Duration in seconds', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Add filming constraint' }).click();

  const confirm = page.getByRole('button', { name: 'Confirm context' });
  assert.equal(await confirm.isEnabled(), true);
  await confirm.focus(); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Product');
  for (const name of ['Product', 'Description', 'Audience', 'Duration in seconds']) {
    const control = page.getByLabel(name, { exact: true });
    assert.equal(await control.getAttribute('aria-invalid'), 'true', name);
    const errorId = await control.getAttribute('aria-describedby'); assert.ok(errorId, name);
    assert.equal(await page.locator(`#${errorId}`).isVisible(), true, name);
  }
  assert.match(await page.locator('[data-product-validation-help]').textContent(),
    /Product name is required.*Description is required.*Audience must be 1000 characters or fewer.*Duration must be a whole number/s);
  const constraints = page.getByRole('group', { name: 'Filming constraints' });
  assert.equal(await constraints.getAttribute('aria-invalid'), 'true');
  assert.match(await page.locator(`#${await constraints.getAttribute('aria-describedby')}`).textContent(), /empty filming constraints/i);

  await page.getByLabel('Product', { exact: true }).fill('FocusNest');
  await page.getByLabel('Description', { exact: true }).fill('A real product description');
  await page.getByLabel('Audience', { exact: true }).fill('Remote workers');
  await page.getByLabel('Duration in seconds', { exact: true }).fill('20');
  await confirm.focus(); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Filming constraint 1');

  await page.getByLabel('Filming constraint 1').fill('Home desk');
  const add = page.getByRole('button', { name: 'Add filming constraint' });
  for (let count = 1; count < 21; count++) {
    await add.click();
    await page.getByLabel(`Filming constraint ${count + 1}`).fill(`Constraint ${count + 1}`);
  }
  assert.equal(await page.locator('.riff-product__constraint').count(), 21);
  await confirm.click();
  assert.match(await page.locator(`#${await constraints.getAttribute('aria-describedby')}`).textContent(), /at most 20/i);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Filming constraint 1');
});

test('Product pending advances on the next paint and cancels stale or disposed frames without timers', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffProductContext } from './apps/panel/riff-product-context/index.ts';
    window.frames=[];window.cancelled=[];window.timerDelays=[];
    window.requestAnimationFrame=callback=>{window.frames.push(callback);return window.frames.length};
    window.cancelAnimationFrame=id=>window.cancelled.push(id);
    window.setTimeout=(_callback,delay)=>{window.timerDelays.push(delay);return 99};
    window.product=mountRiffProductContext(document.getElementById('root'),{
      async onSave(){return {status:'failed',message:'unused'}},
      async onDiscover(){return {status:'sent',message:'unused'}},
    });
    window.start=value=>window.product.start({kind:'unsaved',description:value});
    window.flush=id=>{if(!window.cancelled.includes(id))window.frames[id-1](performance.now())};
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setContent(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`);
  await page.evaluate(() => window.start('First'));
  assert.equal(await page.locator('[data-product-state="pending"]').count(), 1);
  assert.equal(await page.locator('.riff-product__pending-segment').evaluate(node => getComputedStyle(node).animationName), 'none');
  assert.match(await page.locator('.riff-product').textContent(), /Description received/);
  assert.doesNotMatch(await page.locator('.riff-product').textContent(), /Identifying your audience|[0-9]+%/);
  await page.evaluate(() => window.start('Second'));
  assert.deepEqual(await page.evaluate(() => ({ frames: window.frames.length, timers: window.timerDelays, cancelled: window.cancelled })),
    { frames: 2, timers: [], cancelled: [1] });
  await page.evaluate(() => window.flush(1));
  assert.equal(await page.locator('[data-product-state="pending"]').count(), 1);
  await page.evaluate(() => window.flush(2));
  assert.equal(await page.getByLabel('Description', { exact: true }).inputValue(), 'Second');
  await page.evaluate(() => { window.start('Disposed'); window.product.dispose(); });
  assert.deepEqual(await page.evaluate(() => window.cancelled), [1, 3]);
  await page.evaluate(() => window.flush(3));
  assert.equal(await page.locator('#root').textContent(), '');
});

test('Product context preserves a local draft through conflict reconciliation and focuses recovery', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountRiffProductContext } from './apps/panel/riff-product-context/index.ts';
    window.calls=[];
    const historical={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'Saved product',project_type:'brand',current_version:2,
      created_at:'2026-10-11T10:00:00Z',updated_at:'2026-10-11T11:00:00Z',brief_version:{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        project_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',version:2,name:'Saved product',created_at:'2026-10-11T11:00:00Z',brief:{
          product:'Saved product',description:'Saved description',audience:'Saved audience',goal:'Saved goal',tone:'Saved tone',language:'en',duration_seconds:15,filming_constraints:[],facts:[]}}};
    window.product=mountRiffProductContext(document.getElementById('root'),{
      async onSave(context){window.calls.push(context);return {status:'conflict',latest:historical,message:'A newer saved version is available. Review your local edits and confirm again.'}},
      async onDiscover(){return {status:'sent',message:'Sent.'}},
    });
    window.product.start({kind:'saved',project:historical});
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 768, height: 900 } });
  await page.setContent(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`);
  await page.getByLabel('Audience', { exact: true }).fill('My unsaved local audience');
  await page.getByRole('button', { name: 'Confirm context' }).click();
  await page.getByText(/newer saved version is available/i).waitFor();
  assert.equal(await page.getByLabel('Audience', { exact: true }).inputValue(), 'My unsaved local audience');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Confirm context');
  await page.getByRole('button', { name: 'Confirm context' }).click();
  assert.equal(await page.evaluate(() => window.calls[1].project.current_version), 2,
    'a reconfirmed local draft updates from the trusted conflict reread snapshot');
});
