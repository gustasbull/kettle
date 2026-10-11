import test from 'node:test';
import assert from 'node:assert/strict';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { parseStrictCallToolResult } from '../../apps/panel/call-tool-result-validation.ts';

const nullRecord=(value:Record<string,unknown>)=>Object.assign(Object.create(null),value);
const envelope=()=>({
  structuredContent:{ok:true,data:{values:[null,true,1,'ordinary JSON']}},
  isError:false,
  content:[
    {type:'text',text:'Ready.',annotations:{audience:['assistant'],priority:0}},
    {type:'image',data:'aW1hZ2U=',mimeType:'image/png'},
    {type:'audio',data:'YXVkaW8=',mimeType:'audio/mpeg'},
    {type:'resource_link',name:'result',uri:'ui://riff/result',icons:[{src:'https://example.com/icon.png',theme:'light'}]},
    {type:'resource',resource:{uri:'ui://riff/detail',text:'Detail',mimeType:'text/plain',_meta:{safe:true}}},
  ],
  _meta:{trace:{sampled:false,tags:['strict']}},
});

test('strict CallToolResult parsing preserves valid content and returns a detached ordinary JSON result',()=>{
  const raw=envelope();
  const parsed=parseStrictCallToolResult(raw);
  assert.deepEqual(parsed,{structuredContent:raw.structuredContent,isError:false});
  assert.notEqual(parsed?.structuredContent,raw.structuredContent);
  assert.notEqual((parsed?.structuredContent.data as {values:unknown[]}).values,raw.structuredContent.data.values);
  assert.equal(Object.getPrototypeOf(parsed?.structuredContent),Object.prototype);
});

test('strict CallToolResult parsing preserves isError presence without interpreting arbitrary structured content',()=>{
  const absent=parseStrictCallToolResult({structuredContent:{ok:true},content:[]});
  const explicitFalse=parseStrictCallToolResult({structuredContent:{ok:false},content:[],isError:false});
  const explicitTrue=parseStrictCallToolResult({structuredContent:{ok:true},content:[],isError:true});
  assert.deepEqual(absent,{structuredContent:{ok:true}});
  assert.deepEqual(explicitFalse,{structuredContent:{ok:false},isError:false});
  assert.deepEqual(explicitTrue,{structuredContent:{ok:true},isError:true});
});

test('strict CallToolResult parsing rejects proxy and non-ordinary JSON before cloning without invoking getters',()=>{
  let getterReads=0;
  const accessor=Object.defineProperty({},'value',{enumerable:true,get(){getterReads++;return 'unsafe';}});
  const hidden=Object.defineProperty({},'value',{enumerable:false,value:'hidden'});
  const symbol={value:'visible',[Symbol('hidden')]:'unsafe'};
  const custom=Object.assign(Object.create({inherited:true}),{value:'unsafe'});
  const nullPrototype=nullRecord({value:'unsafe'});
  const sparse=new Array(1);
  const accessorArray:unknown[]=[];
  Object.defineProperty(accessorArray,'0',{enumerable:true,get(){getterReads++;return 'unsafe';}});
  const customArray=['unsafe'];Object.setPrototypeOf(customArray,Object.create(Array.prototype));
  const proxyObject=new Proxy({value:'unsafe'},{});
  const proxyArray=new Proxy(['unsafe'],{});
  const throwingPrototype=new Proxy(envelope(),{getPrototypeOf(){throw new Error('hostile prototype trap');}});
  const throwingKeys=new Proxy(envelope(),{ownKeys(){throw new Error('hostile ownKeys trap');}});
  const throwingDescriptor=new Proxy(envelope(),{
    getOwnPropertyDescriptor(){throw new Error('hostile descriptor trap');},
  });
  const nestedThrowingProxy=new Proxy({ok:true},{ownKeys(){throw new Error('hostile nested trap');}});
  const valid=envelope();
  const cases:Array<[string,unknown]>=[
    ['top-level proxy',new Proxy(valid,{})],
    ['throwing prototype proxy',throwingPrototype],
    ['throwing keys proxy',throwingKeys],
    ['throwing descriptor proxy',throwingDescriptor],
    ['top-level null prototype',nullRecord(valid)],
    ['structured-content proxy',{...valid,structuredContent:new Proxy(valid.structuredContent,{})}],
    ['nested throwing proxy',{...valid,structuredContent:nestedThrowingProxy}],
    ['structured-content null prototype',{...valid,structuredContent:nullRecord(valid.structuredContent)}],
    ...([accessor,hidden,symbol,custom,nullPrototype,sparse,accessorArray,customArray,proxyObject,proxyArray]
      .map((value,index)=>[`nested hostile value ${index}`,{structuredContent:{ok:true,data:{value}}}] as [string,unknown])),
  ];
  for(const [label,raw] of cases)
    assert.equal(parseStrictCallToolResult(raw),undefined,label);
  assert.equal(getterReads,0,'descriptor validation must never execute object or array getters');
});

test('content-block details match the installed MCP CallToolResult schema',()=>{
  const valid=[
    {type:'text',text:'zero',annotations:{priority:0,lastModified:'2026-10-11T12:00:00Z'}},
    {type:'text',text:'one',annotations:{priority:1,lastModified:'2026-10-11T14:00:00+02:00'}},
    {type:'image',data:'aW1hZ2U=',mimeType:'image/png'},
    {type:'audio',data:'YWJj',mimeType:'audio/mpeg'},
    {type:'resource',resource:{uri:'ui://riff/blob',blob:'YQ=='}},
    {type:'resource_link',name:'negative size',uri:'ui://riff/negative',size:-1},
    {type:'resource_link',name:'fractional size',uri:'ui://riff/fractional',size:1.5},
  ];
  const invalid=[
    {type:'text',text:'low',annotations:{priority:-0.1}},
    {type:'text',text:'high',annotations:{priority:1.1}},
    {type:'text',text:'date',annotations:{lastModified:'yesterday'}},
    {type:'image',data:'***',mimeType:'image/png'},
    {type:'audio',data:'!',mimeType:'audio/mpeg'},
    {type:'resource',resource:{uri:'ui://riff/blob',blob:'not base64!'}},
    {type:'resource_link',name:'infinite size',uri:'ui://riff/infinite',size:Infinity},
  ];
  for(const [index,block] of valid.entries()){
    const raw={structuredContent:{ok:true},content:[block]};
    assert.equal(CallToolResultSchema.safeParse(raw).success,true,`SDK valid ${index}`);
    assert.ok(parseStrictCallToolResult(raw),`shared validator valid ${index}`);
  }
  for(const [index,block] of invalid.entries()){
    const raw={structuredContent:{ok:true},content:[block]};
    assert.equal(CallToolResultSchema.safeParse(raw).success,false,`SDK invalid ${index}`);
    assert.equal(parseStrictCallToolResult(raw),undefined,`shared validator invalid ${index}`);
  }
});
