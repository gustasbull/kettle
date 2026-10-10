# Creator flow development trial — 2026-10-09

User requests a testable TikTok URL → bounded scan → correctable DNA → personalized
references/ideas → saved filming variants journey in the connected ChatGPT plugin.
The user subsequently requires **no cash spending** and explicitly chooses ChatGPT
drafting with Kettle saving instead of a separate OpenAI API call. The older $25
aggregate cap is not an allocation for this run.

## Implemented path

Authenticated tools: `start_creator_scan`, `get_creator_job`, `render_creator_job`,
`start_creator_recommendations`, `save_creator_scripts`; existing DNA read/correct
operations remain. Backend `start_creator_scripts` API generation stays unexposed
and disabled. Saving accepts two or three structured variants for a selected batch
and idea, validates reference/DNA lineage, and persists a script job. It does not
construct the provider adapter or call OpenAI. All jobs can be reopened by job ID.

Jobs capture immutable inputs and exact DNA snapshots. Shared request IDs replay
existing jobs; changed inputs conflict. Stale recommendation starts fail; explicitly
selected historical batches retain their original DNA version. Active account and
scope checks precede operations. Public projections exclude account IDs, raw captured
inputs, receipts, costs and permission records. Model-processing permission resolves
underlying captured observations, including user-corrected claims; display permission
alone is insufficient.

The additive `20261009170000_creator_pipeline.sql` migration adds service-only jobs,
append-only events/attempts/receipts, research allowances, dollar reservations and
separate provider trial units. No allocation is seeded. Each provider call reserves
before I/O. Successful receipts replay; ambiguous calls are not automatically
resubmitted or refunded. Job success requires receipts for all attempts. Zero-dollar
calls require an enabled, unexpired ScrapeCreators/Lightreel trial bucket; OpenAI is
excluded from that path. Cash budget stays zero.

Workflows use one guarded request per durable step, fixed job-derived instance IDs,
no provider-step automatic retries, and a scheduled durable-intent dispatcher. Reads
and card refresh never dispatch work. The static card uses the real MCP Apps bridge,
bounded polling, revision/ID checks, auth clearing, teardown and restrictive CSP.

## Bounded development allocation

- Use the original test account selected by the user; the setup script pins that
  account and the existing development Supabase project.
- Creator: `https://www.tiktok.com/@smartykalz`.
- Supplied seed: `https://www.tiktok.com/@smartykalz/video/7685478377012071694`.
  Lightreel reviews this exact video before supporting ScrapeCreators metadata is
  requested. The review is saved separately from profile-wide DNA with provider-
  reported access basis, date and limitations; it is not assumed to occur in the feed.
- Scan: at most ten distinct videos/two pages plus one profile request.
- Reference discovery: one blocking Lightreel POST, no history reads by default,
  at most three distinct ScrapeCreators metadata enrichments; no media/transcripts.
- Explicit setup script allocates at most ten ScrapeCreators metadata request units
  and two Lightreel research request units for twelve hours. It never resets an
  existing balance, enables paid overages, tops up a provider account or buys credits.
- Provider trial availability is user-reported. Returned provider credits are
  observations, not dollar-conversion or billing proof. Unknown charges stay reserved.

Credentials stay in ignored owner-only files or Worker secret settings. No cross-
workspace environment file copying. CLI secret commands use `--env development`
without an explicit `--name`: Wrangler 4.147 concatenates both when supplied, which
can accidentally target a duplicate-suffixed Worker. Verify secret names and actual
Worker deployment after provisioning.

## Verification and limitations

Local signed-JWT → real PGlite → injected fake-provider proof covers scan, DNA,
recommendations, ChatGPT draft save, replay, reopen, foreign-account/scope denial,
text fallback and CSP, without an OpenAI API key. Provider tests use synthetic
responses and are not live content, cost or quality evidence. Dedicated browser
checks exercise the real bridge and component. Full checks and hosted/live evidence
are recorded separately by the lead after execution.

Current quality baseline is conservative English caption/metadata reasoning and
lexical reference matching; it may return fewer than three ideas or none. No visual
analysis, measured audience demographics, causal performance or validated semantic
personalization is claimed. Human review/correction is part of the trial.

Operational limits: oldest-first outbox inspection is capped at ten jobs; a larger
pilot needs fair recovery/pagination. Free script saving currently requires the
configured development pipeline and active source allowance, although it consumes
no provider units. Source retention must cover full sanitized feed receipts as well
as admitted public observations; production retention/deletion policy remains open.
This development trial is not production release or submission readiness.

## User correction: Lightreel must review the supplied video

The user explicitly directed Lightreel API review of the link. A supplied seed now
causes one guarded blocking `/v1/chat` review first, with a nine-minute timeout and
no automatic resubmission/history polling. Four bounded fields record the exact
video URL, review, reported access basis and limitations. A separate optional review
in the saved analysis/view preserves display and processing permissions and survives
DNA corrections. It does not mint video observations or profile-wide DNA claims.
The additive `20261009173000_creator_seed_review.sql` stores that review in a
service-only immutable table and joins it into current/historical reads. Existing
scan, DNA version and write-receipt rows are not rewritten.
The card labels Lightreel's access as provider-reported, not independent verification.
Reference discovery uses the saved review as context. ChatGPT still drafts variants.

The first pre-correction hosted scan obtained a profile receipt, then its feed request
failed within three seconds and stopped at `needs_reconciliation`. Two ScrapeCreators
units remain reserved; there was no Lightreel request or cash reservation. That history
is retained. Safe enum-only diagnostics now retain future failure class/status without
provider bodies or credentials. The SC feed raw response cap increases from 256KiB
to 2MiB, while persisted allowlisted receipts remain capped at 256KiB; oversized feed
response is a hypothesis, not a verified explanation of the earlier failure.

## Hosted integration and transport regression

PRs #33 and #34 merged into `4f2d2f1`. Development migration history confirms the
new `20261009170000` migration, and the original test account has an explicit
12-hour @smartykalz allowance, ten ScrapeCreators units and two Lightreel units.
Cash limit/reservations are zero. Initial deployment version
`48e282b0-422d-47ea-9992-e3f8453fdb5b` exposes all thirteen expected tools and the
static pipeline resource; anonymous reads and invalid tokens are rejected.

After refreshing the actual ChatGPT plugin, its first scan failed before creating
a job. The provider ledger confirmed no attempts or consumed units. A service-role
diagnostic of the same request proved the SQL path and queued the original intent;
this is not claimed as proof of authenticated public scan creation. The cause was
`redirect: error` in both new transports: workerd rejects that mode before I/O.
An actual workerd regression reproduced the TypeError. Both transports now use
`manual` and reject non-2xx responses, preserving no-redirect credential safety.
The regression covers database/provider Request construction and 302 rejection
without any external request. Subsequent live completion is recorded below.

## Actual ChatGPT and provider proof

PRs #35–#37 are merged through `40d7bff`. Development Worker version
`c2c4462b-a778-4e28-9e3a-e4c675593f59` contains the Lightreel-first path and
versioned card resource URIs. The URI change prevents ChatGPT from using a cached
strict-schema card bundle that predates `seed_review`. Full checks passed 260
TypeScript tests and 50 browser checks, build and workerd smoke; PR #37 CI passed.
Hosted checks confirm thirteen tools, restrictive card CSP, authenticated health,
anonymous/invalid-token denial, and no exposed OpenAI generation operation.

Actual authenticated ChatGPT calls created and completed scan
`da7f3ab2-d9a2-4052-9b21-148bcf3e163e`. Its first guarded request was Lightreel
`seed-review`, followed by ScrapeCreators `profile` and `feed:0`. All three have
successful receipts. The saved result contains ten recent videos and DNA
`ce012826-62ff-598a-9309-3ef18578b0d7`, version 1. Lightreel's review of the exact
supplied TikTok was retrieved at `2026-10-09T15:30:44.762Z`, with
`video_access_reported`. It describes a short Mask.ai demonstration with a problem
hook, three tutorial steps and a displayed detector result. The review explicitly
does not validate the displayed “100% human” claim. This is provider-reported access,
not independent audiovisual verification by Kettle or visual analysis of all ten posts.

The same account reopened the scan and its Lightreel review in a separate ChatGPT
conversation, with working inline cards. Recommendation job
`3b56d4f0-4966-42df-b330-3ffb5c4bb2c4` then completed one Lightreel discovery request
and three ScrapeCreators detail requests. Batch
`885dc245-ecf0-5006-8666-0d1abd728f59` contains two ideas. Their titles and explanatory
text are repetitive baseline templates; successful execution is not semantic-quality
acceptance. Discovery evidence in this run includes another post from the same
creator; independent-creator diversity is not proven. ChatGPT's earlier prose status
remained “running” after the live card updated to “Complete”; the saved job/card is
authoritative, and a subsequent read returned the completed result.

The initial pre-correction failed job remains `needs_reconciliation`; no ambiguous
request was retried or refunded. Local trial reservations after discovery are two
Lightreel and seven ScrapeCreators units used, with zero and three respectively
remaining. These are application allocation units, not a verified provider billing
balance. Cash limit and reservations remain zero; no OpenAI attempt exists.

ChatGPT drafted two variants for selected idea
`a8eefaa3-04a2-5bbe-94c7-fb795e89c76f`: `Reference-led` (15 seconds) and
`Creator Fit` (25 seconds), using an original writing-clarity before/after example.
Authenticated `save_creator_scripts` succeeded as job
`b793fa00-7f45-416c-947b-11899a968e34`, captured DNA version 1, with both variants
rendered in the actual ChatGPT inline card. The database independently confirms
`succeeded`, and no provider attempts were added by saving. The draft explicitly
avoids treating the original detector result as verified. The timing is an unfilmed
estimate and should be checked for natural delivery/readability before production.

Proof conversation: https://chatgpt.com/c/6ac9096f-b574-83eb-bfce-6362eb4ed0ec
(requires the user's ChatGPT access; it is not a public share link).

A fresh ChatGPT conversation then called `render_creator_job` for the saved script
job and displayed both persisted variants, captured DNA version 1 and script version
1. Cross-chat proof: https://chatgpt.com/c/6ac90a8b-6418-83eb-adaa-515c9f27b388.
Local visual evidence is `.context/kettle-live-scripts.png` (not committed).
No additional job or provider request is needed to reopen these saved results.
The bounded development journey is now testable; fresh research would require an
explicit new allocation because the application's two Lightreel units are consumed.
This does not establish that the provider's entire trial is exhausted.

## 11 October 2026 trial-authority addendum

The earlier live proof above remains historical evidence for its original Auth0
preview account. The current Supabase-account implementation disables the legacy
self-authorized Riff allowance path. A server-only provisioning operation now
reserves one complete account-scoped run from the shared development pool: six
ScrapeCreators units and two Lightreel units, expiring at the earliest provider
expiry and never later than seven days. The high-level `start_riff_creator`
operation atomically consumes one available grant, preserves exact request replays,
and limits its managed project to one scan and one recommendation job. Managed
OpenAI spend remains denied and the cash budget remains zero. This addendum records
the new authority and budget boundary; it does not claim a new live provider
completion for the Supabase account.
