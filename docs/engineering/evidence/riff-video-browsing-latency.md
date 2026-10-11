# Riff video-browsing latency and version evidence

Recorded 11 October 2026. This is an observability baseline, not an SLA. No
provider request, hosted Supabase request, deployment, or paid call was made for
this record.

## Clock and privacy policy

- Durations inside one Worker, Workflow invocation, provider adapter call, or
  browser document use that process's monotonic `performance.now()` clock.
- `queue_to_running` is the sole cross-process elapsed value. It is explicitly
  labelled `clock: wall` and is derived from the persisted job `created_at` and
  the Workflow's current wall clock. It is not described as distributed
  monotonic time.
- Browser measurements remain local Performance API entries named
  `riff:tool_call`, `riff:poll_observation`, and `riff:panel_render`. They carry
  only stage, status, resource version, and bundle SHA-256. There is no browser
  reporting endpoint.
- Worker telemetry constructs a fresh strict object. It accepts a validated
  HTTP trace UUID and at most one validated logical request or job UUID, plus
  enum/bounded numeric fields only. The HTTP trace remains distinct while the
  operation re-scopes first to its durable request and then to its returned job,
  allowing the Workflow's job scope to join the chain. URLs, handles,
  captions, provider bodies, exception text, headers, tokens, credentials,
  email, account IDs, issuer/subject, and arbitrary objects cannot be emitted.
- Checkpoint persistence is implemented in the current job contract. Local
  fixture tests exercise the real version-checked repository boundary and emit
  `checkpoint_persistence` only for durable progress writes, with the operation
  label, monotonic duration, job correlation and bounded item count. The same
  tests reject content fields and verify that checkpoint failures do not become
  provider attempts. This is deterministic local evidence only; it does not
  claim a hosted checkpoint latency or provider completion.

Telemetry is operational logging only and is never copied into MCP content,
structured content, public job views, or panel props.

## Build fingerprint and budgets

`npm run build:panel` hashes and gzips the exact emitted JavaScript. The same
fingerprint is exported beside each generated bundle and served in a static
`riff-bundle-version` meta element, so a screenshot and browser Performance
entry can be tied to deployed bytes.

| Panel/resource | SHA-256 bundle version | Raw bytes / budget | Gzip bytes / budget |
| --- | --- | ---: | ---: |
| Riff Home `riff-home-v3` | `sha256:e8cc7e2b2d14d451619484c2927feb66be7bea8f1ae9a8366515d7237576a450` | 142,850 / 500,000 | 40,454 / 110,000 |
| Onboarding `riff-onboarding-v1` | `sha256:3e74416bc97a27b3f64d62650a16700e93ab50ac8428696ba40449a42aef02a0` | 382,496 / 400,000 | 80,543 / 85,000 |
| Pipeline `creator-pipeline-v3` | `sha256:fc6bbf1be1a5556fe398d7e137ee69dfb1bcff7e8ff8d964ea176a5d23dae120` | 114,785 / 250,000 | 31,949 / 75,000 |

Evidence class: `fixture`; proof surface: `local-process`. These are the values
consumed from the generated local manifest by the Task 9 fixture benchmark. They
have not been observed on a deployed Worker or in ChatGPT.

## Local fixture observations

These measurements describe this machine and local fixtures. They are not
current-live ChatGPT, Cloudflare, Supabase, or provider percentiles.

### Browser

Headless Chromium loaded the exact final Home artifact above,
`sha256:e8cc7e2b2d14d451619484c2927feb66be7bea8f1ae9a8366515d7237576a450`:

- `first-paint`: 36.0 ms from navigation start.
- `first-contentful-paint`: 36.0 ms from navigation start.
- twelve local tab clicks measured from click through two animation frames:
  `11.4, 12.6, 14.0, 14.6, 15.3, 15.3, 13.4, 15.2, 15.7, 15.0, 13.5, 13.6 ms`.

The click sample exercises already-loaded local state only; it performs no MCP,
database, or provider call.

### Local workerd and MCP

One local workerd process, with no auth/provider configuration, produced:

- `/health`: `288.7, 2.6, 2.0, 1.6, 1.5 ms` (first value includes cold local startup work).
- MCP connect/initialize: `16.9 ms`.
- `tools/list`: `9.4, 3.5, 3.1, 2.7, 2.9 ms`.
- `kettle_diagnostic`: `4.0, 2.7, 2.4, 2.4, 2.1 ms`.

Sample class: `fixture`; proof surface: `local-workerd`. Sample sizes are too
small and the environment is not production, so no p50/p95/p99 claim is made.

## Task 9 fixture report

`npm run benchmark:creator -- --fixture` passed locally on 11 October 2026. It
emitted one schema-version-1 report with `sample_class=fixture` and
`proof_surface=local-process`. The command has no network/operator dependency,
made no provider or hosted-database call, and performed no deployment.

The final combined local gate also passed on the same source revision:

- `npm run check`: typecheck, 514 Node tests, dry-run Worker build, local
  workerd smoke, and 77 real-browser tests.
- `npm run test:db`: 13/13 migration and database tests in PGlite.
- `git diff --check`: clean.

These commands did not deploy, contact providers, provision/refill an allowance,
or access hosted Supabase. The guarded `--live` benchmark remains intentionally
unavailable until a pre-provisioned development allocation, approved canonical
inputs, and a trusted operator endpoint are separately authorized.

The final local MCP wire audit serialized the all-capabilities `tools/list` at
246,160 bytes. All 22 output schemas compiled as JSON Schema 2020-12 and all
1,313 local `$ref` values resolved within their owning schema. This is local
compatibility evidence, not a hosted ChatGPT submission result.

The authored fixture contains 57 observations. Ten exact timing groups have five
successful observations each, so the nearest-rank implementation reports fixture
p50 values only:

| Synthetic timing group | n | Fixture p50 | p95 / p99 |
| --- | ---: | ---: | --- |
| shell | 5 | 10 ms | insufficient / insufficient |
| durable acknowledgement | 5 | 40 ms | insufficient / insufficient |
| queue delay | 5 | 165 ms | insufficient / insufficient |
| first safe partial | 5 | 405 ms | insufficient / insufficient |
| profile/feed | 5 | 705 ms | insufficient / insufficient |
| seed review | 5 | 525 ms | insufficient / insufficient |
| research | 5 | 825 ms | insufficient / insufficient |
| detail enrichment | 5 | 600 ms | insufficient / insufficient |
| terminal persistence | 5 | 33 ms | insufficient / insufficient |
| terminal observed to render | 5 | 16 ms | insufficient / insufficient |

These authored numbers validate aggregation and threshold behavior; they are not
observed product latency and are not an SLA. p50 requires five complete values,
p95 requires twenty, and p99 requires one hundred. The report retains raw values
and uses `insufficient_for_percentile` below each threshold.

Six synthetic provider-free scenarios—catalog first page, catalog repeat, reopen,
status read, completed-result read, and render-only—each have exact fixture deltas
of zero provider calls, attempts, provider-trial units, and cash reservations.
This proves the fixture/report invariant only. Hosted zero-delta proof still needs
trusted service-only before/after counters.

The local report establishes only terminal-status-observed-to-render timing and
the local controller schedule. It does **not** establish persisted-result-to-visible-
paint under three seconds: the Worker and browser clocks are separate and the
unchanged-stage polling cap is fifteen seconds.

## Retained historical live provider sample

The planning record retains one earlier permitted live run:

| Stage | Raw observation |
| --- | ---: |
| Lightreel supplied-video review | 26.121 s |
| ScrapeCreators profile | 1.368 s |
| ScrapeCreators first feed | 5.275 s |
| Whole scan including queue/persistence | 39.508 s |
| Lightreel reference research | 30.367 s |
| Three serial detail requests | 6.035 s, 4.823 s, 4.335 s |
| Whole recommendation job | 49.223 s |

Evidence class: `historical-live`. This is one retained run, does not prove the
current Supabase-account path, and is insufficient for percentiles or an SLA.

## Current-live status

Evidence class: `current-live`: none. The current development account path has
no newly authorized provider completion for this task. Collecting current-live
samples requires a separately approved allowance and must preserve the existing
stable attempt keys, reservation receipts, exact replay, and zero automatic
provider retry behavior.

Hosted Worker fingerprint proof and ChatGPT proof are also absent. In particular,
a fresh and an existing conversation have not both verified install/onboarding,
the UI submission still lacks a dedicated `_meta.ui.domain`, and the local MCP
wire/schema audit is not an official hosted submission validation. These are
submission gates, not failures that this fixture benchmark fixes.

## Instrumented boundaries

The allowlisted stages cover Worker request receipt, MCP transport routing,
OIDC metadata cache hit/miss, JWKS verification, identity resolution,
application operations, Supabase RPCs, Workflow create/get/status, wall-clock
queue delay, provider reservation, provider HTTP, sanitization, receipt
persistence, terminal save, polling observation, and panel render. Provider
HTTP labels are endpoint enums rather than URLs. Receipt and response byte
counts are calculated without placing their content in telemetry.
