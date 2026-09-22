---
type: Pipeline Playbook
title: The highlights pipeline — reading a recording and cutting reels
description: "How a match recording becomes reels: the two scanners and when each applies, the event rules and the cricket that shapes them, clip windows, and the harness faults that made earlier measurements lie."
tags: [highlights, ffmpeg, qr, detection, reels, clip-windows]
status: stable
generated: { by: claude/opus-5, at: 2026-09-21T22:32:46Z }
---

# highlights.md — the highlights pipeline

**Load before touching anything under `highlights/`.**

Turns a match recording into reels, locally. No cloud, no upload, no API keys.

The overlay is **burnt into the recording**. IRL Pro composites the browser source into the
file, so the score, the ball strip and every event card are already in the pixels. There is
nothing to synchronise: **the frame position *is* the timestamp.**

---

## 1. Two scanners, and when each applies

| | |
|---|---|
| **`qrscan.py`** | Use this. Reads the `?data=1` code — see [data-code.md](./data-code.md). Events are *read*, not inferred. |
| **`detect.py`** | The fallback. Finds event cards by their 5 px accent stripe colour. The only option for anything recorded before `?data=1` shipped, **including the reference match**. |

Both emit the same `moments` shape, so `cut.py` never needs to know which ran. `qrscan.py`
prints a plain message and writes nothing when it finds no code, rather than silently producing
an empty reel.

Both decode **keyframes only**. `detect.py` scans a 4-hour 4K file in about 40 seconds on 8
cores. `qrscan.py` scans a corner crop of similar size but spends more per frame on QR
decoding; ⚠ it has not been timed on a full match, because no full match has yet been recorded
with `?data=1`.

ffmpeg ships inside `imageio-ffmpeg`, so nothing needs installing system-wide. That is
deliberate — Homebrew cannot download through the corporate proxy on this machine, and its
Portable Ruby download fails at 100% with `curl: (92) HTTP/2 stream … INTERNAL_ERROR`.

## 2. 🛑 Why the QR path replaced stripe detection

`app.ts` dismisses an event card the moment the score changes, so a wicket followed quickly by
the next ball can be on screen for **under two seconds and fall between keyframes**. On the
reference match that cost **2 of 15 wickets, unrecoverably** — the information simply is not in
the file at those timestamps.

The code is in every frame, so nothing depends on catching a transient. It also carries what a
card never did: both names, both batters' scores, the bowler's figures, the partnership and the
striker, so a moment arrives with everything a caption needs instead of a colour.

## 3. Geometry is detected, not assumed

`detect.py`'s `find_bar()` locates the scorebar without being told where it is. The overlay is a
static graphic over moving footage, so across frames taken minutes apart the bar pixels barely
change while the field changes a lot; a temporal standard-deviation map shows the overlay as a
quiet rectangle. Two dozen frames, no assumptions about placement.

⚠ **The card's eyebrow text uses the same accent colour as the stripe**, so colour matches
spread rightwards across the glyphs. `np.median()` drifted onto them and a ±14 px modal filter
then discarded valid hits — 25 events instead of 44. The stripe is always the **leftmost** match,
so `_scan()` anchors on `cols.min()`.

## 4. Event rules, and the cricket that shapes them

`qrscan.moments()` derives events from what changed between two payloads. Three rules exist
because of a specific way the data lies, and `test_qrscan.py` pins each one:

- 🛑 **A no-ball does not advance the over.** `ballsBowled` counts *legal* balls, so a six off a
  no-ball leaves it unchanged. A new delivery is recognised from the over **or** the runs **or**
  the wickets. Without this the `7nb` case fixed in `c455921` would be invisible here too, in a
  different disguise.
- 🛑 **A batter's runs reset on dismissal.** A milestone only counts if the striker's *name* is
  unchanged across the pair, or 20 → 51 for the next batter in reads as a fifty.
- 🛑 **The first decoded state describes a ball bowled before the recording began.** Emitting it
  cuts a clip whose window looks back past the start of the file, at footage that cannot contain
  the shot. The first run of `qrscan.py` produced exactly that phantom moment at `00:00`.

**Nothing is trusted without the CRC.** A frame that fails it is dropped, never guessed at —
which is what caught the OpenCV problem in [data-code.md](./data-code.md) §6 instead of letting
wrong data reach a reel.

### 4a. One ball can raise two cards

A four that brings up a fifty shows the boundary card and then the milestone card, and
`cards.ts` plays them one at a time, so the second begins as the first retires. Cutting a clip
per card would put the same footage in the reel twice.

`detect.moments()` groups them on that gap — the next card starts within the previous card's
hold plus its exit transition, while consecutive balls are thirty seconds or more apart, so the
grouping is unambiguous. The clip is framed on the highest-priority card
(`PRIORITY`: wicket, six, four, milestone, partnership) since a milestone or partnership card
only ever follows somebody scoring.

Nothing is discarded by grouping: `events.json` carries the raw events as well as the moments,
and `cut.py --types` filters on a moment's **full** type list, so asking for sixes still finds
the six that also broke a partnership record.

The QR path gets this for free, because one payload change *is* one ball.

## 5. The stripe palette

`detect.py` names events from the 5 px accent stripe. Those colours are a contract — the table
and the reasoning are in [overlay.md](./overlay.md) §6a.

⚠ Recordings from before `3f0a282` have **no milestone or partnership stripes**; those card
types shared the theme's brand accent, so older files yield only wickets and boundaries.

## 6. Clip windows, the one thing worth tuning

```python
WINDOWS = {'wicket': (-52, -8), 'six': (-20, 6), 'four': (-18, 4),
           'milestone': (-24, 4), 'partnership': (-24, 4)}
```

Seconds relative to when the **card or code appeared**, not when the ball was bowled. The
scorer enters the ball on their own device, so the graphic always lags the action, and the lag
depends on how much typing the event needs: a six shows about 5 s late, a wicket about 35 s,
because a dismissal has more fields to fill in. Widen these if your scorer is slower.

`cut.py` re-encodes to 1080p with `h264_videotoolbox`, concatenates, and writes a chapter list
next to the reel.

## 7. Lessons that cost the most

### 7a. 🛑 Detection being right is not the same as the timestamp being right

Frame times were estimated as `chunk_start + index * 2.001`, but the real keyframe interval
alternates 2.00/2.02 s, so the error reached **~18 s over a 1875 s chunk**. Detection looked
perfect while every clip was silently mis-cut, and both reels had to be recut.

Both scanners now use **90 s chunks**, because each chunk's start is exact and the error cannot
accumulate.

### 7b. 🛑 A test that cannot fail is not testing anything

Four separate harness faults in this directory each made results look better or worse than
reality, and **every one was found by deliberately pushing until something broke**, never by
reading a green result:

| Fault | Symptom |
|---|---|
| Inverted polarity in 2-level mode | all 361 modules "wrong" — looked like a codec failure |
| The code never changed across the clip | h264 propagated it losslessly; everything passed |
| `detectAndDecode` scored detection as decoding | mis-decodes counted as successes |
| Python `qrcode` inflates binary payloads | 42 random bytes became a **v14** code, 73 modules instead of 29 |

The last two are documented in [data-code.md](./data-code.md) §6 because they are traps for
anyone writing a new bench, not just historical notes.

### 7c. Other things that bit

- ⚠ **A sampling window shorter than one keyframe interval often contains no keyframe.** `_raw`'s
  `dur` was 0.1 s and had to go to 3.0.
- ⚠ **Multiprocessing cannot pickle a script read from stdin** — `BrokenProcessPool` /
  `FileNotFoundError: '<stdin>'`. Write the script to a file.
- 🛑 **A 26 GB recording sat untracked in a public repo with no ignore rule.** `test video/`,
  `*.mp4`, `*.mov` and `*.mkv` are now in `.gitignore`. Recordings and reels stay out of git.

## 8. The abandoned ball-strip reader

`strip.py` tried to read the overlay's ball-by-ball strip directly, so detection would not
depend on catching a 2-second card. **Deleted.** Two reasons it could not work:

- The strip's x position **moves across the match** (sampled at 1387, 1429, 1499, 1543, 1667,
  1738), so a single `{x, pitch}` calibration is wrong by construction.
- Light discs — a dot, or a ball not yet bowled — are nearly invisible against the card, so most
  frames show only one or two readable slots.

The disc finder itself was correct (1553/1693/1763/1833, pitch 70, width 58); the grid
assumption was what failed. The QR code solved the underlying problem properly.

## 9. Known limits

- **Recordings without `?data=1` fall back to the stripes**, with the missed-card problem in §2.
  There is no way to recover those events after the fact.
- **The block is visible** in anything uploaded whole. Every reel crop starts past ~4% of the
  frame width, so it is gone for free there (§13a), and one `drawbox` in `cut.py` covers it for
  a 16:9 upload at no cost since every clip is re-encoded anyway. At inset 0 a plain `crop`
  removes it without having to find it first.
- **The recording profile matters.** These numbers assume the browser source rendered
  full-frame at 1920 and upscaled ~2× into 4K.

## 10. Verified against

**`20260921_170030_01.mp4`** — 3840×2160, 13.89 Mb/s, the match rig, 66 px code. `qrscan.py`
read **13 of 13** keyframes and produced the expected six and wicket from the replay fixtures;
`cut.py` consumed the output unchanged and wrote a 20.8 MB reel plus chapters. Full decode
figures are in [data-code.md](./data-code.md) §7.

**`Topguns vs Bazzigarz - 2026 FTP20 Div-A.mp4`** — 3840×2160 at 59.52 fps, 4 h 10 m, 26 GB,
topguns-light, **no data code**. Stripe detection found **14 wickets, 9 sixes, 21 fours in 53
seconds**, with the bar located automatically at x=740 y=1900 2389×204 and the stripe column at
x=1528, matching a hand measurement. Fifteen wickets actually fell.

Spot-checked frame by frame: the wicket at 66:34 reads "WICKET, Yeswanth V, c Hemanth B b
Ankit K, 34 (32)" with the score turning to 88/3; the six at 63:38 sits at 86/2; the four at
15:57 at 5/0. Detected times land within 1.5 s of the card appearing, and card durations come
out at exactly 8 s and 2 s, matching `HOLD_MS` in `src/cards.ts` — a useful independent check
that the classifier reads the real thing.

## 11. Publishing

Uploading a cut file to YouTube is built — `publish.py`, covered in
[publishing.md](./publishing.md). Reels go up as Shorts, the full video as an ordinary video,
captioned from the QR payload. Nothing uploads without `--confirm` and uploads default to
private.

✅ **The direct API path publishes fine.** Measured 21 Sep 2026: an upload from this project's
own unverified client landed Public with no lock. The documented restriction that said otherwise
had never been tested here — see [publishing.md](./publishing.md) §0, and §0b for what to
re-check before trusting it with anything that matters.

## 13. Per-player reels (`reels.py`)

One reel per player, for **one team only**, because a personal highlight should contain just
that player's own work. Which player a ball belongs to depends on which side of it the team was
on:

| Our team is | Kept | Belongs to |
|---|---|---|
| **batting** | `four`, `six` | the **striker** |
| **fielding** | `wicket` | the **bowler** |

Everything else is dropped: our batter's dismissal is not their highlight, and the opposition's
six is nobody's.

🛑 **`--batting-innings` is required and cannot be inferred.** The payload carries no team
identity — only an innings number, because team names would have cost more bits than the rest of
the record ([data-code.md](./data-code.md) §2). Pass the wrong one and every attribution
inverts: our batters' boundaries get credited to the opposition and their wickets to our bowlers.
`test_reels.py` pins that inversion so the failure is visible rather than plausible.

⚠ **A run-out belongs to no bowler.** `wickets` rises while `bowlerWickets` stays put, so
crediting it to the bowler would drop another fielder's dismissal into their reel.
`qrscan.moments()` now carries a `bowlerWicket` flag for exactly this, and it defaults to true
for scans made before the flag existed rather than silently dropping their wickets.

🛑 **Attribution fails silently.** A bad clip window is obvious — the clip misses the shot. A
bad attribution produces a perfectly good clip filed under the wrong person, and nothing about
the output looks wrong. That is why the rules are unit-tested rather than eyeballed.

### 13a. 🛑 The crop is square, and that is measured

`--vertical` crops **1:1**, not 9:16. Shorts only require height ≥ width, so the shape is a
free choice — and 9:16 is the wrong one for this camera.

**The camera is side-on**, so the pitch runs *across* the frame. Measured on three real events
in the reference match, the pitch occupies roughly **36%–73% of the frame width**, about 37%.

| Aspect | Crop width at 16:9 | Spans | Contains the pitch? |
|---|---|---|---|
| `9:16` | **31.6%** | 34.2%–65.8% | ❌ **cannot** — narrower than the pitch |
| `4:5` | 45.0% | 27.5%–72.5% | ~ marginal at the far end |
| **`1:1`** (default) | **56.2%** | 21.9%–78.1% | ✅ whole pitch, both ends |

🛑 **A 9:16 window is narrower than the pitch, so no placement works.** On the three events it
cut off the bowler's end every time — the batter at the far stumps sat outside the frame on the
wicket, and on both boundaries the bowler's end was gone. The old default was never chosen: it
was ffmpeg's `crop` centring default, justified in these docs by the fact that it removed the
data code, which is a side effect and not a framing decision.

⚠ **There is no fixed "action side" to aim a narrow crop at.** Which end the striker occupies
alternates every over, *and* again whenever the batters cross on an odd run. Two frames minutes
apart in the same match show the striker at 38% and at 68%.

❌ **Motion-based auto-crop was tried and does not work.** A per-column temporal
standard-deviation map over each clip — the same technique `find_bar()` uses to locate the
overlay (§3) — put the peak at 81.6%, 39.2% and 75.8% for the three events. Those are not the
batter: over a 20-second window the bowler's run-up and fielders chasing the ball move far more
than a shot lasting a fraction of a second. It picked the bowler's end on one clip and the
striker's on another, so it is not even consistently wrong. A square crop needs no such guess.

Deriving the striker's end from cricket logic is possible in principle — over parity plus every
odd-run crossing — but one missed ball desynchronises it silently, which is the exact failure
class this pipeline keeps getting caught by.

`--aspect` and `--crop-x` exist for a different camera setup: `--crop-x` moves the window as a
fraction of frame width, clamped inside the frame.

✅ **Any crop starting past ~4% of the width still excludes the `?data=1` block**, so it stays
removed for free at every aspect. Verified by re-scanning a finished reel: `qrscan.py` decoded
**0 of 80** keyframes, against 13 of 13 on the source.

### 13b. Captions travel in a sidecar

A per-player reel spans several balls, so no single moment describes it and
`publish.py --moment N` does not fit. `reels.py` writes `<player>.json` next to `<player>.mp4`
with the title, description and tags, and `publish.py --meta <json>` uses it verbatim:

```sh
.venv/bin/python reels.py "<video>" events.json -o reels/ \
    --batting-innings 1 --team Topguns --match "Topguns vs Bazzigarz" --vertical

.venv/bin/python publish.py reels/v-kohli.mp4 --target shorts \
    --meta reels/v-kohli.json --privacy public --confirm
```

Reels and their sidecars are **gitignored** (`highlights/reels*/`) — generated per match and
uploaded, never source.

### 13c. Captions come from the scorecard, not from a template

A per-player caption reads like a scorecard line, because every number in it is in the payload:

```
V. Kohli 46 (28), 3 fours, 2 sixes
Topguns vs Bazzigarz — 2026 FTP20 Div-A

In this reel: 2 sixes, 1 four
00:00  SIX off J. Bumrah — 2.3 ov, 31/0
00:19  FOUR off M. Shami — 5.1 ov, 52/1
```

- `figures()` takes the player's **highest** figures across every state, not the ones on
  their last boundary. ⚠ Without that, a batter whose final four came at 20 but who finished
  on 60 gets captioned "20".
- 🛑 **The headline is the whole innings; "In this reel" is only what was captured.** Those
  differ legitimately whenever the stream started mid-innings, so the description names both
  rather than leaving a reader to decide which is wrong.
- Bowling reads as figures — `3/24 (4.0 ov)` — and the wicket count is dropped from the title
  only when it equals the innings figure, since a smaller number is real information.
- ⚠ Zero counts are omitted. `1x4, 0x6` reads like a bug.
- ⚠ **No figures, no invention.** `detect.py` output carries no `states`, so captions fall back
  to the detected tally instead of guessing numbers.

## 14. 🛑 Before the next match

The pipeline is built and tested end to end, but four things have to be true on the day and
only the first is under the code's control:

1. 🛑 **The stream must be opened with `?data=1`.** Without the code in the pixels there are no
   names, so `detect.py`'s colour stripes are all that is left and **per-player reels are
   impossible** — there is no way to recover attribution afterwards. This is the single point
   where a whole match's reels are lost, and it is one query parameter.
2. 🛑 **Keep the top-left corner of the frame clear.** That is where the code is drawn. A
   station logo or a camera overlay on top of it blinds the scanner.
3. ⚠ **The OAuth consent screen must be "In Production", not "Testing".** In Testing, Google
   expires the refresh token after exactly 7 days and an upload that worked last week fails
   with nothing useful in the log — see [publishing.md](./publishing.md) §3.
4. **`--batting-innings` has to come off the scorecard.** Which innings the team batted is not
   in the payload and cannot be guessed; the wrong value inverts every attribution (§13).

⚠ **Not yet exercised on a real match.** Everything above is verified against a 26-second
fixture recording with two moments, one innings and replay names. What a real match will
exercise for the first time: several players, both innings, real names, and `qrscan.py` on a
4-hour 4K file — whose runtime has never been measured, unlike `detect.py`'s 40 seconds (§1).

## 12. Open work

- ~~Per-player vertical reels~~ — **built**, see §13.
- **A committed regression fixture.** The geometry in [data-code.md](./data-code.md) §1 sits
  deliberately at the edge of what the pipeline supports, which is exactly the kind of constant
  someone shaves without re-measuring. A fixture can run without any committed video: ffmpeg
  generates a 4K background (`testsrc2` plus a noise filter), the QR is overlaid at the shipped
  geometry, encoded at 14.65 Mb/s and decoded byte-exact — demonstrated working in about 9
  seconds for a 5-second clip. Noise is *harsher* than grass, since it is maximally expensive
  to encode, so it errs safe.
- **Instagram publishing.** Researched and deferred — see [publishing.md](./publishing.md) §8.
  ✅ App review turns out **not** to be needed for a single-user tool, which removes the 2–4 week
  blocker previously recorded here. The real cost is that Meta fetches the file, so it needs a
  publicly reachable URL.
