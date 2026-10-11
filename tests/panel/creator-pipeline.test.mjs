import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const internalUuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const internalWorkflowLanguage = /\b(?:creator job|recommendation batch|DNA(?: ID)?|script set|variant)\b|\bversion\s+\d+\b/i;

test('Riff creator pipeline reproduces the Paper CURRENT workflow with persisted data only', async (t) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountCreatorPipeline, creatorLoadingVariants } from './apps/panel/creator-pipeline/index.ts';
    import { pipelineFixture } from './apps/panel/creator-pipeline/fixtures.ts';
    window.actions=[]; window.fullscreen=[]; window.connectedActions=[]; window.discoveryLoads=[];
    window.creatorLoadingVariants=creatorLoadingVariants;
    window.boot=(scenario='scan',mode='fullscreen')=>{
      window.view?.dispose();
      window.view=mountCreatorPipeline(document.getElementById('root'),{
        displayMode:mode,
        sendPrompt:async prompt=>{window.actions.push(prompt);return {status:'sent',message:'Sent to ChatGPT.'}},
        requestFullscreen:async()=>{window.fullscreen.push(true);window.view.setDisplayMode('fullscreen');return {status:'sent',message:'Opened fullscreen.'}},
        onDiscoveryOpen:scope=>window.discoveryLoads.push({kind:'open',scope}),
        onCatalogNextPage:request=>window.discoveryLoads.push({kind:'next',request}),
      });
      window.job=pipelineFixture(scenario); window.view.render(window.job);
    };
    window.show=scenario=>{window.job=pipelineFixture(scenario);window.view.render(window.job)};
    window.bootConnected=(scenario='scan')=>{
      window.view?.dispose();
      window.view=mountCreatorPipeline(document.getElementById('root'),{
        displayMode:'fullscreen',
        sendPrompt:async prompt=>{window.actions.push(prompt);return {status:'sent',message:'Sent to ChatGPT.'}},
        startRecommendations:async ({job,dna})=>{window.connectedActions.push({kind:'recommendations',jobId:job.id,dnaId:dna.dna_id,version:dna.version});return {status:'sent',message:'Discovery started.'}},
        makeMine:async ({job,batch,idea,library,filter,intent})=>{window.connectedActions.push({kind:'make-mine',jobId:job.id,batchId:batch.id,ideaId:idea.id,library,filter,intent});return {status:'sent',message:'Drafting in ChatGPT.'}},
        setVariantState:async ({job,scripts,variant,state})=>{window.connectedActions.push({kind:'variant-state',jobId:job.id,scriptsId:scripts.id,variantId:variant.id,state});return {status:'sent',message:state==='saved'?'Saved for later.':'Marked as filmed.'}},
      });
      window.job=pipelineFixture(scenario); window.view.render(window.job);
    };
  ` }, bundle: true, format: 'iife', platform: 'browser', write: false });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.route('https://p16-sign.tiktokcdn.com/**', route => route.fulfill({
    status: 200, contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'),
  }));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const root = page.locator('#root');

  await t.test('fullscreen chrome keeps the exact Riff breadcrumb on one line', async () => {
    await page.setViewportSize({ width: 1055, height: 820 });
    await page.evaluate(() => boot('video-analysis', 'fullscreen'));
    const geometry = await root.locator('.riff-pipeline__brand').evaluate(node => {
      const text = node.querySelector('span');
      const logo = node.querySelector('svg');
      const brand = node.getBoundingClientRect();
      const textRect = text.getBoundingClientRect();
      const logoRect = logo.getBoundingClientRect();
      return {
        brandHeight: brand.height,
        textHeight: textRect.height,
        logoWidth: logoRect.width,
        text: text.textContent,
      };
    });
    assert.equal(geometry.text, 'Riff');
    assert.ok(geometry.brandHeight <= 24, `breadcrumb brand wrapped to ${geometry.brandHeight}px`);
    assert.ok(geometry.textHeight <= 20, `breadcrumb text wrapped to ${geometry.textHeight}px`);
    assert.equal(Math.round(geometry.logoWidth), 22);
    assert.match(await root.locator('.riff-pipeline__chrome-trail').textContent(), /Riff\s*\/\s*Analysis/);
    assert.equal(await root.getByRole('button', { name: 'Open Riff menu' }).count(), 1);
    await root.getByRole('button', { name: 'Open Riff menu' }).click();
    assert.equal(await root.getByRole('dialog', { name: 'Riff menu' }).evaluate(node => getComputedStyle(node).width), '288px');
    assert.equal(await root.getByRole('button', { name: 'Create a video' }).count(), 1);
    assert.equal(await root.getByText(/10 (?:runs|analysis) left/i).count(), 0);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1200, height: 900 });
  });

  await t.test('pending and recovery states contain no invented job chrome or retry action', async () => {
    await page.evaluate(() => boot('queued', 'fullscreen'));
    assert.equal(await root.locator('svg[aria-label="Riff"]').count(), 0);
    assert.doesNotMatch(await root.textContent(), /Saved Riff job|Job [0-9a-f-]+|Refresh job/i);
    assert.equal(await root.locator('[role="progressbar"]').count(), 1);
    assert.equal(await root.locator('[role="progressbar"][aria-valuenow]').count(), 0);
    assert.equal(await root.locator('.riff-pipeline__content button, .riff-pipeline__content a').count(), 0);
    assert.equal(await root.getByRole('heading', { name: 'Finding videos for your next idea' }).count(), 1);
    assert.match(await root.textContent(), /Looking through relevant creators, videos and formats\.|Comparing hooks and product showcases…|Your brief is ready|Choosing matching references/);
    assert.equal(await root.locator('.riff-loading-reference').count(), 7);
    await page.evaluate(() => { window.job.kind = 'scan'; window.job.source_kind = 'video'; window.view.render(window.job); });
    assert.equal(await root.getByRole('heading', { name: 'Fetching your video' }).count(), 1);
    assert.match(await root.textContent(), /Opening your link and loading the available video details\.|Your video|Loading your linked video…|Link received|Analyzing next/);
    assert.equal(await root.locator('.riff-loading-video').count(), 1);
    await page.evaluate(() => { window.job.stage='building_analysis'; window.view.render(window.job); });
    assert.equal(await root.getByRole('heading', { name: 'Analyzing your video' }).count(), 1);
    assert.match(await root.textContent(), /Reviewing the opening, delivery and call to action\.|Hook · Content · Pacing · Voice · CTA|Analyzing hooks and pacing…|Video fetched|Preparing your analysis/);
    assert.equal(await page.evaluate(() => window.creatorLoadingVariants.product.title), 'Understanding your product');
    assert.equal(await page.evaluate(() => window.creatorLoadingVariants.product.preview), 'none');
    await page.evaluate(() => { window.job.source_kind = 'profile'; window.view.render(window.job); });
    assert.equal(await root.getByRole('heading', { name: 'Getting to know your profile' }).count(), 1);
    assert.match(await root.textContent(), /Loading available posts and performance from your profile\.|Fetching your recent videos…|Profile found|Analyzing your content/);
    assert.equal(await root.locator('.riff-loading-profile__avatar').count(), 1);
    assert.equal(await root.locator('.riff-loading-profile .riff-loading-reference').count(), 6);
    assert.equal(await root.locator('.riff-loading-video').count(), 0);
    assert.deepEqual(await root.locator('.riff-loading-card').evaluate(node=>{const style=getComputedStyle(node);return {width:style.width,padding:style.padding,radius:style.borderRadius,gap:style.gap};}),
      {width:'540px',padding:'22px',radius:'20px',gap:'18px'});
    assert.equal(await root.locator('.riff-loading-activity').evaluate(node=>getComputedStyle(node).color),'rgb(105, 51, 161)');
    assert.equal(await root.locator('.riff-progress').evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(240, 243, 247)');
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await root.locator('.riff-loading-spinner').evaluate(node=>getComputedStyle(node).animationName),'none');
    assert.equal(await root.locator('.riff-progress').evaluate(node=>getComputedStyle(node,'::after').animationName),'none');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.evaluate(() => show('failed'));
    assert.equal(await root.getByRole('button', { name: /retry|refresh/i }).count(), 0);
    await page.evaluate(() => show('needs_reconciliation'));
    assert.equal(await root.getByRole('button', { name: /retry|refresh/i }).count(), 0);
  });

  await t.test('safe compact progress fills only existing Paper slots and survives terminal failure', async () => {
    await page.evaluate(() => {
      boot('scan', 'fullscreen');
      const provenance = {
        origin: 'fixture', retrieved_at: '2026-10-11T12:00:00Z', source_observed_at: '2026-10-11T11:58:00Z',
        permission_basis: 'Authored browser fixture for safe rendering.', limitations: [],
      };
      const video = (index) => ({
        platform: 'tiktok', native_id: String(9000000000000000100 + index),
        url: `https://www.tiktok.com/@fictional_kettle_creator/video/${9000000000000000100 + index}`,
        caption: `Observed video ${index}`, published_at: '2026-10-10T12:00:00Z', duration_seconds: 12,
        thumbnail_url: `https://p16-sign.tiktokcdn.com/riff-progress-${index}.jpeg`,
        metrics: { views: index === 0 ? 0 : 100 + index, likes: 10, comments: 1, shares: 0, saves: 2 }, provenance,
      });
      window.job.state = 'running'; window.job.result = null; window.job.source_kind = 'profile';
      window.job.stage = 'reading_posts'; window.job.revision = 2;
      const progress = {
        kind: 'scan',
        profile: { platform: 'tiktok', native_id: 'fictional_kettle_creator', url: 'https://www.tiktok.com/@fictional_kettle_creator',
          handle: 'fictional_kettle_creator', display_name: 'Fictional creator', bio: null, follower_count: 1200,
          avatar_url: 'https://p16-sign.tiktokcdn.com/riff-progress-avatar.jpeg', provenance },
        videos: [video(0), video(1)], limitations: ['Two safe observations are available.'],
      };
      window.progressStatus = { id: window.job.id, kind: 'scan', state: 'running', stage: 'reading_posts', revision: 2,
        created_at: window.job.created_at, updated_at: '2026-10-11T12:00:00Z', progress, terminal_result_available: false };
      window.view.render(window.job, { status: window.progressStatus });
    });
    assert.equal(await root.locator('.riff-loading-profile__avatar img').count(), 1);
    assert.equal(await root.locator('.riff-loading-profile .riff-loading-reference img').count(), 2);
    assert.equal(await root.locator('.riff-loading-profile .riff-loading-reference').count(), 6,
      'unfilled Paper slots remain skeletons');
    const progressiveImage = root.locator('.riff-loading-profile .riff-loading-reference img').first();
    assert.equal(await progressiveImage.getAttribute('loading'), 'lazy');
    assert.equal(await progressiveImage.getAttribute('decoding'), 'async');
    assert.equal(await progressiveImage.getAttribute('referrerpolicy'), 'no-referrer');
    await progressiveImage.evaluate(image => image.dispatchEvent(new Event('error')));
    assert.equal(await root.locator('.riff-loading-profile .riff-loading-reference img').count(), 1,
      'one expired image degrades locally');
    assert.equal(await root.locator('.riff-loading-profile .riff-loading-reference').count(), 6,
      'the failed image never removes its Paper slot');
    await page.evaluate(() => {
      window.progressStatus = { ...window.progressStatus, state: 'failed', revision: 3,
        updated_at: '2026-10-11T12:00:01Z', terminal_result_available: false };
      window.view.render(window.job, { status: window.progressStatus });
    });
    assert.equal(await root.locator('.riff-loading-profile .riff-loading-reference img').count(), 2);
    assert.equal(await root.getByRole('heading', { name: 'This workflow could not finish.' }).count(), 1);
    assert.match(await root.getByRole('status').textContent(), /could not finish/i);
    assert.match(await root.getByRole('status').textContent(), /Two safe observations are available/i,
      'terminal failure retains the last truthful limitations');

    await page.evaluate(() => {
      boot('scan', 'fullscreen');
      window.job.state = 'running'; window.job.result = null; window.job.source_kind = 'video';
      window.job.stage = 'accepted'; window.job.progress = { kind: 'scan', profile: null, videos: [], limitations: [] };
      window.view.render(window.job, { sourceUrl: 'https://www.tiktok.com/@fictional_kettle_creator/video/9000000000000000999' });
    });
    assert.equal(await root.locator('.riff-loading-video__media').getAttribute('href'),
      'https://www.tiktok.com/@fictional_kettle_creator/video/9000000000000000999');
    await page.evaluate(() => {
      const provenance = { origin: 'fixture', retrieved_at: '2026-10-11T12:00:00Z', source_observed_at: null,
        permission_basis: 'Authored browser fixture for safe rendering.', limitations: [] };
      const progress = { kind: 'scan', profile: null, limitations: [], videos: [{ platform: 'tiktok', native_id: '9000000000000000998',
        url: 'https://www.tiktok.com/@fictional_kettle_creator/video/9000000000000000998', caption: null, published_at: null,
        duration_seconds: null, thumbnail_url: 'https://p16-sign.tiktokcdn.com/riff-progress-video.jpeg',
        metrics: { views: null, likes: null, comments: null, shares: null }, provenance }] };
      window.view.render(window.job, { sourceUrl: 'https://www.tiktok.com/@fictional_kettle_creator/video/9000000000000000999',
        status: { id: window.job.id, kind: 'scan', state: 'running', stage: 'reviewing_video', revision: 2,
          created_at: window.job.created_at, updated_at: '2026-10-11T12:00:00Z', progress, terminal_result_available: false } });
    });
    assert.equal(await root.locator('.riff-loading-video__media').getAttribute('href'),
      'https://www.tiktok.com/@fictional_kettle_creator/video/9000000000000000998',
      'the canonical submitted URL is ephemeral once safe progress arrives');

    await page.evaluate(() => {
      boot('ideas', 'fullscreen'); window.job.state = 'running'; window.job.result = null; window.job.stage = 'enriching_references';
      const provenance = { origin: 'fixture', retrieved_at: '2026-10-11T12:00:00Z', source_observed_at: null,
        permission_basis: 'Authored browser fixture for safe rendering.', limitations: [] };
      const references = [0, 1, 2].map(index => ({ platform: 'tiktok', native_id: `90000000000000002${index}`,
        url: `https://www.tiktok.com/@fictional_reference/video/90000000000000002${index}`, caption: null, published_at: null,
        duration_seconds: null, thumbnail_url: `https://p16-sign.tiktokcdn.com/riff-reference-progress-${index}.jpeg`,
        metrics: { views: null, likes: null, comments: null, shares: null }, provenance }));
      const progress = { kind: 'recommendations', identities: references.map(({ provenance: _provenance, caption: _caption,
        published_at: _publishedAt, duration_seconds: _duration, thumbnail_url: _thumbnail, metrics: _metrics, ...item }) => ({
          ...item, retrieved_at: provenance.retrieved_at, origin: provenance.origin,
          permission_basis: provenance.permission_basis, limitations: [],
        })), references, limitations: [] };
      window.view.render(window.job, { status: { id: window.job.id, kind: 'recommendations', state: 'running',
        stage: 'enriching_references', revision: 2, created_at: window.job.created_at, updated_at: '2026-10-11T12:00:00Z',
        progress, terminal_result_available: false } });
    });
    assert.equal(await root.locator('.riff-loading-references .riff-loading-reference').count(), 7);
    assert.equal(await root.locator('.riff-loading-references .riff-loading-reference img').count(), 3);
    assert.equal(await root.locator('[role="progressbar"][aria-valuenow]').count(), 0);
  });

  await t.test('video Analysis matches Paper media-and-six-row composition and hides developer metadata', async () => {
    await page.evaluate(() => boot('video-analysis', 'fullscreen'));
    const heading = root.getByRole('heading', { level: 1 });
    assert.equal(await heading.textContent(), 'Unlock your video’s viral potential.');
    assert.deepEqual(await heading.evaluate(node => {
      const style = getComputedStyle(node); return { fontSize: style.fontSize, lineHeight: style.lineHeight, weight: style.fontWeight };
    }), { fontSize: '24px', lineHeight: '30px', weight: '700' });
    const card = root.locator('.riff-analysis-card');
    assert.deepEqual(await card.evaluate(node => {
      const style = getComputedStyle(node); return { width: style.width, radius: style.borderRadius, display: style.display };
    }), { width: '900px', radius: '18px', display: 'flex' });
    assert.deepEqual(await root.locator('.riff-analysis-media').evaluate(node => {
      const style = getComputedStyle(node); return { width: style.width, height: style.height, radius: style.borderRadius };
    }), { width: '313px', height: '556px', radius: '20px' });
    assert.equal(await root.locator('.riff-analysis-row').count(), 6);
    for (const name of ['Hook', 'Content', 'Style & pacing', 'Voice & language', 'Script', 'CTA']) {
      assert.equal(await root.getByRole('heading', { name, exact: true }).count(), 1, name);
    }
    const text = await root.textContent();
    assert.doesNotMatch(text, /Saved Riff|Supplied video review|Provider|Retrieved|Captured DNA|DNA ID|Limitations|Observed|Inferred|User-corrected|coverage/i);
    assert.equal(await root.getByRole('button', { name: 'Rework this video' }).count(), 1);
    assert.equal(await root.getByRole('button', { name: 'Explore viral formats' }).count(), 1);
    assert.equal(await root.getByRole('button', { name: 'Create a video' }).count(), 0);
    assert.ok(await root.locator('svg path[d="M3 1 11 6 3 11Z"]').count() >= 1, 'Paper play icon is present');
    assert.equal(await root.locator('.riff-analysis-duration').textContent(),'0:12');
    assert.equal(await root.getByText('Limited',{exact:true}).count(),1);

    await page.evaluate(() => {
      const dimensions = [
        ['hook', 'needs_attention', 'Open with the result before introducing yourself.'],
        ['content', 'working_well', 'Keep one clear technique with a visible before-and-after.'],
        ['style_pacing', 'needs_attention', 'Cut to the demonstration sooner.'],
        ['voice_language', 'working_well', 'Keep the conversational wording.'],
        ['script', 'needs_rework', 'The payoff needs to lead the story.'],
        ['cta', 'needs_attention', 'Deliver the payoff, then give one reason to save.'],
      ];
      window.job.result.dna.seed_review.dimensions = dimensions.map(([dimension, status, summary]) => ({ dimension, status, summary }));
      const evidence = window.job.result.dna.evidence.find(item => item.url === window.job.result.dna.seed_review.url);
      evidence.thumbnail_url = 'https://p16-sign.tiktokcdn.com/riff-video.jpeg';
      evidence.metrics.saves = 1200;
      window.view.render(window.job);
    });
    assert.equal(await root.locator('.riff-analysis-video > img').getAttribute('src'), 'https://p16-sign.tiktokcdn.com/riff-video.jpeg');
    assert.equal(await root.getByText('Working well', { exact: true }).count(), 2);
    assert.equal(await root.getByText('Needs attention', { exact: true }).count(), 3);
    assert.equal(await root.getByText('Needs rework', { exact: true }).count(), 1);
    assert.match(await root.getByRole('heading', { name: 'Hook', exact: true }).locator('xpath=../..').textContent(), /Open with the result/);
    assert.match(await root.locator('.riff-analysis-media').textContent(), /Saves/);
    assert.doesNotMatch(await root.locator('.riff-analysis-media').textContent(), /Shares/);
    await page.evaluate(()=>show('video-analysis-incomplete'));
    assert.equal(await root.locator('.riff-analysis-row').count(),0);
    assert.equal(await root.getByRole('heading',{name:'This video analysis is limited.'}).count(),1);
  });

  await t.test('transcript-only video analysis uses the exact Paper partial-analysis card and safe handoff', async () => {
    await page.evaluate(() => {
      boot('video-analysis', 'fullscreen');
      window.job.result.dna.seed_review.access_basis = 'transcript_or_caption_only';
      window.view.render(window.job);
    });
    const card = root.locator('.riff-partial-analysis-card');
    assert.equal(await card.count(), 1);
    assert.equal(await root.getByRole('heading', { name: 'We could read the words, not the visuals.' }).count(), 1);
    assert.match(await card.textContent(), /We can help with the wording\. Upload the video file in chat for feedback on the shots and pacing\./);
    assert.deepEqual(await card.evaluate(node => {
      const style = getComputedStyle(node); return {
        width: style.width, radius: style.borderRadius, padding: style.padding, gap: style.gap,
      };
    }), { width: '656px', radius: '18px', padding: '24px', gap: '20px' });
    assert.deepEqual(await card.getByRole('heading').evaluate(node => {
      const style = getComputedStyle(node); return {
        fontSize: style.fontSize, lineHeight: style.lineHeight, weight: style.fontWeight,
      };
    }), { fontSize: '24px', lineHeight: '30px', weight: '600' });
    const action = root.getByRole('button', { name: 'Work on the script' });
    assert.deepEqual(await action.evaluate(node => {
      const style = getComputedStyle(node); return {
        minHeight: style.minHeight, fontSize: style.fontSize, lineHeight: style.lineHeight,
        backgroundImage: style.backgroundImage, borderWidth: style.borderWidth,
      };
    }), { minHeight: '44px', fontSize: '16px', lineHeight: '24px', backgroundImage: 'radial-gradient(circle at 50% 45%, oklab(0.461 0.087 -0.206) 0%, oklab(0.507 0.09 -0.203) 55%, oklab(0.617 0.089 -0.17) 100%), none', borderWidth: '1px' });
    assert.equal(await root.locator('.riff-pipeline__content').getByRole('button').count(), 1);
    assert.equal(await root.locator('.riff-analysis-card, .riff-inline-result').count(), 0);
    assert.doesNotMatch(await card.textContent(), /Partial analysis|transcript only|Provider|Limitations|DNA|Open analysis|Explore viral formats/i);
    await action.click();
    const message = await page.evaluate(() => window.actions.at(-1));
    assert.match(message, /work on the script/i);
    assert.match(message, /transcript or captions/i);
    assert.doesNotMatch(message, internalUuid);
    assert.doesNotMatch(message, internalWorkflowLanguage);
  });

  await t.test('profile Analysis uses the Paper profile split and canonical action only', async () => {
    await page.evaluate(() => boot('scan', 'fullscreen'));
    assert.equal(await root.getByRole('heading', { name: 'Turn what’s working into your next breakout.' }).count(), 1);
    assert.equal(await root.locator('.riff-profile-card').count(), 1);
    assert.equal(await root.locator('.riff-profile-analysis').count(), 1);
    assert.equal(await root.getByRole('button', { name: 'Find my next breakout idea' }).count(), 1);
    assert.equal(await root.getByRole('heading',{name:'What’s working',exact:true}).count(),1);
    assert.equal(await root.getByRole('heading',{name:'What to improve',exact:true}).count(),1);
    assert.equal(await root.getByRole('heading',{name:'Your next move',exact:true}).count(),1);
    assert.match(await root.locator('.riff-profile-card').textContent(),/Views/);
    assert.equal(await root.getByRole('button', { name: 'Rework this video' }).count(), 0);
    assert.equal(await root.getByRole('heading', { name: 'Top videos' }).count(), 1,
      'the approved Paper heading is retained');
    assert.match(await root.locator('.riff-profile-reviewed').textContent(), /^\d+ TikTok videos? reviewed$/,
      'the exact Paper reviewed line is retained without an unsupported ranking claim');
    assert.equal(await root.getByRole('link', { name: 'Open top video' }).count(), 1);
    assert.doesNotMatch(await root.locator('.riff-profile-reviewed').textContent(), /Ranked by views|recent/i);
    assert.doesNotMatch(await root.textContent(), /Captured DNA|DNA ID|Analysis created|Oldest post|Newest post|Limitations|Observed/i);

    await page.evaluate(() => {
      window.job.result.dna.profile_summary.avatar_url = 'https://p16-sign.tiktokcdn.com/riff-avatar.jpeg';
      window.job.result.dna.profile_summary.follower_count = 12400;
      window.job.result.dna.evidence[0].thumbnail_url = 'https://p16-sign.tiktokcdn.com/riff-top-video.jpeg';
      window.view.render(window.job);
    });
    assert.equal(await root.locator('.riff-profile-avatar > img').getAttribute('src'), 'https://p16-sign.tiktokcdn.com/riff-avatar.jpeg');
    assert.equal(await root.locator('.riff-profile-video > img').count(), 1);
    assert.match(await root.locator('.riff-profile-card').textContent(), /12.4K|12K/);
    assert.match(await root.locator('.riff-profile-card').textContent(), /Fictional desk creator/);
    await root.getByRole('button', { name: 'Find my next breakout idea' }).click();
    const message = await page.evaluate(() => window.actions.at(-1));
    assert.match(message, /explore viral formats/i);
    assert.doesNotMatch(message, internalUuid);
    assert.doesNotMatch(message, internalWorkflowLanguage);

    await page.evaluate(()=>show('instagram-profile'));
    assert.equal(await root.getByRole('heading',{name:'Turn your best results into more reach.'}).count(),1);
    assert.match(await root.locator('.riff-profile-reviewed').textContent(),/^\d+ Instagram Reels? reviewed$/);
    assert.equal(await root.getByRole('heading',{name:'Top Reels'}).count(),1);
    assert.equal(await root.locator('.riff-profile-platform--instagram').count(),1);

    await page.evaluate(()=>{window.job.result.dna.profile_analysis=undefined;window.view.render(window.job);});
    assert.equal(await root.getByRole('heading',{name:'Top Reels'}).count(),0);
    assert.equal(await root.locator('.riff-profile-insight,.riff-profile-next').count(),0);
    assert.equal(await root.getByText('Views',{exact:true}).count(),0);
  });

  await t.test('inline Analysis remains a compact host handoff without duplicate branding', async () => {
    await page.evaluate(() => boot('scan', 'inline'));
    assert.deepEqual(await root.locator('.riff-pipeline__surface').evaluate(node => {
      const style = getComputedStyle(node); return { padding: style.padding, borderWidth: style.borderWidth };
    }), { padding: '0px', borderWidth: '0px' });
    assert.equal(await root.locator('svg[aria-label="Riff"]').count(), 0);
    assert.equal(await root.getByRole('button', { name: 'Open analysis' }).count(), 1);
    assert.equal(await root.getByRole('button', { name: 'Explore viral formats' }).count(), 1);
    assert.doesNotMatch(await root.textContent(), /Captured DNA|coverage|saved signal/i);
    await root.getByRole('button', { name: 'Open analysis' }).click();
    assert.equal(await page.evaluate(() => window.fullscreen.length), 1);
    assert.equal(await root.locator('.riff-profile-card').count(), 1);
  });

  await t.test('Discovery matches Paper libraries, filters, visual carousel, SVG controls, and omits unsupported metrics', async () => {
    await page.evaluate(() => boot('three-ideas', 'fullscreen'));
    const heading = root.getByRole('heading', { name: 'Find your next breakout idea.' });
    assert.deepEqual(await heading.evaluate(node => {
      const style = getComputedStyle(node); return { fontSize: style.fontSize, lineHeight: style.lineHeight };
    }), { fontSize: '34px', lineHeight: '42px' });
    const libraries = root.getByRole('tablist', { name: 'Discovery libraries' });
    assert.equal(await libraries.getByRole('tab').count(), 4);
    for (const name of ['Videos', 'Hooks', 'Product showcases', 'CTAs']) assert.equal(await libraries.getByRole('tab', { name, exact: true }).count(), 1);
    const filters = root.getByRole('group', { name: 'Video filters' });
    for (const name of ['For you', 'Quick demos', 'Before / after', 'How-to', 'Reactions', 'Challenges']) assert.equal(await filters.getByRole('button', { name, exact: true }).count(), 1);
    assert.equal(await filters.getByRole('button', { name: 'For you' }).getAttribute('aria-pressed'), 'true');
    await filters.getByRole('button', { name: 'Quick demos' }).click();
    assert.equal(await filters.getByRole('button', { name: 'Quick demos' }).getAttribute('aria-pressed'), 'true');
    assert.equal(await root.locator('[data-idea-card]').count(), 0,
      'an unsupported filter stays empty instead of reusing recommendations');
    assert.equal(await root.getByRole('button', { name: 'Make it mine' }).count(), 0);
    assert.equal(await root.getByRole('button', { name: 'Bookmark idea' }).count(), 0);
    await filters.getByRole('button', { name: 'For you' }).click();
    const carousel = root.locator('[data-discovery-carousel]');
    assert.equal(await root.locator('[data-idea-card]').count(), 3);
    assert.equal(await root.locator('[data-active-idea]').count(), 1);
    assert.equal(await root.getByRole('button', { name: 'Make it mine' }).count(), 1);
    assert.equal(await root.getByRole('button', { name: 'Bookmark idea' }).count(), 1);
    assert.ok(await root.locator('svg path[d="M19 12H5m7-7-7 7 7 7"]').count() >= 1, 'Paper previous-arrow icon is present');
    assert.ok(await root.locator('svg path[d="M5 12h14m-7-7 7 7-7 7"]').count() >= 1, 'Paper next-arrow icon is present');
    assert.ok(await root.locator('svg path[d="M3 2h10v14l-5-3-5 3Z"]').count() >= 1, 'Paper bookmark icon is present');
    assert.doesNotMatch(await carousel.textContent(), /Views|Likes|Saves|[0-9.]+×/,
      'the three-idea fixture has no persisted metrics');
    const text = await root.locator('.riff-pipeline__content').textContent();
    assert.doesNotMatch(text, /Batch limitations|Captured DNA|DNA ID|created|evidence-backed|Idea [0-9]+ \/|Why it fits|How to film|Sources/i);
    await carousel.focus(); await page.keyboard.press('ArrowRight');
    assert.match(await carousel.textContent(), /Fictional desk idea 2/);
    await root.getByRole('button', { name: 'Next idea' }).click();
    assert.match(await carousel.textContent(), /Fictional desk idea 3/);
    await root.getByRole('button', { name: 'Make it mine' }).click();
    const selectionMessage = await page.evaluate(() => window.actions.at(-1));
    assert.match(selectionMessage, /complete video direction|whole video/i);
    assert.match(selectionMessage, /Fictional desk idea 3/i);
    assert.match(selectionMessage, /For you/i);
    assert.doesNotMatch(selectionMessage, internalUuid);
    assert.doesNotMatch(selectionMessage, internalWorkflowLanguage);
    await root.getByRole('button', { name: 'Bookmark idea' }).click();
    const bookmarkMessage = await page.evaluate(() => window.actions.at(-1));
    assert.match(bookmarkMessage, /bookmark.*Fictional desk idea 3/i);
    assert.doesNotMatch(bookmarkMessage, internalUuid);
    assert.doesNotMatch(bookmarkMessage, internalWorkflowLanguage);
    await page.evaluate(() => boot('ideas', 'fullscreen'));
    assert.match(await root.locator('[data-discovery-carousel]').textContent(), /120/,
      'persisted views remain visible when the reference includes them');
    await page.evaluate(() => {
      const reference = window.job.result.batch.references[0];
      reference.thumbnail_url = 'https://p16-sign.tiktokcdn.com/riff-reference.jpeg';
      reference.likes = 8;
      reference.saves = 3;
      reference.view_multiplier = 3.1;
      reference.view_multiplier_basis = { method: 'median_observed_profile_views', baseline_views: 39, sample_size: 8 };
      window.view.render(window.job);
    });
    assert.equal(await root.locator('.riff-idea-media > img').count(), 1);
    assert.match(await root.locator('[data-active-idea]').textContent(), /120/);
    assert.match(await root.locator('[data-active-idea]').textContent(), /8/);
    assert.match(await root.locator('[data-active-idea]').textContent(), /3/);
    assert.match(await root.locator('[data-active-idea]').textContent(), /3\.1×/);
  });

  await t.test('unsupported Paper Discovery libraries remain approved empty states without false reuse', async () => {
    await page.evaluate(() => boot('ideas', 'fullscreen'));
    const actionCount = await page.evaluate(() => window.actions.length);
    const libraries = root.getByRole('tablist', { name: 'Discovery libraries' });
    const unsupported = [
      ['Hooks', 'Stop the scroll.', 'Find a hook that grabs attention. Make it sound like you.', ['For you', 'Questions', 'Bold claims', 'Visual hooks', 'Problems', 'Storytelling']],
      ['Product showcases', 'Make your product stand out.', 'Turn your product’s best benefit into a video worth watching.', ['Quick demos', 'Before / after', 'Unboxing', 'Tutorials', 'Screen recordings']],
      ['CTAs', 'Turn views into action.', 'Give viewers a reason to save, share, follow, or try your product.', ['For you', 'Save', 'Comment', 'Follow', 'Share', 'Try it']],
    ];
    for (const [library, heading, copy, filters] of unsupported) {
      await libraries.getByRole('tab', { name: library, exact: true }).click();
      assert.equal(await libraries.getByRole('tab', { name: library, exact: true }).getAttribute('aria-selected'), 'true');
      assert.equal(await root.getByRole('heading', { name: heading }).count(), 1);
      assert.match(await root.textContent(), new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      for (const filter of filters) assert.equal(await root.getByRole('button', { name: filter, exact: true }).count(), 1);
      assert.equal(await root.locator('[data-idea-card]').count(), 0);
      assert.equal(await root.getByRole('button', { name: /Use this (?:hook|showcase|CTA)/i }).count(), 0);
      assert.equal(await root.getByRole('button', { name: 'Make it mine' }).count(), 0);
    }
    assert.equal(await page.evaluate(() => window.actions.length), actionCount,
      'local library and filter controls never call ChatGPT');
    await libraries.getByRole('tab', { name: 'Videos', exact: true }).click();
    await root.getByRole('button', { name: 'Quick demos', exact: true }).click();
    assert.equal(await root.locator('[data-idea-card]').count(), 0);
    await root.getByRole('button', { name: 'For you', exact: true }).click();
    assert.equal(await root.locator('[data-idea-card]').count(), 1);
    assert.equal(await root.getByRole('button', { name: 'Make it mine' }).count(), 1);
    assert.doesNotMatch(await root.textContent(), /timestamped|saved reference captions|Batch limitations/i);
    await page.evaluate(() => show('empty'));
    assert.equal(await root.locator('[data-idea-card]').count(), 0);
    assert.doesNotMatch(await root.textContent(), /Batch limitations|DNA ID/i);
  });

  await t.test('provider-free catalog retains but never consumes the cursor beyond the eight-card Paper page', async () => {
    const loadsAtStart = await page.evaluate(() => window.discoveryLoads.length);
    await page.evaluate(() => {
      boot('scan', 'fullscreen');
      const cards = Array.from({ length: 8 }, (_, index) => ({
        id: `00000000-0000-4000-8000-0000000008${String(index).padStart(2, '0')}`,
        platform: 'tiktok', native_id: `90000000000000008${index}`,
        canonical_url: `https://www.tiktok.com/@fictional_catalog/video/90000000000000008${index}`,
        caption: `Observed catalog caption ${index + 1}`,
        thumbnail_url: `https://p16-sign.tiktokcdn.com/riff-catalog-${index}.jpeg`,
        published_at: null, duration_seconds: null,
        metrics: { views: index === 0 ? 0 : index * 100, likes: null, comments: null, shares: null, saves: null },
        retrieved_at: '2026-10-11T12:00:00Z', source_observed_at: null, observed_at: `2026-10-11T11:5${index}:00Z`,
        origin: 'fixture', role: 'discovered_reference',
        permission_basis: 'Authored browser fixture for safe rendering.', limitations: [],
      }));
      window.catalogCards=cards;
      window.view.setCatalog({ cards, next_cursor: 'page-2', coverage: 'Saved observations only.', freshness: 'As last observed.' });
      window.view.showCatalog();
    });
    assert.equal(await root.locator('[data-catalog-card]').count(), 8, 'the first Paper catalog page is capped at eight cards');
    assert.equal(await page.evaluate(() => window.discoveryLoads.length), loadsAtStart + 1,
      'fullscreen Videos requests one catalog page');
    assert.equal(await root.getByRole('button', { name: 'Make it mine' }).count(), 0);
    assert.equal(await root.getByRole('button', { name: 'Bookmark idea' }).count(), 0);
    assert.equal(await root.locator('[data-idea-card]').count(), 0, 'catalog observations are never recommendation ideas');
    assert.match(await root.locator('[data-active-catalog]').textContent(), /Observed catalog caption 1/);
    assert.equal(await root.locator('[data-active-catalog] a').getAttribute('href'),
      'https://www.tiktok.com/@fictional_catalog/video/900000000000000080');
    assert.match(await root.locator('[data-active-catalog]').textContent(), /0/, 'an observed zero is not treated as missing');
    const catalogImage = root.locator('[data-active-catalog] img');
    assert.equal(await catalogImage.getAttribute('loading'), 'lazy');
    assert.equal(await catalogImage.getAttribute('decoding'), 'async');
    assert.equal(await catalogImage.getAttribute('referrerpolicy'), 'no-referrer');
    await catalogImage.evaluate(image => image.dispatchEvent(new Event('error')));
    assert.equal(await root.locator('[data-active-catalog]').count(), 1);
    assert.equal(await root.locator('[data-active-catalog] img').count(), 0);
    const arrowDuration = await page.evaluate(() => {
      const start = performance.now();
      document.querySelector('[data-focus="next-video"]')?.click();
      return performance.now() - start;
    });
    assert.ok(arrowDuration < 100, `loaded carousel arrow took ${arrowDuration}ms`);
    assert.match(await root.locator('[data-active-catalog]').textContent(), /Observed catalog caption 2/);
    for (let index = 0; index < 5; index += 1) await root.getByRole('button', { name: 'Next video' }).click();
    assert.match(await root.locator('[data-active-catalog]').textContent(), /Observed catalog caption 7/);
    assert.equal(await page.evaluate(() => window.discoveryLoads.length), loadsAtStart + 1,
      'the first seven loaded positions stay local');
    await root.getByRole('button', { name: 'Next video' }).click();
    assert.match(await root.locator('[data-active-catalog]').textContent(), /Observed catalog caption 8/);
    assert.equal(await page.evaluate(() => window.discoveryLoads.length), loadsAtStart + 1,
      'the retained next cursor is not consumed at the eighth card');
    assert.equal(await root.locator('[data-catalog-card]').count(), 8,
      'the Paper carousel never renders more than its approved page size');
    await root.getByRole('button', { name: 'Next video' }).click();
    assert.match(await root.locator('[data-active-catalog]').textContent(), /Observed catalog caption 1/,
      'the bounded carousel wraps locally after the eighth card');
    await root.getByRole('button', { name: 'Previous video' }).click();
    assert.match(await root.locator('[data-active-catalog]').textContent(), /Observed catalog caption 8/);
    await page.evaluate(() => {
      const cards = Array.from({ length: 8 }, (_, offset) => {
        const index=offset+8;
        return {
          id: `00000000-0000-4000-8000-0000000008${String(index).padStart(2, '0')}`,
          platform: 'tiktok', native_id: `90000000000000008${index}`,
          canonical_url: `https://www.tiktok.com/@fictional_catalog/video/90000000000000008${index}`,
          caption: `Observed catalog caption ${index + 1}`,
          thumbnail_url: null, published_at: null, duration_seconds: null,
          metrics: { views: index * 100, likes: null, comments: null, shares: null, saves: null },
          retrieved_at: '2026-10-11T12:00:00Z', source_observed_at: null, observed_at: '2026-10-11T11:40:00Z',
          origin: 'fixture', role: 'discovered_reference',
          permission_basis: 'Authored browser fixture for safe rendering.', limitations: [],
        };
      });
      window.view.setCatalog({cards:[...window.catalogCards,...cards],next_cursor:null,
        coverage:'Saved observations only.',freshness:'As last observed.'});
    });
    assert.equal(await root.locator('[data-catalog-card]').count(), 8);
    await root.getByRole('button', { name: 'Next video' }).click();
    assert.match(await root.locator('[data-active-catalog]').textContent(), /Observed catalog caption 1/,
      'even an oversized retained payload is defensively bounded to its first approved page');
    await root.getByRole('button', { name: 'Previous video' }).click();
    assert.match(await root.locator('[data-active-catalog]').textContent(), /Observed catalog caption 8/,
      'the retained first page remains locally navigable');
    const loadsBeforeLocalControls = await page.evaluate(() => window.discoveryLoads.length);
    await root.getByRole('button', { name: 'Quick demos', exact: true }).click();
    assert.equal(await root.locator('[data-catalog-card]').count(), 0, 'an unbacked filter remains empty');
    await root.getByRole('tab', { name: 'Hooks', exact: true }).click();
    assert.equal(await root.locator('[data-catalog-card]').count(), 0, 'an unbacked library remains empty');
    await root.getByRole('tab', { name: 'Videos', exact: true }).click();
    assert.equal(await root.locator('[data-catalog-card]').count(), 8);
    assert.equal(await page.evaluate(() => window.discoveryLoads.length), loadsBeforeLocalControls,
      'arrows, tabs and loaded filters never make another tool call');
    assert.doesNotMatch(await root.locator('[data-catalog-card]').allTextContents().then(values => values.join(' ')),
      /recommended|viral|Make it mine|Why it fits|Batch limitations/i);

    const loadsBeforeProjectChange = await page.evaluate(() => window.discoveryLoads.length);
    await page.evaluate(() => {
      const next = structuredClone(window.job);
      next.id = '00000000-0000-4000-8000-000000000998';
      next.project_id = '00000000-0000-4000-8000-000000000997';
      window.view.render(next);
      window.view.showCatalog();
    });
    assert.equal(await root.getByText(/Observed catalog caption/).count(), 0,
      'a different project never paints the prior project catalog');
    assert.equal(await page.evaluate(() => window.discoveryLoads.length), loadsBeforeProjectChange + 1,
      'a different project gets its own provider-free catalog request');
  });

  await t.test('explicit same-scope Discovery re-entry notifies the catalog loader for recovery', async () => {
    await page.evaluate(() => {
      boot('ideas', 'fullscreen');
      window.discoveryLoads.length = 0;
      window.view.render(window.job);
      window.view.render(window.job);
    });
    assert.equal(await page.evaluate(() => window.discoveryLoads.length), 0,
      'ordinary same-scope result renders never create an automatic retry loop');
    await page.evaluate(() => {
      window.view.showCatalog();
      window.view.showCatalog();
    });
    assert.equal(await page.evaluate(() => window.discoveryLoads.length), 2,
      'each explicit re-entry reaches the loader, which deduplicates cached and in-flight reads');
  });

  await t.test('Studio matches Paper script tabs and omits unavailable caption and developer panels', async () => {
    await page.evaluate(() => boot('scripts', 'fullscreen'));
    const heading = root.getByRole('heading', { name: 'Your script, ready to film.' });
    assert.deepEqual(await heading.evaluate(node => {
      const style = getComputedStyle(node); return { fontSize: style.fontSize, lineHeight: style.lineHeight };
    }), { fontSize: '30px', lineHeight: '36px' });
    const studioActions = root.getByRole('group', { name: 'Studio actions' });
    assert.equal(await studioActions.getByRole('button').count(), 2);
    assert.equal(await studioActions.getByRole('button', { name: 'Save for later' }).count(), 1);
    assert.equal(await studioActions.getByRole('button', { name: 'I filmed it' }).count(), 1);
    assert.equal(await root.locator('[data-variant]').count(), 0, 'Paper does not show invented variant chips');
    for (const tab of ['Full video', 'Hook', 'Main content', 'CTA']) assert.equal(await root.getByRole('tab', { name: tab, exact: true }).count(), 1);
    assert.deepEqual(await root.locator('.riff-studio-player').evaluate(node => {
      const style = getComputedStyle(node); return { width: style.width, height: style.height, radius: style.borderRadius };
    }), { width: '240px', height: '427px', radius: '16px' });
    assert.equal(await root.locator('.riff-script-part').count(), 3);
    const text = await root.locator('.riff-pipeline__content').textContent();
    assert.doesNotMatch(text, /Caption.*not available|publishing fields|Variant limitations|Script set limitations|Captured DNA|DNA ID|Create a video/i);
    assert.ok(await root.locator('svg path[d="M9 18h6M10 21h4M9 15c0-2-3-3-3-7a6 6 0 0 1 12 0c0 4-3 5-3 7v1H9z"]').count() >= 1, 'Paper filming-tip icon is present');
    await root.getByRole('tab', { name: 'Hook', exact: true }).click();
    assert.match(await root.locator('[role="tabpanel"]:not([hidden])').textContent(), /One small change for this desk|Wide shot/);
    await root.getByRole('tab', { name: 'Main content', exact: true }).click();
    assert.match(await root.locator('[role="tabpanel"]:not([hidden])').textContent(), /Here is my current setup|Wide setup|Hand placing/);
    await root.getByRole('tab', { name: 'CTA', exact: true }).click();
    assert.match(await root.locator('[role="tabpanel"]:not([hidden])').textContent(), /What would you change/);

    await page.evaluate(() => {
      const variant = window.job.result.scripts.variants[0];
      variant.timed_segments = [
        { part: 'hook', start_seconds: 0, end_seconds: 3, spoken_text: 'Still on the same page after an hour?', filming_direction: 'Film the open textbook, then cut to the clock.', on_screen_text: 'SAME PAGE?' },
        { part: 'main_content', start_seconds: 3, end_seconds: 17, spoken_text: 'Try one question. Close the book, answer from memory, then check what you missed.', filming_direction: 'Show the question, your answer and the page.' },
        { part: 'cta', start_seconds: 17, end_seconds: 22, spoken_text: 'Save this for your next study session.', filming_direction: 'Return to the finished answer.' },
      ];
      variant.caption = 'Still rereading the same page? Try one question before you read it again.';
      variant.hashtags = ['#studytips', '#studytok', '#learning'];
      window.job.result.scripts.idea = { title: 'The one-question study reset' };
      window.job.result.scripts.references = [{
        id: variant.reference_ids[0],
        platform: 'tiktok',
        url: 'https://www.tiktok.com/@fictional_kettle_creator/video/9000000000000000011',
        thumbnail_url: 'https://p16-sign.tiktokcdn.com/riff-studio-reference.jpeg',
      }];
      window.view.render(window.job);
    });
    await root.getByRole('tab', { name: 'Full video', exact: true }).click();
    assert.match(await root.locator('.riff-studio-header').textContent(), /The one-question study reset/);
    assert.equal(await root.getByRole('heading', { name: 'Your references & script' }).count(), 1);
    assert.match(await root.locator('.riff-studio-shell__meta').textContent(), /20 seconds · 3 parts/);
    assert.equal(await root.locator('.riff-studio-player').getAttribute('href'), 'https://www.tiktok.com/@fictional_kettle_creator/video/9000000000000000011');
    assert.equal(await root.locator('.riff-studio-player > img').getAttribute('src'), 'https://p16-sign.tiktokcdn.com/riff-studio-reference.jpeg');
    assert.match(await root.locator('.riff-script-part').first().textContent(), /Hook · 0–3s/);
    assert.match(await root.locator('.riff-script-part').nth(1).textContent(), /Main content · 3–17s/);
    assert.match(await root.locator('.riff-script-part').nth(2).textContent(), /CTA · 17–22s/);
    assert.equal(await root.getByRole('heading', { name: 'Caption', exact: true }).count(), 1);
    assert.equal(await root.locator('.riff-caption-platform', { hasText: 'TikTok' }).count(), 1);
    assert.match(await root.locator('.riff-studio-caption').textContent(), /Still rereading.*#studytips #studytok #learning/);

    await root.getByRole('button', { name: 'Save for later' }).click();
    const saveMessage = await page.evaluate(() => window.actions.at(-1));
    assert.match(saveMessage, /save.*Reference-led.*later/i);
    assert.doesNotMatch(saveMessage, internalUuid);
    assert.doesNotMatch(saveMessage, internalWorkflowLanguage);
    await root.getByRole('button', { name: 'I filmed it' }).click();
    const filmedMessage = await page.evaluate(() => window.actions.at(-1));
    assert.match(filmedMessage, /filmed.*Reference-led/i);
    assert.doesNotMatch(filmedMessage, internalUuid);
    assert.doesNotMatch(filmedMessage, internalWorkflowLanguage);
    await root.getByRole('button', { name: 'Explore videos' }).click();
    const exploreMessage = await page.evaluate(() => window.actions.at(-1));
    assert.match(exploreMessage, /explore videos.*The one-question study reset/i);
    assert.doesNotMatch(exploreMessage, internalUuid);
    assert.doesNotMatch(exploreMessage, internalWorkflowLanguage);

    await page.evaluate(() => {
      const variant = window.job.result.scripts.variants[0];
      variant.timed_segments = [
        { part: 'hook', start_seconds: 0, end_seconds: 3, spoken_text: 'A persisted timed hook.', filming_direction: 'Open on the finished result.' },
      ];
      window.view.render(window.job);
    });
    await root.getByRole('tab', { name: 'Full video', exact: true }).click();
    assert.match(await root.locator('.riff-studio-shell__meta').textContent(), /20 seconds · 3 parts/);
    assert.equal(await root.locator('.riff-script-part').count(), 3,
      'partial timed data must not erase the persisted main content or CTA');
    assert.match(await root.locator('.riff-script-part').nth(0).textContent(), /Hook · 0–3s.*A persisted timed hook/s);
    assert.match(await root.locator('.riff-script-part').nth(1).textContent(), /Main content.*Here is my current setup/s);
    assert.match(await root.locator('.riff-script-part').nth(2).textContent(), /CTA.*What would you change/s);
  });

  await t.test('actions stay connected, hostile text remains inert, focus persists, and layouts do not overflow', async () => {
    await page.evaluate(() => bootConnected('scan'));
    await root.getByRole('button', { name: 'Find my next breakout idea' }).click();
    assert.equal((await page.evaluate(() => window.connectedActions.at(-1))).kind, 'recommendations');
    await page.evaluate(() => bootConnected('ideas'));
    await root.getByRole('button', { name: 'Make it mine' }).click();
    assert.deepEqual(await page.evaluate(() => {
      const action = window.connectedActions.at(-1);
      return { kind: action.kind, library: action.library, filter: action.filter, intent: action.intent };
    }), {
      kind: 'make-mine', library: 'videos', filter: 'For you',
      intent: 'Use “One useful desk change” as the complete video direction for my next Riff video. Shape the adaptation around the “For you” preference, my creator context, and cited references, then draft filmable options for me to choose from.',
    });
    await page.evaluate(() => bootConnected('scripts'));
    await root.getByRole('button', { name: 'Save for later' }).click();
    await root.getByRole('button', { name: 'I filmed it' }).click();
    assert.deepEqual(await page.evaluate(() => window.connectedActions.slice(-2).map(action => action.state)), ['saved', 'filmed']);
    await page.evaluate(() => boot('hostile', 'fullscreen'));
    assert.equal(await root.locator('img,iframe,script').count(), 0);
    for (const width of [320, 375, 768, 1200]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    }
    await page.setViewportSize({ width: 900, height: 900 });
    await page.evaluate(() => boot('three-ideas', 'fullscreen'));
    await root.getByRole('button', { name: 'Next idea' }).click();
    await root.getByRole('button', { name: 'Make it mine' }).focus();
    const result = await page.evaluate(() => {
      window.job.revision += 1; window.view.render(window.job);
      const preserved = document.body.textContent.includes('Fictional desk idea 2') && document.activeElement.textContent === 'Make it mine';
      const other = structuredClone(window.job); other.id = '00000000-0000-4000-8000-000000000999'; window.view.render(other);
      const reset = document.body.textContent.includes('Fictional desk idea 1');
      window.view.dispose(); window.view.dispose(); window.view.render(other);
      return { preserved, reset, empty: document.getElementById('root').childElementCount === 0 };
    });
    assert.deepEqual(result, { preserved: true, reset: true, empty: true });
  });

  assert.deepEqual(errors, []);
});
