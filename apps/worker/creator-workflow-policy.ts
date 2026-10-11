/** Pure Workflow step policy, kept importable by local tests without Cloudflare runtime modules. */
export function creatorWorkflowStepOptions(name:string){
  if(!/^(?:provider|checkpoint):[\w:-]{1,211}$/.test(name)&&!['load-job','save-dna','save-chat-draft','save-result','record-failure'].includes(name))
    throw new Error('Invalid creator workflow step');
  return {retries:{limit:name.startsWith('provider:')?0:2,delay:'1 second' as const,backoff:'exponential' as const},timeout:'10 minutes' as const};
}
