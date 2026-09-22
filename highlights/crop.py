"""Draw the candidate reel crops on a real frame, so a match's values can be chosen by eye.

🛑 This exists because the camera framing changes every match. The crop is an INPUT to
`reels.py`, not a constant, and the only reliable way to pick it is to look at the frame
the crops will actually be taken from.

What to look for, in the language of the two reels:

    batting reel  -> both sets of stumps must be inside the box. A batter's end alternates
                     every over and again on every odd run, so a box that holds only one
                     end loses half their shots. The bowler's run-up does NOT matter.
    bowling reel  -> the run-up must be inside it too, which means a wider box: the bowler
                     starts well behind the stumps.

Usage:
    .venv/bin/python crop.py "/path/match.mp4" -t 3800 -o crops.png
    .venv/bin/python crop.py "/path/match.mp4" -t 3800 --crop-x 0.42    # try an offset
    .venv/bin/python crop.py "/path/match.mp4" -t 3800 --aspect 4:5     # just one shape

Then pass what you picked:
    reels.py … --vertical --aspect-bat 4:5 --crop-x-bat 0.42 \\
                          --aspect-bowl 1:1 --crop-x-bowl 0.50
"""
from __future__ import annotations
import argparse
import subprocess

from cut import ASPECTS, crop_filter
from detect import ffmpeg, probe

# Drawn brightest first so the narrowest box stays readable on top of the wider ones.
COLOURS = {'9:16': 'red', '4:5': 'yellow', '1:1': 'lime'}


def boxes(w: int, h: int, aspects: list[str], centre: float) -> list[tuple]:
    """-> [(aspect, x, width, colour)] for each candidate crop, widest first."""
    out = []
    for aspect in sorted(aspects, key=lambda a: -ASPECTS[a]):
        f = crop_filter(w, h, aspect, centre)
        cw = int(f.split('crop=')[1].split(':')[0])
        x = int(f.split(':')[2].split(',')[0])
        out.append((aspect, x, cw, COLOURS.get(aspect, 'white')))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('video')
    ap.add_argument('-t', '--at', type=float, required=True,
                    help='seconds into the video — pick a moment with a ball in play')
    ap.add_argument('-o', '--out', default='crops.png')
    ap.add_argument('--crop-x', type=float, default=0.5, metavar='F',
                    help='crop centre as a fraction of frame width (default 0.5)')
    ap.add_argument('--aspect', choices=sorted(ASPECTS),
                    help='only draw this one (default: all three)')
    ap.add_argument('--width', type=int, default=1600, help='output width for viewing')
    a = ap.parse_args()

    m = probe(a.video)
    aspects = [a.aspect] if a.aspect else list(ASPECTS)
    bx = boxes(m['w'], m['h'], aspects, a.crop_x)

    scale = a.width / m['w']
    vf = [f"scale={a.width}:-2"]
    for aspect, x, cw, colour in bx:
        vf.append(f"drawbox=x={int(x * scale)}:y=0:w={int(cw * scale)}:h=ih:"
                  f"color={colour}@0.9:t=3")
    subprocess.run([ffmpeg(), '-hide_banner', '-loglevel', 'error', '-y',
                    '-ss', f'{a.at}', '-i', a.video, '-frames:v', '1',
                    '-vf', ','.join(vf), a.out], check=True)

    print(f"{a.video}\n  {m['w']}x{m['h']}, frame at {a.at:.0f}s, crop centre "
          f"{a.crop_x:.0%}\n")
    for aspect, x, cw, colour in bx:
        print(f"  {colour:7} {aspect:5} {cw:5}px wide ({cw / m['w']:5.1%})  "
              f"spans {x / m['w']:5.1%} - {(x + cw) / m['w']:5.1%}")
    print(f"\nwrote {a.out}")
    print("\n  batting: both sets of stumps inside the box (the end alternates).")
    print("  bowling: the run-up too, so it needs a wider one.")


if __name__ == '__main__':
    main()
