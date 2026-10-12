# Task 8 report — Riff Core workflows visual acceptance

## Outcome

Completed local acceptance of the Riff-owned CURRENT workflows against the
read-only Paper authority. The acceptance surface now has a deterministic,
test-only 42-row fixture matrix; 15 executable browser suites; one-root Home
navigation through Product, loading, analysis, Discovery, Studio, Saved, and
resume; equivalent standalone pipeline behavior; and current immutable Home v8,
inline onboarding v8, and standalone pipeline v8 resources with compatibility
aliases.

No provider request, paid work, hosted deployment, publication, Paper mutation,
production secret, external outreach, or remote database operation was performed.

## Test-first evidence

The clean Task 7 baseline at `21000c1` passed the deterministic build and the
serialized build/resource matrix (13/13), plus the existing Home/menu/pipeline
browser matrix (26/26). Task 8 then added the acceptance fixtures and assertions
before making presentation changes.

The new assertions exposed concrete differences before the final implementation:

- the Product pending primitive stretched to the surrounding viewport instead of
  retaining the authored 540×181 composition;
- partial/loading cards and Discovery/Studio controls inherited conflicting
  responsive or component specificity;
- Home remained visually light under dark host variables;
- the Home textarea clipped at 200% text;
- the Saved confirmation grew to 190px and wrapped actions instead of retaining
  the 576×170 card and single-line 44px controls;
- the Product review capture retained focus decoration after the separate focus
  assertion;
- the long Instagram handle collided with its coverage treatment;
- a final exact-geometry check caught a Discovery action at 46px and its card at
  456px instead of 44px and 454px.

Each difference was corrected in the owned component styles or state rendering.
The final 15-suite matrix passes both the authored dimensions and responsive/mode
variants.

The post-commit review added a separate hardening round. It verifies real host dark
variables across all five loading states, partial/video/profile analysis, Product,
all Discovery libraries, all Studio parts, and Saved, including nested analysis
bands, Product headings, and Studio on-screen text. It also pins Discovery filters,
roving tabs, keyboard action activation, exact 160/196/232 lanes, same-scope retry
focus/identity, account/project resets; Studio roving tabs, exact per-part geometry,
and safe external-link attributes; and active-control reachability at every requested
viewport. The upload fake now states that the selection was sent to ChatGPT but was
not uploaded or analyzed, and the malformed-marker fixture distinguishes parser
rejection from Home's truthful fail-open recent-work recovery.

First use is exercised through the real MCP public surface plus a package-host
fake: `open_riff` always opens usable Home, and an exact null marker suppresses
only private recents. The server's MCP instructions and packaged setup sequence
then call `show_riff_welcome` once so the standalone Paper carousel renders inline
in the originating chat. Only its explicit final action may call
`mark_riff_onboarding_seen`; the model never calls that tool. The app pins the
strict credential-derived account precondition from the welcome result, and the
server re-verifies the current OAuth owner before storage without deriving ownership
from the echoed value. Rejected or malformed completion remains unmarked and
retryable; a timeout is unconfirmed and is reconciled by an idempotent retry.
Returning users skip the automatic welcome, and an explicit replay never writes
account state.
The same packaged guidance now reflects the exposed `set_riff_work_state` tool:
Save, Undo, or Filmed is claimed only after a strict successful receipt and
authoritative job reconciliation; every other outcome remains unconfirmed or failed.

A later whole-branch review established three additional RED cases before their
fixes: URL credentials/custom ports/fragments crossed the Home handoff boundary;
recent-work limiting could duplicate a project and pair a promoted job with another
start's source; and filmed Studio repeated `I filmed it` instead of offering a factual
correction. Home now uses one canonical safe URL projection, recent work ranks only
started jobs after per-project deduplication while retaining selected-job provenance,
and `Undo filmed` changes to `active` only after strict receipt reconciliation. The
standalone fallback explicitly says the correction is not persisted and leaves the
filmed state intact.

A second review also removed an evidence mismatch in the Task 8 host fake. Its
`settle: never` call now genuinely stays pending while a bounded harness timeout
requests cancellation and restores the retry UI; the test asserts that the host call
has started but has not settled. The ignored visual-review README names both the
initial Task 8 commit and the dark-host hardening/31-capture evidence commit.

## Fixture and trust boundary

`tests/panel/fixtures/riff-core-workflows.ts` contains 42 stable fixtures covering:

- first and returning accounts, malformed onboarding state, recents, and account
  replacement;
- all five loading stages, full/partial video, TikTok, Instagram, Product, and
  recommendation results;
- four Discovery lenses plus loading, empty, recoverable-error, and bounded catalog
  pages;
- three Studio variants, four script parts, historical/missing optional fields,
  and active/saved/filmed/replay/stale/foreign work-state outcomes;
- explicit hostile, timeout, and late host fakes.

Every entry is marked `origin: 'fixture'` and `contains_fixture_data: true`, has a
stable `fixture_id`, and cites its Paper node. Runtime-shaped account, job, Product,
catalog, and work-state values are parsed through their public contract boundaries;
host and failure controls are explicit test fakes. The panel builder now rejects a
Home or pipeline browser bundle whose dependency graph crosses into test/evaluation
or fixture paths, so the authored data cannot become a production fallback.

The browser harness records tool calls and blocks `fetch`, XHR, WebSocket,
EventSource, `window.open`, and unapproved image hosts. It also covers malformed
envelopes, hostile text/URLs, timeout, late completion, account switching, exact
receipt success, replay, version conflict, and foreign-account failure. No case can
show a mutation success without a parsed receipt, and no acceptance run performed
unexpected browser I/O.

## Paper and visual review

The exact node-level authority is the tree/JSX/computed-style audit captured on
11 October for Paper file `01M39TTB7DKFHZY2JVDMAEDZ81`, page `p-5-0`, CURRENT
artboard `Z9H-0` at 7700×10112, token hash `17cc259e`. Live basic info on
12 October reconfirmed those identifiers, dimensions, and hash, but node-level
reads were permission-blocked; it is not represented as a newer design audit.
Host-owned ChatGPT chrome is outside the target.

Executable assertions cover roles and text, geometry, computed styles, semantic
state, keyboard routes, focus, active-control clipping, document overflow, host dark
variables, forced colors, reduced motion, and 200% text at 320, 375, 768, and 1440
CSS pixels. The real generated Home v8 document and real parent bridge also pass the
same-root journey with exact calls, no account input, and no unexpected network
request.

Thirty-three deterministic post-implementation PNGs were recaptured twice and inspected
under ignored `.context/task8-visual-review/`. They cover first/returning Home,
menu/account, all loading rows, partial/full/platform analysis, Product, every
Discovery lens, every Studio part, Saved, filmed, the confirmed filmed correction,
dark, forced-colors, reduced-motion, and 200% text. Six additional dark-host captures
cover loading, video analysis, Product, Discovery, Studio, and Saved. `manifest.json`
records each image's dimensions, byte count, and SHA-256; the byte-identical
10,054-byte manifest SHA-256 is
`689d144e8736f677dcdbe4e1b99f72e664b18aaf5d622e64b4e0d3f448c0dc0d`.
These images are the preserved pre-correction Task 8 human-review record, not
pixel-diff baselines or source data. In particular, its first-use capture predates
the corrected chat-plus-Home composition and is not current release evidence; the
current implementation is sourced from the exact Paper audit and exercised by the
updated browser assertions.

## Current immutable resources

The current deterministic local release candidates after the first-use correction
are:

| Resource | Version | SHA-256 | Raw | Gzip | Budget |
| --- | --- | --- | ---: | ---: | ---: |
| `ui://riff/home-v8.html` | `riff-home-v8` | `6ebe32a4e7127a89acaa7cf456a914e6588427d618210753b4d36e0bb1a48b1a` | 246304 | 67160 | 500000 / 110000 |
| `ui://riff/onboarding-v8.html` | `riff-onboarding-v8` | `4ba366c48039217ec25326aa990d629d054ca94438b5adcc02727cb318bbc589` | 37664 | 11225 | 400000 / 85000 |
| `ui://kettle/creator-pipeline-v8.html` | `creator-pipeline-v8` | `f8e3b0e88018207ebfbdaa95e5b3314626c7e0f64dc21cca0ff246306c8df0df` | 177195 | 47987 | 250000 / 75000 |

Home retains v1–v7, onboarding retains v1–v7, and pipeline retains v2–v7.
Those are compatibility handles serving the current static documents, not claims
that a mutable historical bundle remains under each URI. Telemetry, observations,
build manifests, benchmarks, and resource tests use the canonical v8/v8/v8
versions. Task 9 subsequently reproduced these bytes from a clean generated state
and proved the development Worker serves them; see the later Riff release section
in `docs/engineering/stage2-verification.md`. This historical Task 8 section alone
does not claim either result.

The hosted migration application for `20261011091042` through
`20261011091046` was also a Task 9 operation and was later applied and verified
without rewriting migration history. No remote migration or deployment is claimed
by this historical Task 8 record itself.

## Task 8 verification record

The counts below are the preserved Task 8 acceptance record. They predate the
post-review first-use/resource correction above and therefore are not final Task 9
whole-repository or hosted-release evidence.

- Work-state client/database/MCP matrix:
  `npx tsx --test tests/riff-work-state-client.test.ts tests/riff-work-state-database.test.ts tests/riff-work-state-mcp.test.ts`
  — 26/26 passed.
- Serialized build/resource matrix:
  `node --import tsx --test --test-concurrency=1 tests/panel-build.test.ts tests/riff-home-resource.test.ts tests/creator-pipeline-resource.test.ts`
  — 15/15 passed.
- Component/visual matrix:
  `node --test tests/panel/riff-home.test.mjs tests/panel/riff-menu.test.mjs tests/panel/creator-pipeline.test.mjs tests/panel/riff-core-workflows-visual.test.mjs`
  — 42/42 passed.
- Plugin package plus real-MCP setup-host orchestration:
  `node --import tsx --test tests/plugin-package.test.ts tests/riff-setup-orchestration.test.ts`
  — 3/3 passed; the packaged setup skill also passed its structural validator.
- Targeted auth/telemetry/MCP/benchmark TypeScript matrix — 33/33 passed before
  the hardening round; the final full check then covered the updated TypeScript suite.
- `npm run test:browser` — 118/118 passed.
- `npm run check` — exit 0: typecheck passed, the main Node run passed
  584/584, dry-run build and smoke passed, and its browser leg passed 118/118.
- `npm run test:db` — 13/13 passed against the ordered migrations in PGlite.
- Final bundle build run twice — byte-identical generated modules and manifest.

Two independent reviews at `aa48d3a0b018a8f81cd0cc962dc982b93f031212`
reported no findings for that earlier tree. A subsequent whole-branch review found
the three Important issues described above. This report records their fixes and
verification but does not claim that a new independent whole-branch re-review is
clean.

PGlite verifies the actual ordered local migration files but does not prove hosted
Supabase/PostgREST, live identity, or multi-connection concurrency. No Task 8
migration was added.

## Product and provider boundaries

`PRODUCT.md` and `docs/engineering/decisions.md` now distinguish implemented truth
from intended scope: Discovery's four libraries are local creative lenses over real
owned lineage, Product save requires explicit validation and a parsed receipt,
Saved/Filmed/resume state is durable, and the current v8/v8/v8 artifacts are local
release candidates.

Instagram remains deterministic presentation/fixture coverage only; it is not live
provider proof. A capable MCP host can follow the server-published first-use sequence
and render the same standalone inline welcome resource; the packaged setup skill pins
that sequence for the distributed Riff package. Product URLs are not fetched, catalog
browsing creates no fictional persisted lineage, and local visual acceptance is not
a hosted deployment or public-release claim.
