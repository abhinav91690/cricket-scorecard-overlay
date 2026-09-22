"""Find overlay event cards in a match recording by their accent stripe.

The overlay draws a 5px accent stripe down the left edge of every event card, and the
colour is fixed in overlay-base.css and never overridden by a theme:

    wicket  #d7263d    four  #1b9e4b       six    #6d3df5
    milestone #ff7300  partnership #00bcd4

The five are held at least 150 apart in summed-channel distance (a contract recorded in
CLAUDE.md), which is what makes one nearest-colour test enough to name the event.

At any scale that stripe is a narrow, full-bar-height band of one saturated colour,
which is a far more distinctive signature than a colour blob and rarely occurs in
the field of play. So detection needs no OCR and no model.

Only keyframes are decoded. On a typical phone recording they land every ~2s, which
is shorter than the briefest card (a boundary holds 2.0s plus a 0.3s transition), so
nothing is missed and a 4-hour 4K file scans in well under a minute.
"""
from __future__ import annotations
import subprocess, json, argparse, os
from concurrent.futures import ProcessPoolExecutor
import numpy as np

STRIPES = {'wicket': (0xd7, 0x26, 0x3d), 'four': (0x1b, 0x9e, 0x4b), 'six': (0x6d, 0x3d, 0xf5),
           'milestone': (0xff, 0x73, 0x00), 'partnership': (0x00, 0xbc, 0xd4)}
# Mirrors HOLD_MS in src/cards.ts. Used to tell "this card is still up" from
# "a second card followed it".
HOLD_S  = {'wicket': 8.0, 'milestone': 8.0, 'partnership': 6.0, 'four': 2.0, 'six': 2.0}
# Which event names a clip when one ball produced several cards. A wicket needs the
# widest lookback, a boundary is the shot worth showing, and milestone/partnership
# cards only ever follow somebody scoring.
PRIORITY = ['wicket', 'six', 'four', 'milestone', 'partnership']
TOL     = 95          # h264 in limited range shifts colours; this is a sum-of-channels distance


def ffmpeg() -> str:
    """The ffmpeg bundled with imageio-ffmpeg, so no system install is needed."""
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def probe(video: str) -> dict:
    import av
    with av.open(video) as c:
        v = c.streams.video[0]
        return {'w': v.codec_context.width, 'h': v.codec_context.height,
                'duration': float(c.duration) / av.time_base, 'fps': float(v.average_rate)}


def _raw(ff, video, x, y, w, h, t0, dur, keyframes_only=True, rows=None):
    vf = f'crop={w}:{h}:{x}:{y}'
    if rows and rows < h:
        vf += f',scale={w}:{rows}:flags=neighbor'   # keep x sharp, drop rows
    cmd = [ff, '-hide_banner', '-loglevel', 'error']
    if keyframes_only: cmd += ['-skip_frame', 'nokey']
    cmd += ['-ss', f'{t0}', '-t', f'{dur}', '-i', video,
            '-vf', vf, '-vsync', '0', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']
    h = rows if (rows and rows < h) else h
    n = w * h * 3
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, bufsize=n * 4)
    try:
        while True:
            b = p.stdout.read(n)
            if len(b) < n: return
            yield np.frombuffer(b, dtype=np.uint8).reshape(h, w, 3).astype(np.int16)
    finally:
        p.stdout.close(); p.wait()


def find_bar(video: str, samples: int = 24) -> dict:
    """Locate the scorebar without being told where it is.

    The overlay is a static graphic composited over moving footage, so across frames
    taken minutes apart the bar pixels barely change while the field changes a lot.
    A temporal standard-deviation map therefore shows the overlay as a quiet
    rectangle. Cheap: a couple of dozen frames, no assumptions about placement.
    """
    ff, m = ffmpeg(), probe(video)
    y0 = int(m['h'] * 0.50)
    H = m['h'] - y0
    step = m['duration'] / (samples + 2)
    frames = []
    for i in range(1, samples + 1):
        for f in _raw(ff, video, 0, y0, m['w'], H, round(i * step, 2), 3.0):
            frames.append(f.astype(np.float32)); break
    if len(frames) < 4:
        raise SystemExit('could not read enough frames to locate the overlay')
    sd = np.stack(frames).std(0).mean(2)
    quiet = sd < max(4.0, np.percentile(sd, 12))
    rows = quiet.sum(1); cols = quiet.sum(0)
    ry = np.nonzero(rows > m['w'] * 0.25)[0]
    if not len(ry):
        raise SystemExit('no static overlay region found; is the overlay in the recording?')
    band = quiet[ry.min():ry.max() + 1]
    cx = np.nonzero(band.sum(0) > band.shape[0] * 0.5)[0]
    return {'x': int(cx.min()), 'y': y0 + int(ry.min()),
            'w': int(cx.max() - cx.min() + 1), 'h': int(ry.max() - ry.min() + 1)}


def _scan(job):
    """Look for stripe bands anywhere across the bar, recording the column each was
    seen in. Rows are subsampled 4x with nearest-neighbour, which keeps x precision
    (the stripe is only ~10px wide) while cutting the data moved per frame."""
    ff, video, x, y, w, h, t0, dur, kfs = job
    rh = max(12, h // 3)
    out, i = [], 0
    for f in _raw(ff, video, x, y, w, h, t0, dur, rows=rh):
        for name, rgb in STRIPES.items():
            m = np.abs(f - np.array(rgb, dtype=np.int16)).sum(2) < TOL
            # A stripe shows up in nearly every row of the card. Testing rows rather
            # than demanding one pure column tolerates anti-aliased edges and the
            # chroma subsampling in h264.
            if (m.sum(1) > 2).sum() < rh * 0.60:
                continue
            cols = np.nonzero(m.sum(0) > rh * 0.35)[0]
            if not len(cols):
                continue
            # The card's eyebrow text ("WICKET", "SIX") uses the same accent colour as
            # the stripe, so matches spread rightwards across the glyphs. The stripe is
            # always the leftmost of them, so anchor on that.
            out.append([round(t0 + i * kfs, 2), name, int(cols.min()) + x]); break
        i += 1
    return i, out


def scan(video: str, region: dict, duration: float, workers: int = 8,
         kf_interval: float = 2.02, chunk: float = 90.0) -> dict:
    """Scan in short chunks.

    Frame times are derived as chunk_start + index * keyframe_interval, but the real
    interval is not perfectly constant, so that estimate drifts. Keeping chunks short
    bounds the error to well under a second instead of letting it accumulate to tens
    of seconds across a 4-hour pass. Each chunk's start is exact, so errors do not
    carry over.
    """
    ff = ffmpeg()
    n = max(1, int(duration / chunk) + 1)
    jobs = [(ff, video, region['x'], region['y'], region['w'], region['h'],
             round(i * chunk, 2), round(chunk + kf_interval * 2, 2), kf_interval) for i in range(n)]
    frames, hits = 0, []
    with ProcessPoolExecutor(max_workers=workers) as ex:
        for got, out in ex.map(_scan, jobs, chunksize=2):
            frames += got; hits += out
    hits.sort()
    # chunks overlap slightly so the same card can be seen twice; dedupe by time+type
    seen, uniq = set(), []
    for t, name, xx in hits:
        k = (name, round(t / 1.5))
        if k in seen: continue
        seen.add(k); uniq.append([t, name, xx])
    hits = uniq
    # The card stripe always sits at the same x. Anything at another column is a stray
    # colour match, so keep only the dominant column.
    col = 0
    if hits:
        xs = np.array([h[2] for h in hits])
        vals, counts = np.unique(xs // 8, return_counts=True)
        col = int(vals[counts.argmax()] * 8)
        hits = [h for h in hits if abs(h[2] - col) <= 40]
    events, last = [], {}
    for t, name, _x in hits:
        if name in last and t - last[name] < HOLD_S[name] + 1.5:
            last[name] = t; events[-1]['until'] = t; continue
        last[name] = t
        events.append({'t': t, 'type': name, 'until': t})
    return {'frames': frames, 'bar': region, 'stripe_x': col,
            'events': events, 'moments': moments(events)}


def moments(events, slack: float = 5.0):
    """Collapse the cards of a single ball into one moment.

    One ball can raise several cards: a four that brings up a fifty shows the boundary
    card and then the milestone card, and cards play one at a time, so the second
    starts as the first is retiring. Cutting one clip per card would put the same
    footage in the reel twice.

    Cards from the same ball are therefore always adjacent: the next one begins within
    the previous card's hold plus the exit transition, and `slack` covers the fact that
    a keyframe scan can notice each card up to one keyframe late. Consecutive balls are
    thirty seconds or more apart, so there is no risk of merging two of them.

    The types are kept rather than reduced, so a per-player reel can still ask which
    milestones and partnerships happened and when.
    """
    out = []
    for e in sorted(events, key=lambda e: e['t']):
        if out and e['t'] - out[-1]['last'] <= HOLD_S[out[-1]['last_type']] + slack:
            m = out[-1]
            if e['type'] not in m['types']: m['types'].append(e['type'])
            m['last'], m['last_type'] = e['t'], e['type']
            m['until'] = max(m['until'], e.get('until', e['t']))
            continue
        out.append({'t': e['t'], 'types': [e['type']], 'until': e.get('until', e['t']),
                    'last': e['t'], 'last_type': e['type']})
    for m in out:
        m['anchor'] = min(m['types'], key=PRIORITY.index)
        del m['last'], m['last_type']
    return out


def keyframe_interval(video: str, at: float = 60.0) -> float:
    import av, statistics
    with av.open(video) as c:
        v = c.streams.video[0]
        v.codec_context.skip_frame = 'NONKEY'
        c.seek(int(at * 1_000_000))
        ts = [float(f.pts * v.time_base) for f, _ in zip(c.decode(video=0), range(10))]
    gaps = [ts[i + 1] - ts[i] for i in range(len(ts) - 1)]
    return round(statistics.median(gaps), 3) if gaps else 2.0


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('video')
    ap.add_argument('-o', '--out', default='events.json')
    ap.add_argument('-j', '--workers', type=int, default=max(2, (os.cpu_count() or 8) - 2))
    ap.add_argument('--region', help='x,y,w,h to skip calibration')
    a = ap.parse_args()
    m = probe(a.video)
    print(f"{a.video}\n  {m['w']}x{m['h']} @ {m['fps']:.1f} fps, {m['duration']/3600:.2f} h")
    kfs = keyframe_interval(a.video)
    print(f"  keyframe every {kfs}s")
    if a.region:
        x, y, w, h = (int(v) for v in a.region.split(',')); region = dict(x=x, y=y, w=w, h=h)
    else:
        region = find_bar(a.video)
        print(f"  scorebar found at x={region['x']} y={region['y']} "
              f"{region['w']}x{region['h']}")
    r = scan(a.video, region, m['duration'], a.workers, kfs)
    from collections import Counter
    print(f"  card stripe column x={r['stripe_x']}")
    print(f"  decoded {r['frames']} keyframes -> {len(r['events'])} events "
          f"{dict(Counter(e['type'] for e in r['events']))}")
    multi = [m for m in r['moments'] if len(m['types']) > 1]
    print(f"  {len(r['moments'])} moments (balls) -> one clip each"
          + (f"; {len(multi)} raised more than one card: "
             + ', '.join('+'.join(m['types']) for m in multi[:6]) if multi else ''))
    json.dump(r, open(a.out, 'w'), indent=1)
    print(f"  wrote {a.out}")


if __name__ == '__main__':
    main()
