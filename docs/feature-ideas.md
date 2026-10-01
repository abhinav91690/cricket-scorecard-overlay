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
- **Two-camera highlights** — a wide camera with the scorecard plus a tight camera on the batter,
  cut together automatically. Designed and decided, not built: §12.

## 11. Captain and keeper marks on the line-up card

The line-up panel already renders a `C` badge when a squad row carries `isCaptain`
(`squadRows()` in `views.ts`), but **no CricClubs overlay view exposes a captain or
wicketkeeper flag today** — see [cricclubs-api.md](./cricclubs-api.md). Not urgent: revisit if a
view starts carrying that data, or if a per-club config becomes worth adding.

## 12. Two-camera highlights — a per-second time code synced to the Worker

**Designed and decided 2026-09-30; nothing built.** The goal: a wide main camera with the
scorecard, plus a second camera zoomed in on the batter, so a reel can show a six on the wide
shot and then a close-up replay of the shot — automatically, with no hand-syncing of footage.

### 12a. 🛑 The decision: a per-second code on both feeds, timed from the Worker's clock

Each feed burns in a small code that changes once a second. Decode both files and every second
gives a matched pair of frames, so drift, dropped frames and phone variable-frame-rate recording
never accumulate — nothing is extrapolated more than a second. ⚠ The anchor is the frame where
the code **changes**, accurate to ±1 frame; the value it shows is only the label.

The time comes from **one clock, the Worker's**, not from the two phones. One reference beats two
independent clocks, and the page never reads the phone's wall clock at all:

1. At load, call `GET /api/time` about eight times; keep the sample with the **shortest round
   trip**, timed on `performance.now()`. Its error bound is half that round trip.
2. Code time = `workerTimeAtSync + (performance.now() − perfAtSync)`. `performance.now()` is
   monotonic, so an OS clock step mid-match — a phone regaining signal — changes nothing.
3. Re-sync every few minutes against the phone's slow drift. If one fails, carry on from the last;
   minutes of free-running drift by milliseconds.
4. Switch the code on the first animation frame after each whole second of corrected time.

Expected agreement between two phones: about ±1 frame at 30 fps, if the shortest of eight round
trips on the ground's mobile link is under ~60 ms. **Measure it — see §12f.**

### 12b. Rejected, and why — so this is not reopened by accident

- **Each phone's own clock, authenticator-style.** A TOTP code is a hash of the current time
  window: it removes the network, not the clock. Two independent clocks drift apart and can be
  stepped by the OS.
- **Audio cross-correlation as the sync.** Precise but *biased*: sound travels ~3 ms per metre, so
  cameras at different distances from the pitch skew every replay the same way — 20 m is ~60 ms,
  about two frames at 30 fps.
- **A clap or slate alone.** Anchors only at the moments it happens, nothing in between.
- **Time inside the `?data=1` code.** That payload is a fully allocated 336-bit wire format with a
  cross-language contract ([data-code.md](./data-code.md)). The time code is a separate code.

### 12c. The time code

A version-1 QR at ECC-M holds 14 bytes, which this fills exactly:

| Field | Bytes |
|---|---|
| Worker time, Unix seconds | 4 |
| Club id | 3 |
| Match id | 3 |
| Camera id (wide, tight, …) | 1 |
| Sync error bound in ms (255 = never synced) | 1 |
| CRC-16 | 2 |

About 50 × 50 px at the data code's **measured floor** — 2 px modules, 2-module quiet zone, which
must not be shaved without re-measuring ([data-code.md](./data-code.md) §1). The same rules
apply: decode with zxing-cpp, never OpenCV; generate test codes with the npm encoder, never the
Python `qrcode` library. Club, match and camera id make every file **self-identifying**, so
collation is: drop both files in a folder and let the pipeline pair them.

- **Camera 1** shows the scorebar, the `?data=1` code and the time code.
- **Camera 2** runs a new **`?timecode=1`** mode drawing *only* the time code on a transparent
  page, in a corner the 9:16 reel crop throws away. ⚠ `?quiet=1` is not enough: it hides cards and
  panels but still draws the scorebar (`renderFrame()` in `app.ts`).

### 12d. 🛑 What the footage still has to supply: one constant, and the check

Matching codes align the *overlays*, not the *pictures*. Each phone's camera image reaches the
overlay compositor after its own delay, so the two images can sit a frame or two apart while the
codes agree perfectly — and nothing in the codes can show it. That difference is constant for the
match, so:

- Detect the batter's shot movement in **both** feeds (the motion-onset detector of
  [highlights.md](./highlights.md) §6c, pointed at the batter region rather than the pitch). The
  **median** difference across all balls is the latency constant; apply it once.
- Check every replay against it and **skip any ball more than ~2 frames out**. A replay of the
  wrong instant is worse than none, the same lesson as the clip windows (§6e there).

### 12e. The automated cut, and the rig

- **Wide with scorecard** −3 s to +5 s through `cut.segments()`, never raw ffmpeg; then the **tight
  replay** −1 s to +2.5 s around the same instant, ramped to 50% at contact, behind a short
  "REPLAY" wipe; optionally back to wide. Replays only for fours, sixes and wickets.
- **One audio bed throughout** — the wide camera's sound under the replay too. A cut with
  continuous sound reads as editing; a change of sound reads as a jump.
- **Tight camera side-on at square leg or midwicket, framing both creases.** The striker changes
  ends, so a camera behind one end covers half the overs; side-on, both ends share a centre
  ([highlights.md](./highlights.md) §6d).
- Same **constant** frame rate on both (60 on the tight camera for slow motion); white balance
  **locked** on both so the cut does not jump in colour.
- ⚠ **Camera 2 must composite a browser source** — IRL Pro or OBS. A GoPro or plain camera app
  cannot burn in a code. It also needs a connection for `/api/time`: fine if it streams, a
  hotspot from phone 1 if it only records.
- The pipeline needs no full decode: the `?data=1` code already dates each event on camera 1, so
  read camera 1's time code there, jump to the same second in camera 2, find the change frames on
  either side and cut — a few dozen small searches per match.

### 12f. Before building the reel side

**One test at home, with no match:** two phones side by side, both on `?timecode=1`, filmed by a
third camera at 60 fps. The codes should change within a frame of each other. That measures sync,
render timing and compositing together, in ten minutes, and it can fail.

Still to measure: how often IRL Pro refreshes a browser source (if slower than it encodes video,
the change frames land irregularly); whether a 50 px code survives camera 2's stream bitrate; the
size of the latency constant; the real round-trip time at the ground.

### 12g. Notes for the Worker side

- **`/api/time` needs its own route.** The routes deliberately claim only `/api/collect` and
  `/stats*` ([analytics.md](./analytics.md) §3); a wildcard would put the Worker in front of the
  whole site. Deploying it is manual ([analytics.md](./analytics.md) §4).
- It touches no D1 and returns only a timestamp — a few dozen requests an hour per phone.
- Inside a Worker, `Date.now()` is frozen at the start of the request. For a time endpoint that is
  exactly the moment wanted.
- Same origin as the overlay (`score.abhinav.dev`), so no CORS.

**Build order:** `/api/time` → `?timecode=1` → a decoder that turns a file into frame → Worker
time. All three can be tested on one phone before a second camera exists.
