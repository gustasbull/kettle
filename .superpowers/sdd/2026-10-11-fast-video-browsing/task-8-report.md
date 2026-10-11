# Task 8 report: classify creator provider outcomes

## Delivered

- Added a closed internal provider-attempt taxonomy that separates conclusive unusable results (`failed`) from uncertain completion/spend (`needs_reconciliation`). Arbitrary exception text is never classified as definite.
- Moved terminal outcome persistence outside every zero-retry `provider:*` Workflow step into a retryable `attempt:outcome:*` step. Durable outcome replay wins over receipts and never executes the provider again.
- Added append-only `creator_attempt_outcomes`, service-only write/read RPCs, exact replay/conflict behavior, receipt/outcome compatibility checks, successful-finish protection, and atomic stopped-workflow reconciliation.
- Preserved existing Riff project/run grants, provider trials, budget reservations, checkpoint progress, Task 5 stable attempt keys, and no-provider-retry behavior.
- Updated ScrapeCreators, Lightreel, and OpenAI adapter paths to record structured HTTP, malformed, schema-invalid, oversized, permission, unavailable, timeout, and network results at the matching stable key.
- Added a manual read-only ScrapeCreators usage-history report. It requires the exact `--confirm-usage-history-read-costs-1-credit` flag, performs one fixed-host/page GET, has strict time/size/schema bounds, uses globally one-to-one operation/time/status matching, and emits only redacted `matched`/`inconclusive` results. It is absent from MCP, runtime reconciliation, schedules, and public contracts.

## Security and invariants

- Outcome rows contain no account ID, URL, request/response body, credential, receipt, content, cost, grant, or refund assertion.
- Client roles have no table or RPC access. The service role has no direct insert/update/delete grant on outcomes; the definer RPC derives provider, operation, and timestamps from locked server rows.
- Definite semantic validation may follow a durable receipt; ambiguous and non-semantic transport outcomes cannot overwrite a receipt. Late receipt writes cannot overwrite any outcome.
- Stopped running jobs are never redispatched. Durable definite evidence settles them as failed; any unresolved attempt or ambiguous outcome settles them as needs-reconciliation.
- Usage-history evidence is diagnostic only. It performs no write, quota adjustment, retry, dispatch, or provider resubmission.

## Verification

- RED: focused application tests initially failed on the absent `CreatorAttemptError` contract before product implementation.
- PASS: 120/120 scoped contract, HTTP, application, database, provider, runtime, operator, MCP, and deferred-dispatch tests.
- PASS: `npm run test:db` — 13/13.
- PASS: final operator collision, status-compatibility, fixed-host, redaction, byte-bound, and fetch/body-deadline tests — 6/6.
- `npm run typecheck` reached TypeScript after successfully rebuilding all panel bundles and generating Worker types. It is currently blocked only by unrelated concurrent Task 7 panel edits in `apps/panel/creator-pipeline-validation.ts` and `apps/panel/creator-pipeline/index.ts`; Task 8 files produced no reported type errors.

## Not verified or changed

- No hosted Supabase migration, Cloudflare deployment, provider request, usage-history request, OAuth flow, or production MCP publication was performed.
- No allowance refund/release/debit settlement semantics were added; reservations and provider quotas remain unchanged pending the owner decision.
