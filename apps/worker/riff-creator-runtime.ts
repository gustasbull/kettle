import { createRiffCreatorOperations, type RiffCreatorDispatch } from '../../packages/application/riff-creator.ts';
import type { IdentityVerifier } from '../../packages/application/operations.ts';
import { classifyTikTokCreatorSource, resolveTikTokCreatorSource } from '../../packages/adapters/creator-pipeline/tiktok-source.ts';
import {
  createRiffCreatorSupabaseRepository,
  type RiffCreatorDevelopmentPolicy,
} from '../../packages/database/riff-creator-supabase.ts';
import type { CreatorLatencyObserver } from '../../packages/application/creator-observability.ts';

export interface RiffCreatorRuntimeConfig extends RiffCreatorDevelopmentPolicy {
  supabaseUrl: string;
  serviceRoleKey: string;
}

/** Pure composition seam for auth.ts: no Cloudflare binding or account identity is accepted here. */
export function createRiffCreatorRuntime(
  config: RiffCreatorRuntimeConfig,
  verifier: IdentityVerifier,
  dispatch: RiffCreatorDispatch,
  isEnabled: () => boolean,
  fetcher: typeof fetch = fetch,
  telemetry?: CreatorLatencyObserver,
) {
  const repository = createRiffCreatorSupabaseRepository(config.supabaseUrl, config.serviceRoleKey, {
    maxProfilesPerAccount: config.maxProfilesPerAccount,
    allowanceTtlSeconds: config.allowanceTtlSeconds,
  }, fetcher, telemetry);
  return createRiffCreatorOperations(
    verifier,
    repository,
    sourceUrl => resolveTikTokCreatorSource(sourceUrl, fetcher),
    dispatch,
    isEnabled,
    telemetry,
    classifyTikTokCreatorSource,
  );
}
