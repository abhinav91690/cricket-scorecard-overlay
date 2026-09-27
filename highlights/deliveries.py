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
PEAK_TO_SHOT = 2.5          # measured: the motion peak trails bat-on-ball by this much
MIN_GAP = 12.0              # two deliveries are never closer than this
CANDIDATES_PER_BALL = 2.1   # over-detect on purpose; see the module note

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
    """-> (times, strengths) of the `n_want` strongest peaks, at least MIN_GAP apart."""
    sm = np.convolve(curve, np.ones(4) / 4, mode="same")
    peaks = [i for i in range(1, len(sm) - 1) if sm[i] >= sm[i - 1] and sm[i] > sm[i + 1]]
    kept: list[int] = []
    for i in sorted(peaks, key=lambda i: -sm[i]):
        if len(kept) >= n_want:
            break
        if all(abs(i - j) / FPS >= MIN_GAP for j in kept):
            kept.append(i)
    kept.sort()
    return np.array(kept) / FPS + t0, np.array([sm[i] for i in kept])


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


def shot_times(src: str, states: list[dict], innings: int,
               cache: str | None = None) -> dict[float, float]:
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
    return {entries[k]: float(times[j] - PEAK_TO_SHOT) for k, j in pairs.items()}
