import { z } from 'zod';
import type { RiffCreatorRepository } from '../application/riff-creator.ts';
import type {
  CanonicalRiffCreatorSource, ListRiffWorkInput, StartRiffCreatorInput,
} from '../contracts/riff-creator.ts';
import { createSupabaseRepository } from './supabase.ts';

export const RiffCreatorDevelopmentPolicy = z.strictObject({
  maxProfilesPerAccount: z.number().int().min(1).max(10),
  allowanceTtlSeconds: z.number().int().min(60).max(604_800),
});
export type RiffCreatorDevelopmentPolicy = z.infer<typeof RiffCreatorDevelopmentPolicy>;

type RiffCreatorStorageOperation = 'get_riff_creator_start' | 'start_riff_creator' | 'list_riff_work';

export function createRiffCreatorSupabaseRepository(
  baseUrl: string,
  serviceRoleKey: string,
  rawPolicy: RiffCreatorDevelopmentPolicy,
  fetcher: typeof fetch = fetch,
): RiffCreatorRepository {
  createSupabaseRepository(baseUrl, serviceRoleKey, fetcher);
  const policy = RiffCreatorDevelopmentPolicy.parse(rawPolicy);
  const call = async (
    operation: RiffCreatorStorageOperation,
    accountId: string,
    input: unknown,
  ) => {
    const response = await fetcher(new URL(`/rest/v1/rpc/kettle_${operation}`, baseUrl), {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000),
      headers: { 'Content-Type': 'application/json', apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
      body: JSON.stringify({ p_account_id: accountId, p_input: input }),
    });
    if (!response.ok) throw new Error('Riff creator storage unavailable');
    return response.json();
  };
  return {
    find: (accountId: string, input: StartRiffCreatorInput) => call('get_riff_creator_start', accountId, input),
    start: (accountId: string, input: StartRiffCreatorInput, source: CanonicalRiffCreatorSource) => call(
      'start_riff_creator', accountId, {
        input, source,
        max_profiles_per_account: policy.maxProfilesPerAccount,
        allowance_ttl_seconds: policy.allowanceTtlSeconds,
      },
    ),
    list: (accountId: string, input: ListRiffWorkInput) => call('list_riff_work', accountId, input),
  };
}
