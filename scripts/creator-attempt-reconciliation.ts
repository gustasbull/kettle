import { runCreatorAttemptReconciliation } from '../packages/application/creator-attempt-reconciliation.ts';
import { createScrapeCreatorsUsageReader } from '../packages/adapters/creator-pipeline/scrapecreators-usage.ts';
import { createCreatorAttemptReconciliationRepository } from '../packages/database/creator-attempt-reconciliation-supabase.ts';

const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY,providerKey=process.env.SCRAPECREATORS_API_KEY;
if(!url||!key||!providerKey)process.exitCode=2;
else process.exitCode=await runCreatorAttemptReconciliation(process.argv.slice(2),{
  repository:createCreatorAttemptReconciliationRepository(url,key),usage:createScrapeCreatorsUsageReader(providerKey),write:value=>process.stdout.write(`${value}\n`),
});
