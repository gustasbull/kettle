# Riff Paper Core Workflows Completion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use superpowers:test-driven-development inside every implementation task and superpowers:verification-before-completion before any completion, merge, migration, or deployment claim.

**Goal:** Finish the production Riff MCP App so every visible CURRENT state in Paper's `Riff · Core workflows` page has an exact, tested UI implementation, every action is clickable, supported actions persist through authenticated account-scoped tools, unsupported provider paths fail honestly, and the verified build is migrated, deployed, and merged to `main`.

**Architecture:** Keep one authenticated Cloudflare Worker MCP backed by Supabase and one Riff Home resource that owns navigation across Home, analysis, product context, Discovery, and Studio. Preserve the existing append-only creator pipeline and reuse its safe data projections. Add only the missing account-scoped work-state mutation needed for Save/Filmed/undo; use the existing project brief write for product context. Treat Paper as the exact presentation source and contracts as the truth boundary: fixture-only visual tests may exercise Instagram and rich example states, while production renders only validated account/provider data and explicit unavailable states.

**Tech Stack:** TypeScript, DOM/CSS, MCP Apps, OpenAI MCP Extensions, Zod, Cloudflare Workers + Workflows, Supabase Postgres/RPC, esbuild, Node test runner, PGlite, Playwright

**Product spec:** `PRODUCT.md`

**Authoritative design:** [Paper — Riff · Core workflows](https://app.paper.design/file/01M39TTB7DKFHZY2JVDMAEDZ81/p-5-0), page `p-5-0`, artboard `Z9H-0` (`CURRENT · Riff · New creator flow`). Read the relevant nodes with Paper MCP `get_jsx`, `get_computed_styles`, and `get_fill_image` before implementing each task. Screenshots are verification only, never the source of implementation values.

**Paper evidence date:** The exact node tree, JSX, computed styles, and tokens were
captured on 11 October in the audit handoff. A 12 October live basic-info check
reconfirmed the same file/page/artboard dimensions and token hash, but node-level
reads were permission-blocked and therefore did not supersede that audit.

**Audit handoff:** `.context/paper-core-workflows-audit.md`

## Non-negotiable decisions

- Implement all visible CURRENT states: first launch, Home, menu/account dropdown, every loading/partial state, video analysis, TikTok profile analysis, Instagram profile presentation, product context, Discovery videos/Hooks/Product showcases/CTAs, Studio Full video/Hook/Main content/CTA, and Saved confirmation.
- Do not implement hidden Paper layers (`display:none`) or recreate ChatGPT-owned rail, composer, app attribution, OAuth chrome, or fullscreen controls.
- Paper is exact for Riff-owned copy, hierarchy, dimensions, colors, gradients, spacing, radii, type, imagery, and state transitions. `PRODUCT.md` and adopted security/data decisions remain exact for behavior and truthfulness.
- Do not infer UI from the user's screenshots. Use screenshots only after implementation to compare the rendered result to Paper.
- Do not hardcode illustrative creator names, metrics, claims, thumbnails, or scripts into production. Missing live values stay unknown or unavailable. Rich Paper examples belong only in authored test fixtures and preview entrypoints.
- No provider fetch, generation, billing, retry, or credit spend is added by this plan. Existing provider work stays behind its current authenticated durable workflow. Instagram remains a presentation-ready contract plus an honest unsupported production path until a verified provider is integrated.
- Hooks, Product showcases, and CTAs may reuse validated reference videos as part-specific inspiration. Their filter is a user-selected creative lens, not a claimed server classification. Never label a video as category-ranked without stored evidence.
- Direct file upload remains a native ChatGPT handoff until the public tool contract accepts OpenAI file parameters and retention/authorization is approved.
- `open_riff` is still a read-only authenticated alias and always opens usable Home. First-use onboarding is account-level: an exact null `onboarding_seen_at` marker hides only private recents, then the MCP instructions and packaged setup sequence call `show_riff_welcome` once inline in the originating ChatGPT response. Only the standalone welcome app's explicit final action may write the marker. Reinstalling the same account must not reset it; returning users skip the automatic welcome, and explicit replay never marks completion.
- Ownership always comes from verified credentials. New mutations require the service role repository path, account-scoped RPC, request-ID idempotency, expected-version/concurrency behavior, and no client-visible service credential.
- All provider text is untrusted. Continue inert `textContent`, strict safe-URL projection, CSP allowlists, no credential-bearing URL, and no external fetch from static resources.
- Apply migrations append-only after integration; never edit applied history or reset a remote/shared database. The next allocated migration is `20261011091046_riff_work_state.sql`.
- Every state must remain usable at 320px, 375×812, 768×1024, and 1440×900; light/dark host themes; keyboard only; reduced motion; forced colors; 200% text; no horizontal document overflow.

## Paper node route map

| State | Paper node / audit locator | Production route |
| --- | --- | --- |
| Welcome | `13QH-0` | `show_riff_welcome` inline in the originating chat after a strict first-use `open_riff` result; the same tool is explicit replay for returning users and replay never marks completion |
| Fetch video | `14TG-0` | scan job, video, accepted/reviewing stage |
| Analyze video | `14QY-0` | scan job, video, building-analysis stage |
| Profile loading | `14R1-0` | scan job, profile, running |
| Product loading | `14R4-0` | product brief transition |
| Discovery loading | `14UK-0` | recommendations job, running |
| Partial transcript | `YB3-0` | partial scan limitation |
| Video analysis | `XOP-0` | succeeded video scan |
| TikTok profile | `YX9-0` | succeeded TikTok profile scan |
| Instagram profile | `Z1G-0` | platform-neutral presentation fixture/future validated result |
| Product context | `13WO-0` | editable project brief |
| Other screens | Named frames under `Z9H-0` | locate by current tree summary before implementation |

---

### Task 1: Lock exact onboarding, first-open behavior, and resource cache versions

**Files:**
- Modify: `apps/panel/riff-onboarding/index.ts`
- Modify: `apps/panel/riff-onboarding-bridge.ts`
- Modify: `apps/panel/riff-home/index.ts`
- Modify: `apps/panel/riff-home-bridge.ts`
- Modify: `apps/worker/mcp.ts`
- Modify: `apps/worker/mcp-definitions.ts`
- Modify: `apps/worker/riff-onboarding-resource.ts`
- Modify: `apps/panel/creator-performance.ts`
- Modify: `apps/worker/creator-telemetry.ts`
- Modify: `packages/application/creator-observability.ts`
- Modify: `plugins/riff/skills/setup/SKILL.md`
- Modify: `scripts/build-panel.mjs`
- Modify: `scripts/creator-latency-benchmark.ts`
- Modify: `tests/panel/riff-onboarding.test.mjs`
- Modify: `tests/panel/riff-onboarding-bridge.test.mjs`
- Modify: `tests/panel/riff-home.test.mjs`
- Modify: `tests/panel/riff-home-bridge.test.mjs`
- Modify: `tests/auth.test.ts`
- Modify: `tests/panel-build.test.ts`
- Modify: `tests/riff-onboarding-resource.test.ts`
- Modify: `tests/riff-setup-orchestration.test.ts`
- Modify: `tests/creator-latency-benchmark.test.ts`

**Interfaces:** Preserve the standalone `mountRiffOnboarding`, `open_riff`, `show_riff_welcome`, and `mark_riff_onboarding_seen`. Bump immutable UI/performance resource identifiers whenever bundled content or structured-version telemetry changes.

- [x] Write/finish tests for Paper node `13QH-0`: exact 576/526/454/184/80×124 geometry, copy, gradients, typography, carousel peek, keyboard controls, responsive 320px, dark/200% text, and no host-owned chrome/composer.
- [x] Add first-use tests proving `open_riff` keeps Home usable, `onboarding_seen_at: null` hides only recents, the standalone inline welcome writes completion only from its explicit final action, and a set marker skips automatic welcome and renders Home normally.
- [x] Implement the direct Paper structure and styles with owned media-free artwork; do not infer values from screenshots or redistribute Paper's illustrative fill asset.
- [x] Pin MCP initialize instructions and the packaged setup skill to `open_riff` followed by one inline `show_riff_welcome` only for an exact null marker; the model never calls the completion write and failures remain safely retryable.
- [x] Bump onboarding, Home, pipeline, and creator-performance immutable versions, rebuild bundles, and retain compatibility aliases for existing turns.
- [x] Run focused browser/resource/auth/build tests and commit the reviewed first-launch fixes.

### Task 2: Add the exact shared Riff menu and account dropdown

**Files:**
- Create: `apps/panel/riff-shell/menu.ts`
- Create: `apps/panel/riff-shell/styles.ts`
- Create: `tests/panel/riff-menu.test.mjs`
- Modify: `apps/panel/riff-home/index.ts`
- Modify: `apps/panel/creator-pipeline/index.ts`
- Modify: `apps/panel/creator-pipeline/styles.ts`
- Modify: `apps/panel/riff-home-bridge.ts`
- Modify: `tests/panel/riff-home.test.mjs`
- Modify: `tests/panel/creator-pipeline.test.mjs`

**Interfaces:** `mountRiffMenu(host, { account, recents, activeRoute, onNavigate, onOpenRecent, onCreate, onClose })` returns `render(...)` and `dispose()`. The menu consumes only already-validated account and recent-work projections.

- [x] Read the named Paper frames `App menu · account dropdown open` and `Riff menu open · chat remains visible`; pin the exact 288px drawer, backdrop, brand, Home/Discover/Create/recents controls, account trigger, dropdown geometry, focus order, dismissal, and escape behavior in browser tests.
- [x] Test that unavailable allowance data is omitted or called unavailable; never hardcode Paper's illustrative `10 analysis left`.
- [x] Implement one reusable menu mounted by Home and every pipeline screen. Navigation stays inside the current Riff resource; Create returns to a fresh Home form without mutating the open job.
- [x] Preserve account isolation on tool-result replacement: close the menu and clear recents before rendering a new account.
- [x] Run focused tests and commit `feat: add Paper Riff navigation menu`.

### Task 3: Complete exact loading, partial, video, and profile analysis states

**Files:**
- Modify: `packages/contracts/creator-operations.ts`
- Modify: `packages/contracts/creator-pipeline.ts`
- Modify: `apps/panel/creator-pipeline/index.ts`
- Modify: `apps/panel/creator-pipeline/styles.ts`
- Modify: `apps/panel/creator-pipeline/fixtures.ts`
- Modify: `tests/panel/creator-pipeline-fixtures.test.ts`
- Modify: `tests/panel/creator-pipeline.test.mjs`
- Modify: `tests/panel/creator-pipeline-validation.test.ts`
- Modify only if validation requires it: `packages/adapters/creator-scan/*`

**Interfaces:** Add presentation fields only when backed by trusted observations: optional platform-neutral profile aggregates and sample description. Maintain backward compatibility for persisted TikTok rows. Do not loosen the existing TikTok provider input boundary.

- [x] Pin each direct Paper node's exact copy and computed styling: fetch video, analyze video, profile loading, product loading, discovery loading, partial transcript, video result, TikTok profile, and Instagram profile.
- [x] Test stage-aware routing: video `accepted/reviewing_video` → Fetching; `building_analysis/saving` → Analyzing; profile stages → Getting to know; recommendations → Discovery loading. No client timer or fake percentage.
- [x] Test the partial transcript fallback and reduced-motion static alternative.
- [x] Rebuild video analysis using validated seed review/evidence, displaying metrics only with their actual sample/capture/source. Keep absent Paper examples unknown.
- [x] Rebuild profile analysis into Paper's three semantic bands (working, improve, next move) and show followers/views/engagement only when the validated contract provides them. Never infer causation.
- [x] Add a platform-neutral renderer that can exactly display an Instagram validated fixture, while production Instagram input remains an explicit unsupported-provider handoff.
- [x] Run focused contracts/fixture/browser tests and commit `feat: complete Paper analysis states`.

### Task 4: Implement editable Product context using existing project persistence

**Files:**
- Create: `apps/panel/riff-product-context/index.ts`
- Create: `apps/panel/riff-product-context/styles.ts`
- Create: `apps/panel/riff-product-context-validation.ts`
- Create: `tests/panel/riff-product-context.test.mjs`
- Create: `tests/panel/riff-product-context-validation.test.ts`
- Modify: `apps/panel/riff-home/index.ts`
- Modify: `apps/panel/riff-home-bridge.ts`
- Modify: `tests/panel/riff-home-bridge.test.mjs`
- Modify if needed: `apps/worker/mcp-definitions.ts`

**Interfaces:** Reuse authenticated `save_project`/`get_project` inputs and receipts. `mountRiffProductContext` exposes controlled fields for product, audience, key benefit/goal, tone, language, duration, and filming constraints; `onSave` returns the real server receipt; `onDiscover` sends the saved project context into the existing supported ChatGPT/workflow handoff.

- [x] Read Paper node `13WO-0` and the named product-loading frame; test exact fields, chips, edit affordances, `Confirm context`, and `Discover formats` transition.
- [x] Route non-URL idea/product text from Home to a prefilled editable brief without claiming AI-derived facts. Unknown fields remain visibly editable/unknown.
- [x] Call `save_project` only on explicit confirmation with the bridge's authenticated tool call; display success only from a successful receipt and preserve expected-version/request-ID semantics.
- [x] Render `Understanding your product` while the operation is pending, then route to product context or a recoverable error.
- [x] `Discover formats` must be clickable. If no creator DNA exists, send an exact editable ChatGPT handoff rather than starting provider work or fabricating references.
- [x] Run focused tests and commit `feat: add Paper product context flow`.

### Task 5: Populate all four Discovery libraries truthfully and exactly

**Files:**
- Modify: `apps/panel/creator-pipeline/index.ts`
- Modify: `apps/panel/creator-pipeline/styles.ts`
- Modify: `apps/panel/creator-pipeline/fixtures.ts`
- Modify: `apps/panel/creator-pipeline-validation.ts`
- Modify: `apps/panel/riff-video-catalog-loader.ts`
- Modify: `tests/panel/creator-pipeline.test.mjs`
- Modify: `tests/panel/creator-pipeline-streaming.test.ts`
- Modify: `tests/panel/riff-video-catalog-loader.test.ts`

**Interfaces:** Keep `RiffDiscoveryLibrary = videos | hooks | showcases | ctas` and `RiffDiscoverySelection`. Every library renders validated catalog/reference cards; `filter` remains the user's selected creative lens and is carried into the explicit adaptation action.

- [x] Read all four named Paper carousel frames. Pin exact title/subtitle, segmented library navigation, library-specific filters, center-card sizing, neighbor peeks, media/metric/provenance treatment, arrows, position count, and Make/Use action copy.
- [x] Remove the intentional blank rendering for Hooks/Showcases/CTAs. Reuse the validated video/reference catalog while labeling the requested part and selected lens; do not claim backend category ranking.
- [x] Keep pagination bounded and account/project scoped. A card can show only persisted metrics, thumbnails, capture dates, and source links; absent values do not become zero.
- [x] Every library action must produce the correct `RiffDiscoverySelection` and either start the supported full-video flow or send a part-specific proposal request without claiming it was saved.
- [x] Preserve carousel focus/index across same-scope refreshes, reset it on scope/account change, and render zero/error states honestly.
- [x] Run focused tests and commit `feat: complete Paper Discovery libraries`.

### Task 6: Complete Studio tabs, references, platform controls, and part replacement

**Files:**
- Modify: `packages/contracts/creator-pipeline.ts`
- Modify: `apps/panel/creator-pipeline/index.ts`
- Modify: `apps/panel/creator-pipeline/styles.ts`
- Modify: `apps/panel/creator-pipeline-validation.ts`
- Modify: `apps/panel/creator-pipeline/fixtures.ts`
- Modify: `apps/worker/mcp-definitions.ts`
- Modify: `tests/contracts.test.ts`
- Modify: `tests/panel/creator-pipeline.test.mjs`
- Modify: `tests/panel/creator-pipeline-validation.test.ts`
- Modify: `tests/creator-pipeline-mcp.test.ts`

**Interfaces:** Extend `TimedFilmingSegment` compatibly with optional `reference_ids`; extend `FilmingVariant` with optional explicit platform targets only if Paper needs them. Historical script rows remain valid. `save_creator_scripts` instructions require part lineage when ChatGPT supplies it.

- [x] Read the exact Full video, Hook, Product showcase/Main content, and CTA Studio frames and pin visual/browser assertions for the header, tabs, variant switcher, script cards, timing, filming directions, on-screen text, captions, hashtags, references, platform controls, Explore actions, Save, and Filmed.
- [x] Render all four Studio tabs from real variant data. Do not collapse Hook/Main/CTA into the same generic body.
- [x] Make each Explore action open its matching Discovery library and return a part-specific selection intent. Until a mutation contract exists for replacement, preview the proposal in ChatGPT and clearly retain the currently persisted script.
- [x] Associate references with the complete script and individual segments when the optional lineage exists; fall back to script-level references for historical rows.
- [x] Platform controls change only locally supported copy/format guidance unless a saved contract value exists; never claim cross-platform publication.
- [x] Run focused contract/MCP/browser tests and commit `feat: complete Paper Riff Studio`.

### Task 7: Add durable Save, Filmed, undo, Saved confirmation, and resume state

**Files:**
- Create: `supabase/migrations/20261011091046_riff_work_state.sql`
- Create: `packages/contracts/riff-work-state.ts`
- Create: `packages/application/riff-work-state.ts`
- Create: `packages/database/riff-work-state-supabase.ts`
- Modify: `packages/contracts/index.ts`
- Modify: `apps/worker/mcp-definitions.ts`
- Modify: `apps/worker/mcp.ts`
- Modify: `apps/worker/index.ts`
- Modify: `apps/panel/creator-pipeline-bridge.ts`
- Modify: `apps/panel/riff-home-bridge.ts`
- Modify: `apps/panel/creator-pipeline/index.ts`
- Modify: `apps/panel/riff-home/index.ts`
- Modify: `packages/contracts/riff-creator.ts`
- Modify: `tests/database.test.ts`
- Create: `tests/riff-work-state-database.test.ts`
- Create: `tests/riff-work-state-mcp.test.ts`
- Modify: `tests/panel/creator-pipeline-bridge.test.mjs`
- Modify: `tests/panel/creator-pipeline.test.mjs`
- Modify: `tests/panel/riff-home-bridge.test.mjs`
- Modify: `tests/panel/riff-home.test.mjs`
- Modify: `tests/riff-creator-database.test.ts`

**Interfaces:** Add authenticated `set_riff_work_state({ job_id, variant_id, state: saved|filmed|active, expected_version, request_id })` and a read projection on `get_creator_job`/`list_riff_work`. RPC derives account ownership from `p_account_id`, locks one row, checks expected version, and stores an idempotent request receipt. No client account ID.

- [x] Write failing contract/database/MCP tests for account isolation, job/variant lineage, replay, idempotency conflict, stale version conflict, save → undo, filmed → active, append-only receipts, and unchanged foreign rows.
- [x] Add the append-only migration/table/RPC/grants and repository/application wiring through the service-role boundary.
- [x] Wire Studio Save and `I've filmed this` to the mutation and render Paper's 576×170 Saved confirmation only after the successful receipt. Undo must issue a real mutation and restore the prior view.
- [x] Include durable status in recent-work summaries so Home/menu show `Analysis ready`, `Formats ready`, `Continue script`, `Ideas saved`, or filmed state based on stored truth, not a client guess.
- [x] Prove reopen/reinstall/account-switch behavior and retry safety in bridge/browser tests.
- [x] Run focused contracts, PGlite migration, MCP, bridge, and browser tests and commit `feat: persist Riff work state`.

### Task 8: Integrate full navigation, exact visual acceptance, and immutable resources

**Files:**
- Modify: `apps/panel/riff-home/index.ts`
- Modify: `apps/panel/riff-home-bridge.ts`
- Modify: `apps/panel/creator-pipeline/index.ts`
- Modify: `apps/panel/creator-pipeline/styles.ts`
- Modify: `scripts/build-panel.mjs`
- Modify: `apps/worker/riff-home-resource.ts`
- Modify: `apps/worker/creator-pipeline-resource.ts`
- Modify: `tests/panel-build.test.ts`
- Modify: `tests/riff-home-resource.test.ts`
- Modify: `tests/creator-pipeline-resource.test.ts`
- Create: `tests/panel/riff-core-workflows-visual.test.mjs`
- Modify: `PRODUCT.md`
- Modify: `docs/engineering/decisions.md`

**Interfaces:** One Home resource can transition Home → loading → analysis/product → Discovery → Studio → Saved and menu/resume without reload. Standalone `render_creator_job` retains equivalent pipeline behavior.

- [x] Build a deterministic authored fixture matrix for every Paper CURRENT screen; fixtures are marked test-only and never production fallback.
- [x] For each state, use Paper MCP values directly, render at its Paper dimensions, and compare DOM geometry/computed styles plus a screenshot review. Store review artifacts under `.context/`, not tracked source.
- [x] Exercise every visible action and keyboard path end-to-end with bridge fakes; assert no dead controls, silent writes, fictional success, external resource request, secret leakage, or document overflow.
- [x] Verify first-launch composition, returning Home, menu, account dropdown, every loading/analysis/product/discovery/studio/saved state, and 320px/reduced-motion/dark/forced-colors/200% text variants.
- [x] Bump immutable Home/pipeline resource versions and telemetry fingerprints. Rebuild generated bundles and update resource tests.
- [x] Reconcile `PRODUCT.md` and engineering decisions with the implemented boundaries, explicitly recording Instagram/provider and account-owned inline onboarding behavior.
- [x] Run focused visual/resource tests and commit `test: verify Riff Core workflows against Paper`.

### Task 9: Whole-repository verification, hosted development deployment, live proof, and merge

The immutable release resources are Home v8
`ui://riff/home-v8.html`, onboarding v8 `ui://riff/onboarding-v8.html`, and
pipeline v8 `ui://kettle/creator-pipeline-v8.html`, with compatibility aliases
Home v1–v7, onboarding v1–v7, and pipeline v2–v7. Task 9 verified the exact
resource bytes and fingerprints on the hosted development Worker.

**Files:**
- Modify: `docs/engineering/verification.md` or the existing Riff verification record
- Modify only if verification exposes a defect: files owned by Tasks 1–8

- [x] Invoke superpowers:requesting-code-review with a fresh reviewer for `origin/main...HEAD`; resolve every blocking issue and re-run affected tests.
- [x] Invoke superpowers:verification-before-completion and run from a clean generated state: `npm run check`, `npm run test:db`, all panel/browser suites, plugin package tests, Worker/MCP tests, and `git diff --check`.
- [x] Verify the intended hosted development target, account/project scoping, prior Worker version, and migration list with read-only commands. The append-only migrations `20261011091042`–`091046` were confirmed aligned after application.
- [x] Apply the pending Supabase migrations through the approved procedure without resetting or rewriting remote history. Re-run read-only migration status and safe account-scoped smoke tests.
- [x] Deploy the verified Worker build. Reviewed-code version `d0fedc8a-13af-493e-8164-010b4fc70157` carries runtime commit `4db02da`; post-merge version `c7921fba-5955-4270-a69e-17ce46dcacfa` carries merged commit `4667118`; both differ from stale version `1ca94831-bf94-4703-941c-887e44ad80a5`.
- [x] Verify live health, OAuth discovery, initialize instructions, `tools/list`, exact resource URIs/fingerprints, unauthenticated challenge behavior, and diagnostic availability three times at `https://kettle-stage2-development.g-baltramiejunas.workers.dev/mcp`.
- [ ] User-session proof: remove/re-add Riff in ChatGPT and visually confirm the new first-use/returning Paper UI rather than a client-cached resource. The agent cannot operate or invalidate the user's authenticated ChatGPT installation; this does not block the verified server release.
- [x] Invoke superpowers:finishing-a-development-branch. The clean release branch was fast-forwarded to `main` without renaming, remote `main` was verified at `4667118`, and merged-tree Worker version `c7921fba-5955-4270-a69e-17ce46dcacfa` passed three further live proofs.
- [x] Final release record distinguishes implemented/verified behavior from provider-disabled and user-session behavior and includes the Paper/MCP identities.

## Definition of done

- Every visible CURRENT Core workflows screen exists in production code and is covered by exact Paper-derived tests.
- Every visible control is either a real authenticated action, a local deterministic navigation, or an explicit honest handoff; none is dead or claims an unsupported success.
- First-use onboarding, durable work state, recents/resume, menu, product context, Discovery libraries, and complete Studio are no longer deferred.
- `npm run check`, `npm run test:db`, targeted Playwright suites, and live MCP smoke tests pass from fresh evidence.
- All pending migrations are applied, the new Worker is deployed, resource URIs are cache-safe, the final commit is on `main`, and the live MCP proves it is serving that implementation.
