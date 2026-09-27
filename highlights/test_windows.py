"""Does windows_for() put the shot inside the clip? Pure — no video needed.

The clip windows are relative to the state change, and the state changes when the SCORER
enters the ball. That delay is the scorer's, not cricket's: ~5 s on the reference match and
19 s on `vs ATX Panthers`, where the stock windows put every clip in the aftermath.

🛑 The last check here is the one that matters: it asserts the LEGACY window would still
miss a 19 s-lag shot. Without it the suite would pass whether or not windows_for() did
anything, which is the failure mode docs/highlights.md §7b is about.

    python highlights/test_windows.py    # standalone
    pytest highlights/test_windows.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from cut import DEFAULT_LEAD, DEFAULT_TRAIL, WINDOWS, windows_for

fails = []


def check(desc, cond):
    print(f"  {'ok  ' if cond else 'FAIL'} {desc}")
    if not cond:
        fails.append(desc)


w = windows_for(19, 45)
a, b = w["four"]
span = DEFAULT_LEAD + DEFAULT_TRAIL
check(f"lag 19: four window {a:g}..{b:g} is {span:g}s long", abs((b - a) - span) < 1e-9)
check("the shot (-19) is inside the four window", a < -19 < b)
check(f"{DEFAULT_LEAD:g}s before the shot", abs((-19) - a - DEFAULT_LEAD) < 1e-9)
check(f"{DEFAULT_TRAIL:g}s after the shot", abs(b - (-19) - DEFAULT_TRAIL) < 1e-9)

a, b = w["wicket"]
check("the dismissal (-45) is inside the wicket window", a < -45 < b)
check("boundary and wicket windows differ", w["four"] != w["wicket"])
check("six shares the batting lag", w["six"] == w["four"])
check("milestone/partnership share the batting lag",
      w["milestone"] == w["four"] and w["partnership"] == w["four"])

# The legacy windows must still be wrong for a 19s scorer — that is the whole point.
la, lb = WINDOWS["four"]
check("legacy four window does NOT contain a 19s-lag shot", not (la < -19 < lb))

# Custom lead/trail
a, b = windows_for(19, 45, lead=1, trail=6)["four"]
check("lead/trail are honoured (7s clip)", abs((b - a) - 7) < 1e-9)
check("the shot is still inside with custom lead/trail", a < -19 < b)

# A zero lag must degrade sanely rather than invert the window.
a, b = windows_for(0, 0)["four"]
check("lag 0 keeps start before end", a < b)

print(f"\n  {len(fails)} failure(s)")
sys.exit(1 if fails else 0)
