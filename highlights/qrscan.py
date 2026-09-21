"""Read the overlay's `?data=1` QR code out of a recording.

This replaces inferring events from the picture. Colour-stripe detection (detect.py) can
only see an event while its card is on screen, and `app.ts` dismisses a card the moment the
score changes — a wicket followed quickly by the next ball can be up for under two seconds
and fall between keyframes, which is how the first pass on the Bazzigarz match found 13 of
the 15 wickets. The code is in every frame, so nothing depends on catching a transient.

It also carries far more than a card does: both player names, both batters' scores, the
bowler's figures, the partnership, and an exact ball outcome that distinguishes a six off a
no-ball from a plain no-ball. Events are therefore derived from what *changed* between two
payloads rather than from what happened to be drawn.

Decoding uses zxing-cpp, not OpenCV. cv2.QRCodeDetector returns a str and mangles arbitrary
bytes: it recovered 0 of 60 random 42-byte payloads byte-exactly even from perfect
uncompressed images, while reporting a successful detection every time. See requirements.txt.

Verified on two real IRL Pro captures from the match rig (3840x2160 at 14.96 and 13.89
Mb/s): 55 of 55 sampled frames in each decoded byte-exact with the CRC passing.
"""
from __future__ import annotations
import argparse, json, os, sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from detect import ffmpeg, probe, _raw, keyframe_interval, PRIORITY, HOLD_S
from payload import unpack, PAYLOAD_BYTES, OUTCOME

# The code sits flush in the frame's top-left. Scanning a crop rather than the whole 4K
# frame is most of the speed; a quarter of each side is generous for any sane scale.
CORNER = 0.25
# Which outcome codes are worth a clip in their own right.
SIX = {OUTCOME.index('6'), OUTCOME.index('6nb')}
FOUR = {OUTCOME.index('4'), OUTCOME.index('4nb')}
MILESTONES = (50, 100, 150)


def _decode(frame: np.ndarray):
    """One frame -> payload fields, or None. Rejects anything the CRC does not vouch for."""
    import zxingcpp
    grey = frame if frame.ndim == 2 else frame[:, :, :3].mean(2)
    res = zxingcpp.read_barcode(grey.astype(np.uint8))
    if not res:
        return None
    data = bytes(res.bytes)
    if len(data) != PAYLOAD_BYTES:
        return None
    fields, crc_ok = unpack(data)
    return fields if crc_ok else None


def _scan_chunk(job):
    """Decode the keyframes of one chunk. Returns (frames_seen, [(t, fields), ...])."""
    ff, video, x, y, w, h, t0, dur, kfs = job
    out, i = [], 0
    for f in _raw(ff, video, x, y, w, h, t0, dur):
        fields = _decode(f)
        if fields is not None:
            out.append((round(t0 + i * kfs, 2), fields))
        i += 1
    return i, out


def scan(video: str, workers: int = 8, chunk: float = 90.0) -> dict:
    """Decode the code across the whole file and reduce it to one entry per state.

    Chunks are short for the same reason detect.py's are: frame times are derived as
    chunk_start + index * keyframe_interval, and the real interval is not perfectly
    constant, so a long chunk lets the estimate drift. Each chunk's start is exact.
    """
    ff, m = ffmpeg(), probe(video)
    kfs = keyframe_interval(video)
    w = int(m['w'] * CORNER) // 2 * 2
    h = int(m['h'] * CORNER) // 2 * 2
    n = max(1, int(m['duration'] / chunk) + 1)
    jobs = [(ff, video, 0, 0, w, h, round(i * chunk, 2),
             round(chunk + kfs * 2, 2), kfs) for i in range(n)]

    frames, hits = 0, []
    with ProcessPoolExecutor(max_workers=workers) as ex:
        for got, out in ex.map(_scan_chunk, jobs, chunksize=1):
            frames += got
            hits += out
    hits.sort(key=lambda p: p[0])

    # One entry per published state. The sequence counter advances only when the cricket
    # data changes, so the first frame carrying a sequence is when that state appeared.
    states, seen = [], set()
    for t, f in hits:
        key = (f['sequence'], f['ballsBowled'], f['teamRuns'], f['wickets'], f['innings'])
        if key in seen:
            continue
        seen.add(key)
        states.append({'t': t, 'fields': f})
    for a, b in zip(states, states[1:]):
        a['until'] = b['t']
    if states:
        states[-1]['until'] = states[-1]['t'] + HOLD_S['wicket']

    return {'frames': frames, 'decoded': len(hits), 'crop': {'w': w, 'h': h},
            'keyframe_interval': kfs, 'states': states}


def moments(states: list[dict]) -> list[dict]:
    """Turn payload changes into the same moment shape cut.py already consumes.

    One moment per ball, carrying every type that ball earned, which is what the
    colour-stripe path had to reconstruct by grouping cards. Here it falls out directly.
    """
    out = []
    for prev, cur in zip([None] + states[:-1], states):
        f = cur['fields']
        p = prev['fields'] if prev else None
        types: list[str] = []

        # Only the first state has no predecessor, and its `outcome` describes a ball
        # bowled before the recording started — clipping it would cut footage that does
        # not contain the shot.
        if p is None:
            continue

        same_innings = f['innings'] == p['innings']
        # A new delivery happened if the over advanced, runs were scored, or a wicket fell.
        # Runs and wickets are needed because ballsBowled counts LEGAL balls only, so a six
        # off a no-ball leaves the over where it was.
        new_ball = same_innings and (f['ballsBowled'] > p['ballsBowled']
                                     or f['teamRuns'] > p['teamRuns']
                                     or f['wickets'] > p['wickets'])
        if not new_ball:
            continue

        if f['wickets'] > p['wickets']:
            types.append('wicket')
        if f['outcome'] in SIX:
            types.append('six')
        elif f['outcome'] in FOUR:
            types.append('four')

        # A milestone only counts if the same batter crossed it; the counter resets when a
        # new batter comes in, and the bar shows no marker for that.
        if f['strikerName'] and f['strikerName'] == p['strikerName']:
            for mark in MILESTONES:
                if p['strikerRuns'] < mark <= f['strikerRuns']:
                    types.append('milestone')
                    break
        for mark in MILESTONES:
            if p['partnershipRuns'] < mark <= f['partnershipRuns']:
                types.append('partnership')
                break

        if not types:
            continue
        out.append({
            't': cur['t'], 'until': cur.get('until', cur['t']), 'types': types,
            'anchor': min(types, key=PRIORITY.index),
            'ball': f['ballsBowled'], 'innings': f['innings'] + 1,
            'outcome': OUTCOME[f['outcome']] if f['outcome'] < len(OUTCOME) else '?',
            'striker': f['strikerName'], 'bowler': f['bowlerName'],
            'score': f"{f['teamRuns']}/{f['wickets']}",
            'strikerScore': f"{f['strikerRuns']}({f['strikerBalls']})",
        })
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('video')
    ap.add_argument('-o', '--out', default='events.json')
    ap.add_argument('-j', '--workers', type=int, default=max(2, (os.cpu_count() or 8) - 2))
    a = ap.parse_args()

    m = probe(a.video)
    print(f"{a.video}\n  {m['w']}x{m['h']} @ {m['fps']:.1f} fps, {m['duration']/3600:.2f} h")
    r = scan(a.video, a.workers)
    print(f"  keyframe every {r['keyframe_interval']}s, scanning the top-left "
          f"{r['crop']['w']}x{r['crop']['h']}")
    print(f"  decoded {r['decoded']} of {r['frames']} keyframes -> {len(r['states'])} states")

    if not r['states']:
        print("\n  No code found. Either the recording predates ?data=1, or the stream was\n"
              "  not started with it. Fall back to detect.py, which infers events from the\n"
              "  event-card colours instead.")
        return

    ms = moments(r['states'])
    from collections import Counter
    print(f"  {len(ms)} moments {dict(Counter(t for x in ms for t in x['types']))}")
    for x in ms[:12]:
        print(f"    {int(x['t'])//60:02d}:{int(x['t'])%60:02d}  {'+'.join(x['types']):<20}"
              f" {x['score']:>7}  {x['striker']} {x['strikerScore']} vs {x['bowler']}")
    if len(ms) > 12:
        print(f"    ... and {len(ms) - 12} more")

    json.dump({'source': 'qr', 'frames': r['frames'], 'decoded': r['decoded'],
               'keyframe_interval': r['keyframe_interval'],
               'states': r['states'], 'moments': ms}, open(a.out, 'w'), indent=1)
    print(f"  wrote {a.out}  (cut.py reads this unchanged)")


if __name__ == '__main__':
    main()
