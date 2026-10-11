# Riff Stage 2 authentication

Date: 2026-10-11. Status: deployed to hosted development; interactive ChatGPT
sign-in, token exchange, and refresh acceptance remain pending.

This is the canonical operator guide for the current Riff authentication stack.
Auth0 and Cloudflare Access are retired from the application flow. Cloudflare
Workers hosts the website, consent UI, MCP endpoint, and Workflows. Supabase
Auth owns password accounts and the OAuth 2.1 authorization server; Supabase
Postgres owns the provider-neutral Riff account mapping and product data.

The detailed decision record, threat model, and acceptance matrix are in
[the Supabase cutover design](../superpowers/specs/2026-10-11-supabase-oauth-cutover-design.md).

## Trust boundaries

- Website password sessions and ChatGPT OAuth sessions are separate credentials.
- Both resolve the verified Supabase `(issuer, subject)` pair to the same internal
  Riff account. Email, form fields, headers, and tool input never establish
  ownership.
- Website access tokens retain Supabase's `authenticated` audience and are never
  accepted by MCP.
- MCP tokens require the exact canonical `/mcp` audience, `openid`, an OAuth
  `client_id`, authenticated-user role, bounded lifetime, and the private
  `riff_permissions` claim issued by the access-token hook.
- The Supabase service-role key stays in the Worker. Clients receive neither it
  nor server repository access.
- Website sign-out revokes only the current password session. OAuth grant
  revocation is a separate, explicit account-page action.

## Routes

| Route | Purpose |
| --- | --- |
| `GET /` | Minimal Riff website entry |
| `GET /health` | Runtime status; no secret values |
| `POST /mcp` | Streamable HTTP MCP endpoint |
| `GET /.well-known/oauth-protected-resource` | Canonical protected-resource metadata |
| `GET /.well-known/oauth-protected-resource/mcp` | Path-specific metadata alias |
| `GET/POST /auth/sign-up` | Password account creation |
| `GET/POST /auth/sign-in` | Password sign-in |
| `GET/POST /auth/forgot-password` | Recovery request |
| `GET /auth/callback` | Confirmation/recovery PKCE exchange |
| `GET/POST /auth/update-password` | Recovery-only password update |
| `POST /auth/sign-out` | Current website-session sign-out |
| `GET /oauth/consent` | Riff-hosted Supabase OAuth consent UI |
| `POST /oauth/decision` | Allow or deny the pending OAuth request |
| `GET /account` | Verified Riff account and OAuth grants |
| `POST /account/oauth-grants/:client_id/revoke` | Revoke one confirmed grant |

All browser POST routes require an exact same-origin request and an encrypted,
single-use CSRF transaction. Session and transaction cookies are `__Host-`,
Secure, HttpOnly, SameSite=Lax AES-GCM JWEs. Provider metadata and redirects are
bounded and validated; only OpenAI's two documented exact callback forms are
accepted.

## Runtime configuration

Development deployment requires these Cloudflare secrets:

| Variable | Meaning |
| --- | --- |
| `SUPABASE_URL` | Exact HTTPS Supabase project origin |
| `SUPABASE_PUBLISHABLE_KEY` | Browser-safe project publishable key used server-side by the auth adapter |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only repository credential |
| `RIFF_MCP_RESOURCE` | Exact canonical HTTPS Worker URL ending in `/mcp` |
| `RIFF_WEBSITE_ORIGIN` | Exact canonical HTTPS Worker origin, without a path or trailing slash |
| `RIFF_AUTH_COOKIE_SECRET` | 32 random bytes encoded as 64 hexadecimal characters |
| `LIGHTREEL_API_KEY` | Existing provider credential |
| `SCRAPECREATORS_API_KEY` | Existing provider credential |

`MCP_CORS_ORIGINS` is a non-secret Worker variable and is currently restricted
to `https://chatgpt.com`. Retired `AUTH_ISSUER`, `AUTH_AUDIENCE`,
`AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`, and `AUTH_SESSION_SECRET` values are not
read by the runtime and should be deleted after hosted Supabase acceptance.

Never put real values in `.env.example`, `.dev.vars.example`, source control,
issue comments, or deployment logs. Use `wrangler secret put`/`secret bulk` and
the Supabase dashboard or authenticated CLI.

## Supabase control plane

Routine database work uses the repository wrappers against this workspace's
local containers:

```sh
npm run db:start
npm run db:migrate
npm run db:test
```

The reviewed migration adds `accounts.onboarding_seen_at`, the idempotent
service-role onboarding RPC, and the custom access-token hook. It does not reset,
delete, merge, or reassign existing product data. Never run a remote reset. A
hosted migration is an explicitly authorized integration-lead action: first
confirm the linked project and a dry run containing only the intended pending
migration, then apply it with the authenticated Supabase CLI. The repository
does not provide a general-purpose hosted push script.

The hosted Supabase Auth configuration must then set:

- site URL to the canonical Worker origin;
- the exact Worker `/auth/callback` redirect;
- email confirmations enabled;
- OAuth server enabled;
- dynamic client registration enabled;
- authorization UI path `/oauth/consent`; and
- custom access-token hook
  `pg-functions://postgres/public/riff_custom_access_token_hook`.

Recheck the exact config diff before pushing it. Do not use a template whose
local `site_url` could overwrite the hosted value.

## Deployment order

1. Run `npm run check` and inspect `git diff --check`.
2. Capture a logical data backup and pre-change row counts.
3. Confirm the dry run contains only the intended additive migration, then apply
   it and inspect function grants.
4. Set all required Worker secrets without printing them.
5. Deploy the development Worker so the new consent and password routes exist.
6. Recheck and push the reviewed Supabase Auth config, enabling OAuth/DCR/hook.
7. Verify live health, protected-resource metadata, authorization-server/OIDC
   metadata, DCR, password forms, MCP CORS, and anonymous diagnostic behavior.
8. Complete a real ChatGPT authorization-code + S256 flow, then test refresh,
   reconnect, grant revocation, account isolation, and first-open onboarding.
9. Compare post-change data counts. Only then remove the five retired Auth0
   Worker secrets.

If the Worker deploy succeeds but the Auth config cannot be enabled, keep the
failure explicit and repair forward. The database migration is additive. Do not
reset the hosted database or silently fall back to client-supplied identity.

## Required hosted evidence

Before calling the cutover accepted, record that:

- discovery returns the exact Supabase issuer and a DCR registration endpoint;
- ChatGPT registration and PKCE authorization succeed without pasted client
  credentials;
- OAuth and refreshed tokens carry the exact MCP audience, OAuth client ID, and
  Riff permissions;
- ordinary password tokens retain audience `authenticated` and fail at MCP;
- `/account` and MCP resolve the same Supabase subject to the same Riff account;
- website sign-out leaves the ChatGPT grant intact, while explicit grant
  revocation prevents future refresh;
- first Home open shows the welcome state, marks it once, and later opens go
  directly to normal Home;
- a second account cannot access the first account's records; and
- existing product rows were not reset or reassigned.

## Known development-preview limitation

Supabase's current OAuth server does not propagate the RFC 8707 `resource`
indicator through token exchange. The dedicated preview project therefore uses
a custom token hook to stamp every consented OAuth-client token with the one
canonical Riff MCP audience. The Worker still validates that audience exactly,
but the hook cannot prove which resource the client originally requested.

This is a constrained, single-resource development-preview workaround, not RFC
8707 compliance and not a public-production claim. Do not add a second OAuth
resource or broaden the callback allowlist. A public release requires either an
upstream fix or a reviewed standards-compliant authorization layer, plus the
full hosted acceptance above.

## Local verification

```sh
npm run check
```

The combined gate runs Worker and panel typechecking, all Node/PGlite tests, a
Wrangler production dry-run, the local workerd smoke test, and real-browser MCP
Apps tests. These prove the local implementation only. They do not substitute
for a hosted password email, real DCR/token exchange, ChatGPT connection,
refresh/revocation, or cross-account test.
