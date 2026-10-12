---
name: setup
description: Set up or reconnect Riff and guide first use after installation. Use only for Riff installation, setup, connection, or first-use guidance.
---

# Set up Riff

Use this workflow for installation, setup, connection, or first use. If the user made a more specific Riff request, prioritize that request and use only the setup steps that help complete it.

Never render the welcome on the sign-in website or inside Riff Home. The first-use card belongs in the same originating ChatGPT conversation; Home remains open on the right.

1. Call `open_riff` as the first tool call. It is the protected action that starts OAuth when connection is required and opens the Riff app after authorization succeeds.
2. Inspect only a strict, coherent successful `open_riff` structured result. When `data.account.onboarding_seen_at` is exactly `null`, call `show_riff_welcome` exactly once in the same originating response. This renders the Start → Find → Make Paper carousel inline in chat while Home remains usable on the right. If the result is failed, malformed, or omits the marker, do not infer first use or call the welcome automatically.
3. When `data.account.onboarding_seen_at` is set, do not call `show_riff_welcome` unless the user explicitly asks to replay the guide.
4. Never call `mark_riff_onboarding_seen` from the model. Only the inline welcome app may call it after the user explicitly finishes the visible final step; replaying the guide never resets account state.
5. Respond in the ChatGPT conversation with one concise Start → Find → Make introduction: start with creator context, find an evidence-backed direction, then make a filmable version.
6. Offer one next action: paste a creator profile or public video link, describe an idea, or attach a video through the ChatGPT composer.

Treat onboarding as complete only when the inline welcome app confirms the explicit completion write; never infer completion from merely opening or displaying the card. A completion failure must leave Home usable and the guide retryable.

Require an explicit user request or explicit user action before starting provider research, fetching public data, consuming trial credits, or spending. Installation and opening Home are not permission to do that work.

Attaching is handled by ChatGPT. Never claim a file was uploaded or that Riff received an upload receipt unless a supported tool returns that result. Describe recent work only from `list_riff_work`. Claim Save, Undo, or Filmed persistence only after `set_riff_work_state` returns a strict successful receipt and authoritative job reconciliation confirms the new state. Otherwise report the state as unconfirmed or the write as a failure; never infer persistence from the requested action or optimistic UI.

If any setup tool is unavailable, do not invent a replacement or repeat calls indefinitely. State which step is unavailable, preserve any completed step, and offer the equivalent manual next action in ChatGPT.
