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

🛑 **Never hand-roll a clip with raw ffmpeg — always go through `segments()`.** These windows
are the only thing that knows the graphic lags the action, and bypassing them produces a clip
of the *wait* rather than the shot. Demonstrated on 23 Sep 2026: a test reel cut with
`ffmpeg -ss 3790 -t 14` showed the batter standing still and nothing else, because the window
ended 9 s before the ball was bowled. `segments()` would have given 3798–3824 and caught it.

⚠ **Convert `mm:ss` arithmetically, not by eye.** The same test had 63:38 entered as 3808 s
instead of 3818, and 66:34 as 3962 instead of 3994 — two of three timestamps wrong, each error
silently shifting the window earlier. Combined with hand-rolling the cut, the clip missed
twice over.

### 6a. ✅ The overlay is its own witness: verify a clip before publishing it

🛑 **"The cut succeeded" and "the shot is in the clip" are separate claims.** A clip that
misses the ball looks perfectly fine — right length, right crop, real cricket, no error
anywhere. Extracting one mid-clip frame proves only that the video is not black.

Because the scorebar is **burnt into the footage**, the clip carries the evidence. Read the
score at each end:

| | |
|---|---|
| start of clip | `TOPGUNS 80/2 · 9 ov · CRR 8.89` |
| end of clip | `TOPGUNS 86/2 · 9.1 ov · CRR 9.38` |

Six runs on one ball, so the six is inside the window. Objective, and it takes two frames:

```sh
ffmpeg -ss 1      -i reel.mp4 -frames:v 1 -vf "crop=iw:220:0:ih-220" start.png
ffmpeg -ss <dur-1> -i reel.mp4 -frames:v 1 -vf "crop=iw:220:0:ih-220" end.png
```

⚠ **Worth automating for `?data=1` recordings.** `qrscan.py` already decodes the payload from
frames, so running it over a *finished clip* would read the before-and-after state directly and
assert the expected delta — a boundary adds 4 or 6, a wicket moves the wicket count. That turns
"did the cut work" from a human eyeball into a check. Not built; see §12.

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
- ⚠ **The `?data=1` code has no super-over marker.** Its `innings` bit and totals follow whichever
  innings is being bowled, so `highlights/` cannot tell a super-over ball from a main-match one, and a
  per-player reel attributed by `--batting-innings` could pick up super-over balls. Ties are rare
  enough that this is recorded rather than fixed; the overlay side is correct (overlay.md §14b).

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

### 13a. 🛑 There is no default crop, deliberately

Shorts only need height ≥ width, so the shape is a free choice — and it is **left open**, for
two reasons:

1. **The camera framing changes every match.** Nothing derivable from the file tells you where
   the pitch sits, so a constant would be wrong as often as right.
2. **The two roles want different boxes** (below), so one value could not serve both anyway.

So `--aspect-bat` and `--aspect-bowl` have **no defaults**. Omit a role's flag and that role is
cut at **full frame** — 16:9, which `publish.py` then correctly refuses as a Short rather than
letting it land as an ordinary video. Pass a **comma list** to cut one file per shape and choose
after watching them:

```sh
# narrow the choice on a still first
.venv/bin/python crop.py "/path/match.mp4" -t 3800 -o crops.png

# then cut variants to compare on screen
.venv/bin/python reels.py … --aspect-bat 4:5,1:1 --aspect-bowl 1:1
```

Files carry the shape in the name — `v-kohli-batting-4x5.mp4`, `v-kohli-batting-1x1.mp4` — each
with its own caption sidecar, so `--meta` pairs with whichever variant survives review.

#### What each role's box has to contain

| Reel | Must contain | Why |
|---|---|---|
| **batting** | **both** sets of stumps | 🛑 The batter's end alternates every over *and* on every odd run, so a box holding one end loses half their shots. The bowler's run-up is irrelevant. |
| **bowling** | the stumps **and the run-up** | The bowler starts well behind the stumps. |

Measured on the reference camera, where the pitch spanned about **36%–73%** of the frame width.
⚠ **These are that camera's numbers, not constants** — re-check with `crop.py` per match:

| Aspect | Width at 16:9 | Spans | Both batting ends? | Run-up? |
|---|---|---|---|---|
| `9:16` | 31.6% | 34.2%–65.8% | ❌ narrower than the pitch | ❌ |
| `4:5` | 45.0% | 27.5%–72.5% | ✅ | ~ tight |
| `1:1` | 56.2% | 21.9%–78.1% | ✅ | ✅ |

🛑 **The crop was once 9:16 and that was not a decision at all.** It is ffmpeg's `crop` centring
default, and the rationale written here — that it removes the `?data=1` block — is a side effect
of *any* crop starting past ~4% of the width. A coincidence was documented as a reason, and on
three real events that crop cut off the bowler's end every time, including the batter at the far
stumps.

❌ **Motion-based auto-crop was tried and does not work.** A per-column temporal
standard-deviation map per clip — the technique `find_bar()` uses to locate the overlay (§3) —
put the peak at 81.6%, 39.2% and 75.8% on those three events. ⚠ Those three figures are
**doubly unreliable**: the windows they were measured over used the mis-converted timestamps
above, so they did not even cover the deliveries. The conclusion stands anyway, because it
rests on the frame *geometry* — a side-on pitch spanning 36%–73% of the width, read off real
frames — and not on the peaks. None is the batter: across a
20-second window the bowler's run-up and the fielders chasing outweigh a shot lasting a fraction
of a second. It found the bowler's end on one clip and the striker's on another. Recorded so it
is not re-attempted.

Deriving the striker's end from cricket logic — over parity plus every odd-run crossing — is
possible in principle, but one missed ball desynchronises it silently, which is the exact
failure class this pipeline keeps getting caught by.

✅ **Every crop starting past ~4% of the width still excludes the `?data=1` block**, at any
aspect. Verified by re-scanning a finished reel: `qrscan.py` decoded **0 of 80** keyframes,
against 13 of 13 on the source.

### 13aa. 🛑 One player, two roles, two reels

Reels are keyed by **(player, role)**, and the role is in the filename —
`v-kohli-batting.mp4`, `v-kohli-bowling.mp4`.

Keyed by name alone, an all-rounder who hit a four and later took a wicket got **one** reel
holding both, and every caption helper reads the role off the first moment — so it would have
been captioned with batting figures while containing a wicket. It also made the per-role crop
above impossible to apply. Pinned by `test_an_all_rounder_gets_one_reel_per_role`.

### 13b. Captions travel in a sidecar

A per-player reel spans several balls, so no single moment describes it and
`publish.py --moment N` does not fit. `reels.py` writes `<player>.json` next to `<player>.mp4`
with the title, description and tags, and `publish.py --meta <json>` uses it verbatim:

```sh
.venv/bin/python reels.py "<video>" events.json -o reels/ \
    --batting-innings 1 --team Topguns --match "Topguns vs Bazzigarz" \
    --aspect-bat 4:5 --aspect-bowl 1:1

.venv/bin/python publish.py reels/v-kohli-batting.mp4 --target shorts \
    --meta reels/v-kohli-batting.json --privacy public --confirm
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
- **Assert the cut, don't eyeball it.** §6a verifies a clip by reading the burnt-in scorebar
  at each end. For a `?data=1` recording this could be mechanical: scan the finished clip with
  `qrscan.py` and assert the payload delta matches the event the clip claims to be — +4 or +6
  for a boundary, a wicket count that moves. A clip that misses its ball would then fail loudly
  instead of looking fine.
- **A committed regression fixture.** The geometry in [data-code.md](./data-code.md) §1 sits
  deliberately at the edge of what the pipeline supports, which is exactly the kind of constant
  someone shaves without re-measuring. A fixture can run without any committed video: ffmpeg
  generates a 4K background (`testsrc2` plus a noise filter), the QR is overlaid at the shipped
  geometry, encoded at 14.65 Mb/s and decoded byte-exact — demonstrated working in about 9
  seconds for a 5-second clip. Noise is *harsher* than grass, since it is maximally expensive
  to encode, so it errs safe.
- **Instagram publishing.** The hosting half is built and verified (R2 upload, presigned
  URLs, delete — [publishing.md](./publishing.md) §8c). What remains is the Meta app setup
  (§8b) and the three-call publish (§8f).
  ✅ App review turns out **not** to be needed for a single-user tool, which removes the 2–4 week
  blocker previously recorded here. The real cost is that Meta fetches the file, so it needs a
  publicly reachable URL.
