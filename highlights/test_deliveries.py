"""Does candidates() find the DELIVERY rather than the aftermath? Pure — no video needed.

🛑 The bug this exists to stop. A boundary makes two motion humps: the run-up and the shot,
then the chase, the throw back and the crowd. On a four the second is the bigger one. The
first version of `deliveries.py` picked the strongest peak and suppressed everything within
12 s of it, so on Abhinav's second four it kept the aftermath at 2253 and *discarded* the
delivery at 2244 — the right answer was not even on the candidate list, so no amount of
alignment tuning could recover it. The clip was nine seconds late: batters walking, ball long
gone.

The synthetic curve below is that shape. `test_the_aftermath_really_does_out_peak_the_shot`
asserts the trap is present, so this suite cannot pass by accident: a detector that just
returns the strongest peak fails `test_picks_the_delivery_not_the_aftermath`, and a detector
that returns everything fails `test_one_candidate_per_hump`.

    python highlights/test_deliveries.py    # standalone
    pytest highlights/test_deliveries.py
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from deliveries import (FPS, LAG_OUTLIER_FLOOR, ONSET_TO_SHOT, QUIET_FRAC,
                        SUSPECT_PRE_FRAC, align, candidates, drop_busy_preceded,
                        drop_lag_outliers, pre_onset_level, snap_to_quiet)

BASE = 2.5
DELIVERY_T, DELIVERY_PEAK = 100.0, 8.0     # run-up and shot
AFTERMATH_T, AFTERMATH_PEAK = 110.0, 10.0  # chase, throw back, crowd — the bigger hump


def boundary_curve(quiet=60.0, total=180.0):
    """A four: quiet field, a delivery hump, a BIGGER aftermath hump, quiet again."""
    t = np.arange(0.0, total, 1.0 / FPS)
    c = np.full_like(t, BASE)
    c += (DELIVERY_PEAK - BASE) * np.exp(-((t - DELIVERY_T) ** 2) / (2 * 1.6 ** 2))
    c += (AFTERMATH_PEAK - BASE) * np.exp(-((t - AFTERMATH_T) ** 2) / (2 * 2.4 ** 2))
    c[t < quiet] = BASE
    return t, c


def test_the_aftermath_really_does_out_peak_the_shot():
    """🛑 Load-bearing. Without this the other tests could pass on a trap-free curve."""
    _, c = boundary_curve()
    assert c.max() > DELIVERY_PEAK, "the aftermath must be the strongest peak in the curve"
    a = int(DELIVERY_T * FPS)
    b = int(AFTERMATH_T * FPS)
    assert c[b] > c[a], "the aftermath hump must out-peak the delivery hump"


def test_picks_the_delivery_not_the_aftermath():
    _, c = boundary_curve()
    times, _ = candidates(c, 0.0, 10)
    assert len(times), "no candidates at all"
    near = [t for t in times if abs(t - DELIVERY_T) < 4.0]
    assert near, f"the delivery at {DELIVERY_T}s was not found; got {times}"
    # and the onset leads the peak, so the shot lands after it, not before
    assert near[0] < DELIVERY_T, f"onset {near[0]:.1f} must precede the peak {DELIVERY_T}"
    assert 0.0 < ONSET_TO_SHOT < 3.0, "the shot follows the onset by well under a delivery"


def test_one_candidate_per_hump():
    """Same-burst onsets merge, so a hump yields one candidate rather than a cluster."""
    _, c = boundary_curve()
    times, _ = candidates(c, 0.0, 50)
    per_hump = [sum(1 for t in times if abs(t - h) < 4.0)
                for h in (DELIVERY_T, AFTERMATH_T)]
    assert all(n <= 1 for n in per_hump), f"clustered candidates: {times}"


def test_a_flat_curve_yields_nothing():
    """No rise, no delivery — MIN_RISE must reject a field just milling about."""
    c = np.full(int(180 * FPS), BASE)
    times, _ = candidates(c, 0.0, 10)
    assert len(times) == 0, f"invented {len(times)} deliveries in a still frame"


def test_align_skips_rather_than_guesses():
    """An entry with no delivery in range is left unmatched, not forced onto a far peak.

    ⚠ A clip cut from a wrong match is worse than a missing clip — `reels.py --align` drops
    an unlocated moment, so `align()` must be willing to return fewer pairs than entries.
    """
    times = np.array([100.0, 200.0])
    strength = np.array([9.0, 9.0])
    entries = [110.0, 210.0, 600.0]          # the third is far beyond LAG_MAX
    pairs = align(entries, times, strength)
    assert 2 not in pairs, "matched an entry with no delivery within the lag bounds"
    assert len(pairs) <= 2


def test_align_is_monotonic():
    """The k-th ball entered is the k-th ball bowled — the whole basis of the method."""
    times = np.array([100.0, 130.0, 160.0, 190.0])
    strength = np.array([9.0, 9.0, 9.0, 9.0])
    entries = [110.0, 140.0, 170.0, 200.0]
    pairs = align(entries, times, strength)
    ks = sorted(pairs)
    js = [pairs[k] for k in ks]
    assert js == sorted(js), f"alignment crossed over: {pairs}"


def test_drops_a_wild_lag_outlier():
    """Both mis-alignments ever confirmed by eye were the largest lag in their innings."""
    shots = {100.0 + 20 * i: 100.0 + 20 * i - 9.0 for i in range(12)}
    shots[500.0] = 455.0                       # a 45 s lag among 9 s ones
    kept, dropped = drop_lag_outliers(shots)
    assert dropped == [45.0], f"guard did not fire: {dropped}"
    assert len(kept) == 12


def test_keeps_a_slow_but_consistent_scorer():
    """🛑 The floor. A scorer who is uniformly late is not a mis-alignment.

    Without LAG_OUTLIER_FLOOR the MAD of a tight distribution is tiny, so an entire innings
    of consistent 28 s lags would be discarded as outliers.
    """
    slow = {100.0 + 20 * i: 100.0 + 20 * i - 28.0 for i in range(12)}
    kept, dropped = drop_lag_outliers(slow)
    assert dropped == [], f"threw away a consistent scorer: {dropped}"
    assert len(kept) == 12
    assert LAG_OUTLIER_FLOOR >= 28.0, "the floor must clear every lag verified good by eye"


def test_too_few_balls_to_judge_a_spread():
    """With a handful of balls the median and MAD mean nothing — keep them all."""
    shots = {100.0: 91.0, 200.0: 155.0}
    kept, dropped = drop_lag_outliers(shots)
    assert dropped == [] and len(kept) == 2


# --- the still-field discriminator -------------------------------------------------
# A curve holding a real delivery (rises out of a quiet field at 100 s) and, 5 s later, the
# aftermath burst it caused — which is the STRONGER of the two. This is the innings-2 shape
# that peak-picking, contrast, SMOOTH and STRENGTH all failed on.

# --- the real failing case ---------------------------------------------------------
# 🛑 Synthetic curves were tried first and were the wrong tool: three attempts each failed
# for a reason that was the FIXTURE's fault, not the code's — bursts too close and ONSET_GAP
# merged them, too far and SNAP_WINDOW could not reach, a flat baseline giving an
# unrealistically low median for SUSPECT_PRE_FRAC. This is the actual motion curve from
# `vs ATX Panthers` innings 2, 10690-10750 s, the ball that landed 4.5 s late. Frame by frame
# the delivery stride is at 10728 and bat on ball at 10729.3; the burst at 10733-10736 is the
# batter walking off and the fielders gathering.
INN2_T0 = 10690.0
INN2_MEDIAN = 5.372            # median of the whole innings-2 curve, not of this excerpt
INN2_DELIVERY = 10729.3        # measured frame by frame
INN2_CURVE = np.array([
    5.40, 5.00, 5.56, 5.13, 5.32, 4.81, 5.79, 6.28, 4.93, 5.21, 5.88, 4.96, 4.33, 3.45,
    3.94, 3.47, 4.09, 5.03, 4.72, 4.70, 4.85, 4.24, 3.82, 6.16, 5.00, 4.55, 3.77, 4.26,
    4.35, 3.55, 4.76, 3.75, 4.22, 5.05, 4.57, 3.28, 4.23, 5.09, 4.22, 4.91, 5.92, 4.71,
    3.55, 4.65, 3.65, 3.80, 5.72, 8.22, 7.22, 7.60, 8.78, 8.07, 6.93, 7.83, 6.30, 7.42,
    8.37, 7.65, 8.09, 7.45, 7.22, 5.86, 6.34, 7.63, 6.92, 7.14, 6.84, 6.72, 6.09, 6.68,
    5.36, 5.35, 4.89, 5.49, 5.78, 4.80, 3.95, 3.72, 4.03, 4.73, 4.36, 3.98, 4.80, 4.22,
    4.80, 4.23, 4.49, 3.83, 3.91, 4.70, 5.53, 5.58, 6.18, 5.16, 5.23, 4.70, 4.70, 3.82,
    3.23, 3.84, 4.47, 4.44, 3.50, 3.22, 3.41, 3.71, 4.84, 5.89, 6.70, 6.44, 5.16, 5.04,
    5.31, 5.68, 4.82, 5.67, 4.89, 5.54, 5.07, 4.97, 4.59, 4.99, 5.38, 5.18, 5.26, 5.28,
    4.18, 5.24, 7.39, 7.60, 5.64, 4.27, 4.02, 4.38, 4.50, 4.32, 3.67, 4.07, 3.72, 4.18,
    4.13, 4.03, 4.10, 4.27, 4.97, 4.00, 3.31, 3.21, 2.78, 3.40, 3.82, 5.01, 5.38, 7.31,
    8.02, 7.72, 8.38, 7.23, 6.17, 6.33, 8.09, 7.25, 6.82, 7.30, 8.35, 8.43, 7.41, 6.54,
    6.02, 5.17, 4.73, 5.56, 5.79, 6.85, 7.93, 9.27, 9.84, 10.68, 12.05, 9.97, 7.40, 6.81,
    6.06, 5.41, 5.26, 5.02, 5.91, 7.44, 6.93, 7.43, 7.68, 7.71, 8.22, 8.36, 7.93, 7.22,
    7.32, 8.68, 7.93, 6.38, 5.51, 4.62, 4.94, 5.21, 4.75, 4.03, 3.28, 3.47, 3.92, 4.88,
    6.80, 6.88, 6.84, 6.44, 6.67, 6.40, 5.88, 4.88, 6.31, 6.20, 5.93, 6.20, 6.02, 6.49,
    6.50, 6.55, 6.19, 5.94, 6.28, 5.64, 5.30, 3.31, 2.36, 2.72, 1.99, 2.17, 2.65, 2.68,
    3.15, 2.96])


def inn2_onsets():
    """-> (times, delivery onset index, aftermath onset index) for the real curve."""
    times, _ = candidates(INN2_CURVE, INN2_T0, 40)
    near = sorted(t for t in times if INN2_DELIVERY - 4 < t < INN2_DELIVERY + 10)
    assert len(near) >= 2, f"need the delivery and its aftermath, got {near}"
    j_d = int(np.where(times == near[0])[0][0])
    j_a = int(np.where(times == near[-1])[0][0])
    return times, j_d, j_a


def test_the_real_aftermath_out_peaks_the_real_delivery():
    """🛑 Load-bearing: this is why peak-picking chose wrong, and why the snap is needed."""
    times, j_d, j_a = inn2_onsets()
    sm = np.convolve(INN2_CURVE, np.ones(4) / 4, mode="same")
    i_d = int(round((times[j_d] - INN2_T0) * FPS))
    i_a = int(round((times[j_a] - INN2_T0) * FPS))
    peak_d = sm[i_d:i_d + int(6 * FPS)].max()
    peak_a = sm[i_a:i_a + int(6 * FPS)].max()
    assert peak_a > peak_d, (
        f"aftermath peak {peak_a:.2f} must exceed the delivery's {peak_d:.2f}")


def test_the_delivery_onset_is_where_the_ball_was_actually_bowled():
    times, j_d, _ = inn2_onsets()
    err = (times[j_d] + ONSET_TO_SHOT) - INN2_DELIVERY
    assert abs(err) < 1.5, f"delivery onset off by {err:+.2f}s"


def test_snap_moves_off_the_real_aftermath_onto_the_real_delivery():
    """🛑 This is the wicket clip that showed the batter walking off."""
    times, j_d, j_a = inn2_onsets()
    sm = np.convolve(INN2_CURVE, np.ones(4) / 4, mode="same")
    snapped = snap_to_quiet(sm, times, {0: j_a}, INN2_T0)
    assert snapped[0] == j_d, (
        f"snap left the match on the aftermath ({times[snapped[0]] + ONSET_TO_SHOT:.1f}s, "
        f"wanted {times[j_d] + ONSET_TO_SHOT:.1f}s)")


def test_snap_leaves_the_real_delivery_alone():
    times, j_d, _ = inn2_onsets()
    sm = np.convolve(INN2_CURVE, np.ones(4) / 4, mode="same")
    snapped = snap_to_quiet(sm, times, {0: j_d}, INN2_T0)
    assert snapped[0] == j_d, "snap moved a match that was already on the delivery"


def test_the_still_field_is_what_distinguishes_them():
    """The delivery rose out of a still field; the aftermath rose out of a busy one.

    ⚠ This ball is fixed by `snap_to_quiet`, NOT by `drop_busy_preceded` — its aftermath
    pre-level is 6.68 against a 7.25 threshold, so the guard would keep it. The guard's own
    cases are two other balls (pre-levels 7.58 and 7.91). Asserting the guard dropped THIS
    one was a false claim an earlier version of this test made.
    """
    times, j_d, j_a = inn2_onsets()
    sm = np.convolve(INN2_CURVE, np.ones(4) / 4, mode="same")
    idx = np.clip(np.round((times - INN2_T0) * FPS).astype(int), 0, len(sm) - 1)
    pre_d = pre_onset_level(sm, idx[j_d])
    pre_a = pre_onset_level(sm, idx[j_a])
    assert pre_d <= QUIET_FRAC * INN2_MEDIAN, (
        f"the delivery's pre-onset ({pre_d:.2f}) must read as still")
    assert pre_a > QUIET_FRAC * INN2_MEDIAN, (
        f"the aftermath's pre-onset ({pre_a:.2f}) must read as busy")
    assert pre_a > pre_d + 1.0, f"pre-levels too close: {pre_d:.2f} vs {pre_a:.2f}"


def test_drop_busy_preceded_removes_only_the_busy_one():
    """A pure check on the guard, with a curve whose median is under our control."""
    sm = np.full(400, 5.0)
    sm[100:110] = 2.0                 # a still field before onset index 110
    sm[190:200] = 9.0                 # a busy field before onset index 200
    times = np.array([110.0 / FPS, 200.0 / FPS])
    kept, n = drop_busy_preceded(sm, times, {0: 0, 1: 1}, 0.0)
    assert n == 1 and 0 in kept and 1 not in kept, (
        f"kept {sorted(kept)}, dropped {n} — wanted the still-preceded one kept")


def test_the_guards_are_ordered_sanely():
    """⚠ Load-bearing: the snap must be more permissive than the drop, or it never helps."""
    assert QUIET_FRAC < SUSPECT_PRE_FRAC, (
        "a match the snap accepts must not then be dropped as busy-preceded")


if __name__ == "__main__":
    fails = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  ok   {name}")
            except AssertionError as e:
                fails += 1
                print(f"  FAIL {name}: {e}")
    print("all passed" if not fails else f"{fails} failed")
    sys.exit(1 if fails else 0)
