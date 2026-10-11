import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createOperations } from '../packages/application/operations.ts';
import { createCreatorOperations, type CreatorRepository } from '../packages/application/creator-operations.ts';
import { createPipelineOperations, runCreatorPipelineJob, canProcessCapturedDna, type PipelineRepository } from '../packages/application/creator-pipeline.ts';
import { StoredCreatorAnalysis } from '../packages/contracts/creator-operations.ts';
import { CreatorJobOutput, pipelineContracts, type CreatorJobView } from '../packages/contracts/creator-pipeline.ts';
import { SaveProjectOutput } from '../packages/contracts/index.ts';
import { createCreatorPipelineProvider } from '../packages/adapters/creator-pipeline/provider.ts';
import { providerHttpFixture } from '../evals/creator-loop/provider-http-fixtures.ts';
import { creatorScriptsFixture } from '../evals/creator-loop/pipeline-fixtures.ts';
import { handleMcp } from '../apps/worker/mcp.ts';
import { oauthScopes } from '../packages/auth/index.ts';
import { fixtureAuth, config } from './auth-fixtures.ts';
import { createInput, accountA } from './fixtures.ts';
import { z } from 'zod';

// Entire proof is offline: signed synthetic JWT, actual SQL, fake provider HTTP.
test('trial-only authenticated MCP profile-to-DNA-to-ideas-to-saved-ChatGPT-script journey',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin; grant usage on schema public to service_role; alter default privileges in schema public grant all on tables to service_role;');
  for(const f of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(`supabase/migrations/${f}`,'utf8'));
  await db.exec(await readFile('supabase/seed.sql','utf8'));
  const identity=await fixtureAuth(),token=await identity.token(),f=providerHttpFixture();
  const seedUrl=f.input.request.supplied_url+'/video/7685478377012071694';
  const providerFetch=f.options.fetch;
  f.options.fetch=async(url,init)=>{
    if(new URL(url).hostname==='api.lightreel.ai' && JSON.parse(init.body as string).response_fields?.summary){
      f.http.push({url,init});
      return Response.json({conversationId:'synthetic-seed-review',answer:{video_url:seedUrl,summary:'An attributed review of the supplied desk setup video.',access_basis:'transcript_or_caption_only',limitations:['Synthetic test response; no real video access.']}});
    }
    return providerFetch(url,init);
  };
  const dbCalls:{operation:string;owner:string;input:unknown}[]=[];
  const sql=async(operation:string,owner:string,input:unknown)=>db.transaction(async tx=>{
    dbCalls.push({operation,owner,input});await tx.exec('set local role service_role');
    return (await tx.query<{value:unknown}>(`select public.kettle_${operation}($1::uuid,$2::jsonb) as value`,[owner,JSON.stringify(input)])).rows[0]!.value;
  });
  const repository:PipelineRepository={call:sql},creatorRepository:CreatorRepository={call:sql};
  const operations=createOperations(identity.verifier,{call:sql});
  const dispatches:{id:string;owner:string}[]=[];
  const pipelineOperations=createPipelineOperations(identity.verifier,repository,async(id,owner)=>{dispatches.push({id,owner});});
  const auth={config,verifier:identity.verifier,operations,creatorOperations:createCreatorOperations(identity.verifier,creatorRepository),pipelineOperations};
  const rpc=async(method:string,params:unknown,credential?:string)=>handleMcp(new Request(config.resource,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(credential?{Authorization:`Bearer ${credential}`}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),auth);
  const call=async(name:string,args:unknown,credential:string|undefined=token)=>await (await rpc('tools/call',{name,arguments:args},credential)).json() as {result:{structuredContent:unknown;content:{text:string}[];isError?:boolean;_meta?:Record<string,string[]>};error?:unknown};
  function job(response:Awaited<ReturnType<typeof call>>):CreatorJobView {
    assert.ok(!response.error);const parsed=CreatorJobOutput.parse(response.result.structuredContent);assert.ok(parsed.ok,JSON.stringify(parsed));
    assert.deepEqual(JSON.parse(response.result.content[0]!.text),response.result.structuredContent);
    for(const secret of ['account_id','captured','permitted_uses','ceiling_microusd','synthetic-sc','synthetic-lr'])assert.ok(!JSON.stringify(response.result).includes(secret));
    return parsed.data.job;
  }
  let providerConstructions=0;
  async function run(id:string){await runCreatorPipelineJob(repository,creatorRepository,accountA,id,stored=>{
    providerConstructions++;
    const captured=stored.kind==='scan'?undefined:StoredCreatorAnalysis.parse((stored.captured as {stored:unknown}).stored);
    return createCreatorPipelineProvider({...f.options,...(stored.kind==='scan'?{seedUrl}:{}),credentials:{scrapeCreators:f.options.credentials.scrapeCreators,lightreel:f.options.credentials.lightreel},canProcessDna:view=>!!captured&&canProcessCapturedDna(captured,view)});
  },{scrapecreators:0,lightreel:0,openai:0},async(_name,fn)=>fn());}
  const created=SaveProjectOutput.parse(await operations.execute('save_project',token,createInput()));assert.ok(created.ok);
  const projectId=created.data.project.id;
  await db.query("insert into public.creator_pipeline_allowances(account_id,profile_url,enabled,expires_at) values($1,$2,true,now()+interval '1 day')",[accountA,f.input.request.supplied_url]);
  await db.exec("insert into public.creator_provider_trials(provider,remaining_units,enabled,expires_at) values('scrapecreators',10,true,now()+interval '1 hour'),('lightreel',3,true,now()+interval '1 hour')");
  const listing=await (await rpc('tools/list',{})).json() as {result:{tools:any[]}};
  for(const name of ['start_creator_scan','start_creator_recommendations','save_creator_scripts','get_creator_job','render_creator_job']){
    const tool=listing.result.tools.find(t=>t.name===name);assert.ok(tool,name);
    const contract=pipelineContracts[name==='render_creator_job'?'get_creator_job':name as keyof typeof pipelineContracts];
    assert.deepEqual(tool.inputSchema,{...z.toJSONSchema(contract.input),type:'object'});
    assert.deepEqual(tool.outputSchema,{...z.toJSONSchema(contract.output),type:'object'});
    assert.deepEqual(tool.securitySchemes,[{type:'oauth2',scopes:[...oauthScopes]}]);
  }
  assert.ok(!listing.result.tools.some(t=>t.name==='start_creator_scripts'),'API model generation hidden during trial');
  const scanInput={project_id:projectId,request_id:crypto.randomUUID(),scan:f.input.request,seed_url:seedUrl};
  let scan=job(await call('start_creator_scan',scanInput));assert.equal(scan.state,'queued');assert.equal(f.http.length,0);
  await run(scan.id);scan=job(await call('render_creator_job',{job_id:scan.id}));assert.equal(scan.state,'succeeded');assert.equal(scan.result?.kind,'scan');
  assert.equal(f.http.length,3);assert.equal(new URL(f.http[0]!.url).hostname,'api.lightreel.ai');assert.equal(scan.result!.kind,'scan');if(scan.result!.kind!=='scan')throw Error('scan');
  const dna=scan.result!.dna;
  assert.equal(dna.seed_review?.url,seedUrl);assert.equal(dna.seed_review?.access_basis,'transcript_or_caption_only');
  assert.ok(!JSON.stringify(dna.seed_review).includes('conversation_id'));
  const recInput={dna_id:dna.dna_id,expected_version:dna.version,request_id:crypto.randomUUID()};
  let rec=job(await call('start_creator_recommendations',recInput));await run(rec.id);rec=job(await call('render_creator_job',{job_id:rec.id}));
  assert.equal(rec.state,'succeeded');if(rec.result?.kind!=='recommendations')throw Error(JSON.stringify(rec));
  const batch=rec.result.batch;assert.equal(batch.ideas.length,1);assert.equal(f.http.length,5);
  const variants=creatorScriptsFixture().variants.map(({id:_id,...v})=>({...v,reference_ids:batch.ideas[0]!.reference_ids}));
  const saveInput={batch_id:batch.id,idea_id:batch.ideas[0]!.id,request_id:crypto.randomUUID(),variants};
  let saved=job(await call('save_creator_scripts',saveInput));const constructions=providerConstructions,requests=f.http.length;
  await run(saved.id);saved=job(await call('render_creator_job',{job_id:saved.id}));assert.equal(saved.state,'succeeded');
  if(saved.result?.kind!=='scripts')throw Error(JSON.stringify(saved));
  assert.equal(saved.result.scripts.variants.length,2);assert.equal(saved.result.scripts.dna_version,dna.version);assert.equal(saved.result.scripts.batch_id,batch.id);
  assert.match(saved.result.scripts.limitations.join(' '),/No separate OpenAI API request/);
  assert.equal(providerConstructions,constructions);assert.equal(f.http.length,requests);
  const dispatchCount=dispatches.length;
  assert.deepEqual(job(await call('save_creator_scripts',saveInput)),saved);
  assert.deepEqual(job(await call('get_creator_job',{job_id:saved.id})),saved);
  assert.equal(dispatches.length,dispatchCount);assert.equal(f.http.length,requests);
  assert.ok(!f.http.some(r=>new URL(r.url).hostname==='api.openai.com'));
  const attemptRows=await db.query<{provider:string}>('select provider from public.creator_attempts');assert.equal(attemptRows.rows.length,5);assert.ok(attemptRows.rows.every(r=>r.provider!=='openai'));
  assert.deepEqual((await db.query('select limit_microusd,reserved_microusd from public.creator_pipeline_budget')).rows,[{limit_microusd:0,reserved_microusd:0}]);
  const before=dbCalls.length;
  const unauth=await (await rpc('tools/call',{name:'get_creator_job',arguments:{job_id:saved.id}})).json() as any;
  assert.match(unauth.result._meta['mcp/www_authenticate'][0],/invalid_token/);
  const noScope=await call('save_creator_scripts',{...saveInput,request_id:crypto.randomUUID()},await identity.token({riff_permissions:['projects:read']}));
  assert.match(noScope.result._meta!['mcp/www_authenticate']![0]!,/insufficient_scope/);assert.equal(dbCalls.length,before);
  const foreign=await identity.token({sub:'user-b'});
  assert.deepEqual((await call('render_creator_job',{job_id:saved.id},foreign)).result,(await call('render_creator_job',{job_id:crypto.randomUUID()},foreign)).result);
  const foreignSave=await call('save_creator_scripts',{...saveInput,request_id:crypto.randomUUID()},foreign);assert.equal(foreignSave.result.isError,true);assert.match(foreignSave.result.content[0]!.text,/NOT_FOUND/);
  assert.equal(dispatches.length,dispatchCount);assert.equal(f.http.length,requests);
  const resource=await (await rpc('resources/read',{uri:'ui://kettle/creator-pipeline-v2.html'})).json() as any;
  const content=resource.result.contents[0];assert.match(content.text,/get_creator_job/);assert.ok(!content.text.includes(saved.id));
  assert.deepEqual(content._meta.ui.csp,{connectDomains:[],resourceDomains:[],frameDomains:[],baseUriDomains:[]});
  identity.block();assert.equal((await rpc('tools/call',{name:'get_creator_job',arguments:{job_id:saved.id}},token)).status,401);
});
