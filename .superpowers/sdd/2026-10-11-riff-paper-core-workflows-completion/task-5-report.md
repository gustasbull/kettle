# Task 5 report — complete Paper Discovery libraries

Status: DONE

Base: `06427cce91d33a28dd078da8708910240996f7ea`

Commit: this commit (`feat: complete Paper Discovery libraries`); its final hash is
returned in the agent handoff because a Git object cannot contain its own hash.

## Outcome

- Centralized the exact Videos, Hooks, Product showcases, and CTAs library metadata,
  including six lenses per library, Paper titles/copy, selected state, and action
  copy. Every library/lens now retains the same validated order without claiming a
  backend classification or rank.
- Limited both recommendation and catalog stages to the active card plus four real
  peeks while retaining navigation dots for every admitted item (up to eight catalog
  observations). No cards pile onto the outer positions.
- Kept recommendation selections and saved-reference proposals structurally
  separate. Recommendations retain owned job/batch/idea lineage; catalog proposals
  contain only the validated card, source, library, lens, proposal intent, and an
  optional bounded Studio context. Catalog actions never call `makeMine` or claim a
  selection/write.
- Added truthful Studio Explore handoffs for full video, hook, main-content showcase,
  and CTA. The matching local context survives browsing and reaches the actual
  ChatGPT bridge message; mismatched library, render, account, or project navigation
  clears it.
- Replaced ambiguous catalog publication with loading/ready/empty/error states,
  retained a prior trusted page during same-scope retry failures, and made explicit
  Retry the only retry path. Epoch and trusted owner/project boundaries reject late
  success and failure results.
- Catalog reads now request only `role: 'discovered_reference'`, newest first, limit
  eight. A mixed-role or oversized page is rejected as a whole and its cursor is
  never consumed.
- Preserved persisted zero metrics and omitted null metrics. Safe URLs, inert media,
  observation provenance, and accessible page-level coverage/freshness caveats are
  derived only from validated saved data; there is no runtime Paper fixture fallback.
- Preserved active catalog identity and focus across same-scope reorder/refresh, and
  reset library/lens/card/context across trusted scope changes. The standalone
  bridge uses a bridge-owned opaque owner key independent of project ID.
- Matched Paper carousel geometry, responsive containment, keyboard behavior,
  reduced-motion/forced-colors behavior, and local-only Home shortcuts.

## Paper verification

Read-only direct Paper inspection used file `01M39TTB7DKFHZY2JVDMAEDZ81`, page
`p-5-0`, and nodes `XA2-0`, `140F-0`, `1469-0`, and `14C3-0`. Basic info, JSX, and
tree summaries were inspected directly; no screenshot was used as implementation
input and Paper was not mutated.

Verified values include the 999×566 stage, 160/196/232 card widths,
142×266 / 178×330 / 214×354 media, 24/18 radii, 34/42 title, 14/22 subtitle,
`#F0F0F2` rails, `#6933A1` selected state, 44/36 controls, 36px arrows, the centered
340px navigation row with 10px gap, and up to eight real-position dots without a
visible total. Desktop overflow remains visible for peeks; 320/375/768 layouts use
bounded containment with centered active content and no document overflow.

## TDD record

- RED — `npx tsx --test tests/panel/riff-video-catalog-loader.test.ts` passed 0/5.
  Failures showed the missing role filter, discriminated state publication, explicit
  retry, same-scope prior-page retention, and late-result isolation.
- RED — the first creator-pipeline browser run passed 10/14 and failed four checks
  covering intentionally blank libraries/lenses and missing catalog state APIs.
- GREEN — the focused catalog-loader suite passed 5/5.
- GREEN — loader, streaming, and fixture coverage passed 20/20.
- GREEN — the creator-pipeline browser suite passed 15/15.
- GREEN — the standalone bridge suite passed 13/13, including actual outgoing
  ChatGPT messages for all four Studio part mappings.
- GREEN — the complete browser suite passed 92/92.

## Final verification

- `npm run check` — PASS:
  - deterministic panel build and TypeScript checks;
  - 536/536 Node tests;
  - dry-run Worker build at 4,030.73 KiB / 817.88 KiB gzip;
  - local workerd smoke test;
  - 92/92 real-browser tests.
- Creator-pipeline bundle: 146,526 bytes raw / 40,757 bytes gzip,
  `sha256:5c00d9050cd2289beed8d7814eb27492281e580be5b92bdfd6fb885d169cc23f`.
- Riff Home bundle: 208,310 bytes raw / 59,203 bytes gzip,
  `sha256:9132ef327c7b79a9705651189aa0bfa733c12bcd6e48512bf401831a9017983b`.
- `git diff --check` — PASS.

One full-check attempt encountered the repository's concurrent generated-file test
race (`riff-onboarding-bundle.ts` was briefly absent while another build test
intentionally removed stale output). Repository tooling restored the artifact, and
`node --import tsx --test tests/mcp-result-wire.test.ts` passed 2/2 in isolation.
The fresh complete rerun above then passed without a code change.

## Files

- Discovery UI/state/style: `apps/panel/creator-pipeline/index.ts`,
  `apps/panel/creator-pipeline/styles.ts`, and
  `apps/panel/creator-pipeline/fixtures.ts`.
- Strict catalog boundary: `apps/panel/creator-pipeline-validation.ts` and
  `apps/panel/riff-video-catalog-loader.ts`.
- Bridge/Home integration: `apps/panel/creator-pipeline-bridge.ts`,
  `apps/panel/riff-home/index.ts`, and `apps/panel/riff-home-bridge.ts`.
- Coverage: creator-pipeline, fixture, streaming, loader, standalone-bridge,
  Home-bridge, and Home browser tests under `tests/panel/`.

## Truth and scope choices

- Creative lenses adapt a user proposal only; they never filter, reorder, or imply
  persisted category ranking.
- Catalog references remain saved observations, not recommendation selections. Their
  actions are unsaved ChatGPT proposals and do not invent job/batch/idea IDs.
- Catalog navigation is provider-free and cursor-local. No polling, provider/model
  fetch, spending, new public tool, schema/migration, credential use, deployment,
  publication, or Paper mutation was added.

## Concerns

None within Task 5 scope.

## Fix round 1/5 — preserve Studio Discovery context across trusted refresh

Fix base: `6fc3d17ac33f6683cb00a867a9d854c0c0437dbb`.

The review found that every pipeline `render(job)` call cleared `studioExplore` and
then replaced the catalog screen, even when a compact status refresh described the
same trusted job. The renderer now preserves the catalog only when all of these
remain true: the account/project/job identity matches, the catalog is still open,
the Studio context names the active library, and the trusted catalog scope remains
the same project. It updates the current job and presentation status before
rerendering the retained catalog. A different account, project, job, library, or
stale scope cannot restore that context.

Intentional navigation now uses an explicit `leaveCatalog()` boundary. Home,
Create, and the standalone pipeline's recent-job and non-Discovery menu navigation
clear both the catalog screen and its Studio context, so reopening the same job
after leaving does not revive stale UI. Existing Discovery shortcuts continue to
establish their own trusted library and scope.

### Regression-first TDD record

- RED — the new creator-pipeline regression passed 14/16 checks; the same-job
  status refresh removed the expected Hook catalog (`Stop the scroll.` count was
  zero). After the narrow preservation change, existing tests exposed their former
  reliance on `render(job)` as an implicit navigation boundary, leading to the
  explicit leave API.
- RED — the new Home boundary check passed 0/1; Home followed by reopening the same
  job incorrectly restored the catalog instead of the Studio Hook tab.
- GREEN — `node --test tests/panel/creator-pipeline.test.mjs` passed 16/16.
- GREEN — the targeted Paper Home regression passed 1/1.
- GREEN — the creator-pipeline and Riff Home bridge suites passed 29/29, and the
  focused TypeScript check passed.

### Fix verification

- `npm run check` — PASS:
  - 536/536 Node tests;
  - dry-run Worker build at 4,031.00 KiB / 817.97 KiB gzip;
  - local workerd smoke test;
  - 93/93 real-browser tests.
- Creator-pipeline bundle: 146,662 bytes raw / 40,806 bytes gzip,
  `sha256:ef3313b5d4f753d660e7bf98712798d1c3d72af4e60562f5e87a8be31093a2d4`.
- Riff Home bundle: 208,453 bytes raw / 59,265 bytes gzip,
  `sha256:48fa9ad86ab9282557080777cdf58800e4c2e04a3063a5b1a954679dd878a2cc`.
- `git diff --check` — PASS.

Fix commit: this commit (`fix: preserve Studio discovery context`); its final hash
is returned in the agent handoff because a Git object cannot contain its own hash.

## Fix round 2/5 — clear Discovery context on Recent navigation

Fix base: `25e39f59ab548fb3a95f37408b9754ecb8eae597`.

The embedded Home drawer owns its own Recent handler, separate from the standalone
pipeline menu fixed in round 1. Selecting a Recent while a Studio catalog was open
called `openRecent` without first leaving that catalog. When the selected job was
the currently open job, the trusted same-identity refresh correctly met the round-1
preservation predicate and therefore restored context that navigation should have
discarded.

The drawer Recent handler now calls `pipeline?.leaveCatalog()` after validating the
selected owned recent and before beginning the asynchronous open. Different-job
navigation remains protected by the identity reset; current-job navigation now has
the same explicit boundary. Home-page recent cards need no additional call because
they are reachable only after `showHome()` has already left the catalog.

### Regression-first TDD record

- RED — the focused current/different Recent browser regression passed 0/1. On the
  current-job branch, the expected Studio Hook tab count was zero because the old
  `Stop the scroll.` catalog had been restored.
- GREEN — the focused regression passed 1/1. It verifies current-job navigation
  clears the visible catalog and proposal context, and different-job navigation
  continues to clear by identity.
- GREEN — the combined creator-pipeline and Riff Home component suites passed
  19/19.
- GREEN — the creator-pipeline and Riff Home bridge suites passed 29/29, and the
  focused TypeScript check passed.

### Fix verification

- `npm run check` — PASS:
  - 536/536 Node tests;
  - dry-run Worker build at 4,031.02 KiB / 817.97 KiB gzip;
  - local workerd smoke test;
  - 94/94 real-browser tests.
- Creator-pipeline bundle: 146,662 bytes raw / 40,806 bytes gzip,
  `sha256:ef3313b5d4f753d660e7bf98712798d1c3d72af4e60562f5e87a8be31093a2d4`.
- Riff Home bundle: 208,474 bytes raw / 59,268 bytes gzip,
  `sha256:62b3bf1f38bc4f223ca4f14acc8f7c9f57a7f9afd58335fd6c2cdef116d18e7d`.
- `git diff --check` — PASS.

Fix commit: this commit (`fix: clear discovery context on recent navigation`); its
final hash is returned in the agent handoff because a Git object cannot contain its
own hash.
