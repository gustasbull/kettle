import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';

const internalUuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
import { chromium } from 'playwright';

// Real SDK + real component in an iframe; this is a local host fixture, not ChatGPT.
test('Creator pipeline bridge parent transport, refresh, denial and teardown', async t => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { mountCreatorPipelineBridge } from './apps/panel/creator-pipeline-bridge.ts';
    window.bridge = mountCreatorPipelineBridge(document.getElementById('review'), {timeoutMs:500,pollIntervalMs:30,maxPollIntervalMs:30,maxPolls:2,pollWindowMs:1000});
  ` }, bundle: true, format: 'iife', platform: 'browser', write: false });
  const fixture = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { creatorJobFixture } from './evals/creator-loop/pipeline-fixtures.ts';
    import { creatorFailure } from './packages/application/creator-operations.ts';
    window.makeOutput = kind => ({ok:true,data:{job:creatorJobFixture(kind)}});
    window.makeStatus = job => ({ok:true,data:{status:{id:job.id,kind:job.kind,state:job.state,stage:job.stage,
      revision:job.revision,created_at:job.created_at,updated_at:job.updated_at,progress:job.progress,
      terminal_result_available:job.state==='succeeded'}}});
    window.output = window.makeOutput('recommendations');
    window.startInput = {request_id:'00000000-0000-4000-8000-000000000622',source_url:'https://www.tiktok.com/@fixture'};
    const startJob = window.makeOutput('scan').data.job;
    startJob.state='queued'; startJob.revision=1; startJob.result=null; startJob.source_kind='profile';
    startJob.stage='accepted'; startJob.progress={kind:'scan',profile:null,videos:[],limitations:[]};
    const createdAt=startJob.created_at, projectId=startJob.project_id;
    window.startOutput={ok:true,data:{
      project:{id:projectId,name:'@fixture creator work',project_type:'brand',current_version:1,created_at:createdAt,updated_at:createdAt,
        brief_version:{id:'00000000-0000-4000-8000-000000000621',project_id:projectId,version:1,name:'@fixture creator work',created_at:createdAt,
          brief:{product:'Creator profile @fixture',audience:'Unknown until analysis',goal:'Find a tailored next video direction',tone:'Creator-led',language:'en',duration_seconds:30,filming_constraints:['Treat missing data as unknown'],facts:[]}}},
      job:startJob,
      source:{platform:'tiktok',kind:'profile',handle:'fixture',canonical_url:'https://www.tiktok.com/@fixture',profile_url:'https://www.tiktok.com/@fixture',video_url:null}
    }};
    window.denied = creatorFailure('UNAUTHENTICATED');
  ` }, bundle: true, format: 'iife', platform: 'browser', write: false });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src 'self'; connect-src 'none'");
    if (req.url === '/frame') res.end(`<div id="review"></div><script>${bundle.outputFiles[0].text}</script>`);
    else res.end(`<script>${fixture.outputFiles[0].text}</script><script>
      window.calls=[]; window.sizes=[]; window.messages=[]; window.displayRequests=[]; window.ready=false; window.respond=true;
      if(location.search==='?running'){window.output.data.job.state='running';window.output.data.job.result=null;}
      window.send=(method,params)=>document.querySelector('iframe').contentWindow.postMessage({jsonrpc:'2.0',method,params},'*');
      window.reply=(id,result)=>document.querySelector('iframe').contentWindow.postMessage({jsonrpc:'2.0',id,result},'*');
      addEventListener('message', e=>{
        const m=e.data;
        if(m.method==='ui/initialize' && location.search!=='?silent') window.reply(m.id,{protocolVersion:m.params.protocolVersion,
          hostInfo:{name:'local-fixture',version:'1'},hostCapabilities:{...(location.search==='?no-tools'?{}:{serverTools:{}}),experimental:{'openai/message':{}}},hostContext:{theme:'dark',locale:'lt',displayMode:'inline',availableDisplayModes:['inline','fullscreen'],styles:{variables:{'--color-background-primary':'#101010'}}}});
        if(m.method==='ui/notifications/initialized') {
          const direct=location.search==='?start';
          window.send('ui/notifications/tool-input',{arguments:direct?window.startInput:{job_id:window.output.data.job.id}});
          window.send('ui/notifications/tool-result',{structuredContent:direct?window.startOutput:window.output,content:[]}); window.ready=true;
        }
        if(m.method==='tools/call') { window.calls.push(m); if(window.respond) {
          const active=location.search==='?start'?window.startOutput.data.job:window.output.data.job;
          const structuredContent=m.params.name==='get_creator_job_status'?window.makeStatus(active):
            m.params.name==='list_riff_videos'?{ok:true,data:{cards:[],next_cursor:null,coverage:'Saved observations only.',freshness:'As last observed.'}}:
            {ok:true,data:{job:active}};
          window.reply(m.id,{structuredContent,content:[]});
        } }
        if(m.method==='ui/request-display-mode') { window.displayRequests.push(m.params); window.reply(m.id,{mode:'fullscreen'}); window.send('ui/notifications/host-context-changed',{displayMode:'fullscreen'}); }
        if(m.method==='ui/message') { window.messages.push(m.params); window.reply(m.id,{}); }
        if(m.method==='ui/notifications/size-changed') window.sizes.push(m.params);
        if(m.id==='teardown') window.tornDown=m;
      });
    </script><iframe src="/frame"></iframe>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({headless:true}); t.after(() => browser.close());
  const page = await browser.newPage();
  const errors=[], requests=[];
  page.on('pageerror', e=>errors.push(e.message));
  page.on('request', r=>requests.push(r.url()));
  const url=`http://127.0.0.1:${server.address().port}`;
  async function launch(query='') {
    await page.goto(url+'/'+query); await page.waitForFunction(()=>window.ready);
    const frame=page.frames().find(f=>f.url().endsWith('/frame'));
    await frame.waitForFunction(()=>{const text=document.querySelector('#review').textContent;return text.includes('Discovery')||text.includes('Finding videos for your next idea')||text.includes('Fetching your video')||text.includes('Getting to know your profile')});
    return frame;
  }
  let frame=await launch();
  await t.test('direct start input and result select and render the created job', async()=>{
    frame=await launch('?start');
    assert.match(await frame.locator('#review').textContent(),/Getting to know your profile/);
    assert.doesNotMatch(await frame.locator('#review').textContent(),/invalid or mismatched/);
  });
  frame=await launch();
  await t.test('handshake renders without reread, applies theme/locale and sends sizes', async()=>{
    assert.equal(await page.evaluate(()=>window.calls.length),0);
    assert.equal(await frame.locator('button').count(),1, 'only the Paper inline action is rendered; there is no bridge Refresh button');
    assert.equal(await frame.getByText('Refresh job',{exact:true}).count(),0);
    assert.equal(await frame.evaluate(()=>document.documentElement.lang),'lt');
    assert.equal(await frame.evaluate(()=>document.documentElement.dataset.theme),'dark');
    await page.waitForFunction(()=>window.sizes.length>0);
    // Same-window spoof is not the parent WindowProxy accepted by PostMessageTransport.
    await frame.evaluate(()=>window.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{isError:true,content:[]}},'*'));
    await frame.evaluate(()=>new Promise(resolve=>setTimeout(resolve,20)));
    assert.match(await frame.locator('#review').textContent(),/Discovery/);
  });
  await t.test('Open discovery requests fullscreen and explicit selection uses the OpenAI message extension',async()=>{
    await frame.getByRole('button',{name:'Open discovery'}).click();
    await frame.waitForFunction(()=>document.body.textContent.includes('Find your next breakout idea.'));
    assert.deepEqual(await page.evaluate(()=>window.displayRequests),[{mode:'fullscreen'}]);
    await page.waitForFunction(()=>window.calls.some(call=>call.params.name==='list_riff_videos'),undefined,{timeout:2_000});
    assert.deepEqual(await page.evaluate(()=>window.calls.filter(call=>call.params.name==='list_riff_videos').map(call=>call.params.arguments)),
      [{project_id:'00000000-0000-4000-8000-000000000100',sort:'observed_at_desc',limit:8}]);
    await frame.getByRole('button',{name:'Make it mine'}).click();
    await page.waitForFunction(()=>window.messages.length===1);
    const sent=await page.evaluate(()=>window.messages[0]);
    assert.match(sent.content[0].text,/One useful desk change.*complete video direction/i);
    assert.doesNotMatch(sent.content[0].text,internalUuid);
    assert.doesNotMatch(sent.content[0].text,/\b(?:creator job|recommendation batch|DNA(?: ID)?|script set|variant)\b|\bversion\s+\d+\b/i);
    assert.deepEqual(sent._meta['openai/message'],{target:'active',send:true});
    await page.evaluate(()=>{window.calls=[];});
  });
  await t.test('explicit refresh reads only compact status; duplicate calls suppressed',async()=>{
    await frame.evaluate(()=>Promise.all([window.bridge.refresh(),window.bridge.refresh()]));
    assert.deepEqual(await page.evaluate(()=>window.calls.map(m=>({name:m.params.name,arguments:m.params.arguments}))),[{name:'get_creator_job_status',arguments:{job_id:'00000000-0000-4000-8000-000000000620'}}]);
  });
  await t.test('timeout recovers with explicit retry and ignores late result',async()=>{
    await page.evaluate(()=>{window.respond=false;});
    await frame.evaluate(()=>window.bridge.refresh());
    assert.match(await frame.locator('#review').textContent(),/Updates timed out/);
    await page.evaluate(()=>{window.reply(window.calls.at(-1).id,{structuredContent:window.output,content:[]});window.respond=true;});
    await frame.evaluate(()=>window.bridge.refresh());
    assert.match(await frame.locator('#review').textContent(),/Discovery|Find your next breakout idea/);
  });
  await t.test('auth failure clears data and late host output cannot restore it',async()=>{
    await page.evaluate(()=>window.send('ui/notifications/tool-result',{structuredContent:window.denied,isError:true,content:[]}));
    await frame.waitForFunction(()=>document.querySelector('#review').textContent.includes('Reconnect your Riff'));
    await page.evaluate(()=>window.send('ui/notifications/tool-result',{structuredContent:window.output,content:[]}));
    await frame.evaluate(()=>window.bridge.refresh());
    assert.doesNotMatch(await frame.locator('#review').textContent(),/One useful desk change|Captured DNA/);
  });
  await t.test('bounded polling reads only persisted status then stops, terminal results remain complete',async()=>{
    frame=await launch('?running');
    await frame.waitForFunction(()=>document.querySelector('#review').textContent.includes('Automatic updates paused'));
    assert.equal(await page.evaluate(()=>window.calls.length),2);
    assert.ok(await page.evaluate(()=>window.calls.every(m=>m.params.name==='get_creator_job_status')));
    await page.evaluate(()=>{
      window.output=window.makeOutput('recommendations');window.output.data.job.revision=4;
      window.send('ui/notifications/tool-result',{structuredContent:window.output,content:[]});
    });
    await frame.waitForFunction(()=>document.querySelector('#review').textContent.includes('Discovery'));
    const count=await page.evaluate(()=>window.calls.length);await page.waitForTimeout(80);
    assert.equal(await page.evaluate(()=>window.calls.length),count);
    for(const kind of ['scan','scripts']) {
      await page.evaluate(kind=>{
        window.output=window.makeOutput(kind);window.output.data.job.id=kind==='scan'?'00000000-0000-4000-8000-000000000998':'00000000-0000-4000-8000-000000000999';
        window.send('ui/notifications/tool-input',{arguments:{job_id:window.output.data.job.id}});
        window.send('ui/notifications/tool-result',{structuredContent:window.output,content:[]});
      },kind);
      await frame.waitForFunction(kind=>document.querySelector('#review').textContent.includes(kind==='scan'?'Creator analysis':'Your script, ready to film'),kind);
    }
  });
  await t.test('model text and private metadata cannot restore or introduce job content',async()=>{
    frame=await launch();
    await page.evaluate(()=>window.send('ui/notifications/tool-result',{_meta:window.output,content:[{type:'text',text:JSON.stringify(window.output)}]}));
    await frame.waitForFunction(()=>document.querySelector('#review').textContent.includes('invalid or mismatched'));
    assert.doesNotMatch(await frame.locator('#review').textContent(),/One useful desk change/);
  });
  await t.test('missing read capability retains display without sending tools',async()=>{
    frame=await launch('?no-tools');
    await frame.evaluate(()=>window.bridge.refresh());
    assert.equal(await page.evaluate(()=>window.calls.length),0);
    assert.match(await frame.locator('#review').textContent(),/Discovery/);
  });
  await t.test('missing handshake reaches recovery and top-level mounting fails closed',async()=>{
    await page.goto(url+'/?silent');
    frame=page.frames().find(f=>f.url().endsWith('/frame'));
    await frame.waitForFunction(()=>document.querySelector('#review').textContent.includes('connection could not load'));
    await page.goto(url+'/frame');
    assert.match(await page.locator('#review').textContent(),/connection could not load/);
    await page.evaluate(()=>window.bridge.dispose());
  });
  await t.test('teardown acknowledges and disposes DOM and resize notifications',async()=>{
    frame=await launch();
    await page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({jsonrpc:'2.0',id:'teardown',method:'ui/resource-teardown',params:{}},'*'));
    await page.waitForFunction(()=>window.tornDown);
    await frame.waitForFunction(()=>document.querySelector('#review').textContent==='');
    const count=await page.evaluate(()=>window.sizes.length);
    await frame.evaluate(()=>{document.body.style.height='1800px';});
    await page.waitForTimeout(40);
    assert.equal(await page.evaluate(()=>window.sizes.length),count);
  });
  assert.deepEqual(errors,[]);
  assert.ok(requests.every(r=>[url+'/',url+'/?no-tools',url+'/?silent',url+'/?running',url+'/?start',url+'/frame'].includes(r)));
});
