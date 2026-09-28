"""One contact sheet per reel: the predicted delivery frame for every clip, side by side.

🛑 Why this exists. Three reel-by-reel reviews were needed on `vs ATX Panthers`, and every
real fault was found by *watching*, never by a metric — a widened clip showed the previous
batter, another showed a different bowler's over, a third put the shot at 0:22 of 0:27. The
numbers said 8 of 8 deliveries were inside their clips while the clips were wrong, because
coverage of the right *instant* is not coverage of the right *ball*.

A sheet is the cheap version of watching. One PNG per reel, one tile per clip, each tile the
frame at the predicted shot. A wrong clip is obvious at a glance: an empty pitch, a batter
walking away, fielders standing about. Verifying 37 clips becomes nine images instead of
400 MB of video.

## What a good tile looks like

The delivery stride is about 1 s before bat on ball, so the tile should show a bowler in the
act or a bat coming through, with the keeper crouched. ⚠ What it must NOT show: players
standing, a batter walking, or a group gathering — those are the aftermath, which is exactly
the failure mode the whole alignment exists to avoid.

## Reading the sheet

Each tile is labelled `<n> <reel mm:ss> ov <over> +<lag>s`, where the lag is how late the
scorer entered that ball. ⚠ A lag far from the innings median is the one worth a second look:
both mis-alignments ever confirmed by eye were the largest lag in their innings.
"""
from __future__ import annotations

import os
import subprocess

from detect import ffmpeg, probe

# Tile geometry. Small enough that a 14-clip sheet stays under a couple of megabytes, big
# enough that a bat and a crouched keeper are legible.
TILE_W = 420
COLS = 4
LABEL_PT = 22


def pitch_box(w: int, h: int) -> str:
    """The crop for a tile: the pitch band, same measured span `deliveries.pitch_crop` uses.

    ⚠ Deliberately not importing it. `deliveries.pitch_crop` feeds the motion detector and is
    tuned for that; if one wants changing the other should not move silently with it.
    """
    cw, cx = int(w * 0.45), int(w * 0.31)
    ch, cy = int(h * 0.33), int(h * 0.44)
    return f"crop={cw}:{ch}:{cx}:{cy}"


def grid(n: int, cols: int = COLS) -> tuple[int, int]:
    """-> (cols, rows) for n tiles, keeping a single row when there are few."""
    if n <= 0:
        return (0, 0)
    c = min(cols, n)
    return (c, (n + c - 1) // c)


def tile_label(i: int, reel_t: float, over_txt: str, lag: float | None) -> str:
    """`3 1:04 ov 11.5 +16.8s` — index, where in the reel, which ball, and the scorer's lag."""
    stamp = f"{int(reel_t) // 60:01d}:{int(reel_t) % 60:02d}"
    bits = [str(i), stamp]
    if over_txt:
        bits.append(f"ov {over_txt}")
    if lag is not None:
        bits.append(f"+{lag:.0f}s")
    return " ".join(bits)


def esc(text: str) -> str:
    """Escape a label for ffmpeg's `drawtext`.

    🛑 A colon is a filter-option separator, so a label reading `3 1:04` makes ffmpeg parse
    `04 ov ...` as an option name and the whole filterchain fails with exit 234. The reel
    timestamp is the obvious label to want and it always contains one, so this is not an edge
    case. Backslash, quote and percent need the same treatment.
    """
    out = []
    for ch in text:
        if ch in "\\:'%":
            out.append("\\" + ch)
        else:
            out.append(ch)
    return "".join(out)


def _frame(src: str, t: float, out: str, box: str, label: str) -> bool:
    """One labelled tile. -> True if ffmpeg wrote it."""
    # ⚠ drawtext needs a font; fontconfig is absent in this venv's ffmpeg build and prints a
    # harmless error, so the label is drawn with the default font and stderr is swallowed.
    vf = (f"{box},scale={TILE_W}:-1,"
          f"drawtext=text='{esc(label)}':fontsize={LABEL_PT}:fontcolor=yellow:"
          f"box=1:boxcolor=black@0.7:x=6:y=6")
    r = subprocess.run(
        [ffmpeg(), "-nostdin", "-hide_banner", "-loglevel", "error",
         "-ss", f"{max(0.0, t):.2f}", "-i", src, "-frames:v", "1",
         "-vf", vf, "-y", out],
        capture_output=True)
    return r.returncode == 0 and os.path.exists(out)


def sheet(src: str, shots: list[tuple[float, float, str, float | None]], out_png: str,
          tmp_dir: str | None = None) -> str | None:
    """Write one contact sheet. -> the path, or None if no tile could be extracted.

    `shots` is one entry per clip: (source shot time, reel time, over text, scorer lag).
    """
    if not shots:
        return None
    tmp = tmp_dir or os.path.join(os.path.dirname(out_png) or ".", ".sheet-tmp")
    os.makedirs(tmp, exist_ok=True)
    # ⚠ A sheet is a review aid and must never take the reel cut down with it. `probe` raises
    # on a missing or unreadable file, so every failure path here returns None instead.
    try:
        m = probe(src)
    except Exception:                                  # noqa: BLE001
        return None
    box = pitch_box(m["w"], m["h"])
    # 🛑 Tiles are numbered by POSITION in the kept list, contiguously from zero, because the
    # `tile` filter reads a numbered SEQUENCE as one input. A gap in the numbering (from a
    # frame that failed to extract) truncates the sequence at the gap.
    tiles, n = [], 0
    for i, (t, reel_t, over_txt, lag) in enumerate(shots):
        path = os.path.join(tmp, f"t{n:03d}.png")
        if _frame(src, t, path, box, tile_label(i, reel_t, over_txt, lag)):
            tiles.append(path)
            n += 1
    if not tiles:
        return None
    cols, rows = grid(len(tiles))
    # 🛑 One numbered-sequence input, never one `-i` per tile. `tile` tiles successive FRAMES
    # of a single input; given several inputs it silently tiles the FIRST one and pads the
    # rest, so every sheet comes out byte-identical whatever the other tiles hold. That looked
    # like a working sheet and was caught only by md5-ing two sheets that should have differed.
    r = subprocess.run(
        [ffmpeg(), "-nostdin", "-hide_banner", "-loglevel", "error",
         "-framerate", "1", "-i", os.path.join(tmp, "t%03d.png"),
         "-frames:v", "1",
         "-filter_complex", f"tile={cols}x{rows}:margin=4:padding=4", "-y", out_png],
        capture_output=True)
    for p in tiles:
        try:
            os.remove(p)
        except OSError:
            pass
    try:
        os.rmdir(tmp)
    except OSError:
        pass
    return out_png if r.returncode == 0 and os.path.exists(out_png) else None
