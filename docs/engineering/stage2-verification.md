# Stage 2 implementation and evidence — 2026-10-06

## Hosted acceptance update — Bangkok, 2026-10-06

This update supersedes the historical deployment/authentication blockers below.
Stage 2 remains in progress: provider revocation and live generation evaluation
are not complete. Earlier local and specialist reports retain their original scope.

### Deployment and lead-observed evidence

- Development origin: `https://kettle-stage2-development.g-baltramiejunas.workers.dev`.
- Auth0 issuer: `https://kettle.eu.auth0.com/`; separate website and ChatGPT clients.
- Worker code: `7db5b4c9818704d537184fadf297b0a6728be42c`, deployed version
  `561bc669-5385-42e4-a021-ae611a2a921c`. PR #4 contains this runtime fix.
- Hosted development Supabase migrations `20261006140000` and `20261006150000`
  were verified applied during setup; the identity RPC rejected invalid input.
- The lead observed successful health and protected-resource metadata responses,
  an Auth0 S256 login redirect, anonymous MCP listing/diagnostic, and invalid-bearer
  rejection after deployment. These checks alone do not establish user OAuth success.
- Credentials remain in provider/Worker secret settings; no credential values are
  included in this evidence. No production deployment or live provider calls occurred.

### User-executed hosted checks

The following results were reported by the user in the Bangkok conversation.
They were not independently replayed by the lead with the user's credentials.

| Check | Reported result and evidence strength |
| --- | --- |
| Website/ChatGPT identity | Successful login through both clients resolved to account A, `c4e83ed5-41e7-4fc8-b3b7-eca3f3312c5d`. Website reauthentication retained that ID. |
| Persistence and versioned update | “Desk lamp test”, project `84c88837-a9d7-4b28-984e-c8c5db51d2ed`, was saved at version 1, reopened in another conversation, updated to version 2 with friendly/practical tone, and reopened with that version and tone. |
| Second identity | Private-browser login returned account B, `4dbb320b-9a7c-4d8f-85ed-75498cb577d1`, distinct from A. An initial generic callback failure cleared after restarting sign-in; its cause was not established. |
| Cross-account read | B's website API request for A's project returned the pasted JSON `NOT_FOUND`, “This project is unavailable.” No project content was returned. |
| Website expiry and refresh | User pasted `UNAUTHENTICATED` after the instructed wait beyond the configured five-minute access lifetime, then confirmed refresh restored B without another login and the project request again returned `NOT_FOUND`. |
| Website logout | User confirmed the account page rejected access after signing out. This establishes local logout, not provider-side revocation. |
| Cross-account write | User reported step 1 passed: B could not modify A's project and A remained at version 2. No write request/response transcript was supplied; this is a reported pass, not an independently audited hosted write test. |
| ChatGPT refresh continuity | User reported step 2 passed: after the instructed six-minute idle period, a new conversation retrieved version 2 without reconnection. No token-exchange trace was captured, so refresh-token rotation itself is not independently verified. |

### PR #4 review and remaining limits

Review found no blocking issue in the redirect change: all changed outbound calls use
`manual`, and existing non-2xx guards reject redirects without forwarding credentials.
The workerd smoke now constructs actual Requests for discovery and token exchange and
checks that discovery rejects a 302. This addresses the runtime incompatibility that
mock-only transports missed. See [Cloudflare Request documentation](https://developers.cloudflare.com/workers/runtime-apis/request/).

On this review, a fresh `npm run check` passed (53 tests, TypeScript, dry-run Worker
build, and workerd smoke), as did `git diff --check`. Existing PR CI for `7db5b4c`
also passed. The acceptance documentation adds no runtime changes.

Still open: controlled provider grant/refresh-token revocation; hosted local identity
cutoff/block; provider-issued insufficient-scope denial; and retained request/response
evidence for the reported hosted write-isolation check. Do not infer immediate global
logout or invalidation of copied access tokens from the successful local logout test.

Live generation/reference evaluation still requires credentials and permitted-use
evidence. Authorized aggregate provider cap remains $25; no live provider calls or
provider spend occurred in this lead session. The fixture Workflow does not establish
full A44 job reconciliation, cancellation, or usage settlement.

## Historical integration evidence

PR review follow-up: fixed local logout when authorization-server discovery fails,
while retaining same-origin POST checks and reporting remote revocation as unconfirmed.
`npm run check` passed on Node 22.23.3 with 41 tests, TypeScript, bundle and workerd smoke.
The historical 40-test integration run below predates this regression test.

Stage 2 is **in progress, not complete**. The local database gap is closed. Real
ChatGPT OAuth and live generation/provider evaluation still have external dependencies.

## Starting point and ownership

The lead personally verified that HEAD `e90e995` contains foundation `563b3ed` and
reran `npm run check`: the original 17 tests, TypeScript, dry-run Worker bundle,
MCP smoke and local Workflow all passed. The attachment's Docker/Supabase status
was older than the repository: hosted Supabase had already been reported verified.
Docker 29.7.2 was available during this run.

Two bounded implementation agents worked in this same foundation-containing checkout.
A owned auth/website/MCP and its tests; B owned generation/reference adapters and
evaluations. The lead owned configuration, dependencies, migrations, database proof,
integration and independent review. No branch was renamed. No additional workspaces,
secret copies, remote reset, production deployment or public listing were created.

## Personally verified database results

`npm run db:start` started the path-derived local Supabase stack, applying the
foundation migration and fictional seed. `npm run db:migrate` appended
`20261006150000_identity_mapping.sql`. No applied migration was edited.

`npm run db:test` passed against the actual local PostgREST and PostgreSQL services:

- Account-scoped saves and reads, including read from a fresh Node application process.
- Immutable receipt replay, stale-version and changed-payload request-ID rejection.
- Cross-account read/write denial.
- Four simultaneous HTTP saves produce one result; competing edits produce one winner.
- A receipt-insert failure rolls back the updated pointer and inserted brief; retry
  with the identical request succeeds. The test trigger targets one generated account/request.
- Concurrent first-login resolution creates one identity/account; cutoff and block
  deny resolution; client roles cannot execute the mapping RPC.
- Generated test records and trigger removed; existing data preserved.

Observed local test duration: 721 ms including child-process and SQL overhead. This
is not a product benchmark. This test validates persistence across an application
process replacement, not a database restart or a hosted Worker restart.

The lead also personally reran `KETTLE_TEST_PROJECT_REF=fdicggstdtthfpcrpujf npm run
smoke:supabase` against the already-authorized hosted development database. It passed
account/save/read, concurrent writes, versioning, client denial and cleanup in 4797 ms
including CLI/network overhead. Identity was injected by the test, not real OAuth.
The new identity migration is applied locally only; hosted application is pending.
The local stack was stopped after verification using `npm run db:stop`; its data
was preserved for the next `db:start`.

## Authentication review and limits

Integrated `npm run check` passed: **40 tests**, TypeScript, Worker dry-run build,
and workerd smoke. The smoke includes actual workerd RSA signing/verification,
PKCE/state and encrypted-cookie callback roundtrip with a fixture provider.
This verifies runtime cryptography, not a live identity provider or ChatGPT client.
The development-target dry-run bundle and fixture evaluation command also passed.
Checks ran locally on Node 26.8.2; the Node 22 CI job was not run remotely.
A final review also made project RPC redirects fail closed to prevent forwarding
server credentials to an unexpected destination.

See [implementation decision and setup](auth-stage2.md). The lead reviewed the token
boundary, scope checks, issuer/subject mapping, website state/PKCE, cookie encryption,
refresh identity binding, origin checks, MCP challenges and SQL permissions separately
from the implementation agent. Successful local tests do not prove provider or host
compatibility. Production code has no fixture identity switch.

Auth0-compatible implementation is provisional pending actual development integration.
The user confirmed no Auth0 tenant/application exists. Website logout clears the
browser cookie and attempts refresh-token revocation; already issued access tokens
remain subject to expiry and the local database cutoff/block policy. A copied session
cookie is not globally invalidated merely by clearing the original browser cookie.

Cloudflare account access was observed read-only; its Worker list was empty. A
`development` Wrangler environment is prepared with required secrets and logs/traces.
It has not been deployed. The default remains diagnostic-only without complete auth
configuration. No hosted ChatGPT connection or cross-conversation save/read is claimed.

## Generation and costs

See [generation evidence](generation-stage2.md) and [fixture outputs](../../evals/results.fixture.json).
Fixtures are authored examples, not model/provider observations. The OpenAI adapter
is opt-in; the normal evaluation command cannot make paid calls. No supplied URL is
fetched automatically. Provider rights are not inferred from technical access.

The user authorized **$25 total** for live OpenAI/Lightreel/ScrapeCreators/EnsembleData
tests including retries. Actual paid provider calls: **0**; provider spend: **$0**;
unspent cap: **$25**. No API keys were available in the environment or workspace
secret files. Lightreel's connected research action lacks a verified per-call maximum
in the reviewed documentation, so it was not invoked. Existing infrastructure costs
are not measured or included in the reported zero provider spend.

## Remaining acceptance and next assignments

1. Create/configure an identity-provider development tenant: website client, Kettle
   resource scopes, RS256 tokens with <=1-hour lifetime, refresh policy, and the exact
   callback/client shown by ChatGPT. Store secrets locally or in a secret manager.
2. Apply the reviewed identity migration to the intended hosted development project;
   configure/deploy the development Worker after confirming its concrete target.
   Prove two fictional accounts, actual website and ChatGPT login, refresh/reconnect,
   cross-account denial, save, and retrieval in a new ChatGPT conversation.
3. Supply an OpenAI development key and selected model; establish a conservative
   per-call price/token bound within the shared $25 cap. Run approved real briefs and
   compare outputs with plain ChatGPT. Obtain provider credentials and permitted-use
   evidence before live reference evaluation. No additional cap is needed unless
   the approved $25 is exhausted or scope changes.
4. Only after these proofs, integrate Stage 3 production job records, pending-dispatch
   reconciliation, retry/cancellation and usage settlement. The existing fixture
   Workflow is not full A44. Adopt product scope before Studio/Vault/UI expansion.

Release audience, Paper exports, quality thresholds and good/bad script examples
remain product inputs. Billing and public distribution remain separate later work.

## Fixture browsing benchmark — 2026-10-11

Task 9 added a strict, import-safe creator-latency benchmark. The final combined
source revision passed these local commands:

- `npm run check`: TypeScript, 518 Node tests, the dry-run Worker build, local
  workerd smoke, and 77 real-browser tests.
- `npm run test:db`: 13/13 tests against the actual migrations in PGlite.
- `npm run benchmark:creator -- --fixture`: one validated fixture/local-process
  report with 57 observations and exact zero durable deltas for all six
  provider-free read scenarios.
- `git diff --check`: clean.

The final generated resource fingerprints were
`sha256:f70b423132a9ab54a95a237e75562d4a14e1f17dd13a4ae065732a674052b8e8`
for Riff Home (141,946 raw / 40,217 gzip),
`sha256:f27c7a9380afd7ddeab4475dd29c30ad75576174ad99138d6f09d2b2bf88b5da`
for the creator pipeline (113,949 / 31,737), and
`sha256:3e74416bc97a27b3f64d62650a16700e93ab50ac8428696ba40449a42aef02a0`
for onboarding (382,496 / 80,543). All remain inside their local budgets.

The fixture report uses current local manifest fingerprints, retains raw synthetic
observations, and applies nearest-rank thresholds of five observations for p50,
twenty for p95, and one hundred for p99. Its six catalog/reopen/status/result/render
scenarios have exact synthetic zero deltas for provider calls, attempts, provider-
trial units, and cash reservations. This is fixture/reporting evidence only; it is
not hosted counter evidence.

No network request, provider call, hosted Supabase call, deployment, allocation,
refill, canary, ChatGPT session, or remote database operation was performed by
these final verification runs. No current-live p50/p95/p99, provider permission,
billing, production-readiness, or SLA claim follows from them. The local
controller evidence covers terminal-status-observed-to-render scheduling only,
not persisted-result-to-visible-paint under three seconds. The guarded `--live`
benchmark correctly remains unavailable until a pre-provisioned development
allocation, approved canonical inputs, and a trusted operator endpoint are
separately authorized.

| External proof or action | Status |
| --- | --- |
| Fresh current-live development sample | Blocked pending an available account-bound allocation, approved canonical inputs, trusted operator preflight/readback, and explicit maximum-call approval. |
| Provision or refill | Not authorized; the benchmark has no provisioning dependency. |
| Hosted development deployment and served fingerprint | Not performed; a local or dry-run fingerprint is not hosted evidence. |
| ChatGPT install/onboarding in both fresh and existing conversations | Unverified. |
| Dedicated `_meta.ui.domain` for UI submission | Missing; remains a submission gate outside Task 9. |
| Local manifest/MCP wire and schema validation | Complete: all-capability `tools/list` is 43,828 bytes against a 65,536-byte ceiling; all 22 tools advertise output schemas, with compact success/failure discovery envelopes for operation tools and complete tool-specific validation retained at runtime. |
| Official hosted/submission validation | Unverified; the local compatibility audit is not a hosted ChatGPT submission result. |
| Development canary or production promotion | Not authorized; O01, O05, and O06 remain open gates. |
