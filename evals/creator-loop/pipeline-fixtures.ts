import { RecommendationBatch, CreatorScriptSet, CreatorJobView, emptyCreatorJobProgress } from '../../packages/contracts/creator-pipeline.ts';
import { creatorDnaViewFixture } from './dna-view-fixtures.ts';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export function recommendationBatchFixture(){
 const dna=creatorDnaViewFixture();
 return RecommendationBatch.parse({id:id(600),dna_id:dna.dna_id,dna_version:dna.version,created_at:dna.created_at,
  references:[{id:id(601),platform:'tiktok',native_id:'9000000000000000011',url:'https://www.tiktok.com/@fictional_kettle_creator/video/9000000000000000011',retrieved_at:dna.created_at,published_at:dna.created_at,caption:'Fictional desk demonstration',views:120,origin:'fixture',permission_basis:'Authored fictional fixture',limitations:['No real performance evidence.']}],
  ideas:[{id:id(602),title:'One useful desk change',concept:'Demonstrate one practical change to a small desk.',creator_fit:'Fits the fictional desk demonstration context.',evidence_summary:'An authored reference demonstrates the format; this is not live research.',execution:'Open on the crowded desk, show one change, then reveal the result.',reference_ids:[id(601)],limitations:['No predicted performance.']}],
  contains_fixture_data:true,limitations:['Authored fixture; no provider call.']});
}
export function creatorScriptsFixture(){
 const batch=recommendationBatchFixture();
 return CreatorScriptSet.parse({id:id(603),batch_id:batch.id,idea_id:batch.ideas[0]!.id,dna_id:batch.dna_id,dna_version:batch.dna_version,version:1,created_at:batch.created_at,
 variants:['Reference-led','Creator Fit'].map((label,i)=>({id:id(610+i),label,hook:'One small change for this desk.',opening_visual:'Wide shot of the fictional desk.',script:'Here is my current setup. I move one item to make room. Here is the result.',shots:['Wide setup','Close-up of the change','Final wide shot'],b_roll:['Hand placing the item'],on_screen_text:['One desk change'],showcase_timing:'Show the change at approximately 5 seconds.',cta:'What would you change on your desk?',estimated_duration_seconds:20,pacing:'Three steady shots; timing is an estimate.',reference_ids:[batch.references[0]!.id],limitations:['Fictional example, no verified performance claim.']})),contains_fixture_data:true,limitations:['Authored scripts, not live model output.']});
}
export function creatorJobFixture(kind:'scan'|'recommendations'|'scripts'='recommendations'){
 const dna=creatorDnaViewFixture();
 return CreatorJobView.parse({id:id(620),project_id:dna.project_id,revision:2,kind,state:'succeeded',stage:'saving',progress:emptyCreatorJobProgress(kind),created_at:dna.created_at,updated_at:dna.created_at,message:null,
 ...(kind==='scan'?{source_kind:'profile' as const}:{}),
 result:kind==='scan'?{kind,dna}:kind==='recommendations'?{kind,batch:recommendationBatchFixture()}:{kind,scripts:creatorScriptsFixture()}});
}
