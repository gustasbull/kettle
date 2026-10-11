import test from 'node:test';
import assert from 'node:assert/strict';
import { App } from '../../apps/panel/mcp-app-lite.ts';

type Message={jsonrpc:'2.0';id?:string|number;method?:string;params?:unknown;result?:unknown;error?:{code:number;message:string}};

class FakeTransport {
  onmessage?: (message:Message)=>void;
  onclose?:()=>void;
  messages:Message[]=[];
  closed=false;
  failMethod?:string;
  async start(){}
  async send(message:Message){
    if(this.failMethod!==undefined&&message.method===this.failMethod)throw new Error('postMessage failed');
    this.messages.push(structuredClone(message));
  }
  async close(){this.closed=true;this.onclose?.();}
  receive(message:Message){this.onmessage?.(message);}
}

class TrackingSignal {
  aborted=false;
  private listeners=new Set<()=>void>();
  get listenerCount(){return this.listeners.size;}
  addEventListener(type:string,listener:()=>void){if(type==='abort')this.listeners.add(listener);}
  removeEventListener(type:string,listener:()=>void){if(type==='abort')this.listeners.delete(listener);}
  abort(){this.aborted=true;for(const listener of [...this.listeners])listener();}
}

const flush=async()=>{for(let index=0;index<6;index++)await Promise.resolve();};
const initializeResult={protocolVersion:'2026-01-26',hostInfo:{name:'fixture-host',version:'1.0.0'},hostCapabilities:{serverTools:{}},hostContext:{theme:'dark'}};

async function connected(){
  const app=new App({name:'fixture-app',version:'1.0.0'},{availableDisplayModes:['inline']},{autoResize:false});
  const transport=new FakeTransport();
  const promise=app.connect(transport as never,{timeout:100,maxTotalTimeout:100});
  await flush();
  const request=transport.messages.find(message=>message.method==='ui/initialize');assert.ok(request?.id!==undefined);
  transport.receive({jsonrpc:'2.0',id:request.id,result:initializeResult});
  await promise;
  assert.ok(transport.messages.some(message=>message.method==='ui/notifications/initialized'));
  return {app,transport};
}

test('standard ping succeeds and unsupported host requests return MethodNotFound',async()=>{
  const {app,transport}=await connected();
  transport.receive({jsonrpc:'2.0',id:'ping',method:'ping',params:{}});
  transport.receive({jsonrpc:'2.0',id:'unknown',method:'ui/not-supported',params:{}});
  await flush();
  assert.deepEqual(transport.messages.find(message=>message.id==='ping'),{jsonrpc:'2.0',id:'ping',result:{}});
  assert.deepEqual(transport.messages.find(message=>message.id==='unknown'),{
    jsonrpc:'2.0',id:'unknown',error:{code:-32601,message:'Method not found'},
  });
  await app.close();
});

test('failed host request handlers return InternalError without exception text',async()=>{
  const {app,transport}=await connected();
  app.onteardown=async()=>{throw new Error('private handler detail');};
  transport.receive({jsonrpc:'2.0',id:'teardown',method:'ui/resource-teardown',params:{}});
  await flush();
  assert.deepEqual(transport.messages.find(message=>message.id==='teardown'),{
    jsonrpc:'2.0',id:'teardown',error:{code:-32603,message:'Internal error'},
  });
  await app.close();
});

test('connect validates the complete initialize result and negotiated protocol before initialized',async()=>{
  for(const result of [
    {...initializeResult,protocolVersion:'2025-01-01'},
    {protocolVersion:'2026-01-26',hostCapabilities:{},hostContext:{}},
    {protocolVersion:'2026-01-26',hostInfo:{name:'fixture-host'},hostCapabilities:{},hostContext:{}},
    {protocolVersion:'2026-01-26',hostInfo:{name:'fixture-host',version:'1'},hostCapabilities:null,hostContext:{}},
    {...initializeResult,hostCapabilities:{serverTools:{listChanged:'yes'}}},
    {...initializeResult,hostContext:{displayMode:'sideways'}},
    {...initializeResult,hostContext:{styles:{variables:{'--color-background-primary':42}}}},
    {...initializeResult,hostContext:{safeAreaInsets:{top:0,right:0,bottom:0}}},
  ]){
    const app=new App({name:'fixture-app',version:'1.0.0'},{},{autoResize:false});
    const transport=new FakeTransport();
    const promise=app.connect(transport as never,{timeout:100,maxTotalTimeout:100});
    await flush();const request=transport.messages.find(message=>message.method==='ui/initialize');assert.ok(request?.id!==undefined);
    transport.receive({jsonrpc:'2.0',id:request.id,result});
    await assert.rejects(promise,/initialize|protocol/i);
    assert.equal(transport.messages.some(message=>message.method==='ui/notifications/initialized'),false);
    assert.equal(transport.closed,true);
  }
});

test('request abort, timeout, resolution, rejection, send failure and close clean pending resources',async()=>{
  const {app,transport}=await connected();

  const preAborted=new TrackingSignal();preAborted.abort();
  const sentBefore=transport.messages.length;
  await assert.rejects(app.callServerTool({name:'pre-abort'}, {signal:preAborted as never,timeout:1_000}),/abort|cancel/i);
  assert.equal(transport.messages.length,sentBefore);assert.equal(preAborted.listenerCount,0);

  const inFlight=new TrackingSignal();
  const aborted=app.callServerTool({name:'in-flight'}, {signal:inFlight as never,timeout:1_000});
  await flush();inFlight.abort();
  await assert.rejects(aborted,/abort|cancel/i);assert.equal(inFlight.listenerCount,0);

  const resolvedSignal=new TrackingSignal();
  const resolved=app.callServerTool({name:'resolve'}, {signal:resolvedSignal as never,timeout:1_000});
  await flush();const resolveRequest=transport.messages.find(message=>message.method==='tools/call'&&(message.params as any).name==='resolve');assert.ok(resolveRequest?.id!==undefined);
  transport.receive({jsonrpc:'2.0',id:resolveRequest.id,result:{content:[]}});
  assert.deepEqual(await resolved,{content:[]});assert.equal(resolvedSignal.listenerCount,0);

  const rejectedSignal=new TrackingSignal();
  const rejected=app.callServerTool({name:'reject'}, {signal:rejectedSignal as never,timeout:1_000});
  await flush();const rejectRequest=transport.messages.find(message=>message.method==='tools/call'&&(message.params as any).name==='reject');assert.ok(rejectRequest?.id!==undefined);
  transport.receive({jsonrpc:'2.0',id:rejectRequest.id,error:{code:-32603,message:'host failure'}});
  await assert.rejects(rejected,/host failure/);assert.equal(rejectedSignal.listenerCount,0);

  const timeoutSignal=new TrackingSignal();
  await assert.rejects(app.callServerTool({name:'timeout'}, {signal:timeoutSignal as never,timeout:5,maxTotalTimeout:5}),/timed out/i);
  assert.equal(timeoutSignal.listenerCount,0);

  const sendSignal=new TrackingSignal();transport.failMethod='tools/call';
  await assert.rejects(app.callServerTool({name:'send-failure'}, {signal:sendSignal as never,timeout:1_000}),/send|postMessage/i);
  assert.equal(sendSignal.listenerCount,0);transport.failMethod=undefined;

  const syncSendSignal=new TrackingSignal();
  const originalSend=transport.send.bind(transport);
  transport.send=((message:Message)=>{
    if(message.method==='tools/call')throw new Error('synchronous postMessage failure');
    return originalSend(message);
  }) as typeof transport.send;
  await assert.rejects(app.callServerTool({name:'sync-send-failure'}, {signal:syncSendSignal as never,timeout:1_000}),/send|postMessage/i);
  assert.equal(syncSendSignal.listenerCount,0);
  transport.send=originalSend;

  const closeSignal=new TrackingSignal();
  const closing=app.callServerTool({name:'close'}, {signal:closeSignal as never,timeout:1_000});await flush();
  await app.close();await assert.rejects(closing,/closed/i);assert.equal(closeSignal.listenerCount,0);
});
