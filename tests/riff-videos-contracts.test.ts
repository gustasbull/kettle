import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ListRiffVideosInput, RiffVideoCard, ListRiffVideosOutput,
  trustedCatalogObservation,
} from '../packages/contracts/riff-videos.ts';
import { decodeRiffVideoCursor, encodeRiffVideoCursor } from '../packages/application/riff-videos.ts';
import { creatorAnalysisFixture } from '../packages/contracts/fixtures/creator-profile.ts';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const card={
  id:id(1),platform:'tiktok' as const,native_id:'9001',canonical_url:'https://www.tiktok.com/@fixture/video/9001',
  caption:null,thumbnail_url:null,published_at:null,duration_seconds:null,
  metrics:{views:0,likes:null,comments:null,shares:null,saves:null},
  retrieved_at:'2026-10-11T09:10:43.000Z',source_observed_at:null,
  observed_at:'2026-10-11T09:10:44.000Z',origin:'live' as const,role:'own_profile' as const,
  permission_basis:'Approved fixture retention.',limitations:['Metadata only.'],
};

test('Riff video public input and cards are strict, bounded and null preserving',()=>{
  assert.deepEqual(ListRiffVideosInput.parse({}),{});
  for(const bad of [{account_id:id(9)},{refresh:true},{provider:'x'},{limit:0},{limit:21},{limit:1.5},{sort:'popular'},{role:'other'}])
    assert.equal(ListRiffVideosInput.safeParse(bad).success,false,JSON.stringify(bad));
  assert.deepEqual(RiffVideoCard.parse(card),card);
  for(const key of ['caption','thumbnail_url','published_at','duration_seconds'] as const){const value={...card};delete (value as any)[key];assert.equal(RiffVideoCard.safeParse(value).success,false,key);}
  assert.equal(RiffVideoCard.safeParse({...card,canonical_url:'https://example.com/video/9001'}).success,false);
  assert.equal(RiffVideoCard.safeParse({...card,thumbnail_url:'http://127.0.0.1/private'}).success,false);
  assert.equal(RiffVideoCard.safeParse({...card,duration_seconds:86401}).success,false);
  assert.equal(RiffVideoCard.safeParse({...card,metrics:{...card.metrics,views:Number.MAX_SAFE_INTEGER+1}}).success,false);
  assert.equal(ListRiffVideosOutput.safeParse({ok:true,data:{cards:Array(21).fill(card),next_cursor:null,coverage:'saved',freshness:'known'}}).success,false);
});

test('trusted mapper preserves original null/zero/source time and fails closed on provenance rights',()=>{
  const original=creatorAnalysisFixture().scan.video_observations[0]!;
  const live={...original,provenance:{...original.provenance,origin:'live' as const,source_observed_at:null,
    permission:{...original.provenance.permission,status:'approved' as const,permitted_uses:['store','display'] as ('store'|'display')[]}}};
  const mapped=trustedCatalogObservation(live,['Exact safe caveat.']);
  assert.equal(mapped.metrics.likes,original.metrics.likes);assert.equal(mapped.source_observed_at,null);
  assert.deepEqual(mapped.limitations,['Exact safe caveat.']);
  assert.throws(()=>trustedCatalogObservation(original,[]),/permission/i);
  assert.throws(()=>trustedCatalogObservation({...live,provenance:{...live.provenance,permission:{...live.provenance.permission,permitted_uses:['store']}}},[]),/permission/i);
});

test('cursor is canonical unpadded base64url and bound to filters but not limit',()=>{
  const position={v:1 as const,sort:'observed_at_desc' as const,observed_at:card.observed_at,id:card.id,project_id:id(7),role:'own_profile' as const};
  const token=encodeRiffVideoCursor(position);
  assert.match(token,/^[A-Za-z0-9_-]+$/);assert.doesNotMatch(token,/=/);
  assert.deepEqual(decodeRiffVideoCursor(token,{project_id:id(7),role:'own_profile',sort:'observed_at_desc'}),position);
  assert.doesNotMatch(Buffer.from(token,'base64url').toString(),/account|caption|native_id|canonical_url/);
  for(const invalid of [`${token}=`,token+'!',Buffer.from('{"v":2}').toString('base64url'),'A'.repeat(1025)])
    assert.throws(()=>decodeRiffVideoCursor(invalid,{project_id:id(7),role:'own_profile',sort:'observed_at_desc'}));
  assert.throws(()=>decodeRiffVideoCursor(token,{project_id:null,role:'own_profile',sort:'observed_at_desc'}));
  assert.throws(()=>decodeRiffVideoCursor(token,{project_id:id(7),role:null,sort:'observed_at_desc'}));
});
