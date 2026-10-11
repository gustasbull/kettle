import type { RiffWorkState,RiffWorkStateValue,SetRiffWorkStateInput } from '../../packages/contracts/riff-work-state.ts';
import { isBusinessResultFlagCoherent,parseStrictCallToolResult } from './call-tool-result-validation.ts';

type JobSnapshot={id:string;work_states:RiffWorkState[]};
type Failure={ok:false;error:{code:string;message:string;retryable:boolean;recovery:string}};
export type WorkStateClientResult<T extends JobSnapshot=JobSnapshot>=
  | {status:'confirmed';message:string;workState:RiffWorkState;job:T}
  | {status:'conflict';message:string;job:T}
  | {status:'failed'|'stale';message:string};

const object=(value:unknown):Record<string,unknown>|undefined=>{
  if(value===null||typeof value!=='object'||Array.isArray(value))return;
  const prototype=Object.getPrototypeOf(value);if(prototype!==Object.prototype)return;
  if(Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor=>!('value' in descriptor)||!descriptor.enumerable))return;
  return value as Record<string,unknown>;
};
const exact=(value:Record<string,unknown>,keys:string[])=>{
  const own=Reflect.ownKeys(value);
  return own.length===keys.length&&own.every(key=>typeof key==='string'&&keys.includes(key))
    &&keys.every(key=>Object.hasOwn(value,key));
};
const uuid=/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;
const sameUuid=(left:string,right:string)=>left.toLowerCase()===right.toLowerCase();
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
  try{
    const wrapped=parseStrictCallToolResult(raw);if(!wrapped)return;
    const value=object(wrapped.structuredContent),data=object(value?.data),state=object(data?.work_state);
    return value?.ok===true&&isBusinessResultFlagCoherent(wrapped,true)&&value&&exact(value,['ok','data'])
      &&data&&exact(data,['work_state'])&&state?parseRiffWorkState(state):undefined;
  }catch{return;}
};
const failure=(raw:unknown):Failure|undefined=>{
  try{
    const wrapped=parseStrictCallToolResult(raw);if(!wrapped)return;
    const value=object(wrapped.structuredContent),error=object(value?.error);
    const codes=['UNAUTHENTICATED','FORBIDDEN','VALIDATION_ERROR','NOT_FOUND','VERSION_CONFLICT','IDEMPOTENCY_CONFLICT','UNAVAILABLE'];
    const recoveries=['reauthorize','correct_input','reload','retry_same_request','contact_support'];
    if(value?.ok!==false||!isBusinessResultFlagCoherent(wrapped,false)||!exact(value,['ok','error'])
      ||!error||!exact(error,['code','message','retryable','recovery'])
      ||typeof error.code!=='string'||!codes.includes(error.code)||typeof error.message!=='string'||!error.message.trim()
      ||error.message.length>500||typeof error.retryable!=='boolean'||typeof error.recovery!=='string'||!recoveries.includes(error.recovery))return;
    return {ok:false,error:{code:error.code,message:error.message,retryable:error.retryable,recovery:error.recovery}};
  }catch{return;}
};
const sameWorkState=(left:RiffWorkState,right:RiffWorkState)=>sameUuid(left.job_id,right.job_id)
  &&sameUuid(left.variant_id,right.variant_id)&&left.state===right.state&&left.version===right.version&&left.updated_at===right.updated_at;

export function createRiffWorkStateClient<T extends JobSnapshot>(
  write:(input:SetRiffWorkStateInput)=>Promise<unknown>,
  reread:(jobId:string)=>Promise<T|undefined>,
){
  let generation=0;
  let pending:{key:string;input:SetRiffWorkStateInput}|undefined;
  const invalidate=()=>{generation++;pending=undefined;};
  const set=async(job:T,variantId:string,state:RiffWorkStateValue):Promise<WorkStateClientResult<T>>=>{
    const started=generation;
    const current=job.work_states.find(item=>sameUuid(item.variant_id,variantId));
    const expected=current?.version??0;
    const key=`${job.id.toLowerCase()}:${variantId.toLowerCase()}:${state}:${expected}`;
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
    if(!sameUuid(saved.job_id,job.id)||!sameUuid(saved.variant_id,variantId)||saved.state!==state||saved.version!==expected+1)
      return {status:'failed',message:'Riff returned a mismatched receipt. Refresh the saved job.'};
    let latest:T|undefined;
    try{latest=await reread(job.id);}catch{return started===generation
      ?{status:'failed',message:'Riff saved the request but could not reconcile the latest job. Try the same action again safely.'}
      :{status:'stale',message:'A newer Riff account or job is already shown.'};}
    if(started!==generation)return {status:'stale',message:'A newer Riff account or job is already shown.'};
    const reconciled=latest?.work_states.find(item=>sameUuid(item.variant_id,variantId));
    if(latest&&sameUuid(latest.id,job.id)&&reconciled&&reconciled.version>saved.version){
      pending=undefined;
      return {status:'conflict',message:'Riff changed again after that saved request. The latest saved state is shown.',job:latest};
    }
    if(!latest||!sameUuid(latest.id,job.id)||!reconciled||!sameWorkState(reconciled,saved))
      return {status:'failed',message:'Riff saved the request but could not reconcile the latest job. Try the same action again safely.'};
    pending=undefined;
    return {status:'confirmed',message:state==='saved'?'Saved for later.':state==='filmed'?'Marked as filmed.':'Save undone.',
      workState:saved,job:latest};
  };
  return {set,invalidate};
}
