"""Tests for per-player attribution in reels.py. Pure — no video needed.

Attribution is the part of this pipeline that fails SILENTLY. A wrong window makes a clip
that obviously misses the shot; a wrong attribution makes a perfectly good clip filed
under the wrong person, and nothing about the output looks broken. So the rules that
decide whose reel a ball belongs to are pinned here:

  - our team batting  -> a boundary belongs to the striker, and a wicket is not a highlight
  - our team fielding -> a wicket belongs to the bowler, and a boundary is the opposition's
  - a run-out raises the team wicket count but nobody's bowling figure, so it belongs to
    no bowler's reel

    python highlights/test_reels.py    # standalone
    pytest highlights/test_reels.py
"""
from __future__ import annotations
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from reels import attribute, metadata, slug, tally, titlecase


def mo(t, types, innings, striker="VENU S", bowler="ANKIT K", **over):
    m = {"t": float(t), "until": float(t) + 5.0, "types": list(types),
         "anchor": types[0], "ball": 30, "innings": innings, "outcome": "4",
         "striker": striker, "bowler": bowler, "score": "50/1",
         "strikerScore": "20(15)", "bowlerWicket": True}
    m.update(over)
    return m


# ---------------------------------------------------------------- batting side

def test_our_boundary_goes_to_the_striker():
    got = attribute([mo(10, ["four"], 1)], batting_innings=1)
    assert list(got) == ["VENU S"], got
    assert got["VENU S"][0]["_role"] == "bat"


def test_our_wicket_is_not_a_batting_highlight():
    """Our batter being dismissed does not belong in their own highlight reel."""
    got = attribute([mo(10, ["wicket"], 1)], batting_innings=1)
    assert got == {}, got


def test_a_boundary_that_also_broke_a_partnership_is_still_one_clip():
    got = attribute([mo(10, ["four", "partnership"], 1)], batting_innings=1)
    assert got["VENU S"][0]["_kinds"] == ["four"], got["VENU S"][0]["_kinds"]


# ---------------------------------------------------------------- fielding side

def test_their_wicket_goes_to_our_bowler():
    got = attribute([mo(10, ["wicket"], 2)], batting_innings=1)
    assert list(got) == ["ANKIT K"], got
    assert got["ANKIT K"][0]["_role"] == "bowl"


def test_their_boundary_is_not_our_highlight():
    """The opposition hitting a six is nobody on our side's highlight."""
    got = attribute([mo(10, ["six"], 2)], batting_innings=1)
    assert got == {}, got


def test_a_run_out_belongs_to_no_bowler():
    """`wickets` moved but `bowlerWickets` did not, so the bowler did not take it."""
    got = attribute([mo(10, ["wicket"], 2, bowlerWicket=False)], batting_innings=1)
    assert got == {}, got


def test_a_moment_from_an_older_scan_is_still_attributed():
    """Scans predating the bowlerWicket flag must not silently vanish."""
    m = mo(10, ["wicket"], 2)
    del m["bowlerWicket"]
    assert list(attribute([m], batting_innings=1)) == ["ANKIT K"]


# ---------------------------------------------------------------- the innings flag

def test_the_batting_innings_flag_inverts_everything():
    """🛑 Passing the wrong innings credits our events to the opposition and vice versa."""
    ours = [mo(10, ["four"], 1), mo(20, ["wicket"], 2)]
    right = attribute(ours, batting_innings=1)
    wrong = attribute(ours, batting_innings=2)
    assert sorted(right) == ["ANKIT K", "VENU S"], right
    # With the flag flipped, the four is read as the opposition's and the wicket as
    # ours-while-batting, so neither survives.
    assert wrong == {}, wrong


def test_second_innings_batting_works_the_same_way():
    got = attribute([mo(10, ["six"], 2), mo(20, ["wicket"], 1)], batting_innings=2)
    assert got["VENU S"][0]["_kinds"] == ["six"]
    assert got["ANKIT K"][0]["_kinds"] == ["wicket"]


def test_several_players_group_separately():
    ms = [mo(10, ["four"], 1, striker="VENU S"),
          mo(20, ["six"], 1, striker="HEMANTH B"),
          mo(30, ["four"], 1, striker="VENU S")]
    got = attribute(ms, batting_innings=1)
    assert len(got["VENU S"]) == 2 and len(got["HEMANTH B"]) == 1, got


# ---------------------------------------------------------------- presentation

def test_tally_reads_naturally_and_puts_the_best_first():
    ms = attribute([mo(10, ["four"], 1), mo(20, ["four"], 1), mo(30, ["six"], 1)],
                   batting_innings=1)["VENU S"]
    assert tally(ms) == "1 six, 2 fours", tally(ms)


def test_tally_is_singular_for_one():
    ms = attribute([mo(10, ["wicket"], 2)], batting_innings=1)["ANKIT K"]
    assert tally(ms) == "1 wicket", tally(ms)


def test_titlecase_does_not_shout():
    assert titlecase("V. KOHLI") == "V. Kohli"


def test_slug_is_filesystem_safe():
    assert slug("V. KOHLI") == "v-kohli"
    assert slug("O'BRIEN, M") == "o-brien-m"
    assert slug("???") == "unknown"


def test_metadata_names_the_player_and_the_tally():
    ms = attribute([mo(10, ["six"], 1)], batting_innings=1)["VENU S"]
    segs = [[0.0, 10.0, "six"]]
    meta = metadata("VENU S", ms, segs, "Topguns vs Bazzigarz", "Topguns")
    assert meta["title"].startswith("Venu S — 1 six"), meta["title"]
    assert "Topguns vs Bazzigarz" in meta["title"]
    assert "six" in meta["tags"] and "topguns" in meta["tags"]


def test_metadata_description_keeps_one_stamped_line_per_ball():
    ms = attribute([mo(10, ["four"], 1), mo(40, ["six"], 1)], batting_innings=1)["VENU S"]
    segs = [[0.0, 20.0, "four"], [30.0, 50.0, "six"]]
    meta = metadata("VENU S", ms, segs, "", "Topguns")
    body = meta["description"]
    assert "00:00 four off Ankit K" in body, body
    assert "00:20 six off Ankit K" in body, body


def test_metadata_says_when_a_boundary_came_off_a_no_ball():
    """The c455921 case has to survive all the way to the caption."""
    ms = attribute([mo(10, ["six"], 1, outcome="6nb")], batting_innings=1)["VENU S"]
    meta = metadata("VENU S", ms, [[0.0, 10.0, "six"]], "", "Topguns")
    assert "off a no-ball" in meta["description"], meta["description"]


def test_metadata_respects_youtube_field_limits():
    ms = attribute([mo(10, ["four"], 1)] * 200, batting_innings=1)["VENU S"]
    segs = [[float(i), float(i) + 5, "four"] for i in range(200)]
    meta = metadata("VENU S", ms, segs, "M" * 200, "Topguns")
    assert len(meta["title"]) <= 100
    assert len(meta["description"]) <= 5000


def test_a_fielding_wicket_names_the_dismissed_batter():
    ms = attribute([mo(10, ["wicket"], 2, striker="R. SHARMA")], batting_innings=1)["ANKIT K"]
    meta = metadata("ANKIT K", ms, [[0.0, 10.0, "wicket"]], "", "Topguns")
    assert "wicket — R. Sharma" in meta["description"], meta["description"]


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
