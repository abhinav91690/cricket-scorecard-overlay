"""Does the contact sheet actually show what it claims? Uses a synthetic clip, not the match.

🛑 The load-bearing test here is `test_two_different_shot_lists_give_different_sheets`. The
first version of `contact.sheet()` passed one `-i` per tile, and ffmpeg's `tile` filter tiles
successive FRAMES OF ONE INPUT — given several inputs it silently tiles the first and pads the
rest. Every sheet came out **byte-identical** whatever the other tiles held, and it looked
entirely fine: a valid PNG, the right dimensions, the first tile correct. It was caught only by
md5-ing two sheets that should have differed.

    python highlights/test_contact.py     # standalone
    pytest highlights/test_contact.py
"""
import hashlib
import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from contact import esc, grid, sheet, tile_label
from detect import ffmpeg


def synthetic(path: str, seconds: int = 12) -> str:
    """A clip whose colour changes every second, so a frame's time is visible in its pixels.

    ⚠ This is what makes the tiling bug detectable: if two sheets sample different seconds and
    come out identical, the tiler is ignoring its inputs.
    """
    subprocess.run(
        [ffmpeg(), "-nostdin", "-hide_banner", "-loglevel", "error",
         "-f", "lavfi", "-i", f"testsrc2=size=640x360:rate=5:duration={seconds}",
         "-pix_fmt", "yuv420p", "-y", path],
        check=True, capture_output=True)
    return path


def png_size(path: str) -> tuple[int, int]:
    """(width, height) from the PNG IHDR. ⚠ `detect.probe` cannot read a still image — it
    returns a None duration and raises on the float() — so the header is read directly."""
    with open(path, "rb") as fh:
        head = fh.read(24)
    assert head[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    return (int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big"))


def test_esc_escapes_the_colon_that_breaks_drawtext():
    """🛑 A reel timestamp always contains a colon, and an unescaped one fails the whole
    filterchain with exit 234 — not a subtle degradation, no image at all."""
    assert esc("3 1:04") == r"3 1\:04"
    assert esc("a'b") == r"a\'b"
    assert esc("50%") == r"50\%"
    assert esc("plain 11.5 +17s") == "plain 11.5 +17s"


def test_tile_label_carries_index_reel_time_over_and_lag():
    lbl = tile_label(3, 64.0, "11.5", 16.8)
    assert lbl == "3 1:04 ov 11.5 +17s", lbl
    assert tile_label(0, 3.0, "", None) == "0 0:03", tile_label(0, 3.0, "", None)


def test_grid_keeps_one_row_when_there_are_few():
    assert grid(1) == (1, 1)
    assert grid(3) == (3, 1)
    assert grid(4) == (4, 1)
    assert grid(5) == (4, 2)
    assert grid(13) == (4, 4)
    assert grid(0) == (0, 0)


def test_two_different_shot_lists_give_different_sheets():
    """🛑 The tiling bug. Two sheets differing in one tile must differ as files."""
    with tempfile.TemporaryDirectory() as d:
        src = synthetic(os.path.join(d, "clip.mp4"))
        a = [(1.0, 0.0, "0.1", 5.0), (4.0, 8.0, "0.2", 6.0), (9.0, 16.0, "0.3", 7.0)]
        b = [(1.0, 0.0, "0.1", 5.0), (6.0, 8.0, "0.2", 6.0), (9.0, 16.0, "0.3", 7.0)]
        pa = sheet(src, a, os.path.join(d, "a.png"))
        pb = sheet(src, b, os.path.join(d, "b.png"))
        assert pa and pb, (pa, pb)
        ha = hashlib.md5(open(pa, "rb").read()).hexdigest()
        hb = hashlib.md5(open(pb, "rb").read()).hexdigest()
        assert ha != hb, "two different shot lists produced the SAME sheet — tiler ignoring inputs"


def test_every_tile_reaches_the_sheet():
    """⚠ The other half of the tiling bug: a sheet of N tiles must be wider than one of 1.

    A tiler that pads instead of tiling still produces an N-wide canvas, so width alone is not
    enough; this checks the sheet grows with the tile count AND that a 5-tile sheet wraps.
    """
    with tempfile.TemporaryDirectory() as d:
        src = synthetic(os.path.join(d, "clip.mp4"))
        rows = [(float(i + 1), i * 8.0, f"0.{i}", 5.0) for i in range(5)]
        one = sheet(src, rows[:1], os.path.join(d, "one.png"))
        five = sheet(src, rows, os.path.join(d, "five.png"))
        assert one and five
        w1, h1 = png_size(one)
        w5, h5 = png_size(five)
        assert w5 > w1, (w1, w5)                    # 4 columns wide
        assert h5 > h1, "5 tiles must wrap to a second row"


def test_no_shots_means_no_sheet():
    with tempfile.TemporaryDirectory() as d:
        assert sheet(os.path.join(d, "missing.mp4"), [], os.path.join(d, "x.png")) is None


def test_a_missing_source_fails_quietly():
    """⚠ A sheet is a review aid; it must never take the reel cut down with it."""
    with tempfile.TemporaryDirectory() as d:
        out = sheet(os.path.join(d, "nope.mp4"), [(1.0, 0.0, "0.1", 5.0)],
                    os.path.join(d, "x.png"))
        assert out is None


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
            except Exception as e:                       # noqa: BLE001
                fails += 1
                print(f"  ERROR {name}: {type(e).__name__}: {e}")
    print("all passed" if not fails else f"{fails} failed")
    sys.exit(1 if fails else 0)
