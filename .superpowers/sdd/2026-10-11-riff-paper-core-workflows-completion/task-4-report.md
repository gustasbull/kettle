# Task 4 report — add Paper Product context flow

Status: DONE

Base: `91699ee0edd2a670d362d5de267487afd22d5022`

Commit: this commit (`feat: add Paper product context flow`); its final hash is
returned in the agent handoff because a Git object cannot contain its own hash.

## Outcome

- Added backward-compatible optional `Brief.description` persistence. Historical
  briefs without it remain valid, while the new Product editor requires a real
  nonempty description and never serializes the visible Unknown placeholder.
- Added an explicit local **Product description** / **Video idea** choice for every
  non-URL Home submission. It performs no classifier, model, or provider call.
  Product text is preserved exactly into the controlled editor; video ideas retain
  the existing honest ChatGPT handoff.
- Implemented the truthful Product pending state and Paper editor with Product,
  Description, Audience, Main benefit, Content style, Language, 5–180 second
  duration, and removable filming constraints. Unknown values stay editable rather
  than inferred.
- Bound persistence to explicit **Confirm context**. Strict dependency-light
  parsers require the exact request ID, project/version transition, project name,
  type, full brief, and complete receipt-backed Project snapshot before success.
- Preserved the exact `save_project` input for ambiguous and retry-same-request
  retries. Create uses null project / version zero; receipt-backed edits use the
  trusted project ID and current version with a fresh request ID.
- Version conflicts and not-found updates may reread only the project ID already
  held in the trusted session snapshot. The local draft survives reconciliation;
  no Product project is guessed, listed, or accepted from panel/account input.
- Added the receipt-gated **Discover formats** action using the exact no-Creator-DNA,
  no-provider ChatGPT handoff. It never starts recommendations or claims that
  references or formats were discovered.
- Account changes, new Home actions, and navigation clear pending Product save
  identity and dispose private UI. Late responses cannot restore prior-account
  content.
- Added focus recovery, inline errors, busy/live state, keyboard-operable constraint
  controls, reduced-motion and forced-colors behavior, dark styling, 200% text
  coverage, and responsive 320/768/1440 layouts with no horizontal overflow.

## Paper verification

The implementation was checked directly against Paper file
`01M39TTB7DKFHZY2JVDMAEDZ81`, page `p-5-0`. Read-only Paper MCP basic-info and JSX
inspection covered Product context node `13WO-0` and shared pending node `14R4-0`,
including the 904.5 × 508 panel, 28/52 padding, 252/540 content columns, typography,
five designed rows, copy, button, and pending composition. No screenshot inspection
and no Paper mutation were used.

The illustrative audience/category values in Paper were not presented as facts.
The pending state reports only that the submitted description was received and that
the local editable brief is being prepared; it shows no invented percentage.

## TDD record

- RED — the first contract/validation command failed because strict `Brief` rejected
  `description` and the new validation module did not exist. With the minimal module
  surface present, all five new validation assertions still failed on missing
  create/update construction, required-field bounds, strict receipts, trusted reads,
  and product-specific failures.
- RED — the Product browser test failed because the pending/editor component did not
  exist. The Home bridge regression failed because the explicit intent group and its
  Product / Video idea controls did not exist.
- RED — a receipt with semantically identical Brief JSON in a different object-key
  order was initially rejected. Canonical key ordering now preserves strict value
  equality without treating JSON serialization order as contract data.
- GREEN —
  `node --import tsx --test tests/contracts.test.ts tests/panel/riff-product-context-validation.test.ts`
  passed 11/11.
- GREEN —
  `node --test --test-reporter=spec --test-timeout=30000 tests/panel/riff-product-context.test.mjs`
  passed 2/2.
- GREEN — the focused Home/Product bridge command passed 3/3, covering local intent
  selection, exact retries, create/update, receipt-only success, malformed success,
  trusted conflict reread, no unsupported lookup/provider call, no-DNA handoff, and
  account-boundary invalidation.
- The first complete browser run exposed a timing-only pending-state assertion under
  suite load (86/87 passed). The state was made intentionally perceivable for 160 ms
  without adding simulated progress; the standalone regression and final complete
  browser suite then passed.

## Final verification

- `npm run typecheck` — PASS, including deterministic panel builds.
- Focused contract, validation, component, and bridge suites — PASS, 16/16.
- `npm run check` — PASS:
  - Worker types and all TypeScript checks;
  - 532/532 Node tests;
  - dry-run Worker build at 4,016.73 KiB / 813.68 KiB gzip;
  - local workerd smoke test;
  - 87/87 real-browser tests.
- Riff Home bundle: 199,189 bytes raw / 56,352 bytes gzip,
  `sha256:c38abd46c3095eafe84767d1e4c603f64b510bb84f6ab8a791ea9e710ebbb02f`.
- `git diff --check` — PASS.

## Files

- Contract: `packages/contracts/index.ts`.
- Product boundary and UI: `apps/panel/riff-product-context-validation.ts`,
  `apps/panel/riff-product-context/index.ts`, and
  `apps/panel/riff-product-context/styles.ts`.
- Home integration: `apps/panel/riff-home/index.ts` and
  `apps/panel/riff-home-bridge.ts`.
- Coverage: `tests/contracts.test.ts`,
  `tests/panel/riff-product-context-validation.test.ts`,
  `tests/panel/riff-product-context.test.mjs`, and
  `tests/panel/riff-home-bridge.test.mjs`.

## Truth and scope choices

- Existing protected `save_project` and `get_project` definitions already expose the
  required authenticated tools, so worker MCP definitions were not changed.
- Persisted facts are empty on create and copied only from a strict trusted saved
  snapshot on update. Product prose never creates facts, audience, benefit, style,
  Creator DNA, references, or provider evidence.
- Cross-session Product reopening remains deliberately unreachable from
  `open_riff({})`, which supplies no trusted project ID.
- No migration, public unauthenticated tool, provider/model call, paid request,
  credential use, remote database operation, deployment, publication, or Paper
  mutation occurred.

## Concerns

None within Task 4 scope. Cross-session Product reopening and Product-to-DNA
discovery still require a future trusted project-selection/link contract and are not
simulated by this implementation.

## Fix round 1/5 — next-paint truth, strict envelopes, reachable validation, and failure coverage

All reviewer findings were addressed within Task 4:

- Removed the artificial 160 ms Product-pending timer. Unsaved Product context now
  advances on `requestAnimationFrame`, with only a microtask fallback when no browser
  frame API exists. A new start cancels the prior frame, disposal cancels the current
  frame, and generation checks remain as a second stale-work guard. There is no
  elapsed-time progress or wall-clock delay.
- Save/Get parsing now requires an own `structuredContent` property inside a plain
  CallToolResult object. Only `content`, `structuredContent`, `isError`, and `_meta`
  are allowed; optional `content`, `isError`, and `_meta` must have valid top-level
  types. Direct inner results, missing structured content, unknown outer keys,
  accessors, inherited prototypes, malformed content/meta, and non-boolean
  `isError` all fail closed. Strict inner exact-key validation is unchanged.
- **Confirm context** remains reachable when the draft is invalid. Its help text is
  derived from every current validation error, including Unknown placeholders,
  bounds, duration, and constraints. A real button click or Enter submission reveals
  all inline errors, associates them with controls via `aria-invalid` and
  `aria-describedby`, and focuses the first invalid input. Errors update as the user
  edits; an excess 21st constraint is explicitly recoverable by removal.
- Expanded the actual Home bridge regression through timeout, transport rejection,
  UNAVAILABLE, UNAUTHENTICATED, FORBIDDEN, VALIDATION_ERROR, NOT_FOUND, and
  IDEMPOTENCY_CONFLICT. It proves safe Product copy, local draft preservation, exact
  request reuse for ambiguous/retry-same-request outcomes, rotation after definitive
  failures, exact-intent blocking after idempotency conflict, and a fresh request
  after the intent changes.
- `get_project` remains unavailable to create failures and is called only for a
  trusted current project after VERSION_CONFLICT or NOT_FOUND. A successfully reread
  NOT_FOUND path retains the local draft/base snapshot but now reports that the
  saved Product context is unavailable; it no longer invents a “newer version.”

### RED/GREEN evidence

- RED — strict-envelope regression passed 0/1: a direct inner success was returned
  as `saved` instead of `malformed`.
- RED — Product browser regressions passed 0/2: Confirm was disabled (`false` versus
  expected reachable `true`), and two starts scheduled `[160, 160]` timers with zero
  animation frames or cancellation.
- RED — expanded bridge regressions passed 1/2: the new failure matrix already
  confirmed correct retry/auth/idempotency behavior, while trusted NOT_FOUND timed
  out waiting for the required unavailable message because it rendered the version-
  conflict message instead.
- GREEN — Product validation passed 6/6, Product component browser coverage passed
  4/4, and focused Product bridge coverage passed 3/3.
- `npm run typecheck && npm run build:panel` — PASS.
- `npm run check` — PASS: TypeScript, 533/533 Node tests, Worker dry-run build at
  4,017.40 KiB / 813.85 KiB gzip, local workerd smoke, and 90/90 real-browser tests.
- Riff Home bundle: 199,875 bytes raw / 56,542 bytes gzip,
  `sha256:e2bf0923823355d04b3a55b3794513df7a2588cc284fc59eab71ee14980e52a5`.
- `git diff --check` — PASS.

Fix base: `d83e08088bb98f785e9d6122a4379c0e48f86b8c`.

Fix commit: this commit (`fix: harden Paper product context flow`); its final hash is
returned in the agent handoff. No remaining concern requires Task 5+, provider,
database, migration, public-tool, or deployment scope.

## Fix round 2/5 — strict Product CallToolResult authority

Both remaining strictness findings were addressed without changing generic creator
tool behavior:

- Replaced `Object.keys`-only shape checks with `Reflect.ownKeys` discipline across
  Product outer and nested object shapes. Every admitted property must be an own,
  enumerable data property with an allowed string key; symbols, non-enumerable keys,
  accessors, inherited prototypes, unknown keys, and present-but-undefined optional
  values fail closed.
- Added strict JSON record/array validation for `_meta`, including finite numbers,
  dense arrays, no extra/symbol properties, and recursively plain JSON values.
- Added dependency-light validation for realistic MCP content blocks: text, image,
  audio, resource links, and embedded text/blob resources, plus annotations and icon
  shapes. Malformed content arrays/blocks are rejected while representative host
  text/resource-link envelopes remain valid.
- Product Save/Get calls now use a raw Product-only path that preserves transport
  timing/performance measurement but disables the bridge's generic application-error
  interpretation. Only `parseProductSaveResult` / `parseProductGetResult` can
  authorize a Product error code or recovery action.
- Direct inner failures and failures hidden in envelopes with unknown, accessor,
  symbol, non-enumerable, undefined, invalid-content, or invalid-`isError` properties
  remain ambiguous. They keep the exact pending request ID, expose only the fixed
  malformed-response message, and never authorize `get_project`.
- Valid strict VERSION_CONFLICT and NOT_FOUND envelopes still reread only the trusted
  session project ID. Valid strict auth, validation, retry, and idempotency failures
  retain their established Product-specific behavior.

### RED/GREEN evidence

- RED — the strict CallToolResult regression passed 0/1: a malformed envelope with
  smuggled own properties was still parsed as `saved` rather than `malformed`.
- RED — the Product bridge regression passed 0/1: a direct spoofed
  VERSION_CONFLICT bypassed Product parsing, displayed “A newer saved version,” and
  triggered reconciliation instead of the fixed malformed-response path.
- GREEN — focused contract/Product validation passed 12/12, Product component
  browser coverage passed 4/4, and Product bridge coverage passed 3/3 (19/19 total).
- `npm run typecheck && npm run build:panel` — PASS.
- `npm run check` — PASS: TypeScript, 533/533 Node tests, Worker dry-run build at
  4,020.02 KiB / 814.45 KiB gzip, local workerd smoke, and 90/90 real-browser tests.
- Riff Home bundle: 202,566 bytes raw / 57,251 bytes gzip,
  `sha256:e804362f258f69c00cb626291e1b61bfacd788a5b4b98479f71965cf6a99d127`.
- `git diff --check` — PASS.

Fix-round-2 base: `b9c652d285305bd24d711c35548d34f7f23549b3`.

Fix-round-2 commit: this commit (`fix: enforce strict Product tool envelopes`); its
final hash is returned in the agent handoff. No Task 5+, provider, database,
migration, public-tool, or deployment scope was added.
