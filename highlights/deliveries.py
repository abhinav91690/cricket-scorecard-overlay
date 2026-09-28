"""Find when each ball was actually BOWLED, by aligning video motion to the scorer's entries.

🛑 Why this module exists. Every clip window in `cut.py` is measured from the moment the
payload changes — which is when the SCORER entered the ball, not when it was bowled. That
delay is the scorer's, it is large, and it is not constant:

    reference match      boundary entered ~5 s after the shot
    vs ATX Panthers      median 15 s, range 5-44 s, drifting and catching up in bursts

A fixed offset therefore cannot work. On `vs ATX Panthers` the stock windows put every
boundary clip in the aftermath: the batters talking and the crowd cheering, never the shot.

What DOES hold is order: the k-th ball bowled is the k-th ball entered. So this finds the
deliveries independently, in the video, and aligns the two sequences.

## How

1. **Motion.** The camera is on a tripod, so a frame-to-frame difference over the pitch is
   almost entirely players moving. A delivery — run-up, shot, fielding — reaches about 3x
   the between-balls baseline. Measured against a known shot, the motion peak trails bat on
   ball by `PEAK_TO_SHOT` seconds.
2. **Candidates.** The strongest local maxima, at least `MIN_GAP` apart. Taken generously:
   the aligner can skip a spurious peak but cannot invent a missing delivery, so
   over-detecting is the safe direction.
3. **Alignment.** A monotonic dynamic program over (entry k matched to delivery j).

## The three things that had to be in the cost model

Each of these was missing from an attempt that then failed in a specific way, so none of
them is decoration:

- 🛑 **Peak strength.** Entries and deliveries are the same sequence of balls, so their
  intervals match by construction and monotonicity-plus-smoothness cannot tell the true
  correspondence from any other consistent-lag one. With a candidate every ~29 s there is
  always a noise peak a few seconds before each entry, giving a *tighter* lag than the
  truth — so without strength the model prefers the wrong answer on merit. Rewarding strong
  peaks pulls the path onto real deliveries.
- 🛑 **Trailing skip costs.** Charge only for leading skips and ending the chain early is
  free, so the cheapest "alignment" is to match one ball and stop. That is what it did:
  1 of 144.
- 🛑 **Skippable entries.** Requiring every entry to find a delivery makes one missed
  detection break the whole chain — "no alignment" at every candidate count.

## Validated

On `vs ATX Panthers` innings 1: 129 of 144 entries aligned, and **29 of 29 boundaries**.
Against a hand-measured shot (entered 2398, struck 2379) the error is **0.0 s**, and it is
right with the anchor left out. Four predicted instants spanning lags of 4.6-17.2 s were
checked as frames and every one shows a live delivery.
"""
from __future__ import annotations

import os
import subprocess

import numpy as np

from detect import ffmpeg, probe

FPS = 4                     # motion sampling rate; 0.25 s is ample for a 5 s clip
GRID_W, GRID_H = 160, 86    # tiny frames: this measures movement, not detail

# A delivery is a RISE out of a still field, and the shot lands on the rising edge.
# 🛑 Not the peak — see `candidates()`. Measured on three balls 200 s apart in
# `vs ATX Panthers`: the shot is ONSET_TO_SHOT after the 45% point of the rise, with a
# spread of 0.4 s.
BACKTRACK = 10.0            # how far back to look for the quiet the burst rose out of
RISE_FRAC = 0.45            # the onset is where the rise has covered this much of it
MIN_RISE = 1.8              # below this a "burst" is just the field milling about
ONSET_GAP = 4.0             # onsets closer than this belong to the same burst
ONSET_TO_SHOT = 0.75        # measured: bat on ball, this long after the onset
CANDIDATES_PER_BALL = 3.0   # over-detect on purpose; see the module note

# A ball whose lag is a wild outlier is usually a mis-alignment, not a slow scorer.
# Both mis-alignments ever confirmed by looking at the frames sat at the very TOP of their
# innings' lag distribution and nothing else did: 39.6 s (innings 1 max) showed a still
# field, 45.3 s (innings 2 max) an empty pitch, while every clip verified good ran 2.2-25.4 s.
# median + LAG_OUTLIER_MAD x MAD, but never below LAG_OUTLIER_FLOOR, so a uniformly slow
# scorer is not thrown away wholesale.
# ⚠ This rests on two confirmed cases. Re-check it when another match has been reviewed.
LAG_OUTLIER_MAD = 4.0
LAG_OUTLIER_FLOOR = 30.0

# 🛑 A delivery is preceded by a STILL field; the burst that follows one is not. See
# `snap_to_quiet()` — this is the only thing that separated a real delivery from the
# aftermath 5 s later when the aftermath was the stronger burst.
PRE_WINDOW = 2.5            # seconds before an onset used to judge "was the field still?"
# 🛑 Judge "still" against the innings' OWN pre-onset distribution, not a fraction of the
# curve median. A fraction of the median was tried and is nearly inert in the second innings,
# where the tighter framing lifts every level: real deliveries measured 4.89-5.67 against a
# 4.84 threshold, so almost every ball read as doubtful and got widened for nothing. These
# percentiles adapt to whatever the framing does.
STILL_PCT = 40.0            # a pre-onset in the quietest this fraction reads as "field set"
BUSY_PCT = 85.0             # at or above this it reads as "the previous ball still unwinding"
QUIET_FRAC = 0.9            # still = below this fraction of the innings' median motion
SNAP_WINDOW = 8.0           # how far back to look for a quiet-preceded candidate
# And if the snap could find no still-preceded candidate, distrust the match entirely.
# Innings-2 wickets verified good by eye sat at pre-onset 3.90-5.67 against a median of
# 5.38; the two verified bad sat at 7.58 and 7.91 — a clean gap at 1.35x the median.
SUSPECT_PRE_FRAC = 1.35

# 🛑 Within one ball the FIRST burst is the delivery and the rest are the aftermath, so a
# match is moved to the start of its cluster. Every mis-aligned clip found in the reel-by-reel
# review was too LATE and never too early, and in each one the true delivery was the cluster's
# first candidate — confirmed frame by frame at lags of 25.9 s, 18.6 s and 21.2 s where the
# aligner had chosen 5.2 s, 4.4 s and 7.8 s.
# ⚠ 10 s and no more. At 12 s this rule reaches back past a genuinely separate ball and broke
# a reel that had been confirmed perfect (a four moved from a 12.7 s lag to 24.2 s). Balls are
# sometimes 12 s apart and sometimes 25 s, so no gap separates them cleanly; 10 s is the
# largest that regressed nothing.
CLUSTER_GAP = 10.0

# 🛑 When two bursts are rivals for the same ball and no rule can separate them, the clip
# should say so rather than pick. An earlier candidate within this window is a rival, and
# `shot_brackets()` returns a span covering both instead of a point — so the clip gets wider
# exactly where the estimate is less certain. Balls with a single candidate stay tight.
# This is what replaced dropping: a 20 s clip that certainly holds the ball beats an 8 s one
# that might not, and beats no clip at all.
AMBIGUITY_WINDOW = 20.0

# 🛑 When the scorer STALLS, the lag that follows is untrustworthy and sometimes enormous.
# Balls are entered ~25-30 s apart; a wicket whose previous entry was 65.8 s earlier turned out
# to have a 46.7 s lag, and its delivery was not even among the motion candidates — so no span
# could reach it and only a window measured from the entry can. A stall is flagged when the gap
# to the previous entry exceeds STALL_FACTOR x the innings' median gap, and a flagged ball gets
# STALL_LEAD of run-up.
# ⚠ A stall alone over-flags badly: 51 of 208 balls, including one aligned perfectly that
# turned an 8 s clip into 48 s. So a stall widens only when the alignment is ALSO implausible
# for it — either the onset fails the still-field test, or the claimed lag is below this
# innings' median. A 66 s stall that supposedly ended with a ball bowled 4 s earlier makes no
# sense; a 74 s stall ending in a 14 s lag is ordinary, and that ball stays tight at 8 s.
STALL_FACTOR = 1.8
STALL_LEAD = 55.0
# ⚠ "Below the median" is far too loose a second condition: it fired on two balls that had
# been confirmed perfect by eye and turned an 8 s clip into 51 s, pushing reels over the 60 s
# Shorts line for nothing. The lag has to be well below the median before a stall counts —
# the ball that genuinely needed this claimed 4.0 s against a median of 8.6 s.
SHORT_LAG_FRAC = 0.6

LAG_MIN, LAG_MAX = 2.0, 90.0
SKIP_DELIVERY, SKIP_ENTRY, SMOOTH, STRENGTH = 1.0, 30.0, 0.5, 8.0
INF = 1e18


def pitch_crop(w: int, h: int) -> str:
    """A generous band over the pitch, covering both innings' framings.

    ⚠ The camera moves between matches and even between innings — on `vs ATX Panthers` the
    action sat at 39-66% of the width in the first innings and 41-63% in the second. This
    spans 31-76%, which holds both, and being generous costs only a little extra noise
    because the aligner weighs peaks by strength.
    """
    cw, cx = int(w * 0.45), int(w * 0.31)
    ch, cy = int(h * 0.33), int(h * 0.44)
    return f"crop={cw}:{ch}:{cx}:{cy}"


def motion_curve(src: str, t0: float, t1: float, cache: str | None = None) -> np.ndarray:
    """Frame-difference energy at FPS between t0 and t1. Streamed, never held whole."""
    if cache and os.path.exists(cache):
        return np.load(cache)
    m = probe(src)
    p = subprocess.Popen(
        [ffmpeg(), "-hide_banner", "-loglevel", "error", "-ss", f"{t0:.2f}",
         "-t", f"{t1 - t0:.2f}", "-i", src,
         "-vf", f"{pitch_crop(m['w'], m['h'])},scale={GRID_W}:{GRID_H},fps={FPS}",
         "-pix_fmt", "gray", "-f", "rawvideo", "-"],
        stdout=subprocess.PIPE, bufsize=GRID_W * GRID_H * 64)
    n, prev, out = GRID_W * GRID_H, None, []
    try:
        while True:
            b = p.stdout.read(n)
            if len(b) < n:
                break
            f = np.frombuffer(b, np.uint8).astype(np.int16)
            if prev is not None:
                out.append(float(np.abs(f - prev).mean()))
            prev = f
    finally:
        p.stdout.close()
        p.wait()
    d = np.array(out)
    if cache:
        np.save(cache, d)
    return d


def candidates(curve: np.ndarray, t0: float, n_want: int) -> tuple[np.ndarray, np.ndarray]:
    """-> (times, strengths) of delivery onsets: the rising edge of each motion burst.

    🛑 Do not go back to picking the strongest peak. That is what this did first, and it
    put one batter's second four nine seconds late. A delivery that goes to the boundary has
    TWO motion humps — the run-up and shot, then the chase, the throw back and the crowd —
    and on a four the second is the bigger one:

        2235-2239   2.3-3.6   field set, nobody moving
        2240-2244   6.0-8.7   run-up, shot            <- the delivery, peak 8.65
        2245-2270   5.8-10.2  chase and return        <- peak 9.49, and it won

    Worse, suppressing peaks within a MIN_GAP then *discarded* the delivery in favour of the
    aftermath, so no amount of alignment tuning could recover it: the right answer was not on
    the list. The onset does not have that failure mode. It is the bowler starting his run-up,
    it is the same shape whether the ball goes to the fence or to cover, and it sits a
    measured 0.75 s before bat on ball.

    Each local maximum is walked back to where its rise had covered `RISE_FRAC` of the way up
    from the quiet before it. Onsets within `ONSET_GAP` are one burst, and the group keeps the
    onset of its STRONGEST peak — ⚠ not the earliest. Keeping the earliest re-broke ball #2,
    because a small bump at 2237.7 swallowed the real onset at 2242.
    """
    sm = np.convolve(curve, np.ones(4) / 4, mode="same")
    peaks = [i for i in range(1, len(sm) - 1) if sm[i] >= sm[i - 1] and sm[i] > sm[i + 1]]
    found: dict[int, float] = {}                 # onset index -> strongest peak above it
    for i in peaks:
        w0 = max(0, i - int(BACKTRACK * FPS))
        lo = float(sm[w0:i + 1].min())
        if sm[i] - lo < MIN_RISE:
            continue
        thr = lo + RISE_FRAC * (sm[i] - lo)
        j = i
        while j > w0 and sm[j] >= thr:
            j -= 1
        if sm[i] > found.get(j, 0.0):
            found[j] = float(sm[i])
    groups: list[list[tuple[int, float]]] = []
    for j in sorted(found):
        if groups and (j - groups[-1][-1][0]) / FPS < ONSET_GAP:
            groups[-1].append((j, found[j]))
        else:
            groups.append([(j, found[j])])
    picked = [max(g, key=lambda p: p[1]) for g in groups]
    picked.sort(key=lambda p: -p[1])
    picked = picked[:n_want]
    picked.sort()
    return (np.array([j for j, _ in picked]) / FPS + t0,
            np.array([s for _, s in picked]))


def entered_balls(states: list[dict], innings: int) -> list[float]:
    """When the scorer entered each ball of `innings` (0-based), in order.

    Same new-ball rule as `qrscan.moments()`: the over advanced, OR runs, OR wickets —
    because `ballsBowled` counts legal balls only, so a wide does not move it.
    """
    out: list[float] = []
    prev = None
    for s in states:
        f = s["fields"]
        if f["innings"] != innings:
            prev = None
            continue
        if prev is not None and (f["ballsBowled"] > prev["ballsBowled"]
                                 or f["teamRuns"] > prev["teamRuns"]
                                 or f["wickets"] > prev["wickets"]):
            out.append(s["t"])
        prev = f
    return out


def align(entries: list[float], times: np.ndarray, strength: np.ndarray) -> dict[int, int]:
    """Monotonic alignment of entries to delivery candidates. -> {entry idx: cand idx}."""
    m, n = len(entries), len(times)
    if not m or not n:
        return {}
    E = np.asarray(entries, float)
    lag = E[:, None] - times[None, :]
    ok = (lag >= LAG_MIN) & (lag <= LAG_MAX)
    z = (strength - strength.min()) / max(strength.max() - strength.min(), 1e-9)
    mcost = STRENGTH * (1.0 - z)             # cheap to match a strong peak

    best = np.full(n, INF)                   # best chain ending at candidate j
    blag = np.zeros(n)
    bidx = np.full(n, -1, int)
    prev_of: dict[tuple[int, int], tuple[int, int]] = {}

    for k in range(m):
        cc = np.full(n, INF)
        cp: list[tuple[int, int] | None] = [None] * n
        js = np.nonzero(ok[k])[0]
        for j in js:
            cost = SKIP_DELIVERY * j + SKIP_ENTRY * k + mcost[j]
            back = (-1, -1)
            if j:
                live = np.nonzero(best[:j] < INF)[0]
                if live.size:
                    c = (best[live] + SMOOTH * np.abs(lag[k, j] - blag[live])
                         + SKIP_DELIVERY * (j - live - 1)
                         + SKIP_ENTRY * np.maximum(k - bidx[live] - 1, 0) + mcost[j])
                    i = int(np.argmin(c))
                    if c[i] < cost:
                        cost, back = float(c[i]), (int(bidx[live[i]]), int(live[i]))
            cc[j], cp[j] = cost, back
        for j in js:
            if cc[j] < best[j]:
                best[j], blag[j], bidx[j] = cc[j], lag[k, j], k
                prev_of[(k, j)] = cp[j]

    live = np.nonzero(best < INF)[0]
    if not live.size:
        return {}
    # 🛑 Trailing skips are charged here. Without them, stopping early is free.
    tail = SKIP_DELIVERY * (n - live - 1) + SKIP_ENTRY * (m - bidx[live] - 1)
    j = int(live[np.argmin(best[live] + tail)])
    pairs: dict[int, int] = {}
    k = int(bidx[j])
    while k >= 0 and j >= 0:
        pairs[k] = j
        k, j = prev_of.get((k, j), (-1, -1))
    return pairs


def pre_onset_level(sm: np.ndarray, j: int) -> float:
    """Mean motion in the PRE_WINDOW seconds before onset index `j`."""
    p0 = max(0, j - int(PRE_WINDOW * FPS))
    return float(sm[p0:j + 1].mean()) if j > p0 else float(sm[j])


def pre_levels(sm: np.ndarray, times: np.ndarray, t0: float) -> np.ndarray:
    """Pre-onset level for every candidate, in candidate order."""
    idx = np.clip(np.round((times - t0) * FPS).astype(int), 0, len(sm) - 1)
    return np.array([pre_onset_level(sm, j) for j in idx])


def still_and_busy(pre: np.ndarray, median: float) -> tuple[float, float]:
    """-> (still threshold, busy threshold) from the innings' own distribution.

    ⚠ Falls back to the fraction-of-median form when there are too few candidates to take a
    percentile from, so a short innings still gets sane thresholds.
    """
    if len(pre) < 20:
        return QUIET_FRAC * median, SUSPECT_PRE_FRAC * median
    return (float(np.percentile(pre, STILL_PCT)), float(np.percentile(pre, BUSY_PCT)))


def snap_to_quiet(sm: np.ndarray, times: np.ndarray, pairs: dict[int, int],
                  t0: float) -> dict[int, int]:
    """Move a match off an aftermath burst onto the delivery that caused it.

    🛑 Why a post-hoc step and not a better cost. On `vs ATX Panthers` innings 2 the aligner
    put a wicket 4.5 s late, on a burst 5 s after the real delivery. Both candidates were in
    the list; the decoy was simply the stronger burst (10.64 vs 7.87) because the second
    innings is framed much tighter, so players walking fill more of the frame than a delivery
    does. ⚠ Every global lever was tried and none of them moved it — peak height, contrast
    over BACKTRACK, contrast against the local level, quietness alone, SMOOTH from 0 to 0.5
    and STRENGTH halved. SMOOTH is especially tempting and especially wrong: that ball's true
    lag is 23 s against its neighbour's 8 s, so a smoothness prior actively prefers the decoy.

    What separates them is not the burst, it is the field before it:

        real delivery  onset 10727.75, field in the 2.5 s before:  4.34   (set, still)
        aftermath      onset 10733.00, field in the 2.5 s before:  6.29+  (ball still unwinding)

    So if the chosen candidate was NOT preceded by a still field, walk back up to
    SNAP_WINDOW seconds for one that was. Stable for QUIET_FRAC 0.8-1.1, and it leaves every
    already-correct ball alone.
    """
    pre = pre_levels(sm, times, t0)
    quiet, _ = still_and_busy(pre, float(np.median(sm)))
    idx = np.round((times - t0) * FPS).astype(int)
    idx = np.clip(idx, 0, len(sm) - 1)
    out = dict(pairs)
    for k, j in pairs.items():
        if pre_onset_level(sm, idx[j]) <= quiet:
            continue                                  # already a quiet-preceded onset
        for j2 in range(j - 1, -1, -1):
            if times[j] - times[j2] > SNAP_WINDOW:
                break
            if pre_onset_level(sm, idx[j2]) <= quiet:
                out[k] = j2
                break
    return out


def prefer_cluster_start(times: np.ndarray, pairs: dict[int, int],
                        gap: float = CLUSTER_GAP) -> dict[int, int]:
    """Move each match back to the first candidate of its burst cluster.

    See CLUSTER_GAP. A match never moves onto a candidate already taken by an earlier entry,
    so the alignment stays monotonic.
    """
    taken = {j: k for k, j in pairs.items()}
    out = dict(pairs)
    for k in sorted(pairs):
        j = pairs[k]
        first = j
        while first > 0 and times[first] - times[first - 1] <= gap:
            nxt = first - 1
            owner = taken.get(nxt)
            if owner is not None and owner != k:
                break                        # that burst belongs to an earlier ball
            first = nxt
        if first != j:
            taken.pop(j, None)
            taken[first] = k
            out[k] = first
    return out


def drop_busy_preceded(sm: np.ndarray, times: np.ndarray, pairs: dict[int, int],
                       t0: float) -> tuple[dict[int, int], int]:
    """Drop matches still sitting on a burst that a busy field ran into. -> (kept, n dropped).

    ⚠ This is the second line, after `snap_to_quiet()`. When the snap finds no still-preceded
    candidate within its window, the match is probably not on a delivery at all: on
    `vs ATX Panthers` innings 2 it removed two wicket clips that showed fielders milling about
    with no batter at the crease, and kept all five that showed the bowler delivering.

    🛑 It is not a complete filter. A third bad clip had a pre-onset level of 5.22, below the
    innings median, and is indistinguishable by this signal — so keep reviewing reel by reel.
    """
    pre = pre_levels(sm, times, t0)
    _, thr = still_and_busy(pre, float(np.median(sm)))
    idx = np.clip(np.round((times - t0) * FPS).astype(int), 0, len(sm) - 1)
    kept = {k: j for k, j in pairs.items() if pre_onset_level(sm, idx[j]) <= thr}
    return kept, len(pairs) - len(kept)


def drop_lag_outliers(shots: dict[float, float]) -> tuple[dict[float, float], list[float]]:
    """Remove balls whose scorer lag is a wild outlier. -> (kept, dropped lags).

    🛑 A clip cut from a wrong match is worse than a missing clip, and an outlying lag is the
    one signal that separated the two confirmed mis-alignments from every clip verified good.
    See LAG_OUTLIER_MAD.
    """
    if len(shots) < 8:                      # too few to estimate a spread from
        return shots, []
    lags = np.array([e - s for e, s in shots.items()])
    med = float(np.median(lags))
    mad = float(np.median(np.abs(lags - med)))
    thr = max(med + LAG_OUTLIER_MAD * 1.4826 * mad, LAG_OUTLIER_FLOOR)
    kept = {e: s for e, s in shots.items() if (e - s) <= thr}
    return kept, sorted(e - s for e, s in shots.items() if (e - s) > thr)


def shot_brackets(src: str, states: list[dict], innings: int, cache: str | None = None,
                  keep_suspect: bool = False) -> dict[float, tuple[float, float]]:
    """-> {entry time: (earliest plausible shot, chosen shot)} for one innings.

    The two are equal when only one candidate was in play, which is the common case. When an
    earlier rival sits within `AMBIGUITY_WINDOW` the span is returned instead, and the caller
    widens the clip to cover it. ⚠ A span never reaches back onto a candidate matched to an
    earlier ball, so clips cannot swallow the previous delivery.
    """
    entries = entered_balls(states, innings)
    if not entries:
        return {}
    t0, t1 = max(0.0, entries[0] - 120), entries[-1] + 30
    curve = motion_curve(src, t0, t1, cache)
    times, strength = candidates(curve, t0, int(len(entries) * CANDIDATES_PER_BALL))
    pairs = align(entries, times, strength)
    sm = np.convolve(curve, np.ones(4) / 4, mode="same")
    pairs = snap_to_quiet(sm, times, pairs, t0)
    pairs = prefer_cluster_start(times, pairs)
    # 🛑 Nothing is dropped here. `drop_busy_preceded()` is used only to mark which matches
    # are doubtful; a doubtful ball gets the FULL ambiguity window instead of being thrown
    # away, because dropping is what made the bowling reels worse than the old fixed-lag cut.
    kept, _ = drop_busy_preceded(sm, times, pairs, t0)
    doubtful = set(pairs) - set(kept)
    # Which entries followed a stall? Measured on the entry sequence, not the video.
    gaps = np.diff(entries) if len(entries) > 1 else np.array([30.0])
    med_gap = float(np.median(gaps)) if len(gaps) else 30.0
    stalled = {k for k in range(1, len(entries))
               if entries[k] - entries[k - 1] > STALL_FACTOR * med_gap}
    # Onsets that do not read as a still-preceded delivery (a weaker bar than `doubtful`).
    pre_all = pre_levels(sm, times, t0)
    quiet_thr, _ = still_and_busy(pre_all, float(np.median(sm)))
    doubtful_still = {k for k, j in pairs.items() if pre_all[j] > quiet_thr}
    # A lag below this innings' median is not wrong on its own — plenty of correct balls sit
    # there — but combined with a stall it means the aligner found the wrong burst.
    all_lags = np.array([entries[k] - (times[j] + ONSET_TO_SHOT) for k, j in pairs.items()])
    med_lag = float(np.median(all_lags)) if len(all_lags) else 0.0
    short_lag = {k for k, j in pairs.items()
                 if entries[k] - (times[j] + ONSET_TO_SHOT) < SHORT_LAG_FRAC * med_lag}
    taken = set(pairs.values())
    out: dict[float, tuple[float, float]] = {}
    for k, j in pairs.items():
        lo = j
        while lo > 0:
            nxt = lo - 1
            if times[j] - times[nxt] > AMBIGUITY_WINDOW or nxt in taken:
                break
            lo = nxt
        lo_t = float(times[lo] + ONSET_TO_SHOT)
        hi_t = float(times[j] + ONSET_TO_SHOT)
        if not keep_suspect:
            if k in doubtful:
                # No candidate here reads as a delivery: trust the span, not the point.
                lo_t = min(lo_t, hi_t - AMBIGUITY_WINDOW)
            if k in stalled and (k in doubtful_still or k in short_lag):
                # The scorer stalled AND this onset does not look like a delivery, so measure
                # from the ENTRY rather than trusting a candidate.
                lo_t = min(lo_t, entries[k] - STALL_LEAD)
        out[entries[k]] = (lo_t, hi_t)
    if not keep_suspect and (doubtful or stalled):
        print(f"    widened: {len(doubtful)} after a busy field, "
              f"{len(stalled & (doubtful_still | short_lag))} after a scorer stall "
              f"(median gap {med_gap:.0f}s)")
    return out


def shot_times(src: str, states: list[dict], innings: int, cache: str | None = None,
               keep_suspect: bool = False) -> dict[float, float]:
    """-> {entry time: time the ball was actually bowled}, for one innings."""
    entries = entered_balls(states, innings)
    if not entries:
        return {}
    # Search a little either side of the innings, so the first and last balls have
    # candidates available on both sides.
    t0, t1 = max(0.0, entries[0] - 120), entries[-1] + 30
    curve = motion_curve(src, t0, t1, cache)
    times, strength = candidates(curve, t0, int(len(entries) * CANDIDATES_PER_BALL))
    pairs = align(entries, times, strength)
    sm = np.convolve(curve, np.ones(4) / 4, mode="same")
    pairs = snap_to_quiet(sm, times, pairs, t0)
    pairs = prefer_cluster_start(times, pairs)
    if keep_suspect:
        return {entries[k]: float(times[j] + ONSET_TO_SHOT) for k, j in pairs.items()}
    pairs, n_busy = drop_busy_preceded(sm, times, pairs, t0)
    if n_busy:
        print(f"    dropped {n_busy} ball(s) whose onset followed a busy field — "
              f"probably not a delivery")
    shots = {entries[k]: float(times[j] + ONSET_TO_SHOT) for k, j in pairs.items()}
    shots, dropped = drop_lag_outliers(shots)
    if dropped:
        print(f"    dropped {len(dropped)} ball(s) on an outlying scorer lag "
              f"({', '.join(f'{d:.0f}s' for d in dropped)}) — likely mis-aligned")
    return shots
