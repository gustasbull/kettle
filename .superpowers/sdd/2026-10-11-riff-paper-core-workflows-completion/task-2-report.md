# Task 2 report — add the exact shared Riff menu and account dropdown

Status: DONE

Base: `8e63b7ddda98d13481a7825265494bd8da859dda`

## Outcome

- Added one dependency-light `mountRiffMenu` shell shared by Riff Home and every
  standalone creator-pipeline screen. Embedded pipeline screens continue using the
  parent Home shell, so they do not duplicate the drawer or branding.
- Reproduced the Paper 288 px left drawer, panel-local backdrop, navigation,
  validated recent-work cards, 48 px Create control, account trigger, and 256 px
  account dropdown. The drawer traps keyboard focus, restores focus on dismissal,
  and closes the dropdown before the drawer on Escape.
- Kept Home and Discover navigation local to the current Riff app. In Home, Create
  restores and focuses a fresh form while leaving an already-mounted workflow
  instance intact. Standalone workflow fallbacks make explicit ChatGPT handoffs
  without claiming local navigation completed.
- Wired Account settings, Dark mode, Support, and Give feedback through explicit
  Home bridge actions. Dark mode truthfully points to host appearance settings;
  Riff reflects but does not mutate the host theme.
- Used only validated account/recent projections. Missing allowance is rendered as
  `Usage unavailable`; no illustrative quota, account name, thumbnail, or recent
  work from Paper is shipped. No Paper fill image was copied because current
  recent-work projections do not include validated media.
- Preserved account isolation. A changed account ID closes the drawer and drops its
  recents immediately; the real host bridge also invalidates pending actions and
  ignores old account work before loading the replacement account.
- Kept the current MCP resource/cache versions unchanged.

## Paper evidence

The implementation was checked directly against Paper file
`01M39TTB7DKFHZY2JVDMAEDZ81`, page `p-5-0`, nodes `12GT-0`, `ZM2-0`, and `ZZL-0`
using basic-info, tree-summary, JSX, computed-style, and fill-image reads. Tests pin
the 288 px drawer and 256 px dropdown along with the local backdrop, navigation,
actions, focus, and dismissal behavior.

## TDD record

- RED — `node --test tests/panel/riff-home.test.mjs`: both Home browser tests failed
  because the expected menu trigger was absent (`0 !== 1`).
- RED — the creator-pipeline browser test failed for the same missing shared trigger.
- GREEN — the focused menu/Home/pipeline/bridge command passed 31/31 after the
  shared shell, integrations, host actions, and account-boundary behavior landed.
- The direct menu regression covers Home and Discover navigation, recent and Create
  actions, all four account callbacks, backdrop dismissal, ordered Escape behavior,
  entry/return focus, and both Tab and Shift+Tab containment.
- The bridge regression invokes every account row through the real MCP Apps message
  path and changes from a populated first account while the drawer is open, proving
  that it closes and old recents do not reappear.

## Verification

- `node --test tests/panel/riff-menu.test.mjs tests/panel/riff-home.test.mjs tests/panel/creator-pipeline.test.mjs tests/panel/riff-home-bridge.test.mjs`
  — PASS, 31/31.
- `node --test tests/panel/creator-pipeline-bridge.test.mjs` — PASS, 12/12.
- The required one-time `npm run check` completed typecheck, 521/521 Node tests,
  dry-run Worker build, and smoke successfully, then exposed one stale browser-test
  selector that counted new menu buttons outside pipeline content. The selector was
  scoped to `.riff-pipeline__content`.
- `npm run test:browser` after that correction — PASS, 81/81, including the real
  bundled workerd/MCP bridge test and all new menu coverage.
- `git diff --check` — PASS.

## Scope and evidence limits

- No migration, remote database reset, deployment, publication, credential use,
  provider request, paid call, or external image request was made.
- Account settings, support, feedback, and appearance remain host handoffs; the app
  reports the handoff status and never claims the external action completed.
- The generated panel directory is ignored by Git; deterministic builds during the
  verification commands reproduced the committed sources within existing budgets.
