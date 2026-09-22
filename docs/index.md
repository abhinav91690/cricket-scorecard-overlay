---
okf_version: "0.2"
---

# Cricket Scorecard Overlay — Knowledge Bundle

Why the overlay is built the way it is, and the traps that made it that way. Entry point for an
agent is [CLAUDE.md](../CLAUDE.md), which holds the ground rules, the address index and the
one-line tripwires. **The tripwires say a mistake exists; the concepts below say why and how to
avoid it — load the relevant one before working in that area.**

[README.md](../README.md) is the user-facing guide: what the parameters are and how to add the
overlay to OBS. It is **not** a knowledge store, and reasoning does not belong there.

Paths written in prose inside these concepts are relative to the **repository root**, one level
above this directory.

🛑 **This repository is public.** No secrets, no keys, and no real names of league members in
any file here. See [analytics.md](./analytics.md) §6 and §7.

## The application

- [The overlay](./overlay.md) - The poll loop and mode switch, DOM update discipline, the
  import-time `dom.ts` trap, the 17-theme token system, the event-card queue and its palette
  contract, and why Link Live Stream must stay a popup.
- [CricClubs API](./cricclubs-api.md) - The endpoints, the `view` mechanism, per-view payload
  shapes and probing recipes. ⚠ **Arrives with PR 13** (`feature/cricclubs-views`); this link is
  broken until that merges.

## Highlights

- [The highlights pipeline](./highlights.md) - The two scanners and when each applies, the event
  rules and the cricket that shapes them, clip windows, the frame-timing bug that cost the most,
  and the four harness faults that made earlier measurements lie.
- [The `?data=1` code](./data-code.md) - The 42-byte wire format, the pinned geometry and why
  every number is what it is, the cross-language contract, and the decoder that must be used.
- [Publishing](./publishing.md) - Reels to YouTube Shorts and the highlights video to YouTube:
  the locked-private trap that an unverified project cannot escape and the Make route that
  bypasses it, the one-time Google setup, the OAuth trap that kills an unattended uploader
  weekly, and where Instagram stands.

## Operations

- [Usage analytics](./analytics.md) - What the client sends and when it refuses to, the Worker
  and its D1 schema, the private stats page, why the deploy is deliberately manual, and why
  stream duration is not measurable.
- [Deployment](./deployment.md) - Netlify and Cloudflare, deploy previews as the way to get a
  public URL a phone can load, and the corporate CA that breaks Node and wrangler in a fresh
  shell.

## Open work

- [Feature ideas](./feature-ideas.md) - Candidate features, most already arriving in every poll.
  Ideas only; nothing there is built.
