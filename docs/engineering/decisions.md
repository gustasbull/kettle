# Stage 1 decisions and open dependencies

## Riff Core workflows visual acceptance — 2026-10-12

Task 8 accepts the Riff-owned CURRENT surface against the exact read-only Paper
tree/JSX/computed-style audit captured on 11 October: file
`01M39TTB7DKFHZY2JVDMAEDZ81`, page `p-5-0`, artboard `Z9H-0`
(`7700 × 10112`), token hash `17cc259e`. On 12 October, live basic info
reconfirmed those identifiers, dimensions, and hash; node-level reads were
permission-blocked, so that check is not a newer node-level reconciliation.
Host-owned ChatGPT rail, composer, attribution, authorization/install chrome, and
fullscreen chrome are not part of the visual target.

- Authored Paper examples live only in the deterministic test fixture module. Every
  fixture is marked `origin: 'fixture'`, `contains_fixture_data: true`, has a stable
  fixture ID and Paper node. Runtime-shaped account, job, catalog, Product, and
  work-state values pass their public boundary parsers; host/failure controls remain
  explicit test-only fakes. The fixture/evaluation modules are not imported by
  production resource entrypoints.
- Acceptance uses roles/text, DOM geometry, computed styles, state semantics,
  keyboard routes, responsive overflow, host dark variables, forced colors, reduced
  motion, and 200% text. Thirty-three screenshots under ignored `.context/` are the
  recorded human review aid, not a pixel-diff baseline or a production data source.
- Browser fakes record tool calls and block `fetch`, XHR, WebSocket, EventSource,
  `window.open`, and unexpected image sources. Hostile/malformed/timeout/late and
  account-switch cases must fail closed; mutation success requires a parsed receipt.
- Home rejects parsed URL credentials, custom ports, and fragments before any tool or
  ChatGPT handoff; accepted HTTPS queries are preserved but not interpreted. Recent
  work emits one owner-scoped row per started project after ranking started jobs by
  job/work-state activity, with source provenance kept on the selected job. A filmed
  Studio state exposes a receipt-backed `Undo filmed` correction to `active` and never
  replaces persisted truth after only a conversational handoff.
- The canonical immutable local release candidates are `ui://riff/home-v6.html`
  (`riff-home-v6`, SHA-256 `15b80168f342a323fda6e5744e2fab9da2fd0071a38e28caf147785d9fc59cd4`,
  246025 raw / 67032 gzip bytes), `ui://riff/onboarding-v6.html`
  (`riff-onboarding-v6`, SHA-256 `895affa9aaf20db9569e8efa763dcbe20b3608c0874204613af6fb66791da204`,
  37064 raw / 11033 gzip bytes), and `ui://kettle/creator-pipeline-v6.html`
  (`creator-pipeline-v6`, SHA-256 `0a67b5001c3d53559b352bce4120004269d0adcbc06e0497f02c57e49dbb8358`,
  177195 raw / 47988 gzip bytes). Home keeps v1–v5 compatibility URIs,
  onboarding keeps v1–v5, and the pipeline keeps v2–v5; all aliases serve the same
  current static document so existing turns do not lose their resource. These local
  identities are not evidence that the hosted Worker serves the same bytes.
- Review hardening verifies every key pipeline/Product/Discovery/Studio/Saved state
  against real `color-scheme`, `data-theme`, and host variables, including nested
  analysis bands and Studio on-screen text. Discovery and Studio now have explicit
  roving-key, activation, geometry, safe-link, retry-focus, and scope-reset evidence;
  every major route checks reachable controls at 320, 375, 768, and 1440 CSS pixels.
- The first-use contract begins with one protected `open_riff` call, which always
  opens usable Home. An exact null `onboarding_seen_at` marker suppresses only the
  private recent-work read. The MCP instructions and packaged setup sequence then
  call `show_riff_welcome` once so the standalone Paper carousel renders inline in
  the originating ChatGPT response while Home remains open on the right. Only that
  inline app pins the first strict `show_riff_welcome` account precondition, and only
  its explicit final action may call `mark_riff_onboarding_seen`; the model never
  calls it. Completion derives ownership again from the current credential, compares
  the precondition without using it to select ownership, and rejects account switches
  before storage. Malformed or rejected output remains retryable. A timeout is
  unconfirmed because dispatch may already have committed; the idempotent retry
  reconciles the original account. Returning users skip the automatic welcome, and
  an explicit replay never changes account state.
- Instagram remains presentation/fixture-only until a permitted live provider path is
  verified. The server publishes the same strict first-use sequence through its MCP
  instructions and `open_riff` result; the packaged setup skill pins the supported
  host behavior but is not the only client that can render the inline resource.
- Verified scope is local static resources, parsed fixtures, bridge behavior, ordered
  local migrations through PGlite, and generated-bundle determinism. This acceptance
  authorizes no provider call, spend, deployment, publication, external outreach,
  production secret, or new data source; hosted identity/provider behavior and public
  release remain unverified.

## ScrapeCreators cache policy — 2026-10-11

The user approved the fast-video implementation plan, including a trusted runtime
cache policy of `1d` for TikTok profile reads and `7d` for video-detail reads. The
profile-feed endpoint receives the matched profile response's validated native
`user.id` but no cache parameter. These values are compiled runtime policy, never
public tool input, environment configuration, claimed headers, URL input, or another
caller-controlled override. Cache hits preserve provider `cached_at` as source
observation time separately from local retrieval time; a configured cache may still
miss or be disabled by the provider and therefore does not imply zero cost or a live
fetch. Transcript and media download remain disabled.

## Full-product roadmap and creator-loop proposal — 2026-10-09

The user relayed Generation's profile-analysis and recommendation-loop context for
planning. Full product remains the objective. The [roadmap](full-product-roadmap.md)
maps all 26 journeys, and [Milestone D](assignments/D-creator-recommendation-loop.md)
defines the proposed bounded integration sequence, evidence gates and ownership.
TikTok/Instagram profile analysis is user direction; the smaller three-recommendation
proof, corpus limits and Reference-led label are engineering proposals. Generation's
reported local C12 and provider checks are not claimed as integrated or independently
verified. This planning update authorizes no live calls, spending or deployment;
the existing $25 aggregate cap requires balance reconciliation before allocation.

## Project-review UI milestone — 2026-10-06

The user approved beginning with a saved-project review card and splitting delivery
into UI and ChatGPT Integration workspaces, with Bangkok retaining shared decisions,
review, merges and deployment coordination. The [Milestone C implementation brief](assignments/C-project-review-card.md)
defines the data mapping, read-only render tool/resource, component/bridge interface,
refresh/error behavior and file ownership. It reuses v1 project reads; it does not
adopt the entire Paper design scope or change business contracts. Implementation
workspaces must start from a `main` revision containing this brief.

Paper's current **Kettle · Core workflows** page has now been visually inspected;
the older page name and statements that no visual review occurred below are historical.
The original designs remain unchanged. No UI implementation is claimed by this entry.

Latest status: the [Bangkok hosted update](stage2-verification.md#hosted-acceptance-update--bangkok-2026-10-06)
records development deployment, hosted identity migration application, and user-reported
website/ChatGPT acceptance. Earlier pending-hosted statements below are historical.

## Stage 2 follow-up, 2026-10-06

See [Stage 2 evidence](stage2-verification.md) for current status; the original
Stage 1 record below is historical. Docker/local Supabase and actual PostgREST
concurrency/rollback/restart-read checks now pass. Hosted foundation smoke also
passed again. New identity mapping migration is applied locally, not yet hosted.

- `(issuer, subject)` maps atomically to one internal account through a server-only
  RPC; no email linking. Identity blocking and issued-at cutoff are checked on calls.
- Auth0-compatible RS256/OIDC implementation is provisional for Stage 2. Supabase's
  documented lack of custom OAuth scopes conflicts with the adopted v1 scopes;
  this is a documentation finding, not an observed failed ChatGPT connection. See
  [auth decision](auth-stage2.md) for evidence and tenant setup.
- Auth is disabled without complete configuration. Website uses PKCE/state and
  encrypted Secure HttpOnly cookies; ChatGPT uses separately issued bearer tokens.
  No custom authorization server or production fixture identity was introduced.
- Added `jose` 6.2.12 as a direct pinned dependency and a separate Wrangler
  `development` environment. No deployment or public distribution performed.
- Generation/reference schemas remain drafts. Evaluation adds an internal idea/script
  seam and authored fixtures; no generation tools, ingestion or job orchestration.
- The user's aggregate live-test cap is $25 including retries; no paid calls made.

The user confirmed there is no Auth0 development tenant. Hosted OAuth remains open,
as do live model quality, reference permissions and actual provider cost measurements.

Recorded 2026-10-06 by the integration lead. This supplements the root
`07-decisions-and-sources.md`; historical proposals and original files are preserved.
The user's Stage 1 instructions take precedence over the pack's broader milestones.

## Inspection

The workspace initially contained only an empty initial commit. Fetching GitHub
found the complete pack on `origin/main`, rooted at the top level. The uploaded pack
had independent history; a local merge retained both histories and the existing
branch name. No force reset, rename, push or publication was performed.

All requested pack documents are present, plus design checklist, sequence diagrams
and original references. There was no existing application, package manager or active
AGENTS.md. The Paper page has not been edited or used as a verified UI specification;
screen exports and original embedded diagram contents remain absent as the pack says.

## Adopted engineering choices

| Decision | Reason / implication |
| --- | --- |
| TypeScript, npm lockfile, single package | No existing tooling; avoids a monorepo build system before it is needed. Modules still have explicit ownership. Node 22+; tested locally on Node 26.8.2. |
| MCP SDK 1.32.1 + Zod 4.6.5; Wrangler 4.147.0 | Exact runtime dependencies and lockfile; use the SDK's Web Standard transport, tested in actual workerd. No Express/Node HTTP server adapter. |
| Stateless Streamable HTTP; per-request MCP server | Durable user state belongs in Postgres, not process memory or transport sessions. Diagnostic needs no SSE session persistence. |
| Only diagnostic is public | No trusted identity exists in Stage 1. Initial product tools remain internal operations/contracts; no fake-account header or bearer bypass. |
| Cloudflare Workflow adapter with a deterministic fixture step | Proves local binding/execution without paid model calls. Business logic remains outside runtime bindings. No job tables or recovery claims yet. |
| HTTPS Supabase RPC adapter | Workers-compatible fetch and a single Postgres transaction per save. No direct database socket/pool required yet. Real PostgREST integration is pending. |
| Provider-neutral internal account IDs | No `auth.users` foreign key or assumed provider. Stage 2 adds a unique issuer/subject mapping after testing Supabase Auth, with Auth0 as alternative. |
| RLS enabled, no client policies; server role only | Default-deny while identity mapping is unresolved. Privileged operations explicitly filter by verified account ID. This is not end-user JWT RLS proof. |
| Full snapshots, immutable briefs/receipts; expected versions | Keeps lost updates and duplicate writes explicit. Receipts return the original saved response after later edits. Account lock serializes saves simply. |
| Path-derived Supabase project ID, local workdir and reserved ports | Independent Conductor workspaces cannot target the same containers/data. No automatic copying of secrets or development database URLs. |
| PGlite SQL verification without Docker | Executes the migrations, functions, roles and seed locally; full Supabase remains unverified while Docker is stopped. PGlite serializes connections. |
| Current Conductor TOML settings | Uses the bundled skill's current convention, not a conflicting legacy conductor.json. Shared settings need merging to main to activate in the Mac app. |

`strict` TypeScript is enabled. `exactOptionalPropertyTypes` is not enabled because
the installed MCP client transport declares `sessionId: string | undefined` against
the SDK transport interface's optional string. Runtime client connectivity is tested;
we did not hide this SDK incompatibility with unsafe casts.

## Provisional first-release assumptions

- Brand/product briefs are the initial engineering slice, not a final audience decision.
- A description is sufficient; links are optional and source URLs are not fetched here.
- Save and retrieve current briefs precede generation, revisions, Vault and the full UI.
- Full replacement brief saves and 5–180 second durations are reversible v1 bounds.
- Account state distinguishes active/suspended. Entitlements and quota/reset policy are
  explicitly `not_configured`; no trial, price or paid access is implied.
- Suspended accounts may inspect account state but cannot read/save projects.
- Website sessions and ChatGPT OAuth are distinct credentials resolving to one account.

The pack's direct idea-to-script, pasted-script import, candidate/accept, richer
variants, creator/founder workflows, Explore, billing and retention remain proposals
or later decisions. No approved $49 price, ten-run allowance or $0.90 cost target is
inferred. Future contracts stay drafts until the lead integrates the adopted scope.

## Migration ownership

The integration lead is the single owner of shared migrations. Names are increasing
UTC timestamps (`YYYYMMDDHHMMSS_description.sql`); Stage 2 A proposes the next migration
through that owner. Once applied outside disposable local tests, append changes rather
than rewriting history. Resolve timestamp/ordering collisions before integration.
Baseline: `20261006140000_foundation.sql`. `write_receipts` is the necessary supporting
table for account-scoped idempotency, alongside accounts/projects/brief_versions.

## Unresolved dependencies

**Follow-up:** hosted Supabase migration application, real PostgREST save/read,
concurrent writes and access-denial checks now pass; see [verification](verification.md).
This resolves the hosted database portion of items 1/3 below. Docker-based local
Supabase and actual user authentication remain unresolved. The user explicitly
created/linked the development project and requested the Supabase test after Stage 1.

1. **Local Supabase:** Docker daemon is unavailable. Config parses, but containers,
   real PostgREST and hosted Supabase have not been tested. Start Docker to run `db:start`.
2. **Auth:** compare Supabase Auth with current host OAuth requirements, not merely
   website login. Implement mapping, lifecycle, revoked/expired credentials, metadata,
   scoped token checks and an actual ChatGPT connection. Auth0 is an alternative.
3. **Hosted integration:** development accounts/access, endpoint and OAuth redirects;
   no deployment is authorized in Stage 1. A44 dispatch reconciliation, retry and
   quota settlement need job contracts and later integrated implementation.
4. **Generation:** development OpenAI key/model choice, explicit live-test spending cap,
   approved quality/latency thresholds and real examples. Fixtures cost nothing.
5. **References:** Lightreel fields, usefulness, terms, latency and cost are unresolved.
   No provider access, rights or outreach is presumed.
6. **Product/design:** audience, direct-input scope, examples, Paper exports, public
   handoff URL, entitlement rules and real-user data policies remain owner inputs.

None blocks this local foundation. They gate the relevant Stage 2 live proofs and pilot.

## Official sources checked

- [MCP SDK Web Standard transport](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/server/webStandardStreamableHttp.ts): Fetch Request/Response transport; installed declarations and local runtime were also inspected.
- [Cloudflare remote MCP](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/): Workers as the MCP host. We use the SDK directly for the small stateless diagnostic.
- [Cloudflare local Workflows](https://developers.cloudflare.com/workflows/build/local-development/): local execution via Wrangler; our smoke checks a real local Workflow binding.
- [Supabase migrations](https://supabase.com/docs/guides/local-development/database-migrations) and [CLI configuration](https://supabase.com/docs/guides/local-development/cli/config): migration/seed conventions, project IDs and configurable local ports.
- [OpenAI authentication](https://developers.openai.com/plugins/build/auth): OAuth discovery, resource-bound tokens, PKCE and client identification; used to scope Stage 2, not claim provider compatibility.
- [Conductor repository settings](https://conductor.build/docs/reference/scripts/share-with-teammates): shared configuration. The installed Conductor skill documents TOML precedence and allocated port blocks.

These sources establish supported mechanisms, not proof that Kettle's hosted
integration works. Package versions were checked through npm and exercised locally.

## Creator DNA persistence increment — 2026-10-09

Lead implementation adds account/project-owned immutable scans and DNA versions,
server-only validated ingestion, and authenticated read/correction factories with
an allowlisted presentation view. Existing project read/write scopes cover these
stored resources; research/generation authorization is explicitly separate. Stable
analysis IDs are distinct from immutable snapshot IDs. Corrections start through
chat/tool operations, not an inline editor. See the persistence section of
[contracts](contracts.md) for integration exports, receipt namespace and limits.
The migration is additive and unapplied to hosted development. Runtime wiring,
job orchestration, source-retention enforcement and live proof remain subsequent work.

## Saved Creator DNA ChatGPT delivery — 2026-10-09

The user requested continued implementation and testing through the existing Kettle
plugin. Lead integrates authenticated `get_creator_dna`, `render_creator_dna` and
`correct_creator_dna` using the existing read/write project scopes. The render tool
aliases the read operation; only it links the dedicated static card resource.
No public ingestion or fixture-auth endpoint is introduced. The filtered view adds
`contains_fixture_data` so source origin cannot disappear after all traits are corrected.
A clearly labelled persisted fictional record supports the first development test;
provider scans and the full recommendation/script journey remain separate work.
See the [development proof runbook](evidence/d-chatgpt-development.md).
