const UI_PROTOCOL_VERSION='2026-01-26';
/**
 * Deliberately local and dependency-free: the installed transport helper only
 * provides postMessage routing, while the installed full App brings its schema
 * runtime into this launch-critical bundle. This adapter keeps the required
 * JSON-RPC lifecycle, initialize validation, cancellation, and cleanup within
 * the panel's 250 KB raw / 75 KB gzip budgets.
 */
type JsonRpcId=string|number;
type JsonRpcMessage={jsonrpc:'2.0';id?:JsonRpcId;method?:string;params?:any;result?:any;error?:{code:number;message:string;data?:unknown}};
type RequestOptions={signal?:AbortSignal;timeout?:number;maxTotalTimeout?:number;resetTimeoutOnProgress?:boolean};
type Pending={resolve:(value:any)=>void;reject:(error:Error)=>void;timer?:ReturnType<typeof setTimeout>;signal?:AbortSignal;abort?:()=>void};
type AppTransport={onmessage?:(message:JsonRpcMessage)=>void;onclose?:()=>void;onerror?:(error:Error)=>void;start():Promise<void>;send(message:JsonRpcMessage):Promise<void>;close():Promise<void>};

export type McpUiHostContext = {
  theme?:'light'|'dark';locale?:string;displayMode?:string;availableDisplayModes?:string[];
  styles?:{variables?:Record<string,string|undefined>;css?:{fonts?:string}};
  safeAreaInsets?:Record<string,number>;
};

function plainObject(value:unknown):value is Record<string,any>{
  if(value===null||typeof value!=='object'||Array.isArray(value))return false;
  const prototype=Object.getPrototypeOf(value);if(prototype!==Object.prototype&&prototype!==null)return false;
  return Object.values(Object.getOwnPropertyDescriptors(value)).every(descriptor=>'value' in descriptor);
}
const optionalString=(record:Record<string,any>,key:string)=>record[key]===undefined||typeof record[key]==='string';
const stringArray=(value:unknown)=>Array.isArray(value)&&value.every(entry=>typeof entry==='string');
const objectCapability=(record:Record<string,any>,key:string)=>record[key]===undefined||plainObject(record[key]);
function validHostInfo(value:unknown){
  if(!plainObject(value)||typeof value.name!=='string'||!value.name||typeof value.version!=='string'||!value.version
    ||!optionalString(value,'websiteUrl')||!optionalString(value,'description')||!optionalString(value,'title'))return false;
  return value.icons===undefined||Array.isArray(value.icons)&&value.icons.every((icon:any)=>plainObject(icon)
    &&typeof icon.src==='string'&&optionalString(icon,'mimeType')
    &&(icon.sizes===undefined||stringArray(icon.sizes))
    &&(icon.theme===undefined||['light','dark'].includes(icon.theme)));
}
function validHostCapabilities(value:unknown){
  if(!plainObject(value)||!['openLinks','downloadFile','logging'].every(key=>objectCapability(value,key)))return false;
  for(const key of ['serverTools','serverResources'])if(value[key]!==undefined
    &&(!plainObject(value[key])||(value[key].listChanged!==undefined&&typeof value[key].listChanged!=='boolean')))return false;
  if(value.experimental!==undefined&&(!plainObject(value.experimental)||!Object.values(value.experimental).every(plainObject)))return false;
  if(value.sandbox!==undefined){
    if(!plainObject(value.sandbox))return false;
    const permissions=value.sandbox.permissions,csp=value.sandbox.csp;
    if(permissions!==undefined&&(!plainObject(permissions)
      ||!['camera','microphone','geolocation','clipboardWrite'].every(key=>objectCapability(permissions,key))))return false;
    if(csp!==undefined&&(!plainObject(csp)||!['connectDomains','resourceDomains','frameDomains','baseUriDomains']
      .every(key=>csp[key]===undefined||stringArray(csp[key]))))return false;
  }
  for(const key of ['updateModelContext','message'])if(value[key]!==undefined){
    if(!plainObject(value[key])||!['text','image','audio','resource','resourceLink','structuredContent']
      .every(capability=>objectCapability(value[key],capability)))return false;
  }
  return value.sampling===undefined||plainObject(value.sampling)
    &&objectCapability(value.sampling,'tools');
}
function validHostContext(context:Record<string,any>){
  const modes=['inline','fullscreen','pip'];
  if(context.theme!==undefined&&!['light','dark'].includes(context.theme)
    ||!optionalString(context,'locale')||!optionalString(context,'timeZone')||!optionalString(context,'userAgent')
    ||context.displayMode!==undefined&&!modes.includes(context.displayMode)
    ||context.availableDisplayModes!==undefined&&(!Array.isArray(context.availableDisplayModes)
      ||!context.availableDisplayModes.every((entry:any)=>modes.includes(entry)))
    ||context.platform!==undefined&&!['web','desktop','mobile'].includes(context.platform))return false;
  if(context.styles!==undefined){
    if(!plainObject(context.styles))return false;
    if(context.styles.variables!==undefined&&(!plainObject(context.styles.variables)
      ||!Object.entries(context.styles.variables).every(([key,value])=>key.startsWith('--')
        &&(typeof value==='string'||value===undefined))))return false;
    if(context.styles.css!==undefined&&(!plainObject(context.styles.css)||!optionalString(context.styles.css,'fonts')))return false;
  }
  if(context.safeAreaInsets!==undefined){
    if(!plainObject(context.safeAreaInsets)||!['top','right','bottom','left']
      .every(key=>Number.isFinite(context.safeAreaInsets[key])))return false;
  }
  if(context.deviceCapabilities!==undefined&&(!plainObject(context.deviceCapabilities)
    ||!['touch','hover'].every(key=>context.deviceCapabilities[key]===undefined
      ||typeof context.deviceCapabilities[key]==='boolean')))return false;
  if(context.containerDimensions!==undefined){
    const dimensions=context.containerDimensions;
    if(!plainObject(dimensions)||!['height','maxHeight','width','maxWidth']
      .every(key=>dimensions[key]===undefined||Number.isFinite(dimensions[key]))
      ||!(Number.isFinite(dimensions.height)||Number.isFinite(dimensions.maxHeight))
      ||!(Number.isFinite(dimensions.width)||Number.isFinite(dimensions.maxWidth)))return false;
  }
  return true;
}
function initializeResult(value:unknown):{protocolVersion:string;hostInfo:{name:string;version:string};hostCapabilities:Record<string,any>;hostContext:McpUiHostContext}|undefined{
  if(!plainObject(value)||value.protocolVersion!==UI_PROTOCOL_VERSION||!validHostInfo(value.hostInfo)
    ||!validHostCapabilities(value.hostCapabilities)||!plainObject(value.hostContext))return;
  const context=value.hostContext;
  if(!validHostContext(context))return;
  return value as ReturnType<typeof initializeResult>;
}

export class PostMessageTransport implements AppTransport {
  onmessage?: (message:JsonRpcMessage)=>void;onclose?:()=>void;onerror?:(error:Error)=>void;
  private started=false;
  private listener=(event:MessageEvent)=>{
    if(event.source!==this.source)return;
    const value=event.data;
    if(!plainObject(value)||value.jsonrpc!=='2.0')return;
    this.onmessage?.(value as JsonRpcMessage);
  };
  constructor(private target:Window=window.parent,private source:Window=window.parent){}
  async start(){if(this.started)return;this.started=true;window.addEventListener('message',this.listener);}
  async send(message:JsonRpcMessage){this.target.postMessage(message,'*');}
  async close(){if(!this.started)return;this.started=false;window.removeEventListener('message',this.listener);this.onclose?.();}
}

export class App {
  ontoolinput?: (params:any)=>void;ontoolresult?: (params:any)=>void;ontoolcancelled?: (params:any)=>void;
  onhostcontextchanged?: (context:McpUiHostContext)=>void;onclose?:()=>void;onteardown?:()=>Promise<object>;
  private transport?:AppTransport;private id=0;private pending=new Map<JsonRpcId,Pending>();
  private hostCapabilities:any;private hostContext:McpUiHostContext|undefined;
  constructor(private info:{name:string;version:string},private capabilities:any,private _options:any){}
  getHostCapabilities(){return this.hostCapabilities;}getHostContext(){return this.hostContext;}
  private removePending(id:JsonRpcId){
    const pending=this.pending.get(id);if(!pending)return;
    this.pending.delete(id);if(pending.timer!==undefined)clearTimeout(pending.timer);
    if(pending.signal&&pending.abort)pending.signal.removeEventListener('abort',pending.abort);
    return pending;
  }
  private rejectPending(message:string){for(const pending of [...this.pending.values()])pending.reject(new Error(message));}
  private request(method:string,params:any,options:RequestOptions={}){
    if(!this.transport)return Promise.reject(new Error('App is not connected'));
    if(options.signal?.aborted)return Promise.reject(new Error('Request aborted'));
    const id=++this.id,transport=this.transport;
    return new Promise<any>((resolve,reject)=>{
      const settle=(callback:(value:any)=>void,value:any)=>{const pending=this.removePending(id);if(pending)callback(value);};
      const entry:Pending={resolve:value=>settle(resolve,value),reject:error=>settle(reject,error),signal:options.signal};
      entry.abort=()=>entry.reject(new Error('Request aborted'));
      options.signal?.addEventListener('abort',entry.abort,{once:true});
      const timeout=options.maxTotalTimeout??options.timeout;
      if(timeout!==undefined&&timeout>0)entry.timer=setTimeout(()=>entry.reject(new Error(`${method} timed out`)),timeout);
      this.pending.set(id,entry);
      try{
        void Promise.resolve(transport.send({jsonrpc:'2.0',id,method,params}))
          .catch(()=>entry.reject(new Error('Transport send failed')));
      }catch{entry.reject(new Error('Transport send failed'));}
    });
  }
  private notify(method:string,params:any){
    if(!this.transport)return Promise.reject(new Error('App is not connected'));
    try{return Promise.resolve(this.transport.send({jsonrpc:'2.0',method,params}))
      .catch(()=>{throw new Error('Transport send failed');});}
    catch{return Promise.reject(new Error('Transport send failed'));}
  }
  private async reply(message:JsonRpcMessage){try{await this.transport?.send(message);}catch{/* the host transport is already unavailable */}}
  private async receive(message:JsonRpcMessage){
    if(message.id!==undefined&&!message.method){
      const pending=this.pending.get(message.id);if(!pending)return;
      if(message.error)pending.reject(new Error(typeof message.error.message==='string'?message.error.message:'Host request failed'));
      else pending.resolve(message.result);return;
    }
    const params=plainObject(message.params)?message.params:{};
    if(message.method&&message.id!==undefined){
      try{
        if(message.method==='ping'){await this.reply({jsonrpc:'2.0',id:message.id,result:{}});return;}
        if(message.method==='ui/resource-teardown'&&this.onteardown){
          const result=await this.onteardown();await this.reply({jsonrpc:'2.0',id:message.id,result});return;
        }
        await this.reply({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Method not found'}});
      }catch{await this.reply({jsonrpc:'2.0',id:message.id,error:{code:-32603,message:'Internal error'}});}
      return;
    }
    if(message.method==='ui/notifications/tool-input')this.ontoolinput?.(params);
    else if(message.method==='ui/notifications/tool-result')this.ontoolresult?.(params);
    else if(message.method==='ui/notifications/tool-cancelled')this.ontoolcancelled?.(params);
    else if(message.method==='ui/notifications/host-context-changed'){
      this.hostContext={...this.hostContext,...params};this.onhostcontextchanged?.(params);
    }
  }
  async connect(transport:AppTransport=new PostMessageTransport(),options:RequestOptions={}){
    if(this.transport)throw new Error('App is already connected');
    this.transport=transport;transport.onmessage=message=>void this.receive(message);
    transport.onclose=()=>{if(this.transport===transport)this.transport=undefined;this.rejectPending('Connection closed');this.onclose?.();};
    transport.onerror=()=>{this.rejectPending('Transport error');};
    try{
      await transport.start();
      const result=initializeResult(await this.request('ui/initialize',{
        appInfo:this.info,appCapabilities:this.capabilities,protocolVersion:UI_PROTOCOL_VERSION,
      },options));
      if(!result)throw new Error('Invalid initialize result or negotiated protocol');
      this.hostCapabilities=result.hostCapabilities;this.hostContext=result.hostContext;
      await this.notify('ui/notifications/initialized',{});
    }catch(error){await this.close();throw error;}
  }
  callServerTool(params:any,options?:RequestOptions){return this.request('tools/call',params,options);}
  sendMessage(params:any,options?:RequestOptions){return this.request('ui/message',params,options);}
  requestDisplayMode(params:any,options?:RequestOptions){return this.request('ui/request-display-mode',params,options);}
  sendSizeChanged(params:any){return this.notify('ui/notifications/size-changed',params);}
  async close(){
    const transport=this.transport;this.transport=undefined;this.rejectPending('Connection closed');
    if(transport)await transport.close();
  }
}
export function applyDocumentTheme(theme:'light'|'dark'){document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;}
export function applyHostStyleVariables(values:Record<string,string|undefined>){for(const [key,value] of Object.entries(values))if(value!==undefined)document.documentElement.style.setProperty(key,value);}
export function applyHostFonts(css:string){let style=document.getElementById('__mcp-host-fonts') as HTMLStyleElement|null;if(!style){style=document.createElement('style');style.id='__mcp-host-fonts';document.head.append(style);}style.textContent=css;}
