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

A four that brings up a fifty shows the boundary card and then the milestone card (and a wicket
that completes a five-wicket haul shows the wicket and then a milestone card), and
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

### 6b. 🛑 The lag is the SCORER's, not cricket's — measure it every match

The windows are relative to the state change, and the state changes when the **scorer
enters the ball**, not when it is bowled. That delay is a property of the person scoring:

| Match | Boundary entered after the shot |
|---|---|
| reference (`Topguns vs Bazzigarz`) | **~5 s** |
| `vs ATX Panthers`, innings 1 | median **10.7 s**, range **2-40 s** |
| `vs ATX Panthers`, innings 2 | median **8.6 s**, range **2-45 s** |

🛑 **A single measured lag is not a match constant.** "19 s on `vs ATX Panthers`" was one
ball, and it became a fixed `--lag-bat 19` that was right for that ball and wrong for the
rest: the spread within one innings is 2-40 s, sd 7.4 s. Measuring one ball and generalising
is what §6c exists to replace — prefer `--align`, and keep `--lag-bat`/`--lag-bowl` for a
match whose video is too dark or too hand-held for motion detection.

⚠ **A window built for 5 s lands entirely in the aftermath at 19 s.** The first pass on
`vs ATX Panthers` cut 22 s clips with `four: (-18, +4)`; every one of them held the batters
talking and the crowd cheering, and none of them held the shot. The reels looked completely
fine — right length, right crop, real cricket, no error anywhere.

`windows_for(lag_bat, lag_bowl, lead, trail)` derives the windows instead: the shot sits at
`-lag`, so keeping `lead` before and `trail` after gives a clip centred on the action.
`reels.py --lag-bat 19 --lag-bowl <n>` cut one batter's reel from **308 s to 70 s** and put
the delivery in every clip.

⚠ **This scorer entered balls in bursts**, so the lag is not perfectly constant — at the
shot the overlay still read a state from 19 s earlier. A 5 s clip is therefore only as good
as the lag's consistency; widen `trail` before `lead`, because the run-up is predictable
and the aftermath is not.

#### How to measure it

1. Pick a boundary in `events.json` and note its `t` — that is the entry time.
2. Scrub the recording back from `t` to where the bat meets the ball.
3. `lag = t - shot`. Repeat for a wicket; dismissals take longer to enter.

🛑 **Do not try to find the shot from the audio.** Bat on ball was attempted with a
highpass-plus-onset detector: after restricting the search it looked convincing —
median −7.7 s, 18/18 in a plausible range, sd 2.8 s — and it was wrong. Checking the frames
at each detected onset showed between-ball moments every time. The DJI mic sits closer to
the spectators than to the bat, so the detector locks onto chatter and applause. The
statistics looked like a result; the pixels said otherwise.

### 6c. ✅ `--align`: find the delivery in the video, don't guess the lag

🛑 **This is the right way, and the only one that survived a reel-by-reel review.** No fixed
lag can work when the scorer's own lag spreads 2-40 s inside one innings. `deliveries.py`
finds the balls independently in the video and aligns the two sequences — the k-th ball
bowled is the k-th ball entered, which is the one thing that always holds.

The camera is on a tripod, so a frame difference over the pitch is almost entirely players
moving. A delivery is a **rise out of a still field**, and the alignment is a monotonic
dynamic program over (entry k -> delivery j). `reels.py --align` needs no lag argument.

#### 🛑 The onset, never the peak

The first version took the strongest motion peak per ball. It read beautifully — 122/144
balls aligned, 29/29 boundaries, 0.0 s against the hand-measured ball — and it put one of
one batter's two fours **nine seconds late**, showing the batters walking after the ball had
gone. A boundary makes **two** humps, and on a four the second is the bigger one:

```
2235-2239   2.3-3.6   field set, nobody moving
2240-2244   6.0-8.7   run-up, shot             <- the delivery,  peak 8.65
2245-2270   5.8-10.2  chase, throw back, crowd <- the aftermath, peak 9.49  (it won)
```

Worse, suppressing peaks within a `MIN_GAP` then *discarded* the delivery in favour of the
aftermath, so the right answer was not on the candidate list at all. That is why tuning
could not fix it: every configuration tried pinned that ball at a 5.3 s lag, stably, because
nothing better was available. ⚠ **A stable wrong answer is not evidence of a good model** —
it took frame-level measurement of three balls to see the detector had the wrong target.

The rising edge has no such failure mode. It is the bowler starting his run-up, it looks the
same whether the ball goes to the fence or to cover, and it sits a measured **0.75 s** before
bat on ball. Each local maximum is walked back to where its rise covered `RISE_FRAC` of the
way up from the quiet before it; same-burst onsets merge, and the group keeps the onset of
its **strongest** peak — ⚠ not its earliest, which re-broke the same ball when a small bump
4 s earlier swallowed the real onset.

Measured against three balls found frame by frame, 200 s apart:

| ball | delivery stride | shot (measured) | aligner | error |
|---|---|---|---|---|
| four #1 | 2168 | 2169.7 | 2169.5 | **-0.22 s** |
| four #2  (the disputed one) | 2240 | 2241.7 | 2241.7 | **+0.03 s** |
| ground truth | 2378 | 2379.3 | 2379.5 | **+0.18 s** |

The delivery stride is 1 s before the shot in all three, and the smoothed motion curve reads
5.8-6.1 at the moment of contact — within 0.3 across balls three minutes apart.

Coverage on `vs ATX Panthers`: **135/144** balls in innings 1, **73/79** in innings 2, and
**39/39** of the moments that actually feed a reel.

#### ✅ An outlying lag is the tell for a mis-alignment

⚠ **The extreme tail of the lag distribution is where it fails.** Thirteen predicted instants
were checked as frames, chosen to span the lag range rather than sampled uniformly:

| verified | lags | what the frames show |
|---|---|---|
| good | 2.2-25.4 s | the bat coming through the ball (two a second or two late) |
| **bad** | **39.6 s**, **45.3 s** | a still field; an empty pitch |

Both failures were the **largest lag in their innings** and nothing else was. `shot_times()`
therefore drops a ball whose lag exceeds `median + 4 x MAD`, floored at
`LAG_OUTLIER_FLOOR = 30 s` — the floor matters, because the MAD of a tight distribution is
small enough that a uniformly slow scorer would otherwise be discarded wholesale. On
`vs ATX Panthers` it removes 1 ball from innings 1 and 3 from innings 2, including the empty
pitch that was in a wicket reel. `--keep-suspect` turns it off.

🛑 **A clip cut from a wrong match is worse than a missing clip.** That is the whole ordering
this module is built around, and it is why the guard drops rather than warns.

⚠ **This rests on two confirmed cases.** Re-check the threshold once a second match has been
reviewed reel by reel — and keep reviewing, because the guard catches the failure mode that
has been *seen*, not every one that exists.

⚠ **`pitch_crop()` is a per-match input, like the reel crop.** It spans 31-76% of the width
because the camera sat at 39-66% in one innings and 41-63% in the other. A differently framed
match needs it re-measured; being generous costs only noise, because candidates are weighed
by strength.

### 6d. 🛑 The second innings needed more than a good detector

The onset detector was verified on three **innings-1** balls and it is right there. It was not
right in innings 2: a wicket landed **4.5 s late**, on a burst 5 s after the real delivery.
Frame by frame, the delivery stride is at 10728 and bat on ball at 10729.3; the burst the
aligner chose at 10733-10736 is the batter walking off and the fielders gathering.

⚠ **The camera is repositioned at the innings break.** The motion centroid sits at 47-55% of
the width in every 5-over block of both innings — so the **bowling end swapping every 5 overs
does not move the action in frame**, because the camera is side-on and both ends sit either
side of the same centre. What does change is the vertical framing between innings (centroid
y 68% -> 62%): the second innings is framed tighter, so players walking fill more of the frame
and an aftermath burst out-peaks a delivery more easily.
🛑 A match shot from **behind the bowler's arm** would behave differently — there the end swap
would move the action, and `pitch_crop()` would have to cover both ends. Check this before
trusting `--align` on differently-filmed footage.

#### Every global lever failed, and one of them was a trap

Both candidates were in the list. The decoy was simply the stronger burst, 10.64 against 7.87.
None of these moved it:

| lever | result |
|---|---|
| peak height (shipped) | +4.5 s |
| contrast over `BACKTRACK` | +4.5 s — the decoy reaches back *past* the delivery and claims the same quiet as its own trough |
| contrast against the local level | +4.5 s |
| quietness alone | +13.7 s, and it broke innings 1 |
| `STRENGTH` halved | +4.5 s |
| `SMOOTH` from 0.5 down to 0 | +4.5 s, and `SMOOTH = 0` broke innings 1 |

🛑 **`SMOOTH` is the trap.** Lowering it looks like the obvious fix and is exactly wrong: that
ball's true lag is 23 s against its neighbour's 8 s, so a smoothness prior *actively prefers*
the decoy. The scorer's lag is bursty, so smoothness is a weak prior — but raising or removing
it costs innings-1 accuracy, so it stays at 0.5.

#### ✅ What worked: the field before the onset

The two are trivially separable on a fact the cost model never used.

| | onset | field in the 2.5 s before |
|---|---|---|
| real delivery | 10727.75 | **4.34** — set, still |
| aftermath | 10733.00 | **6.29+** — previous ball still unwinding |

`snap_to_quiet()` walks back up to `SNAP_WINDOW` from the chosen candidate for one preceded by
a still field. It fixed the wicket (+4.5 s -> **-0.8 s**), left all three innings-1 balls
untouched, and is stable for `QUIET_FRAC` 0.8-1.1. It moved 5 of 73 matches in innings 2.

`drop_busy_preceded()` is the second line: when the snap finds nothing still-preceded, the
match probably is not on a delivery at all. At `SUSPECT_PRE_FRAC = 1.35` it removed two wicket
clips showing fielders milling with no batter at the crease, kept all five showing the bowler
delivering, and cost 8 balls in innings 1 and 3 in innings 2.

#### 🛑 Still not clean — review the bowling reels

Of eight predicted wicket deliveries checked as frames: **five clearly show the delivery, two
were wrong and are now dropped, and one remains wrong**. That third one has a pre-onset level
of 5.22, *below* the innings median, so neither guard can see it and its lag is unremarkable.
Batting reels (innings 1) are in much better shape than bowling reels (innings 2) — three
measured balls at ±0.25 s and six of nine blind checks good. **Watch the bowling reels before
publishing.**

### 6e. 🛑 Widening a clip to cover doubt was tried and is WORSE — keep them tight

**Reverted after a second reel-by-reel review.** The reasoning below was sound and the
measurement supported it — 8 of 8 hand-measured deliveries landed inside their clip, against
5 of 8 for the tight cut — and it was still the wrong trade. Watching the result found three
distinct new failures that no coverage metric sees:

| widened clip | what it actually showed |
|---|---|
| 28 s | the **previous batter** playing the ball before |
| 52 s | a **different bowler's** over entirely |
| 27 s | the delivery at **0:22 of 0:27** — read as "missing the boundary" |

🛑 **A clip showing the wrong player is worse than an absent clip**, and 22 s of dead lead-in
followed by a cut 5 s after contact is worse than a short reel. The metric said the shot was
in the clip; the viewer said the clip was about someone else. ⚠ Coverage of the right
*instant* is not coverage of the right *ball* — a wide window spans neighbouring deliveries,
and the neighbours belong to other players.

Tight 8 s clips are the default again, and a ball with no confident delivery is **omitted**.
`--widen` keeps the widening behaviour for review passes, where seeing more matters more than
seeing the right person.

⚠ **An "omit anything ambiguous" rule was priced and rejected**: it removes 15 of 35 reel
clips and takes three verified-correct boundaries with it, to catch three verified-wrong ones.

#### What survived the revert

Three changes from that round are unambiguous wins, because none of them lengthens a clip:

- `prefer_cluster_start()` — moved 8 reel balls 9-15 s earlier, and made a wicket that had
  been missing entirely land exactly right. The reels confirmed good beforehand were untouched.
- `dedupe_moments()` — §6f.
- `combine_all_rounders()` — §13aa.

#### The original reasoning, kept because the measurement stands

##### Superseded: clip width should carry the uncertainty


🛑 **Dropping a doubtful clip was wrong, and the reel-by-reel review proved it.** The tight
8 s aligned cut was *worse* for bowling than the old fixed-lag cut it replaced, and the reason
is embarrassing once measured:

| cut | seconds per clip |
|---|---|
| pre-alignment, batting | 22.0 (`-18…+4`) |
| pre-alignment, bowling | 44.0 (`-40…+4`) |
| aligned | 8.0 |

A 44 s wicket clip starting 40 s before the entry brackets almost any lag and therefore
**cannot miss**. It was never a better estimate — it was a wider net. So the thing worth
keeping from it is not its timing but its width, as a fallback.

Each ball now gets the narrowest clip its own evidence supports:

| evidence | clip |
|---|---|
| one candidate clearly the delivery | **8 s** |
| rival candidates that no rule separates | span them (`AMBIGUITY_WINDOW`, ~20-28 s) |
| onset follows a busy field | span widened |
| scorer stalled **and** the alignment is implausible for it | measured from the entry, `STALL_LEAD` |
| no candidate at all | `FALLBACK_LEAD_BAT` / `FALLBACK_LEAD_BOWL` from the entry |

Result on `vs ATX Panthers`: **8 of 8 hand-measured deliveries inside their clip**, 19 of 39
reel clips still tight at 8 s, median 18.2 s.

#### What the failures had in common

Every mis-aligned clip in the review had an abnormally **small** lag — the aligner had locked
onto a burst *after* the ball. Never once was it too early.

| reviewed as | lag |
|---|---|
| good | 11.8, 26.1, 23.9, 8.7, 6.1 s |
| **wrong** | **5.1, 7.3, 4.3, 4.0, 7.8 s** |

⚠ But a small lag is not itself a fault — 8.7 s and 6.1 s balls were verified correct, so a
blanket small-lag penalty breaks as much as it fixes. It only becomes a signal in combination:
`prefer_cluster_start()` moves a match to the first burst of its cluster, and a stall only
widens when the lag is *also* below the innings median.

#### 🛑 The hardest case: a delivery that was never detected

One wicket had a **46.7 s** lag and its delivery was not among the motion candidates at all —
the nearest were 15 s early and 11 s late. No span, no cluster rule and no threshold can
recover a ball the detector never saw; only a window measured from the scorer's entry can, and
it has to reach past 50 s. Its one distinguishing feature was that the previous ball was
entered 65.8 s earlier — the scorer had stalled.

⚠ **Adaptive thresholds, not fractions of the median.** `QUIET_FRAC` and `SUSPECT_PRE_FRAC`
as fractions of the curve median are nearly inert in the second innings, where tighter framing
lifts every level: real deliveries measured 4.89-5.67 against a 4.84 threshold, so nearly
every ball read as doubtful and got widened for nothing. `STILL_PCT`/`BUSY_PCT` take
percentiles of the innings' own pre-onset distribution instead.

### 6g. ✅ Hand-measured overrides, for the balls the video cannot place

Some balls cannot be located from the video and no tuning will change that. `--overrides`
takes a per-match JSON of shot times read frame by frame, keyed on the payload **entry** time
(stable, because it comes from the scorecard rather than the video):

```json
{"shots": {"8862.4": 8836.5}, "drop": [13650.5]}
```

The four that needed it on `vs ATX Panthers`, with the lag each one actually had:

| entry | aligner | measured | lag | why the aligner could not get it |
|---|---|---|---|---|
| 8862.4 | 8847.5 | **8836.5** | 25.9 s | the true burst is 11 s further back than `CLUSTER_GAP` reaches |
| 11342.0 | *omitted* | **11315.5** | 26.5 s | dropped by the guards |
| 13074.2 | 13070.2 | **13027.5** | 46.7 s | **the delivery was never among the motion candidates** |
| 13650.5 | 13639.5 | **13510.5** | 140.0 s | a 240 s scorer stall; the aligner's estimate lands on the *next* bowler's over |
| 6816.6 | *omitted* | **6807.3** | 9.3 s | the aligner had the **previous** ball; the neighbours all lag 4.6-8.1 s |
| 14618.3 | *omitted* | **14539.3** | 79.0 s | a retraction `dedupe_moments()` cannot catch — see below |

🛑 **Not every retraction is a duplicate.** The last one above was entered promptly as a dot
(ov 10.4, `out=0`) at 14542.4 — only **3.1 s** after the ball — then walked back to ov 10.3 and
re-entered as a *wicket* at 14618.3. `dedupe_moments()` cannot see it, because the corrected
event genuinely differs: the wicket count changed, so the signature is not identical. Only the
**timestamp** is wrong. ⚠ When a ball's outcome is corrected rather than merely re-entered,
the event is real and its time is 60-80 s late, which looks exactly like a slow scorer.

⚠ **A lag that is implausible against the wicket entry can be ordinary against the ball's
first entry.** 79 s looks like a mis-alignment until you notice the same ball was logged 3.1 s
after it was bowled. Check whether an earlier state covers the same ball before concluding the
scorer was slow.

🛑 **Never populate this from the aligner's own output.** An override that agrees with the
estimate is noise; one that is itself estimated is worse than the estimate it replaces. Each
line above was read as frames — run-up, delivery stride, ball in flight, bat on ball — and the
file records what was seen, with the reasoning, in a `measured` block beside the numbers.

⚠ **The aftermath is easy to mistake for the shot when measuring by hand.** An earlier reading
put one of these at 11321; the frames show 11315 is the stroke, 11318 the follow-through and
11321 the batters already crossing. Measure the *stroke*, not the reaction.

`drop` removes a moment outright — for an event the video cannot support, or one the scorer
attributed to the wrong player (§6f).

### 6f. 🛑 A scorer retraction produces the SAME event twice

A retracted-and-re-entered ball emits a second, identical moment carrying the **re-entry's**
timestamp:

```
9080.7  213/3  10(5)   boundary entered
9098.1  209/3   6(4)   retracted
9118.2  213/3  10(5)   re-entered, outcome "4"   <- second moment, 256 s after the ball
```

Its clip showed a different player getting out. There were **18 retraction events** in this
match, and two produced duplicate moments. `dedupe_moments()` keeps the earliest of any
identical `(innings, ball, striker, strikerScore, score, outcome)`.

⚠ **An independent check catches this without the state trace**: a batter credited with three
fours whose figures read `10 (5)`. Three fours is 12 runs. When a reel's clip count disagrees
with the player's own boundary count, suspect a duplicate before suspecting the timing.

#### 🛑 A third retraction shape: the same ball re-entered with a DIFFERENT outcome

A boundary was entered as a plain four, then retracted and re-entered as a **no-ball**
boundary. `dedupe_moments()` cannot see it, because the ball number, the score and the outcome
all differ — only `strikerScore` matches:

```
7622.5  balls=90  runs=180  striker=100(50)  fours=13  out=4     original
7666.1  balls=89  runs=176  striker=96(49)   fours=12  out=2     retracted
7670.2  balls=89  runs=181  striker=100(50)  fours=13  out=12    re-entered as 4nb
```

`strikerFours` reads **13 after both**, so it is one boundary. The reel had 14 clips for 13
fours, one of them a duplicate of another.

✅ **The caption is what caught it.** The title said *14 fours* (from the moment count) while
the description said *13 fours* (from the scorecard), and the clip list ran `15.0 ov` before
`14.5 ov` — a no-ball does not advance `ballsBowled`, so a correction can land out of
sequence. ⚠ **Whenever a reel's clip count disagrees with the player's own boundary count,
suspect a duplicate before suspecting the timing**, and read the over numbers for monotonicity.
Neither check needs the video.

There is no automatic fix for this shape yet: matching on `strikerScore` alone would collapse
two genuinely different balls that happen to leave a batter on the same score. It is handled
per match through the override file's `drop` list (§6g).

⚠ **Bowler attribution is separately unreliable.** In one over the payload named two different
bowlers for the same ball, and one bowler's four wickets span 28 minutes while their figures
read 2.1 overs. That is the scorer's data, not a clip-timing fault, and `--align` cannot fix
it — a reel can contain the right ball attributed to the wrong bowler.

### 6a. ✅ The overlay is its own witness: verify a clip before publishing it

🛑 **"The cut succeeded" and "the shot is in the clip" are separate claims.** A clip that
misses the ball looks perfectly fine — right length, right crop, real cricket, no error
anywhere. Extracting one mid-clip frame proves only that the video is not black.

🛑 **But do not check that the score changed inside the window — that check cannot fail.**
The window is `[t-a, t+b]` around the state change, so `t` is inside it by construction and
the delta is always there. On `vs ATX Panthers` this reported "28/28 clips confirmed" for
reels that contained no shots at all. It was a tautology wearing the clothes of a
verification.

What the score *can* confirm is a clip cut around a KNOWN event time, as in the worked
example below, where the window was chosen independently of the score. For per-player reels
the only sound check is the lag measurement in §6b plus looking at a frame near the expected
shot.

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

### 13aa. 🛑 One player, two roles — attributed separately, then combined on purpose

Moments are attributed by **(player, role)**, and the role is in the filename —
`v-kohli-batting.mp4`, `v-kohli-bowling.mp4`, `v-kohli-allrounder.mp4`.

🛑 **The attribution key must stay (player, role).** Keyed by name alone, an all-rounder who
hit a four and later took a wicket got one reel whose caption helpers all read the role off
the *first* moment — captioned with batting figures while containing a wicket. Pinned by
`test_an_all_rounder_gets_one_reel_per_role`.

✅ **Combining the two reels afterwards is a different thing, and is now the default.**
`combine_all_rounders()` merges the two moment lists in time order into one `(player, 'all')`
reel, captioned with both sets of figures — `"A. Player 7 (4) & 4/10 (2.1 ov)"`. Every moment
keeps its own `_role`, so clip widths and commentary lines stay role-correct; the bug above
was never about one file, it was about reading one role off a mixed list.

⚠ **The combined reel takes the batting crop**, because a single file can only have one and
the per-role crop below cannot apply to both halves. `--split-roles` restores two reels when
the crops matter more than having one file.

### 13aaa. ✅ Captions are written to the ig-caption-writer rules

The first captions were a scorecard line plus a data dump, and read as generated. They now
follow the `instagram-skills` bundle (installed at `~/.claude/skills/instagram-skills`):

| rule | where it lives |
|---|---|
| hook inside **125 chars**, standing alone | `hook()` |
| a real number in the hook, never an adjective | `hook()` |
| **one** call to action, no engagement bait | `cta()` |
| **3-5 sized** hashtags: 2 niche, 1-2 mid, at most 1 broad | `hashtags()` |
| em dashes under about 1 per 100 words | `ball_line()` uses parentheses |
| no `leverage`, `unlock`, `elevate`, `game-changer`, `dive in` | tested |

🛑 **Instagram hides everything past ~125 characters.** `hook()` builds that line from a fact
already in the scorecard — a strike rate, a consecutive-ball streak, a bowler hit repeatedly,
a wicket in the first two overs — and falls through a list of shapes until one fits the limit.
⚠ Every shape is written **without pronouns**: the payload carries names, never anyone's
pronouns, so a hook that reaches for one would be guessing.

⚠ **The ball-by-ball list sits below the call to action.** Instagram truncates at the fold so
it costs nothing there, while YouTube shows it in full. One description serves both
publishers, so it is written for the harsher of the two.

⚠ **`#Shorts` makes six tags, not five.** It is a YouTube discovery token and means nothing on
Instagram, but the same description feeds both. Pass `--hashtags` with four to land on five
total if a strict set matters.

⚠ **The hashtag tiers are judgment calls.** A tag's real post count is only visible in the
Instagram app, so check the two niche tags there before leaning on them. All nine reels from
one match share three tags, which is legitimate for one fixture but should rotate between
matches — identical sets across many posts read as automated.

✅ **`--captions-only` rewrites the sidecars without re-encoding.** Iterating on wording
otherwise costs a full re-cut of every reel.

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
