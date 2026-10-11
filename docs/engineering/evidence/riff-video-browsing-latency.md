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
- Worker telemetry constructs a fresh strict object. It accepts one validated
  request or job UUID and enum/bounded numeric fields only. URLs, handles,
  captions, provider bodies, exception text, headers, tokens, credentials,
  email, account IDs, issuer/subject, and arbitrary objects cannot be emitted.
- Checkpoint persistence is not implemented in the current job contract. The
  `checkpoint_persistence` stage is reserved in the reusable allowlist; no
  checkpoint event is claimed until Task 4 adds real persistence.

Telemetry is operational logging only and is never copied into MCP content,
structured content, public job views, or panel props.

## Build fingerprint and budgets

`npm run build:panel` hashes and gzips the exact emitted JavaScript. The same
fingerprint is exported beside each generated bundle and served in a static
`riff-bundle-version` meta element, so a screenshot and browser Performance
entry can be tied to deployed bytes.

| Panel/resource | SHA-256 bundle version | Raw bytes / budget | Gzip bytes / budget |
| --- | --- | ---: | ---: |
| Riff Home `riff-home-v3` | `sha256:f7b4c0005d8ed1a2e245f58f0351e58dc7b677454e811f1097d59066fbbae308` | 471,831 / 500,000 | 104,697 / 110,000 |
| Onboarding `riff-onboarding-v1` | `sha256:3e74416bc97a27b3f64d62650a16700e93ab50ac8428696ba40449a42aef02a0` | 382,496 / 400,000 | 80,543 / 85,000 |
| Pipeline `creator-pipeline-v3` | `sha256:d66b1be73d156d255785f85a0311700055e4c943e75f823f0aebca614ee9b271` | 611,415 / 650,000 | 135,924 / 145,000 |

Evidence class: `fixture` (local deterministic production build). Rebuilding
unchanged inputs produced identical hashes; changing only Home source changed
only the Home hash in the build test.

## Local fixture observations

These measurements describe this machine and local fixtures. They are not
current-live ChatGPT, Cloudflare, Supabase, or provider percentiles.

### Browser

Headless Chromium loaded the exact served Home resource above:

- `first-paint`: 72.0 ms from navigation start.
- `first-contentful-paint`: 72.0 ms from navigation start.
- content-free `riff:panel_render` measures: 0.1 ms and 0.0 ms.
- twelve local tab clicks measured from click through two animation frames:
  `7.1, 16.7, 16.8, 16.5, 16.6, 16.6, 16.7, 16.6, 16.6, 16.7, 16.6, 16.7 ms`.

The click sample exercises already-loaded local state only; it performs no MCP,
database, or provider call.

### Local workerd and MCP

One local workerd process, with no auth/provider configuration, produced:

- `/health`: `288.7, 2.6, 2.0, 1.6, 1.5 ms` (first value includes cold local startup work).
- MCP connect/initialize: `16.9 ms`.
- `tools/list`: `9.4, 3.5, 3.1, 2.7, 2.9 ms`.
- `kettle_diagnostic`: `4.0, 2.7, 2.4, 2.4, 2.1 ms`.

Evidence class: `fixture-local-workerd`. Sample sizes are too small and the
environment is not production, so no p50/p95/p99 claim is made.

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

## Instrumented boundaries

The allowlisted stages cover Worker request receipt, MCP transport routing,
OIDC metadata cache hit/miss, JWKS verification, identity resolution,
application operations, Supabase RPCs, Workflow create/get/status, wall-clock
queue delay, provider reservation, provider HTTP, sanitization, receipt
persistence, terminal save, polling observation, and panel render. Provider
HTTP labels are endpoint enums rather than URLs. Receipt and response byte
counts are calculated without placing their content in telemetry.
