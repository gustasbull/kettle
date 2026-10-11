# Riff Product Specification

- Status: canonical, design-led product direction
- Brand: **Riff** (double f)
- Last reconciled with Paper: 10 October 2026

## Source of truth

This document defines the current Riff product experience and the first journey
the team must complete. It replaces the earlier Kettle product brief as the
canonical product specification; it does not claim that every described behavior
is implemented.

The visual authority is the `CURRENT · Riff · New creator flow` artboard on the
[Riff · Core workflows Paper page](https://app.paper.design/file/01M39TTB7DKFHZY2JVDMAEDZ81/p-5-0).
Illustrative names, media, metrics, and scripts in that artboard demonstrate the
experience rather than prescribe production data.

Use the following precedence when sources disagree:

1. A newer explicit product decision from the owner.
2. This document and the CURRENT Paper artboard, reconciled together.
3. Adopted security, infrastructure, and data decisions in
   [`docs/engineering/decisions.md`](docs/engineering/decisions.md).
4. The earlier Kettle reference pack, which remains useful historical context.

Implementation evidence remains the authority for what is actually working. A
screen in Paper or a requirement here is not implementation evidence.

## Product promise

Riff helps a creator turn what they already have into a short-form video they can
film. A person can bring a video, TikTok or Instagram profile, product, link, or
rough idea. Riff analyzes the relevant context, identifies useful reference
formats, and turns the chosen direction into a practical script and filming guide.

The shortest expression of the product is:

> Start with what you have. Find your breakout idea. Make it yours.

Riff is not a generic writing assistant and does not promise virality. Its value
comes from connecting three things in one continuous experience:

- evidence from the user's content, product, and permitted references;
- a clear creative direction suited to that context; and
- a ready-to-film script with concrete production guidance.

## Primary user and job

The first product is for an individual creator, founder, or small brand making
short-form videos for TikTok and Instagram Reels.

The primary job is:

> Help me understand what to improve, find a format worth adapting, and give me
> a script I can film without starting from a blank page.

The first release must serve a creator who brings one video. Profile and product
inputs are first-class routes in the product design, but the team should complete
the single-video journey end to end before expanding their implementation depth.

## Product surface

Riff is a ChatGPT app backed by authenticated MCP tools and durable Riff data.
The primary experience combines two surfaces:

- **ChatGPT conversation:** invocation, natural-language input, clarification,
  live job status, explanations, edits, and a text fallback.
- **Riff app panel:** Home, input, visual analysis, discovery libraries, Studio,
  saved work, and navigation.

The conversation remains available while the Riff panel is open. Riff panel
actions and chat requests operate on the same account-owned records; neither is a
separate or weaker path.

ChatGPT owns its surrounding chrome, composer, installation flow, and OAuth
handoff. Riff owns the content inside its messages and app panel.

## Canonical happy path

The first complete journey is:

```text
Install or invoke Riff for the first time
  → See the welcome message and Home
  → Upload or share a creator video
  → See live analysis progress
  → Review the video analysis
  → Explore relevant reference videos
  → Choose a direction with “Make it mine”
  → Review and adjust the script in Studio
  → Save it or mark it as filmed
  → Resume it later from Home or the Riff menu
```

Each step must persist enough state to survive a closed panel, a different chat,
or a later session. A failed later step must not erase an earlier successful one.

## 1. First installation and onboarding

### Trigger

Show the Riff welcome the first time a person successfully invokes `@Riff` or
opens Riff after installing it. Do not depend on receiving a separate installation
webhook: the first successful open is the reliable product trigger.

The welcome is a one-time onboarding experience for the connected Riff account,
not a message that repeats in each conversation. Reinstalling or reconnecting
must not erase the person's work. A future help action may replay onboarding, but
that is not required for the happy path.

### First-open composition

First use opens both parts of the experience:

- Chat shows the branded **Welcome to Riff** introduction.
- The Riff panel opens to Home on the right.
- Neither surface blocks the other; the person can begin in chat or in the panel.

The welcome explains three short steps in a horizontal carousel:

1. **Start with what you have.** Share a video, profile, product, or idea.
2. **Find your breakout idea.** Understand what works and explore relevant
   videos, hooks, showcases, and calls to action.
3. **Make it yours.** Turn the selected inspiration into a ready-to-film script.

The final instruction is explicit: share a video or profile link, describe an
idea in chat, or use the app on the right.

### Returning use

After onboarding has been seen, opening Riff goes directly to Home or restores
the active work. The welcome must never prevent access when its state cannot be
read; in that case Riff should open Home and offer onboarding as secondary help.

## 2. Home and the always-available creator input

Home is the default starting and returning surface. It contains:

- the Riff identity and the promise “Let's make your next video go viral”;
- the primary creator input;
- shortcuts to Videos, Hooks, Product showcases, and Calls to action; and
- recent work with its latest meaningful status.

### Primary input

The primary input accepts:

- an uploaded creator video;
- a supported video link;
- a TikTok profile link;
- an Instagram profile link;
- a product or website link;
- a written product description; or
- a plain-language video idea.

The input invites the person to “Share a video or profile link, or tell me what
you want to make…” and provides a visible **Upload a video** action. Submitting the
input uses **Find my next idea** as the main call to action.

Typing or pasting does not silently start paid provider work. Riff may inspect the
input type locally, but analysis or discovery begins only after an explicit submit
or an equally clear request in chat.

### Always available means globally reachable

The complete input is presented on Home. Every Riff panel state must also expose
a stable **Create a video** action through the Riff menu. Activating it returns to
the creator input without deleting or overwriting the current item.

Home, the Riff logo/menu, and **Create a video** must therefore remain usable from
analysis, discovery, Studio, saved work, and recovery states. Starting new work
creates a new work item; it never repurposes the currently open record by accident.

### Recent work

Home shows a compact, directly openable list of recent work. Each item includes a
recognizable title or handle, source type, thumbnail where available, and current
status such as:

- Analysis ready
- Formats ready
- Continue script
- Ideas saved

Recents are account-scoped and ordered by meaningful recent activity. Selecting
one restores the corresponding analysis, discovery result, or Studio state.

## 3. Input routing

Riff determines the route from what the person submitted while asking only for
missing information that materially affects the output.

| Input | First Riff result | Primary next action |
| --- | --- | --- |
| Creator video | Video analysis | Rework this video or explore viral formats |
| TikTok profile | Profile performance analysis | Find a next move and tailored formats |
| Instagram profile | Profile performance analysis | Find a next move and tailored formats |
| Product/site | Editable product brief | Save and find the next idea |
| Written idea | Minimal context confirmation | Discover references or draft the direction |

If a link could be either the subject or a creative reference, Riff asks which
role it should play. A pasted public profile URL is not proof that the person owns
that profile.

## 4. Live analysis state

Long-running work appears as a compact live status component in the ChatGPT
conversation. The panel may remain open, but the person is not trapped on a fake
percentage screen.

The component contains:

- a human-readable job heading;
- a short explanation of the current task;
- the submitted source or a stream of received previews where appropriate;
- the current backend-reported stage; and
- completed checkpoints alongside the active checkpoint.

Use an indeterminate progress treatment unless the backend knows a meaningful
percentage. Status copy must reflect persisted backend state rather than a client
timer. Examples from the current design include:

- Fetching your video…
- Analyzing your content
- Getting to know your profile
- Fetching your recent videos…
- Understanding your product
- Preparing your brief
- Finding videos for your next idea

If Riff can complete only part of an analysis, it shows the useful result and
names the missing modality—for example, transcript-only analysis when visual
content was unavailable. It must not present a partial result as a complete scan.

## 5. Creator-video analysis

The single-video result explains the submitted video before suggesting external
inspiration. It combines the original video and source facts with a structured
creative review.

### Source summary

Show, when available:

- video preview and duration;
- platform and creator attribution;
- format or production mode;
- views, likes, and saves;
- relative performance against a defined comparison set;
- capture or observation date; and
- a link to the original source.

Unavailable metrics remain unknown. They are never replaced with zero or
illustrative values.

### Creative dimensions

Analyze these six dimensions:

1. Hook
2. Content
3. Style and pacing
4. Voice and language
5. Script
6. Call to action

Each dimension receives a plain-language assessment such as **Working well**,
**Needs attention**, or **Needs rework**, supported by an observed moment and one
specific recommendation. The analysis explains why; it does not infer a causal
performance claim from correlation.

### Routes out of analysis

The result provides two clear actions:

- **Rework this video** keeps the original concept and uses the analysis to build
  a stronger version in Studio.
- **Explore viral formats** moves into reference discovery using the analysis as
  context.

Both routes preserve the original submission and analysis.

## 6. Profile analysis

TikTok and Instagram profile links use parallel experiences adapted to the data
actually available from each platform.

The result shows:

- creator identity and profile handle;
- platform;
- observed follower, view, and engagement data where available;
- the number and coverage of posts reviewed;
- top videos or Reels from that reviewed sample;
- a concise growth opportunity;
- what is working, with evidence;
- what to improve, with evidence; and
- a specific next move that leads to discovery.

“Best performing” must state its ranking basis and comparison window. Medians,
multipliers, and claims about a content pattern must identify their sample. Riff
separates observed analytics, user-supplied facts, and its own hypotheses.

Instagram is a required product route because it appears in the current design;
it is not considered implemented until a permitted integration is verified.

## 7. Product context

A product link or description first becomes an editable brief. While Riff builds
it, ChatGPT shows live status rather than an invented result.

The review surface contains these editable fields:

- Product
- Description
- Audience
- Main benefit
- Content style

Riff may propose values from the supplied material, but the person can correct
each field before continuing. The action **Save & find my next idea** persists the
accepted brief and begins discovery.

Product claims must come from the user or an identified permitted source. Missing
facts are omitted, requested, or explicitly marked as unknown.

## 8. Discovery

Discovery helps the person choose a creative direction; it is not an endless
feed. The current design supports four connected libraries:

- Videos
- Hooks
- Product showcases
- Calls to action

### Results

Riff presents one active recommendation in a centered carousel with up to seven
alternatives when enough relevant results exist. Fewer strong results are better
than padded or invented recommendations.

Each video result includes:

- a playable or clearly represented source preview;
- a short format label or adaptation angle;
- observed performance signals and a defined relative multiplier where valid;
- source attribution and observation time; and
- a direct action such as **Make it mine**.

The person can move through results with visible controls and left/right keyboard
navigation. Progress indicates position without implying that eight results must
always exist.

### Filters and component libraries

The Videos library supports useful style filters such as For you, Quick demos,
Before/after, How-to, Reactions, and Challenges. Hooks, Product showcases, and
Calls to action provide filters appropriate to their component type.

Choosing a whole video creates a complete Studio direction. Choosing an
individual hook, showcase, or call to action changes only that part of the active
script and preserves the other selections.

Riff adapts a format or principle; it does not copy another creator's script.

## 9. Studio

Selecting **Make it mine**, reworking the submitted video, or choosing a library
component opens Studio.

Studio's primary outcome is **Your script, ready to film.** It includes:

- a clear video title and target platform;
- estimated total duration and number of parts;
- editable audience and production assumptions;
- the selected reference video or sequence;
- the complete script and filming guide;
- platform-specific caption copy; and
- save and filmed-status actions.

### Assumptions

Compact chips show Riff's current assumptions, such as audience, on-camera mode,
and production format. They are suggestions, not hidden facts, and can be changed
without restarting the journey.

### Script structure

Studio provides four views:

- Full video
- Hook
- Main content
- CTA

The full-video view presents the complete sequence. Each part includes:

- an estimated time range;
- spoken or on-screen copy;
- a concrete shot or filming direction; and
- relevant caption guidance.

Timing is an estimate derived from the actual script, not a fixed 22-second
template. The selected reference remains visible so the adaptation is legible.

The person can explore alternative whole videos or replace only the active part.
Chat instructions such as “make the hook shorter” update the same Studio record
and create a new saved version rather than erasing accepted work.

### Completion actions

- **Save for later** persists the reference, selections, script, caption, and
  current version.
- **I filmed it** records a user-reported milestone; it does not claim external
  publication or verified performance.

## 10. Saved work and resume

After saving, ChatGPT confirms that the reference and ready-to-film script were
saved. The person can **Open vault** or **Undo save**.

Undo reverses the saved flag without deleting the underlying work or its history.
Saved and recent items can be reopened from another conversation or later session
under the same account.

The current happy path requires resumable work, not a complete asset-management
system. Bulk folders, collaboration, and destructive project management are not
prerequisites for this journey.

## 11. Riff menu and navigation

The menu opens inside Riff while ChatGPT remains visible. It provides:

- Home
- Discover videos
- Recent creator profiles, videos, and products
- Create a video
- Usage
- Account settings
- Appearance control
- Support
- Give feedback

The menu must not become an alternate source of state. Its recent items and usage
come from the same durable account records used by chat and Home.

## State and persistence model

The product should expose a stable work item rather than a collection of
disconnected screens. At minimum, each item records:

- owner account;
- source type and permitted source reference;
- input metadata and user-supplied facts;
- current processing state;
- structured analysis and its evidence;
- discovered references and observation metadata;
- selected whole-video and component references;
- editable context and assumptions;
- immutable script versions;
- saved state and self-reported filmed state; and
- timestamps and request IDs needed for safe retries.

The user-facing lifecycle is:

```text
Draft input
  → Analyzing
  → Analysis ready
  → Discovering
  → Formats ready
  → Studio ready
  → Saved
  → Filmed (self-reported)
```

Partial, failed, and reconciliation states coexist with this lifecycle. They do
not overwrite the last successful state.

## Recovery behavior

Every background operation must be resumable and idempotent.

- Closing ChatGPT or the panel does not cancel persisted work.
- Returning opens the latest successful state and the true current job status.
- A retry reuses the same logical request where safe and does not double-charge.
- A duplicate save does not create duplicate work.
- A stale edit produces a clear version conflict instead of overwriting a newer
  script.
- A failed discovery leaves the analysis available.
- A failed script generation leaves the chosen reference available.
- Authentication or entitlement problems explain how to reconnect without
  implying that saved content was lost.

## Trust and content rules

- Treat provider content as untrusted input.
- Never infer account ownership from a pasted profile or video URL.
- Attribute references and retain their observation date.
- Define the baseline behind relative performance claims such as “4.2× usual.”
- Label analysis hypotheses as hypotheses, not proven causes.
- Never promise that a proposed video will go viral or reach a performance level.
- Adapt patterns and structures; do not reproduce another creator's script.
- Do not show third-party media without the required access and display rights.
- Keep missing data unknown and make partial coverage visible.
- Require explicit authorization and server-side budget checks before provider
  fetching or generation that incurs cost.
- Enforce account ownership on every read, write, job, and rendered resource.

## Happy-path acceptance criteria

The first vertical slice is complete when all of the following are demonstrated
through the real ChatGPT host and durable backend:

1. A newly connected account invokes Riff and sees the welcome plus Home.
2. A returning account goes directly to Home or its active work without repeated
   onboarding.
3. The creator input and upload action work from Home, and **Create a video** is
   reachable from every Riff screen.
4. The person submits a permitted creator video and receives durable live status.
5. The completed analysis covers the six creative dimensions and distinguishes
   evidence, unknowns, and recommendations.
6. **Explore viral formats** returns relevant, attributed reference results.
7. The person selects a result with **Make it mine** and reaches Studio.
8. Studio contains a complete hook, main content, CTA, filming direction, timing,
   and caption.
9. A chat edit updates the same work item while preserving the previous version.
10. **Save for later** persists the work, **Undo save** is safe, and the saved
    item reopens from a new chat.
11. **I filmed it** records only a self-reported state.
12. Another account cannot read, mutate, render, or infer the work.
13. Duplicate requests and interrupted jobs do not create duplicate charges or
    duplicate records.
14. Partial and failed operations preserve the latest successful output and offer
    an honest recovery path.

## First implementation boundary

Complete this path before broadening the product:

```text
First-open welcome
  → Home and universal video input
  → One creator-video analysis
  → Video discovery
  → Whole-video selection
  → Full Studio script
  → Save, resume, and filmed state
```

TikTok profile, Instagram profile, product context, and component-level libraries
remain part of the intended product. They follow the same contracts and visual
system, but they must not delay proving the creator-video path.

## Current implementation snapshot

This section records the takeover baseline as of 10 October 2026. It is not the
definition of the intended experience.

| Capability | Current evidence | Gap to this specification |
| --- | --- | --- |
| Authenticated ChatGPT MCP | Live Auth0-backed MCP and account mapping verified; tools, resources, OAuth challenges, and account website now use Riff-facing copy | Remote deployment and production release configuration remain |
| Durable creator jobs | Scan, recommendation, and script jobs persist with events, retries, receipts, allowances, and budget gates | Cancellation and broader recovery UX are not complete |
| TikTok creator analysis | One authenticated live trial persisted profile evidence and Creator DNA; the Riff Analysis renderer now presents saved coverage, seed-review provenance, limitations, and six honest dimension slots | General availability and a complete single-video analysis contract are not implemented |
| Script creation | ChatGPT can draft and save script variants against a completed job; fullscreen Studio renders real variants and component tabs | Captions, durable save/undo, filmed state, and version-editing UI are absent |
| First-open onboarding | Portable plugin setup skill and anonymous **Welcome to Riff** MCP App are implemented | No durable account-level “seen” state, automatic one-time trigger, or replay preference |
| Universal creator input | Fullscreen Home shell is implemented with ChatGPT handoffs for video, profile, product, and idea input | Direct file upload, automatic routing, recent work, and a durable universal input contract are not implemented |
| Single-video analysis | Analysis UI supports a supplied saved seed review and clearly marks unavailable dimensions | No end-to-end uploaded-video ingestion or full single-video contract matching every Paper field |
| Discovery libraries | Saved recommendation jobs render a bounded fullscreen video carousel with attribution, keyboard navigation, and **Make it mine** | Hooks, Product showcases, and CTAs remain labeled ChatGPT handoffs; approved media previews and category contracts are absent |
| Instagram profile route | Designed in CURRENT Paper | No verified live provider path |
| Product context | Project and brief foundations exist | Current editable product-context flow is not built |
| Saved work and recents | Individual records can be reopened by known IDs; save/filmed controls hand off honestly to ChatGPT | No complete Vault/recents listing, durable save toggle, undo, or filmed-status product flow |
| Billing and usage | Budget and trial-allocation primitives exist | Customer billing, entitlements, and production usage UX are not configured |

Do not redesign the intended experience around these gaps. Close the gaps in
small vertical slices while preserving authentication, ownership, versioning,
idempotency, append-only history, and cost controls already present in the
backend.

The implemented Home and Discovery surfaces preserve the finalized Paper
headlines “Let’s make your next video go viral” and “Find your next breakout
idea.” Those lines are source-design copy, not a performance claim in generated
results. The product owner and compliance owner must approve or revise them
before a public submission; until then, Riff must continue to avoid predicted
performance claims and guarantees everywhere else.

## Deferred from the first vertical slice

The following are not required to prove the canonical happy path:

- automatic social publishing;
- video editing or rendering;
- team workspaces and collaboration;
- scheduled discovery;
- bulk project administration;
- a public marketplace listing;
- paid launch and subscription management;
- performance guarantees; and
- a broad third-party clip library without resolved rights.

These are not silently approved because they appear in an older brief or
proposal.

## Measures of product value

Measure the journey rather than isolated generation calls:

- first-open to first submitted input;
- input to useful analysis;
- analysis to discovery;
- discovery result selected;
- Studio script completed;
- work saved;
- work reopened;
- self-reported filmed rate;
- return use; and
- total provider and infrastructure cost per completed journey.

Quality review must also assess whether the analysis is supported by evidence,
the references fit the user's context, the script can realistically be filmed,
and the output is meaningfully better than an ungrounded ChatGPT draft.

## Decisions still required

The current design establishes the experience but does not settle every operating
policy. Before a real-user or paid launch, record explicit decisions for:

- supported upload formats, size limits, and media retention;
- permitted TikTok and Instagram access paths and display rights;
- the exact comparison set behind relative performance metrics;
- provider selection and spend limits for each route;
- onboarding replay and reset behavior;
- mobile and narrow-panel adaptations;
- entitlement, trial, and billing rules;
- account export, deletion, and retention;
- production support ownership; and
- public-submission approval for the finalized viral/breakout headline copy.

Until decided, these items are constraints to resolve—not permission to invent
behavior, fetch live data, spend money, or claim a capability is complete.
