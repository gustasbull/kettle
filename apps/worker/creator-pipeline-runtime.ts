import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { z } from 'zod';
import { Id } from '../../packages/contracts/index.ts';
import { StoredCreatorAnalysis } from '../../packages/contracts/creator-operations.ts';
import type { CreatorRecommendationReuseSource } from '../../packages/contracts/creator-pipeline.ts';
import { runCreatorPipelineJob, canProcessCapturedDna, type DurableStep, type AttemptCeilings, type StoredCreatorJob } from '../../packages/application/creator-pipeline.ts';
import { createPipelineSupabaseRepository } from '../../packages/database/creator-pipeline-supabase.ts';
import { createCreatorSupabaseRepository } from '../../packages/database/creator-supabase.ts';
import { createRiffVideoSupabaseRepository } from '../../packages/database/riff-videos-supabase.ts';
import { createCreatorPipelineProvider } from '../../packages/adapters/creator-pipeline/provider.ts';
import type { ScrapeCreatorsCachePolicy } from '../../packages/adapters/creator-pipeline/requests.ts';
import { createCreatorTelemetry, type CreatorTelemetry } from './creator-telemetry.ts';
import type { CreatorLatencyObserver } from '../../packages/application/creator-observability.ts';
import { createCreatorWorkflowDurableStep } from './creator-workflow-policy.ts';
export { creatorWorkflowStepOptions } from './creator-workflow-policy.ts';

const CREATOR_CACHE_MAX_AGE = Object.freeze({
  profile: '1d', detail: '7d',
} satisfies ScrapeCreatorsCachePolicy);

export function pipelineConfigured(env:Env):boolean {
  return String(env.CREATOR_PIPELINE_ENABLED)==='true' && [env.LIGHTREEL_API_KEY,env.SCRAPECREATORS_API_KEY,
    env.CREATOR_MODEL,env.CREATOR_SOURCE_PERMISSION_BASIS,env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY].every(v=>typeof v==='string'&&v.trim().length>0)
    && Object.values(pipelineCeilings(env)).every(n=>Number.isSafeInteger(n)&&n>=0);
}
function pipelineCeilings(env:Env):AttemptCeilings {return {scrapecreators:Number(env.CREATOR_SCRAPE_CEILING_MICROUSD),lightreel:Number(env.CREATOR_LIGHTREEL_CEILING_MICROUSD),openai:Number(env.CREATOR_OPENAI_CEILING_MICROUSD)};}
export async function dispatchCreatorJob(env:Env,jobId:string,accountId:string,telemetry?:CreatorLatencyObserver):Promise<void> {
  if(!pipelineConfigured(env))throw new Error('Creator pipeline unavailable');
  Id.parse(jobId);Id.parse(accountId);
  // Same ID on every outbox reconciliation; never spawn a second provider workflow.
  try {await (telemetry?telemetry.measure({stage:'workflow_dispatch',clock:'monotonic',operation:'dispatch',endpoint:'workflow_create'},
    ()=>env.CREATOR_WORKFLOW.create({id:`creator-${jobId}`,params:{job_id:jobId,account_id:accountId}})):
    env.CREATOR_WORKFLOW.create({id:`creator-${jobId}`,params:{job_id:jobId,account_id:accountId}}));}
  catch {const instance=await (telemetry?telemetry.measure({stage:'workflow_dispatch',clock:'monotonic',operation:'find',endpoint:'workflow_get'},
    ()=>env.CREATOR_WORKFLOW.get(`creator-${jobId}`)):env.CREATOR_WORKFLOW.get(`creator-${jobId}`));
    await (telemetry?telemetry.measure({stage:'workflow_dispatch',clock:'monotonic',operation:'read',endpoint:'workflow_status'},()=>instance.status()):instance.status());}
}
export async function reconcileCreatorDispatches(env:Env,rootTelemetry?:CreatorTelemetry):Promise<void> {
  if(!pipelineConfigured(env))return;
  const repository=createPipelineSupabaseRepository(env.SUPABASE_URL!,env.SUPABASE_SERVICE_ROLE_KEY!);
  const list=z.object({ok:z.literal(true),data:z.object({jobs:z.array(z.object({id:Id,account_id:Id,state:z.enum(['queued','running'])})).max(10)})})
    .parse(await repository.call('list_creator_dispatches','00000000-0000-4000-8000-000000000000',{limit:10}));
  for(const job of list.data.jobs)try{
    const telemetry=rootTelemetry?.scope({job_id:job.id});
    if(job.state==='queued')await dispatchCreatorJob(env,job.id,job.account_id,telemetry);
    const instance=await env.CREATOR_WORKFLOW.get(`creator-${job.id}`);
    const status=await instance.status();
    if(['errored','terminated','complete'].includes(status.status)){
      await repository.call('reconcile_creator_job',job.account_id,{job_id:job.id});
    }
  }catch{/* Unknown Workflow status never authorizes a new running job or a provider retry. */}
}
export class CreatorPipelineWorkflow extends WorkflowEntrypoint<Env,{job_id:string;account_id:string}> {
  async run(event:WorkflowEvent<{job_id:string;account_id:string}>,step:WorkflowStep) {
    const payload=z.object({job_id:Id,account_id:Id}).parse(event.payload);
    const telemetry=createCreatorTelemetry().scope({job_id:payload.job_id});
    if(!pipelineConfigured(this.env))throw new Error('Creator pipeline unavailable');
    const repository=createPipelineSupabaseRepository(this.env.SUPABASE_URL!,this.env.SUPABASE_SERVICE_ROLE_KEY!,fetch,telemetry);
    const creators=createCreatorSupabaseRepository(this.env.SUPABASE_URL!,this.env.SUPABASE_SERVICE_ROLE_KEY!,fetch,telemetry);
    const catalog=createRiffVideoSupabaseRepository(this.env.SUPABASE_URL!,this.env.SUPABASE_SERVICE_ROLE_KEY!,fetch,telemetry);
    const durableStep:DurableStep=createCreatorWorkflowDurableStep(step);
    const factory=(job:StoredCreatorJob,recommendationReuse?:CreatorRecommendationReuseSource)=>{
      const captured=z.object({stored:StoredCreatorAnalysis.optional(),seed_url:z.string().optional()}).parse(job.captured);
      return createCreatorPipelineProvider({fetch:(url,init)=>fetch(url,init),
        credentials:{scrapeCreators:this.env.SCRAPECREATORS_API_KEY!,lightreel:this.env.LIGHTREEL_API_KEY!},
        model:this.env.CREATOR_MODEL!,maxOutputTokens:6000,region:'US',maxHistoryReads:0,
        cacheMaxAge:CREATOR_CACHE_MAX_AGE,
        ...(recommendationReuse?{recommendationReuse}:{}),
        ...(captured.seed_url?{seedUrl:captured.seed_url}:{}),
        permission:{status:'approved',basis:this.env.CREATOR_SOURCE_PERMISSION_BASIS!,permitted_uses:['store','display','model_processing'],retention:'Development proof only; source records are restricted to the allocated test account and require explicit retention review before production.'},
        canProcessDna:view=>Boolean(captured.stored&&canProcessCapturedDna(captured.stored,view)),
        telemetry,
      });
    };
    await runCreatorPipelineJob(repository,creators,payload.account_id,payload.job_id,factory,pipelineCeilings(this.env),durableStep,telemetry,catalog);
    return {job_id:payload.job_id};
  }
}
