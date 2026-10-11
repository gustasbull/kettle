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
