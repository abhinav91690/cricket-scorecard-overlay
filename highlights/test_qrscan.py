"""Tests for the event rules in qrscan.moments(). Pure — no video needed.

The rules encode cricket, not image processing, and several of them exist because of a
specific way the data lies: ballsBowled counts legal balls so a no-ball does not advance
it, a batter's run count resets when they are dismissed, and the first decoded state
describes a ball bowled before the recording began.

    python highlights/test_qrscan.py    # standalone
    pytest highlights/test_qrscan.py
"""
from __future__ import annotations
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qrscan import moments
from payload import OUTCOME

BASE = dict(version=1, frameType=0, sequence=0, innings=0, teamRuns=50, wickets=1,
            ballsBowled=30, target=0, outcome=OUTCOME.index('1'),
            strikerName="VENU S", strikerRuns=20, strikerBalls=15,
            strikerFours=2, strikerSixes=0, nonStrikerRuns=10, nonStrikerBalls=12,
            bowlerName="ANKIT K", bowlerBalls=12, bowlerRuns=30, bowlerWickets=1,
            bowlerMaidens=0, partnershipRuns=20, partnershipBalls=18, extras=3)


def st(t, **over):
    f = dict(BASE); f.update(over)
    return {"t": float(t), "until": float(t) + 5.0, "fields": f}


def types_at(states, i):
    ms = moments(states)
    return ms[i]["types"] if i < len(ms) else None


def test_first_state_emits_nothing():
    """Its outcome describes a ball bowled before the recording started."""
    assert moments([st(0, outcome=OUTCOME.index('6'))]) == []


def test_six_and_four_off_the_bat():
    six = [st(0), st(5, teamRuns=56, ballsBowled=31, outcome=OUTCOME.index('6'))]
    assert types_at(six, 0) == ['six']
    four = [st(0), st(5, teamRuns=54, ballsBowled=31, outcome=OUTCOME.index('4'))]
    assert types_at(four, 0) == ['four']


def test_boundary_off_a_no_ball_still_counts():
    """ballsBowled counts LEGAL balls, so a no-ball leaves the over where it was —
    the new delivery has to be recognised from the runs instead."""
    s = [st(0), st(5, teamRuns=57, ballsBowled=30, outcome=OUTCOME.index('6nb'))]
    assert types_at(s, 0) == ['six']
    s = [st(0), st(5, teamRuns=55, ballsBowled=30, outcome=OUTCOME.index('4nb'))]
    assert types_at(s, 0) == ['four']


def test_wicket():
    s = [st(0), st(5, wickets=2, ballsBowled=31, outcome=OUTCOME.index('W'))]
    assert types_at(s, 0) == ['wicket']


def test_wicket_with_no_runs_and_no_legal_ball_is_still_seen():
    """A stumping off a wide: over unchanged, runs unchanged bar the wide."""
    s = [st(0), st(5, wickets=2, outcome=OUTCOME.index('W'))]
    assert types_at(s, 0) == ['wicket']


def test_a_ball_that_earns_two_types():
    s = [st(0, strikerRuns=46, partnershipRuns=46),
         st(5, teamRuns=56, ballsBowled=31, strikerRuns=52, partnershipRuns=52,
            outcome=OUTCOME.index('6'))]
    t = types_at(s, 0)
    assert set(t) == {'six', 'milestone', 'partnership'}
    assert moments(s)[0]['anchor'] == 'six'     # the shot is what the clip is framed on


def test_no_moment_when_nothing_happened():
    """The payload can change without a delivery — a bowler swap, say."""
    s = [st(0), st(5, bowlerName="RAJA K", bowlerBalls=0, bowlerRuns=0)]
    assert moments(s) == []


def test_milestone_ignores_a_new_batter():
    """Runs reset on dismissal; 20 -> 51 for a DIFFERENT batter is not a fifty."""
    s = [st(0, strikerName="VENU S", strikerRuns=20),
         st(5, strikerName="RAKESH G", strikerRuns=51, teamRuns=51, ballsBowled=31)]
    assert 'milestone' not in (types_at(s, 0) or [])


def test_milestone_fires_once_per_mark():
    s = [st(0, strikerRuns=49), st(5, strikerRuns=51, teamRuns=52, ballsBowled=31),
         st(10, strikerRuns=53, teamRuns=54, ballsBowled=32)]
    ms = moments(s)
    assert sum(1 for m in ms if 'milestone' in m['types']) == 1


def test_innings_change_does_not_invent_events():
    """Everything resets at the innings break; no wicket, no boundary."""
    s = [st(0, innings=0, teamRuns=150, wickets=8),
         st(5, innings=1, teamRuns=4, wickets=0, ballsBowled=2,
            outcome=OUTCOME.index('4'))]
    assert moments(s) == []


def test_moment_carries_the_context_a_caption_needs():
    s = [st(0), st(5, teamRuns=56, ballsBowled=31, outcome=OUTCOME.index('6'))]
    m = moments(s)[0]
    assert m['striker'] == "VENU S" and m['bowler'] == "ANKIT K"
    assert m['score'] == "56/1" and m['outcome'] == '6' and m['innings'] == 1
    assert m['t'] == 5.0 and m['until'] == 10.0


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    bad = 0
    for fn in fns:
        try:
            fn(); print(f"  PASS  {fn.__name__}")
        except AssertionError as e:
            bad += 1; print(f"  FAIL  {fn.__name__}  {e}")
        except Exception as e:
            bad += 1; print(f"  ERROR {fn.__name__}  {type(e).__name__}: {e}")
    print(f"\n{len(fns) - bad}/{len(fns)} passed")
    sys.exit(1 if bad else 0)
