## Supplied-video review

A trusted `seedUrl` makes scan call Lightreel first with durable key `seed-review`.
The blocking request has a nine-minute default timeout, retains only the four
requested answer fields and conversation ID, and never polls or resubmits an
ambiguous seed request. Its provider-reported access is metadata attribution,
not independent proof of video access and not a profile-wide DNA claim.

The official [Lightreel API documentation](https://lightreel.ai/docs) describes
`POST /v1/chat`, structured fields nested under `answer`, and requests taking
several minutes. The review requests four fields (within the documented five).

## Response bounds and diagnostics

ScrapeCreators feed responses can contain fields discarded by the sanitizer.
Only `/v3/tiktok/profile/videos` may use a 2 MiB raw buffer; other endpoints retain
a 256 KiB maximum. Sanitized durable receipt bodies remain capped at 256 KiB in
UTF-8. The larger feed bound is a robustness measure. An oversized response is
only a hypothesis for the previous live feed failure; its cause was not verified.

Errors expose only a fixed category, transport-failure enum, and valid HTTP status.
They never include raw provider diagnostics, credentials, request bodies, or URLs.
All added verification uses synthetic injected responses. No live provider result
or content quality is established by these tests.

## Recommendation detail scheduling

Lightreel remains the source of candidate order. The adapter canonicalizes and
deduplicates its bounded result before reserving any detail attempt, then starts at
most three independent ScrapeCreators detail calls. Each call keeps its own stable
`video:<native-id>` reservation and durable receipt, with provider-step retries set
to zero.

The adapter waits for every issued detail call to settle. This means up to three
allowance units can be consumed even when one branch fails or becomes ambiguous;
there is no cancellation, refund, or automatic retry. Successful sibling receipts
remain replayable on workflow re-entry. After settlement, progress checkpoints are
written serially in original Lightreel order and only for the contiguous successful
prefix. A failed batch never publishes `recommend:save`.

Supplied-video scan retains Lightreel-first ordering. Recommendation detail may
reuse an observation only from the immutable stored analysis captured by that same
owned job, after the runner verifies its account, project, snapshot, and DNA
version. The candidate must match the exact TikTok native ID and canonical URL,
come from the ScrapeCreators profile-feed endpoint, have live approved provenance,
match the current trusted permission basis and retention policy, permit storage,
display, and model processing, and have a typed source-observation time no more
than seven days old. Retrieval time never substitutes for source-observation time.
A malformed, stale, future-dated, incomplete, foreign-lineage, or
permission-incompatible observation falls back to the normal guarded
`video:<native-id>` detail call. A valid reuse creates no detail reservation and is
not inserted into the catalog a second time.
