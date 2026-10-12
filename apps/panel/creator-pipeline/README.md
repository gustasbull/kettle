# Riff creator workflow UI

This component implements the current Paper source of truth: **Riff · Core
workflows → CURRENT · Riff · New creator flow**. Paper owns the visible product
design and copy. Do not add navigation, debug chrome, job IDs, DNA IDs, versions,
provider limits, refresh controls, or other UI that is absent from those frames.

## Component boundary

```ts
import { mountCreatorPipeline } from './creator-pipeline/index.ts';

const view = mountCreatorPipeline(root, actions);
view.render(job);
view.setDisplayMode('fullscreen');
view.dispose();
```

The component is a presentation layer over a validated `CreatorJobView`. It does
not fetch providers, start or retry provider work, or infer missing data. Save,
undo, and filmed controls use an explicit host callback and show durable state only
after its receipt and reconciled job agree; other actions are ChatGPT message
handoffs. All provider text is inserted with `textContent`; external media and
links must pass the shared safe-URL policy.

## Paper states

- Pending video analysis uses the compact 540px “Fetching your video” card.
- Pending profile analysis uses “Getting to know your profile” and only real,
  validated profile/post media when it exists.
- Pending discovery uses “Finding videos for your next idea.”
- Transcript-only video access uses the Paper partial-analysis recovery card.
- Full video analysis renders the six Paper dimensions: Hook, Content, Style &
  pacing, Voice & language, Script, and CTA.
- Profile analysis renders the profile summary, available top videos, grounded
  insights, and the single “Find my next breakout idea” action.
- Discovery renders the Videos, Hooks, Product showcases, and CTAs libraries.
- Studio renders the selected idea and exact reference snapshot, timed Hook/Main
  content/CTA segments, filming directions, caption, and hashtags.

Missing media or metrics stay visually neutral or are omitted. Never replace them
with fictional thumbnails, engagement numbers, evidence, or generated claims.

## Host behavior

Inline tool results remain compact and ask ChatGPT to open the full Paper workflow.
Fullscreen is the product surface. The host owns app attribution, the ChatGPT
composer, authorization UI, and surrounding navigation; this component must not
recreate them.

Automatic saved-job and catalog reads are provider-free. Polling and reopening
never start provider work. Only explicit save, undo, and filmed actions invoke the
authenticated durable work-state write. Creator actions that need conversation
reasoning use the supported ChatGPT message capability and target the active
conversation.

## Verification

From the repository root:

```sh
node --test tests/panel/creator-pipeline.test.mjs \
  tests/panel/creator-pipeline-bridge.test.mjs
npx tsc --noEmit
npx tsc -p tsconfig.panel.json
node scripts/build-panel.mjs
```

Browser screenshots used for fidelity review live under `.context/` and are not
production assets. Re-check the current Paper artboards before changing visible
layout or copy; archive explorations and proposals are not approved scope.
