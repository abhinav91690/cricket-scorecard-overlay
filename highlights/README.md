# highlights

Finds the interesting moments in a match recording and cuts a reel, locally, with no
cloud service and no live event log.

## Why this works

The overlay is **burnt into the recording**. IRL Pro composites the browser source
into the file, so the score, the ball strip and every event card are already in the
pixels. There is nothing to synchronise: the frame position *is* the timestamp.

And the overlay labels its own events by colour. Every event card carries a 5px accent
stripe down its left edge, and those colours are fixed in `src/css/overlay-base.css`
and never overridden by a theme:

| Event | Stripe |
|---|---|
| Wicket | `#d7263d` |
| Four | `#1b9e4b` |
| Six | `#6d3df5` |

So detection is a colour test on a narrow full-height band. No OCR, no model.

## Use

```sh
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

.venv/bin/python detect.py "/path/match.mp4" -o events.json
.venv/bin/python cut.py   "/path/match.mp4" events.json -o reel.mp4
.venv/bin/python cut.py   "/path/match.mp4" events.json -o wickets.mp4 -t wicket
```

`detect.py` decodes keyframes only, so a 4-hour 4K file scans in about 40 seconds on
8 cores. `cut.py` re-encodes to 1080p with the Apple hardware encoder and writes a
chapter list next to the reel.

ffmpeg ships inside `imageio-ffmpeg`; nothing needs installing system-wide. That is
deliberate, since Homebrew cannot download through the corporate proxy on this machine.

## Geometry is detected, not assumed

These apps let the operator place and size the browser source anywhere, so the overlay
is in a different spot in every recording. `calibrate()` samples frames across the
match and finds the column where narrow full-height stripe-coloured bands keep
recurring, which is the card's left edge. Events happen dozens of times a match, so
that column stands out. Pass `--region x,y,w,h` to skip it.

## Clip windows, the one thing worth tuning

Windows in `cut.py` are relative to when the **card appeared**, not when the ball was
bowled. The scorer types the ball into CricClubs on their own device, so the card
always lags the action, and the lag depends on how much typing the event needs.

Measured on a real LPCL recording:

| Event | Lag behind the ball |
|---|---|
| Six | about 5 s |
| Wicket | about 35 s |

A dismissal has more fields to fill in than a boundary, which is why the wicket window
starts 52 seconds before the card and ends 8 seconds before it. If your scorer is
slower, widen them. Because the lag varies per ball, some clips are better centred
than others; the windows are deliberately generous rather than tight.

## Frame timing, the bug that cost the most

Frame times come from `chunk_start + index * keyframe_interval`. The interval is not
constant: on this recording it alternates between 2.00s and 2.02s. Estimating over a
long chunk therefore drifts, and on a 1875s chunk the error reached about 18 seconds,
which silently mis-cut every clip. `scan()` now uses 90s chunks so the error cannot
accumulate past a fraction of a second, since each chunk start is exact.

If you change the chunk length, re-verify a known event against a rendered frame.
Detection being right is not the same as the timestamp being right.

## Known limits

- **Milestones and partnerships are invisible.** Their stripe uses the theme's brand
  accent, which in topguns-light is the same turquoise as the team block 30px away.
  Giving those card types their own palette colour would make them detectable with no
  change here.
- **Some wickets are missed.** On the 2026-09-20 Topguns match it found 13 of the 15
  that fell. The golden rule in `app.ts` dismisses a card the moment the score
  changes, so a wicket followed quickly by the next ball can be on screen for under
  two seconds and fall between keyframes.
- **Keyframe interval sets the floor.** Boundary cards hold 2.0s plus a 0.3s
  transition. If a recording has keyframes further apart than that, boundaries will be
  missed; `detect.py` measures and reports the interval.
- Detection needs the standard ball palette. A fork that re-themes those five colours
  breaks it.

## Verified against

`Topguns vs Bazzigarz - 2026 FTP20 Div-A.mp4`, 3840x2160 at 59.52 fps, 4 h 10 m, 26 GB,
IRL Pro on Android, topguns-light theme, browser source at 1920x1080 upscaled 2x.

Found **14 wickets, 9 sixes, 21 fours in 53 seconds**, with the scorebar located
automatically at x=740 y=1900 2389x204 and the stripe column at x=1528, which matches a
hand measurement of the same frame.

Fifteen wickets actually fell (7 and 8), so 14 of 15 were found. Spot-checked frame by
frame: the wicket at 66:34 reads "WICKET, Yeswanth V, c Hemanth B b Ankit K, 34 (32)"
with the score turning to 88/3; the six at 63:38 sits at 86/2; the four at 15:57 at 5/0.
Detected times land within 1.5s of the card actually appearing. Card durations come out
at exactly 8s and 2s, matching `HOLD_MS` in `src/cards.ts`, which is a useful
independent check that the classifier reads the real thing.

Recordings and reels are gitignored; this repo is public.
