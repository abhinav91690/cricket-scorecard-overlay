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

from deliveries import FPS, ONSET_TO_SHOT, align, candidates

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
