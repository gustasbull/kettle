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

GREEN evidence on the final tree:

- `npx tsx --test tests/riff-work-state-client.test.ts tests/riff-work-state-database.test.ts tests/riff-work-state-mcp.test.ts`: 16/16 passed.
- `npx tsx --test tests/creator-pipeline-contracts.test.ts tests/riff-work-state-client.test.ts`: 15/15 passed.
- `node --test tests/panel/creator-pipeline.test.mjs`: 18/18 passed.
- `node --test tests/panel/creator-pipeline-bridge.test.mjs`: 14/14 passed, including exact five-field save and fresh-ID Undo with full-job reconciliation.
- `node --test tests/panel/riff-home-bridge.test.mjs`: 16/16 passed.
- `npm run test:db`: 13/13 passed.
- `npm run check`: exit 0. TypeScript and browser-safe bundles passed; the main test run passed 554/554; dry-run build and smoke passed; browser run passed 97/97.
- `git diff --check`: exit 0.

The PGlite migration tests exercise the real ordered migration files and transactional rollback, but PGlite does not prove multi-connection contention behavior in hosted Postgres.

## Migration and security review

Only `supabase/migrations/20261011091046_riff_work_state.sql` was added. No applied migration was edited and no database was reset.

- The RPC accepts exactly `{job_id,variant_id,state,expected_version,request_id}`. It checks JSON value types before UUID/numeric casts and accepts only an integral JSON number from 0 through 2147483646.
- Lock order is active account, owned creator job, projection, then receipt. The held owned-job lock serializes a variant mutation before receipt insertion.
- Receipt inspection occurs only after active-account, owned succeeded-script job, valid stored result, and real persisted variant lineage checks. Foreign, guessed, unfinished, non-script, or malformed lineage returns `NOT_FOUND` without receipt disclosure.
- Initial `active` is rejected. First `saved`/`filmed` creates version 1; later distinct transitions require the exact current version. Exact receipt replay remains byte-semantically equal after later transitions. A different valid-owned payload using the request ID returns `IDEMPOTENCY_CONFLICT`.
- Projection, event, and receipt writes occur inside one security-definer call. An injected receipt trigger failure returns `UNAVAILABLE`, rolls back projection/event, and permits an exact same-ID retry.
- Events and receipts have complete account/job/projection relationships, state/version checks, request uniqueness, JSON object/size/success checks, RLS, and append-only owner-level triggers. Client roles receive no access. `service_role` receives projection SELECT plus RPC EXECUTE only and is separately proven unable to perform direct DML.
- Public/application projections expose only strict `work_states`; account IDs, event rows, receipt input/output, request IDs, and the service credential are not forwarded to public creator-job or recent-work views.
- Account identity is derived solely by the trusted verifier. The repository calls one fixed service-role RPC and never accepts account ownership from tool input.

## Application, MCP, and UI

- Added cycle-free work-state contracts, verified application operation, and fixed Supabase adapter.
- Added `riffWorkStateOperations` to runtime composition, capability-keyed descriptor catalogs, registration, listing, and dispatch. Advertisement and handler availability share the same capability bit.
- `StoredCreatorJob` and `CreatorJobView` default historical `work_states` to `[]`; `publicCreatorJob` forwards the field explicitly. Recent work defaults `variant_id` and `work_state` to null. Both browser validators enforce exact public keys and job/variant lineage.
- Both bridges use one strict browser-safe mutation client. It retains the complete input and request ID across ambiguous retry, discards intent on conflict and rereads truth, accepts success only after a strict receipt and matching full `get_creator_job`, and invalidates late work across account/job/variant/teardown boundaries.
- Recent summaries carry the validated variant into full-job presentation and derive `Analysis ready`, `Formats ready`, `Continue script`, `Ideas saved`, or `Filmed` only from stored job/work-state truth. Standalone and Home reopen select the latest valid persisted variant; first-variant fallback occurs only without valid persisted selection.
- Mutation controls are disabled while pending. Saved confirmation remains until reconciled Undo succeeds. `filmed` stays in Studio with a factual persisted status. Open vault routes to Home in the embedded surface and uses an honest Home/My videos handoff in the standalone surface.

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

Commit: `feat: persist Riff work state` (hash recorded in the integration handoff).
