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


def mo(t, types, innings, striker="J. ROOT", bowler="ANKIT K", **rest):
    m = {"t": float(t), "until": float(t) + 5.0, "types": list(types),
         "anchor": types[0], "ball": 30, "innings": innings, "outcome": "4",
         "striker": striker, "bowler": bowler, "score": "50/1",
         "strikerScore": "20(15)", "bowlerWicket": True}
    m.update(rest)
    return m


# ---------------------------------------------------------------- batting side

def test_our_boundary_goes_to_the_striker():
    got = attribute([mo(10, ["four"], 1)], batting_innings=1)
    assert list(got) == [("J. ROOT", "bat")], got


def test_our_wicket_is_not_a_batting_highlight():
    """Our batter being dismissed does not belong in their own highlight reel."""
    got = attribute([mo(10, ["wicket"], 1)], batting_innings=1)
    assert got == {}, got


def test_a_boundary_that_also_broke_a_partnership_is_still_one_clip():
    got = attribute([mo(10, ["four", "partnership"], 1)], batting_innings=1)
    assert got[("J. ROOT", "bat")][0]["_kinds"] == ["four"], got


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
    assert sorted(right) == [("ANKIT K", "bowl"), ("J. ROOT", "bat")], right
    # With the flag flipped, the four is read as the opposition's and the wicket as
    # ours-while-batting, so neither survives.
    assert wrong == {}, wrong


def test_second_innings_batting_works_the_same_way():
    got = attribute([mo(10, ["six"], 2), mo(20, ["wicket"], 1)], batting_innings=2)
    assert got[("J. ROOT", "bat")][0]["_kinds"] == ["six"]
    assert got[("ANKIT K", "bowl")][0]["_kinds"] == ["wicket"]


def test_several_players_group_separately():
    ms = [mo(10, ["four"], 1, striker="J. ROOT"),
          mo(20, ["six"], 1, striker="HEMANTH B"),
          mo(30, ["four"], 1, striker="J. ROOT")]
    got = attribute(ms, batting_innings=1)
    assert len(got[("J. ROOT", "bat")]) == 2 and len(got[("HEMANTH B", "bat")]) == 1, got


def test_an_all_rounder_gets_one_reel_per_role():
    """🛑 Keyed by name alone, a four and a wicket would share one reel and the caption
    would read the role off the first moment — batting figures over a wicket."""
    ms = [mo(10, ["four"], 1, striker="J. ROOT"),
          mo(60, ["wicket"], 2, bowler="J. ROOT")]
    got = attribute(ms, batting_innings=1)
    assert sorted(got) == [("J. ROOT", "bat"), ("J. ROOT", "bowl")], got
    assert got[("J. ROOT", "bat")][0]["_kinds"] == ["four"]
    assert got[("J. ROOT", "bowl")][0]["_kinds"] == ["wicket"]


def test_each_role_keeps_its_own_role_marker():
    ms = [mo(10, ["four"], 1, striker="J. ROOT"), mo(60, ["wicket"], 2, bowler="J. ROOT")]
    got = attribute(ms, batting_innings=1)
    assert got[("J. ROOT", "bat")][0]["_role"] == "bat"
    assert got[("J. ROOT", "bowl")][0]["_role"] == "bowl"


# ---------------------------------------------------------------- presentation

def test_tally_reads_naturally_and_puts_the_best_first():
    ms = attribute([mo(10, ["four"], 1), mo(20, ["four"], 1), mo(30, ["six"], 1)],
                   batting_innings=1)[("J. ROOT", "bat")]
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
    f = dict(strikerName="J. ROOT", strikerRuns=0, strikerBalls=0, strikerFours=0,
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
    fig = figures(states, "J. ROOT", "bat")
    assert (fig["runs"], fig["balls"], fig["sixes"]) == (60, 40, 2), fig


def test_figures_ignore_other_players_states():
    states = [stt(strikerName="OTHER", strikerRuns=99), stt(strikerRuns=12)]
    assert figures(states, "J. ROOT", "bat")["runs"] == 12


def test_figures_read_bowling_as_wickets_for_runs():
    states = [stt(bowlerBalls=6, bowlerRuns=8, bowlerWickets=1),
              stt(bowlerBalls=24, bowlerRuns=24, bowlerWickets=3)]
    fig = figures(states, "ANKIT K", "bowl")
    assert (fig["wickets"], fig["runs"], fig["balls"]) == (3, 24, 24), fig


def test_figures_are_none_without_states():
    """detect.py output has no states; captions must degrade, not invent numbers."""
    assert figures([], "J. ROOT", "bat") is None


def test_title_reads_like_a_scorecard_line():
    ms = attribute([mo(10, ["six"], 1), mo(20, ["four"], 1)], batting_innings=1)[("J. ROOT", "bat")]
    fig = {"runs": 46, "balls": 28, "fours": 1, "sixes": 1}
    t = build_title("J. ROOT", ms, fig, "Topguns vs Bazzigarz")
    assert t == "J. Root 46 (28) — 1 six, 1 four | Topguns vs Bazzigarz", t


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
    ms = attribute([mo(10, ["six"], 1)], batting_innings=1)[("J. ROOT", "bat")]
    t = build_title("J. ROOT", ms, None, "Topguns vs Bazzigarz")
    assert t == "J. Root — 1 six | Topguns vs Bazzigarz", t


def test_title_drops_the_fixture_before_the_players_own_figures():
    """A long team name must not push the scorecard line out of the title."""
    ms = attribute([mo(10, ["six"], 1)], batting_innings=1)[("J. ROOT", "bat")]
    fig = {"runs": 46, "balls": 28, "fours": 0, "sixes": 1}
    t = build_title("J. ROOT", ms, fig, "M" * 120)
    assert t.startswith("J. Root 46 (28)"), t
    assert len(t) <= 100 and "MMM" not in t, t


def test_metadata_names_the_player_and_tags_the_team():
    ms = attribute([mo(10, ["six"], 1)], batting_innings=1)[("J. ROOT", "bat")]
    meta = metadata("J. ROOT", ms, [[0.0, 10.0, "six"]], "Topguns vs Bazzigarz", "Topguns")
    assert "J. Root" in meta["title"] and "Topguns vs Bazzigarz" in meta["title"]
    assert "six" in meta["tags"] and "topguns" in meta["tags"]
    assert "shorts" in meta["tags"]


def test_description_stamps_each_ball_with_the_over_and_score():
    ms = attribute([mo(10, ["four"], 1, ball=13), mo(40, ["six"], 1, ball=20)],
                   batting_innings=1)[("J. ROOT", "bat")]
    segs = [[0.0, 20.0, "four"], [30.0, 50.0, "six"]]
    body = metadata("J. ROOT", ms, segs, "", "Topguns")["description"]
    assert "0:00  four (2.1 ov, 50/1)" in body, body
    assert "0:20  six (3.2 ov, 50/1)" in body, body
    assert "Ankit" not in body, "named the opposition bowler"


def test_description_carries_the_batting_boundary_breakdown():
    ms = attribute([mo(10, ["six"], 1)], batting_innings=1)[("J. ROOT", "bat")]
    states = [stt(strikerRuns=46, strikerBalls=28, strikerFours=3, strikerSixes=2)]
    body = metadata("J. ROOT", ms, [[0.0, 10.0, "six"]], "", "T", states)["description"]
    assert "J. Root: 46 (28), 3 fours and 2 sixes" in body, body


def test_breakdown_omits_zero_counts():
    """'1x4, 0x6' reads like a bug."""
    assert breakdown({"fours": 1, "sixes": 0}, "bat") == "1 four"
    assert breakdown({"fours": 0, "sixes": 2}, "bat") == "2 sixes"
    assert breakdown({"fours": 0, "sixes": 0}, "bat") == ""
    assert breakdown(None, "bat") == ""


def test_description_separates_the_innings_from_what_the_reel_holds():
    """🛑 If the stream started mid-innings the two legitimately differ; say which is which."""
    ms = attribute([mo(10, ["six"], 1)], batting_innings=1)[("J. ROOT", "bat")]
    states = [stt(strikerRuns=46, strikerBalls=28, strikerFours=3, strikerSixes=2)]
    body = metadata("J. ROOT", ms, [[0.0, 10.0, "six"]], "", "T", states)["description"]
    assert "J. Root: 46 (28), 3 fours and 2 sixes" in body   # the full innings
    assert "in this reel: 1 six" in body, body              # only what was captured


def test_description_has_a_shorts_hashtag_for_discovery():
    ms = attribute([mo(10, ["six"], 1)], batting_innings=1)[("J. ROOT", "bat")]
    body = metadata("J. ROOT", ms, [[0.0, 10.0, "six"]], "", "Topguns")["description"]
    assert "#Shorts" in body and "#Topguns" in body, body


def test_metadata_says_when_a_boundary_came_off_a_no_ball():
    """The c455921 case has to survive all the way to the caption."""
    ms = attribute([mo(10, ["six"], 1, outcome="6nb")], batting_innings=1)[("J. ROOT", "bat")]
    meta = metadata("J. ROOT", ms, [[0.0, 10.0, "six"]], "", "Topguns")
    assert "off a no-ball" in meta["description"], meta["description"]


def test_metadata_respects_youtube_field_limits():
    ms = attribute([mo(10, ["four"], 1)] * 200, batting_innings=1)[("J. ROOT", "bat")]
    segs = [[float(i), float(i) + 5, "four"] for i in range(200)]
    meta = metadata("J. ROOT", ms, segs, "M" * 200, "Topguns")
    assert len(meta["title"]) <= 100
    assert len(meta["description"]) <= 5000


def test_a_fielding_wicket_gives_the_score_but_NOT_the_batters_name():
    """🛑 Inverted deliberately. This test used to assert the dismissed batter WAS named.

    The club does not put opposition players in public captions, so the name goes and the
    score stays: a number is the useful part and is not a name.
    """
    ms = attribute([mo(10, ["wicket"], 2, striker="R. SHARMA", strikerScore="34(32)")],
                   batting_innings=1)[("ANKIT K", "bowl")]
    body = metadata("ANKIT K", ms, [[0.0, 10.0, "wicket"]], "", "Topguns")["description"]
    assert "34(32)" in body, body
    assert "Sharma" not in body and "SHARMA" not in body, body


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


# --- scorer retractions and all-rounder reels ------------------------------------------

def test_dedupe_drops_a_retracted_and_reentered_ball():
    """🛑 The scorer retracted a boundary and re-entered it 256 s later. The duplicate's
    timestamp is not the ball's, so its clip showed a different player getting out."""
    from reels import dedupe_moments
    base = {"innings": 1, "ball": 109, "striker": "A", "strikerScore": "10(5)",
            "score": "213/3", "outcome": "4", "types": ["four"]}
    ms, n = dedupe_moments([{**base, "t": 8862.4}, {**base, "t": 9118.2}])
    assert n == 1 and len(ms) == 1, f"dropped {n}, kept {len(ms)}"
    assert ms[0]["t"] == 8862.4, "the earlier timestamp is the one nearer the ball"


def test_dedupe_keeps_two_genuinely_different_balls():
    """⚠ Load-bearing: a signature differing only by ball number must survive, or the dedupe
    would silently eat a batter's repeated identical-looking boundaries."""
    from reels import dedupe_moments
    base = {"innings": 1, "striker": "A", "strikerScore": "10(5)", "score": "213/3",
            "outcome": "4", "types": ["four"]}
    ms, n = dedupe_moments([{**base, "ball": 109, "t": 100.0},
                            {**base, "ball": 115, "t": 200.0}])
    assert n == 0 and len(ms) == 2, f"ate a real ball: dropped {n}"


def test_all_rounder_gets_one_reel_with_both_figures():
    from reels import combine_all_rounders, headline, roles_in
    bat = [{"t": 10.0, "_role": "bat", "_kinds": ["four"], "types": ["four"]}]
    bowl = [{"t": 500.0, "_role": "bowl", "_kinds": ["wicket"], "types": ["wicket"]}]
    out = combine_all_rounders({("A", "bat"): bat, ("A", "bowl"): bowl,
                                ("B", "bat"): list(bat)})
    assert ("A", "all") in out, "all-rounder was not collapsed into one reel"
    assert ("A", "bat") not in out and ("A", "bowl") not in out, "split reels remain"
    assert ("B", "bat") in out, "a single-role player must be untouched"
    assert [m["t"] for m in out[("A", "all")]] == [10.0, 500.0], "not in time order"
    assert roles_in(out[("A", "all")]) == ["bat", "bowl"]
    states = [{"fields": {"strikerName": "A", "strikerRuns": 7, "strikerBalls": 4,
                          "strikerFours": 1, "strikerSixes": 0}},
              {"fields": {"bowlerName": "A", "bowlerWickets": 4, "bowlerRuns": 10,
                          "bowlerBalls": 13, "bowlerMaidens": 0}}]
    h = headline("A", out[("A", "all")], None, states)
    assert "7 (4)" in h and "4/10" in h and "&" in h, f"headline lost a role: {h!r}"


def test_each_moment_keeps_its_own_role_in_a_combined_reel():
    """⚠ Clip width and the commentary line are per-role, so roles must survive the merge —
    this is the all-rounder bug from §13aa in a new place."""
    from reels import combine_all_rounders
    bat = [{"t": 10.0, "_role": "bat", "_kinds": ["four"], "types": ["four"]}]
    bowl = [{"t": 500.0, "_role": "bowl", "_kinds": ["wicket"], "types": ["wicket"]}]
    out = combine_all_rounders({("A", "bat"): bat, ("A", "bowl"): bowl})
    assert [m["_role"] for m in out[("A", "all")]] == ["bat", "bowl"], "roles lost"


# --- hand-measured overrides -----------------------------------------------------------

def test_override_replaces_an_aligned_shot():
    from reels import apply_overrides
    ov = {"shots": {8862.4: 8836.5}, "drop": set()}
    out, n = apply_overrides({8862.4: (8847.5, 8847.5)}, ov)
    assert n == 1 and out[8862.4] == (8836.5, 8836.5), out


def test_override_restores_a_ball_the_aligner_never_placed():
    """⚠ The main case: a delivery the video could not supply at all."""
    from reels import apply_overrides
    ov = {"shots": {11342.0: 11315.5}, "drop": set()}
    out, n = apply_overrides({}, ov)
    assert n == 1 and out[11342.0] == (11315.5, 11315.5), out


def test_override_leaves_other_balls_alone():
    """🛑 Load-bearing: an override must not disturb a clip already confirmed good."""
    from reels import apply_overrides
    ov = {"shots": {8862.4: 8836.5}, "drop": set()}
    before = {2182.2: (2169.5, 2169.5), 8862.4: (8847.5, 8847.5)}
    out, _ = apply_overrides(before, ov)
    assert out[2182.2] == (2169.5, 2169.5), "clobbered an untouched ball"


def test_override_matches_on_a_nearby_entry_time():
    """Entry times come from the payload at ~2 Hz, so an override may be off by a fraction."""
    from reels import apply_overrides
    ov = {"shots": {8862.4: 8836.5}, "drop": set()}
    out, _ = apply_overrides({8862.55: (8847.5, 8847.5)}, ov)
    assert 8862.55 not in out, "left the stale entry behind as a duplicate clip"
    assert out[8862.4] == (8836.5, 8836.5)


def test_no_override_file_is_a_no_op():
    from reels import apply_overrides, load_overrides
    ov = load_overrides(None)
    before = {2182.2: (2169.5, 2169.5)}
    out, n = apply_overrides(before, ov)
    assert n == 0 and out == before


def test_the_shipped_override_file_is_well_formed():
    """⚠ It is hand-written, so a typo would silently mis-cut a clip."""
    import os
    from reels import load_overrides
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "overrides", "vs-atx-panthers.json")
    if not os.path.exists(path):
        return
    ov = load_overrides(path)
    assert ov["shots"], "no overrides in the file"
    for entry, shot in ov["shots"].items():
        assert shot < entry, f"shot {shot} must precede its entry {entry}"
        assert 0 < entry - shot < 300, f"implausible lag {entry - shot:.1f}s for {entry}"


# --- the ig-caption-writer hard rules --------------------------------------------------
# 🛑 These are the rules the Instagram skill enforces, and every one of them is
# mechanically checkable, so a caption that breaks one fails here rather than on the feed.

FORBIDDEN = ("leverage", "fundamentally", "streamline", "harness", "delve", "unlock",
             "elevate", "empower", "dive in", "deep dive", "game-changer", "level up",
             "next level", "must-have", "it's not just", "in today's fast-paced")


def _sample_caption(states=None):
    ms = attribute([mo(10, ["four"], 1, ball=13), mo(40, ["four"], 1, ball=14)],
                   batting_innings=1)[("J. ROOT", "bat")]
    segs = [[0.0, 8.0, "four"], [30.0, 38.0, "four"]]
    return metadata("J. ROOT", ms, segs, "Topguns United vs ATX Panthers",
                    "Topguns United", states)


def test_the_hook_fits_inside_instagrams_fold():
    """🛑 Instagram hides everything past ~125 chars. A hook needing line 2 is unread."""
    body = _sample_caption()["description"]
    first = body.split("\n")[0]
    assert len(first) <= 125, f"hook is {len(first)} chars: {first!r}"
    assert first.strip(), "hook line is empty"


def test_the_hook_carries_a_number():
    """Specific numbers beat adjectives — the voice rules' rule 5."""
    body = _sample_caption()["description"]
    first = body.split("\n")[0]
    assert any(c.isdigit() for c in first), f"no number in the hook: {first!r}"


def test_hashtags_are_sized_not_stacked():
    """🛑 3-5 sized tags, never 30. The 30-tag block is the 2026 spam tell."""
    meta = _sample_caption()
    assert 3 <= len(meta["hashtags"]) <= 5, meta["hashtags"]
    in_body = [w for w in meta["description"].split() if w.startswith("#")]
    assert len(in_body) <= 6, f"{len(in_body)} hashtags in the body: {in_body}"


def test_no_ai_vocabulary():
    body = _sample_caption()["description"].lower()
    hits = [w for w in FORBIDDEN if w in body]
    assert not hits, f"forbidden vocabulary: {hits}"


def test_em_dashes_stay_under_the_cap():
    """About one per 100 words. A 13-clip list built from dashes blows this on its own."""
    body = _sample_caption()["description"]
    words = len(body.split())
    assert body.count("\u2014") <= max(1, words // 100), (
        f"{body.count(chr(8212))} em dashes in {words} words")


def test_no_call_to_action_and_no_provenance_line():
    """🛑 Both were removed at the owner's request. Do not reinstate either.

    The ig-caption-writer skill asks for one CTA; this overrides it deliberately, so the
    test pins the absence rather than leaving a future edit to quietly add one back.
    """
    body = _sample_caption()["description"].lower()
    for gone in ("send this to", "score.abhinav.dev", "scrubbing the footage",
                 "burnt into the stream"):
        assert gone not in body, f"{gone!r} came back into the caption"


def test_still_no_engagement_bait():
    body = _sample_caption()["description"].lower()
    for bait in ("double tap", "comment yes", "what do you think", "tag a friend",
                 "like and share"):
        assert bait not in body, f"engagement bait: {bait!r}"


def test_the_caption_ends_on_the_hashtags():
    """With the CTA and link gone, the tag line is the last thing in the caption."""
    body = _sample_caption()["description"].rstrip()
    assert body.split("\n")[-1].startswith("#"), body.split("\n")[-1]


def test_a_caption_survives_having_no_states():
    """🛑 detect.py output has no states, so captions must degrade, not go contentless."""
    body = _sample_caption(states=None)["description"]
    first = body.split("\n")[0]
    assert "highlights." != first, "fell back to a contentless hook"
    assert len(first) <= 125 and first.strip()


def test_counts_are_pluralised():
    """⚠ "1 fours" reads as a bug to anyone who sees it on the feed."""
    from reels import plural
    assert plural(1, "four") == "1 four"
    assert plural(3, "four") == "3 fours"
    assert plural(1, "six", "sixes") == "1 six"
    assert plural(2, "six", "sixes") == "2 sixes"
    ms = attribute([mo(10, ["four"], 1, ball=13)], batting_innings=1)[("J. ROOT", "bat")]
    states = [stt(strikerRuns=4, strikerBalls=1, strikerFours=1, strikerSixes=0)]
    body = metadata("J. ROOT", ms, [[0.0, 8.0, "four"]], "", "T", states)["description"]
    assert "1 fours" not in body, body
    assert "1 four" in body, body


def test_an_all_rounder_labels_each_discipline_once():
    """An all-rounder reel must not print the player's name on both support lines."""
    bat = [{"t": 10.0, "_role": "bat", "_kinds": ["four"], "types": ["four"],
            "ball": 13, "bowler": "X", "score": "50/1", "strikerScore": "4(1)"}]
    bowl = [{"t": 500.0, "_role": "bowl", "_kinds": ["wicket"], "types": ["wicket"],
             "ball": 60, "striker": "Y", "score": "60/5", "strikerScore": "2(3)"}]
    states = [stt(strikerName="J. ROOT", strikerRuns=7, strikerBalls=4, strikerFours=1,
                  strikerSixes=0),
              stt(bowlerName="J. ROOT", bowlerWickets=4, bowlerRuns=10, bowlerBalls=13,
                  bowlerMaidens=0)]
    body = metadata("J. ROOT", bat + bowl, [[0.0, 8.0, "four"], [30.0, 38.0, "wicket"]],
                    "", "T", states)["description"]
    assert "with the bat:" in body and "with the ball:" in body, body
    assert body.count("J. Root:") == 0, "repeated the name instead of labelling"


def test_the_support_line_does_not_echo_the_hooks_number():
    """⚠ A caption that repeats itself in the first two lines reads as generated."""
    ms = attribute([mo(10, ["four"], 1, ball=13), mo(40, ["four"], 1, ball=30)],
                   batting_innings=1)[("J. ROOT", "bat")]
    states = [stt(strikerRuns=31, strikerBalls=22, strikerFours=4, strikerSixes=0)]
    body = metadata("J. ROOT", ms, [[0.0, 8.0, "four"], [30.0, 38.0, "four"]],
                    "", "T", states)["description"]
    assert body.lower().count("strike rate") <= 1, body


def test_no_opposition_name_reaches_the_caption():
    """🛑 Load-bearing. Opponents appear in the payload as the bowler a boundary came off and
    the batter a wicket dismissed. Neither goes in a public caption.

    ⚠ Checks a BATTING reel and a BOWLING reel, because the opponent sits in a different
    field for each: `bowler` for our batter, `striker` for our bowler.
    """
    bat = attribute([mo(10, ["four"], 1, ball=13, bowler="ZZOPPBOWLER Q"),
                     mo(40, ["four"], 1, ball=14, bowler="ZZOPPBOWLER Q")],
                    batting_innings=1)[("J. ROOT", "bat")]
    body = metadata("J. ROOT", bat, [[0.0, 8.0, "four"], [30.0, 38.0, "four"]],
                    "Topguns vs Rivals", "Topguns", None, "", "LPCL", "leather",
                    "T20 2026")["description"]
    assert "ZZOPPBOWLER" not in body.upper(), body
    # ⚠ The opposing TEAM stays: the fixture line is normal for a highlight caption and a
    # club is not a person. Only opposition PLAYERS are withheld.
    assert "Rivals" in body, "the fixture line should still name the opposing team"

    # For a bowling reel the attributed player is the BOWLER, so name it explicitly; the
    # striker is the opponent whose name must not survive.
    bowl = attribute([mo(10, ["wicket"], 2, bowler="J. ROOT", striker="ZZOPPBAT R",
                         strikerScore="7(9)")],
                     batting_innings=1)[("J. ROOT", "bowl")]
    body2 = metadata("J. ROOT", bowl, [[0.0, 8.0, "wicket"]], "Topguns vs Rivals",
                     "Topguns", None, "", "LPCL", "leather", "T20 2026")["description"]
    assert "ZZOPPBAT" not in body2.upper(), body2
    assert "7(9)" in body2, "dropped the score along with the name"


def test_the_tag_set_is_the_clubs_own():
    from reels import hashtags
    t = hashtags("Topguns United", "LPCL", "leather", "T20 Fall 2026", ["bat"])
    assert t[0] == "#Topguns", t            # first word only, not #TopgunsUnited
    assert "#LPCL" in t and "#LeatherBall" in t and "#T20Fall2026" in t, t
    assert not any("vs" in x.lower() for x in t), "a per-fixture tag came back"
    assert "#cricket" in t and "#clubcricket" in t, t
    tape = hashtags("Topguns United", "LPCL", "tape", "", ["bowl"])
    assert "#TapeBall" in tape and "#cricketbowling" in tape, tape


def test_the_tag_set_degrades_without_the_new_flags():
    """⚠ The flags are optional; omitting them must not leave a stray '#' or a blank tag."""
    from reels import hashtags
    t = hashtags("Topguns United", "", "", "", ["bat"])
    assert all(len(x) > 1 and x.startswith("#") for x in t), t
    assert "#Topguns" in t and "#cricket" in t, t


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
