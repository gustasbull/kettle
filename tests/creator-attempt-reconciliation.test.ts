import test from 'node:test';
import assert from 'node:assert/strict';
import { runCreatorAttemptReconciliation } from '../packages/application/creator-attempt-reconciliation.ts';
import { createScrapeCreatorsUsageReader } from '../packages/adapters/creator-pipeline/scrapecreators-usage.ts';

const after='2026-10-11T00:00:00.000Z',before='2026-10-11T01:00:00.000Z';
const valid=['--confirm-usage-history-read-costs-1-credit','--page','1','--attempted-after',after,'--attempted-before',before,'--limit','10'];
const row=(operation:'profile'|'feed'|'video'='profile')=>({operation,attempted_at:'2026-10-11T00:05:00.000Z',terminal_state:null,
  failure_code:null,http_status:null,observed_at:null});

test('operator confirmation and all bounds fail before repository or usage access',async()=>{
  for(const argv of [[],valid.filter(value=>value!=='--confirm-usage-history-read-costs-1-credit'),
    valid.map(value=>value==='1'?'0':value),[...valid,'--unknown']]){
    let reads=0,fetches=0;const lines:string[]=[];
    assert.equal(await runCreatorAttemptReconciliation(argv,{repository:{async list(){reads++;return {}; }},usage:{async read(){fetches++;return {};}},write:value=>lines.push(value)}),2);
    assert.equal(reads,0);assert.equal(fetches,0);assert.deepEqual(lines,[]);
  }
});

test('valid operator report performs one bounded read and exactly one fixed usage GET',async()=>{
  const requests:Array<{url:string;init:RequestInit}>=[];
  const usage=createScrapeCreatorsUsageReader('synthetic-key',async(url,init)=>{requests.push({url:String(url),init:init!});
    return Response.json({complete:true,data:[{operation:'profile',observed_at:'2026-10-11T00:05:10.000Z',http_status:200}]});});
  let reads=0;const lines:string[]=[];
  const code=await runCreatorAttemptReconciliation(valid,{repository:{async list(input){reads++;assert.deepEqual(input,
    {provider:'scrapecreators',attempted_after:after,attempted_before:before,limit:10});return {ok:true,data:{attempts:[row()]}};}},usage,write:value=>lines.push(value)});
  assert.equal(code,0);assert.equal(reads,1);assert.equal(requests.length,1);
  assert.equal(requests[0]!.url,'https://api.scrapecreators.com/v1/account/get-api-usage?page=1');
  assert.equal(requests[0]!.init.method,'GET');assert.equal(requests[0]!.init.redirect,'manual');
  assert.equal((requests[0]!.init.headers as Record<string,string>)['x-api-key'],'synthetic-key');
  const report=JSON.parse(lines[0]!);assert.equal(report.counts.matched,1);assert.equal(report.attempts[0].ordinal,1);
  assert.doesNotMatch(lines[0]!,/synthetic-key|account_id|job_id|receipt|https?:\/\//i);
});

test('zero, duplicate, incomplete and malformed usage evidence are inconclusive and redacted',async()=>{
  for(const payload of [{complete:true,data:[]},{complete:true,data:[
    {operation:'profile',observed_at:'2026-10-11T00:05:10.000Z',http_status:200},
    {operation:'profile',observed_at:'2026-10-11T00:05:20.000Z',http_status:200}]},{complete:false,data:[]},{secret:'raw'}]){
    const usage=createScrapeCreatorsUsageReader('hidden-key',async()=>Response.json(payload));const lines:string[]=[];
    assert.equal(await runCreatorAttemptReconciliation(valid,{repository:{async list(){return {ok:true,data:{attempts:[row()]}};}},usage,write:value=>lines.push(value)}),0);
    assert.equal(JSON.parse(lines[0]!).attempts[0].status,'inconclusive');
    assert.doesNotMatch(lines[0]!,/hidden-key|secret|raw|not_observed/i);
  }
});

test('one usage candidate cannot match two overlapping local attempts and known status must agree',async()=>{
 const usage={async read(){return {complete:true,candidates:[{operation:'profile',observed_at:'2026-10-11T00:05:10.000Z',http_status:429}]};}};
 for(const attempts of [[row(),row()],[{...row(),http_status:503}]]){
  const lines:string[]=[];await runCreatorAttemptReconciliation(valid,{repository:{async list(){return {ok:true,data:{attempts}};}},usage,write:value=>lines.push(value)});
  const report=JSON.parse(lines[0]!);assert.equal(report.counts.matched,0);assert.ok(report.attempts.every((value:any)=>value.status==='inconclusive'));
 }
});

test('usage adapter fails closed on redirect, HTTP failure, oversized and malformed bodies with one request',async()=>{
  const responses=[new Response('',{status:302}),new Response('',{status:500}),new Response('x'.repeat(262145)),new Response('{bad')];
  for(const response of responses){let calls=0;const value=await createScrapeCreatorsUsageReader('key',async()=>{calls++;return response;}).read(1);
    assert.equal(calls,1);assert.deepEqual(value,{complete:false,candidates:[]});}
});
test('usage adapter deadline bounds an injected fetch that ignores abort',async()=>{
 let calls=0;const reader=createScrapeCreatorsUsageReader('key',async()=>{calls++;return new Promise<Response>(()=>{});},{timeoutMs:5});
 await assert.rejects(reader.read(1),/unavailable/);assert.equal(calls,1);
 const hanging=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode('{'));}});
 await assert.rejects(createScrapeCreatorsUsageReader('key',async()=>new Response(hanging),{timeoutMs:5}).read(1),/unavailable/);
});
