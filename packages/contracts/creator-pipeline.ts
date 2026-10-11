import { z } from 'zod';
import { Id, Timestamp, result } from './index.ts';
import { ProfileScanRequest, CreatorAnalysis, CreatorUrl, TikTokImageUrl } from './creator-profile.ts';
import { CreatorDnaView } from './creator-operations.ts';
import type { RiffVideoRole, TrustedCatalogObservation } from './riff-videos.ts';

const text = (max: number) => z.string().trim().min(1).max(max);
const ReferenceMultiplierBasis = z.strictObject({
  method: z.literal('median_observed_profile_views'),
  baseline_views: z.number().finite().positive().max(Number.MAX_SAFE_INTEGER),
  sample_size: z.number().int().positive().max(170),
});
export const PipelineReference = z.strictObject({
  id: Id, platform: z.literal('tiktok'), native_id: text(200), url: CreatorUrl,
  retrieved_at: Timestamp, source_observed_at: Timestamp.nullable().optional(), published_at: Timestamp.nullable(),
  caption: z.string().max(10000).nullable(), views: z.number().int().nonnegative().nullable(),
  thumbnail_url: TikTokImageUrl.optional(), duration_seconds: z.number().positive().finite().nullable().optional(),
  likes: z.number().int().nonnegative().nullable().optional(),
  saves: z.number().int().nonnegative().nullable().optional(),
  view_multiplier: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  view_multiplier_basis: ReferenceMultiplierBasis.optional(),
  origin: z.enum(['fixture','live']), permission_basis: text(2000),
  limitations: z.array(text(1000)).max(20),
}).superRefine((reference, ctx) => {
  const hasMultiplier = reference.view_multiplier !== undefined;
  if (hasMultiplier !== (reference.view_multiplier_basis !== undefined) ||
      (hasMultiplier && reference.views === null)) {
    ctx.addIssue({ code: 'custom', message: 'A view multiplier requires observed views and an explicit baseline' });
  }
});
export const CreatorIdea = z.strictObject({
  id: Id, title: text(200), concept: text(3000), creator_fit: text(3000),
  evidence_summary: text(3000), execution: text(4000), reference_ids: z.array(Id).min(1).max(3),
  limitations: z.array(text(1000)).max(20),
});
export const RecommendationBatch = z.strictObject({
  id: Id, dna_id: Id, dna_version: z.number().int().positive(), created_at: Timestamp,
  references: z.array(PipelineReference).max(3), ideas: z.array(CreatorIdea).max(3),
  contains_fixture_data: z.boolean(), limitations: z.array(text(1000)).max(30),
}).superRefine((v,c)=>{
  const ids=new Set(v.references.map(r=>r.id));
  if(ids.size!==v.references.length || new Set(v.references.map(r=>r.native_id)).size!==v.references.length || new Set(v.ideas.map(i=>i.id)).size!==v.ideas.length)c.addIssue({code:'custom',message:'Duplicate reference or idea identity'});
  for(const idea of v.ideas)if(idea.reference_ids.some(id=>!ids.has(id)))c.addIssue({code:'custom',message:'Idea must cite batch evidence'});
  if(v.references.some(r=>r.origin==='fixture')&&!v.contains_fixture_data)c.addIssue({code:'custom',message:'Fixture origin must remain visible'});
});
export const TimedFilmingSegment = z.strictObject({
  part: z.enum(['hook', 'main_content', 'cta']),
  start_seconds: z.number().finite().nonnegative().max(180),
  end_seconds: z.number().finite().positive().max(180),
  spoken_text: text(4000), filming_direction: text(3000), on_screen_text: text(1000).optional(),
}).refine(segment => segment.end_seconds > segment.start_seconds, 'Timed segment must end after it starts');
const Hashtag = z.string().trim().regex(/^#[\p{L}\p{N}_]{1,100}$/u);
export const FilmingVariant = z.strictObject({
  id: Id, label: z.enum(['Reference-led','Creator Fit','Experimental']),
  hook: text(2000), opening_visual: text(2000), script: text(12000),
  shots: z.array(text(2000)).min(1).max(30), b_roll: z.array(text(2000)).max(30),
  on_screen_text: z.array(text(1000)).max(30), showcase_timing: text(1000),
  cta: text(2000), estimated_duration_seconds: z.number().positive().max(180), pacing: text(2000),
  timed_segments: z.array(TimedFilmingSegment).min(1).max(10).optional(),
  caption: text(3000).optional(), hashtags: z.array(Hashtag).max(30).optional(),
  reference_ids: z.array(Id).min(1).max(3), limitations: z.array(text(1000)).max(20),
});
export const CreatorScriptSet = z.strictObject({
  id: Id, batch_id: Id, idea_id: Id, dna_id: Id, dna_version: z.number().int().positive(),
  version: z.literal(1), created_at: Timestamp, variants: z.array(FilmingVariant).min(2).max(3),
  idea: CreatorIdea.optional(), references: z.array(PipelineReference).min(1).max(3).optional(),
  contains_fixture_data: z.boolean(), limitations: z.array(text(1000)).max(30),
}).superRefine((v,c)=>{
  if(new Set(v.variants.map(x=>x.id)).size!==v.variants.length || new Set(v.variants.map(x=>x.label)).size!==v.variants.length)c.addIssue({code:'custom',message:'Variants need unique IDs and labels'});
  if((v.idea===undefined)!==(v.references===undefined)){
    c.addIssue({code:'custom',message:'Studio idea and references must be persisted together'});return;
  }
  if(!v.idea||!v.references)return;
  const referenceIds=new Set(v.references.map(reference=>reference.id));
  const ideaReferenceIds=new Set(v.idea.reference_ids);
  if(v.idea.id!==v.idea_id)c.addIssue({code:'custom',message:'Studio idea must match the selected idea ID'});
  if(referenceIds.size!==v.references.length || new Set(v.references.map(reference=>reference.native_id)).size!==v.references.length ||
    ideaReferenceIds.size!==v.idea.reference_ids.length || referenceIds.size!==ideaReferenceIds.size ||
    [...ideaReferenceIds].some(id=>!referenceIds.has(id)))c.addIssue({code:'custom',message:'Studio references must exactly match selected idea evidence'});
  if(v.variants.some(variant=>variant.reference_ids.some(id=>!referenceIds.has(id))))c.addIssue({code:'custom',message:'Studio variants must cite selected idea evidence'});
  if(v.references.some(reference=>reference.origin==='fixture')&&!v.contains_fixture_data)c.addIssue({code:'custom',message:'Fixture origin must remain visible'});
});
export const StartCreatorScanInput = z.strictObject({project_id:Id,request_id:Id,scan:ProfileScanRequest,
  seed_url:CreatorUrl.optional(),
}).refine(v => v.scan.max_pages <= 2 && v.scan.max_videos <= 10, 'Development scan allows at most ten videos and two pages')
  .refine(v => !v.seed_url || new URL(v.seed_url).hostname.replace(/^www\./,'') === 'tiktok.com'
    && new URL(v.seed_url).pathname.startsWith(new URL(v.scan.supplied_url).pathname.replace(/\/$/,'') + '/video/')
    && /^\/@[\w.]+\/video\/\d{1,30}$/.test(new URL(v.seed_url).pathname), 'Seed video must belong to the requested profile');
export const StartCreatorRecommendationsInput = z.strictObject({dna_id:Id,expected_version:z.number().int().positive(),request_id:Id});
export const StartCreatorScriptsInput = z.strictObject({batch_id:Id,idea_id:Id,request_id:Id});
export const SaveCreatorScriptsInput = StartCreatorScriptsInput.extend({variants:z.array(FilmingVariant.omit({id:true})).min(2).max(3)});
export const GetCreatorJobInput = z.strictObject({job_id:Id});
export const GetCreatorJobStatusInput = z.strictObject({job_id:Id});
export const CreatorJobStage = z.enum(['accepted','reviewing_video','reading_profile','reading_posts',
  'building_analysis','researching_formats','enriching_references','saving']);
const progressText=(max:number)=>z.string().trim().min(1).max(max);
const progressCount=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
export const CreatorProgressProvenance=z.strictObject({
  origin:z.enum(['fixture','live']),retrieved_at:Timestamp,source_observed_at:Timestamp.nullable(),
  permission_basis:progressText(1000),limitations:z.array(progressText(500)).max(10),
});
export const CreatorProgressProfile=z.strictObject({
  platform:z.literal('tiktok'),native_id:progressText(200),url:CreatorUrl,handle:progressText(100),
  display_name:z.string().max(200).nullable(),bio:z.string().max(1000).nullable(),
  follower_count:progressCount,avatar_url:TikTokImageUrl.optional(),provenance:CreatorProgressProvenance,
});
export const CreatorProgressVideoCard=z.strictObject({
  platform:z.literal('tiktok'),native_id:progressText(200),url:CreatorUrl,
  caption:z.string().max(2000).nullable(),published_at:Timestamp.nullable(),
  duration_seconds:z.number().positive().finite().nullable(),thumbnail_url:TikTokImageUrl.optional(),
  metrics:z.strictObject({views:progressCount,likes:progressCount,comments:progressCount,shares:progressCount,
    saves:progressCount.optional()}),provenance:CreatorProgressProvenance,
});
export const CreatorProgressReferenceIdentity=z.strictObject({
  platform:z.literal('tiktok'),native_id:progressText(200),url:CreatorUrl,retrieved_at:Timestamp,
  origin:z.enum(['fixture','live']),permission_basis:progressText(1000),limitations:z.array(progressText(500)).max(10),
});
const ScanProgress=z.strictObject({kind:z.literal('scan'),profile:CreatorProgressProfile.nullable(),
  videos:z.array(CreatorProgressVideoCard).max(10),limitations:z.array(progressText(500)).max(20),
}).superRefine((progress,context)=>{
  const identities=progress.videos.map(video=>`${video.platform}:${video.native_id}`);
  if(new Set(identities).size!==identities.length)context.addIssue({code:'custom',message:'Progress videos must be unique'});
  if(progress.profile&&progress.videos.some(video=>new URL(video.url).pathname.split('/video/')[0]!==new URL(progress.profile!.url).pathname.replace(/\/$/,'')))
    context.addIssue({code:'custom',message:'Progress videos must belong to the displayed profile'});
});
const RecommendationProgress=z.strictObject({kind:z.literal('recommendations'),
  identities:z.array(CreatorProgressReferenceIdentity).max(3),references:z.array(CreatorProgressVideoCard).max(3),
  limitations:z.array(progressText(500)).max(20),
}).superRefine((progress,context)=>{
  const identityKeys=progress.identities.map(value=>`${value.platform}:${value.native_id}:${value.url}`);
  const referenceKeys=progress.references.map(value=>`${value.platform}:${value.native_id}:${value.url}`);
  if(new Set(identityKeys).size!==identityKeys.length||new Set(referenceKeys).size!==referenceKeys.length)
    context.addIssue({code:'custom',message:'Recommendation progress identities must be unique'});
  if(referenceKeys.some((key,index)=>identityKeys[index]!==key))
    context.addIssue({code:'custom',message:'Enriched references must be an ordered prefix of identified references'});
});
const ScriptProgress=z.strictObject({kind:z.literal('scripts'),limitations:z.array(progressText(500)).max(20)});
export const CreatorJobProgress=z.discriminatedUnion('kind',[ScanProgress,RecommendationProgress,ScriptProgress]);
export const emptyCreatorJobProgress=(kind:'scan'|'recommendations'|'scripts'):z.infer<typeof CreatorJobProgress>=>
  kind==='scan'?{kind,profile:null,videos:[],limitations:[]}:
    kind==='recommendations'?{kind,identities:[],references:[],limitations:[]}:{kind,limitations:[]};
const allowedStages={
  scan:['accepted','reviewing_video','reading_profile','reading_posts','building_analysis','saving'],
  recommendations:['accepted','researching_formats','enriching_references','saving'],
  scripts:['accepted','building_analysis','saving'],
} as const;
export const CreatorJobView = z.strictObject({
  id:Id,project_id:Id,revision:z.number().int().positive(),kind:z.enum(['scan','recommendations','scripts']),
  source_kind:z.enum(['video','profile']).optional(),
  state:z.enum(['queued','running','succeeded','failed','needs_reconciliation']),
  stage:CreatorJobStage,progress:CreatorJobProgress,created_at:Timestamp,updated_at:Timestamp,
  result:z.discriminatedUnion('kind',[
    z.strictObject({kind:z.literal('scan'),dna:CreatorDnaView}),
    z.strictObject({kind:z.literal('recommendations'),batch:RecommendationBatch}),
    z.strictObject({kind:z.literal('scripts'),scripts:CreatorScriptSet}),
  ]).nullable(),
  message:text(1000).nullable(),
}).superRefine((job, context) => {
  if ((job.state === 'succeeded') !== (job.result !== null)) {
    context.addIssue({ code: 'custom', message: 'Only succeeded jobs have a result' });
  }
  if (job.result && job.result.kind !== job.kind) {
    context.addIssue({ code: 'custom', message: 'Job and result kinds must match' });
  }
  if (job.source_kind !== undefined && job.kind !== 'scan') {
    context.addIssue({ code: 'custom', message: 'Only scan jobs can expose a source kind' });
  }
  if (job.result?.kind === 'scan' && job.result.dna.project_id !== job.project_id) {
    context.addIssue({ code: 'custom', message: 'Scan result must belong to the job project' });
  }
  if(job.progress.kind!==job.kind||!allowedStages[job.kind].includes(job.stage as never))
    context.addIssue({code:'custom',message:'Job kind, stage and progress must agree'});
  if(job.kind==='scan'&&job.source_kind==='profile'&&job.stage==='reviewing_video')
    context.addIssue({code:'custom',message:'Profile scans do not review a supplied video'});
  if(job.state==='queued'&&(job.stage!=='accepted'||JSON.stringify(job.progress)!==JSON.stringify(emptyCreatorJobProgress(job.kind))))
    context.addIssue({code:'custom',message:'Queued jobs begin with empty accepted progress'});
  if(job.state==='succeeded'&&job.stage!=='saving')
    context.addIssue({code:'custom',message:'Succeeded jobs have reached saving'});
});
export const CreatorJobOutput=result(z.strictObject({job:CreatorJobView}));
export const CreatorJobStatusView=z.strictObject({
  id:Id,kind:z.enum(['scan','recommendations','scripts']),
  state:z.enum(['queued','running','succeeded','failed','needs_reconciliation']),
  stage:CreatorJobStage,revision:z.number().int().positive(),created_at:Timestamp,updated_at:Timestamp,
  progress:CreatorJobProgress,terminal_result_available:z.boolean(),
}).superRefine((status,context)=>{
  if(status.progress.kind!==status.kind||!allowedStages[status.kind].includes(status.stage as never))
    context.addIssue({code:'custom',message:'Status kind, stage and progress must agree'});
  if(status.terminal_result_available!==(status.state==='succeeded'))
    context.addIssue({code:'custom',message:'Terminal result availability must match successful state'});
  if(status.state==='queued'&&(status.stage!=='accepted'||JSON.stringify(status.progress)!==JSON.stringify(emptyCreatorJobProgress(status.kind))))
    context.addIssue({code:'custom',message:'Queued status begins with empty accepted progress'});
  if(status.state==='succeeded'&&status.stage!=='saving')
    context.addIssue({code:'custom',message:'Successful status has reached saving'});
});
export const CreatorJobStatusOutput=result(z.strictObject({status:CreatorJobStatusView}));
export const pipelineContracts={
  start_creator_scan:{input:StartCreatorScanInput,output:CreatorJobOutput,scope:'projects:write',readOnly:false},
  start_creator_recommendations:{input:StartCreatorRecommendationsInput,output:CreatorJobOutput,scope:'projects:write',readOnly:false},
  start_creator_scripts:{input:StartCreatorScriptsInput,output:CreatorJobOutput,scope:'projects:write',readOnly:false},
  save_creator_scripts:{input:SaveCreatorScriptsInput,output:CreatorJobOutput,scope:'projects:write',readOnly:false},
  get_creator_job:{input:GetCreatorJobInput,output:CreatorJobOutput,scope:'projects:read',readOnly:true},
  get_creator_job_status:{input:GetCreatorJobStatusInput,output:CreatorJobStatusOutput,scope:'projects:read',readOnly:true},
} as const;
export type PipelineOperation=keyof typeof pipelineContracts;
export type RecommendationBatch=z.infer<typeof RecommendationBatch>;
export type CreatorScriptSet=z.infer<typeof CreatorScriptSet>;
export type CreatorJobView=z.infer<typeof CreatorJobView>;
export type CreatorJobStatusView=z.infer<typeof CreatorJobStatusView>;
export type CreatorJobProgress=z.infer<typeof CreatorJobProgress>;
export type CreatorJobStage=z.infer<typeof CreatorJobStage>;
export type CreatorProgressProfile=z.infer<typeof CreatorProgressProfile>;
export type CreatorProgressVideoCard=z.infer<typeof CreatorProgressVideoCard>;
export type CreatorProgressReferenceIdentity=z.infer<typeof CreatorProgressReferenceIdentity>;
export type PipelineReference=z.infer<typeof PipelineReference>;

/** Trusted provider seam. Values are persisted by the lead runner, never public input. */
export interface CreatorProviderContext {
  now():string;
  newId():string;
  /** Every external request, including polling, must pass through this durable guard.
   * key is stable within the job. The guard reserves configured ceilings before I/O,
   * replays recorded successes and blocks ambiguous attempts. No provider retries. */
  call(key:string,provider:'scrapecreators'|'lightreel'|'openai',operation:'profile'|'feed'|'research'|'poll'|'video'|'generate',execute:()=>Promise<unknown>):Promise<unknown>;
  /** Persist a validated public display snapshot. This never reserves provider allowance. */
  checkpoint(key:string,stage:CreatorJobStage,progress:CreatorJobProgress):Promise<void>;
  /** Publish only the original validated safe observation after its matching checkpoint is durable. */
  ingestCatalog(checkpointKey:string,role:RiffVideoRole,observations:readonly TrustedCatalogObservation[]):Promise<void>;
}
export interface CreatorPipelineProvider {
  scan(request:z.infer<typeof ProfileScanRequest>,context:CreatorProviderContext):Promise<z.infer<typeof CreatorAnalysis>>;
  recommend(dna: z.infer<typeof CreatorDnaView>,context:CreatorProviderContext):Promise<RecommendationBatch>;
  generate(input:{batch:RecommendationBatch;idea_id:string;dna:z.infer<typeof CreatorDnaView>},context:CreatorProviderContext):Promise<CreatorScriptSet>;
}
