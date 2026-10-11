/** Pure Workflow step policy, kept importable by local tests without Cloudflare runtime modules. */
export function creatorWorkflowStepOptions(name:string){
  if(!/^(?:provider|checkpoint|catalog):[\w:-]{1,240}$/.test(name)&&!/^attempt:outcome:[\w:-]{1,200}$/.test(name)&&!['load-job','save-dna','save-chat-draft','save-result','record-failure'].includes(name))
    throw new Error('Invalid creator workflow step');
  return {retries:{limit:name.startsWith('provider:')?0:2,delay:'1 second' as const,backoff:'exponential' as const},timeout:'10 minutes' as const};
}

type CreatorWorkflowStepLike={do<T>(name:string,options:ReturnType<typeof creatorWorkflowStepOptions>,run:()=>Promise<T>):Promise<T>};
export function createCreatorWorkflowDurableStep(step:CreatorWorkflowStepLike){
  return async <T>(name:string,run:()=>Promise<T>):Promise<T>=>{
    // Values crossing step boundaries are JSON receipts, never credentials or fetch handles.
    const value=await step.do(name,creatorWorkflowStepOptions(name),
      async()=>JSON.parse(JSON.stringify(await run())) as T);
    return value as T;
  };
}
