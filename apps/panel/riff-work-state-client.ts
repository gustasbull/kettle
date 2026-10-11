import type { RiffWorkState,RiffWorkStateValue,SetRiffWorkStateInput } from '../../packages/contracts/riff-work-state.ts';

type JobSnapshot={id:string;work_states:RiffWorkState[]};
type Failure={ok:false;error:{code:string}};
export type WorkStateClientResult<T extends JobSnapshot=JobSnapshot>=
  | {status:'confirmed';message:string;workState:RiffWorkState;job:T}
  | {status:'conflict';message:string;job:T}
  | {status:'failed'|'stale';message:string};

const object=(value:unknown):Record<string,unknown>|undefined=>{
  if(value===null||typeof value!=='object'||Array.isArray(value))return;
  const prototype=Object.getPrototypeOf(value);if(prototype!==Object.prototype&&prototype!==null)return;
  if(Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor=>!('value' in descriptor)))return;
  return value as Record<string,unknown>;
};
const envelope=(raw:unknown)=>object(object(raw)?.structuredContent)??raw;
const exact=(value:Record<string,unknown>,keys:string[])=>Object.keys(value).length===keys.length&&keys.every(key=>key in value);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const timestamp=/^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|02-(?:0[1-9]|1\d|2[0-8])))T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
export const parseRiffWorkState=(raw:unknown):RiffWorkState|undefined=>{
  const state=object(raw);
  if(!state||!exact(state,['job_id','variant_id','state','version','updated_at'])
    ||typeof state.job_id!=='string'||!uuid.test(state.job_id)||typeof state.variant_id!=='string'||!uuid.test(state.variant_id)
    ||!['active','saved','filmed'].includes(String(state.state))||typeof state.version!=='number'||!Number.isInteger(state.version)||state.version<1
    ||state.version>2_147_483_647||typeof state.updated_at!=='string'||!timestamp.test(state.updated_at))return undefined;
  return state as RiffWorkState;
};
const success=(raw:unknown):RiffWorkState|undefined=>{
  const value=object(envelope(raw)),data=object(value?.data),state=object(data?.work_state);
  return value?.ok===true&&value&&exact(value,['ok','data'])&&data&&exact(data,['work_state'])&&state?parseRiffWorkState(state):undefined;
};
const failure=(raw:unknown):Failure|undefined=>{
  const value=object(envelope(raw)),error=object(value?.error);
  return value?.ok===false&&typeof error?.code==='string'?{ok:false,error:{code:error.code}}:undefined;
};

export function createRiffWorkStateClient<T extends JobSnapshot>(
  write:(input:SetRiffWorkStateInput)=>Promise<unknown>,
  reread:(jobId:string)=>Promise<T|undefined>,
){
  let generation=0;
  let pending:{key:string;input:SetRiffWorkStateInput}|undefined;
  const invalidate=()=>{generation++;pending=undefined;};
  const set=async(job:T,variantId:string,state:RiffWorkStateValue):Promise<WorkStateClientResult<T>>=>{
    const started=generation;
    const current=job.work_states.find(item=>item.variant_id===variantId);
    const expected=current?.version??0;
    const key=`${job.id}:${variantId}:${state}:${expected}`;
    if(pending?.key!==key)pending={key,input:{job_id:job.id,variant_id:variantId,state,
      expected_version:expected,request_id:crypto.randomUUID()}};
    const intent=pending;
    let raw:unknown;
    try{raw=await write(intent.input);}catch{return started===generation
      ?{status:'failed',message:'Riff could not confirm that change. Try the same action again safely.'}
      :{status:'stale',message:'A newer Riff account or job is already shown.'};}
    if(started!==generation)return {status:'stale',message:'A newer Riff account or job is already shown.'};
    const saved=success(raw);
    const problem=failure(raw);
    if(!saved){
      if(problem?.error.code==='VERSION_CONFLICT'){
        pending=undefined;
        let latest:T|undefined;
        try{latest=await reread(job.id);}catch{return started===generation
          ?{status:'failed',message:'Riff changed elsewhere, but the latest saved state could not be refreshed.'}
          :{status:'stale',message:'A newer Riff account or job is already shown.'};}
        if(started!==generation)return {status:'stale',message:'A newer Riff account or job is already shown.'};
        return latest?{status:'conflict',message:'Riff changed elsewhere. The latest saved state is shown.',job:latest}
          :{status:'failed',message:'Riff changed elsewhere. Refresh the saved job.'};
      }
      if(problem&&!['UNAVAILABLE'].includes(problem.error.code))pending=undefined;
      return {status:'failed',message:problem?.error.code==='IDEMPOTENCY_CONFLICT'
        ?'That retry key was already used for another change. Refresh the saved job.'
        :'Riff could not confirm that change. Try the same action again safely.'};
    }
    if(saved.job_id!==job.id||saved.variant_id!==variantId||saved.state!==state||saved.version!==expected+1)
      return {status:'failed',message:'Riff returned a mismatched receipt. Refresh the saved job.'};
    let latest:T|undefined;
    try{latest=await reread(job.id);}catch{return started===generation
      ?{status:'failed',message:'Riff saved the request but could not reconcile the latest job. Try the same action again safely.'}
      :{status:'stale',message:'A newer Riff account or job is already shown.'};}
    if(started!==generation)return {status:'stale',message:'A newer Riff account or job is already shown.'};
    const reconciled=latest?.work_states.find(item=>item.variant_id===variantId);
    if(!latest||!reconciled||JSON.stringify(reconciled)!==JSON.stringify(saved))
      return {status:'failed',message:'Riff saved the request but could not reconcile the latest job. Try the same action again safely.'};
    pending=undefined;
    return {status:'confirmed',message:state==='saved'?'Saved for later.':state==='filmed'?'Marked as filmed.':'Save undone.',
      workState:saved,job:latest};
  };
  return {set,invalidate};
}
