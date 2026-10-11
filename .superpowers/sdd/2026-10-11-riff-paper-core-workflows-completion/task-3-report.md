# Task 3 report — complete exact Paper analysis states

Status: DONE

Base: `73c55c98b51f723ed017d6249281d5d59924ef5d`

Commit: this commit (`feat: complete Paper analysis states`); its final hash is
returned in the agent handoff because a Git object cannot contain its own hash.

## Outcome

- Added the exact shared Paper loading variants for fetch-video, analyze-video,
  profile, product, and discovery. Product remains an exported but unrouted visual
  variant because the current job contract has no truthful product-pending state.
- Routed video loading by durable stage: accepted/reviewing uses Fetch, while
  building-analysis/saving uses Analyze. Profile scans and recommendation jobs keep
  their own Paper states. Progress remains indeterminate with no client timer or
  invented percentage.
- Matched the Paper loading card, preview wells, progress treatment, partial-video
  fallback, reduced-motion static state, complete video result, and shared TikTok /
  Instagram profile result styling and copy.
- Required a reported video-access basis plus exactly one of all six semantic
  dimensions before rendering the full video result. Transcript-only access gets
  the approved script handoff; incomplete visual analysis gets an honest limitation
  card and no six-row facade.
- Bound the video poster, duration, views, likes, and saves to the evidence record
  whose URL exactly matches the reviewed video. Observed zero stays visible; absent
  saves are never replaced by shares. Provider order cannot change row order, and a
  distinct recommendation is joined into one visible advice block.
- Added one optional strict `profile_analysis` projection. Trusted application code
  computes observed views, complete-input engagement rate, and up to three ranked
  records from display-permitted observations. Ranked records are added to public
  evidence; lineage, ranks, samples, and findings are cross-validated against public
  evidence/claims at both the Zod and lightweight panel boundaries.
- Rendered the profile screen from that explicit projection only: no sorting of the
  partial evidence array, no raw-claim polarity inference, no sample metrics, and no
  empty next-move CTA. Authored fixtures supply the three designed semantic bands.
- Made the terminal profile renderer platform-neutral with exact TikTok and
  Instagram headings, terminology, and badges. Production ingestion, progress,
  image validation, CSP, and provider adapters remain TikTok-only.

## Paper verification

The implementation was checked directly against Paper file
`01M39TTB7DKFHZY2JVDMAEDZ81`, page `p-5-0`, using basic-info, tree-summary, and JSX
reads for nodes `14TG-0`, `14QY-0`, `14R1-0`, `14R4-0`, `14UK-0`, `YB3-0`,
`XOP-0`, `YX9-0`, and `Z1G-0`. No screenshot inspection and no Paper mutation was
used. Browser regressions pin the visible copy, geometry, computed styling, stage
routing, static reduced-motion state, semantic order, evidence mapping, platform
variants, and truthful omission behavior.

## TDD record

- RED —
  `npx tsx --test tests/creator-analysis-presentation.test.ts tests/panel/creator-pipeline-fixtures.test.ts tests/panel/creator-pipeline-validation.test.ts`
  passed 22/26 and failed four new assertions: the profile projection was absent,
  observed zero was absent, the video fixture had no `source_kind`, and the display
  validator had no projection lineage to validate.
- GREEN — the same focused contract/fixture/validation command passed 26/26 after
  the strict projection, trusted computation, fixtures, and lightweight validator
  were implemented.
- GREEN — focused persistence, contracts, fixtures, validation, and browser command
  passed 58/58, including the actual PGlite migrations and all 14 creator-pipeline
  browser subtests.
- The browser regression covers both video loading phases, all three other reachable
  loading kinds, the unrouted product configuration, reduced motion, transcript-only
  and incomplete fallbacks, matching duration/metrics, observed unknown status,
  semantic ordering, TikTok and Instagram terms/badges, projection-backed top
  content/bands, and legacy omission.

## Final verification

- `npm run typecheck` — PASS, including deterministic panel builds.
- Focused contract/persistence/fixture/validation/browser command — PASS, 58/58.
- `npm run check` — PASS:
  - Worker types and all TypeScript checks;
  - 525/525 Node tests;
  - dry-run Worker build at 3,987.14 KiB / 805.00 KiB gzip;
  - local workerd smoke test;
  - the complete real-browser suite.
- Creator-pipeline bundle: 141,184 bytes raw / 38,966 bytes gzip,
  `sha256:5923bfecfd3e8b49dae841279803cb81a97314f5e0824ab52c5ac32fe38c6e4d`.
- `git diff --check` — PASS.

## Files

- Contract/application projection: `packages/contracts/creator-operations.ts`,
  `packages/application/creator-operations.ts`.
- Strict panel boundary: `apps/panel/riff-home-validation.ts`.
- Terminal/loading implementation: `apps/panel/creator-pipeline/index.ts`,
  `apps/panel/creator-pipeline/styles.ts`.
- Authored fixtures: `apps/panel/creator-pipeline/fixtures.ts`,
  `evals/creator-loop/pipeline-fixtures.ts`.
- Coverage: `tests/creator-analysis-presentation.test.ts`,
  `tests/panel/creator-pipeline-fixtures.test.ts`,
  `tests/panel/creator-pipeline-validation.test.ts`, and
  `tests/panel/creator-pipeline.test.mjs`.

## Truth and scope choices

- `profile_analysis` and every sub-area are optional, so legacy saved rows remain
  valid and render only fields they actually contain.
- Engagement uses only observations with views, likes, comments, and shares all
  present and a positive total-view denominator. Saves are excluded from the rate;
  missing values are never coerced to zero.
- Stored claims do not encode working/improvement polarity or recommendations, so
  trusted projection does not invent findings. The designed three bands appear only
  when explicit validated findings exist.
- A supplied-video analysis does not acquire profile-wide aggregates as a side
  effect; it exposes only matching seed/claim evidence.
- No migration, provider call, paid request, credential use, remote database reset,
  deployment, publication, or external Paper asset request occurred. Paper CDN URLs
  were not added anywhere. Instagram stays a validated terminal fixture/future
  renderer, not a production provider expansion.

## Fix round 1/5 — terminal truth, unique-video aggregates, rank order, and responsive cards

All six review findings were corrected:

- Pipeline dispatch now uses the effective validated compact-status state for the
  whole branch. A newer failed or reconciliation status replaces stale active
  progress with one recovery card; it is never appended below a spinner. A succeeded
  status over a stale active job shows a non-animated saved-result retrieval state
  until the authoritative full result arrives.
- Profile aggregation deduplicates display-permitted observations by
  `platform:native_id` before totals, engagement samples, and ranking. The newest
  `source_observed_at` (falling back to `retrieved_at`) wins; equal timestamps use
  ascending observation ID. A two-row/one-video fixture now projects successfully
  with one sample and one ranked record.
- Both the authoritative Zod refinement and the dependency-light panel validator
  require top-content views to be non-increasing. View ties use ascending observation
  ID, matching the mapper's ranking comparator.
- At 700 px and below, the 88 px desktop cards shrink evenly inside the profile
  card. Browser coverage exercises one, two, and three cards at both 320 px and
  375 px, proving every card remains within its container and neither the document
  nor pipeline surface overflows.
- The reviewed-count element is now appended immediately after the portrait and
  before Top videos/Reels; the conflicting CSS `order` rule was removed.
- Computed Paper tokens now match: analysis advice gap 2 px, views icon well
  `#F0F3F7`, saves well `#FFF3D9`, and analysis/profile primary borders `#A786E9`.

### RED/GREEN evidence

- RED —
  `npx tsx --test tests/creator-analysis-presentation.test.ts tests/panel/creator-pipeline-validation.test.ts`
  passed 22/25. Failures proved descending views were not validated at either
  boundary and duplicate rows made a one-unique-video projection throw because its
  sample size became two.
- RED — `node --test tests/panel/creator-pipeline.test.mjs` passed 11/14. A newer
  failed status still produced two cards, and the profile children were ordered
  portrait / Top / reviewed instead of portrait / reviewed / Top. The same
  regression continues into reconciliation, succeeded retrieval, mobile layout,
  and computed-token assertions once those earlier failures are cleared.
- GREEN — the focused contract/application/validation command passed 25/25 and the
  creator-pipeline browser suite passed 14/14.
- Two adjacent browser fixtures that deliberately remove evidence now also remove
  the optional projection whose lineage depends on that evidence; the supplied-video
  fixture declares video source kind and all six explicit unknown dimensions. These
  are contract-consistent fixture repairs, not weaker production validation. The
  combined compatibility/pipeline browser command passed 25/25.
- `npm run typecheck && npm run build:panel` — PASS.
- `npm run check` — PASS: TypeScript, 526/526 Node tests, Worker dry-run build at
  3,988.93 KiB / 805.52 KiB gzip, local workerd smoke, and the complete real-browser
  suite. The browser suite was also run directly to capture its untruncated result:
  83/83 passed.
- Creator-pipeline bundle: 141,354 bytes raw / 39,064 bytes gzip,
  `sha256:1996e4c0a505b3bd171de2bf3ce31a0bf143cd2f0e223064fe38e13a5eca37ee`.
- `git diff --check` — PASS.

Fix base: `6309956d9c422f23d22c9208af3d2ac82eb0ece6`.

Fix commit: this commit (`fix: harden Paper analysis states`); its final hash is
returned in the agent handoff. No remaining concern requires expanded provider,
database, migration, CSP, or deployment scope.
