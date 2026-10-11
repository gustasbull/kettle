import { z } from 'zod';

const Operation=z.enum(['profile','feed','video']);
const Timestamp=z.iso.datetime();
export const ReconciliationAttempt=z.strictObject({operation:Operation,attempted_at:Timestamp,
  terminal_state:z.enum(['needs_reconciliation']).nullable(),failure_code:z.enum(['timeout','network','receipt_persistence_failed','unknown_after_dispatch']).nullable(),
  http_status:z.number().int().min(100).max(599).nullable(),observed_at:Timestamp.nullable()});
export const UsageHistory=z.strictObject({complete:z.boolean(),candidates:z.array(z.strictObject({
  operation:Operation,observed_at:Timestamp,http_status:z.number().int().min(100).max(599),
})).max(100)});
export type ReconciliationReadRepository={list(input:{provider:'scrapecreators';attempted_after:string;attempted_before:string;limit:number}):Promise<unknown>};
export type UsageHistoryReader={read(page:number):Promise<unknown>};
export type ReconciliationOptions={page:number;attempted_after:string;attempted_before:string;limit:number};

export function parseReconciliationArguments(argv:readonly string[]):ReconciliationOptions|null{
  const expected=new Set(['--confirm-usage-history-read-costs-1-credit','--page','--attempted-after','--attempted-before','--limit']);
  const values=new Map<string,string>();
  for(let index=0;index<argv.length;index++){
    const key=argv[index]!;if(!expected.has(key)||values.has(key))return null;
    if(key==='--confirm-usage-history-read-costs-1-credit'){values.set(key,'true');continue;}
    const value=argv[++index];if(!value||value.startsWith('--'))return null;values.set(key,value);
  }
  if(values.size!==5)return null;
  const page=Number(values.get('--page')),limit=Number(values.get('--limit'));
  const attempted_after=values.get('--attempted-after')!,attempted_before=values.get('--attempted-before')!;
  if(!Number.isInteger(page)||page<1||page>100||!Number.isInteger(limit)||limit<1||limit>100||
    !Timestamp.safeParse(attempted_after).success||!Timestamp.safeParse(attempted_before).success||Date.parse(attempted_after)>=Date.parse(attempted_before))return null;
  return {page,attempted_after,attempted_before,limit};
}

export async function createReconciliationReport(options:ReconciliationOptions,repository:ReconciliationReadRepository,usage:UsageHistoryReader){
  const listed=z.strictObject({ok:z.literal(true),data:z.strictObject({attempts:z.array(ReconciliationAttempt).max(100)})})
    .safeParse(await repository.list({provider:'scrapecreators',attempted_after:options.attempted_after,
      attempted_before:options.attempted_before,limit:options.limit}));
  if(!listed.success)throw new Error('Reconciliation read unavailable');
  let history:z.infer<typeof UsageHistory>|null=null;
  try{const parsed=UsageHistory.safeParse(await usage.read(options.page));if(parsed.success)history=parsed.data;}catch{/* fail closed */}
  const candidates=history?.complete?history.candidates:[];
  const candidateIndexes=listed.data.data.attempts.map(attempt=>candidates.flatMap((candidate,index)=>candidate.operation===attempt.operation&&
    (attempt.http_status===null||candidate.http_status===attempt.http_status)&&Date.parse(candidate.observed_at)>=Date.parse(attempt.attempted_at)&&
    Date.parse(candidate.observed_at)<=Date.parse(attempt.attempted_at)+600_000?[index]:[]));
  const uses=new Map<number,number>();for(const indexes of candidateIndexes)for(const index of indexes)uses.set(index,(uses.get(index)??0)+1);
  const attempts=listed.data.data.attempts.map((attempt,index)=>{
    const matches=candidateIndexes[index]!;const unique=matches.length===1&&uses.get(matches[0]!)===1;
    return {ordinal:index+1,operation:attempt.operation,status:history?.complete&&unique?'matched' as const:'inconclusive' as const,
      reason:!history?.complete?'usage coverage was incomplete or invalid':unique?'one globally unique operation/time/status candidate':'candidate was absent, duplicated, shared, or status-incompatible'};
  });
  return {page:options.page,counts:{matched:attempts.filter(value=>value.status==='matched').length,
    inconclusive:attempts.filter(value=>value.status==='inconclusive').length},attempts,
    limitations:['Usage history is supporting evidence only; no local attempt identifier is sent to the provider.','This read-only report changes no product or quota state.']};
}

export async function runCreatorAttemptReconciliation(argv:readonly string[],deps:{repository:ReconciliationReadRepository;usage:UsageHistoryReader;write(line:string):void}){
  const options=parseReconciliationArguments(argv);if(!options)return 2;
  try{deps.write(JSON.stringify(await createReconciliationReport(options,deps.repository,deps.usage)));return 0;}
  catch{deps.write(JSON.stringify({status:'inconclusive',reason:'operator report unavailable'}));return 1;}
}
