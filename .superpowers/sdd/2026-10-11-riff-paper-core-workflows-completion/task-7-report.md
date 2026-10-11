# Task 7 report — durable Riff work state

## Outcome

Implemented durable `active` / `saved` / `filmed` state for persisted Riff script variants, including optimistic versions, exact request receipts, append-only history, owned lineage validation, MCP registration, additive full/recent projections, selected-variant resume, strict bridge reconciliation, the Paper Saved confirmation, real Undo, factual filmed treatment, and Home-backed Open vault behavior.

No provider execution, script rewriting, publication, remote migration, deployment, resource-v4 bump, or Paper mutation was performed.

## TDD evidence

RED was observed before implementation:

- `npx tsx --test tests/riff-work-state-mcp.test.ts tests/riff-work-state-database.test.ts`: 11 tests, 0 passed, 11 failed on the absent contract/application/adapter/MCP/migration surfaces. The database fixture was then corrected to complete real creator jobs; `npx tsx --test tests/riff-work-state-database.test.ts` produced 7/7 feature-specific failures for the absent RPC/tables/projections.
- `npx tsx --test tests/riff-work-state-client.test.ts`: 2 tests, 0 passed, 2 failed because the retry/reconciliation client did not exist.
- `node --test tests/panel/creator-pipeline.test.mjs`: the new nested Saved-confirmation acceptance test failed because `.riff-saved-confirmation` did not exist.
- Final audit tests also failed before their fixes: public projection lineage plus strict receipt timestamp/range checks failed 2/2; recent-label/creation-timestamp/contract-map checks failed 3/3; and the new standalone bridge save/reconcile/Undo acceptance timed out before the receipt fixture existed.

The review-hardening round added tests first and observed these additional failures:

- The database suite passed only 3/9 after adding malformed receipt probes and a stored uppercase UUIDv7 variant. It exposed a nullable receipt check, UUID v1-v5-only validation, and text-based variant projection matching.
- The browser client passed 5/8 after adding direct/hostile envelope, UUIDv7 casing, and old-success replay cases. Home validation could not load the requested legacy parser, while standalone validation passed 23/24 because omitted historical `work_states` was rejected.
- Creator component acceptance passed 16/18 and Home component acceptance passed 3/4 before honest Open vault results and saved-card focus existed. The focused Home bridge lifecycle test passed 0/1 before mutation-driven recent refresh and explicit controller reset/reopen behavior were implemented.
- The new controller UUIDv7 case-identity test passed 0/1 before UUID identity comparisons were made semantic.

GREEN evidence on the final tree:

- `npx tsx --test tests/riff-work-state-client.test.ts tests/riff-work-state-database.test.ts tests/riff-work-state-mcp.test.ts`: 21/21 passed.
- `npx tsx --test tests/creator-pipeline-contracts.test.ts tests/panel/creator-pipeline-controller.test.ts tests/panel/creator-pipeline-validation.test.ts tests/panel/riff-home-validation.test.ts`: 78/78 passed.
- `node --test tests/panel/creator-pipeline.test.mjs`: 18/18 passed.
- `node --test tests/panel/creator-pipeline-bridge.test.mjs`: 15/15 passed, including exact five-field save, fresh-ID Undo, legacy-job rendering, exact standalone vault context, and rejected-handoff reporting.
- `node --test tests/panel/riff-home.test.mjs`: 4/4 passed, including embedded saved-card focus.
- `node --test tests/panel/riff-home-bridge.test.mjs`: 17/17 passed, including the save/Undo/filmed recent-state lifecycle and failed recent-refresh reporting.
- The focused review matrix therefore passed 153/153.
- `npm run typecheck`: exit 0.
- `npm run test:db`: 13/13 passed.
- `npm run check`: exit 0. TypeScript and browser-safe bundles passed; the main test run passed 562/562; dry-run build and smoke passed; browser run passed 100/100.
- `git diff --check`: exit 0.

The PGlite migration tests exercise the real ordered migration files and transactional rollback, but PGlite does not prove multi-connection contention behavior in hosted Postgres.

## Migration and security review

The Task 7 migration, `supabase/migrations/20261011091046_riff_work_state.sql`, remains the only migration introduced. It is still local and unapplied; no applied migration was edited and no database was reset.

- The RPC accepts exactly `{job_id,variant_id,state,expected_version,request_id}`. It checks JSON value types and full UUID v1-v8/nil/max syntax before UUID casts, and accepts only an integral JSON number from 0 through 2147483646.
- Lock order is active account, owned creator job, projection, then receipt. The held owned-job lock serializes a variant mutation before receipt insertion.
- Receipt inspection occurs only after active-account, owned succeeded-script job, valid stored result, and real persisted variant lineage checks. Foreign, guessed, unfinished, non-script, or malformed lineage returns `NOT_FOUND` without receipt disclosure.
- Initial `active` is rejected. First `saved`/`filmed` creates version 1; later distinct transitions require the exact current version. Exact receipt replay remains byte-semantically equal after later transitions. A different valid-owned payload using the request ID returns `IDEMPOTENCY_CONFLICT`.
- Projection, event, and receipt writes occur inside one security-definer call. An injected receipt trigger failure returns `UNAVAILABLE`, rolls back projection/event, and permits an exact same-ID retry.
- Events and receipts have complete account/job/projection relationships, state/version checks, request uniqueness, strict JSON object/size/boolean-success/nested-work-state checks, RLS, and append-only owner-level triggers. The complete receipt predicate must evaluate `TRUE`, so missing paths cannot pass through SQL `NULL`. Client roles receive no access. `service_role` receives projection SELECT plus RPC EXECUTE only and is separately proven unable to perform direct DML.
- Public/application projections expose only strict `work_states`; account IDs, event rows, receipt input/output, request IDs, and the service credential are not forwarded to public creator-job or recent-work views.
- Stored UUID variants are compared as UUID values after syntax validation, and full-job projections emit the canonical persisted UUID from the work-state row. Uppercase stored UUIDv7 values therefore reconcile without weakening lineage checks.
- Account identity is derived solely by the trusted verifier. The repository calls one fixed service-role RPC and never accepts account ownership from tool input.

## Application, MCP, and UI

- Added cycle-free work-state contracts, verified application operation, and fixed Supabase adapter.
- Added `riffWorkStateOperations` to runtime composition, capability-keyed descriptor catalogs, registration, listing, and dispatch. Advertisement and handler availability share the same capability bit.
- `StoredCreatorJob` and `CreatorJobView` default historical `work_states` to `[]`; `publicCreatorJob` forwards the field explicitly. Recent work defaults `variant_id` and `work_state` to null. Both browser validators enforce exact public keys and semantic UUID job/variant lineage. The shared legacy display parser now clones and normalizes an omitted historical `work_states` field to `[]` without mutating transport input or accepting extra keys.
- Both bridges use one strict browser-safe mutation client. It accepts only a real `CallToolResult` wrapper, rejects direct inner values plus accessor, symbol, hidden, and extra properties, and requires the complete public success or failure shape. It retains the complete input and request ID across ambiguous retry, discards intent on conflict and rereads truth, accepts success only after a strict receipt and matching full `get_creator_job`, refreshes newer truth on an old successful replay, and invalidates late work across account/job/variant/teardown boundaries.
- Recent summaries carry the validated variant into full-job presentation and derive `Analysis ready`, `Formats ready`, `Continue script`, `Ideas saved`, or `Filmed` only from stored job/work-state truth. Standalone and Home reopen select the latest valid persisted variant; first-variant fallback occurs only without valid persisted selection.
- Mutation controls are disabled while pending. Saved confirmation remains until reconciled Undo succeeds. `filmed` stays in Studio with a factual persisted status. Every confirmed or conflict result refreshes Home recents, then explicitly reopens authoritative full-job state while preserving the selected variant; refresh failure is reported without hiding the confirmed mutation.
- Open vault routes to Home in the embedded surface, finds the exact job-and-variant recent card, focuses it, and reports pending/failure honestly. The standalone surface sends both exact IDs and returns the host's actual handoff result instead of hard-coding success.

## Paper verification

The direct Paper file `01M39TTB7DKFHZY2JVDMAEDZ81`, page `p-5-0`, was opened read-only and identified as `Riff · Core workflows`. Direct exact-node/style queries for Saved node `YBB-0` were attempted, but Paper returned `Edit access is required to use MCP for this file.` No screenshot was used and Paper was not mutated.

Implementation therefore followed the exact audited handoff evidence: responsive `min(576px,100%)`, 24px padding, 18px radius, 12px gap, 1px gray border, dotted/pastel treatment, exact copy `Your viral script, saved.` and `My videos · Reference and ready-to-film script saved.`, 44px actions, and the audited 103px / 99px action widths.

## Files

Created:

- `supabase/migrations/20261011091046_riff_work_state.sql`
- `packages/contracts/riff-work-state.ts`
- `packages/application/riff-work-state.ts`
- `packages/database/riff-work-state-supabase.ts`
- `apps/panel/riff-work-state-client.ts`
- `tests/riff-work-state-{mcp,database,client}.test.ts`

Updated the creator-job/recent contracts and projections, worker auth/MCP catalogs/dispatch, both panel bridges and strict validators, Studio/Home renderers, styles, contract and bridge acceptance tests, and affected fixtures. Generated panel bundles were produced only through `npm run build:panel`; immutable resource identities remain v3.

## Concerns and handoff

- Task 7 source is intentionally not independently deployable under immutable v3 resources. Task 8 owns the atomic v4 publication.
- Hosted multi-connection contention remains unproved by PGlite and should be exercised in Stage 2 Postgres verification.
- Exact Paper node inspection was blocked by file permissions; the supplied audited node evidence is recorded above.

Initial commit: `feat: persist Riff work state`. Review hardening commit: `fix: harden Riff work state lifecycle` (hashes recorded in the integration handoff).
