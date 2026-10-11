# Kettle Decisions and Sources

Recorded 6 October 2026. This register distinguishes explicit user direction, proposed choices, and unresolved dependencies. Update it when a decision changes; preserve the reason so future agents can follow it.

## Confirmed direction

| ID | Direction | Basis |
| --- | --- | --- |
| C01 | Build Kettle as a ChatGPT plugin backed by MCP tools | Repeated user requests in this conversation |
| C02 | Website sign-up/sign-in leads to an Open in ChatGPT handoff | Explicit user correction |
| C03 | A link is optional; website, product, social profile, or a description can start intake | Explicit user correction |
| C04 | Support idea generation and script revision with server-side stored state | User requests and supplied product-jobs document |
| C05 | Use Stripe as the intended payment provider | User's architecture direction |
| C06 | Evaluate Lightreel as an option, with alternatives possible | User requests; suitability remains unresolved |
| C07 | Develop using agents, starting in Conductor | User's current development direction |
| C08 | Preserve the Paper page and original reference materials | Explicit user instruction |
| C09 | Use Supabase Postgres as the database | Explicit user statement: Supabase will be used for the database |
| C10 | Start with Cloudflare Workers + Workflows for hosting and background jobs | Explicit user selection on 6 October 2026 |
| C11 | Use Render as the fallback if more runtime flexibility is needed | Explicit user direction on 6 October 2026; migration depends on a demonstrated requirement |
| C12 | When a person links their TikTok or Instagram profile, analyze the profile and initial audience context, identify its best-performing videos as references, and suggest improvements tailored to that context | Explicit user direction on 9 October 2026; see the requirement below |
| C13 | Use the trusted runtime ScrapeCreators cache policy `1d` for profile reads and `7d` for video-detail reads; do not send a cache policy to the profile-feed endpoint | User explicitly approved the fast-video implementation plan on 11 October 2026. Cache policy is not tool, environment, header, URL, or caller input; cache hits retain provider observation time separately from local retrieval time and are never described as live fetches. |

## Profile-based reference generation — 9 October 2026

**Confirmed product requirement (C12):** a linked TikTok or Instagram profile should
start profile analysis. Extract the initial profile/audience context, identify the
profile's best-performing videos, and use those references to offer improvement
suggestions tailored to the person and their audience. The person's own video
history is therefore a reference source, alongside external reference discovery.

Implementation and evaluation details below are engineering proposals, not verified
provider capabilities or a committed release milestone:

- Capture topics, positioning, language, recurring formats and available audience
  evidence with their sources. Label inferred audience traits separately from
  observed analytics and user-supplied facts; let the user correct the initial context.
- Define “best performing” against the user's goal and available metrics. Record
  the analyzed sample, publication dates, metric observation times and ranking basis;
  missing metrics must not become zeros. Compare videos within this profile and
  disclose incomplete coverage rather than claim to have scanned the entire account.
- Analyze accessible content from selected videos for hooks, structure, pacing,
  topics and calls to action. Tie each improvement suggestion to specific evidence
  and explain how it fits the initial profile/audience context. Treat proposed
  improvements as hypotheses, not proven causes of performance or promised gains.
- Distinguish supplying a profile URL from authorizing an account connection.
  Neither a pasted URL nor a claimed social identity establishes Kettle account
  ownership. Verify which permitted access route supplies profile posts, video
  content and audience analytics for each platform; unavailable data stays unknown.
- If access or coverage is insufficient, accept user-supplied videos, excerpts or
  analytics and explain the limited analysis. Do not claim a scan occurred.

Provider evaluation must now cover **profile enumeration and initial profile/audience
analysis on both TikTok and Instagram**, in addition to individual-video enrichment
and external discovery. Existing candidate research does not establish these
capabilities. Provider selection, ranking formula, scan depth, refresh cadence,
retention and release scheduling remain open. This entry records product direction;
it does not claim an implemented integration or authorize live fetching/spending.

## Proposed choices

| ID | Proposal | Decision or evidence still needed |
| --- | --- | --- |
| P01 | Start with brand/product projects | Gustas selects the launch audience |
| P02 | Include minimal Studio revision and export in the prototype | Adopt the revised scope rather than the original prototype exclusion |
| P05 | Use Auth0 for website login and MCP authorization | Prove the actual OAuth metadata, audience, scopes, account mapping, and host connection |
| P06 | Let ChatGPT draft small edits; use Kettle-funded model calls for background generation | Evaluate quality, latency, cost, and reliable saving through tools |
| P07 | Use one application repository and one lead agent with bounded specialist tasks | Adopt working rules and ownership |
| P08 | Show up to eight ideas and write the top script before presenting a completed result | Measure cost and waiting time; allow fewer matches |
| P09 | Let users start from their own idea or pasted script without mandatory discovery | Added by the flow review; adopt first-release scope and import/user-origin idea contracts |
| P10 | Apply explicit edits with undo; show Keep mine / Use new for suggested revisions | Original jobs include comparison; implement candidate/accept states and expected-version checks |

## Superseded proposals

| ID | Earlier proposal | Resolution |
| --- | --- | --- |
| P03 | Host website/server/worker on Render | Superseded by C10; Render is retained as the conditional fallback in C11 |
| P04 | Use Supabase Postgres and Supabase Queues | Postgres adopted in C09; Workflows is the initial execution mechanism, with recoverable dispatch from Supabase job records. Supabase Queues is not part of the initial deployment |

Cloudflare and Supabase are selected implementation targets, not evidence that either integration is working. Keep the runtime/provider adapters separate from core product operations. Validate the first hosted MCP + database + recoverable job integration before expanding implementation. No dual-host deployment is required now.

## Open questions

| ID | Question | Owner and impact |
| --- | --- | --- |
| O01 | Which provider fields may Kettle access, store, display, cache, and use for generation? | Gustas and provider; determines live-reference scope |
| O02 | Does the provider actually supply the data required for matching and script generation at acceptable cost and latency? | Reference specialist; determines feasibility |
| O03 | Which website/social URLs can be understood through permitted access, and what is the fallback? | Lead and reference specialist; affects intake reliability |
| O04 | What is the trial, subscription price, monthly allowance, and reset policy? | Gustas; determines entitlements and unit economics |
| O05 | How are failed attempts, cancellations, and retries counted toward user quotas? | Gustas with lead; avoid inconsistent or duplicated charges |
| O06 | What quality, waiting-time, and cost thresholds define a release? | Gustas with lead; required before pilot evaluation |
| O07 | Which ChatGPT plans, devices, and surfaces will be supported and tested? | Lead; governs UI fallbacks and listing claims |
| O08 | What are the retention periods, account deletion behavior, provider data transfers, and support commitments? | Gustas with appropriate specialist advice; required before collecting pilot data |
| O09 | What are the final public domains and published listing URL? | Lead with Gustas; affects handoff, OAuth, UI security policy, and deployment |
| O10 | Do direct idea-to-script and pasted-script revision ship in the first release? | Gustas; recommendation is yes; adds routes absent from the original tool list |
| O11 | How are candidates, variants, current revisions, and Vault bookmarks related? | Lead with Gustas; recommendation is separate variants, preserved history, and latest revision on reopen |
| O12 | Which reading, editing, export, and generation actions are allowed after payment failure, cancellation, or expiry? | Gustas; determines the complete entitlement lifecycle and access to saved work |
| O13 | What happens to active jobs on disconnect, cancellation, project deletion, or account deletion? | Gustas with lead; determines stopping behavior, late-result handling, and quota settlement |
| O14 | Which creator/founder, project-management, variant, and Explore journeys are launch scope? | Gustas; these remain in the full flow inventory even where the pack proposes later delivery |

The original $49/month price, approximately ten monthly runs, and $0.90 per initial result are assumptions. None has been validated by measured usage in this pack.

## Corrections to carry forward

- The website is part of the chosen entry flow; the first user prototype needs at least a minimal account/handoff surface.
- Website authentication and ChatGPT account connection are distinct steps.
- The platform's restriction concerns unauthorized scraping and third-party access; it does not establish a universal ban on all permitted page retrieval.
- A free feature and a freemium upsell are different cases. Apply the current commerce rules to the actual experience rather than asserting that every free tier is prohibited.
- Chat-based editing may avoid another Kettle model call, but it is not zero-cost server work.
- A source URL or thumbnail field is not itself proof of reuse rights. Avoid blanket statements that every link requires a new license; document the specific access, display, and reuse basis.
- Automated factual checks reduce unsupported claims; they cannot guarantee that all generated statements are true.
- A panel does not automatically grant the model reliable knowledge of the selected item. Implement and test explicit context sharing.
- Hosting in Europe alone does not establish the full data-processing or transfer position.
- The original embedded UML diagrams and Paper screen exports were absent from the supplied text. New sequences in this pack are proposed flows, not a reproduction of those diagrams.

## Official references

These pages informed the architecture discussion. Recheck platform requirements, provider terms, service availability, and limits at the relevant implementation and release milestones.

| Subject | Reference | How it informs Kettle |
| --- | --- | --- |
| Plugin components | [OpenAI plugin architecture](https://developers.openai.com/plugins/concepts/plugins) | Skills, MCP tools, structured results, optional UI |
| Authentication | [OpenAI authentication](https://developers.openai.com/plugins/build/auth) | OAuth authorization and server-side token checks |
| Tools | [OpenAI MCP server concepts](https://developers.openai.com/plugins/concepts/mcp-server) | Input/output contracts and tool execution |
| UI | [OpenAI MCP Apps UI](https://developers.openai.com/plugins/build/chatgpt-ui) | Host bridge, resources, and useful text results |
| Extended surfaces | [OpenAI plugin extensions](https://developers.openai.com/plugins/build/extensions) | Context sharing, sidebar, onboarding, and availability qualifications |
| Commerce and content | [OpenAI plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines) | Current distribution, commerce, authorized access, and content requirements |
| MCP commerce guidance | [OpenAI app guidelines](https://developers.openai.com/plugins/app-guidelines) | Existing paid accounts and restrictions on digital sales and upsells |
| Review and publishing | [OpenAI MCP review](https://developers.openai.com/plugins/deploy/app-review) | Hosted endpoint, review access, publication, and maintenance |
| Package submission | [OpenAI submission](https://developers.openai.com/plugins/deploy/submission) | Current package and reviewer requirements |
| Lightreel permission boundary | [Lightreel terms](https://lightreel.ai/terms) | Access to third-party content does not grant commercial reuse permission |
| Selected hosting | [Cloudflare remote MCP](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/) | MCP request handling on Workers |
| Selected background processing | [Cloudflare Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/) | Durable job execution and runtime constraints |
| Database connection | [Cloudflare and Supabase](https://developers.cloudflare.com/workers/databases/third-party-integrations/supabase/) | Supabase client or Postgres connection with Hyperdrive |
| Runtime compatibility | [Workers Node.js support](https://developers.cloudflare.com/workers/runtime-apis/nodejs/) | Verify chosen dependencies before relying on full Node behavior |
| Cost measurement | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [Workflows pricing](https://developers.cloudflare.com/workflows/reference/pricing/) | Measure hosting usage alongside external generation costs |
| Fallback hosting | [Render service types](https://render.com/docs/service-types) and [Docker support](https://render.com/docs/docker) | Broader runtime flexibility if required |
| Fallback background processing | [Render workers](https://render.com/docs/background-workers) | Future worker option if migration is justified |
| Historical queue option | [Supabase Queues](https://supabase.com/docs/guides/queues) | Earlier proposal; not selected for the initial Cloudflare deployment |
| Hosting alternative | [Railway workers and queues](https://docs.railway.com/guides/cron-workers-queues) | Another server/worker hosting option |
| Hosting alternative | [Vercel longer executions](https://vercel.com/changelog/vercel-functions-can-now-run-up-to-30-minutes) | Function-duration constraints and supported configurations |
| Hosting alternative | [Cloud Run with Cloud Tasks](https://docs.cloud.google.com/run/docs/triggering/using-tasks) | Original managed task-delivery option |
| Conductor setup | [First workspace](https://www.conductor.build/docs/first-workspace) | Repository setup and runnable workspaces |
| Conductor collaboration | [Parallel agents](https://www.conductor.build/docs/concepts/parallel-agents) | When to share or separate workspaces |
| Agent instructions | [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md) | Repository guidance for Codex |
| Agent delegation | [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents) | Bounded delegation and coordination tradeoffs |

## Flow review, 6 October 2026

The initial user-flows document covered only the main brief/discovery/revision route. Its replacement inventories F01–F26, includes the original product's deferred journeys, and identifies new direct-input proposals. See the corresponding tool gaps and acceptance cases A23–A43. These additions do not constitute approval of every feature for the first release. Original references remain unchanged.

## Decision entry template

Record the decision, status, owner, date, reason, alternatives considered, affected contracts, and evidence. For external permissions, retain the actual agreement or official reference. For a product hypothesis, record how it will be tested rather than presenting it as a fact.
