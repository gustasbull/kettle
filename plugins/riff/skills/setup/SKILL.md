---
name: setup
description: Set up or reconnect Riff and guide first use after installation. Use only for Riff installation, setup, connection, or first-use guidance.
---

# Set up Riff

Use this workflow for installation, setup, connection, or first use. If the user made a more specific Riff request, prioritize that request and use only the setup steps that help complete it.

Never render the welcome on the sign-in website or inside Riff Home. The first-use card belongs in the same originating ChatGPT conversation; Home remains open on the right.

1. Call `open_riff` as the first tool call. It is the protected action that starts OAuth when connection is required, returns to this conversation, and opens Riff Home after authorization succeeds.
2. Inspect the successful result. If `data.account.onboarding_seen_at` is `null`, call `show_riff_welcome` immediately so the Start → Find → Make carousel renders in this same ChatGPT conversation. After it succeeds, call `mark_riff_onboarding_seen` with an empty input. If the welcome fails, returns a malformed result, or times out, never call `mark_riff_onboarding_seen`. Never mark onboarding before the welcome tool succeeds, and never claim it was recorded if that write fails.
3. If `onboarding_seen_at` is already set, do not replay the card automatically. Call `show_riff_welcome` later only when the user explicitly asks to show or replay the welcome.
4. Respond in the ChatGPT conversation with one concise Start → Find → Make introduction: start with creator context, find an evidence-backed direction, then make a filmable version.
5. Offer one next action: paste a creator profile or public video link, describe an idea, or attach a video through the ChatGPT composer.

Treat the welcome itself as conversational guidance. Treat onboarding as complete only when `mark_riff_onboarding_seen` returns success; never infer completion from merely opening or displaying the card.

Require an explicit user request or explicit user action before starting provider research, fetching public data, consuming trial credits, or spending. Installation and opening Home are not permission to do that work.

Attaching is handled by ChatGPT. Never claim a file was uploaded or that Riff received an upload receipt unless a supported tool returns that result. Describe recent work only from `list_riff_work`; never claim save, undo, or filmed-state persistence because the current tools do not expose those writes.

If any setup tool is unavailable, do not invent a replacement or repeat calls indefinitely. State which step is unavailable, preserve any completed step, and offer the equivalent manual next action in ChatGPT.
