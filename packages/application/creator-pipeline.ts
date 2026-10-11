import { z } from 'zod';
import { Id, Timestamp, result } from '../contracts/index.ts';
import { CreatorJobView, CreatorJobOutput, pipelineContracts, RecommendationBatch, CreatorScriptSet,
  FilmingVariant, type PipelineOperation, type CreatorProviderContext, type CreatorPipelineProvider } from '../contracts/creator-pipeline.ts';
import { CreatorAnalysis, ProfileScanRequest } from '../contracts/creator-profile.ts';
import { StoredCreatorAnalysis } from '../contracts/creator-operations.ts';
import { failure, type IdentityVerifier } from './operations.ts';
import { projectCreatorDna, createCreatorIngestion, type CreatorRepository } from './creator-operations.ts';

export type PipelineRepositoryOperation = PipelineOperation | 'run_creator_job' | 'finish_creator_job'
  | 'reserve_creator_attempt' | 'complete_creator_attempt' | 'list_creator_dispatches';
export interface PipelineRepository { call(operation: PipelineRepositoryOperation, accountId: string, input: unknown): Promise<unknown> }
export const StoredCreatorJob = z.object({
  id:Id, account_id:Id, project_id:Id, request_id:Id, kind:z.enum(['scan','recommendations','scripts']),
  state:z.enum(['queued','running','succeeded','failed','needs_reconciliation']),revision:z.number().int().positive(),
  created_at:Timestamp,updated_at:Timestamp,input:z.record(z.string(),z.unknown()),captured:z.unknown(),
  result:CreatorJobView.shape.result,message:z.string().nullable(),
});
export type StoredCreatorJob = z.infer<typeof StoredCreatorJob>;
export const StoredCreatorJobOutput = result(z.object({job:StoredCreatorJob}));
export function publicCreatorJob(job:StoredCreatorJob):CreatorJobView {
  return CreatorJobView.parse({id:job.id,project_id:job.project_id,kind:job.kind,state:job.state,
    revision:job.revision,created_at:job.created_at,updated_at:job.updated_at,result:job.result,
    message:job.state==='needs_reconciliation'?'A provider request needs review before another attempt. No automatic resubmission.':
      job.state==='failed'?'This job could not complete. Check the research allowance and source permissions before starting a new request.':null});
}
export function createPipelineOperations(verifier:IdentityVerifier, repository:PipelineRepository,
  dispatch:(jobId:string,accountId:string)=>Promise<void>,isEnabled:(operation:PipelineOperation)=>boolean=()=>true) {
  return {async execute(operation:PipelineOperation, credential:string|null, raw:unknown) {
    if(!credential)return failure('UNAUTHENTICATED');
    let identity;try{identity=await verifier.verify(credential);}catch{return failure('UNAUTHENTICATED');}
    if(!identity||!Id.safeParse(identity.account_id).success)return failure('UNAUTHENTICATED');
    const contract=pipelineContracts[operation];
    if(!identity.scopes.includes(contract.scope))return failure('FORBIDDEN');
    const parsed=contract.input.safeParse(raw);if(!parsed.success)return failure('VALIDATION_ERROR');
    if(operation!=='get_creator_job'&&!isEnabled(operation)){const unavailable=failure('UNAVAILABLE');unavailable.error.message='Creator research is not enabled yet. Provider configuration or a test allocation is still required.';return unavailable;}
    try {
      const response=StoredCreatorJobOutput.parse(await repository.call(operation,identity.account_id,parsed.data));
      if(!response.ok)return failure(response.error.code);
      const job=response.data.job;
      if(job.account_id!==identity.account_id || ('job_id' in parsed.data && job.id!==parsed.data.job_id)
        || ('project_id' in parsed.data && job.project_id!==parsed.data.project_id)
        || ('request_id' in parsed.data && job.request_id!==parsed.data.request_id))return failure('UNAVAILABLE');
      if(operation!=='get_creator_job'&&job.kind!==(operation==='save_creator_scripts'?'scripts':operation.replace('start_creator_','')))return failure('UNAVAILABLE');
      const publicOutput=CreatorJobOutput.parse({ok:true,data:{job:publicCreatorJob(job)}});
      // Intent is already durable. A dispatch gap is reconciled by the scheduled outbox.
      if(operation!=='get_creator_job'&&job.state==='queued')try{await dispatch(job.id,job.account_id);}catch{/* durable queued intent */}
      return publicOutput;
    }catch{return failure('UNAVAILABLE');}
  }};
}
// These codes contain only adapter enums and an HTTP status, never raw response text.
const providerDiagnosticPattern = 'creator_provider_(?:transport|malformed|permission|unavailable)(?:_(?:timeout|network|oversized|malformed|http))?(?:_[1-5][0-9]{2})?';
const providerDiagnosticExact = new RegExp(`^${providerDiagnosticPattern}$(?![\\s\\S])`);
const wrappedProviderDiagnostic = new RegExp(`(?:^|[\\s:(])creator_attempt_needs_reconciliation:(${providerDiagnosticPattern})(?=$|[\\s)'\",])`);
function safeProviderDiagnostic(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  if (providerDiagnosticExact.test(error.message)) return error.message;
  // Workflow step failures may wrap our sanitized error and erase its class/properties.
  // Extract only the exact enum code following our own reconciliation marker.
  return wrappedProviderDiagnostic.exec(error.message)?.[1];
}
export class PipelineRunError extends Error {
  readonly diagnostic: string | undefined;
  constructor(readonly state:'failed'|'needs_reconciliation', diagnostic?:string){
    const safe=typeof diagnostic==='string'&&providerDiagnosticExact.test(diagnostic)?diagnostic:undefined;
    super((state==='failed'?'creator_job_blocked':'creator_attempt_needs_reconciliation')+(safe?`:${safe}`:''));
    this.diagnostic=safe;
  }
}
export type AttemptCeilings = Record<'scrapecreators'|'lightreel'|'openai',number>;
export type DurableStep = <T>(name:string,run:()=>Promise<T>)=>Promise<T>;
export function createGuardedProviderContext(repository:PipelineRepository,job:StoredCreatorJob,
  ceilings:AttemptCeilings, durableStep:DurableStep):CreatorProviderContext {
  return {now:()=>new Date().toISOString(),newId:()=>crypto.randomUUID(),
    async call(key,provider,operation,execute) {
      if(!/^[\w:-]{1,200}$/.test(key)||!Number.isSafeInteger(ceilings[provider])||ceilings[provider]<0)throw new PipelineRunError('failed');
      // One provider request per step. Database reservation is authoritative even if
      // Workflow persistence fails, retries overlap, or the process dies after dispatch.
      return durableStep(`provider:${key}`,async()=>{
        const reservation=z.object({ok:z.literal(true),data:z.object({status:z.enum(['acquired','replay','ambiguous']),receipt:z.unknown().optional()})})
          .safeParse(await repository.call('reserve_creator_attempt',job.account_id,{job_id:job.id,key,provider,operation,ceiling_microusd:ceilings[provider]}));
        if(!reservation.success)throw new PipelineRunError('failed');
        if(reservation.data.data.status==='replay')return reservation.data.data.receipt;
        if(reservation.data.data.status==='ambiguous')throw new PipelineRunError('needs_reconciliation');
        try {
          const receipt=await execute();
          if(new TextEncoder().encode(JSON.stringify(receipt)).length>300_000)throw new Error('receipt bound');
          const saved=z.object({ok:z.literal(true),data:z.object({status:z.literal('completed'),receipt:z.unknown()})})
            .parse(await repository.call('complete_creator_attempt',job.account_id,{job_id:job.id,key,receipt}));
          return saved.data.receipt;
        }catch(error){throw new PipelineRunError('needs_reconciliation',safeProviderDiagnostic(error));}
      });
    }};
}
/** Verify the exact captured view against retained evidence before any external processing. */
export function canProcessCapturedDna(stored:z.infer<typeof StoredCreatorAnalysis>,view:ReturnType<typeof projectCreatorDna>):boolean {
  const expected=projectCreatorDna(stored);
  if(JSON.stringify(view)!==JSON.stringify(expected)||expected.contains_fixture_data)return false;
  const review=stored.analysis.seed_review;
  if(view.seed_review && (!review || review.provenance.origin!=='live' || review.provenance.permission.status!=='approved' ||
    !review.provenance.permission.permitted_uses.includes('model_processing')))return false;
  const observations=new Map([...stored.analysis.scan.profile_observations,...stored.analysis.scan.video_observations].map(o=>[o.id,o]));
  return expected.claims.every(c=>c.evidence.every(e=>{
    const o=observations.get(e.observation_id);
    return o?.provenance.origin==='live'&&o.provenance.permission.status==='approved'
      &&o.provenance.permission.permitted_uses.includes('model_processing');
  }));
}
export async function runCreatorPipelineJob(repository:PipelineRepository,creatorRepository:CreatorRepository,
  accountId:string,jobId:string,providerFor:(job:StoredCreatorJob)=>CreatorPipelineProvider,
  ceilings:AttemptCeilings,durableStep:DurableStep) {
  const loaded=StoredCreatorJobOutput.parse(await durableStep('load-job',()=>repository.call('run_creator_job',accountId,{job_id:jobId})));
  if(!loaded.ok)return;
  const job=loaded.data.job;
  if(job.id!==jobId||job.account_id!==accountId)throw new PipelineRunError('failed');
  if(job.state!=='running')return;
  try {
    const context=createGuardedProviderContext(repository,job,ceilings,durableStep);
    let output:NonNullable<CreatorJobView['result']>;
    if(job.kind==='scan') {
      const captured=z.object({scan:ProfileScanRequest,seed_url:z.string().optional()}).parse(job.captured);
      const analysis=CreatorAnalysis.parse(await providerFor(job).scan(captured.scan,context));
      if(captured.seed_url && (analysis.seed_review?.url!==captured.seed_url || analysis.seed_review.provenance.origin!=='live'))throw new PipelineRunError('failed');
      if([...analysis.scan.profile_observations,...analysis.scan.video_observations].some(o=>o.provenance.origin!=='live')||JSON.stringify(analysis.scan.request)!==JSON.stringify(captured.scan))throw new PipelineRunError('failed');
      const stored=await durableStep('save-dna',()=>createCreatorIngestion(creatorRepository)(accountId,{project_id:job.project_id,request_id:job.id,analysis}));
      if(!stored.ok)throw new PipelineRunError('failed');
      output={kind:'scan',dna:projectCreatorDna(stored.data)};
    } else {
      const captured=z.object({stored:StoredCreatorAnalysis,batch:RecommendationBatch.optional(),idea_id:Id.optional(),variants:z.array(FilmingVariant.omit({id:true})).min(2).max(3).optional()}).parse(job.captured);
      if(captured.stored.project_id!==job.project_id)throw new PipelineRunError('failed');
      const dna=projectCreatorDna(captured.stored);
      if(!canProcessCapturedDna(captured.stored,dna))throw new PipelineRunError('failed');
      if(job.kind==='recommendations') {
        const batch=RecommendationBatch.parse(await providerFor(job).recommend(dna,context));
        if(batch.dna_id!==dna.dna_id||batch.dna_version!==dna.version||batch.contains_fixture_data)throw new PipelineRunError('failed');
        output={kind:'recommendations',batch};
      }else{
        const batch=RecommendationBatch.parse(captured.batch),idea=batch.ideas.find(i=>i.id===captured.idea_id);
        if(!idea||batch.dna_id!==dna.dna_id||batch.dna_version!==dna.version)throw new PipelineRunError('failed');
        const scripts=CreatorScriptSet.parse(captured.variants
          ? await durableStep('save-chat-draft',async()=>({id:crypto.randomUUID(),batch_id:batch.id,idea_id:idea.id,dna_id:dna.dna_id,dna_version:dna.version,version:1,created_at:new Date().toISOString(),
              variants:captured.variants!.map(v=>({...v,id:crypto.randomUUID()})),contains_fixture_data:false,
              limitations:['Drafted in the ChatGPT conversation and saved by Riff. No separate OpenAI API request was made.','Filming instructions are proposals; reference citations do not establish factual accuracy or predicted performance.']}))
          : await providerFor(job).generate({batch,idea_id:idea.id,dna},context));
        if(scripts.batch_id!==batch.id||scripts.idea_id!==idea.id||scripts.dna_id!==dna.dna_id||scripts.dna_version!==dna.version
          ||scripts.contains_fixture_data||scripts.variants.some(v=>v.reference_ids.some(id=>!idea.reference_ids.includes(id))))throw new PipelineRunError('failed');
        output={kind:'scripts',scripts};
      }
    }
    const finished=StoredCreatorJobOutput.parse(await durableStep('save-result',()=>repository.call('finish_creator_job',accountId,{job_id:jobId,state:'succeeded',result:output,message:null})));
    if(!finished.ok)throw new PipelineRunError('failed');
  }catch(error){
    const state=error instanceof PipelineRunError?error.state:
      error instanceof Error&&error.message.includes('creator_attempt_needs_reconciliation')?'needs_reconciliation':'failed';
    const diagnostic=error instanceof PipelineRunError?error.diagnostic:safeProviderDiagnostic(error);
    await durableStep('record-failure',()=>repository.call('finish_creator_job',accountId,{job_id:jobId,state,result:null,message:diagnostic?`${state}:${diagnostic}`:state}));
  }
}
