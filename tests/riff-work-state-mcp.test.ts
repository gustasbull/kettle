import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMcp } from '../apps/worker/mcp.ts';
import { createOperations, failure } from '../packages/application/operations.ts';
import { config, fixtureAuth } from './auth-fixtures.ts';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const account=id(1),job=id(2),variant=id(3),request=id(4);
const input={job_id:job,variant_id:variant,state:'saved' as const,expected_version:0,request_id:request};
const receipt={ok:true as const,data:{work_state:{job_id:job,variant_id:variant,state:'saved' as const,version:1,updated_at:'2026-10-11T09:10:46.000Z'}}};

async function loadModules(){
  const [contracts,application,database,definitions]=await Promise.all([
    import('../packages/contracts/riff-work-state.ts').catch(()=>({})),
    import('../packages/application/riff-work-state.ts').catch(()=>({})),
    import('../packages/database/riff-work-state-supabase.ts').catch(()=>({})),
    import('../apps/worker/mcp-definitions.ts'),
  ]);
  return {contracts:anyObject(contracts),application:anyObject(application),database:anyObject(database),definitions:anyObject(definitions)};
}
function anyObject(value:unknown):Record<string,any>{return value&&typeof value==='object'?value as Record<string,any>:{};}

test('strict work-state contract accepts only the five public JSON keys and integral versions',async()=>{
  const {contracts}=await loadModules();
  assert.equal(typeof contracts.SetRiffWorkStateInput?.safeParse,'function','Task 7 work-state contract is not implemented');
  assert.equal(contracts.riffWorkStateContracts?.set_riff_work_state?.input,contracts.SetRiffWorkStateInput);
  const schema=contracts.SetRiffWorkStateInput;
  assert.equal(schema.safeParse(input).success,true);
  for(const invalid of [
    {...input,account_id:account},{...input,extra:true},{...input,job_id:1},{...input,variant_id:null},
    {...input,state:'published'},{...input,expected_version:-1},{...input,expected_version:.5},
    {...input,expected_version:2147483647},{...input,expected_version:'0'},{...input,request_id:'bad'},
  ]) assert.equal(schema.safeParse(invalid).success,false,JSON.stringify(invalid));
  assert.deepEqual(contracts.SetRiffWorkStateOutput.parse(receipt),receipt);
});

test('application verifies identity and scope, passes only trusted account ownership, and parses storage output',async()=>{
  const {application}=await loadModules();
  assert.equal(typeof application.createRiffWorkStateOperations,'function','Task 7 application operation is not implemented');
  const calls:any[]=[];
  const repository={async set(owner:string,value:unknown){calls.push({owner,value});return receipt;}};
  const operations=application.createRiffWorkStateOperations({async verify(token:string){
    if(token==='throw')throw Error('bad token');
    if(token==='bad-id')return {account_id:'claimed',scopes:['projects:write']};
    return token==='read-only'?{account_id:account,scopes:['projects:read']}:{account_id:account,scopes:['projects:write']};
  }},repository);
  assert.deepEqual(await operations.execute(null,input),failure('UNAUTHENTICATED'));
  assert.deepEqual(await operations.execute('throw',input),failure('UNAUTHENTICATED'));
  assert.deepEqual(await operations.execute('bad-id',input),failure('UNAUTHENTICATED'));
  assert.deepEqual(await operations.execute('read-only',input),failure('FORBIDDEN'));
  assert.deepEqual(await operations.execute('token',{...input,account_id:account}),failure('VALIDATION_ERROR'));
  assert.deepEqual(await operations.execute('token',input),receipt);
  assert.deepEqual(calls,[{owner:account,value:input}]);
  const malformed=application.createRiffWorkStateOperations({async verify(){return {account_id:account,scopes:['projects:write']};}},
    {async set(){return {ok:true,data:{work_state:{...receipt.data.work_state,account_id:account}}};}});
  assert.deepEqual(await malformed.execute('token',input),failure('UNAVAILABLE'));
});

test('repository uses one fixed service-role RPC and sends only trusted account plus exact input',async()=>{
  const {database}=await loadModules();
  assert.equal(typeof database.createRiffWorkStateSupabaseRepository,'function','Task 7 repository is not implemented');
  const seen:any[]=[];const fetcher:typeof fetch=async(url,init)=>{seen.push({url:String(url),init});return Response.json(receipt);};
  const repository=database.createRiffWorkStateSupabaseRepository('https://example.supabase.co','service-secret',fetcher);
  assert.deepEqual(await repository.set(account,input),receipt);
  assert.equal(seen[0].url,'https://example.supabase.co/rest/v1/rpc/kettle_set_riff_work_state');
  assert.equal(seen[0].init.method,'POST');assert.equal(seen[0].init.redirect,'manual');assert.ok(seen[0].init.signal);
  assert.equal(new Headers(seen[0].init.headers).get('authorization'),'Bearer service-secret');
  assert.deepEqual(JSON.parse(seen[0].init.body),{p_account_id:account,p_input:input});
  assert.throws(()=>database.createRiffWorkStateSupabaseRepository('http://example.com','secret',fetcher));
});

test('MCP advertises and dispatches the capability-keyed authenticated idempotent write',async()=>{
  const modules=await loadModules();
  assert.ok(Array.isArray(modules.definitions.RIFF_WORK_STATE_TOOLS),'Task 7 MCP descriptor is not implemented');
  const identity=await fixtureAuth(),token=await identity.token();
  const operations=createOperations(identity.verifier,{async call(){throw Error('unused');}});
  const calls:any[]=[];
  const auth:any={config,verifier:identity.verifier,operations,riffWorkStateOperations:{async execute(credential:string,value:unknown){calls.push({credential,value});return receipt;}}};
  const rpc=async(method:string,params:unknown)=>(await handleMcp(new Request(config.resource,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',Authorization:`Bearer ${token}`},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),auth)).json() as any;
  const listed=await rpc('tools/list',{}),tool=listed.result.tools.find((entry:any)=>entry.name==='set_riff_work_state');
  assert.ok(tool);assert.equal(tool.annotations.readOnlyHint,false);assert.equal(tool.annotations.destructiveHint,false);
  assert.equal(tool.annotations.idempotentHint,true);assert.equal(tool.annotations.openWorldHint,false);
  assert.deepEqual(tool.securitySchemes,[{type:'oauth2',scopes:['openid']}]);
  const called=await rpc('tools/call',{name:'set_riff_work_state',arguments:input});
  assert.deepEqual(called.result.structuredContent,receipt);
  assert.equal(called.result.content[0].text,'Riff work state is saved (version 1).');
  assert.deepEqual(calls,[{credential:token,value:input}]);
});
