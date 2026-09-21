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
- **The block is visible** in anything uploaded whole. A 9:16 crop keeps a centre column about
  32% of the frame width so it is gone for free in every reel, and one `drawbox` in `cut.py`
  covers it for a 16:9 upload at no cost since every clip is re-encoded anyway. At inset 0 a
  plain `crop` removes it without having to find it first.
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

## 11. Open work

- **Per-player vertical reels.** The payload now carries the striker by name on every ball,
  which is what attribution needed and what §8's dead end could not provide. Grouping moments
  by striker and cutting 9:16 reels is the next step, and the crop removes the code for free.
- **A committed regression fixture.** The geometry in [data-code.md](./data-code.md) §1 sits
  deliberately at the edge of what the pipeline supports, which is exactly the kind of constant
  someone shaves without re-measuring. A fixture can run without any committed video: ffmpeg
  generates a 4K background (`testsrc2` plus a noise filter), the QR is overlaid at the shipped
  geometry, encoded at 14.65 Mb/s and decoded byte-exact — demonstrated working in about 9
  seconds for a 5-second clip. Noise is *harsher* than grass, since it is maximally expensive
  to encode, so it errs safe.
- **Instagram publishing.** A Business account plus a Facebook Page (Creator is not supported),
  9:16, 5–90 s, H.264 MP4, and a **public URL** because Meta fetches the file. Two-call
  container model. `instagram_business_content_publish` needs app review, 2–4 weeks, so start
  early if this is wanted.
