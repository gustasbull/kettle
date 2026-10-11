import test from 'node:test';
import assert from 'node:assert/strict';
import { createRiffVideoOperations, encodeRiffVideoCursor, riffVideoCatalogInput,
  type RiffVideoRepository } from '../packages/application/riff-videos.ts';
import { failure, type IdentityVerifier } from '../packages/application/operations.ts';
import { TrustedCatalogObservation } from '../packages/contracts/riff-videos.ts';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const account=id(1),project=id(2),observation=id(3);
const card={id:observation,platform:'tiktok',native_id:'9001',canonical_url:'https://www.tiktok.com/@fixture/video/9001',caption:null,
  thumbnail_url:null,published_at:null,duration_seconds:null,metrics:{views:0,likes:null,comments:null,shares:null,saves:null},
  retrieved_at:'2026-10-11T09:10:43.000Z',source_observed_at:null,observed_at:'2026-10-11T09:10:44.000Z',origin:'live',role:'own_profile',
  permission_basis:'Approved.',limitations:['Metadata only.']};
const ok={ok:true,data:{cards:[card],next_position:null}};

function harness(verifier:IdentityVerifier={async verify(){return {account_id:account,scopes:['projects:read']};}},reply:unknown=ok){
  const calls:any[]=[];const repository:RiffVideoRepository={async list(owner,input){calls.push({owner,input});return reply;},async ingest(){throw Error('public must not ingest');}};
  return {calls,operations:createRiffVideoOperations(verifier,repository)};
}
test('list authenticates, scopes, validates and applies exact provider-free defaults',async()=>{
  for(const [credential,verifier,code] of [[null,{async verify(){return null;}},'UNAUTHENTICATED'],['x',{async verify(){throw Error('x');}},'UNAUTHENTICATED'],['x',{async verify(){return {account_id:'bad',scopes:['projects:read']};}},'UNAUTHENTICATED'],['x',{async verify(){return {account_id:account,scopes:[]};}},'FORBIDDEN']] as const){
    const h=harness(verifier);assert.deepEqual(await h.operations.execute('list_riff_videos',credential,{}),failure(code));assert.equal(h.calls.length,0);
  }
  const h=harness();const result=await h.operations.execute('list_riff_videos','token',{});assert.equal(result.ok,true);
  assert.deepEqual(h.calls,[{owner:account,input:{project_id:null,role:null,sort:'observed_at_desc',after:null,limit:8}}]);
  if(result.ok){assert.match(result.data.coverage,/saved permitted metadata/i);assert.match(result.data.coverage,/no provider refresh/i);assert.match(result.data.freshness,/source observation time.*unknown/i);}
});

test('cursor mismatch and malformed storage fail closed without exposing owner data',async()=>{
  const cursor=encodeRiffVideoCursor({v:1,sort:'observed_at_desc',observed_at:card.observed_at,id:observation,project_id:project,role:null});
  const h=harness();assert.deepEqual(await h.operations.execute('list_riff_videos','token',{cursor}),failure('VALIDATION_ERROR'));assert.equal(h.calls.length,0);
  const bad=harness(undefined,{ok:true,data:{cards:[{...card,account_id:account}],next_position:null}});
  assert.deepEqual(await bad.operations.execute('list_riff_videos','token',{}),failure('UNAVAILABLE'));
});

test('recommendation catalog input binds its detail key to the one admitted native video',()=>{
  const trusted=TrustedCatalogObservation.parse(Object.fromEntries(
    Object.entries(card).filter(([key])=>!['observed_at','role'].includes(key))));
  const job={id:id(4),account_id:account,kind:'recommendations' as const};
  assert.throws(()=>riffVideoCatalogInput(job,'recommend:detail:different','discovered_reference',[trusted]),
    /Invalid catalog source/);
  assert.doesNotThrow(()=>riffVideoCatalogInput(job,'recommend:detail:9001','discovered_reference',[trusted]));
});
