import { z } from 'zod';
import { Id, Timestamp, result } from '../contracts/index.ts';
import { CreatorJobView, CreatorJobOutput, CreatorJobStatusView, CreatorJobStatusOutput, CreatorJobProgress,
  CreatorJobStage, pipelineContracts, RecommendationBatch, CreatorScriptSet, emptyCreatorJobProgress,
  SavableFilmingVariant, CreatorAttemptOutcomeInput, CreatorAttemptOutcome, CreatorAttemptError,
  CreatorRecommendationReuseSource,
  type AttemptFailureCode, type PipelineOperation, type CreatorProviderContext, type CreatorPipelineProvider,
  type CreatorRecommendationReuseSource as CreatorRecommendationReuseSourceType } from '../contracts/creator-pipeline.ts';
import { CreatorAnalysis, CreatorUrl, ProfileScanRequest } from '../contracts/creator-profile.ts';
import { StoredCreatorAnalysis } from '../contracts/creator-operations.ts';
import { failure, type IdentityVerifier } from './operations.ts';
import { projectCreatorDna, createCreatorIngestion, type CreatorRepository } from './creator-operations.ts';
import { observed, type CreatorLatencyObserver } from './creator-observability.ts';
import { parseRiffVideoIngestReceipt, riffVideoCatalogInput, type RiffVideoRepository } from './riff-videos.ts';
import { RiffWorkState } from '../contracts/riff-work-state.ts';

export type PipelineRepositoryOperation = PipelineOperation | 'run_creator_job' | 'finish_creator_job'
  | 'reserve_creator_attempt' | 'complete_creator_attempt' | 'record_creator_attempt_outcome'
  | 'checkpoint_creator_job' | 'list_creator_dispatches' | 'reconcile_creator_job';
export interface PipelineRepository { call(operation: PipelineRepositoryOperation, accountId: string, input: unknown,
  telemetry?: CreatorLatencyObserver): Promise<unknown> }
export const StoredCreatorJob = z.object({
  id:Id, account_id:Id, project_id:Id, request_id:Id, kind:z.enum(['scan','recommendations','scripts']),
  state:z.enum(['queued','running','succeeded','failed','needs_reconciliation']),revision:z.number().int().positive(),
  stage:CreatorJobStage,progress:CreatorJobProgress,
  created_at:Timestamp,updated_at:Timestamp,input:z.record(z.string(),z.unknown()),captured:z.unknown(),
  result:CreatorJobView.shape.result,message:z.string().nullable(),
  work_states:z.array(RiffWorkState).default([]),
});
export type StoredCreatorJob = z.infer<typeof StoredCreatorJob>;
export const StoredCreatorJobOutput = result(z.object({job:StoredCreatorJob}));
export type CreatorDispatch = (jobId:string,accountId:string,telemetry?:CreatorLatencyObserver)=>Promise<void>;
export type CreatorTaskDefer = (task:Promise<void>)=>void;
export type CreatorDispatchScheduler = (jobId:string,accountId:string,telemetry?:CreatorLatencyObserver)=>void;
export function createCreatorDispatchScheduler(dispatch:CreatorDispatch,defer:CreatorTaskDefer):CreatorDispatchScheduler {
  return (jobId,accountId,telemetry) => {
    try {
      const task=observed(telemetry,{stage:'application_operation',clock:'monotonic',operation:'dispatch'},
        ()=>dispatch(jobId,accountId,telemetry)).catch(()=>undefined);
      defer(task);
    } catch { /* committed queued intent remains the outbox authority */ }
  };
}
const CapturedCreatorScan = z.strictObject({scan:ProfileScanRequest,seed_url:CreatorUrl.optional()})
  .refine(captured=>!captured.seed_url||new URL(captured.seed_url).hostname.replace(/^www\./,'')==='tiktok.com'
    &&new URL(captured.seed_url).pathname.startsWith(new URL(captured.scan.supplied_url).pathname.replace(/\/$/,'')+'/video/')
    &&/^\/@[\w.]+\/video\/\d{1,30}$/.test(new URL(captured.seed_url).pathname),
  'Seed video must belong to the captured profile');
export function publicCreatorJob(job:StoredCreatorJob):CreatorJobView {
  const capturedScan=job.kind==='scan'?CapturedCreatorScan.safeParse(job.captured):null;
  return CreatorJobView.parse({id:job.id,project_id:job.project_id,kind:job.kind,state:job.state,
    ...(capturedScan?.success?{source_kind:capturedScan.data.seed_url?'video':'profile'}:{}),
    revision:job.revision,stage:job.stage,progress:job.progress,created_at:job.created_at,updated_at:job.updated_at,result:job.result,
    work_states:job.work_states,
    message:job.state==='needs_reconciliation'?'A provider request needs review before another attempt. No automatic resubmission.':
      job.state==='failed'?'This job could not complete. Check the research allowance and source permissions before starting a new request.':null});
}
export function publicCreatorJobStatus(job:StoredCreatorJob):CreatorJobStatusView {
  return CreatorJobStatusView.parse({id:job.id,kind:job.kind,state:job.state,stage:job.stage,revision:job.revision,
    created_at:job.created_at,updated_at:job.updated_at,progress:job.progress,
    terminal_result_available:job.state==='succeeded'&&job.result?.kind===job.kind});
}
export function createPipelineOperations(verifier:IdentityVerifier, repository:PipelineRepository,
  schedule:CreatorDispatchScheduler,isEnabled:(operation:PipelineOperation)=>boolean=()=>true,
  telemetry?:CreatorLatencyObserver) {
  return {async execute(operation:PipelineOperation, credential:string|null, raw:unknown) {
    if(!credential)return failure('UNAUTHENTICATED');
    let identity;try{identity=await verifier.verify(credential);}catch{return failure('UNAUTHENTICATED');}
    if(!identity||!Id.safeParse(identity.account_id).success)return failure('UNAUTHENTICATED');
    const contract=pipelineContracts[operation];
    if(!identity.scopes.includes(contract.scope))return failure('FORBIDDEN');
    const parsed=contract.input.safeParse(raw);if(!parsed.success)return failure('VALIDATION_ERROR');
    const operationTelemetry=telemetry?.scope?.('request_id' in parsed.data
      ? {request_id:parsed.data.request_id} : {job_id:parsed.data.job_id})??telemetry;
    if(!contract.readOnly&&!isEnabled(operation)){const unavailable=failure('UNAVAILABLE');unavailable.error.message='Creator research is not enabled yet. Provider configuration or a test allocation is still required.';return unavailable;}
    try {
      if(operation==='get_creator_job_status'){
        if(!('job_id' in parsed.data))return failure('VALIDATION_ERROR');
        const response=CreatorJobStatusOutput.parse(await observed(operationTelemetry,
          {stage:'application_operation',clock:'monotonic',operation:'read'},
          ()=>repository.call(operation,identity.account_id,parsed.data,operationTelemetry)));
        if(!response.ok)return failure(response.error.code);
        if(response.data.status.id!==parsed.data.job_id)return failure('UNAVAILABLE');
        return response;
      }
      const response=StoredCreatorJobOutput.parse(await observed(operationTelemetry,
        {stage:'application_operation',clock:'monotonic',operation:contract.readOnly?'read':operation==='save_creator_scripts'?'persist':'start'},
        ()=>repository.call(operation,identity.account_id,parsed.data,operationTelemetry)));
      if(!response.ok)return failure(response.error.code);
      const job=response.data.job;
      if(job.account_id!==identity.account_id || ('job_id' in parsed.data && job.id!==parsed.data.job_id)
        || ('project_id' in parsed.data && job.project_id!==parsed.data.project_id)
        || ('request_id' in parsed.data && job.request_id!==parsed.data.request_id))return failure('UNAVAILABLE');
      if(!contract.readOnly&&job.kind!==(operation==='save_creator_scripts'?'scripts':operation.replace('start_creator_','')))return failure('UNAVAILABLE');
      const publicOutput=CreatorJobOutput.parse({ok:true,data:{job:publicCreatorJob(job)}});
      const jobTelemetry=operationTelemetry?.scope?.({job_id:job.id})??operationTelemetry;
      // Intent is already durable. A dispatch gap is reconciled by the scheduled outbox.
      if(!contract.readOnly&&job.state==='queued')try{schedule(job.id,job.account_id,jobTelemetry);}catch{/* durable queued intent */}
      return publicOutput;
    }catch{return failure('UNAVAILABLE');}
  }};
}
const outcomeSignal='creator_attempt_terminal:(failed|needs_reconciliation):([a-z_]+):(null|[1-5][0-9]{2})';
const wrappedOutcomeMarker=new RegExp(`^Workflow step failed: Error: (${outcomeSignal})(?:\\n[^\\r\\n]{0,1000})?$`);
function safeSerializedOutcome(error:unknown){
  if(!(error instanceof Error))return undefined;
  const match=wrappedOutcomeMarker.exec(error.message);if(!match)return undefined;
  const parsed=CreatorAttemptOutcomeInput.safeParse({terminal_state:match[2],failure_code:match[3],
    http_status:match[4]==='null'?null:Number(match[4])});
  return parsed.success?parsed.data:undefined;
}
export class PipelineRunError extends Error {
  readonly diagnostic: string | undefined;
  readonly failureCode:AttemptFailureCode|undefined;
  readonly httpStatus:number|null|undefined;
  constructor(readonly state:'failed'|'needs_reconciliation', outcome?:CreatorAttemptOutcomeInput|string){
    const candidate=outcome&&typeof outcome==='object'?{terminal_state:outcome.terminal_state,failure_code:outcome.failure_code,http_status:outcome.http_status}:undefined;
    const safe=candidate&&CreatorAttemptOutcomeInput.safeParse(candidate).success?CreatorAttemptOutcomeInput.parse(candidate):undefined;
    super(safe?`creator_attempt_terminal:${safe.terminal_state}:${safe.failure_code}:${safe.http_status??'null'}`:
      state==='failed'?'creator_job_blocked':'creator_attempt_needs_reconciliation');
    this.failureCode=safe?.failure_code;this.httpStatus=safe?.http_status;
    this.diagnostic=safe?`${safe.failure_code}${safe.http_status===null?'':`_${safe.http_status}`}`:undefined;
  }
}
export type AttemptCeilings = Record<'scrapecreators'|'lightreel'|'openai',number>;
export type DurableStep = <T>(name:string,run:()=>Promise<T>)=>Promise<T>;
export function createGuardedProviderContext(repository:PipelineRepository,job:StoredCreatorJob,
  ceilings:AttemptCeilings, durableStep:DurableStep, telemetry?:CreatorLatencyObserver,
  catalogRepository?:RiffVideoRepository):CreatorProviderContext {
  let revision=job.revision;
  type ReservationRequest={job_id:string;key:string;provider:'scrapecreators'|'lightreel'|'openai';
    operation:'profile'|'feed'|'research'|'poll'|'video'|'generate';ceiling_microusd:number};
  const reservationSchema=z.object({ok:z.literal(true),data:z.discriminatedUnion('status',[
    z.object({status:z.literal('acquired')}),z.object({status:z.literal('replay'),receipt:z.unknown()}),
    z.object({status:z.literal('ambiguous')}),z.object({status:z.literal('definite_failure'),outcome:CreatorAttemptOutcome}),
    z.object({status:z.literal('needs_reconciliation'),outcome:CreatorAttemptOutcome}),
  ])});
  const attemptRequests=new Map<string,ReservationRequest>();
  const reserveAttempt=(request:ReservationRequest)=>observed(telemetry,
    {stage:'provider_reservation',clock:'monotonic',provider:request.provider,operation:'reserve'},
    ()=>repository.call('reserve_creator_attempt',job.account_id,request));
  const inspectAuthoritativeAttempt=async(request:ReservationRequest)=>{
    try {
      const authoritative=reservationSchema.safeParse(await reserveAttempt(request));
      if(authoritative.success){
        if(authoritative.data.data.status==='replay')return {kind:'receipt',receipt:authoritative.data.data.receipt} as const;
        if(authoritative.data.data.status==='definite_failure'||authoritative.data.data.status==='needs_reconciliation')
          return {kind:'stored_outcome',outcome:authoritative.data.data.outcome} as const;
      }
    }catch{/* The caller retains the conservative post-dispatch fallback. */}
  };
  const exactOutcome=(candidate:z.infer<typeof CreatorAttemptOutcome>,expected:z.infer<typeof CreatorAttemptOutcomeInput>,
    request:ReservationRequest|undefined)=>candidate.terminal_state===expected.terminal_state&&
      candidate.failure_code===expected.failure_code&&candidate.http_status===expected.http_status&&
      (!request||(candidate.provider===request.provider&&candidate.operation===request.operation));
  const recoverOutcome=async(key:string,outcome:z.infer<typeof CreatorAttemptOutcomeInput>)=>{
    const request=attemptRequests.get(key);if(!request)return undefined;
    const authoritative=await inspectAuthoritativeAttempt(request);
    return authoritative?.kind==='stored_outcome'&&exactOutcome(authoritative.outcome,outcome,request)
      ?authoritative.outcome:undefined;
  };
  const persistOutcome=async(key:string,raw:unknown):Promise<never>=>{
    const outcome=CreatorAttemptOutcomeInput.parse(raw);
    let saved:unknown;
    try{saved=await durableStep(`attempt:outcome:${key}`,()=>observed(telemetry,
      {stage:'attempt_outcome_persistence',clock:'monotonic',operation:'persist'},
      ()=>repository.call('record_creator_attempt_outcome',job.account_id,{job_id:job.id,key,...outcome})));}
    catch{const authoritative=await recoverOutcome(key,outcome);
      if(authoritative)throw new PipelineRunError(authoritative.terminal_state,authoritative);
      throw new PipelineRunError('needs_reconciliation');}
    const parsed=z.strictObject({ok:z.literal(true),data:z.strictObject({status:z.enum(['recorded','replay']),outcome:CreatorAttemptOutcome})}).safeParse(saved);
    if(!parsed.success||!exactOutcome(parsed.data.data.outcome,outcome,attemptRequests.get(key))){
      const authoritative=await recoverOutcome(key,outcome);
      if(authoritative)throw new PipelineRunError(authoritative.terminal_state,authoritative);
      throw new PipelineRunError('needs_reconciliation');
    }
    throw new PipelineRunError(outcome.terminal_state,outcome);
  };
  return {now:()=>new Date().toISOString(),newId:()=>crypto.randomUUID(),
    recordOutcome(key,outcome){
      if(!/^[\w:-]{1,200}$/.test(key))throw new PipelineRunError('failed');
      return persistOutcome(key,outcome);
    },
    async ingestCatalog(checkpointKey,role,observations){
      if(!catalogRepository)throw new PipelineRunError('failed');
      const input=riffVideoCatalogInput(job,checkpointKey,role,observations);
      const saved=await durableStep(`catalog:${checkpointKey}:${role}`,()=>observed(telemetry,
        {stage:'catalog_persistence',clock:'monotonic',operation:'persist',item_count:observations.length},
        async()=>parseRiffVideoIngestReceipt(await catalogRepository.ingest(job.account_id,input),input)));
      parseRiffVideoIngestReceipt(saved,input);
    },
    async checkpoint(key,stage,rawProgress){
      if(!/^[a-z0-9][a-z0-9:_-]{0,199}$/.test(key))throw new PipelineRunError('failed');
      const progress=CreatorJobProgress.parse(rawProgress);
      const itemCount=progress.kind==='scan'?progress.videos.length:
        progress.kind==='recommendations'?progress.references.length:0;
      const saved=await durableStep(`checkpoint:${key}`,()=>observed(telemetry,
        {stage:'checkpoint_persistence',clock:'monotonic',operation:'persist',item_count:itemCount},
        ()=>repository.call('checkpoint_creator_job',job.account_id,{job_id:job.id,key,expected_revision:revision,stage,progress})));
      const parsed=z.strictObject({ok:z.literal(true),data:z.strictObject({status:z.enum(['stored','replay']),
        revision:z.number().int().positive(),checkpoint:z.strictObject({key:z.string(),stage:CreatorJobStage,
          progress:CreatorJobProgress,revision:z.number().int().positive(),created_at:Timestamp})})}).safeParse(saved);
      const data=parsed.success?parsed.data.data:undefined;
      const validRevision=data?.status==='stored'
        ? data.revision===revision+1&&data.checkpoint.revision===data.revision
        : data?.status==='replay'&&data.revision>=revision&&data.checkpoint.revision<=data.revision;
      if(!data||data.checkpoint.key!==key||data.checkpoint.stage!==stage||
        JSON.stringify(data.checkpoint.progress)!==JSON.stringify(progress)||!validRevision)
        throw new PipelineRunError('failed');
      revision=data.revision;
    },
    async call(key,provider,operation,execute) {
      if(!/^[\w:-]{1,200}$/.test(key)||!Number.isSafeInteger(ceilings[provider])||ceilings[provider]<0)throw new PipelineRunError('failed');
      // One provider request per step. Database reservation is authoritative even if
      // Workflow persistence fails, retries overlap, or the process dies after dispatch.
      const reservationRequest={job_id:job.id,key,provider,operation,ceiling_microusd:ceilings[provider]};
      const priorRequest=attemptRequests.get(key);
      if(priorRequest&&(priorRequest.provider!==provider||priorRequest.operation!==operation||
        priorRequest.ceiling_microusd!==ceilings[provider]))throw new PipelineRunError('failed');
      attemptRequests.set(key,reservationRequest);
      let dispatched=false;
      const envelope=await durableStep(`provider:${key}`,async()=>{
        const reservation=reservationSchema.safeParse(await reserveAttempt(reservationRequest));
        if(!reservation.success)return {kind:'local_failure'} as const;
        if(reservation.data.data.status==='replay')return {kind:'receipt',receipt:reservation.data.data.receipt} as const;
        if(reservation.data.data.status==='ambiguous')return {kind:'unresolved'} as const;
        if(reservation.data.data.status==='definite_failure'||reservation.data.data.status==='needs_reconciliation')
          return {kind:'stored_outcome',outcome:reservation.data.data.outcome} as const;
        try {
          dispatched=true;
          const receipt=await execute();
          let bytes:number;try{bytes=new TextEncoder().encode(JSON.stringify(receipt)).length;}catch{
            return {kind:'outcome',outcome:{terminal_state:'failed',failure_code:'schema_invalid',http_status:null}} as const;
          }
          if(bytes>300_000)return {kind:'outcome',outcome:{terminal_state:'failed',failure_code:'oversized_response',http_status:null}} as const;
          const saved=z.object({ok:z.literal(true),data:z.object({status:z.literal('completed'),receipt:z.unknown()})})
            .safeParse(await observed(telemetry,{stage:'receipt_persistence',clock:'monotonic',provider,operation:'persist',response_bytes:bytes},
              ()=>repository.call('complete_creator_attempt',job.account_id,{job_id:job.id,key,receipt})).catch(()=>undefined));
          if(saved.success)return {kind:'receipt',receipt:saved.data.data.receipt} as const;
          return await inspectAuthoritativeAttempt(reservationRequest)??
            {kind:'outcome',outcome:{terminal_state:'needs_reconciliation',failure_code:'receipt_persistence_failed',http_status:null}} as const;
        }catch(error){return {kind:'outcome',outcome:error instanceof CreatorAttemptError?error.outcome:
          {terminal_state:'needs_reconciliation',failure_code:'unknown_after_dispatch',http_status:null}} as const;}
      }).catch(async error=>{
        if(!dispatched)throw error;
        const authoritative=await inspectAuthoritativeAttempt(reservationRequest);
        if(authoritative)return authoritative;
        // The durable wrapper lost a result after external I/O began. Persist the
        // uncertainty outside the zero-retry provider step before ending the job.
        return {kind:'outcome',outcome:{terminal_state:'needs_reconciliation',failure_code:'unknown_after_dispatch',http_status:null}} as const;
      });
      if(envelope.kind==='receipt')return envelope.receipt;
      if(envelope.kind==='stored_outcome')throw new PipelineRunError(envelope.outcome.terminal_state,envelope.outcome);
      if(envelope.kind==='unresolved')throw new PipelineRunError('needs_reconciliation');
      if(envelope.kind==='local_failure')throw new PipelineRunError('failed');
      return persistOutcome(key,envelope.outcome);
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
  accountId:string,jobId:string,providerFor:(job:StoredCreatorJob,reuse?:CreatorRecommendationReuseSourceType)=>CreatorPipelineProvider,
  ceilings:AttemptCeilings,durableStep:DurableStep,telemetry?:CreatorLatencyObserver,catalogRepository?:RiffVideoRepository) {
  const loaded=StoredCreatorJobOutput.parse(await durableStep('load-job',()=>repository.call('run_creator_job',accountId,{job_id:jobId})));
  if(!loaded.ok)return;
  const job=loaded.data.job;
  if(job.id!==jobId||job.account_id!==accountId)throw new PipelineRunError('failed');
  if(job.state!=='running')return;
  telemetry?.record({stage:'queue_to_running',clock:'wall',status:'ok',
    duration_ms:Math.max(0,Date.now()-Date.parse(job.created_at))});
  try {
    const context=createGuardedProviderContext(repository,job,ceilings,durableStep,telemetry,catalogRepository);
    let output:NonNullable<CreatorJobView['result']>;
    if(job.kind==='scan') {
      const captured=CapturedCreatorScan.parse(job.captured);
      const analysis=CreatorAnalysis.parse(await providerFor(job).scan(captured.scan,context));
      if(captured.seed_url && (analysis.seed_review?.url!==captured.seed_url || analysis.seed_review.provenance.origin!=='live'))throw new PipelineRunError('failed');
      if([...analysis.scan.profile_observations,...analysis.scan.video_observations].some(o=>o.provenance.origin!=='live')||JSON.stringify(analysis.scan.request)!==JSON.stringify(captured.scan))throw new PipelineRunError('failed');
      const stored=await durableStep('save-dna',()=>createCreatorIngestion(creatorRepository)(accountId,{project_id:job.project_id,request_id:job.id,analysis}));
      if(!stored.ok)throw new PipelineRunError('failed');
      output={kind:'scan',dna:projectCreatorDna(stored.data)};
    } else {
      const captured=z.object({stored:StoredCreatorAnalysis,batch:RecommendationBatch.optional(),idea_id:Id.optional(),variants:z.array(SavableFilmingVariant).min(2).max(3).optional()}).parse(job.captured);
      if(captured.stored.project_id!==job.project_id)throw new PipelineRunError('failed');
      const dna=projectCreatorDna(captured.stored);
      if(!canProcessCapturedDna(captured.stored,dna))throw new PipelineRunError('failed');
      if(job.kind==='recommendations') {
        const reuse=CreatorRecommendationReuseSource.parse({project_id:captured.stored.project_id,
          dna_id:captured.stored.dna_id,snapshot_id:captured.stored.analysis.dna.id,
          dna_version:captured.stored.analysis.dna.version,
          video_observations:captured.stored.analysis.scan.video_observations});
        const batch=RecommendationBatch.parse(await providerFor(job,reuse).recommend(dna,context));
        if(batch.dna_id!==dna.dna_id||batch.dna_version!==dna.version||batch.contains_fixture_data)throw new PipelineRunError('failed');
        output={kind:'recommendations',batch};
      }else{
        const batch=RecommendationBatch.parse(captured.batch),idea=batch.ideas.find(i=>i.id===captured.idea_id);
        if(!idea||batch.dna_id!==dna.dna_id||batch.dna_version!==dna.version)throw new PipelineRunError('failed');
        const references=idea.reference_ids.map(referenceId=>batch.references.find(reference=>reference.id===referenceId));
        if(references.some(reference=>reference===undefined))throw new PipelineRunError('failed');
        const scriptProgress=emptyCreatorJobProgress('scripts');
        await context.checkpoint('script:generate:start','building_analysis',scriptProgress);
        const scripts=CreatorScriptSet.parse(captured.variants
          ? await durableStep('save-chat-draft',async()=>({id:crypto.randomUUID(),batch_id:batch.id,idea_id:idea.id,dna_id:dna.dna_id,dna_version:dna.version,version:1,created_at:new Date().toISOString(),
              variants:captured.variants!.map(v=>({...v,id:crypto.randomUUID()})),idea,references,contains_fixture_data:false,
              limitations:['Drafted in the ChatGPT conversation and saved by Riff. No separate OpenAI API request was made.','Filming instructions are proposals; reference citations do not establish factual accuracy or predicted performance.']}))
          : await providerFor(job).generate({batch,idea_id:idea.id,dna},context));
        if(scripts.batch_id!==batch.id||scripts.idea_id!==idea.id||scripts.dna_id!==dna.dna_id||scripts.dna_version!==dna.version
          ||scripts.contains_fixture_data||scripts.variants.some(v=>v.reference_ids.some(id=>!idea.reference_ids.includes(id)))
          ||JSON.stringify(scripts.idea)!==JSON.stringify(idea)||JSON.stringify(scripts.references)!==JSON.stringify(references))throw new PipelineRunError('failed');
        await context.checkpoint('script:save','saving',scriptProgress);
        output={kind:'scripts',scripts};
      }
    }
    const finished=StoredCreatorJobOutput.parse(await durableStep('save-result',()=>observed(telemetry,
      {stage:'terminal_save',clock:'monotonic',operation:'persist'},
      ()=>repository.call('finish_creator_job',accountId,{job_id:jobId,state:'succeeded',result:output,message:null}))));
    if(!finished.ok)throw new PipelineRunError('failed');
  }catch(error){
    const serialized=safeSerializedOutcome(error);
    const state=error instanceof PipelineRunError?error.state:serialized?.terminal_state??'failed';
    const diagnostic=error instanceof PipelineRunError?error.diagnostic:serialized?
      `${serialized.failure_code}${serialized.http_status===null?'':`_${serialized.http_status}`}`:undefined;
    await durableStep('record-failure',()=>observed(telemetry,
      {stage:'terminal_save',clock:'monotonic',operation:'persist'},
      ()=>repository.call('finish_creator_job',accountId,{job_id:jobId,state,result:null,message:diagnostic?`${state}:${diagnostic}`:state})));
  }
}
