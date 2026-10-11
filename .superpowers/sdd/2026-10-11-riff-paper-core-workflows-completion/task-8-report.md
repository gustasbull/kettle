# Task 8 report — Riff Core workflows visual acceptance

## Outcome

Completed local acceptance of the Riff-owned CURRENT workflows against the
read-only Paper authority. The acceptance surface now has a deterministic,
test-only 42-row fixture matrix; 14 executable browser suites; one-root Home
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
The final 14-suite matrix passes both the authored dimensions and responsive/mode
variants.

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

Twenty-five deterministic post-implementation PNGs were recaptured and inspected
under ignored `.context/task8-visual-review/`. They cover first/returning Home,
menu/account, all loading rows, partial/full/platform analysis, Product, every
Discovery lens, every Studio part, Saved, dark, forced-colors, reduced-motion, and
200% text. `manifest.json` records each image's dimensions, byte count, and SHA-256;
the 7,613-byte manifest SHA-256 is
`724223cbbc0e04c744a7afd53270e6d0b46f79ff67a77f5b916b51a7d4f7e1cc`.
These images are human-review evidence, not pixel-diff baselines or source data.

## Immutable resources

The final deterministic resource identities are:

| Resource | Version | SHA-256 | Raw | Gzip | Budget |
| --- | --- | --- | ---: | ---: | ---: |
| `ui://riff/home-v4.html` | `riff-home-v4` | `c715cb402e6d38c613922d5b3bfe0444355208e06e832c862995f540b8d58a62` | 235911 | 65738 | 500000 / 110000 |
| `ui://kettle/creator-pipeline-v4.html` | `creator-pipeline-v4` | `b312261b78293d5e39ffbb874a1aa9ba81deec1bb61582359f179474bf801186` | 170973 | 47091 | 250000 / 75000 |

Home retains the v1, v2, and v3 URIs and pipeline retains v2 and v3. Those are
compatibility handles serving the current static document, not claims that a mutable
historical bundle remains under each URI. Telemetry, observations, build manifests,
benchmarks, and resource tests use the canonical v4 versions.

Two consecutive final builds produced identical resource metadata and generated-file
hashes:

- manifest: `76f4cb68345cd33eda53f1a9a09f69c20365f1c22a417c73c83ec620895d5ec2`;
- generated pipeline module:
  `bef68ea0d7383128fbcfe51cb9c2ce01048aafeb1f371adf7a965e84bc88f6f4`;
- generated Home module:
  `7c7f03322cc532d1d391e11adb5a0fb1e036be7401b7bb2e24a583c209c0a32c`.

## Final verification

- Serialized build/resource matrix:
  `node --test --test-concurrency=1 tests/panel-build.test.ts tests/riff-home-resource.test.ts tests/creator-pipeline-resource.test.ts`
  — 15/15 passed.
- Component/visual matrix:
  `node --test tests/panel/riff-home.test.mjs tests/panel/riff-menu.test.mjs tests/panel/creator-pipeline.test.mjs tests/panel/riff-core-workflows-visual.test.mjs`
  — 40/40 passed.
- Targeted auth/telemetry/MCP/benchmark TypeScript matrix — 33/33 passed.
- `npm run test:browser` — 115/115 passed.
- `npm run check` — exit 0: typecheck passed, the main Node run passed
  581/581, dry-run build and smoke passed, and its browser leg passed.
- `npm run test:db` — 13/13 passed against the ordered migrations in PGlite.
- Final bundle build run twice — byte-identical generated modules and manifest.

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
