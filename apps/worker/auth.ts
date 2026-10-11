import { createPipelineOperations } from '../../packages/application/creator-pipeline.ts';
import { createPipelineSupabaseRepository } from '../../packages/database/creator-pipeline-supabase.ts';
import { dispatchCreatorJob, pipelineConfigured } from './creator-pipeline-runtime.ts';
import { createCreatorOperations } from '../../packages/application/creator-operations.ts';
import { createCreatorSupabaseRepository } from '../../packages/database/creator-supabase.ts';
import { createOperations } from '../../packages/application/operations.ts';
import { discover, remoteMcpVerifier, remoteWebsiteSessionVerifier } from '../../packages/auth/index.ts';
import type { SupabaseWebsiteAccountReader } from '../../packages/auth/website.ts';
import { createSupabaseIdentityResolver, createSupabaseRepository } from '../../packages/database/supabase.ts';
import type { RuntimeAuthConfig } from './auth-config.ts';
export { authConfig } from './auth-config.ts';

export async function authServices(env: Env, config: RuntimeAuthConfig) {
  const metadata = await discover(config.mcp);
  const verifier = remoteMcpVerifier(config.mcp, metadata, createSupabaseIdentityResolver(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!));
  const operations = createOperations(verifier, createSupabaseRepository(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!));
  const creatorOperations = createCreatorOperations(verifier, createCreatorSupabaseRepository(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!));
  const pipelineOperations = createPipelineOperations(verifier, createPipelineSupabaseRepository(env.SUPABASE_URL!,env.SUPABASE_SERVICE_ROLE_KEY!), (id, accountId)=>dispatchCreatorJob(env,id,accountId),operation=>pipelineConfigured(env)&&operation!=='start_creator_scripts');
  return { config: config.mcp, metadata, verifier, operations, creatorOperations, pipelineOperations };
}

/** Resolve a password session through the same trusted issuer/subject mapping
 * used by MCP, without accepting account identity from website input. */
export function websiteAccountReader(env: Env, config: RuntimeAuthConfig): SupabaseWebsiteAccountReader {
  return async (session) => {
    const metadata = await discover(config.mcp);
    const verifier = remoteWebsiteSessionVerifier(
      config.mcp,
      metadata,
      createSupabaseIdentityResolver(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!),
    );
    const operations = createOperations(
      verifier,
      createSupabaseRepository(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!),
    );
    const result = await operations.execute('get_account_state', session.accessToken, {});
    if (!result.ok) throw new Error('Verified Riff account unavailable');
    return {
      id: result.data.account.id,
      displayName: result.data.account.display_name,
      state: result.data.account.state,
    };
  };
}
