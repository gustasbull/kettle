# Task 6 report — complete Paper Riff Studio

Status: DONE

Base: `1cff5c4`

Commit: this commit (`feat: complete Paper Riff Studio`); its final hash is returned
in the agent handoff because a Git object cannot contain its own hash.

## Outcome

- Added optional, bounded, unique per-segment reference lineage to the authoritative
  contract and lightweight panel validator. Segment IDs must be a subset of their
  own variant evidence; historical segments that omit lineage remain valid.
- Added a compact accessible 2–3 variant selector keyed by persisted variant ID.
  Selection is local-only, reconciles a disappearing variant, resets for a new job,
  and never mutates or prompts.
- Implemented distinct Full video, Hook, Main content, and CTA Studio views. Actual
  segment ranges are the only timing authority; incomplete or legacy fallback data
  is labelled timing unavailable instead of inferring duration or part counts.
- Rendered ordered same-part script cards with separate filming direction and
  on-screen text. Legacy guidance remains explicitly general. Caption/hashtags are
  shown only when persisted.
- Resolved visible references from the union of displayed segment lineage when
  present, otherwise from complete variant lineage. The deterministic first resolved
  reference drives the player while every resolved safe reference and its provenance
  remains visible. Missing evidence or media is an accessible unavailable state.
- Connected all four Explore actions to Videos, Hooks, Product showcases, and CTAs
  with retained part-specific `RiffStudioExploreIntent`. Catalog proposals preserve
  the exact part prompt and visibly state that the persisted script is unchanged.
- Kept TikTok/Reels as ID-stable local presentation guidance only. It does not alter
  persisted script, caption, references, platform targets, or publication state.
- Kept **Save for later** and **I filmed it** reachable with exact Paper copy while
  reporting an honest unsupported ChatGPT handoff. Task 6 adds no false saved or
  published state; Task 7 retains ownership of persistence.
- Matched the audited Studio surfaces and added narrow-width, dark,
  forced-colors, reduced-motion, 200%-text, focus, and no-overflow behavior.

## Paper verification

Direct Paper access used file `01M39TTB7DKFHZY2JVDMAEDZ81`, page `p-5-0`, and
CURRENT artboard `Z9H-0` (7700×10112). `get_basic_info` succeeded and matched the
checked-in direct-MCP audit handoff token hash `17cc259e`. The authoritative Studio
nodes are `Y3N-0`, `OJV-0`, `TMD-0`, and `TOF-0` plus their audited descendants.

Fresh JSX and computed-style reads for those nodes were attempted, but Paper returned
`Edit access is required to use MCP for this file`. Implementation therefore used
the checked-in direct-MCP audit handoff for exact node/style values after confirming
the same file, page, CURRENT artboard, and token hash. No screenshot was used as
implementation input and Paper was not mutated.

## TDD record

- RED — `npx tsx --test tests/panel/creator-pipeline-validation.test.ts
  tests/creator-pipeline-mcp.test.ts` passed 22/24. The failures proved the missing
  segment-lineage contract and missing MCP authoring instruction.
- RED — `node --test tests/panel/creator-pipeline.test.mjs` passed 13/17. The four
  failures covered the exact Explore label, two variant-selector behaviors, and the
  missing catalog lifecycle action.
- GREEN — the focused contract/fixture/MCP group passed 27/27.
- GREEN — the Studio browser suite passed 17/17.
- GREEN — the standalone bridge suite passed 13/13, including all four retained
  part-specific catalog proposal intents.
- GREEN — the five integration suites affected by refined schema derivation passed
  96/96 after the application/provider boundaries adopted the reusable savable
  variant schema.

## Final verification

- `npm run check` — PASS:
  - deterministic panel build and TypeScript checks;
  - 537/537 Node tests;
  - dry-run Worker build at 4,046.14 KiB / 821.58 KiB gzip;
  - local workerd smoke test;
  - 95/95 real-browser tests.
- Creator-pipeline bundle: 153,862 bytes raw / 42,518 bytes gzip,
  `sha256:666f22e42aeaa319e05c21e3da30a9b26efe709b951c6f6887f5f20ef14b2b8e`.
- Riff Home bundle: 215,688 bytes raw / 60,952 bytes gzip,
  `sha256:4f0fcb1944c5191e0917bb6a05ac88a0bbe9bb38bba8e49fc682a45ae1dfa411`.
- `git diff --check` — PASS.

## Files

- Studio UI/state/style/fixture: `apps/panel/creator-pipeline/index.ts`,
  `apps/panel/creator-pipeline/styles.ts`, and
  `apps/panel/creator-pipeline/fixtures.ts`.
- Contracts and strict display boundary: `packages/contracts/creator-pipeline.ts`
  and `apps/panel/riff-home-validation.ts`.
- Contract consumers kept compatible with refined validation:
  `packages/application/creator-pipeline.ts` and
  `packages/adapters/creator-pipeline/provider.ts`.
- MCP authoring guidance: `apps/worker/mcp-definitions.ts`.
- Coverage: `tests/creator-pipeline-mcp.test.ts` and creator-pipeline validation,
  browser, and bridge tests under `tests/panel/`.

## Truth and scope choices

- Segment lineage remains optional. Unknown lineage is omitted, never guessed; full
  variant lineage remains complete and authoritative.
- Variant and platform selection are local presentation state. Neither sends a tool
  call nor changes persisted data.
- Explore creates only a bounded ChatGPT/catalog proposal and explicitly retains the
  current script. No replacement mutation or fabricated discovery selection exists.
- No migration, new public tool, provider/model call, spending, deployment,
  publication, platform target, work state, credential use, or Paper mutation was
  added.

## Concerns

- Fresh Paper JSX/computed-style inspection was blocked by file permissions. The
  implementation is grounded in the checked-in direct-MCP audit whose identity/hash
  was freshly confirmed; a later visual reviewer with Paper edit access can rerun
  those reads without changing Task 6 behavior.
- Save/Filmed persistence is intentionally absent until Task 7.

## Fix round 1/5 — align Paper Studio details

Fix base: `55c2b337dfd7171582e6d6e9251b9676bfef12cd`.

Independent review found one Important and two Minor issues. Legacy variants without
timed segments now render persisted `on_screen_text` once in the distinct labelled
on-screen treatment; only shots, B-roll, showcase timing, and pacing remain in
**General filming guidance**. Caption handling remains separate and unchanged.

The Studio screen now uses Paper's `overflow: clip`, and the script-card title band
uses Paper's `#F0F3F7`. Real computed-style assertions cover both values and the
existing viewport checks continue to prove no document overflow.

The controller's additional keyboard audit found that selection moved but generic
render focus recovery returned focus to the prior radio/tab. Arrow, Home, and End now
move DOM focus to the newly selected ID-keyed variant radio or Studio tab after the
render, preserving the roving-tabindex contract.

### Regression-first TDD record

- RED — the first Studio browser run passed 14/17. The two failing subtests showed
  ArrowRight retained focus on **Full video** and **Reference-led** after selecting
  Hook and Creator Fit.
- RED — after the focused keyboard fix, the next run reached the style assertion and
  reported Studio overflow `hidden` instead of `clip`.
- RED — after the overflow fix, the next run reported the script-card band as
  `rgb(239, 244, 255)` instead of `rgb(240, 243, 247)`.
- RED — after the colour fix, the legacy regression showed `One desk change`
  flattened into **General filming guidance** instead of a separate on-screen label.
- GREEN — the Studio browser suite passed 17/17 with every regression active.
- GREEN — typecheck passed and the combined Studio/standalone-bridge suites passed
  30/30.

### Fix verification

- `npm run check` — PASS:
  - 537/537 Node tests;
  - dry-run Worker build at 4,046.54 KiB / 821.74 KiB gzip;
  - local workerd smoke test;
  - 95/95 real-browser tests.
- Creator-pipeline bundle: 154,063 bytes raw / 42,591 bytes gzip,
  `sha256:2ea1e908d2dcd024f4371f8f60144bc161097de530424434d185871f4716849f`.
- Riff Home bundle: 215,889 bytes raw / 61,018 bytes gzip,
  `sha256:bcfeab4790c25e532f095d8f50dbc03e002b0c371bd5ff00b9c14c034416cbc7`.
- `git diff --check` — PASS.

Fix commit: this commit (`fix: align Paper Studio details`); its final hash is
returned in the agent handoff because a Git object cannot contain its own hash.

## Fix round 2/5 — match Paper Studio tab rail

Fix base: `39ee143760219a94ee9d9e730b5478c08ac55778`.

Fresh review found that `.riff-studio-tabs` still inherited the shared Discovery
rail colour `#F0F0F2`. Studio now has a narrow selector-scoped `#F0F3F7` override;
the shared rule and Discovery rails are unchanged.

### Regression-first TDD record

- RED — `node --test tests/panel/creator-pipeline.test.mjs` passed 15/17. The
  real computed Studio rail was `rgb(240, 240, 242)` instead of the independently
  audited Paper value `rgb(240, 243, 247)`.
- GREEN — the Studio browser suite passed 17/17 with the exact computed-style
  assertion active.
- GREEN — typecheck passed and the combined Studio/standalone-bridge suites passed
  30/30.

### Fix verification

- `npm run check` — PASS:
  - 537/537 Node tests;
  - dry-run Worker build at 4,046.58 KiB / 821.74 KiB gzip;
  - local workerd smoke test;
  - 95/95 real-browser tests.
- Creator-pipeline bundle: 154,084 bytes raw / 42,594 bytes gzip,
  `sha256:c30b8c7f89210999afcdb46b566020a49355ed438f01584b315d2b8e2d95f153`.
- Riff Home bundle: 215,910 bytes raw / 61,020 bytes gzip,
  `sha256:d121ece85b51aa22ef3ea31fae16d879c733ce4f635403deb91dbc27fb96cb3e`.
- `git diff --check` — PASS.

Fix commit: this commit (`fix: match Paper Studio tab rail`); its final hash is
returned in the agent handoff because a Git object cannot contain its own hash.
