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
from cut import crop_filter
from reels import (attribute, breakdown, build_title, figures, metadata, over,
                   parse_aspects, slug, tally, titlecase)


def mo(t, types, innings, striker="VENU S", bowler="ANKIT K", **rest):
    m = {"t": float(t), "until": float(t) + 5.0, "types": list(types),
         "anchor": types[0], "ball": 30, "innings": innings, "outcome": "4",
         "striker": striker, "bowler": bowler, "score": "50/1",
         "strikerScore": "20(15)", "bowlerWicket": True}
    m.update(rest)
    return m


# ---------------------------------------------------------------- batting side

def test_our_boundary_goes_to_the_striker():
    got = attribute([mo(10, ["four"], 1)], batting_innings=1)
    assert list(got) == [("VENU S", "bat")], got


def test_our_wicket_is_not_a_batting_highlight():
    """Our batter being dismissed does not belong in their own highlight reel."""
    got = attribute([mo(10, ["wicket"], 1)], batting_innings=1)
    assert got == {}, got


def test_a_boundary_that_also_broke_a_partnership_is_still_one_clip():
    got = attribute([mo(10, ["four", "partnership"], 1)], batting_innings=1)
    assert got[("VENU S", "bat")][0]["_kinds"] == ["four"], got


# ---------------------------------------------------------------- fielding side

def test_their_wicket_goes_to_our_bowler():
    got = attribute([mo(10, ["wicket"], 2)], batting_innings=1)
    assert list(got) == [("ANKIT K", "bowl")], got


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
    assert list(attribute([m], batting_innings=1)) == [("ANKIT K", "bowl")]


# ---------------------------------------------------------------- the innings flag

def test_the_batting_innings_flag_inverts_everything():
    """🛑 Passing the wrong innings credits our events to the opposition and vice versa."""
    ours = [mo(10, ["four"], 1), mo(20, ["wicket"], 2)]
    right = attribute(ours, batting_innings=1)
    wrong = attribute(ours, batting_innings=2)
    assert sorted(right) == [("ANKIT K", "bowl"), ("VENU S", "bat")], right
    # With the flag flipped, the four is read as the opposition's and the wicket as
    # ours-while-batting, so neither survives.
    assert wrong == {}, wrong


def test_second_innings_batting_works_the_same_way():
    got = attribute([mo(10, ["six"], 2), mo(20, ["wicket"], 1)], batting_innings=2)
    assert got[("VENU S", "bat")][0]["_kinds"] == ["six"]
    assert got[("ANKIT K", "bowl")][0]["_kinds"] == ["wicket"]


def test_several_players_group_separately():
    ms = [mo(10, ["four"], 1, striker="VENU S"),
          mo(20, ["six"], 1, striker="HEMANTH B"),
          mo(30, ["four"], 1, striker="VENU S")]
    got = attribute(ms, batting_innings=1)
    assert len(got[("VENU S", "bat")]) == 2 and len(got[("HEMANTH B", "bat")]) == 1, got


def test_an_all_rounder_gets_one_reel_per_role():
    """🛑 Keyed by name alone, a four and a wicket would share one reel and the caption
    would read the role off the first moment — batting figures over a wicket."""
    ms = [mo(10, ["four"], 1, striker="VENU S"),
          mo(60, ["wicket"], 2, bowler="VENU S")]
    got = attribute(ms, batting_innings=1)
    assert sorted(got) == [("VENU S", "bat"), ("VENU S", "bowl")], got
    assert got[("VENU S", "bat")][0]["_kinds"] == ["four"]
    assert got[("VENU S", "bowl")][0]["_kinds"] == ["wicket"]


def test_each_role_keeps_its_own_role_marker():
    ms = [mo(10, ["four"], 1, striker="VENU S"), mo(60, ["wicket"], 2, bowler="VENU S")]
    got = attribute(ms, batting_innings=1)
    assert got[("VENU S", "bat")][0]["_role"] == "bat"
    assert got[("VENU S", "bowl")][0]["_role"] == "bowl"


# ---------------------------------------------------------------- presentation

def test_tally_reads_naturally_and_puts_the_best_first():
    ms = attribute([mo(10, ["four"], 1), mo(20, ["four"], 1), mo(30, ["six"], 1)],
                   batting_innings=1)[("VENU S", "bat")]
    assert tally(ms) == "1 six, 2 fours", tally(ms)


def test_tally_is_singular_for_one():
    ms = attribute([mo(10, ["wicket"], 2)], batting_innings=1)[("ANKIT K", "bowl")]
    assert tally(ms) == "1 wicket", tally(ms)


def test_titlecase_does_not_shout():
    assert titlecase("V. KOHLI") == "V. Kohli"


def test_slug_is_filesystem_safe():
    assert slug("V. KOHLI") == "v-kohli"
    assert slug("O'BRIEN, M") == "o-brien-m"
    assert slug("???") == "unknown"


def stt(**over_):
    """A state for figures(): only the fields figures() reads."""
    f = dict(strikerName="VENU S", strikerRuns=0, strikerBalls=0, strikerFours=0,
             strikerSixes=0, bowlerName="ANKIT K", bowlerBalls=0, bowlerRuns=0,
             bowlerWickets=0, bowlerMaidens=0)
    f.update(over_)
    return {"fields": f}


def test_over_uses_cricket_notation_not_decimals():
    assert over(13) == "2.1" and over(12) == "2.0" and over(0) == "0.0"


def test_figures_take_the_batters_highest_score_not_the_last_boundary():
    """A batter whose last four came at 20 but finished on 60 must read 60."""
    states = [stt(strikerRuns=20, strikerBalls=15, strikerFours=2),
              stt(strikerRuns=60, strikerBalls=40, strikerFours=5, strikerSixes=2)]
    fig = figures(states, "VENU S", "bat")
    assert (fig["runs"], fig["balls"], fig["sixes"]) == (60, 40, 2), fig


def test_figures_ignore_other_players_states():
    states = [stt(strikerName="OTHER", strikerRuns=99), stt(strikerRuns=12)]
    assert figures(states, "VENU S", "bat")["runs"] == 12


def test_figures_read_bowling_as_wickets_for_runs():
    states = [stt(bowlerBalls=6, bowlerRuns=8, bowlerWickets=1),
              stt(bowlerBalls=24, bowlerRuns=24, bowlerWickets=3)]
    fig = figures(states, "ANKIT K", "bowl")
    assert (fig["wickets"], fig["runs"], fig["balls"]) == (3, 24, 24), fig


def test_figures_are_none_without_states():
    """detect.py output has no states; captions must degrade, not invent numbers."""
    assert figures([], "VENU S", "bat") is None


def test_title_reads_like_a_scorecard_line():
    ms = attribute([mo(10, ["six"], 1), mo(20, ["four"], 1)], batting_innings=1)[("VENU S", "bat")]
    fig = {"runs": 46, "balls": 28, "fours": 1, "sixes": 1}
    t = build_title("VENU S", ms, fig, "Topguns vs Bazzigarz")
    assert t == "Venu S 46 (28) — 1 six, 1 four | Topguns vs Bazzigarz", t


def test_bowling_title_reads_as_figures_over_an_over_count():
    """3 in the innings but only 1 captured, so the reel count is real information."""
    ms = attribute([mo(10, ["wicket"], 2)], batting_innings=1)[("ANKIT K", "bowl")]
    fig = {"wickets": 3, "runs": 24, "balls": 24, "maidens": 0}
    t = build_title("ANKIT K", ms, fig, "Topguns vs Bazzigarz")
    assert t == "Ankit K 3/24 (4.0 ov) — 1 wicket | Topguns vs Bazzigarz", t


def test_bowling_title_does_not_say_the_wicket_count_twice():
    """'1/21 (1.4 ov) — 1 wicket' is redundant when the reel holds the whole spell."""
    ms = attribute([mo(10, ["wicket"], 2)], batting_innings=1)[("ANKIT K", "bowl")]
    fig = {"wickets": 1, "runs": 21, "balls": 10, "maidens": 0}
    t = build_title("ANKIT K", ms, fig, "Topguns vs Bazzigarz")
    assert t == "Ankit K 1/21 (1.4 ov) | Topguns vs Bazzigarz", t


def test_title_does_not_repeat_the_tally_when_there_are_no_figures():
    ms = attribute([mo(10, ["six"], 1)], batting_innings=1)[("VENU S", "bat")]
    t = build_title("VENU S", ms, None, "Topguns vs Bazzigarz")
    assert t == "Venu S — 1 six | Topguns vs Bazzigarz", t


def test_title_drops_the_fixture_before_the_players_own_figures():
    """A long team name must not push the scorecard line out of the title."""
    ms = attribute([mo(10, ["six"], 1)], batting_innings=1)[("VENU S", "bat")]
    fig = {"runs": 46, "balls": 28, "fours": 0, "sixes": 1}
    t = build_title("VENU S", ms, fig, "M" * 120)
    assert t.startswith("Venu S 46 (28)"), t
    assert len(t) <= 100 and "MMM" not in t, t


def test_metadata_names_the_player_and_tags_the_team():
    ms = attribute([mo(10, ["six"], 1)], batting_innings=1)[("VENU S", "bat")]
    meta = metadata("VENU S", ms, [[0.0, 10.0, "six"]], "Topguns vs Bazzigarz", "Topguns")
    assert "Venu S" in meta["title"] and "Topguns vs Bazzigarz" in meta["title"]
    assert "six" in meta["tags"] and "topguns" in meta["tags"]
    assert "shorts" in meta["tags"]


def test_description_stamps_each_ball_with_the_over_and_score():
    ms = attribute([mo(10, ["four"], 1, ball=13), mo(40, ["six"], 1, ball=20)],
                   batting_innings=1)[("VENU S", "bat")]
    segs = [[0.0, 20.0, "four"], [30.0, 50.0, "six"]]
    body = metadata("VENU S", ms, segs, "", "Topguns")["description"]
    assert "00:00  FOUR off Ankit K — 2.1 ov, 50/1" in body, body
    assert "00:20  SIX off Ankit K — 3.2 ov, 50/1" in body, body


def test_description_carries_the_batting_boundary_breakdown():
    ms = attribute([mo(10, ["six"], 1)], batting_innings=1)[("VENU S", "bat")]
    states = [stt(strikerRuns=46, strikerBalls=28, strikerFours=3, strikerSixes=2)]
    body = metadata("VENU S", ms, [[0.0, 10.0, "six"]], "", "T", states)["description"]
    assert "Venu S 46 (28), 3 fours, 2 sixes" in body, body


def test_breakdown_omits_zero_counts():
    """'1x4, 0x6' reads like a bug."""
    assert breakdown({"fours": 1, "sixes": 0}, "bat") == "1 four"
    assert breakdown({"fours": 0, "sixes": 2}, "bat") == "2 sixes"
    assert breakdown({"fours": 0, "sixes": 0}, "bat") == ""
    assert breakdown(None, "bat") == ""


def test_description_separates_the_innings_from_what_the_reel_holds():
    """🛑 If the stream started mid-innings the two legitimately differ; say which is which."""
    ms = attribute([mo(10, ["six"], 1)], batting_innings=1)[("VENU S", "bat")]
    states = [stt(strikerRuns=46, strikerBalls=28, strikerFours=3, strikerSixes=2)]
    body = metadata("VENU S", ms, [[0.0, 10.0, "six"]], "", "T", states)["description"]
    assert "Venu S 46 (28), 3 fours, 2 sixes" in body   # the full innings
    assert "In this reel: 1 six" in body, body          # only what was captured


def test_description_has_a_shorts_hashtag_for_discovery():
    ms = attribute([mo(10, ["six"], 1)], batting_innings=1)[("VENU S", "bat")]
    body = metadata("VENU S", ms, [[0.0, 10.0, "six"]], "", "Topguns")["description"]
    assert "#Shorts" in body and "#Topguns" in body, body


def test_metadata_says_when_a_boundary_came_off_a_no_ball():
    """The c455921 case has to survive all the way to the caption."""
    ms = attribute([mo(10, ["six"], 1, outcome="6nb")], batting_innings=1)[("VENU S", "bat")]
    meta = metadata("VENU S", ms, [[0.0, 10.0, "six"]], "", "Topguns")
    assert "off a no-ball" in meta["description"], meta["description"]


def test_metadata_respects_youtube_field_limits():
    ms = attribute([mo(10, ["four"], 1)] * 200, batting_innings=1)[("VENU S", "bat")]
    segs = [[float(i), float(i) + 5, "four"] for i in range(200)]
    meta = metadata("VENU S", ms, segs, "M" * 200, "Topguns")
    assert len(meta["title"]) <= 100
    assert len(meta["description"]) <= 5000


def test_a_fielding_wicket_names_the_dismissed_batter_and_their_score():
    ms = attribute([mo(10, ["wicket"], 2, striker="R. SHARMA", strikerScore="34(32)")],
                   batting_innings=1)[("ANKIT K", "bowl")]
    body = metadata("ANKIT K", ms, [[0.0, 10.0, "wicket"]], "", "Topguns")["description"]
    assert "WICKET — R. Sharma 34(32)" in body, body


# ---------------------------------------------------------------- the crop

def _span(f):
    """-> (start, end) of the crop as fractions of a 3840-wide frame."""
    cw = int(f.split("crop=")[1].split(":")[0])
    x = int(f.split(":")[2].split(",")[0])
    return x / 3840, (x + cw) / 3840


def test_a_9_16_crop_cannot_contain_a_side_on_pitch():
    """🛑 The measured reason square is the default. The pitch spans ~36%-73% of the
    width; a 9:16 window is 31.6% wide, so it cannot hold the pitch anywhere."""
    a, b = _span(crop_filter(3840, 2160, "9:16"))
    assert b - a < 0.73 - 0.36, (a, b)


def test_a_square_crop_contains_the_whole_pitch():
    a, b = _span(crop_filter(3840, 2160, "1:1"))
    assert a <= 0.36 and b >= 0.73, (a, b)


def test_every_aspect_stays_portrait_or_square_so_it_is_a_short():
    """publish.shorts_problems() rejects anything wider than it is tall."""
    for aspect in ("1:1", "4:5", "9:16"):
        f = crop_filter(3840, 2160, aspect)
        w, h = (int(v) for v in f.split("scale=")[1].split(",")[0].split(":"))
        assert h >= w, (aspect, w, h)


def test_every_crop_excludes_the_top_left_data_code():
    """The code sits in the first ~4% of the width; no crop may include it."""
    for aspect in ("1:1", "4:5", "9:16"):
        assert _span(crop_filter(3840, 2160, aspect))[0] > 0.04, aspect


def test_crop_x_moves_the_window():
    left, right = _span(crop_filter(3840, 2160, "9:16", 0.30)), \
                  _span(crop_filter(3840, 2160, "9:16", 0.70))
    assert left[0] < right[0], (left, right)


def test_crop_x_is_clamped_inside_the_frame():
    for c in (-1.0, 0.0, 1.0, 2.0):
        a, b = _span(crop_filter(3840, 2160, "1:1", c))
        assert 0.0 <= a and b <= 1.0, (c, a, b)


def test_crop_dimensions_are_even():
    """h264 needs even dimensions; an odd crop width fails at encode time."""
    for aspect in ("1:1", "4:5", "9:16"):
        f = crop_filter(3840, 2160, aspect)
        cw = int(f.split("crop=")[1].split(":")[0])
        x = int(f.split(":")[2].split(",")[0])
        assert cw % 2 == 0 and x % 2 == 0, (aspect, cw, x)


def test_no_aspect_means_no_crop():
    """🛑 There is no default shape. Omitting the flag leaves the reel at full frame
    rather than silently picking one."""
    assert parse_aspects("") == [None]
    assert parse_aspects("   ") == [None]


def test_a_list_of_aspects_cuts_one_file_each_for_review():
    assert parse_aspects("4:5,1:1") == ["4:5", "1:1"]
    assert parse_aspects(" 4:5 , 1:1 ") == ["4:5", "1:1"]


def test_a_landscape_aspect_is_refused_at_the_cli():
    try:
        parse_aspects("16:9")
    except SystemExit:
        return
    raise AssertionError("expected SystemExit for a landscape aspect")


def test_4_5_holds_both_batting_ends_on_the_reference_camera():
    """Recorded as a measurement, not a default: a batter's end alternates, so a batting
    crop has to contain both sets of stumps (~36% and ~73% there)."""
    a, b = _span(crop_filter(3840, 2160, "4:5"))
    assert a <= 0.36 and b >= 0.725, (a, b)


def test_1_1_is_wider_than_4_5_so_it_can_hold_the_run_up():
    bat = _span(crop_filter(3840, 2160, "4:5"))
    bowl = _span(crop_filter(3840, 2160, "1:1"))
    assert (bowl[1] - bowl[0]) > (bat[1] - bat[0]), (bat, bowl)


def test_an_unknown_aspect_is_refused():
    try:
        crop_filter(3840, 2160, "16:9")
    except ValueError:
        return
    raise AssertionError("expected ValueError for a landscape aspect")


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
