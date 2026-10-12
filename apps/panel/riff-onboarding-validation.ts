import {
  isBusinessResultFlagCoherent,
  parseStrictCallToolResult,
  strictObjectShape,
} from './call-tool-result-validation.ts';

const accountId = (value: unknown): value is string => typeof value === 'string'
  && /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i.test(value);

/** Strict binding boundary for the read-only `show_riff_welcome` issuance.
 * The echoed ID is only a completion precondition; the server re-derives
 * ownership from the bearer credential before any write. */
export function parseWelcomeAccountBinding(raw: unknown): string | undefined {
  try {
    const envelope=parseStrictCallToolResult(raw);
    const result=strictObjectShape(envelope?.structuredContent,['steps','expected_account_id']);
    const steps=result?.steps;
    return envelope&&isBusinessResultFlagCoherent(envelope,true)&&result&&Array.isArray(steps)
      &&steps.length===3&&steps[0]==='Start'&&steps[1]==='Find'&&steps[2]==='Make'
      &&accountId(result.expected_account_id)?result.expected_account_id:undefined;
  } catch { return; }
}

/** Recognize only the canonical failure proving that this mounted welcome is
 * bound to a different verified account. Other failures remain ambiguous and
 * may be retried with the same request. */
export function parseWelcomeCompletionConflict(raw: unknown): boolean {
  try {
    const envelope=parseStrictCallToolResult(raw);
    const result=strictObjectShape(envelope?.structuredContent,['ok','error']);
    const error=strictObjectShape(result?.error,['code','message','retryable','recovery']);
    return !!envelope&&isBusinessResultFlagCoherent(envelope,false)&&result?.ok===false&&!!error
      &&error.code==='VERSION_CONFLICT'&&typeof error.message==='string'
      &&error.message.trim().length>0&&error.message.length<=500
      &&error.retryable===false&&error.recovery==='reload';
  } catch { return false; }
}
