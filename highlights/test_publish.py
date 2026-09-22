"""Tests for the decision logic in publish.py. Pure — no network, no Google libraries.

The parts worth testing are the ones that fail silently in production: a clip that will not be
treated as a Short (YouTube gives no error, it just lands as a normal video), and metadata that
overruns YouTube's field limits.

    python highlights/test_publish.py    # standalone
    pytest highlights/test_publish.py
"""
from __future__ import annotations
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from publish import (shorts_problems, reel_metadata, video_metadata, clip,
                     TITLE_MAX, DESC_MAX, SHORTS_MAX_SECONDS)

MOMENT = {
    "t": 1234.5, "types": ["six"], "anchor": "six", "ball": 57, "innings": 1,
    "outcome": "6", "striker": "VENU S", "bowler": "ANKIT K",
    "score": "88/3", "strikerScore": "0(0)",
}
MATCH = "Topguns vs Bazzigarz — 2026 FTP20 Div-A"


def test_a_vertical_short_clip_qualifies():
    assert shorts_problems({"w": 1080, "h": 1920, "duration": 28.0}) == []


def test_a_square_clip_qualifies():
    """1:1 still counts as a Short."""
    assert shorts_problems({"w": 1080, "h": 1080, "duration": 30.0}) == []


def test_landscape_is_rejected_with_the_reason():
    bad = shorts_problems({"w": 1920, "h": 1080, "duration": 20.0})
    assert len(bad) == 1 and "landscape" in bad[0] and "1920x1080" in bad[0]


def test_too_long_is_rejected():
    bad = shorts_problems({"w": 1080, "h": 1920, "duration": SHORTS_MAX_SECONDS + 0.5})
    assert len(bad) == 1 and "ceiling" in bad[0]


def test_both_problems_are_reported_not_just_the_first():
    bad = shorts_problems({"w": 1920, "h": 1080, "duration": 300.0})
    assert len(bad) == 2


def test_unreadable_dimensions_fail_closed():
    bad = shorts_problems({"w": 0, "h": 0, "duration": 0.0})
    assert len(bad) == 1 and "dimensions" in bad[0]


def test_reel_title_names_the_batter_the_shot_and_the_bowler():
    m = reel_metadata(MOMENT, MATCH)
    assert "Venu S" in m["title"] and "six" in m["title"] and "Ankit K" in m["title"]
    assert "88/3" in m["title"]


def test_a_wicket_reads_as_a_dismissal_not_a_shot():
    m = reel_metadata({**MOMENT, "types": ["wicket"], "anchor": "wicket", "outcome": "W"}, MATCH)
    assert m["title"].startswith("WICKET:")
    assert "Venu S" in m["title"] and "Ankit K" in m["title"]


def test_a_boundary_off_a_no_ball_says_so():
    """The c455921 case has to survive all the way to the caption."""
    m = reel_metadata({**MOMENT, "outcome": "6nb"}, MATCH)
    assert "no-ball" in m["title"]


def test_extra_types_are_mentioned():
    m = reel_metadata({**MOMENT, "types": ["six", "milestone"]}, MATCH)
    assert "milestone" in m["title"]
    assert "fifty" in m["tags"]


def test_metadata_respects_youtube_field_limits():
    long_moment = {**MOMENT, "striker": "A" * 120, "bowler": "B" * 120}
    m = reel_metadata(long_moment, MATCH * 5)
    assert len(m["title"]) <= TITLE_MAX
    assert len(m["description"]) <= DESC_MAX


def test_a_moment_with_nothing_in_it_still_produces_a_usable_title():
    m = reel_metadata({}, None)
    assert m["title"] and len(m["title"]) <= TITLE_MAX


def test_full_video_uses_the_match_name_as_the_title():
    m = video_metadata(MATCH)
    assert m["title"].startswith("Topguns vs Bazzigarz") and "Highlights" in m["title"]


def test_chapters_go_at_the_top_of_the_description():
    """YouTube only makes chapter markers when the first stamp is 00:00 and there are 3+."""
    ch = "00:00 Start\n00:22 four\n00:48 wicket\n01:30 six"
    m = video_metadata(MATCH, ch)
    body = m["description"].splitlines()
    assert body[0] == "00:00 Start"
    assert "01:30 six" in m["description"]


def test_too_few_chapters_are_still_included_as_text():
    m = video_metadata(MATCH, "00:00 Start\n00:30 six")
    assert "00:30 six" in m["description"]


def test_clip_collapses_whitespace_and_ellipsises():
    assert clip("a   b\n c", 99) == "a b c"
    out = clip("x" * 50, 10)
    assert len(out) == 10 and out.endswith("…")


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
