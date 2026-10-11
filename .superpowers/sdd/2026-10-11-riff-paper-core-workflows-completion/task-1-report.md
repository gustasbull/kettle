# Task 1 report — match Riff first launch to Paper

Status: DONE

Base: `8a0f4623d387a71a8e3962adadd2deb5719f0f37`

## Outcome

- Replaced the old segmented onboarding card with the approved Paper `13QH-0`
  composition: exact 576/526/454/184/80×124 geometry, four-layer gradient,
  typography, copy, carousel peek, progress controls, embedded media, and closing
  guidance. The card remains host-attributed and has no duplicate Riff chrome or
  composer.
- Preserved keyboard navigation with bounded Arrow keys plus Home/End, direct dot
  selection, a next-step control, and a responsive 320 px layout without horizontal
  page overflow.
- Embedded a local copy of the Paper fill, pinned by SHA-256 in browser coverage.
  Onboarding makes no external network request and calls no MCP server tool.
- Made Home suppress populated recent work only when the account payload explicitly
  reports `onboarding_seen_at: null`. A set marker shows normal Home, while an
  omitted/unreadable marker fails open to normal Home for historical clients and
  account-read recovery.
- Updated MCP initialization guidance to require `open_riff`, then marker inspection,
  `show_riff_welcome` on explicit null, and `mark_riff_onboarding_seen` only after
  welcome succeeds. A set marker does not replay onboarding unless requested.
- Bumped the onboarding resource/cache identity from v1 to v2 across the resource,
  build manifest, telemetry, performance, benchmark schemas, and tests. Rebuilt
  generated artifacts contain v2 and no stale v1 identity.
- Switched this static card to the existing dependency-light MCP App bridge and
  retained host theme/font handling, handshake lifecycle, teardown, and explicit
  size notifications. This brought the Paper implementation under the existing
  launch budget.

## Paper evidence

The implementation was checked directly against Paper file
`01M39TTB7DKFHZY2JVDMAEDZ81`, page `p-5-0`, node `13QH-0` using the Paper MCP
basic-info, JSX, tree-summary, computed-style, and fill-image reads. The embedded
image content is pinned as
`2c777547f7ea0e0e5c5290ff069a0a9989c6e5318cd2431a0748ba408089a978`.

## TDD record

- RED: explicit-null Home regression expected zero recent buttons but observed one.
  GREEN: explicit null hides recents while a set marker shows them.
- RED: account-read failure left the recent section hidden after first-use state.
  GREEN: unreadable state and omitted legacy markers fail open to normal Home.
- RED: the first exact Paper build was 395,927 bytes raw / 86,827 bytes gzip and
  exceeded the 85,000-byte gzip budget. GREEN: the dependency-light bridge kept
  required host behavior while reducing onboarding to 29,274 bytes raw / 11,889
  bytes gzip.
- Expanded browser regressions prove exact Paper geometry/copy/style fragments,
  the embedded-fill hash, carousel peek and interaction, bounded keyboard behavior,
  320 px usability, absence of host chrome/composer, zero network requests, zero
  tool calls, and retained host size reporting.

## Final verification

- Focused onboarding/Home/MCP/resource/build/performance suite — PASS, 46/46.
- `npm run build:panel` — PASS. Onboarding fingerprint:
  `sha256:9595ee8cc135d7930eadcd5fcffba4b72a5fdf14839d1936d263cad5b4882267`,
  29,274 bytes raw / 11,889 bytes gzip.
- Generated identity inspection — PASS: v2 present, v1 absent.
- `npm run check` — PASS:
  - Worker types and all TypeScript checks;
  - 521/521 Node tests;
  - Worker dry-run build, 3,925.28 KiB / 788.81 KiB gzip;
  - local workerd smoke test;
  - 79/79 real-browser tests.
- `git diff --check` — PASS.

## Scope and evidence limits

- No migration, database reset, hosted Supabase access, deployment, publication,
  credential use, provider request, paid call, or external onboarding image request
  was made.
- Raw MCP clients cannot be forced to execute server instructions; the server and
  packaged setup skill now state the ordered protocol, and the app itself never
  marks onboarding seen before a successful welcome.
- The generated panel directory is intentionally ignored by Git; the deterministic
  build and manifest tests prove the committed sources reproduce the v2-only
  artifacts within budget.
