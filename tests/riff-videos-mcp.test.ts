import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMcp } from '../apps/worker/mcp.ts';
import { createOperations } from '../packages/application/operations.ts';
import { config, fixtureAuth } from './auth-fixtures.ts';

test('MCP publishes provider-free list with concise fallback and full structured content',async()=>{
  const identity=await fixtureAuth(),token=await identity.token();
  const operations=createOperations(identity.verifier,{async call(){throw Error('unused');}});
  const result={ok:true,data:{cards:[],next_cursor:null,coverage:'Saved permitted metadata only; no provider refresh was performed.',freshness:'No saved observations matched; no refresh was performed.'}};
  const calls:any[]=[];const auth:any={config,verifier:identity.verifier,operations,riffVideoOperations:{async execute(operation:string,credential:string,input:unknown){calls.push({operation,credential,input});return result;}}};
  const rpc=async(method:string,params:unknown)=>(await handleMcp(new Request(config.resource,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',Authorization:`Bearer ${token}`},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),auth)).json() as any;
  const listed=await rpc('tools/list',{}),tool=listed.result.tools.find((x:any)=>x.name==='list_riff_videos');assert.ok(tool);
  assert.equal(tool.annotations.readOnlyHint,true);assert.equal(tool.annotations.idempotentHint,true);assert.equal(tool.annotations.openWorldHint,false);assert.deepEqual(tool._meta.ui.visibility,['model','app']);assert.equal(tool._meta.ui.resourceUri,undefined);
  const called=await rpc('tools/call',{name:'list_riff_videos',arguments:{}});assert.deepEqual(called.result.structuredContent,result);assert.equal(called.result.content[0].text,'Returned 0 saved Riff video cards; no provider refresh was performed.');
  assert.deepEqual(calls,[{operation:'list_riff_videos',credential:token,input:{}}]);
});
