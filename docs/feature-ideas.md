---
type: Open Work
title: Feature ideas — unused API fields and UX gaps
description: Candidate features, most of them already typed in types.ts and arriving in every poll, so the data cost is zero. Open ideas only; nothing here is built.
tags: [ideas, backlog, api-fields, ux]
status: draft
generated: { by: claude/opus-5, at: 2026-09-21T22:32:46Z }
---

# feature-ideas.md — candidate features

**Load before designing a new overlay feature — the data may already be arriving.**

🛑 **Ideas only. Nothing here is implemented.** The reasoning for anything that *is* built lives
in [overlay.md](./overlay.md).

Most of these need no new request: the fields are already in the `liveScoreOverlayData.do`
response and typed in `src/types.ts`, so they arrive in every five-second poll whether or not
anything reads them.

---

## 1. Available in the feed, unused

| # | Idea | Fields |
|---|---|---|
| 1 | **Current run rate** on the score pill, and RRR in a chase | `t1RR`, `t2RR`, `RRR` |
| 2 | **Partnership bar** — "Partnership: 45 (32)" between the batters and the pill | `currentPartnershipMap` |
| 3 | **Last wicket ticker** — "Kohli c Buttler b Archer 45(30)" fading in after a dismissal | `lastOutName`, `lastOutString`, `lastOutRuns`, `lastOutBalls` |
| 4 | **Player headshots** next to names | `batsman1ProfileImange`, `batsman2ProfileImange`, `bowlerProfileImange` *(sic — the API misspells it)* |
| 5 | **Toss / match info strip** before the first ball | `toss`, `seriesName`, `groundName` |
| 6 | **Extras breakdown** as a detail or tooltip | `t1Extras`, `t2Extras` |
| 7 | **Nickname support** behind `?nicknames=true` | `displayNickNameOnOverlay` and the nickname fields |
| 8 | **Man of the match** card alongside the result | `manOfTheMatch`, `momImagePath` |
| 9 | **Sponsor carousel** in the overlay image slot | `sponsorsImgPaths` (an array) |

⚠ **Items 1, 2 and 6 are now partly served.** `statusText()` already shows CRR and the Need/RRR
row ([overlay.md](./overlay.md) §3), and the partnership and extras are carried in the
`?data=1` payload ([data-code.md](./data-code.md) §2) even though the bar does not display
them. Check what exists before building.

## 2. Not from the feed

- **Configurable refresh rate.** Hardcoded at 5 s in `CONFIG.REFRESH_RATE`. A `?refresh=3000`
  param would let streamers tune responsiveness. ⚠ A `?refresh=` hook already exists for the
  simulator via `src/e2e.ts`, but **only on localhost** — see [overlay.md](./overlay.md) §11.
- **Captain marking.** Wanted, but no field for it has been found in the feed yet. Parked until
  the data turns up; not urgent.

## 3. Bigger threads

- **Per-player vertical reels** — the next real piece of work, tracked in
  [highlights.md](./highlights.md) §11 where the attribution detail lives.
- **Instagram publishing** — also [highlights.md](./highlights.md) §11. The app-review lead time
  is the long pole.

## 11. Captain and keeper marks on the line-up card

The line-up panel already renders a `C` badge when a squad row carries `isCaptain`
(`squadRows()` in `views.ts`), but **no CricClubs overlay view exposes a captain or
wicketkeeper flag today** — see [cricclubs-api.md](./cricclubs-api.md). Not urgent: revisit if a
view starts carrying that data, or if a per-club config becomes worth adding.
