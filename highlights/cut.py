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
from detect import ffmpeg

WINDOWS = {            # seconds relative to the card appearing
    'wicket': (-52, -8),
    'six':    (-20,  6),
    'four':   (-18,  4),
}


def segments(events, types=None, windows=WINDOWS):
    segs = []
    for e in events:
        if types and e['type'] not in types: continue
        a, b = windows[e['type']]
        segs.append([max(0.0, e['t'] + a), e['t'] + b, e['type']])
    segs.sort()
    merged = []
    for s in segs:
        if merged and s[0] <= merged[-1][1] + 1.0:
            merged[-1][1] = max(merged[-1][1], s[1])
            if s[2] not in merged[-1][2]: merged[-1][2] += '+' + s[2]
        else:
            merged.append(s)
    return merged


def cut(video, segs, out, height=1080, bitrate='10M', keep_clips=False):
    ff = ffmpeg()
    work = os.path.join(os.path.dirname(os.path.abspath(out)), 'clips')
    os.makedirs(work, exist_ok=True)
    paths = []
    for i, (a, b, kind) in enumerate(segs):
        p = os.path.join(work, f'{i:03d}.mp4')
        subprocess.run([ff, '-hide_banner', '-loglevel', 'error', '-y',
                        '-ss', f'{a:.2f}', '-t', f'{b - a:.2f}', '-i', video,
                        '-vf', f'scale=-2:{height}',
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
    ev = json.load(open(a.events))['events']
    types = a.types.split(',') if a.types else None
    segs = segments(ev, types)
    total = sum(b - x for x, b, _ in segs)
    print(f"{len(ev)} events -> {len(segs)} clips, {total/60:.1f} min")
    cut(a.video, segs, a.out, a.height)
    print(f"\nwrote {a.out}  ({os.path.getsize(a.out)/1e6:.0f} MB)")
    ch = os.path.splitext(a.out)[0] + '-chapters.txt'
    open(ch, 'w').write(chapters(segs, ev))
    print(f"wrote {ch}")


if __name__ == '__main__':
    main()
