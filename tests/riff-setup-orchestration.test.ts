import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperations, failure } from '../packages/application/operations.ts';
import { handleMcp } from '../apps/worker/mcp.ts';
import { RIFF_HOME_URI } from '../apps/worker/riff-home-resource.ts';
import { config, fixtureAuth } from './auth-fixtures.ts';
import { accountA } from './fixtures.ts';

test('raw MCP setup needs only open_riff because the app owns first-use routing and completion',async()=>{
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
  assert.match(initialized.instructions,/open_riff.*owns first-use routing/is);
  assert.match(initialized.instructions,/never call `mark_riff_onboarding_seen`/i);

  const tools=(await rpc('tools/list',{})).result.tools as Array<{name:string;_meta?:{ui?:{resourceUri?:string;visibility?:string[]}}}>;
  assert.equal(tools.find(tool=>tool.name==='open_riff')?._meta?.ui?.resourceUri,RIFF_HOME_URI);
  assert.deepEqual(tools.find(tool=>tool.name==='mark_riff_onboarding_seen')?._meta?.ui?.visibility,['app']);

  const first=(await rpc('tools/call',{name:'open_riff',arguments:{}})).result;
  assert.equal(first.structuredContent.data.account.onboarding_seen_at,null);
  assert.match(first.content[0].text,/first-use Paper guide is open in the Riff app/i);
  assert.equal(markWrites,0,'open_riff remains read-only and never marks merely because the guide can render');
  assert.deepEqual(repositoryCalls,['get_account_state']);

  onboardingSeenAt='2026-10-11T08:05:00Z';
  const returning=(await rpc('tools/call',{name:'open_riff',arguments:{}})).result;
  assert.equal(returning.structuredContent.data.account.onboarding_seen_at,onboardingSeenAt);
  assert.match(returning.content[0].text,/Riff Home is open/i);
  assert.equal(markWrites,0,'returning setup also needs no model-driven write');
  assert.deepEqual(repositoryCalls,['get_account_state','get_account_state']);
});
