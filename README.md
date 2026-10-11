# Riff engineering repository

> **Current product source of truth:** [`PRODUCT.md`](PRODUCT.md) defines the
> design-led **Riff** product direction and canonical creator-video happy path.
> This Kettle pack remains historical engineering and product context where it
> does not conflict with that specification or newer adopted decisions.

The repository now includes the Riff ChatGPT plugin package, install-time setup
skill, conversational welcome, fullscreen Home, and saved creator-job UI for
Analysis, Discovery, and Studio. See the [panel guide](apps/panel/README.md) for
local previews and [`plugins/riff`](plugins/riff) for the portable plugin bundle.
Internal `kettle_*` names remain compatibility identifiers; they are not the
display brand.

## Runnable engineering foundation

Stage 1 implementation is available alongside this original reference pack.
See the [setup and verification guide](docs/engineering/README.md),
[implemented contracts](docs/engineering/contracts.md), and
[engineering decisions](docs/engineering/decisions.md).

```sh
npm run setup
npm run dev
# In another terminal:
npm run check
```

Run `npm run check` before pushing UI or MCP changes. The development MCP remains
deployment-dependent; repository changes alone do not update the hosted Worker.
The original historical reference-pack content continues below.

Prepared 6 October 2026 for Gustas and the agents building Kettle.

Kettle helps people move from a product or content brief to reference-backed video ideas, a usable filming script, and saved revisions inside ChatGPT. This pack brings the product direction, engineering proposals, and unresolved decisions together so each development task starts with the same context.

## How to use the pack

Add this folder to a dedicated Kettle Git repository. Start the lead agent with `01-product-brief.md`, `02-user-flows.md`, and `07-decisions-and-sources.md`. Commit the shared documents before creating independent Conductor workspaces so their branches inherit the same baseline.

The documents describe a proposed implementation. They are not evidence that the product, provider integrations, permissions, or deployment already exist. Current explicit instructions from Gustas take precedence. Decisions labelled proposed remain open until adopted; routine implementation can proceed using clearly recorded provisional choices when it does not depend on an unresolved external permission.

## Documents

| Document | Purpose |
| --- | --- |
| [Product brief](01-product-brief.md) | Product promise, proposed first release, and boundaries |
| [User flows](02-user-flows.md) | 26 journeys covering website/ChatGPT entry, intake, direct idea/script proposals, discovery, Studio, Vault, projects, account lifecycle, and recovery; six sequence diagrams |
| [Architecture](03-architecture.md) | Confirmed Cloudflare + Supabase direction, system responsibilities, and conditional Render migration path |
| [Tools and data](04-tools-and-data.md) | Proposed MCP tools, records, permissions, and job behavior |
| [Acceptance and evaluation](05-acceptance-and-evaluation.md) | Observable checks, fictional test briefs, and script-quality criteria |
| [Delivery plan](06-delivery-plan.md) | Ordered milestones, agent ownership, and task handoffs |
| [Decisions and sources](07-decisions-and-sources.md) | Confirmed direction, proposals, open questions, corrections, and official references |
| [Design and input checklist](08-design-and-input-checklist.md) | Paper reference and the designs and real examples still needed |
| [UML sequence diagrams](09-sequence-diagrams.md) | One diagram for each of the 26 flows, with scope labels, entry/outcome, alternate branches, and rules |
| [Agent working rules template](AGENTS.template.md) | Suggested instructions to adapt into the application repository's AGENTS.md |

## Latest flow review

The expanded flow inventory addresses the missing paths from the original draft. It distinguishes baseline behavior, proposed additions, later work, and requirements before paid or real-user use. Tools, acceptance checks, delivery guidance, and open decisions now reference those journeys. Direct idea-to-script and pasted-script revision are recommendations awaiting scope adoption.

## Confirmed hosting direction

Gustas selected Cloudflare Workers + Workflows for the initial build and Supabase Postgres for the database. Render is the fallback if more runtime flexibility becomes necessary. This supersedes the earlier Render-first and Supabase Queues proposals. Keep core product logic portable and verify the selected integration in M1/A44. Original reference documents retain their historical architecture descriptions.

## Diagram formats

The diagram collection is available as a [28-page PDF book](diagrams/Kettle%20UML%20Sequence%20Diagrams.pdf), an [offline visual index](diagrams/Kettle%20UML%20Sequence%20Diagrams.html), and [editable Mermaid source](09-sequence-diagrams.md). The `diagrams` folder also contains one SVG and one Mermaid file per flow. These formats share the same sequence definitions. The PDF includes a reading guide, clickable contents, bookmarks, and one page per flow.

## Original references

The `references` folder contains unchanged copies of the supplied product-jobs text and the earlier architecture document. They preserve the reasoning and original scope, including assumptions that were later questioned. Use the decision register to resolve conflicts with this draft. Keep the original files as read-only references.

Paper reference: [Kettle design file](https://app.paper.design/file/01M39TTB7DKFHZY2JVDMAEDZ81), page **Kettle – Core foundations**. Review that page only and preserve its contents. The actual screen exports and original embedded sequence diagrams are not included in this pack. The Mermaid diagrams here are new proposals based on the written requirements.

## First assignment in Conductor

Act as Kettle's lead engineer. Read the core documents and original references. Reconcile inconsistencies into the decision register, distinguish owner decisions from engineering choices, and turn milestone M0 in the delivery plan into a small reviewable change. Produce agreed draft tool contracts, ordered tasks, and a clear definition of the first runnable milestone. Preserve the original reference materials. Keep this first assignment focused on the engineering foundation.

Hosting instruction for the lead: implement first on Cloudflare Workers + Workflows with Supabase Postgres. Use adapters for runtime-specific code so an affected service can move to Render if required. Verify authenticated MCP access, a Supabase write/read, and a recoverable workflow with deduplication. Treat hosting as selected rather than reopening a general provider comparison.

## Inputs Gustas still supplies

Export the relevant Paper screens, provide a few examples of scripts you consider good, and identify real product briefs and references Kettle may use in testing. The fictional examples in this pack can support implementation immediately. Provider credentials, commercial permissions, and real customer results are not supplied by this pack.
