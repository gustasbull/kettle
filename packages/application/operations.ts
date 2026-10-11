import { z } from 'zod';
import { Id, type ErrorCode, type Failure, toolContracts } from '../contracts/index.ts';

/** Implemented by Stage 2 after issuer/signature/audience/expiry/scopes validation
 * and mapping (issuer, subject) to an internal account. Never parse this from tool input. */
export interface IdentityVerifier {
  verify(credential: string): Promise<{ account_id: string; scopes: readonly string[] } | null>;
}
export interface ProjectRepository {
  call(operation: keyof typeof toolContracts, accountId: string, input: unknown): Promise<unknown>;
}
const errors: Record<ErrorCode, [string, Failure['error']['recovery']]> = {
  UNAUTHENTICATED: ['Connect or reauthorize your Riff account.', 'reauthorize'],
  FORBIDDEN: ['This action is not permitted for this account.', 'contact_support'],
  VALIDATION_ERROR: ['Check the required fields and their allowed values.', 'correct_input'],
  NOT_FOUND: ['This project is unavailable.', 'reload'],
  VERSION_CONFLICT: ['The project has changed. Reload before saving a new request.', 'reload'],
  IDEMPOTENCY_CONFLICT: ['This request ID was already used for different content. Use a new request ID.', 'correct_input'],
  UNAVAILABLE: ['Riff could not complete the request. Retry with the same request ID.', 'retry_same_request'],
};
export function failure(code: ErrorCode): Failure {
  const [message, recovery] = errors[code];
  return { ok: false, error: { code, message, recovery, retryable: code === 'UNAVAILABLE' } };
}

/** The verifier is a trusted composition dependency, not a configurable tool argument.
 * No fixture verifier is shipped in the Worker. All transports must use this boundary. */
export function createOperations(verifier: IdentityVerifier, repository: ProjectRepository) {
  return {
    async execute<K extends keyof typeof toolContracts>(
      operation: K, credential: string | null, rawInput: unknown,
    ): Promise<z.infer<(typeof toolContracts)[K]['output']> | Failure> {
      const contract = toolContracts[operation];
      if (!credential) return failure('UNAUTHENTICATED');
      let identity;
      try { identity = await verifier.verify(credential); }
      catch { return failure('UNAUTHENTICATED'); }
      if (!identity || !Id.safeParse(identity.account_id).success) return failure('UNAUTHENTICATED');
      if (!identity.scopes.includes(contract.scope)) return failure('FORBIDDEN');
      const input = contract.input.safeParse(rawInput);
      if (!input.success) return failure('VALIDATION_ERROR');
      try {
        const output = contract.output.parse(await repository.call(operation, identity.account_id, input.data));
        return output as z.infer<(typeof toolContracts)[K]['output']>;
      } catch {
        // Do not expose database errors, tokens, provider bodies or other customers' data.
        return failure('UNAVAILABLE');
      }
    },
  };
}
