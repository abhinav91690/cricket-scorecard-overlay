# highlights

Turns a match recording into reels, locally. No cloud, no upload, no API keys.

The overlay is **burnt into the recording**. IRL Pro composites the browser source into the
file, so the score, the ball strip and every event card are already in the pixels. There is
nothing to synchronise: the frame position *is* the timestamp.

## Two ways to read a recording

**`qrscan.py` — use this.** The overlay draws a machine-readable QR code in the frame's
top-left corner when the stream is opened with `?data=1`. It carries the whole bar state, so
events are read rather than inferred.

**`detect.py` — the fallback.** Finds event cards by the colour of their 5px accent stripe.
This is all there is for anything recorded before `?data=1` shipped, including the reference
match below. It works, but it is lossy — see [Why the QR path replaced it](#why-the-qr-path-replaced-it).

## Use

```sh
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

# preferred: the stream was opened with ?data=1
.venv/bin/python qrscan.py "/path/match.mp4" -o events.json

# fallback: no data code in the recording
.venv/bin/python detect.py "/path/match.mp4" -o events.json

# either way, cutting is the same
.venv/bin/python cut.py "/path/match.mp4" events.json -o reel.mp4
.venv/bin/python cut.py "/path/match.mp4" events.json -o wickets.mp4 -t wicket
```

Both scanners emit the same `moments` shape, so `cut.py` never needs to know which one ran.
`qrscan.py` prints a plain message and writes nothing if it finds no code, rather than
silently producing an empty reel.

Both decode **keyframes only**. `detect.py` scans a 4-hour 4K file in about 40 seconds on 8
cores; `qrscan.py` scans a corner crop of similar size but spends more per frame on QR
decoding, and has not yet been timed on a full match because no full match has been recorded
with `?data=1`.

ffmpeg ships inside `imageio-ffmpeg`; nothing needs installing system-wide. That is
deliberate — Homebrew cannot download through the corporate proxy on this machine.

## The data code

| | |
|---|---|
| Version / ECC | **3 / M**, both pinned in `src/dataQr.ts` |
| Payload | **42 bytes**, the whole bar state including both player names |
| Module | **2 CSS px** |
| Quiet zone | **2 modules** |
| Block | **66 × 66 CSS px** — 0.21% of a 1920×1080 frame |
| Position | flush into the top-left corner, inset 0 |
| Redrawn | on the 5 s poll, never per frame |

Version 3 and ECC-M are pinned rather than chosen per frame, so a payload that outgrows 42
bytes throws instead of quietly becoming a version 4 code — which would add four modules a
side and invalidate every measurement here. 42 is not arbitrary: it is exactly what v3 ECC-M
holds, 43 tips to v4, and v2 holds only 26, which is unreachable without dropping a player
name. The field table and the reasoning are in `src/dataCode.ts`.

The format is implemented twice, in `src/dataCode.ts` (writes) and `payload.py` (reads).
`src/dataCode.vectors.json`, generated from the TypeScript, is the contract between them and
`test_payload.py` checks the Python against it. A one-bit width change on either side breaks
five of its seven tests, which is the point.

### Decode with zxing-cpp, not OpenCV

`cv2.QRCodeDetector` returns a **str**, so it mangles arbitrary bytes. It recovered **0 of 60**
random 42-byte payloads byte-exactly *from perfect, uncompressed images*, while reporting a
successful detection every single time. zxing-cpp returns raw bytes and recovered 60 of 60.

This matters more than it sounds. OpenCV is the obvious choice here — the rest of this
directory is numpy and ffmpeg — and it fails by returning confident-looking garbage rather
than an error. Every QR figure quoted before this was discovered had been measuring whether
a code was *found*, not whether the payload came *back*.

### Geometry: 2 px modules is the floor, and it is not ours to move

IRL Pro renders the browser source at 1920 and upscales it smoothly to 4K. Reading across a
finder pattern in a real recording, each dark module comes back as `63 0 0 63` — **only the
middle 2 of its 4 file pixels reach full black.** The transition is a full module wide.

```
2 CSS px module = 4 file px  ->  2 px of clean centre  ->  luma separation 251/255
1 CSS px module = 2 file px  ->  no clean centre       ->  1 good frame in 12
```

1 px modules were measured at 1/6 at full bitrate and 0/6 below it, and neither a larger
quiet zone nor more ECC helps. The limit is the compositing resolution, not the QR format or
the codec, so nothing in the overlay can reach around it. A 0-module quiet zone also failed
outright; 2 is the smallest worth trusting against a spec that asks for 4.

## Why the QR path replaced it

`app.ts` dismisses an event card the moment the score changes, so a wicket followed quickly
by the next ball can be on screen for under two seconds and fall between keyframes. On the
reference match that cost **2 of 15 wickets**, unrecoverably — the information simply is not
in the file at those timestamps.

The code is in every frame, so nothing depends on catching a transient. It also carries what
a card never did: both names, both batters' scores, the bowler's figures, the partnership and
the striker, so a moment arrives with everything a caption needs instead of a colour.

## Event rules, and the cricket that shapes them

`qrscan.moments()` derives events from what changed between two payloads. Three rules exist
because of a specific way the data lies, and `test_qrscan.py` pins each one:

- **A no-ball does not advance the over.** `ballsBowled` counts *legal* balls, so a six off a
  no-ball leaves it unchanged. A new delivery is recognised from the over **or** the runs
  **or** the wickets. Without this, the `7nb` case fixed in `c455921` would be invisible here
  too, in a different disguise.
- **A batter's runs reset on dismissal.** A milestone only counts if the striker's name is
  unchanged across the pair, or 20 → 51 for the next batter in reads as a fifty.
- **The first decoded state describes a ball bowled before the recording began.** Emitting it
  cuts a clip whose window looks back past the start of the file, at footage that cannot
  contain the shot.

Nothing is trusted without the CRC. A frame that fails it is dropped, never guessed at — which
is exactly what caught the OpenCV problem above instead of letting wrong data reach a reel.

## The card palette is still a contract

`detect.py` identifies events from the 5px accent stripe, and those colours are fixed in
`src/css/overlay-base.css` and never overridden by a theme:

| Event | Stripe | | Event | Stripe |
|---|---|---|---|---|
| Wicket | `#d7263d` | | Milestone | `#ff7300` |
| Four | `#1b9e4b` | | Partnership | `#00bcd4` |
| Six | `#6d3df5` | | | |

The five are held at least 150 apart in summed-channel distance, which is what makes one
nearest-colour test enough to name the event. Recordings from before commit `3f0a282` have no
milestone or partnership stripes — those card types shared the theme's brand accent — so
older files yield only wickets and boundaries.

### One ball can raise two cards

A four that brings up a fifty shows the boundary card and then the milestone card, and
`cards.ts` plays them one at a time, so the second begins as the first retires. Cutting a clip
per card would put the same footage in the reel twice. `detect.moments()` groups them on that
gap — consecutive balls are thirty seconds or more apart, so it is unambiguous. The QR path
gets this for free, because one payload change *is* one ball.

## Clip windows, the one thing worth tuning

```python
WINDOWS = {'wicket': (-52, -8), 'six': (-20, 6), 'four': (-18, 4)}
```

Seconds relative to when the **card or code appeared**, not when the ball was bowled. The
scorer enters the ball on their own device, so the graphic always lags the action, and the lag
depends on how much typing the event needs: a six shows about 5 s late, a wicket about 35 s,
because a dismissal has more fields to fill in. Widen these if your scorer is slower.

## Lessons that cost the most

**Detection being right is not the same as the timestamp being right.** Frame times were
estimated as `chunk_start + index * 2.001`, but the real keyframe interval alternates
2.00/2.02 s, so the error reached ~18 s over a 1875 s chunk. Detection looked perfect while
every clip was silently mis-cut. Both scanners now use 90 s chunks, because each chunk's start
is exact and the error cannot accumulate.

**A test that cannot fail is not testing anything.** Four separate harness faults in this
directory each made results look better or worse than reality, and every one was found by
deliberately pushing until something broke rather than by reading a green result:

| Fault | Symptom |
|---|---|
| Inverted polarity in 2-level mode | all 361 modules "wrong" — looked like a codec failure |
| The code never changed across the clip | h264 propagated it losslessly; everything passed |
| `detectAndDecode` scored detection as decoding | mis-decodes counted as successes |
| Python `qrcode` inflates binary payloads | 42 random bytes became a **v14** code, 73 modules instead of 29 |

The last one is worth repeating: the Python `qrcode` library does not encode arbitrary bytes
efficiently even in explicit byte mode. Any bench must generate matrices with the **same npm
encoder the overlay ships**, or it is measuring a code two and a half times bigger than the
one that gets drawn.

**Only redraw when the data changes.** The overlay survives 0.03 bits/pixel because it is
static — h264 codes it as unchanged and spends the bitrate on the grass. The `sequence` field
is part of the payload, so comparing whole payloads made every frame look new and defeated the
check entirely; it now compares the cricket data with the sequence zeroed.

## Known limits

- **Recordings without `?data=1` fall back to the stripes**, with the missed-card problem
  above. There is no way to recover those events after the fact.
- **`ballsBowled` counts legal balls**, because overs is all CricClubs publishes. With
  `innings` alongside it that still identifies a ball uniquely, but it is not a delivery count.
- **The block is visible** in anything uploaded whole. A 9:16 crop keeps a centre column about
  32% of the frame width so it is gone for free in every reel, and one `drawbox` in `cut.py`
  covers it for the 16:9 game video at no cost since every clip is re-encoded anyway. At inset
  0 a plain `crop` removes it without having to find it first.
- **Reading back from YouTube is untested.** That would be a second generation of compression;
  every measurement here is against the local file.
- **The recording profile matters.** These numbers assume the browser source rendered
  full-frame at 1920 and upscaled ~2× into 4K. A 720p recording downscales it instead, which
  would put a 2 px module below 2 file px.

## Verified against

**`20260921_170030_01.mp4`** — 3840×2160, **13.89 Mb/s**, IRL Pro on the match rig, 66 px
code. **55 of 55** sampled frames decoded byte-exact with the CRC passing. `qrscan.py` read
13 of 13 keyframes and produced the expected six and wicket from the replay fixtures. A
14.96 Mb/s capture at the 148 px geometry also went 55 of 55.

Bench sweeps over real match footage, byte-exact via zxing-cpp, at the frame's 0,0 corner:
every combination of quiet zone {4, 2, 1} × module {4, 3, 2} decoded 6/6 at 14.65, 3 and
1 Mb/s. 1 px failed as described above.

**`Topguns vs Bazzigarz - 2026 FTP20 Div-A.mp4`** — 3840×2160 at 59.52 fps, 4 h 10 m, 26 GB,
topguns-light, no data code. Stripe detection found **14 wickets, 9 sixes, 21 fours in 53
seconds**, with the bar located automatically at x=740 y=1900 2389×204 and the stripe column
at x=1528, matching a hand measurement. Fifteen wickets actually fell. Spot-checked frame by
frame: the wicket at 66:34 reads "WICKET, Yeswanth V, c Hemanth B b Ankit K, 34 (32)" with the
score turning to 88/3; the six at 63:38 sits at 86/2; the four at 15:57 at 5/0. Detected times
land within 1.5 s of the card appearing, and card durations come out at exactly 8 s and 2 s,
matching `HOLD_MS` in `src/cards.ts` — a useful independent check that the classifier reads
the real thing.

Recordings and reels are gitignored; this repo is public.
