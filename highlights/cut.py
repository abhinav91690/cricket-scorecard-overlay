"""Turn detected event cards into clips and concatenate a reel.

Windows are relative to when the CARD appeared, not when the ball was bowled. The
scorer enters the ball on their own device, so the card always lags the action, and
the lag depends on how much typing the event needs. Measured on a real LPCL
recording: a six shows about 5s late, a wicket about 35s, because a dismissal has
more fields to fill in. Hence the very different windows below.

Widen these if your scorer is slower. They are the one setting worth tuning.
"""
from __future__ import annotations
import json, subprocess, argparse, os
from detect import ffmpeg, moments, PRIORITY

WINDOWS = {            # seconds relative to the card appearing
    'wicket': (-52, -8),
    'six':    (-20,  6),
    'four':   (-18,  4),
    # A milestone or partnership card follows the ball that raised it, so it lags by
    # about as much as a boundary does, plus the card ahead of it in the queue.
    'milestone':   (-24,  4),
    'partnership': (-24,  4),
}


def segments(events, types=None, windows=WINDOWS):
    """One clip per ball, never one per card.

    `events` may be the raw card list or the grouped moments from detect.moments(); raw
    input is grouped here, because two cards for the same ball must not put the same
    footage in the reel twice. The clip is framed on the highest-priority card of the
    ball and labelled with all of them.
    """
    segs = []
    for e in events if events and 'types' in events[0] else moments(events):
        kinds = e['types'] if types is None else [t for t in e['types'] if t in types]
        if not kinds: continue
        a, b = windows[min(kinds, key=PRIORITY.index)]
        segs.append([max(0.0, e['t'] + a), e['t'] + b, '+'.join(e['types'])])
    segs.sort()
    merged = []
    for s in segs:
        if merged and s[0] <= merged[-1][1] + 1.0:
            merged[-1][1] = max(merged[-1][1], s[1])
            for k in s[2].split('+'):
                if k not in merged[-1][2].split('+'): merged[-1][2] += '+' + k
        else:
            merged.append(s)
    return merged


def cut(video, segs, out, height=1080, bitrate='10M', keep_clips=False, vf=None):
    """`vf` overrides the scale filter — reels.py passes crop_filter() for a Short."""
    ff = ffmpeg()
    work = os.path.join(os.path.dirname(os.path.abspath(out)), 'clips')
    os.makedirs(work, exist_ok=True)
    paths = []
    for i, (a, b, kind) in enumerate(segs):
        p = os.path.join(work, f'{i:03d}.mp4')
        subprocess.run([ff, '-hide_banner', '-loglevel', 'error', '-y',
                        '-ss', f'{a:.2f}', '-t', f'{b - a:.2f}', '-i', video,
                        '-vf', vf or f'scale=-2:{height}',
                        '-c:v', 'h264_videotoolbox', '-b:v', bitrate,   # hardware encoder on Apple silicon
                        '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', p], check=True)
        paths.append(p)
        print(f"  {i:02d}  {int(a)//60:03d}:{int(a)%60:02d}-{int(b)//60:03d}:{int(b)%60:02d}  {kind}")
    lst = os.path.join(work, 'list.txt')
    open(lst, 'w').write(''.join(f"file '{os.path.abspath(p)}'\n" for p in paths))
    subprocess.run([ff, '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0',
                    '-i', lst, '-c', 'copy', '-movflags', '+faststart', out], check=True)
    if not keep_clips:
        for p in paths: os.remove(p)
        os.remove(lst); os.rmdir(work)
    return out


# Shorts accept anything with height >= width, so the crop is a real choice, not a
# constraint. See docs/highlights.md §13a for the measurement behind the default.
ASPECTS = {'1:1': 1.0, '4:5': 0.8, '9:16': 9 / 16}


def crop_filter(w: int, h: int, aspect: str = '1:1', centre: float = 0.5) -> str:
    """A full-height crop of the given aspect, centred at `centre` (a fraction of width).

    🛑 The default is SQUARE, not 9:16, and that is measured rather than a preference.
    The camera is side-on, so the pitch runs across the frame and occupies roughly
    36%-73% of the width. A 9:16 window at 16:9 is only 31.6% of the width and therefore
    **cannot contain the pitch wherever it is placed** — on three real events it cut off
    the bowler's end every time. A 1:1 window is 56.25% wide and covers the whole pitch.

    ⚠ Which end the striker is at alternates: every over, and again whenever the batters
    cross on an odd run. So there is no fixed "action" side to aim a narrow crop at, and
    picking one per ball needs state this pipeline does not reliably have.

    Any crop starting past ~4% of the width still excludes the top-left ?data=1 block, so
    that stays removed for free.
    """
    if aspect not in ASPECTS:
        raise ValueError(f"aspect must be one of {', '.join(ASPECTS)}")
    cw = min(w, int(h * ASPECTS[aspect]) // 2 * 2)
    x = max(0, min(w - cw, int(round(centre * w - cw / 2)))) // 2 * 2
    out_h = int(1080 / ASPECTS[aspect]) // 2 * 2
    return f'crop={cw}:{h}:{x}:0,scale=1080:{out_h},setsar=1'


def chapters(segs, events):
    """YouTube-style chapter list for the reel's own timeline."""
    lines, t = ['00:00 Start'], 0.0
    for a, b, kind in segs:
        lines.append(f"{int(t)//60:02d}:{int(t)%60:02d} {kind.replace('+', ' and ')}")
        t += b - a
    return '\n'.join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('video'); ap.add_argument('events')
    ap.add_argument('-o', '--out', required=True)
    ap.add_argument('-t', '--types', help='comma list, e.g. wicket or wicket,six')
    ap.add_argument('--height', type=int, default=1080)
    ap.add_argument('--keep-clips', action='store_true')
    a = ap.parse_args()
    doc = json.load(open(a.events))
    ev = doc.get('moments') or doc['events']
    types = a.types.split(',') if a.types else None
    segs = segments(ev, types)
    total = sum(b - x for x, b, _ in segs)
    print(f"{len(ev)} moments -> {len(segs)} clips, {total/60:.1f} min")
    cut(a.video, segs, a.out, a.height)
    print(f"\nwrote {a.out}  ({os.path.getsize(a.out)/1e6:.0f} MB)")
    ch = os.path.splitext(a.out)[0] + '-chapters.txt'
    open(ch, 'w').write(chapters(segs, ev))
    print(f"wrote {ch}")


if __name__ == '__main__':
    main()
