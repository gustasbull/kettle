import type { CreatorJobStatusView, CreatorJobView } from '../../packages/contracts/creator-pipeline.ts';
import {
  creatorJobStatusStructuredOutput,
  creatorJobStructuredOutput,
  creatorJobText,
  parseCreatorJobOutput,
  parseCreatorJobStatusOutput,
  parseGetCreatorJobInput,
} from './creator-pipeline-validation.ts';

type Selection={job_id:string};
const sameUuid=(left:string,right:string)=>left.toLowerCase()===right.toLowerCase();
export type CreatorPipelineSnapshot=CreatorJobView&{job:CreatorJobView;status?:CreatorJobStatusView};
export interface CreatorPipelineObserver {
  loading():void;
  job(snapshot:CreatorPipelineSnapshot,status:{refreshing:boolean;canRefresh:boolean;notice?:string}):void;
  notice?(message:string):void;
  cleared(reason:'reauthorize'|'unavailable'|'invalid'|'connection'):void;
}
export interface CreatorPipelineReaders {
  readStatus(input:Selection,signal:AbortSignal):Promise<unknown>;
  readFull(input:Selection,signal:AbortSignal):Promise<unknown>;
}
export interface CreatorPipelineLimits {
  timeoutMs?:number;pollIntervalMs?:number;maxPollIntervalMs?:number;maxPolls?:number;pollWindowMs?:number;
  random?:()=>number;
  performance?:{start(stage:'poll_observation'|'panel_render'):(status:'ok'|'error'|'timeout'|'rejected')=>void};
}

export {creatorJobStatusStructuredOutput,creatorJobStructuredOutput,creatorJobText} from './creator-pipeline-validation.ts';
const active=(state:CreatorJobView['state'])=>state==='queued'||state==='running';
const projectedStatus=(job:CreatorJobView):CreatorJobStatusView=>({id:job.id,kind:job.kind,state:job.state,stage:job.stage,
  revision:job.revision,created_at:job.created_at,updated_at:job.updated_at,progress:structuredClone(job.progress),
  terminal_result_available:job.state==='succeeded'});
const fingerprint=(status:CreatorJobStatusView)=>JSON.stringify(status);

/** Shared, provider-free observer. Compact status is the only automatic read; a
 * full job is read on an input-only open and once for a new successful terminal revision. */
export function createCreatorPipelineController(
  observer:CreatorPipelineObserver,
  suppliedReaders:CreatorPipelineReaders|((input:Selection,signal:AbortSignal)=>Promise<unknown>),
  limits:CreatorPipelineLimits={},
){
  const legacy=typeof suppliedReaders==='function';
  let legacyTerminal:unknown;
  const readers:CreatorPipelineReaders=legacy?{
    async readStatus(input,signal){
      const raw=await suppliedReaders(input,signal),parsed=parseCreatorJobOutput(raw);
      if(!parsed||!parsed.ok)return raw;
      if(job&&(parsed.data.job.project_id!==job.project_id||parsed.data.job.kind!==job.kind||parsed.data.job.created_at!==job.created_at))return raw;
      if(parsed.data.job.state==='succeeded')legacyTerminal=raw;
      return {ok:true,data:{status:projectedStatus(parsed.data.job)}};
    },
    async readFull(input,signal){
      if(legacyTerminal!==undefined){const value=legacyTerminal;legacyTerminal=undefined;return value;}
      return suppliedReaders(input,signal);
    },
  }:suppliedReaders;
  const timeoutMs=limits.timeoutMs??10_000,pollIntervalMs=limits.pollIntervalMs??2_000;
  const maxPollIntervalMs=limits.maxPollIntervalMs??15_000,maxPolls=limits.maxPolls??42,pollWindowMs=limits.pollWindowMs??600_000;
  const random=limits.random??Math.random;
  if(![timeoutMs,pollIntervalMs,maxPollIntervalMs,pollWindowMs].every(value=>Number.isFinite(value)&&value>0)
    ||!Number.isSafeInteger(maxPolls)||maxPolls<0)throw new Error('Invalid observation limits');
  let selection:Selection|undefined,job:CreatorJobView|undefined,status:CreatorJobStatusView|undefined;
  let connected=false,tools=false,blocked=false,disposed=false,hidden=false,paused=false;
  let epoch=0,polls=0,unchanged=0,started=0,terminalRevision:number|undefined;
  let pending:{kind:'status'|'full';abort:AbortController}|undefined;
  let pollTimer:ReturnType<typeof setTimeout>|undefined,initialTimer:ReturnType<typeof setTimeout>|undefined;
  const stopPoll=()=>{if(pollTimer!==undefined)clearTimeout(pollTimer);pollTimer=undefined;};
  const stopInitial=()=>{if(initialTimer!==undefined)clearTimeout(initialTimer);initialTimer=undefined;};
  const inWindow=()=>Date.now()-started<pollWindowMs;
  function invalidate(){epoch++;pending?.abort.abort();pending=undefined;stopPoll();}
  function clear(reason:Parameters<CreatorPipelineObserver['cleared']>[0]){
    invalidate();stopInitial();job=undefined;status=undefined;blocked=true;observer.cleared(reason);
  }
  function snapshot():CreatorPipelineSnapshot|undefined{
    if(!job)return;
    return Object.assign({...job},{job:structuredClone(job),...(status?{status:structuredClone(status)}:{})});
  }
  function publish(notice?:string){
    const value=snapshot();if(!value||!connected)return;
    if(notice&&observer.notice){observer.notice(notice);return;}
    const finish=limits.performance?.start('panel_render');
    observer.job(value,{refreshing:!!pending,canRefresh:tools,...(notice?{notice}:{})});finish?.('ok');
  }
  function loading(){stopInitial();observer.loading();initialTimer=setTimeout(()=>clear('connection'),timeoutMs);}
  function queueInitialFull(){
    stopInitial();
    initialTimer=setTimeout(()=>{initialTimer=undefined;void readFull(undefined,false);},0);
  }
  function pauseAtDeadline(){paused=true;publish('Automatic updates paused. Refresh or reopen in chat to check this saved job.');}
  function nextDelay(){
    const base=Math.min(maxPollIntervalMs,pollIntervalMs*(1.6**unchanged));
    if(legacy)return Math.max(1,Math.round(Math.min(maxPollIntervalMs,pollIntervalMs*(1.6**polls))));
    const sample=Math.min(1,Math.max(0,random()));
    return Math.min(15_000,Math.max(250,Math.round(base*(.8+.4*sample))));
  }
  function schedule(){
    stopPoll();
    const state=status?.state??job?.state;
    if(disposed||blocked||paused||hidden||!connected||!tools||!job||!state||!active(state)||pending)return;
    if(polls>=maxPolls||!inWindow()){pauseAtDeadline();return;}
    const delay=nextDelay(),remaining=pollWindowMs-(Date.now()-started);
    pollTimer=setTimeout(()=>{pollTimer=undefined;if(!inWindow()){pauseAtDeadline();return;}void readStatus(true);},Math.min(delay,Math.max(1,remaining)));
  }
  function statusIdentityMatches(next:CreatorJobStatusView){
    return !!selection&&!!job&&sameUuid(selection.job_id,next.id)&&sameUuid(job.id,next.id)&&job.kind===next.kind&&job.created_at===next.created_at;
  }
  function fullMatchesObservedStatus(next:CreatorJobView){
    return !status||next.revision!==status.revision||fingerprint(projectedStatus(next))===fingerprint(status);
  }
  function failed(raw:unknown,automatic:boolean){
    const parsed=parseCreatorJobStatusOutput(raw)??parseCreatorJobOutput(raw);
    if(!parsed)return 'invalid' as const;
    if(parsed.ok)return 'invalid' as const;
    if(parsed.error.code==='UNAVAILABLE'&&automatic&&job){paused=true;publish('Updates paused. Refresh or reopen in chat to try again.');return 'transient' as const;}
    clear(parsed.error.code==='UNAUTHENTICATED'?'reauthorize':'unavailable');return 'error' as const;
  }
  async function readFull(expectedRevision?:number,automatic=false){
    if(disposed||blocked||!connected||!tools||!selection||pending)return;
    stopPoll();const requestEpoch=++epoch,abort=new AbortController();pending={kind:'full',abort};
    let timer:ReturnType<typeof setTimeout>|undefined,timedOut=false;
    try{
      const raw=await Promise.race([readers.readFull({...selection},abort.signal),new Promise<never>((_resolve,reject)=>{
        abort.signal.addEventListener('abort',()=>reject(new Error('Cancelled')),{once:true});
        timer=setTimeout(()=>{timedOut=true;abort.abort();},timeoutMs);
      })]);
      if(disposed||requestEpoch!==epoch)return;
      pending=undefined;const parsed=parseCreatorJobOutput(raw);
      if(!parsed){if(expectedRevision!==undefined){paused=true;publish('A saved result could not be verified. Refresh or reopen in chat.');}else clear('invalid');return;}
      if(!parsed.ok){
        if(parsed.error.code==='UNAVAILABLE'&&job){paused=true;publish('Updates paused. Refresh or reopen in chat to try again.');return;}
        clear(parsed.error.code==='UNAUTHENTICATED'?'reauthorize':'unavailable');return;
      }
      const next=parsed.data.job;
      if(!selection||!sameUuid(next.id,selection.job_id)||(job&&(!sameUuid(next.project_id,job.project_id)||next.kind!==job.kind||next.created_at!==job.created_at))
        ||expectedRevision!==undefined&&(next.revision!==expectedRevision||next.state!=='succeeded')||!fullMatchesObservedStatus(next)){
        if(expectedRevision!==undefined){paused=true;publish('A mismatched saved result was ignored. Refresh or reopen in chat.');}
        else clear('invalid');return;
      }
      if(job&&next.revision<job.revision){publish('An older response was ignored. Refresh or reopen in chat.');schedule();return;}
      job=next;status=projectedStatus(next);if(next.state==='succeeded')terminalRevision=next.revision;
      stopInitial();paused=false;publish();
      if(active(next.state)&&expectedRevision===undefined&&!legacy&&maxPolls>0)void readStatus(true);
      else schedule();
    }catch{
      if(disposed||requestEpoch!==epoch)return;pending=undefined;
      if(timedOut&&job){paused=true;publish('Updates timed out. Refresh or reopen in chat to try again.');}
      else if(timedOut)clear('connection');
      else if(expectedRevision!==undefined&&job){paused=true;publish('The saved result could not be loaded. Refresh or reopen in chat to try again.');}
      else clear('connection');
    }finally{if(timer!==undefined)clearTimeout(timer);}
  }
  async function readStatus(automatic=false){
    if(disposed||blocked||!connected||!tools||!selection||!job||pending)return;
    stopPoll();if(!automatic)paused=false;
    const requestEpoch=++epoch,abort=new AbortController();pending={kind:'status',abort};polls++;
    let timer:ReturnType<typeof setTimeout>|undefined,timedOut=false;
    const finish=limits.performance?.start('poll_observation');
    try{
      const raw=await Promise.race([readers.readStatus({...selection},abort.signal),new Promise<never>((_resolve,reject)=>{
        abort.signal.addEventListener('abort',()=>reject(new Error('Cancelled')),{once:true});
        timer=setTimeout(()=>{timedOut=true;abort.abort();},timeoutMs);
      })]);
      if(disposed||requestEpoch!==epoch){finish?.('rejected');return;}
      pending=undefined;const parsed=parseCreatorJobStatusOutput(raw);
      if(!parsed){const outcome=failed(raw,automatic);finish?.(outcome==='invalid'?'rejected':outcome==='transient'||outcome==='error'?'error':'rejected');if(outcome==='invalid')clear('invalid');return;}
      if(!parsed.ok){
        if(parsed.error.code==='UNAVAILABLE'&&job){
          if(legacy){paused=true;publish('Updates paused. Refresh or reopen in chat to try again.');}
          else{unchanged++;publish('Updates are delayed. Riff will retry this saved job.');schedule();}
          finish?.('error');return;
        }
        clear(parsed.error.code==='UNAUTHENTICATED'?'reauthorize':'unavailable');finish?.('error');return;
      }
      const next=parsed.data.status;
      if(!statusIdentityMatches(next)){finish?.('rejected');if(legacy)clear('invalid');else{paused=true;publish('A mismatched update was ignored. Refresh or reopen in chat.');}return;}
      const current=status??projectedStatus(job);
      if(next.revision<current.revision){finish?.('rejected');if(legacy){paused=true;publish('An older response was ignored. Refresh or reopen in chat.');}else schedule();return;}
      if(next.revision===current.revision){
        if(fingerprint(next)!==fingerprint(current)){finish?.('rejected');if(legacy)clear('invalid');else{paused=true;publish('A contradictory update was ignored. Refresh or reopen in chat.');}return;}
        unchanged++;finish?.('ok');
        if(!active(next.state)){
          stopPoll();
          if(next.terminal_result_available&&terminalRevision!==next.revision)void readFull(next.revision,true);
          return;
        }
        schedule();return;
      }
      if(!active(current.state)&&active(next.state)){finish?.('rejected');if(legacy)clear('invalid');else{paused=true;publish('A contradictory update was ignored. Refresh or reopen in chat.');}return;}
      status=structuredClone(next);unchanged=0;publish();finish?.('ok');
      if(!active(next.state)){
        stopPoll();
        if(next.terminal_result_available&&terminalRevision!==next.revision)void readFull(next.revision,true);
        return;
      }
      schedule();
    }catch{
      if(disposed||requestEpoch!==epoch){finish?.('rejected');return;}pending=undefined;
      if(legacy){
        if(timedOut){finish?.('timeout');paused=true;publish('Updates timed out. Refresh or reopen in chat to try again.');}
        else{finish?.('error');clear('connection');}
      }else{
        finish?.(timedOut?'timeout':'error');unchanged++;
        publish(timedOut?'Updates timed out. Riff will retry this saved job.':'Updates are delayed. Riff will retry this saved job.');schedule();
      }
    }finally{if(timer!==undefined)clearTimeout(timer);}
  }
  loading();
  return {
    refresh:()=>readStatus(false),
    connected(supportsReads:boolean){
      if(disposed||blocked)return;connected=true;tools=supportsReads;publish();
      if(!tools)return;
      if(job&&active(status?.state??job.state)){if(legacy||maxPolls===0)schedule();else void readStatus(true);}
      else if(!job&&selection)queueInitialFull();
    },
    receiveInput(raw:unknown){
      if(disposed||blocked)return;const parsed=parseGetCreatorJobInput(raw);if(!parsed){clear('invalid');return;}
      invalidate();
      if(!selection||!sameUuid(selection.job_id,parsed.job_id)){job=undefined;status=undefined;polls=0;unchanged=0;started=Date.now();paused=false;terminalRevision=undefined;legacyTerminal=undefined;}
      selection=parsed;
      if(job){publish();schedule();}else loading();
      if(!job&&connected&&tools)queueInitialFull();
    },
    receiveResult(raw:unknown){
      if(disposed||blocked)return;invalidate();
      const parsed=parseCreatorJobOutput(raw);if(!parsed){clear('invalid');return;}
      if(!parsed.ok){clear(parsed.error.code==='UNAUTHENTICATED'?'reauthorize':'unavailable');return;}
      const next=parsed.data.job;
      if(!selection||!sameUuid(selection.job_id,next.id)||(job&&(!sameUuid(next.project_id,job.project_id)||next.kind!==job.kind||next.created_at!==job.created_at))){clear('invalid');return;}
      const observedRevision=status?.revision??job?.revision;
      const observedState=status?.state??job?.state;
      if(observedRevision!==undefined&&next.revision<observedRevision){paused=true;publish('An older response was ignored. Refresh or reopen in chat.');return;}
      if(!fullMatchesObservedStatus(next)){paused=true;publish('A contradictory saved result was ignored. Refresh or reopen in chat.');return;}
      if(job&&next.revision===job.revision&&JSON.stringify(next)!==JSON.stringify(job)){clear('invalid');return;}
      if(observedState&&!active(observedState)&&active(next.state)){clear('invalid');return;}
      job=structuredClone(next);status=undefined;stopInitial();
      if(active(next.state)){polls=0;unchanged=0;started=Date.now();paused=false;terminalRevision=undefined;}
      else if(next.state==='succeeded')terminalRevision=next.revision;
      publish();
      if(connected&&tools&&active(next.state)){if(legacy||maxPolls===0)schedule();else void readStatus(true);}
    },
    visibilityChanged(value:boolean){
      if(disposed||blocked||hidden===value)return;hidden=value;stopPoll();
      if(!hidden&&job&&active(status?.state??job.state)){
        if(!inWindow())pauseAtDeadline();else void readStatus(true);
      }
    },
    pagehide(){invalidate();},
    reset(){
      if(disposed)return;invalidate();stopInitial();job=undefined;status=undefined;selection=undefined;blocked=false;paused=false;
      polls=0;unchanged=0;terminalRevision=undefined;legacyTerminal=undefined;
    },
    connectionFailed(){if(!disposed&&!blocked)clear('connection');},
    dispose(){if(disposed)return;disposed=true;invalidate();stopInitial();job=undefined;status=undefined;selection=undefined;},
  };
}
