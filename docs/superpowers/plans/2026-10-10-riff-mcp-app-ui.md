# Riff MCP App UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first Paper-aligned Riff plugin so installation runs a focused onboarding skill, an authenticated `open_riff` invocation opens Home, and persisted creator jobs render as honest Analysis, Discovery, and Studio experiences.

**Architecture:** Add a portable Agent Plugin package under `plugins/riff/` that connects to the existing remote MCP endpoint and declares `skills/setup/SKILL.md` as its OpenAI onboarding skill. The setup skill calls a static, read-only `show_riff_welcome` tool for the inline onboarding carousel and then the authenticated `open_riff` alias over `get_account_state`; `open_riff` is a global/thread entrypoint whose fullscreen resource renders Home in the Riff panel. Reuse the existing creator-job contract, controller, and polling bridge while replacing its generic presentation with a responsive Riff renderer: concise and action-limited inline, Paper-aligned in fullscreen. Panel actions hand intent back to ChatGPT through the MCP Apps bridge and never fabricate writes, uploads, provider work, onboarding persistence, or saved-state behavior that the backend does not yet expose.

**Tech Stack:** TypeScript, DOM/CSS, `@modelcontextprotocol/ext-apps`, `@openai/mcp-extensions`, MCP SDK, esbuild, Node test runner, Playwright, Cloudflare Workers

**Spec:** `PRODUCT.md`

**Authoritative design source:** Paper file **Riff**, page [Riff · Core workflows](https://app.paper.design/file/01M39TTB7DKFHZY2JVDMAEDZ81/p-5-0), specifically the `CURRENT · Riff · New creator flow` and `RIFF · Logo & brand guidelines` artboards. This live page was read through Paper MCP on 2026-10-10; re-read it before implementation and treat newer live edits as superseding this snapshot.

**ChatGPT compatibility references:** [Build plugins](https://developers.openai.com/plugins/build/plugins), [Build skills](https://developers.openai.com/plugins/build/skills), [Build an MCP App](https://developers.openai.com/plugins/build/app-quickstart), [Add UI](https://developers.openai.com/plugins/build/chatgpt-ui), [Authentication](https://developers.openai.com/plugins/build/auth), [UI guidelines](https://developers.openai.com/plugins/concepts/ui-guidelines), [Connect and test](https://developers.openai.com/plugins/deploy/connect-chatgpt), [Plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines), and [OpenAI MCP Extensions](https://github.com/openai/mcp-extensions)

## Global Constraints

- Brand every new user-facing surface as **Riff** (double f); keep legacy internal/database identifiers unchanged unless compatibility tests explicitly permit a rename.
- Follow the live Paper page's visible hierarchy, copy, states, responsive intent, and exact Riff vector masters. Translate it into the host surface rather than redrawing ChatGPT-owned attribution, panel chrome, sidebar toggle, or composer. Prefer host variables where Paper depicts host chrome; use the Paper values for Riff-owned surfaces, including `#3865F8` as the primary accent.
- Preserve the currently approved in-product headlines **Unlock your viral potential** and **Let's make your next video go viral** while keeping package/tool descriptions factual and outcome-neutral. Record the tension with `PRODUCT.md`'s no-virality-promise rule as a pre-publication copy review item; do not silently rewrite finalized design copy during this implementation slice.
- The creator text/link input lives on Home; every persisted-job view exposes a stable **Create a video** action that returns intent to ChatGPT without mutating the open job. A video-file control must remain a native-composer handoff until a backend tool accepts an OpenAI file parameter contract (`download_url` and `file_id`) and defines retention/authorization behavior.
- Static MCP resources have no external scripts, fonts, images, network domains, or interpolated tool data; provider content is rendered only with DOM `textContent` and safe URL handling.
- `open_riff` is an authenticated, read-only alias for `get_account_state`; it may not derive ownership from input or introduce a new application operation.
- Follow the current OpenAI MCP Extensions specification: `open_riff` accepts `{}`, has title **Riff Home**, declares `global` and `thread` entrypoints at `_meta["openai/ui"].entrypoints`, and serves a fullscreen-only Home resource so installation can open the Paper-designed right-hand panel without an inline flash. `show_riff_welcome` serves a separate inline-only carousel and has no account side effects.
- Package the integration in the portable Agent Plugins format with root `plugin.json`, root `mcp.json`, packaged skills/assets, and `extensions.com.openai.onboardingSkill`. Do not add secrets, OAuth client credentials, or an undocumented `.app.json`; the remote server remains the authority for UI, tools, and OAuth discovery.
- Configure the packaged remote server as mixed auth because the MCP exposes an anonymous diagnostic alongside OAuth-protected account tools. Do not hardcode authorization endpoints or secrets in the plugin package.
- Apply ChatGPT host theme/style variables and safe-area insets on initialization and host-context changes. Do not add a display-mode toggle; ChatGPT supplies that control.
- Use `OpenAIExtensions.message` for explicit user actions when available, with standard MCP Apps `sendMessage` as the compatible fallback; never overwrite an existing composer draft silently.
- Treat fullscreen as the rich, multi-step surface. Inline cards contain at most two primary actions and no tabs, deep navigation, nested scrolling, duplicate composer, or duplicated app logo. The onboarding carousel is the deliberate three-card inline exception defined by Paper. Creator results prefer fullscreen; their inline fallback is a compact summary with an expand action. Studio tabs exist only in fullscreen.
- Existing creator-job lineage, auth, revision, polling, focus preservation, idempotency, and no-implicit-retry behavior remain intact.
- Do not claim durable one-time onboarding, recents, direct file upload, save/undo, filmed state, or component replacement until their server contracts exist; render honest handoffs or unavailable states instead.
- Support inline and fullscreen host display modes, representative 375 × 812, 768 × 1024, and 1440 × 900 entrypoint layouts, 320 px constrained panels, light/dark themes, keyboard operation, reduced motion, forced colors, and 200% text without horizontal overflow.
- Every tool remains useful without its UI. Keep tool names, schemas, auth, side effects, failure behavior, and read/write annotations exact; do not add provider fetching, spending, or write behavior to make a visual interaction appear complete.
- Expose exactly one standard authenticated profile tool for ChatGPT multi-account recognition. It accepts `{}`, derives identity only from the verified credential, returns the persisted opaque account ID plus available display name, and carries `_meta["openai/profile"]: true`; never mark the broader account-state/Home result as a profile response.

## Review Focus

- Host lacks OpenAI extension capabilities, runs an older desktop build, cannot send messages, or constrains the layout/theme/text size: controls remain usable, do not throw or overflow, and explain the compatible ChatGPT fallback; entrypoint-only features require desktop `26.928.20710` or a host that advertises the corresponding capability.
- Tool result is missing, malformed, unauthenticated, or belongs to a different account context: Home clears prior account content and exposes reconnect/reopen guidance without leaking the prior result.
- Persisted job contains hostile/very long provider text or a malformed/credential-bearing URL, then changes identity or revision while a carousel/tab/control is focused: text stays inert, no unsafe link is created, another job resets local state, and a same-job refresh preserves the meaningful selection and focus.
- Partial/empty/failed/reconciliation job states: the last truthful result and limitations remain legible, with no fake percentage, implicit retry, generation, save, or success claim.
- Plugin installation in a fresh or existing conversation, with either a local package or refreshed remote MCP: setup opens Riff and offers a supported Start → Find → Make step without implying durable onboarding; package metadata, deployed tools, and ChatGPT cache state are verified separately.

## Live Paper-to-contract map

| Paper workflow | This slice | Current contract boundary |
| --- | --- | --- |
| First launch · welcome in chat + Home on right | Build the inline three-step carousel and have the setup skill open fullscreen Home | No durable account-level `onboarding_seen` state; setup is conversational |
| Home · input, libraries, recents | Build text/link entry, library prompt shortcuts, upload handoff, and empty recents | `get_account_state` has account/usage only; no recents/listing or video-file intake |
| Fetching/analyzing loading states | Build indeterminate job status from actual state/message | Running `CreatorJobView` does not expose stage/source thumbnails, so do not fabricate them |
| Video/profile analysis | Build fullscreen Riff analysis from saved DNA, coverage, evidence, and seed review | TikTok profile path exists; direct uploaded-video and Instagram paths do not |
| Product brief | Preserve as canonical future design; do not implement in this UI slice | Project/brief storage exists, but the editable Paper flow and discovery bridge do not |
| Discover videos | Build a real-count carousel from zero-to-three ideas/references | No thumbnails, likes, lift multiplier, seven-result set, or explicit category on current references |
| Hooks, Product showcases, CTAs libraries | Expose clearly labeled ChatGPT handoffs from fullscreen Discovery/Home | No category-specific result contract exists yet |
| Studio · Full video/Hook/Main content/CTA | Build fullscreen component views from saved filming variants and lineage | No caption/platform field, component replacement mutation, save toggle, or filmed status |
| Saved state, menu, Vault, recents | Keep actions as honest ChatGPT handoffs or unavailable states | No list/save/undo/filmed-state APIs |
| Logo & brand guidelines | Export and use the supplied lockup, symbol, and app icon exactly | Do not retype the wordmark or reuse illustrative creator media as production evidence |

---

### Task 1: Shared Riff visual foundation

**Files:**
- Create: `apps/panel/riff-ui/brand.ts`
- Create: `apps/panel/riff-ui/dom.ts`
- Create: `apps/panel/riff-ui/styles.ts`
- Create: `tests/panel/riff-ui.test.ts`

**Interfaces:**
- Consumes: Native DOM APIs only; no host or server state.
- Produces: `riffLockup(document: Document): SVGSVGElement`, `riffSymbol(document: Document): SVGSVGElement`, `safeHttpUrl(value: string): string | undefined`, `formatRiffDate(value: string | null): string`, `riffBaseStyles: string`, and shared `RiffPanelAction`/`RiffActionResult` types for Home and creator-job views.

- [x] **Step 1: Write the failing shared-foundation tests**

  Assert the standalone lockup and symbol preserve the Paper vector view boxes/proportions, expose the accessible name `Riff`, and stay single-color. Assert date formatting distinguishes unknown values, safe URLs allow credential-free HTTP(S) only, and the CSS maps the live Paper spacing/color/radius values onto ChatGPT host variables with safe fallbacks, focus-visible treatment, 320 px container behavior, reduced-motion handling, forced-colors support, and overflow protection.

- [x] **Step 2: Run the focused test and verify RED**

  Run: `node --import tsx --test tests/panel/riff-ui.test.ts`

  Expected: FAIL because `apps/panel/riff-ui/*` does not exist.

- [x] **Step 3: Implement the shared primitives**

  Use Paper MCP `get_jsx`/computed styles (and export where appropriate) to copy the supplied vector masters exactly; do not redraw or retype the wordmark. Keep `dom.ts` limited to inert node/URL/date helpers, `brand.ts` limited to the lockup/symbol used by Riff-owned fullscreen surfaces and package assets, and `styles.ts` limited to the common `.riff-app` system. Do not render the mark again inside inline response cards because ChatGPT supplies app attribution there. Do not introduce runtime fetches, storage, a framework, or external assets.

- [x] **Step 4: Run the focused test and verify GREEN**

  Run: `node --import tsx --test tests/panel/riff-ui.test.ts`

  Expected: PASS.

- [x] **Step 5: Commit**

  ```bash
  git add apps/panel/riff-ui tests/panel/riff-ui.test.ts
  git commit -m "feat: add Riff app visual foundation"
  ```

### Task 2: Authenticated Riff Home MCP App

**Files:**
- Create: `packages/contracts/openai-profile.ts`
- Create: `apps/panel/riff-onboarding/index.ts`
- Create: `apps/panel/riff-onboarding-bridge.ts`
- Create: `apps/panel/riff-home/index.ts`
- Create: `apps/panel/riff-home/fixtures.ts`
- Create: `apps/panel/riff-home/preview.ts`
- Create: `apps/panel/riff-home/preview-server.mjs`
- Create: `apps/panel/riff-home-bridge.ts`
- Create: `apps/worker/riff-onboarding-resource.ts`
- Create: `apps/worker/riff-home-resource.ts`
- Modify: `apps/worker/mcp.ts`
- Modify: `scripts/build-panel.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tests/panel-build.test.ts`
- Create: `tests/panel/riff-onboarding.test.mjs`
- Create: `tests/panel/riff-onboarding-bridge.test.mjs`
- Create: `tests/panel/riff-home.test.mjs`
- Create: `tests/panel/riff-home-bridge.test.mjs`
- Create: `tests/riff-onboarding-resource.test.ts`
- Create: `tests/riff-home-resource.test.ts`
- Modify: `tests/auth.test.ts`
- Modify: `tests/auth-persistence.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers; the successful/failed `GetAccountStateOutput` envelope; `OpenAIExtensions` app/server types; MCP Apps host context, host version, lifecycle, message, and size APIs.
- Produces: `OpenAIProfile`, `mountRiffOnboarding(root): { dispose(): void }`, `mountRiffHome(root, actions): { render(state: RiffHomeState): void; dispose(): void }`, `riffHomeStructuredOutput(value: unknown): RiffHomeState`, both host bridges, `RIFF_ONBOARDING_URI = 'ui://riff/onboarding-v1.html'`, `RIFF_HOME_URI = 'ui://riff/home-v1.html'`, the no-auth `show_riff_welcome` tool, the authenticated `get_riff_profile` profile alias, and the authenticated `open_riff` Home alias.

- [x] **Step 1: Write failing unit, resource, registration, bridge, and browser tests**

  Pin the live Paper copy **Welcome to Riff**, **Unlock your viral potential.**, **Start with what you have.**, **Find your breakout idea.**, **Make it yours.**, **Let's make your next video go viral.**, **Share a video or profile link, or tell me what you want to make…**, **Upload a video**, **Find my next idea**, **Pick up where you left off**, and **Create a video**. Assert the inline onboarding carousel contains exactly three keyboard-operable steps and never renders host-owned Riff attribution or a composer. Assert `show_riff_welcome` is no-auth/read-only, accepts `{}`, and returns the onboarding resource without account data.

  Assert `get_riff_profile` is the only descriptor with `_meta["openai/profile"] === true`, accepts `{}`, requires `account:read`, delegates to `get_account_state`, and maps a successful account to exactly `{ id, name }` at the top level. Repeated/reconnected credentials retain the same persisted ID, distinct accounts remain distinct, and auth failure never returns a placeholder identity. Assert `open_riff` has title **Riff Home**, `{}` input, `account:read`, read-only annotations, `_meta.ui.resourceUri === RIFF_HOME_URI`, exactly one `global` and one `thread` entrypoint, and delegates exactly once to `get_account_state`; unauthenticated requests retain the existing OAuth challenge behavior. Assert onboarding is inline-only, Home is fullscreen-only, both resources have empty CSP allowlists, one escaped inline script each, and no interpolated account data.

- [x] **Step 2: Run the focused tests and verify RED**

  Run: `node --import tsx --test tests/panel-build.test.ts tests/riff-onboarding-resource.test.ts tests/riff-home-resource.test.ts tests/auth.test.ts tests/auth-persistence.test.ts && node --test tests/panel/riff-onboarding-bridge.test.mjs tests/panel/riff-onboarding.test.mjs tests/panel/riff-home-bridge.test.mjs tests/panel/riff-home.test.mjs`

  Expected: FAIL because the Riff onboarding/Home components, resources, bundle kinds, and tool aliases do not exist.

- [x] **Step 3: Implement onboarding, Home, and their host bridges**

  Install `@openai/mcp-extensions@0.1.0`. Implement the Paper carousel as a self-contained inline result and Home as a fullscreen surface. The carousel changes steps locally and its closing instruction points to the native ChatGPT composer and Riff panel; it does not store a completion flag. Home renders the exact lockup/headline, creator text/link input, four library shortcuts, and an honest empty-recents state because `GetAccountStateOutput` currently contains no recent jobs.

  Text submit sends `Use Riff to help me make my next video from this input:\n\n${input}` only after explicit activation. **Upload a video** and **Create a video** continue through an editable ChatGPT/native-composer instruction when supported, then fall back to standard `sendMessage`; the accessible description says that the video must be attached in ChatGPT. Do not open a file picker, upload bytes, or imply Riff received a file until a server tool declares `_meta["openai/fileParams"]` and accepts the documented file object. Apply host style variables and safe-area insets, show an update/compatibility message for unsupported extension hosts, use visible sent/unsupported/failed statuses, clear stale account content on invalid/auth failures, and do not use local storage as account-level onboarding state.

- [x] **Step 4: Register both resources and transport tools**

  Extend `buildPanel(root, kind)` with separate `riff-onboarding` and `riff-home` bundle kinds. Register `show_riff_welcome` and its resource alongside the diagnostic even before product auth is configured; its non-UI text result still explains Start → Find → Make. When auth is configured, register `get_riff_profile` as a direct read-only adapter over `get_account_state`, returning the standard top-level profile shape, and register `riff-home`/`open_riff`. Append both aliases to the same descriptor path used by `tools/list` so runtime and published schemas cannot drift. Type OpenAI-specific metadata with `OpenAIUiToolMetadata`/`OpenAIUiResourceMetadata`; expose `global` and `thread` entrypoints. Keep server metadata independent from the portable plugin package added in Task 3.

- [x] **Step 5: Run the focused tests and verify GREEN**

  Run: `npm run build:panel && node --import tsx --test tests/panel-build.test.ts tests/riff-onboarding-resource.test.ts tests/riff-home-resource.test.ts tests/auth.test.ts tests/auth-persistence.test.ts && node --test tests/panel/riff-onboarding-bridge.test.mjs tests/panel/riff-onboarding.test.mjs tests/panel/riff-home-bridge.test.mjs tests/panel/riff-home.test.mjs`

  Expected: PASS, including Paper's inline-onboarding/fullscreen-Home boundary, 375 × 812, 768 × 1024, 1440 × 900, 320 px constrained, safe-area, host-style, light/dark, 200% text, carousel keyboard controls, old/unsupported-capability, hostile-input, lifecycle, no-fake-file-upload, and zero-external-request cases.

- [x] **Step 6: Commit**

  ```bash
  git add packages/contracts/openai-profile.ts apps/panel/riff-onboarding apps/panel/riff-onboarding-bridge.ts apps/panel/riff-home apps/panel/riff-home-bridge.ts apps/worker/riff-onboarding-resource.ts apps/worker/riff-home-resource.ts apps/worker/mcp.ts scripts/build-panel.mjs package.json package-lock.json tests/panel-build.test.ts tests/panel/riff-onboarding.test.mjs tests/panel/riff-onboarding-bridge.test.mjs tests/panel/riff-home.test.mjs tests/panel/riff-home-bridge.test.mjs tests/riff-onboarding-resource.test.ts tests/riff-home-resource.test.ts tests/auth.test.ts tests/auth-persistence.test.ts
  git commit -m "feat: add Riff onboarding and Home apps"
  ```

### Task 3: Portable Riff plugin and onboarding skill

**Files:**
- Create: `plugins/riff/plugin.json`
- Create: `plugins/riff/mcp.json`
- Create: `plugins/riff/skills/setup/SKILL.md`
- Create: `plugins/riff/skills/setup/agents/openai.yaml`
- Create: `plugins/riff/assets/logo.svg`
- Create: `plugins/riff/assets/composer-icon.svg`
- Create: `.agents/plugins/marketplace.json`
- Create: `tests/plugin-package.test.ts`

**Interfaces:**
- Consumes: Task 2's deployed-shape `open_riff` tool and the existing development MCP endpoint `https://kettle-stage2-development.g-baltramiejunas.workers.dev/mcp`.
- Produces: one portable Agent Plugins package named `riff`, one repo-local marketplace entry, and one focused install/setup workflow.

- [x] **Step 1: Write failing package-contract tests**

  Parse the JSON/YAML/front matter and assert the portable Agent Plugins schemas, lower-kebab identity, semantic version, `skills/setup/SKILL.md` path, real HTTPS `/mcp` URL, `streamable-http` transport, mixed-auth OpenAI extension, no secrets, existing files for every asset/path, marketplace source `./plugins/riff`, and a concise interface. Pin `displayName: Riff`, `shortDescription: Plan videos worth filming`, Riff accent `#3865F8`, and no more than three supported default prompts. Assert the setup skill calls `show_riff_welcome` followed by `open_riff`, distinguishes conversational onboarding from durable account state, requires explicit user action before any provider work, and never claims upload/save/recents capabilities that do not exist.

- [x] **Step 2: Run the focused test and verify RED**

  Run: `node --import tsx --test tests/plugin-package.test.ts`

  Expected: FAIL because the portable package and repo marketplace do not exist.

- [x] **Step 3: Author the package and focused setup skill**

  Before editing the skill, load `superpowers:writing-skills` and follow the system skill-creator validation workflow. Use root `plugin.json` and `mcp.json` inside `plugins/riff/`; do not add a compatibility `.codex-plugin/plugin.json` unless an actual target client fails to read the portable format. Put only OpenAI presentation and onboarding metadata under `extensions.com.openai`. Set `extensions.com.openai.onboardingSkill` to `./skills/setup/SKILL.md`; declare the Riff MCP dependency in `agents/openai.yaml` with `transport: streamable_http` and the same development endpoint.

  The setup skill should:

  1. Activate only for Riff installation, setup, connection, or first-use guidance.
  2. Call `show_riff_welcome` once to render the Paper-designed inline three-step tour, then call `open_riff` so Home opens fullscreen/right-panel; allow the latter's OAuth challenge to start connection when needed.
  3. Briefly reinforce the supported Start → Find → Make path and offer one next action: paste a creator/profile/video link, describe an idea, or attach a video through ChatGPT's composer.
  4. Keep the user's explicit request higher priority than the suggested tour, and stop cleanly when the server/tool is unavailable.
  5. Never infer onboarding completion, identity, ownership, upload receipt, or permission to fetch/spend from conversation state.

  Export the approved square app icon and composer icon from the live Paper brand-guidelines artboard; preserve the supplied vector master, proportions, optical centering, single-color rule, square numeric view box of at least 48 × 48, and transparent background. Do not redraw or retype the wordmark, and do not include third-party sample creator media. Do not invent publisher, support, privacy, production-domain, or public-submission metadata that the owner has not supplied.

- [x] **Step 4: Validate the skill and package**

  Run:

  ```bash
  python3 /Users/benasbaltramiejunas/.codex/skills/.system/skill-creator/scripts/quick_validate.py plugins/riff/skills/setup
  node --import tsx --test tests/plugin-package.test.ts
  ```

  Expected: both PASS. Review direct, indirect, incomplete, negative, and unsupported-action prompts against the skill instructions.

- [x] **Step 5: Commit**

  ```bash
  git add plugins/riff .agents/plugins/marketplace.json tests/plugin-package.test.ts
  git commit -m "feat: package Riff plugin onboarding"
  ```

### Task 4: Paper-aligned Analysis and live job states

**Files:**
- Modify: `apps/panel/creator-pipeline/index.ts`
- Modify: `apps/panel/creator-pipeline/styles.ts`
- Modify: `apps/panel/creator-pipeline-bridge.ts`
- Modify: `tests/panel/creator-pipeline.test.mjs`
- Modify: `tests/panel/creator-pipeline-bridge.test.mjs`

**Interfaces:**
- Consumes: Task 1 styles/actions; existing `CreatorJobView`, `createCreatorPipelineController`, and `get_creator_job` polling semantics.
- Produces: `mountCreatorPipeline(root, { sendPrompt?, createVideo? } = {})` with Paper-aligned loading/recovery and scan-analysis presentation while preserving the existing `render`/`dispose` contract.

- [x] **Step 1: Replace the presentation assertions with failing Riff Analysis tests**

  Assert queued/running states use Paper's indeterminate live-status treatment—never a fabricated percentage—and failed/reconciliation states never offer implicit retry. In fullscreen, a successful scan follows the live **Video analysis** or profile-analysis hierarchy and shows source/coverage, seed-review summary and access basis, limitations, and six dimension slots: Hook, Content, Style & pacing, Voice & language, Script, and CTA. Map claims only by their saved dimensions; use the saved claim basis (`Observed`, `Inferred`, or `User corrected`) instead of inventing Paper's **Working well**/**Needs attention** judgment. Missing groups say unavailable.

  Assert fullscreen exposes Paper's two actions—**Rework this video** and **Explore viral formats**—and a visually secondary, globally reachable **Create a video** handoff. Inline mode renders only a compact truthful summary with at most **Open analysis** and **Explore viral formats**; no mode duplicates ChatGPT's app attribution, panel chrome, or composer.

- [x] **Step 2: Run the focused tests and verify RED**

  Run: `node --test tests/panel/creator-pipeline-bridge.test.mjs tests/panel/creator-pipeline.test.mjs`

  Expected: FAIL on the old Kettle/generic card presentation.

- [x] **Step 3: Implement the Riff Analysis renderer and bridge actions**

  Map `hooks` to Hook; `topics`/`formats` to Content; `duration`/`pacing` to Style & pacing; leave Voice & language unavailable unless a saved claim explicitly supports it; `structure` to Script; and `cta` to CTA. Keep the unparsed Lightreel summary intact rather than extracting unsupported subclaims. Retain fixture/live provenance and coverage limitations, keep status announcements stable, preserve same-job focus, reset state on job identity change, and implement actions through `App.sendMessage` only when advertised by the host. Do not add tabs, nested scrolling, category navigation, or a duplicate composer to inline Analysis.

- [x] **Step 4: Run the focused tests and verify GREEN**

  Run: `node --test tests/panel/creator-pipeline-bridge.test.mjs tests/panel/creator-pipeline.test.mjs`

  Expected: PASS for all prior lineage, safe-link, lifecycle, no-network, narrow/dark, enlarged-text, hostile-content, and recovery guarantees plus the new Analysis copy/actions.

- [x] **Step 5: Commit**

  ```bash
  git add apps/panel/creator-pipeline/index.ts apps/panel/creator-pipeline/styles.ts apps/panel/creator-pipeline-bridge.ts tests/panel/creator-pipeline.test.mjs tests/panel/creator-pipeline-bridge.test.mjs
  git commit -m "feat: redesign creator analysis for Riff"
  ```

### Task 5: Paper-aligned Discovery and Studio

**Files:**
- Modify: `apps/panel/creator-pipeline/index.ts`
- Modify: `apps/panel/creator-pipeline/styles.ts`
- Modify: `apps/panel/creator-pipeline-bridge.ts`
- Modify: `apps/panel/creator-pipeline/fixtures.ts`
- Modify: `apps/panel/creator-pipeline/preview.ts`
- Modify: `tests/panel/creator-pipeline-bridge.test.mjs`
- Modify: `tests/panel/creator-pipeline-fixtures.test.ts`
- Modify: `tests/panel/creator-pipeline.test.mjs`

**Interfaces:**
- Consumes: Task 4 `mountCreatorPipeline` action boundary and existing recommendation/script result contracts.
- Produces: compact inline result summaries, a bounded fullscreen Discovery carousel, deterministic local selection state, and fullscreen-only Studio tabs without changing or persisting server records.

- [x] **Step 1: Write failing Discovery and Studio interaction tests**

  Assert inline recommendations render a compact result count/limitations summary with **Open discovery**, at most one additional action, no category tabs, and no nested scroll container. Fullscreen follows Paper's **Find your next breakout idea.** layout using the real zero-to-three idea/reference count, safe previous/next and left/right keyboard navigation, one **Make it mine** CTA for the selected idea, source attribution, views when present, unknown states for absent metrics, and visible limitations. It must not invent Paper's thumbnails, lift multipliers, likes, seven-result count, or category membership because those fields are absent from the current contract. The **Videos** library is the data-backed view; **Hooks**, **Product showcases**, and **CTAs** are clearly labeled ChatGPT handoffs until category-specific contracts exist.

  Assert an inline completed script renders a concise **Your script, ready to film.** summary and one **Open Studio** primary action. In fullscreen, Studio follows the live Paper hierarchy with variant selection plus Full video/Hook/Main content/CTA tabs. It maps only actual duration, hook, opening visual, script, shots, B-roll, on-screen text, showcase timing, CTA, pacing, lineage, and limitations. Caption/platform UI is withheld or explicitly unavailable because the current contract has no caption. **Save for later** and **I filmed it** are ChatGPT handoffs and never claim persistence.

- [x] **Step 2: Run the focused tests and verify RED**

  Run: `node --import tsx --test tests/panel/creator-pipeline-fixtures.test.ts && node --test tests/panel/creator-pipeline-bridge.test.mjs tests/panel/creator-pipeline.test.mjs`

  Expected: FAIL because the generic vertical cards/disclosures do not implement the Riff carousel or Studio tabs.

- [x] **Step 3: Implement Discovery selection and fullscreen Studio**

  Keep all local navigation deterministic and inert until user activation; use persisted result length rather than padding to Paper's illustrative seven/eight, withhold an idea whose references are absent, keep fixture provenance visible, and send exact batch/idea/variant IDs only in explicit ChatGPT action prompts. Use a neutral **Preview unavailable** media surface for production references with no approved thumbnail; sample Paper creator imagery may appear only in explicitly labeled local preview fixtures and must not ship as live evidence. Request fullscreen only from **Open discovery**/**Open Studio** and show an honest fallback if the host does not support it. Mount library/component tabs only while the host reports fullscreen. Label save/filmed actions as continuing in ChatGPT until durable mutations exist.

- [x] **Step 4: Run the focused tests and verify GREEN**

  Run: `node --import tsx --test tests/panel/creator-pipeline-fixtures.test.ts && node --test tests/panel/creator-pipeline-bridge.test.mjs tests/panel/creator-pipeline.test.mjs`

  Expected: PASS for one/zero/three ideas, two/three variants, absent media/metrics/captions, inline/fullscreen boundaries, unsupported fullscreen requests, keyboard navigation, focus preservation, identity isolation, partial data, hostile text, safe URLs, no external requests, and responsive screenshots.

- [x] **Step 5: Commit**

  ```bash
  git add apps/panel/creator-pipeline apps/panel/creator-pipeline-bridge.ts tests/panel/creator-pipeline-bridge.test.mjs tests/panel/creator-pipeline-fixtures.test.ts tests/panel/creator-pipeline.test.mjs
  git commit -m "feat: add Riff discovery and studio views"
  ```

### Task 6: Resource rebrand, documentation, and release verification

**Files:**
- Modify: `apps/worker/mcp.ts`
- Modify: `apps/worker/creator-pipeline-resource.ts`
- Modify: `apps/worker/creator-review-resource.ts`
- Modify: `apps/worker/project-review-resource.ts`
- Modify: `apps/panel/creator-loop/index.ts`
- Modify: `apps/panel/creator-pipeline/index.ts`
- Modify: `apps/panel/creator-pipeline-bridge.ts`
- Modify: `apps/panel/creator-review.ts`
- Modify: `apps/panel/bridge.ts`
- Modify: `apps/panel/project-review.ts`
- Modify: `apps/panel/seed-video-review.ts`
- Modify: `apps/web/index.ts`
- Modify: `packages/application/operations.ts`
- Modify: `packages/application/creator-pipeline.ts`
- Modify: `packages/auth/index.ts`
- Modify: `packages/auth/website.ts`
- Modify: `tests/creator-pipeline-resource.test.ts`
- Modify: `tests/creator-pipeline-mcp.test.ts`
- Modify: `tests/auth-website.test.ts`
- Modify: `tests/auth.test.ts`
- Modify: `tests/operations.test.ts`
- Modify: `tests/creator-mcp.test.ts`
- Modify: `tests/creator-review-resource.test.ts`
- Modify: `tests/project-review-mcp.test.ts`
- Modify: `tests/integration/project-review-runtime.test.mjs`
- Modify: `tests/panel/creator-loop-saved.test.mjs`
- Modify: `tests/panel/creator-loop.test.mjs`
- Modify: `tests/panel/creator-pipeline-bridge.test.mjs`
- Modify: `tests/panel/creator-pipeline.test.mjs`
- Modify: `tests/panel/creator-review-bridge.test.mjs`
- Modify: `tests/panel/creator-review-integration.test.mjs`
- Modify: `tests/panel/project-review.test.mjs`
- Create: `tests/riff-brand-boundary.test.ts`
- Modify: `apps/panel/README.md`
- Modify: `README.md`
- Modify: `PRODUCT.md`

**Interfaces:**
- Consumes: Tasks 2–5 production bundles, plugin package, and resource/tool registrations.
- Produces: a documented, verifiable Riff UI slice with legacy limitations recorded separately from implemented behavior.

- [x] **Step 1: Write failing resource, brand-boundary, and end-to-end MCP assertions**

  In `tests/riff-brand-boundary.test.ts`, scan the exact source files listed in this task and fail on the legacy display brand in text/HTML/accessible copy. Assert the creator-job resource title, accessible labels, descriptions, and bundled document title are Riff-branded; its resource prefers fullscreen and keeps inline as a fallback. Assert the account website, OAuth challenge, application recovery copy, MCP descriptions/results, legacy project/Creator DNA cards, and creator-job surfaces say **Riff** wherever a person can see the name. Keep an explicit allowlist for compatibility-sensitive `kettle_diagnostic`, `ui://kettle/*` URIs, MCP server/app IDs, CSS classes, cookie names, RPC/function names, schema identifiers, fixture handles, test domains, and health-service identifiers; those are not a product-brand migration.

  Assert all Riff UI resources keep empty CSP allowlists and static HTML; assert `show_riff_welcome` remains anonymous/read-only, exactly one authenticated `get_riff_profile` descriptor carries the profile marker, while `open_riff` and `render_creator_job` appear only with their existing authenticated operation sets and cross-account reads remain indistinguishable from missing jobs.

- [x] **Step 2: Run the focused tests and verify RED**

  Run: `node --import tsx --test tests/riff-brand-boundary.test.ts tests/auth-website.test.ts tests/auth.test.ts tests/operations.test.ts tests/creator-mcp.test.ts tests/creator-review-resource.test.ts tests/project-review-mcp.test.ts tests/creator-pipeline-resource.test.ts tests/creator-pipeline-mcp.test.ts && node --test tests/integration/project-review-runtime.test.mjs tests/panel/creator-loop-saved.test.mjs tests/panel/creator-loop.test.mjs tests/panel/creator-pipeline-bridge.test.mjs tests/panel/creator-pipeline.test.mjs tests/panel/creator-review-bridge.test.mjs tests/panel/creator-review-integration.test.mjs tests/panel/project-review.test.mjs`

  Expected: FAIL on remaining Kettle-facing resource copy and missing end-to-end `open_riff` proof.

- [x] **Step 3: Finish the user-facing rebrand and update evidence docs**

  Change only human-visible brand references to **Riff** across auth, the account page, operation recovery messages, tool descriptions/results, resources, and panel instructions. Keep compatibility-sensitive tool names—especially `kettle_diagnostic`—plus database/RPC identifiers, resource URIs, service/app IDs, CSS selectors, cookies, schema names, and persisted data unchanged. Document local preview commands and host behavior in `apps/panel/README.md`, and update `PRODUCT.md`'s implementation snapshot to distinguish the implemented install-time setup skill, conversational welcome, Home shell, and job renderer from still-unimplemented durable account-level onboarding, direct upload, recents, save/undo, filmed-state, approved media previews, captions, and full single-video contracts. Record that Paper's viral headlines require an owner/compliance decision before public submission; implementation preserves the finalized source copy.

- [x] **Step 4: Run focused and full verification**

  Run: `npm run check`

  Expected: typecheck PASS; all TypeScript and Playwright tests PASS; Worker dry-run PASS; workerd smoke PASS; no generated bundles appear as tracked changes.

- [x] **Step 5: Perform whole-branch review and one bounded fix pass**

  Re-read the live Paper file **Riff**, page **Riff · Core workflows**, then build the review package from `origin/main...HEAD`. Verify the Review Focus items, trust boundaries, exact current Paper copy/vector proportions/Riff-owned styles, correct omission of ChatGPT-owned chrome, and absence of false capability claims. Any Critical or Important finding must receive one RED→GREEN fix before rerunning `npm run check`.

- [x] **Step 6: Commit and push the current branch**

  ```bash
  git add apps/worker apps/panel apps/web packages/application packages/auth tests apps/panel/README.md README.md PRODUCT.md docs/superpowers/plans/2026-10-10-riff-mcp-app-ui.md
  git commit -m "docs: record Riff MCP app UI evidence"
  git push -u origin HEAD
  ```

  Expected: the branch is present on GitHub and `git status --short` is clean. Do not claim the live development MCP changed unless a separately authorized deployment actually ran.

  Completed through `benasafk/kettle` because the authenticated GitHub account has read-only access to `gustasbull/kettle`; upstream pull request [#39](https://github.com/gustasbull/kettle/pull/39) carries the same branch without renaming it or changing the original `origin` remote.

- [x] **Step 7: Hand off ChatGPT refresh and host verification**

  Report the pushed commit/branch and separate four statuses: local package validation, repository test suite, remote deployment, and ChatGPT cache refresh. If an authorized deployment occurred through an existing verified pipeline, use MCP Inspector against the public `/mcp` endpoint, refresh the connection in ChatGPT, install the repo-local Riff package, and test setup in both a fresh conversation and an existing conversation. Otherwise mark those host checks pending and give the owner the exact refresh sequence; a GitHub push by itself is not proof that the Worker changed.

  Deployment was attempted with `wrangler deploy --env development` and stopped before upload because this environment has no Cloudflare authentication. A read-only check confirmed the existing public Worker is healthy but still serves the pre-Riff Kettle website/tool registry, so ChatGPT refresh remains pending until an owner deploys this commit.
