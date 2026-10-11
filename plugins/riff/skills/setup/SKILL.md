---
name: setup
description: Set up or reconnect Riff and guide first use after installation. Use only for Riff installation, setup, connection, or first-use guidance.
---

# Set up Riff

Use this workflow for installation, setup, connection, or first use. If the user made a more specific Riff request, prioritize that request and use only the setup steps that help complete it.

1. Call `show_riff_welcome` once. It renders the inline Start → Find → Make introduction and reads no account data. If Riff is not connected yet, its OAuth challenge starts account connection.
2. After authorization, call `open_riff` once. It opens Riff Home in the supported fullscreen panel.
3. Briefly explain the supported path: start with creator context, find an evidence-backed direction, then make a filmable version.
4. Offer one next action: paste a creator profile or public video link, describe an idea, or attach a video through the ChatGPT composer.

Treat onboarding as conversational guidance, not durable account state. Never infer or claim onboarding completion.

Require an explicit user request or explicit user action before starting provider research, fetching public data, consuming trial credits, or spending. Installation and opening Home are not permission to do that work.

Attaching is handled by ChatGPT. Never claim a file was uploaded or that Riff received an upload receipt unless a supported tool returns that result. Never claim recents, save, undo, or filmed-state persistence when the current tools do not expose it.

If either setup tool is unavailable, do not invent a replacement or repeat calls indefinitely. State which step is unavailable, preserve any completed step, and offer the equivalent manual next action in ChatGPT.
