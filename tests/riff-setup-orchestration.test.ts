import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperations, failure } from '../packages/application/operations.ts';
import { handleMcp } from '../apps/worker/mcp.ts';
import { RIFF_HOME_URI } from '../apps/worker/riff-home-resource.ts';
import { RIFF_ONBOARDING_URI } from '../apps/worker/riff-onboarding-resource.ts';
import { config, fixtureAuth } from './auth-fixtures.ts';
import { accountA, accountB } from './fixtures.ts';

test('raw MCP setup opens Home and conditionally renders the separate inline welcome',async()=>{
  const identity=await fixtureAuth();const token=await identity.token();
  let onboardingSeenAt:string|null=null;let markWrites=0;const repositoryCalls:string[]=[];
  const operations=createOperations(identity.verifier,{async call(operation){
    repositoryCalls.push(operation);
    if(operation==='get_account_state')return {ok:true,data:{
      account:{id:accountA,display_name:'Authored setup creator',state:'active',preferred_language:'en',created_at:'2026-10-11T08:00:00Z',onboarding_seen_at:onboardingSeenAt},
      entitlements:{status:'not_configured'},usage:{status:'not_configured',reset_at:null},
    }};
    if(operation==='mark_riff_onboarding_seen'){markWrites++;onboardingSeenAt='2026-10-11T08:05:00Z';return {ok:true,data:{onboarding_seen_at:onboardingSeenAt}};}
    return failure('NOT_FOUND');
  }});
  const rpc=async(method:string,params:unknown,credential:string|null=token)=>{
    const response=await handleMcp(new Request(config.resource,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',
      ...(credential?{Authorization:`Bearer ${credential}`}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),
    {config,verifier:identity.verifier,operations});
    return response.json() as Promise<{result:any}>;
  };
  const initialized=(await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'raw-mcp-fixture',version:'1'}})).result;
  assert.match(initialized.instructions,/open_riff.*onboarding_seen_at.*null.*show_riff_welcome.*same originating response/is);
  assert.match(initialized.instructions,/never call `mark_riff_onboarding_seen`/i);

  const tools=(await rpc('tools/list',{})).result.tools as Array<{name:string;_meta?:{ui?:{resourceUri?:string;visibility?:string[]}}}>;
  assert.equal(tools.find(tool=>tool.name==='open_riff')?._meta?.ui?.resourceUri,RIFF_HOME_URI);
  assert.equal(tools.find(tool=>tool.name==='show_riff_welcome')?._meta?.ui?.resourceUri,RIFF_ONBOARDING_URI);
  assert.deepEqual(tools.find(tool=>tool.name==='mark_riff_onboarding_seen')?._meta?.ui?.visibility,['app']);

  const first=(await rpc('tools/call',{name:'open_riff',arguments:{}})).result;
  assert.equal(first.structuredContent.data.account.onboarding_seen_at,null);
  assert.match(first.content[0].text,/Home is open and usable.*call `show_riff_welcome` once.*same ChatGPT conversation/i);
  assert.equal(markWrites,0,'open_riff remains read-only and never marks merely because the guide can render');
  assert.deepEqual(repositoryCalls,['get_account_state']);
  const welcome=(await rpc('tools/call',{name:'show_riff_welcome',arguments:{}})).result;
  assert.deepEqual(welcome.structuredContent,{steps:['Start','Find','Make'],expected_account_id:accountA});
  assert.equal(markWrites,0,'rendering the inline welcome does not mark before its visible final action');
  assert.deepEqual(repositoryCalls,['get_account_state']);

  onboardingSeenAt='2026-10-11T08:05:00Z';
  const returning=(await rpc('tools/call',{name:'open_riff',arguments:{}})).result;
  assert.equal(returning.structuredContent.data.account.onboarding_seen_at,onboardingSeenAt);
  assert.match(returning.content[0].text,/Riff Home is open/i);
  assert.equal(markWrites,0,'returning setup also needs no model-driven write');
  assert.deepEqual(repositoryCalls,['get_account_state','get_account_state']);
});

test('welcome completion cannot cross accounts when host authorization changes',async()=>{
  const identity=await fixtureAuth();
  const tokenA=await identity.token({sub:'user-a'});const tokenB=await identity.token({sub:'user-b'});
  const seen=new Map([[accountA,null as string|null],[accountB,null as string|null]]);const writes:string[]=[];
  const operations=createOperations(identity.verifier,{async call(operation,owner,input){
    if(operation==='get_account_state')return {ok:true,data:{
      account:{id:owner,display_name:'Riff member',state:'active',preferred_language:'en',created_at:'2026-10-11T08:00:00Z',onboarding_seen_at:seen.get(owner)??null},
      entitlements:{status:'not_configured'},usage:{status:'not_configured',reset_at:null},
    }};
    if(operation==='mark_riff_onboarding_seen'){
      assert.deepEqual(input,{},'the client precondition must never become repository ownership input');
      writes.push(owner);const marked=seen.get(owner)??'2026-10-11T08:05:00Z';seen.set(owner,marked);
      return {ok:true,data:{onboarding_seen_at:marked}};
    }
    return failure('NOT_FOUND');
  }});
  const call=async(name:string,args:unknown,credential:string)=>{
    const response=await handleMcp(new Request(config.resource,{method:'POST',headers:{
      'Content-Type':'application/json',Accept:'application/json, text/event-stream',Authorization:`Bearer ${credential}`,
    },body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}),
    {config,verifier:identity.verifier,operations});
    return (await response.json() as {result:any}).result;
  };
  const issuance=await call('show_riff_welcome',{},tokenA);
  assert.deepEqual(issuance.structuredContent,{steps:['Start','Find','Make'],expected_account_id:accountA});

  const switched=await call('mark_riff_onboarding_seen',{
    expected_account_id:issuance.structuredContent.expected_account_id,
  },tokenB);
  assert.equal(switched.isError,true);
  assert.deepEqual(switched.structuredContent,failure('VERSION_CONFLICT'));
  assert.deepEqual(writes,[],'a mismatched credential must be rejected before repository access');
  assert.equal(seen.get(accountA),null);assert.equal(seen.get(accountB),null);

  const completed=await call('mark_riff_onboarding_seen',{
    expected_account_id:issuance.structuredContent.expected_account_id,
  },tokenA);
  assert.equal(completed.structuredContent.ok,true);
  assert.deepEqual(writes,[accountA]);
  assert.equal(seen.get(accountA),'2026-10-11T08:05:00Z');assert.equal(seen.get(accountB),null);
});
