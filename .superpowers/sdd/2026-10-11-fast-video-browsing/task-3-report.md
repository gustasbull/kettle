# Task 3 report — preserve fast Riff video metadata

Status: DONE

Base: `1f2edcbcb8c805a22c1eecd00f0b2679762b338d`

## Outcome

- ScrapeCreators profile and detail requests now use the documented closed cache
  enum with trusted compiled policy: `1d` for profile and `7d` for detail. The
  feed request receives the validated native profile `user.id` and deliberately
  receives no cache parameter. Cache policy is not tool, URL, header, environment,
  or caller input.
- Provider cache disclosure remains in sanitized receipts. New live recommendation
  references explicitly carry nullable `source_observed_at`, separately from local
  `retrieved_at`; old saved references may omit the new field.
- One dependency-free image-policy module now governs the Zod contract, Home's
  browser validator, and both resource CSPs. It admits only the exact
  `tiktokcdn.com` and `tiktokcdn-us.com` apex/subdomain families over HTTPS, permits
  signed queries, and rejects credentials, explicit ports (including `:443`),
  fragments, lookalikes, and suffix hosts.
- Sanitization retains independently validated `dynamic_cover` and static `cover`
  lists. Feed and detail normalization prefer the first valid dynamic cover and
  fall back to the first valid static cover. Playback and download fields remain
  absent, while detail requests still send `get_transcript=false` and
  `download_media=false`.
- The fixture added for these paths is redacted, fictional, deterministic, and
  offline. It is adapted from the official documented response shape and is not
  evidence of a live request, permission, or media access.

The approved cache policy and its provenance semantics were recorded in the root
decision register and engineering decisions before enabling the runtime policy.

## TDD record

The expanded focused suite was first captured RED with 87 tests: 70 passed and 17
failed for the intended missing behavior. Those failures covered cache/user-ID
query shapes, closed policy validation, US-CDN and dynamic-cover handling, shared
CSP policy, typed freshness, browser-validator parity, and the integrated MCP path.
The malformed-native-ID regression already passed at RED, proving the existing
profile boundary stopped before a feed reservation or request.

After implementation, the same expanded suite passed 87/87. It includes the five
Task 3 suites plus direct request-builder, contract compatibility, standalone/Home
validator, and authenticated offline MCP integration coverage.

## Final verification

- Expanded focused Task 3 suite — PASS, 87/87.
- `npm run typecheck` — PASS after the final readonly-policy cleanup.
- `npm run check` — PASS:
  - generated Worker types and all TypeScript checks;
  - 409/409 Node tests;
  - Worker dry-run build, 4,548.10 KiB / 908.52 KiB gzip;
  - local workerd smoke test;
  - 72/72 browser tests.
- `git diff --check` — PASS.

Final measured panel artifacts:

- creator pipeline: 90,968 bytes raw, 26,013 bytes gzip,
  `sha256:c43986c468642a0bb5803a21b4206e261615c483942896e11f540980f67ae10c`;
- Riff Home: 476,607 bytes raw, 106,302 bytes gzip,
  `sha256:560bd1be80e8154cc106338594b661aa7361ead7048ee65e2f322a8f5b353bb8`.

The pipeline build boundary still rejects every server contract/application/Zod
input except the exact new dependency-free image-policy module. The existing
synthetic forbidden-import regression remains green.

## Scope and invariants

- Stable provider attempt keys (`profile`, `feed:<page>`, `research`, and
  `video:<native id>`), durable reservation/receipt behavior, call counts,
  allowance ceilings, discovery breadth, Lightreel-first supplied-video ordering,
  and zero automatic retries are unchanged.
- No migration, Worker variable, generated configuration change, database reset,
  deployment, publication, hosted Supabase access, provider request, credential
  use, paid call, or other live-network call was made.
- All HTTP behavior in tests used injected static responses. No read, render, or
  reopen path gained provider work.
- `apps/panel/creator-pipeline/index.ts` is intentionally unchanged. The existing
  Paper `Top videos` copy is misleading for a bounded latest-feed sample, but the
  repository still lacks exact approved replacement copy/disclosure. Per the plan,
  that copy change remains deferred for user/Paper review rather than inventing a
  new label or UI element.
