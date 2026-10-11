export type McpUiHostContext = {
  theme?:'light'|'dark';locale?:string;displayMode?:string;availableDisplayModes?:string[];
  styles?:{variables?:Record<string,string|undefined>;css?:{fonts?:string}};
  safeAreaInsets?:Record<string,number>;
};
type Message = {jsonrpc:'2.0';id?:string|number;method?:string;params?:any;result?:any;error?:any};
export class PostMessageTransport {
  onmessage?: (message:Message)=>void; onclose?:()=>void;
  private listener=(event:MessageEvent)=>{if(event.source!==this.source)return;const value=event.data;if(value&&value.jsonrpc==='2.0')this.onmessage?.(value);};
  constructor(private target:Window=window.parent,private source?:Window){ }
  async start(){window.addEventListener('message',this.listener);}
  async send(message:Message){this.target.postMessage(message,'*');}
  async close(){window.removeEventListener('message',this.listener);this.onclose?.();}
}
export class App {
  ontoolinput?: (params:any)=>void;ontoolresult?: (params:any)=>void;ontoolcancelled?: (params:any)=>void;
  onhostcontextchanged?: (context:McpUiHostContext)=>void;onclose?:()=>void;onteardown?:()=>Promise<object>;
  private transport?:PostMessageTransport;private id=0;private pending=new Map<string|number,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer?:ReturnType<typeof setTimeout>}>();
  private hostCapabilities:any;private hostContext:McpUiHostContext|undefined;
  constructor(private info:{name:string;version:string},private capabilities:any,private _options:any){ }
  getHostCapabilities(){return this.hostCapabilities;}getHostContext(){return this.hostContext;}
  private async request(method:string,params:any,options?:{signal?:AbortSignal;timeout?:number;maxTotalTimeout?:number;resetTimeoutOnProgress?:boolean}){
    if(!this.transport)throw new Error('App is not connected');const id=++this.id;
    return new Promise<any>((resolve,reject)=>{const entry={resolve,reject} as {resolve:(v:any)=>void;reject:(e:Error)=>void;timer?:ReturnType<typeof setTimeout>};
      const cancel=()=>{this.pending.delete(id);reject(new Error('Cancelled'));};
      options?.signal?.addEventListener('abort',cancel,{once:true});
      const timeout=options?.maxTotalTimeout??options?.timeout;if(timeout)entry.timer=setTimeout(cancel,timeout);this.pending.set(id,entry);
      void this.transport!.send({jsonrpc:'2.0',id,method,params});});
  }
  private notify(method:string,params:any){return this.transport?.send({jsonrpc:'2.0',method,params})??Promise.resolve();}
  async connect(transport:PostMessageTransport,options?:{signal?:AbortSignal;timeout?:number;maxTotalTimeout?:number}){
    this.transport=transport;transport.onmessage=message=>void this.receive(message);transport.onclose=()=>this.onclose?.();await transport.start();
    const result=await this.request('ui/initialize',{appInfo:this.info,appCapabilities:this.capabilities,protocolVersion:'2026-01-26'},options);
    this.hostCapabilities=result?.hostCapabilities;this.hostContext=result?.hostContext;await this.notify('ui/notifications/initialized',{});
  }
  private async receive(message:Message){
    if(message.id!==undefined&&!message.method){const pending=this.pending.get(message.id);if(!pending)return;this.pending.delete(message.id);clearTimeout(pending.timer);message.error?pending.reject(new Error('Host request failed')):pending.resolve(message.result);return;}
    const params=message.params??{};
    if(message.method==='ui/notifications/tool-input')this.ontoolinput?.(params);
    else if(message.method==='ui/notifications/tool-result')this.ontoolresult?.(params);
    else if(message.method==='ui/notifications/tool-cancelled')this.ontoolcancelled?.(params);
    else if(message.method==='ui/notifications/host-context-changed'){this.hostContext={...this.hostContext,...params};this.onhostcontextchanged?.(params);}
    else if(message.method==='ui/resource-teardown'&&message.id!==undefined){const result=await this.onteardown?.()??{};await this.transport?.send({jsonrpc:'2.0',id:message.id,result});}
  }
  callServerTool(params:any,options?:any){return this.request('tools/call',params,options);}
  sendMessage(params:any,options?:any){return this.request('ui/message',params,options);}
  requestDisplayMode(params:any,options?:any){return this.request('ui/request-display-mode',params,options);}
  sendSizeChanged(params:any){return this.notify('ui/notifications/size-changed',params);}
  async close(){for(const pending of this.pending.values())pending.reject(new Error('Closed'));this.pending.clear();await this.transport?.close();this.transport=undefined;}
}
export function applyDocumentTheme(theme:'light'|'dark'){document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;}
export function applyHostStyleVariables(values:Record<string,string|undefined>){for(const [key,value] of Object.entries(values))if(value!==undefined)document.documentElement.style.setProperty(key,value);}
export function applyHostFonts(css:string){let style=document.getElementById('__mcp-host-fonts') as HTMLStyleElement|null;if(!style){style=document.createElement('style');style.id='__mcp-host-fonts';document.head.append(style);}style.textContent=css;}
