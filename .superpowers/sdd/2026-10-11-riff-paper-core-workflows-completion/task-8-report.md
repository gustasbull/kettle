# Task 8 report — Riff Core workflows visual acceptance

## Outcome

Completed local acceptance of the Riff-owned CURRENT workflows against the
read-only Paper authority. The acceptance surface now has a deterministic,
test-only 42-row fixture matrix; 15 executable browser suites; one-root Home
navigation through Product, loading, analysis, Discovery, Studio, Saved, and
resume; equivalent standalone pipeline behavior; and immutable Home/pipeline v4
resources with compatibility aliases.

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

Packaged first use is now exercised through the real MCP public surface plus a
package-host fake: `open_riff` opens usable Home while the welcome can still be
pending, strict welcome success then permits `mark_riff_onboarding_seen`, and
failure, malformed output, or timeout stop before the write. This is explicitly a
package/setup-skill orchestration contract; raw MCP does not run the sequence itself.
The same packaged guidance now reflects the exposed `set_riff_work_state` tool:
Save, Undo, or Filmed is claimed only after a strict successful receipt and
authoritative job reconciliation; every other outcome remains unconfirmed or failed.

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

The authority is Paper file `01M39TTB7DKFHZY2JVDMAEDZ81`, page `p-5-0`, CURRENT
artboard `Z9H-0` at 7700×10112, observed token hash `17cc259e`. Host-owned ChatGPT
chrome is outside the target.

Executable assertions cover roles and text, geometry, computed styles, semantic
state, keyboard routes, focus, active-control clipping, document overflow, host dark
variables, forced colors, reduced motion, and 200% text at 320, 375, 768, and 1440
CSS pixels. The real generated Home v4 document and real parent bridge also pass the
same-root journey with exact calls, no account input, and no unexpected network
request.

Thirty-one deterministic post-implementation PNGs were recaptured and inspected
under ignored `.context/task8-visual-review/`. They cover first/returning Home,
menu/account, all loading rows, partial/full/platform analysis, Product, every
Discovery lens, every Studio part, Saved, dark, forced-colors, reduced-motion, and
200% text. Six additional dark-host captures cover loading, video analysis, Product,
Discovery, Studio, and Saved. `manifest.json` records each image's dimensions, byte
count, and SHA-256; the 9,448-byte manifest SHA-256 is
`6d9d2e8909ecf534391c4137b0fb01580abbb37cfcdf6e4560490eb9481770e6`.
These images are human-review evidence, not pixel-diff baselines or source data.

## Immutable resources

The final deterministic resource identities are:

| Resource | Version | SHA-256 | Raw | Gzip | Budget |
| --- | --- | --- | ---: | ---: | ---: |
| `ui://riff/home-v4.html` | `riff-home-v4` | `730edc5c0c1d625382e79ab5c556464c6e468c1f724fd781fef6f9f472426a09` | 241640 | 66350 | 500000 / 110000 |
| `ui://kettle/creator-pipeline-v4.html` | `creator-pipeline-v4` | `ed31fa8157709271c5787ad43649d5d34c7f8af1848b65a84b83b63c3f2f3a8e` | 175107 | 47515 | 250000 / 75000 |

Home retains the v1, v2, and v3 URIs and pipeline retains v2 and v3. Those are
compatibility handles serving the current static document, not claims that a mutable
historical bundle remains under each URI. Telemetry, observations, build manifests,
benchmarks, and resource tests use the canonical v4 versions.

Two consecutive final builds produced identical resource metadata and generated-file
hashes:

- manifest: `3ef5c85a0208e986c00a652306fd07e2b170da83470235f24b5d13c024f3a947`;
- generated pipeline module:
  `e051a409cecba0ebeb19538c3f55e82bc9e7f77cbae1e89669afc865a1d23b82`;
- generated Home module:
  `7323ac14d4d23b664d0d960eb5f337e6258bcb8253a6b4401baeb31bc4fc0d19`.

## Final verification

- Serialized build/resource matrix:
  `node --import tsx --test --test-concurrency=1 tests/panel-build.test.ts tests/riff-home-resource.test.ts tests/creator-pipeline-resource.test.ts`
  — 15/15 passed.
- Component/visual matrix:
  `node --test tests/panel/riff-home.test.mjs tests/panel/riff-menu.test.mjs tests/panel/creator-pipeline.test.mjs tests/panel/riff-core-workflows-visual.test.mjs`
  — 41/41 passed.
- Plugin package plus real-MCP setup-host orchestration:
  `node --import tsx --test tests/plugin-package.test.ts tests/riff-setup-orchestration.test.ts`
  — 3/3 passed; the packaged setup skill also passed its structural validator.
- Targeted auth/telemetry/MCP/benchmark TypeScript matrix — 33/33 passed before
  the hardening round; the final full check then covered the updated TypeScript suite.
- `npm run test:browser` — 116/116 passed.
- `npm run check` — exit 0: typecheck passed, the main Node run passed
  582/582, dry-run build and smoke passed, and its browser leg passed 116/116.
- `npm run test:db` — 13/13 passed against the ordered migrations in PGlite.
- Final bundle build run twice — byte-identical generated modules and manifest.

Two independent final re-reviews at `aa48d3a0b018a8f81cd0cc962dc982b93f031212`
reported no Critical, Important, or Minor findings and both returned **Ready to
merge: Yes**. They explicitly closed the host-dark, onboarding orchestration,
Discovery/Studio depth, responsive reachability, setup-skill truthfulness,
never-settling timeout, and visual-evidence provenance findings.

PGlite verifies the actual ordered local migration files but does not prove hosted
Supabase/PostgREST, live identity, or multi-connection concurrency. No Task 8
migration was added.

## Product and provider boundaries

`PRODUCT.md` and `docs/engineering/decisions.md` now distinguish implemented truth
from intended scope: Discovery's four libraries are local creative lenses over real
owned lineage, Product save requires explicit validation and a parsed receipt,
Saved/Filmed/resume state is durable, and the v4 artifacts are locally verified.

Instagram remains deterministic presentation/fixture coverage only; it is not live
provider proof. A raw custom MCP URL can receive truthful first-open prose but cannot
distribute the package-controlled onboarding skill or carousel. Product URLs are not
fetched, catalog browsing creates no fictional persisted lineage, and local visual
acceptance is not a hosted deployment or public-release claim.
