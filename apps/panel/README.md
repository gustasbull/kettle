# Riff MCP App UI

The panel package contains Riff-owned UI rendered inside ChatGPT. ChatGPT owns
the surrounding app chrome, composer, installation flow, and OAuth handoff.
Riff resources are static bundled HTML documents with empty network allowlists;
all account data arrives through authenticated MCP tool results.

## Implemented surfaces

- `riff-onboarding`: compact conversational **Welcome to Riff** guide.
- `riff-home`: fullscreen Home shell with creator-input handoffs.
- `creator-pipeline`: inline summaries plus fullscreen Analysis, Discovery, and
  Studio views backed by saved creator-job results.
- `creator-loop`, `creator-review`, and `project-review`: compatible read-only
  review cards, now carrying Riff-facing copy.

Inline results stay compact. Discovery and Studio request fullscreen only after
an explicit user action and keep an inline fallback when the host cannot switch.
Actions that do not yet have durable mutations—upload, save for later, filmed
state, and library-specific discovery—continue transparently in ChatGPT rather
than claiming an in-panel write.

## Local previews

Build all browser bundles:

```sh
npm run build:panel
```

Run the Riff Home fixture at `http://127.0.0.1:4174`:

```sh
node apps/panel/riff-home/preview-server.mjs
```

Run saved Creator DNA fixtures at `http://127.0.0.1:4175`:

```sh
node apps/panel/creator-loop/preview-server.mjs
```

Run Analysis, Discovery, and Studio fixtures at
`http://127.0.0.1:4177`:

```sh
node apps/panel/creator-pipeline/preview-server.mjs
```

These previews are fictional, local-only simulations. They do not authenticate,
persist data, call providers, or prove behavior in the ChatGPT host.

## Host and data rules

- Use explicit IDs and versions through the host bridge; never infer selection
  from display order.
- Preserve a complete text response when a panel is unavailable.
- Use backend-reported state and indeterminate progress; never fabricate a
  percentage, metric, preview, or success state.
- Render provider content as untrusted text and allow only safe outbound URLs.
- Keep compatibility-sensitive internal names and `ui://kettle/*` resource URIs
  until a separately coordinated protocol migration.
