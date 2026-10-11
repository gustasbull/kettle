# Riff Fast Video Browsing and Progressive Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Riff acknowledge creator inputs immediately, render truthful browsable video metadata as soon as it exists, and keep slower Lightreel research as visible progressive enrichment instead of making the whole Paper-designed experience appear frozen.

**Architecture:** Keep Cloudflare Workers + Workflows as the durable execution layer and Supabase as the account-scoped system of record. Split the experience into a fast read path and a slow research path: Home and Discovery read already persisted video cards without provider work, while explicit creator jobs fetch new data under the existing allowance/attempt guard. Add append-only job checkpoints and an account-scoped video catalog so ScrapeCreators profile/feed results can become visible before the terminal DNA/recommendation result. Preserve the existing Paper hierarchy and controls; this plan changes data timing and truthfulness, not the visual design.

**Tech Stack:** TypeScript, Zod, DOM/CSS, MCP Apps, `@openai/mcp-extensions`, Cloudflare Workers + Workflows, Supabase Postgres/PostgREST, ScrapeCreators, Lightreel, Node test runner, Playwright

**Product spec:** `PRODUCT.md`, `02-user-flows.md`, `05-acceptance-and-evaluation.md`, `07-decisions-and-sources.md`

**Authoritative design source:** Paper file **Riff**, page **Riff · Core workflows**, especially `CURRENT · Riff · New creator flow`. Re-read the live page before UI implementation. Do not introduce a new surface, menu, filter, button, label, or layout unless it exists in the current Paper design or the user explicitly approves it.

**Provider references:** [Lightreel API docs](https://lightreel.ai/docs), [Lightreel support](https://lightreel.ai/support), [ScrapeCreators TikTok profile](https://docs.scrapecreators.com/v1/tiktok/profile/), [ScrapeCreators profile videos](https://docs.scrapecreators.com/v3/tiktok/profile/videos/), [ScrapeCreators video details](https://docs.scrapecreators.com/v2/tiktok/video/), [ScrapeCreators caching](https://docs.scrapecreators.com/caching/), [ScrapeCreators usage history](https://docs.scrapecreators.com/v1/account/get-api-usage/), and [Cloudflare Workflow rules](https://developers.cloudflare.com/workflows/build/rules-of-workflows/).

## What the current integration actually does

| User path | Current external sequence | Current visible result |
| --- | --- | --- |
| TikTok profile | ScrapeCreators profile, then one or two sequential `latest` feed pages | Up to 10 recent, non-pinned posts are saved; the Analysis UI shows only the three highest-viewed posts in that bounded recent sample |
| TikTok video | Blocking Lightreel seed review, then ScrapeCreators profile, then one or two sequential feed pages | Nothing usable is published to the job until the whole scan and DNA write finish |
| Explore formats | Blocking Lightreel research, then up to three sequential ScrapeCreators detail calls | Up to three references/ideas appear only after the terminal recommendation result is saved |
| Reopen/browse | Supabase reads through `list_riff_work` and `get_creator_job` | No provider work, but there is no indexed video-library endpoint and no cross-job video-card cache |

Important limits:

- Riff currently fetches metadata and thumbnail candidates only. It deliberately sends `get_transcript=false` and `download_media=false`; it does **not** fetch or host playable video bytes.
- Lightreel documents that research can take several minutes. No published SLA, async status protocol, retry guarantee, or rate limit can be assumed.
- The deployed runtime sets `maxHistoryReads: 0`; a Lightreel submission that lacks immediate URLs fails rather than entering a documented asynchronous poll flow.
- ScrapeCreators charges one credit per profile, feed page, or video-detail request. Its profile and video-detail endpoints support `cache_max_age`; cached responses are documented as zero-credit and include `cached_at`. The feed endpoint accepts the native `user_id` specifically for faster responses.
- The present grant is sized for at most six ScrapeCreators calls and two Lightreel calls. Expanding Discovery from three enriched references to eight changes the allowance and cost model and is not an incidental UI change.
- Provider calls are safely protected by durable attempt reservation, receipt persistence, stable keys, and zero automatic provider retries. Preserve those guarantees.

## Evidence-backed latency diagnosis

The single retained historical live run is evidence, not an SLA and not proof of the current Supabase-account path:

| Stage | Historical duration |
| --- | ---: |
| Lightreel supplied-video review | 26.121 s |
| ScrapeCreators profile | 1.368 s |
| ScrapeCreators first feed | 5.275 s |
| Whole scan including queue/persistence | 39.508 s |
| Lightreel reference research | 30.367 s |
| Three serial detail requests | 6.035 s + 4.823 s + 4.335 s |
| Whole recommendation job | 49.223 s |

This indicates three separate latency classes:

1. **Local UI work is already cheap.** Existing carousel arrows, tabs, filters, and Home shortcuts update local state. They do not perform provider calls. Images already use `loading="lazy"` and `decoding="async"`.
2. **Launch and status reads have avoidable overhead.** MCP descriptors and JSON schemas are rebuilt per request, protected calls can perform OIDC/JWKS, identity, and operation round trips, direct starts perform an avoidable preflight database read, and the panel bundles are large.
3. **The minute-scale wait is the provider waterfall.** Lightreel is intentionally long-running, every stage is serial, detail calls are serial, and the database exposes only queued/running/terminal state. The UI cannot display real intermediate data even when an earlier provider call has finished.

The first speed win is therefore not a shorter spinner. It is publishing and reusing truthful partial data while slow research continues.

## Newly reported link-intake failure

The 12:14 screenshot does **not** show a URL-parsing failure. The field still contains `https://vm.tiktok.com/ZN8kT85EE/`, and the displayed sentence is emitted only when the Home bridge classifies the `start_riff_creator` call as ambiguous: disconnected host, thrown transport error, or the 45-second client deadline. The bridge had already parsed the value as HTTPS TikTok and invoked the tool.

A direct read-only run through the current resolver canonicalized that exact share link to `https://www.tiktok.com/@katieworktips/video/7693046617351441672` in roughly 0.3–0.5 seconds across two observations. That proves the example is recognized by the current parser/resolver at the time of this audit; these two observations are not an SLA.

A separate read-only audit of the linked Kettle development Supabase proves why this particular start could not become durable:

- There is no `riff_creator_starts` row for the reported share URL.
- The only recent start is the earlier `@mma_dbm` video and its job succeeded.
- The account has one active Riff-managed profile allowance, for `@mma_dbm`.
- Its only initial run grant is consumed, with zero ScrapeCreators and zero Lightreel units remaining.
- The deployed policy is `maxProfilesPerAccount: 1`, so a second creator is rejected before a new start is created.

There are therefore two distinct defects, not a lost-link parser bug:

- **Capacity:** this development entitlement cannot start a second creator. Multi-creator browsing requires an explicitly approved grant/refill/subscription policy; it must not be achieved by weakening the server guard or silently spending provider credits.
- **Acknowledgement:** `callTool` collapses every thrown host error and deadline into one `ambiguous` result, so the UI loses the reason. In the observed state, the user should have seen a truthful allowance/capacity result, not “could not confirm.”
- `start_riff_creator` waits for identity, an existing-start RPC, short-link resolution, a start RPC, and Workflow dispatch before replying.
- The bridge retains the request ID only in iframe memory and tells the user to retry. It does not automatically perform the existing provider-free exact-start lookup after an ambiguous response.

This is P0 because a fast provider pipeline is irrelevant when the input never becomes a visible durable job.

## Target experience and provisional latency budgets

These are engineering targets to validate after instrumentation, not provider promises:

| Milestone | Target |
| --- | ---: |
| Local click, carousel move, or already-loaded filter | p95 under 100 ms |
| Warm Riff shell from resource load | p95 under 1 s |
| Direct canonical URL durably acknowledged | p95 under 2 s, without awaiting a provider |
| Warm account-scoped video library first page | p95 under 1.5 s |
| Fresh ScrapeCreators profile + first useful cards | provisional p50 under 8 s, p95 under 15 s |
| Persisted result ready to visible panel update | p95 under 3 s |
| Lightreel deep research | no sub-minute promise; show the real stage, allow leaving/reopening, and retain the result when it completes |

Do not label the configured 540-second seed timeout as an SLA. If real measurements miss the provisional ScrapeCreators targets, report the measured p50/p95/p99 and adjust architecture or release thresholds rather than changing the copy to an unsupported promise.

## Decisions required before the corresponding implementation step

1. **Seed-review ordering.** The current evidence record says Lightreel reviews a supplied video before ScrapeCreators metadata is requested. Running both concurrently is the largest first-content improvement for video URLs, but changes that explicit ordering and can consume both allowances when one side later fails. Do not change it silently. Record approval in `07-decisions-and-sources.md` and `docs/engineering/decisions.md` first. Without approval, ship progressive stages, cached browsing, and recommendation-detail concurrency while retaining Lightreel-first video scans.
2. **Freshness.** Proposed starting policy: accept a ScrapeCreators profile cache no older than one day and video-detail cache no older than seven days, always exposing `cached_at`/observation freshness in provenance. Confirm this against product expectations before enabling it.
3. **Inline playback/media storage.** O01 remains unresolved. Phase 1 shows permitted metadata, thumbnails, and canonical outbound links only. Do not enable `download_media=true`, store permanent provider media URLs, or embed third-party video until access, display, cache, retention, and generation rights are recorded. ScrapeCreators documents an additional ten-credit media charge when media is found.
4. **Discovery breadth.** Keep the present maximum of three newly enriched external references until the owner approves the credit/grant change. The catalog may show up to eight already-persisted cards in the Paper carousel without silently starting more paid requests.
5. **Multi-creator entitlement.** The current account is capped at one profile and its initial grant is exhausted. Before live testing with more creators, approve a development allocation and the intended product rule: refill, paid subscription, or another explicit entitlement. Never auto-provision or auto-refill from a pasted link. The UI fix in Task 0 does not depend on this decision; it must truthfully show the unavailable state now.

## Global constraints

- Preserve the live Paper design exactly. Performance work may replace placeholder/loading data with real stages and cards, but may not invent UI.
- Keep every video/catalog read account-scoped and provider-free. Do not share provider data between accounts until O01/O08 explicitly authorize it.
- Derive account ownership only from the verified credential. Never accept `account_id` from a tool input or claimed header.
- Keep core contracts and application logic free of Cloudflare bindings and secrets.
- Keep provider content untrusted. Continue strict parsing, bounded bytes, manual redirects, safe URL validation, and inert DOM rendering.
- Keep creator history, checkpoints, observations, and successful attempt receipts append-only. Do not edit applied migrations.
- Preserve stable attempt keys, explicit allowance reservation, request IDs, exact replay, and no automatic resubmission after an ambiguous provider attempt.
- A cache hit may avoid a new external call only when its provenance, permission basis, and freshness satisfy the requested contract. It must never be presented as live-fetched data.
- Do not use read-time browsing to trigger provider work or consume credits. A refresh/discover-more action must be an explicit write operation with a visible cost/allowance policy.
- Profile-feed coverage is incomplete by provider definition. Never call the bounded latest sample “the account’s top videos.” Use an evidence-accurate label already approved in Paper, or obtain approval for corrected copy.
- Never turn missing metrics into zero, retrieval time into observation time, or metadata into visual/pacing analysis.

---

### Task 0: Make TikTok link intake durable and self-reconciling

**Files:**
- Modify: `packages/contracts/riff-creator.ts`
- Modify: `packages/application/riff-creator.ts`
- Modify: `packages/database/riff-creator-supabase.ts`
- Modify: `apps/worker/mcp.ts`
- Modify: `apps/panel/riff-home-bridge.ts`
- Modify: `apps/panel/riff-home/index.ts`
- Modify: `tests/riff-creator-start.test.ts`
- Modify: `tests/riff-creator-mcp.test.ts`
- Modify: `tests/panel/riff-home-bridge.test.mjs`
- Modify: `tests/panel/riff-home.test.mjs`

**Interfaces:**
- Exposes an authenticated, read-only, provider-free `get_riff_creator_start` operation using the existing exact `(account_id, request_id, input)` lookup. Input is the original `{ request_id, source_url }`; account identity still comes only from OAuth.
- Distinguishes a returned application failure from a host timeout/transport exception. It never reveals internal exception text.
- On an ambiguous start, automatically reconciles the same request ID/input before asking the user to retry.
- Maps a definite profile-cap or exhausted-grant rejection to a truthful, actionable no-allowance state. It does not retry, refill, relax the one-profile guard, or claim the URL was invalid.

- [ ] **Step 1: Add a regression for the exact reported share link**

  Assert `https://vm.tiktok.com/ZN8kT85EE/` passes client recognition and the bounded resolver contract. Keep the network-free unit test based on its canonical redirect fixture; the two live ~0.3–0.5 second observations belong only in evidence, not a deterministic test.

- [ ] **Step 2: Write failing bridge recovery tests**

  Cover: start response times out after the server persisted the job; lookup returns that job and the existing Paper pipeline opens automatically. Cover lookup `NOT_FOUND`; the exact typed value remains in the field, the same request ID is reused on explicit retry, and no second request is started automatically. Cover returned and host-rejected `FORBIDDEN`/`VALIDATION_ERROR` results, including profile-cap and exhausted-grant cases; the bridge shows the mapped application result rather than the ambiguous sentence. Cover host reconnect/account change; pending state cannot cross accounts.

- [ ] **Step 3: Run focused tests and verify RED**

  Run: `node --import tsx --test tests/riff-creator-start.test.ts tests/riff-creator-mcp.test.ts && node --test tests/panel/riff-home-bridge.test.mjs tests/panel/riff-home.test.mjs`

- [ ] **Step 4: Implement exact read-after-ambiguous recovery**

  Register the existing repository `find` path as a public read-only contract with `projects:read`. After a start timeout/transport exception, perform a short bounded lookup sequence with the same request ID and source input. If found, render/observe the returned saved job. If definitely absent, preserve the user's text and request ID and stop; do not silently resubmit or consume another grant. Keep the field populated until a job is visibly mounted or the user edits it.

- [ ] **Step 5: Add safe failure diagnostics**

  Feed timeout/transport/returned-error enums into Task 1 telemetry. Do not expose internal exception strings in the UI. Verify both no-grant and profile-cap responses are shown as allowance/access issues and are never described as an unrecognized link. Record the linked-development evidence above without account IDs, credentials, or provider payloads.

- [ ] **Step 6: Verify and commit**

  Run: `npm run build:panel && node --import tsx --test tests/riff-creator-start.test.ts tests/riff-creator-mcp.test.ts && node --test tests/panel/riff-home-bridge.test.mjs tests/panel/riff-home.test.mjs`

  ```bash
  git add packages/contracts/riff-creator.ts packages/application/riff-creator.ts packages/database/riff-creator-supabase.ts apps/worker/mcp.ts apps/panel/riff-home-bridge.ts apps/panel/riff-home/index.ts tests
  git commit -m "fix: recover ambiguous Riff link starts"
  ```

### Task 1: Add end-to-end latency and live-version observability

**Files:**
- Create: `apps/worker/creator-telemetry.ts`
- Create: `tests/creator-telemetry.test.ts`
- Modify: `apps/worker/index.ts`
- Modify: `apps/worker/mcp.ts`
- Modify: `apps/worker/auth-runtime.ts`
- Modify: `apps/worker/creator-pipeline-runtime.ts`
- Modify: `packages/application/riff-creator.ts`
- Modify: `packages/application/creator-pipeline.ts`
- Modify: `apps/panel/riff-home-bridge.ts`
- Modify: `apps/panel/creator-pipeline-controller.ts`
- Modify: `scripts/build-panel.mjs`
- Modify: `tests/panel-build.test.ts`
- Create: `docs/engineering/evidence/riff-video-browsing-latency.md`

**Interfaces:**
- Produces one allowlisted structured event shape with `event`, `request_id` or `job_id`, stage, monotonic duration, status enum, byte/count fields, cache state, resource/bundle version, and no source URL, caption, provider body, token, email, or credential.
- Produces a build-time resource/bundle fingerprint so deployed screenshots and timings can be tied to actual code.

- [ ] **Step 1: Write failing telemetry-safety and timing tests**

  Assert that telemetry drops arbitrary objects and credential-bearing strings, accepts only known stage/status/provider enums, records durations as non-negative integers, and never logs raw provider text. Assert the generated panel manifest contains stable content hashes and byte/gzip budgets for Home, onboarding, and pipeline bundles.

- [ ] **Step 2: Run focused tests and verify RED**

  Run: `node --import tsx --test tests/creator-telemetry.test.ts tests/panel-build.test.ts`

  Expected: FAIL because the telemetry helper and generated fingerprint do not exist.

- [ ] **Step 3: Instrument the real boundaries**

  Record request receipt, MCP routing, auth metadata/JWKS, identity lookup, application operation, Supabase RPC, workflow dispatch, queue-to-running, provider reservation, provider HTTP, sanitization, receipt persistence, checkpoint persistence, terminal save, poll observation, and panel render. Reuse correlation IDs already present; do not add user content to logs. Include endpoint enums rather than URLs.

- [ ] **Step 4: Establish the pre-change baseline without new paid calls**

  Record bundle sizes, local click/paint timings, Worker/MCP timings, and the retained historical provider sample. Mark fixture, historical-live, and current-live evidence separately. Do not claim current provider percentiles from one historical run.

- [ ] **Step 5: Run focused tests and commit**

  Run: `node --import tsx --test tests/creator-telemetry.test.ts tests/panel-build.test.ts tests/creator-pipeline-application.test.ts tests/riff-creator-runtime.test.ts`

  ```bash
  git add apps/worker packages/application apps/panel scripts/build-panel.mjs tests docs/engineering/evidence/riff-video-browsing-latency.md
  git commit -m "chore: measure Riff creator latency"
  ```

### Task 2: Remove avoidable launch and acknowledgement work

**Files:**
- Modify: `apps/worker/mcp.ts`
- Modify: `apps/worker/index.ts`
- Modify: `apps/worker/riff-home-resource.ts`
- Create: `apps/panel/creator-pipeline-validation.ts`
- Modify: `apps/panel/creator-pipeline-bridge.ts`
- Modify: `packages/application/riff-creator.ts`
- Modify: `packages/database/riff-creator-supabase.ts`
- Modify: `apps/worker/creator-pipeline-runtime.ts`
- Modify: `wrangler.jsonc`
- Modify: `tests/creator-mcp.test.ts`
- Modify: `tests/riff-creator-start.test.ts`
- Modify: `tests/riff-creator-runtime.test.ts`
- Modify: `tests/panel-build.test.ts`
- Modify: `tests/panel/creator-pipeline-bridge.test.mjs`

**Interfaces:**
- Keeps current tool schemas and auth behavior unchanged.
- Returns a durably stored queued job without waiting for Workflow creation; `waitUntil` performs the immediate dispatch and the deterministic outbox remains the recovery authority.

- [ ] **Step 1: Write failing launch-path tests**

  Assert published tool descriptors/output schemas are computed once per isolate rather than rebuilt for each RPC. Assert a new canonical TikTok URL uses one atomic start RPC rather than `find` then `start`; exact replays and short-link replay protection remain correct. Assert the operation returns after durable intent while dispatch is scheduled in `ExecutionContext.waitUntil`, and a failed background dispatch leaves the same queued job for reconciliation.

- [ ] **Step 2: Add bundle regression tests**

  Pin maximum raw and gzip sizes. Assert the standalone pipeline bridge no longer imports the server-side Zod/MCP contract graph and still rejects oversized, malformed, cross-job, and hostile results.

- [ ] **Step 3: Run focused tests and verify RED**

  Run: `node --import tsx --test tests/creator-mcp.test.ts tests/riff-creator-start.test.ts tests/riff-creator-runtime.test.ts tests/panel-build.test.ts && node --test tests/panel/creator-pipeline-bridge.test.mjs`

- [ ] **Step 4: Implement acknowledgement and launch optimizations**

  Hoist immutable descriptors and JSON schema conversion to module scope. Add a small display-boundary validator for the pipeline panel. For direct canonical inputs, call the atomic start RPC directly; retain the existing preflight lookup only where short-link replay avoids network resolution. Schedule Workflow creation after the queued record commits, retain the deterministic workflow ID, and reduce the scheduled fallback from two minutes to the shortest Cloudflare-supported cron interval without creating duplicate attempts.

- [ ] **Step 5: Verify and commit**

  Run: `npm run build:panel && node --import tsx --test tests/creator-mcp.test.ts tests/riff-creator-start.test.ts tests/riff-creator-runtime.test.ts tests/panel-build.test.ts && node --test tests/panel/creator-pipeline-bridge.test.mjs`

  ```bash
  git add apps/worker apps/panel packages/application packages/database wrangler.jsonc tests
  git commit -m "perf: acknowledge Riff creator jobs immediately"
  ```

### Task 3: Correct ScrapeCreators request, thumbnail, and freshness handling

**Files:**
- Modify: `packages/contracts/creator-profile.ts`
- Modify: `packages/adapters/creator-pipeline/requests.ts`
- Modify: `packages/adapters/creator-pipeline/sanitize.ts`
- Modify: `packages/adapters/creator-pipeline/detail-json.ts`
- Modify: `packages/adapters/creator-pipeline/live-scan.ts`
- Modify: `packages/adapters/creator-pipeline/provider.ts`
- Modify: `apps/worker/creator-pipeline-runtime.ts`
- Modify: `apps/worker/creator-pipeline-resource.ts`
- Modify: `apps/worker/riff-home-resource.ts`
- Modify: `tests/creator-pipeline-provider.test.ts`
- Modify: `tests/creator-pipeline-normalization.test.ts`
- Modify: `tests/creator-profile-contracts.test.ts`
- Modify: `tests/creator-pipeline-resource.test.ts`
- Modify: `tests/riff-home-resource.test.ts`

**Interfaces:**
- `profileRequest(profileUrl, cacheMaxAge)` validates the approved ScrapeCreators cache-age enum.
- `feedRequest(profileUrl, userId, region, cursor)` includes the stable native TikTok `user_id` returned by the profile response.
- `detailRequest(videoUrl, region, cacheMaxAge)` keeps transcript/media disabled.
- Provenance retains both retrieval time and provider `cached_at` observation time.

- [ ] **Step 1: Write failing provider-shape tests**

  Add official-shape fixtures containing `video.dynamic_cover.url_list`, signed query strings, and `*.tiktokcdn-us.com` hosts. Assert exact approved TikTok CDN families pass and lookalike/suffix/credential/HTTP URLs fail. Assert sanitizer and normalizer retain a valid dynamic cover. Assert CSP and contract allow exactly the same host families.

- [ ] **Step 2: Write failing request tests**

  Assert profile/detail requests include only an approved `cache_max_age`; feed includes validated `user_id`; transcript/media remain false; cached timestamps survive sanitization and become source observation time. Assert invalid cache ages, IDs, regions, and URLs fail before I/O.

- [ ] **Step 3: Run focused tests and verify RED**

  Run: `node --import tsx --test tests/creator-pipeline-provider.test.ts tests/creator-pipeline-normalization.test.ts tests/creator-profile-contracts.test.ts tests/creator-pipeline-resource.test.ts tests/riff-home-resource.test.ts`

- [ ] **Step 4: Implement the aligned request and thumbnail policy**

  Pass the profile response's native `user.id` into the feed call. Implement the approved one-day profile/seven-day detail policy as validated runtime configuration, not arbitrary tool input. Preserve provider cache disclosure. Retain `dynamic_cover` with a safe fallback to `cover`; do not retain play/download URLs. Update the resource CSP only after the URL contract accepts the same exact host set.

- [ ] **Step 5: Correct sample language**

  Where the UI or structured result says “Top videos,” use the exact approved Paper copy while disclosing that ranking is among the bounded recent sample. If Paper currently requires the misleading label, pause the copy change and record the conflict for user review rather than inventing replacement text.

- [ ] **Step 6: Verify and commit**

  Run: `node --import tsx --test tests/creator-pipeline-provider.test.ts tests/creator-pipeline-normalization.test.ts tests/creator-profile-contracts.test.ts tests/creator-pipeline-resource.test.ts tests/riff-home-resource.test.ts`

  ```bash
  git add packages/contracts packages/adapters apps/worker tests
  git commit -m "fix: preserve fast Riff video metadata"
  ```

### Task 4: Persist truthful job stages and safe partial results

**Files:**
- Create: `supabase/migrations/20261011091042_creator_job_progress.sql`
- Modify: `packages/contracts/creator-pipeline.ts`
- Modify: `packages/application/creator-pipeline.ts`
- Modify: `packages/database/creator-pipeline-supabase.ts`
- Modify: `packages/adapters/creator-pipeline/provider.ts`
- Modify: `tests/creator-pipeline-contracts.test.ts`
- Modify: `tests/creator-pipeline-application.test.ts`
- Modify: `tests/creator-pipeline-database.test.ts`
- Modify: `tests/creator-pipeline-provider.test.ts`

**Interfaces:**
- Adds `CreatorJobStage` with bounded values: `accepted`, `reviewing_video`, `reading_profile`, `reading_posts`, `building_analysis`, `researching_formats`, `enriching_references`, and `saving`.
- Adds a strict `CreatorJobProgress` discriminated union. Scan progress may contain a safe profile summary and up to ten sanitized video cards. Recommendation progress may contain validated reference cards. It may not expose captured input, receipt bodies, provider credentials, allowance internals, or unparsed payloads.
- Adds `CreatorProviderContext.checkpoint(key, stage, progress)` with the same exact-replay/conflict semantics as durable writes.
- Adds a compact `get_creator_job_status` read that returns ID, state, stage, revision, timestamps, safe progress, and terminal-result availability; `get_creator_job` remains the full owned result read.

- [ ] **Step 1: Write failing contract tests**

  Assert allowed stage transitions by job kind, progress size/card bounds, strict fields, provenance/freshness requirements, terminal invariants, and rejection of account IDs, provider receipts, raw bodies, and unknown stages.

- [ ] **Step 2: Write failing migration tests**

  Add an append-only `creator_job_checkpoints` table keyed by `(job_id, key)`, current safe progress/stage columns on `creator_jobs`, and an idempotent checkpoint RPC. Exact replay returns the existing checkpoint; changed replay conflicts. Running-to-running progress increments revision and appends a job event; terminal jobs reject new checkpoints. Keep old identity/input/captured/result fields immutable and service-role-only.

- [ ] **Step 3: Run RED**

  Run: `node --import tsx --test tests/creator-pipeline-contracts.test.ts tests/creator-pipeline-application.test.ts tests/creator-pipeline-database.test.ts tests/creator-pipeline-provider.test.ts`

- [ ] **Step 4: Emit checkpoints around existing work**

  Persist stages before and after each expensive boundary. Publish sanitized profile data after profile validation and video cards after each feed page. Publish researched reference identities before detail enrichment and enriched cards after detail completion. Continue to publish the terminal DNA/recommendation result only after full validation and persistence.

- [ ] **Step 5: Verify migration and application behavior**

  Run: `npm run test:db && node --import tsx --test tests/creator-pipeline-contracts.test.ts tests/creator-pipeline-application.test.ts tests/creator-pipeline-database.test.ts tests/creator-pipeline-provider.test.ts`

- [ ] **Step 6: Commit**

  ```bash
  git add supabase/migrations/20261011091042_creator_job_progress.sql packages/contracts packages/application packages/database packages/adapters tests
  git commit -m "feat: publish Riff creator job progress"
  ```

### Task 5: Reduce the provider critical path without weakening attempt safety

**Files:**
- Modify: `packages/contracts/creator-pipeline.ts`
- Modify: `packages/adapters/creator-pipeline/provider.ts`
- Modify: `packages/adapters/creator-pipeline/README.md`
- Modify: `apps/worker/creator-pipeline-runtime.ts`
- Modify: `tests/creator-pipeline-provider.test.ts`
- Modify: `tests/creator-pipeline-application.test.ts`
- Modify: `tests/creator-pipeline-runtime.test.ts`
- Modify: `07-decisions-and-sources.md` only if the owner approves a seed-order change
- Modify: `docs/engineering/decisions.md` only if the owner approves a seed-order change

**Interfaces:**
- Keeps one stable durable reservation/receipt per provider request.
- Uses bounded concurrency of three only for independent video-detail lookups and preserves Lightreel URL order in the result.
- Reuses a same-account, same-native-ID feed observation only when required fields, permission basis, and approved freshness satisfy `PipelineReference`; no provider attempt is reserved for a valid cache reuse.

- [ ] **Step 1: Write failing concurrency and reuse tests**

  Use controlled promises to prove all independent detail requests begin before any one resolves, never exceed concurrency three, retain deterministic output order, use unique stable attempt keys, and do not retry a rejected or ambiguous attempt. Assert a fresh sufficient feed observation avoids the detail call, while stale/incomplete/foreign-account/permission-incompatible data does not.

- [ ] **Step 2: Run focused tests and verify RED**

  Run: `node --import tsx --test tests/creator-pipeline-provider.test.ts tests/creator-pipeline-application.test.ts tests/creator-pipeline-runtime.test.ts`

- [ ] **Step 3: Implement safe recommendation fan-out**

  Use `Promise.all` over the already bounded, deduplicated Lightreel URLs. Cloudflare documents concurrent durable steps, but keep every side effect inside its own durable `step.do`. Preserve one receipt and allowance unit per actual detail request and stable ordering after join.

- [ ] **Step 4: Resolve the seed-order decision before changing scan concurrency**

  If approved, record the new policy, then start the Lightreel review and ScrapeCreators profile branch concurrently, with each call independently reserved and checkpointed. The feed still depends on the validated profile/native user ID; page two still depends on page one's cursor. If not approved, retain Lightreel-first and do not mark the task incomplete—the rest of the speed plan remains valid, but the direct-video first-card target must be reported as unavailable under the current order.

- [ ] **Step 5: Verify and commit**

  Run: `node --import tsx --test tests/creator-pipeline-provider.test.ts tests/creator-pipeline-application.test.ts tests/creator-pipeline-runtime.test.ts`

  ```bash
  git add packages/contracts packages/adapters apps/worker tests 07-decisions-and-sources.md docs/engineering/decisions.md
  git commit -m "perf: shorten Riff provider waterfalls"
  ```

### Task 6: Add an account-scoped, provider-free video catalog

**Files:**
- Create: `supabase/migrations/20261011091043_creator_video_catalog.sql`
- Create: `packages/contracts/riff-videos.ts`
- Create: `packages/application/riff-videos.ts`
- Create: `packages/database/riff-videos-supabase.ts`
- Modify: `packages/application/creator-pipeline.ts`
- Modify: `apps/worker/mcp.ts`
- Modify: `apps/worker/runtime.ts`
- Create: `tests/riff-videos-contracts.test.ts`
- Create: `tests/riff-videos-application.test.ts`
- Create: `tests/riff-videos-database.test.ts`
- Create: `tests/riff-videos-mcp.test.ts`

**Interfaces:**
- Adds account-scoped immutable video identity and append-only observation/source-link tables. Identity is `(account_id, platform, native_id)`; observations retain canonical URL, caption, thumbnail, metrics, publication time, retrieval time, source-observed/cache time, permission basis, limitations, source job, and role (`own_profile` or `discovered_reference`).
- Adds read-only `list_riff_videos` with strict bounded input: optional owned project, source role, approved sort, opaque cursor, and limit at most 20. It never calls a provider, refreshes data, or spends credits.
- Returns safe `RiffVideoCard` rows plus `next_cursor`, coverage/ freshness text, and no raw provider payload.

- [ ] **Step 1: Write failing contract and account-isolation tests**

  Assert stable card fields, strict cursor/filter bounds, null-preserving metrics, provenance, account/project ownership, deterministic keyset pagination, duplicate-native-ID collapse to the latest permitted observation, and rejection of client-supplied account IDs.

- [ ] **Step 2: Write failing database tests**

  Add service-only tables/RPCs with RLS, unique identities, append-only observations, source links, indexes for `(account_id, observed_at desc, id)` and `(account_id, project_id, role, observed_at desc, id)`, and an idempotent ingest RPC called only after validated checkpoints/results. Test that reads never mutate attempts/allowances.

- [ ] **Step 3: Run RED**

  Run: `node --import tsx --test tests/riff-videos-contracts.test.ts tests/riff-videos-application.test.ts tests/riff-videos-database.test.ts tests/riff-videos-mcp.test.ts`

- [ ] **Step 4: Persist catalog observations from successful provider facts**

  Ingest sanitized scan cards after each durable feed checkpoint and discovered references after enrichment. Keep catalog insertion separate from terminal DNA so a later Lightreel or model failure does not erase already permitted video facts. Exact replay must not duplicate observations.

- [ ] **Step 5: Register the read-only MCP tool**

  Require `projects:read`, verified account identity, read-only annotations, and concise text fallback. Do not add an automatic refresh side effect. Keep the existing `list_riff_work` recents tool unchanged.

- [ ] **Step 6: Verify and commit**

  Run: `npm run test:db && node --import tsx --test tests/riff-videos-contracts.test.ts tests/riff-videos-application.test.ts tests/riff-videos-database.test.ts tests/riff-videos-mcp.test.ts`

  ```bash
  git add supabase/migrations/20261011091043_creator_video_catalog.sql packages apps/worker tests
  git commit -m "feat: add fast Riff video catalog"
  ```

### Task 7: Wire progressive data into the existing Paper UI

**Files:**
- Modify: `apps/panel/riff-home-bridge.ts`
- Modify: `apps/panel/creator-pipeline-controller.ts`
- Modify: `apps/panel/creator-pipeline-bridge.ts`
- Modify: `apps/panel/creator-pipeline-validation.ts`
- Modify: `apps/panel/creator-pipeline/index.ts`
- Modify: `apps/panel/creator-pipeline/styles.ts`
- Modify: `apps/worker/creator-pipeline-resource.ts`
- Modify: `apps/worker/riff-home-resource.ts`
- Modify: `tests/panel/riff-home-bridge.test.mjs`
- Modify: `tests/panel/creator-pipeline-controller.test.ts`
- Modify: `tests/panel/creator-pipeline-bridge.test.mjs`
- Modify: `tests/panel/creator-pipeline.test.mjs`

**Interfaces:**
- Polls `get_creator_job_status` for small stage/revision payloads and fetches the full job only on first open, revision requiring new progress, or terminal availability.
- Reads one catalog page when the existing Paper Discovery surface opens; local arrows/filter changes do not call tools.
- Reuses the current Analysis, loading, Discovery, and Studio structures exactly.

- [ ] **Step 1: Write failing progressive-render tests**

  Assert an acknowledged job mounts immediately, each backend stage maps to the existing Paper loading treatment, profile/video cards render as soon as safe progress arrives, and no fabricated percentage or completion appears. Assert same-revision polls do not rerender or reset focus. Assert terminal failure retains the last truthful partial cards and limitations.

- [ ] **Step 2: Write failing browse-interaction tests**

  Assert the first catalog page is fetched once, up to the Paper-approved card count is rendered, arrows and already-loaded filters respond locally under 100 ms, the next page is fetched only at the approved carousel threshold, thumbnails remain lazy/async, and malformed/expired images degrade without blocking text. Assert no read action invokes a provider-start tool.

- [ ] **Step 3: Run browser tests and verify RED**

  Run: `npm run build:panel && node --test tests/panel/riff-home-bridge.test.mjs tests/panel/creator-pipeline-bridge.test.mjs tests/panel/creator-pipeline.test.mjs && node --import tsx --test tests/panel/creator-pipeline-controller.test.ts`

- [ ] **Step 4: Implement one shared measured polling policy**

  Replace divergent Home/standalone schedules with one controller using bounded jitter, a real wall-clock deadline, lifecycle pause/resume, and a visible paused state. Target result-ready-to-paint under three seconds without polling more aggressively during long Lightreel stages. Keep identity/revision checks and clear stale data on auth/account changes.

- [ ] **Step 5: Render progress and catalog data without redesigning**

  Populate only slots that already exist in Paper. Do not add an internal player, navigation bar, debug timings, batch-limit copy, extra actions, or new categories. Filters must affect real backed data; if a Paper category has no server classification contract, retain its approved empty/loading behavior rather than showing the same cards under a false label.

- [ ] **Step 6: Reduce MCP wire duplication**

  Keep full data in `structuredContent`, but return a concise human-readable `content` summary instead of stringifying the entire result twice. Verify the app still works in hosts that ignore UI resources.

- [ ] **Step 7: Verify and commit**

  Run: `npm run build:panel && node --test tests/panel/riff-home-bridge.test.mjs tests/panel/creator-pipeline-bridge.test.mjs tests/panel/creator-pipeline.test.mjs && node --import tsx --test tests/panel/creator-pipeline-controller.test.ts tests/creator-pipeline-mcp.test.ts`

  ```bash
  git add apps/panel apps/worker tests
  git commit -m "feat: stream Riff progress into Paper workflows"
  ```

### Task 8: Distinguish definite failures from ambiguous attempts

**Files:**
- Create: `supabase/migrations/20261011091044_creator_attempt_outcomes.sql`
- Modify: `packages/application/creator-pipeline.ts`
- Modify: `packages/adapters/creator-pipeline/provider.ts`
- Modify: `packages/database/creator-pipeline-supabase.ts`
- Modify: `apps/worker/creator-pipeline-runtime.ts`
- Modify: `tests/creator-pipeline-application.test.ts`
- Modify: `tests/creator-pipeline-database.test.ts`
- Modify: `tests/creator-pipeline-provider.test.ts`

**Interfaces:**
- Persists a sanitized terminal failure outcome for definite HTTP/malformed/unavailable responses.
- Reserves `needs_reconciliation` for timeout/network ambiguity, process loss after dispatch, or failure after provider success but before receipt persistence.
- Does not automatically retry either class.

- [ ] **Step 1: Write failing classification tests**

  Cover definite 4xx/5xx, schema-invalid 2xx, permission/unavailable, timeout, network disconnect, persistence failure, exact replay, and changed replay. Assert only genuinely uncertain spend states become reconciliation cases.

- [ ] **Step 2: Add append-only failure outcomes and RPCs**

  Store provider/operation/status/failure enum/timestamps only—never bodies or credentials. Make replay return the same terminal outcome. Keep allowance accounting unchanged until O05 is decided.

- [ ] **Step 3: Add an operator-only reconciliation report**

  Compare unresolved attempts with ScrapeCreators usage history when explicitly run by an operator. Do not make usage-history lookup part of a public retry path and do not resubmit Lightreel research.

- [ ] **Step 4: Verify and commit**

  Run: `npm run test:db && node --import tsx --test tests/creator-pipeline-application.test.ts tests/creator-pipeline-database.test.ts tests/creator-pipeline-provider.test.ts`

  ```bash
  git add supabase/migrations/20261011091044_creator_attempt_outcomes.sql packages apps/worker tests
  git commit -m "fix: classify creator provider outcomes"
  ```

### Task 9: Benchmark, acceptance, and development rollout

**Files:**
- Create: `scripts/creator-latency-benchmark.ts`
- Modify: `docs/engineering/evidence/riff-video-browsing-latency.md`
- Modify: `docs/engineering/stage2-verification.md`
- Modify: `package.json`
- Create: `tests/creator-latency-benchmark.test.ts`

**Interfaces:**
- `npm run benchmark:creator -- --fixture` performs no network calls and validates reporting.
- `npm run benchmark:creator -- --live --allocation-id <id>` requires an explicit pre-provisioned development allocation, prints the planned maximum calls before execution, refuses production hosts, and never provisions/refills credits itself.

- [ ] **Step 1: Write failing benchmark-guard tests**

  Assert live mode fails closed without the explicit flag, development endpoint, allocation ID, bounded source list, and maximum-call confirmation. Assert secrets and source content are redacted. Assert reports separate fixture, historical-live, and current-live samples.

- [ ] **Step 2: Implement measurement output**

  Report p50/p95/p99 when sample count permits: shell, durable acknowledgement, queue delay, first safe partial, profile/feed, seed review, research, detail enrichment, terminal persistence, result-ready-to-paint, provider/cache hit, bytes, calls, and credits. Small samples must show raw observations and “insufficient for percentile” rather than a misleading percentile.

- [ ] **Step 3: Run the no-spend verification suite**

  Run:

  ```bash
  npm run benchmark:creator -- --fixture
  npm run check
  npm run test:db
  ```

- [ ] **Step 4: Run a fresh live development trial only after explicit allocation approval**

  Test representative canonical profile/video inputs plus cached repeats. Verify account isolation, first-card timing, source freshness, thumbnails, leave/reopen behavior, terminal display lag, exact replay, and zero provider calls from catalog reads. Record failures and actual p50/p95 only when the sample is large enough.

- [ ] **Step 5: Compare against provisional budgets and roll out**

  Deploy to development, verify the bundle/resource fingerprint in ChatGPT, and canary with the test accounts. Do not promote or expand allowances until the observed error/reconciliation/cache behavior and O01/O05/O06 decisions are acceptable.

- [ ] **Step 6: Commit evidence**

  ```bash
  git add scripts/creator-latency-benchmark.ts package.json tests/creator-latency-benchmark.test.ts docs/engineering/evidence/riff-video-browsing-latency.md docs/engineering/stage2-verification.md
  git commit -m "test: verify fast Riff video browsing"
  ```

## Expected outcome by phase

| Phase | User-visible outcome |
| --- | --- |
| Task 0 | A pasted TikTok link remains visible; definite capacity errors are truthful, while an ambiguous host response automatically reopens the exact saved job when it exists |
| Tasks 1–3 | Faster launch/acknowledgement, correct thumbnails, less duplicate work, evidence-based latency reporting |
| Tasks 4–5 | Real backend stages, early metadata cards, parallel reference enrichment, truthful leave-and-return behavior |
| Tasks 6–7 | Instant account-scoped browsing of already fetched content inside the existing Paper Discovery UI |
| Tasks 8–9 | Fewer indefinite reconciliation waits and a measured development release decision |

The target is not “make Lightreel return in one second”; its own documentation rules that out as a dependable promise. The target is “Riff becomes useful immediately from persisted and fast metadata, remains honest about deep research, and never makes the user wait on provider work just to browse content already known to the product.”
