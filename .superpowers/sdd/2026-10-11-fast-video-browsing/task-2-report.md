# Task 2 report — acknowledge Riff creator jobs immediately

Status: DONE

Base: `480d01554b2a5ba5a6a6b1e99bfd51417af178ac`

## Outcome

- Direct canonical TikTok profile/video starts now skip the exact-start preflight,
  resolve locally, and use the existing atomic start RPC once. Short links retain
  the exact replay read before bounded redirect resolution. The TikTok adapter is
  still the sole owner of URL grammar.
- Both Riff and generic creator starts use one shared request-scoped scheduler.
  A validated queued database intent is returned immediately while only Workflow
  creation is registered with `ExecutionContext.waitUntil`. A rejected create is
  contained and leaves the queued intent for the deterministic outbox reconciler.
- Tool descriptor catalogs and generated JSON schemas are cached once per isolate
  availability variant. Riff Home and creator-pipeline resource documents are
  escaped and assembled once at module initialization.
- The creator-pipeline browser entry no longer includes the server contracts,
  application graph, or Zod. A strict local validator preserves public-envelope,
  hostile/oversized input, ownership, result-kind, source-kind, revision, and
  cross-job protections. The MCP Apps parent transport is now a narrow browser-only
  implementation covering the capabilities the pipeline uses.
- The development outbox recovery cron is exactly `* * * * *`; no production
  trigger or alternate hosting target was added.

The final creator-pipeline bundle is 81,370 bytes raw and 23,066 bytes gzip,
within the new 250,000/75,000 byte limits.

## TDD record

RED was captured before implementation:

1. The Riff start suite failed for the missing TikTok classifier, the canonical
   path's extra `find`, and invalid sources reaching repository work.
2. Deferred-dispatch tests failed because starts awaited the promise-returning
   dispatcher and no Worker `waitUntil` seam existed.
3. Resource/config/descriptor tests failed for per-read document assembly, the
   two-minute development cron, and absent isolate catalog reuse.
4. The pipeline build regression exposed the approximately 611 KB browser bundle
   and its server contracts/Zod dependency graph.
5. Validator hardening deliberately produced a final RED for an unexpected nested
   recommendation-reference field; exact nested shapes and plain-object/accessor
   checks changed it to GREEN without rejecting contract-valid fixtures.

## Final verification

- Focused panel validation/controller/build suite — PASS, 59/59.
- Creator-pipeline real-browser bridge suite — PASS, 12/12.
- `npm run check` — PASS:
  - typecheck and generated Worker types;
  - 379/379 Node tests;
  - Worker dry-run build, 4,535.42 KiB / 903.99 KiB gzip;
  - local workerd smoke test;
  - 72/72 browser tests.
- `git diff --check` — PASS.

No hosted Supabase, provider, deployment, paid, or live-network call was made.

## Scope and invariants

- `packages/database/riff-creator-supabase.ts` is intentionally unchanged: its
  existing `start` method already calls the authoritative atomic RPC and its
  service-role tests remain green.
- The existing deterministic Workflow ID (`creator-${jobId}`), create/get status
  ambiguity handling, stable request IDs, allowance/capacity transaction, provider
  attempt policy, and zero automatic provider retries are unchanged.
- `waitUntil` is explicitly not treated as durable. The committed queued database
  row is the durable authority; the scheduled outbox remains recovery.
- Core application code receives only platform-neutral scheduler/defer callbacks;
  Cloudflare bindings stay at Worker composition.
- Descriptor caching does not retain bearer tokens, verifiers, operation instances,
  MCP servers, or transports. Those remain request scoped.
- Necessary scope additions were limited to `apps/worker/auth.ts`, the shared
  application scheduler, the TikTok classifier/runtime injection, static creator
  resource assembly, the runtime harness, and focused tests/config proof identified
  by the feasibility and test-matrix audits.

## Remaining evidence boundary

All acknowledgement and browser proofs are local fixture/workerd evidence. No
current hosted latency percentile or provider SLA is claimed.
