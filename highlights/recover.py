"""Recover an IRL Pro recording that was cut short — a phone that overheated, died or was killed —
so any player can open it again. Nothing is re-encoded and no payload is rewritten.

    .venv/bin/python recover.py BROKEN.mp4 --reference COMPLETE.mp4 -o RECOVERED.mp4
    .venv/bin/python recover.py --inspect FILE.mp4        # top-level box layout only

`--reference` must be a COMPLETE recording by the same phone, app and settings — usually the next
recording of the same match, made after the phone restarted.

WHY IT IS BROKEN. An MP4 holds `ftyp`, then `mdat` (every frame and audio packet, back to back),
then `moov`: the index that says where each sample is and when it plays. The app writes `moov`
last, so a recording that dies keeps every frame and loses the index. ffmpeg cannot open it.

HOW THIS WORKS. The reference supplies everything that is the same between the two files — codec
configuration, sample layout, and the muxer's habits — and the broken file's samples are found by
scanning its raw data:

  video sample = ONE H.264 NAL: a 4-byte length, header 0x21 (P frame) or 0x65 (IDR), and a valid
                 slice header (first_mb_in_slice 0, pic_parameter_set_id 0, IDR => I slice).
  audio sample = one raw AAC-LC frame. Not self-delimiting, so an audio run is split by dynamic
                 programming over byte positions that open like a real frame (prefixes LEARNED from
                 the reference) and close with the AAC end code (111 + zero padding).
  timing       = lost entirely, so it comes from the muxer's clock: it cuts a chunk every ~1 s of
                 wall time, whatever the frame rate. Time is chunks counted.

🛑 THE GATE. Before touching the broken file, the scanner runs on the reference and every recovered
video sample must match the reference's real index exactly, or recovery stops. A rebuild that
cannot reproduce a file whose answer is known is not trusted on one whose answer is not.

Measured on the 2026-10-10 recording (docs/highlights.md §15): video 204,203 of 204,203 frames
exact; audio 99.98% exact (99.975% on frames the learned prefixes never saw); A/V sync typically
~0.2 s off, p95 ~0.55 s — the phone dropped audio while throttling and the file does not record
where inside each second the gap fell, so that is a floor, not a bug.
"""
import argparse
import json
import mmap
import os
import re
import shutil
import struct
import subprocess
import sys
from bisect import bisect_left, bisect_right, bisect
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

VIDEO_TS, AAC = 90_000, 1024
# Bytes a video sample can open with: a P slice, an IDR slice, or an in-band SPS / PPS.
HEADER = re.compile(rb"[\x21\x65\x67\x68]")
# NAL types allowed BEFORE the slice in one sample, with their longest plausible length.
LEADING_NALS = {0x67: 2048, 0x68: 2048, 0x06: 65536, 0x09: 64}     # SPS, PPS, SEI, AUD
# A crash leaves at most a chunk or two unreadable. More than this left over means the scan
# stopped on something it does not recognise, and the result would be silently truncated.
MAX_CRASH_TAIL = 64 * 2**20
# The chunk clock must land the reference within these, or its timing model does not fit.
# On the 2026-10-10 recording it measured 0.2% long with a 0.22 s median A/V error.
TIMING_MAX_ERROR = 0.03
SYNC_MAX_S = 0.5
AUDIO_RUN_MAX = 64_000          # longest audio run tolerated between two video runs
LEARN_FRAMES = 60_000           # AAC frames used to learn frame-start prefixes; the rest is held out
NEIGHBOURS = 6                  # video runs either side used to spot two chunks read as one


# ════════════════════════════════════════════════════════════════════════════
# MP4 boxes
# ════════════════════════════════════════════════════════════════════════════
CONTAINERS = {b"moov", b"trak", b"edts", b"mdia", b"minf", b"dinf", b"stbl"}


def top_level(path):
    """(kind, offset, size, header_len) of each top-level box, reading headers only. A size that
    runs past the end of the file (a recording that died) is reported as it is."""
    size = os.path.getsize(path)
    out, off = [], 0
    with open(path, "rb") as f:
        while off + 8 <= size:
            f.seek(off)
            h = f.read(16)
            sz, kind = struct.unpack(">I4s", h[:8])
            hl = 8
            if sz == 1:
                sz, hl = struct.unpack(">Q", h[8:16])[0], 16
            elif sz == 0:
                sz = size - off
            out.append((kind.decode("latin-1"), off, sz, hl))
            if sz < 8 or off + sz > size:
                break
            off += sz
    return out


def parse(buf, off=0, end=None):
    end = len(buf) if end is None else end
    out = []
    while off + 8 <= end:
        size, kind = struct.unpack_from(">I4s", buf, off)
        h = 8
        if size == 1:
            size, h = struct.unpack_from(">Q", buf, off + 8)[0], 16
        body = buf[off + h:off + size]
        out.append([kind, parse(body) if kind in CONTAINERS else bytes(body)])
        off += size
    return out


def serialise(tree):
    out = b""
    for kind, body in tree:
        payload = serialise(body) if isinstance(body, list) else body
        out += struct.pack(">I4s", 8 + len(payload), kind) + payload
    return out


def child(tree, kind):
    return next(b for k, b in tree if k == kind)


def read_moov(path):
    for kind, off, size, _ in top_level(path):
        if kind == "moov":
            with open(path, "rb") as f:
                f.seek(off)
                return f.read(size)
    raise SystemExit(f"{path}: no moov — is this really a complete recording?")


def tables(moov_bytes):
    """Per-track sample tables from a complete moov: {'vide': {...}, 'soun': {...}}."""
    tree = parse(moov_bytes[8:])
    out = {}
    for kind, trak in tree:
        if kind != b"trak":
            continue
        mdia = child(trak, b"mdia")
        htype = child(mdia, b"hdlr")[8:12].decode()
        mdhd = child(mdia, b"mdhd")
        ts = struct.unpack_from(">I", mdhd, 20 if mdhd[0] == 1 else 12)[0]
        stbl = child(child(mdia, b"minf"), b"stbl")
        t = {"timescale": ts}
        for k, b in stbl:
            p = 4
            if k in (b"stts",):
                n = struct.unpack_from(">I", b, p)[0]
                t["stts"] = [struct.unpack_from(">Ii", b, p + 4 + 8 * i) for i in range(n)]
            elif k == b"stsc":
                n = struct.unpack_from(">I", b, p)[0]
                t["stsc"] = [struct.unpack_from(">III", b, p + 4 + 12 * i) for i in range(n)]
            elif k == b"stsz":
                fixed, n = struct.unpack_from(">II", b, p)
                t["stsz"] = [fixed] * n if fixed else list(struct.unpack_from(f">{n}I", b, p + 8))
            elif k == b"stco":
                n = struct.unpack_from(">I", b, p)[0]
                t["chunks"] = list(struct.unpack_from(f">{n}I", b, p + 4))
            elif k == b"co64":
                n = struct.unpack_from(">I", b, p)[0]
                t["chunks"] = list(struct.unpack_from(f">{n}Q", b, p + 4))
        out[htype] = t
    return out


def samples(t):
    """(offset, size) of every sample of a track, in order, from its tables."""
    chunks, stsc = t["chunks"], list(t["stsc"]) + [(len(t["chunks"]) + 1, 0, 0)]
    si, j = 0, 0
    for ci, off in enumerate(chunks, start=1):
        while stsc[j + 1][0] <= ci:
            j += 1
        for _ in range(stsc[j][1]):
            yield off, t["stsz"][si]
            off += t["stsz"][si]
            si += 1


def chunk_spans(t):
    """(offset, n_samples, duration_in_ticks) of every chunk of a track."""
    durs = [d for n, d in t["stts"] for _ in range(n)]
    chunks, stsc = t["chunks"], list(t["stsc"]) + [(len(t["chunks"]) + 1, 0, 0)]
    si, j, out = 0, 0, []
    for ci, off in enumerate(chunks, start=1):
        while stsc[j + 1][0] <= ci:
            j += 1
        n = stsc[j][1]
        out.append((off, n, sum(durs[si:si + n])))
        si += n
    return out


# ════════════════════════════════════════════════════════════════════════════
# What the reference teaches
# ════════════════════════════════════════════════════════════════════════════
class Profile:
    """Everything learned from the complete reference that the scan and the timing rely on."""

    def __init__(self, ref_path):
        self.ref = ref_path
        self.moov = read_moov(ref_path)
        self.t = tables(self.moov)
        v, a = self.t["vide"], self.t["soun"]
        self.audio_ts = a["timescale"]
        vs, as_ = v["stsz"], a["stsz"]
        # size bounds, with a margin either side of what the reference holds
        self.vmin, self.vmax = int(min(vs) * 0.93) - 4, int(max(vs) * 1.7)
        self.amin, self.amax = max(16, min(as_) - 8), max(as_) + 21
        # ⚠ amax stays tight on purpose: wider lets two real AAC frames pass as one frame
        with open(ref_path, "rb") as f:
            starts = []
            for k, (off, _) in enumerate(samples(a)):
                if k >= LEARN_FRAMES:
                    break
                f.seek(off)
                starts.append(f.read(3))
        self.prefix3 = set(starts)
        self.prefix2 = {s[:2] for s in starts}
        self.learned = min(len(as_), LEARN_FRAMES)
        # the muxer's chunk clock
        vc = chunk_spans(v)
        ac = chunk_spans(a)
        self.chunk_s = sum(d for _, _, d in vc) / v["timescale"] / len(vc)
        both = sorted([(o, "v", i) for i, (o, _, _) in enumerate(vc)] + [(o, "a", i) for i, (o, _, _) in enumerate(ac)])
        vstart = _starts(vc, v["timescale"])
        astart = _starts(ac, a["timescale"])
        lags = [astart[y[2]] - vstart[x[2]] for x, y in zip(both, both[1:]) if x[1] == "v" and y[1] == "a"]
        self.audio_lag_s = sorted(lags)[len(lags) // 2] if lags else 0.5
        if v["stts"] and any(d == 0 for _, d in v["stts"]):
            raise SystemExit("reference has zero-length video samples — not a usable reference")

    def summary(self):
        return (f"video {len(self.t['vide']['stsz']):,} frames, audio {len(self.t['soun']['stsz']):,} frames; "
                f"frame bytes {self.vmin + 4:,}-{self.vmax:,}, AAC bytes {self.amin}-{self.amax}; "
                f"{len(self.prefix3)} learned AAC openings ({len(self.prefix2)} short); "
                f"chunk {self.chunk_s:.3f} s, audio lag {self.audio_lag_s:.3f} s")


def _starts(chunks, ts):
    out, t = [], 0
    for _, _, d in chunks:
        out.append(t / ts)
        t += d
    return out


# ════════════════════════════════════════════════════════════════════════════
# Scanning raw sample data
# ════════════════════════════════════════════════════════════════════════════
def u32(m, p):
    return struct.unpack_from(">I", m, p)[0]


def ue(data, i):
    """One Exp-Golomb ue(v) from `data` at bit i -> (value, next bit), or (None, i) if malformed."""
    z = 0
    while i < len(data) * 8 and not (data[i >> 3] >> (7 - (i & 7))) & 1:
        z += 1
        i += 1
        if z > 16:
            return None, i
    i += 1
    v = 0
    for _ in range(z):
        if i >= len(data) * 8:
            return None, i
        v = (v << 1) | ((data[i >> 3] >> (7 - (i & 7))) & 1)
        i += 1
    return (1 << z) - 1 + v, i


def slice_ok(m, q, end, prof):
    """A plausible slice NAL at q: length in range, header 0x21/0x65, and a slice header no real
    frame of this encoder would lack (first_mb_in_slice 0, pic_parameter_set_id 0, IDR => I).

    🛑 Without the slice-header half, random bytes 799 bytes before a real frame read as a 2.4 MB
    "keyframe" whose end landed on a genuine frame boundary, and swallowed ~80 real frames at the
    4 GiB mark of the 2026-10-10 recording."""
    if q + 13 > end:
        return False
    n = u32(m, q)
    nal = m[q + 4]
    if not (prof.vmin <= n <= prof.vmax and nal in (0x21, 0x65) and m[q + 5] & 0x80):
        return False
    data = bytes(m[q + 5:q + 13])
    first_mb, i = ue(data, 0)
    slice_type, i = ue(data, i)
    pps, i = ue(data, i)
    if first_mb != 0 or pps != 0 or slice_type is None:
        return False
    st = slice_type % 5
    return st == 2 if nal == 0x65 else st in (0, 2)


def video_len(m, p, end, prof):
    """Byte length of the whole video sample starting at p, or 0 if none starts there. Its last NAL
    may run past `end` (a truncated tail) — the caller decides what to do with that.

    A sample is optional SPS / PPS / SEI / AUD NALs followed by exactly one slice. ⚠ The phone's
    2026-10-10 output never carried parameter sets in-band, but an ffmpeg remux of it did (SPS +
    PPS + IDR in one sample), and an encoder restart can too. Treating only bare slices as frames
    made the scan stop at the first such keyframe and drop everything after it."""
    q = p
    for _ in range(4):
        if q + 5 > end:
            return 0
        h = m[q + 4]
        if h not in LEADING_NALS:
            break
        n = u32(m, q)
        if not 1 <= n <= LEADING_NALS[h]:
            return 0
        q += 4 + n
    if not slice_ok(m, q, end, prof):
        return 0
    return (q - p) + 4 + u32(m, q)


def video_at(m, p, end, prof):
    return video_len(m, p, end, prof) > 0


def slice_header_byte(m, off):
    """The NAL header of a sample's slice (skipping any leading parameter NALs)."""
    q = off
    for _ in range(4):
        if m[q + 4] not in LEADING_NALS:
            break
        q += 4 + u32(m, q)
    return m[q + 4]


def ends_frame(m, b_end, start):
    """Does an AAC frame ending just before b_end finish with ID_END (111) + zero padding?"""
    b = m[b_end - 1]
    if b == 0:
        return False
    tz = (b & -b).bit_length() - 1
    run, x = 0, b >> tz
    while x & 1 and run < 8 - tz:
        run += 1
        x >>= 1
    if run >= 3:
        return True
    if tz + run == 8 and b_end - 2 >= start:          # 111 straddles into the previous byte
        need = 3 - run
        return m[b_end - 2] & ((1 << need) - 1) == (1 << need) - 1
    return False


def frame_start(m, p, prof, strict=True):
    if m[p] != 0x21:
        return False
    return bytes(m[p:p + 3]) in prof.prefix3 if strict else bytes(m[p:p + 2]) in prof.prefix2


def split_audio(m, a, b, prof, strict=True):
    """Split [a, b) into AAC frames -> (sizes, ambiguous) or (None, reason).

    ⚠ When several splits are valid, take the one with the MOST frames: two real frames glued
    together also open with a frame start and close with an end code, so a merge always looks
    valid, while a false boundary inside a frame needs both signatures by chance. The first
    version kept the first split it found and recovered half the expected frames."""
    n = b - a
    if n < prof.amin:
        return None, "too short"
    starts = [i for i in range(n) if frame_start(m, a + i, prof, strict)]
    if not starts or starts[0] != 0:
        return None, "run does not open with a frame start"
    nodes = starts + [n]
    index = {x: k for k, x in enumerate(nodes)}
    ways, best, prev = [0] * len(nodes), [-1] * len(nodes), [-1] * len(nodes)
    ways[0], best[0] = 1, 0
    for k, i in enumerate(nodes[:-1]):
        if not ways[k]:
            continue
        for j in nodes[bisect_left(nodes, i + prof.amin):bisect_right(nodes, i + prof.amax)]:
            if not ends_frame(m, a + j, a + i):
                continue
            kj = index[j]
            if best[k] + 1 > best[kj]:
                best[kj], prev[kj] = best[k] + 1, k
            ways[kj] = min(ways[kj] + ways[k], 2)
    last = len(nodes) - 1
    if not ways[last]:
        return None, "no segmentation"
    sizes, k = [], last
    while k > 0:
        sizes.append(nodes[k] - nodes[prev[k]])
        k = prev[k]
    return sizes[::-1], ways[last] > 1


def scan(path, prof):
    """Walk the raw sample data -> (runs, stats). A run is (kind, offset, sizes) with kind 'v'
    (video), 'a' (audio) or 'x' (audio that could not be split; its time is kept, its sound lost)."""
    boxes = top_level(path)
    mdat = next((b for b in boxes if b[0] == "mdat"), None)
    if mdat is None:
        raise SystemExit(f"{path}: no mdat box")
    _, moff, msize, hl = mdat
    f = open(path, "rb")
    m = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
    end = min(len(m), moff + msize)
    runs, pos, stats = [], moff + hl, Counter()
    while pos < end:
        if video_at(m, pos, end, prof):
            start, sizes = pos, []
            while (n := video_len(m, pos, end, prof)):
                if pos + n > end:
                    stats["truncated final frame dropped"] += 1
                    break
                sizes.append(n)
                pos += n
            if not sizes:
                break
            runs.append(("v", start, sizes))
            if pos + 13 > end or pos + video_len(m, pos, end, prof) > end:
                break
            continue
        start, found = pos, None
        for hit in HEADER.finditer(m, pos + prof.amin + 4, min(end - 6, pos + AUDIO_RUN_MAX) + 4):
            q = hit.start() - 4
            n = video_len(m, q, end, prof)
            if n:
                nxt = q + n
                # ⚠ The SHORT prefixes here, not the learned ones: an audio packet with an opening the
                # reference never showed made the strict check reject a real frame, and the scan
                # stopped there. The slice-header test already makes a false frame very unlikely.
                if nxt >= end or video_at(m, nxt, end, prof) or (nxt + 2 < end and frame_start(m, nxt, prof, False)):
                    found = q
                    break
        if found is None:
            stats["audio at the very end dropped (no video after it)"] += 1
            break
        sizes, amb = split_audio(m, start, found, prof)
        if sizes is None:
            sizes, amb = split_audio(m, start, found, prof, strict=False)
            if sizes is not None:
                stats["audio runs split with the short prefixes"] += 1
        if sizes is None:
            stats["audio runs unsplittable (sound lost, time kept)"] += 1
            runs.append(("x", start, [found - start]))
        else:
            stats["audio runs with more than one valid split"] += amb
            runs.append(("a", start, sizes))
        pos = found
    stats["recovered bytes"] = pos - (moff + hl)
    stats["unrecovered tail bytes"] = len(m) - pos
    m.close()
    f.close()
    return runs, stats


def flatten(runs, kind):
    for k, off, sizes in runs:
        if k == kind:
            for s in sizes:
                yield off, s
                off += s


def impossible_frames(path, runs, prof):
    """Recovered video samples whose slice header no real frame would have. Should be zero."""
    f = open(path, "rb")
    m = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
    bad = [off for off, size in flatten(runs, "v") if video_len(m, off, len(m), prof) != size]
    m.close()
    f.close()
    return bad


# ════════════════════════════════════════════════════════════════════════════
# Timing: the muxer's chunk clock
# ════════════════════════════════════════════════════════════════════════════
def chunk_counts(runs):
    """How many ~1 s chunks each video run holds. Two video chunks back to back read as one run,
    so a run with about twice its neighbours' frames counts as two."""
    vr = [i for i, r in enumerate(runs) if r[0] == "v"]
    n = [len(runs[i][2]) for i in vr]
    counts = {}
    for k, i in enumerate(vr):
        around = n[max(0, k - NEIGHBOURS):k] + n[k + 1:k + 1 + NEIGHBOURS]
        local = sorted(around)[len(around) // 2] if around else n[k]
        counts[i] = max(1, round(n[k] / local)) if local else 1
    return counts


def timeline(runs, chunk_s, audio_lag_s, audio_ts):
    """Per-sample durations (video at 90 kHz in whole 1/60 s ticks, audio at `audio_ts`).

    ⚠ NOT the audio clock: on 2026-10-10 the reference held 67.3 min of AAC frames across 84.5 min
    of video — the phone dropped audio while throttling — so counting audio frames ran 17 min
    short. Video run i is spread over its chunks of `chunk_s`; the audio after it starts
    `audio_lag_s` later, 1024 samples a frame, and a run's last frame stretches to the next run's
    slot, which is how the muxer records a gap.

    🛑 Video is rounded against the CUMULATIVE clock. Rounding each run on its own accumulated and
    put video 6 s away from the audio."""
    counts = chunk_counts(runs)
    v_runs, a_runs, clock, last_v = [], [], 0.0, None
    for i, (kind, _, sizes) in enumerate(runs):
        if kind == "v":
            span = counts[i] * chunk_s
            v_runs.append((clock, len(sizes), span))
            last_v = clock
            clock += span
        elif kind == "a":
            a_runs.append(((last_v or 0.0) + audio_lag_s, len(sizes)))
    v_durs, tick = [], 0
    for t0, n, span in v_runs:
        ticks = max(n, round((t0 + span) * 60) - tick)
        tick += ticks
        base, extra = divmod(ticks, n)
        acc = 0
        for _ in range(n):
            acc += extra
            d = base + (1 if acc >= n else 0)
            if acc >= n:
                acc -= n
            v_durs.append(d * 1500)
    a_durs, t_audio = [], 0
    for t0, n in a_runs:
        start = max(round(t0 * audio_ts), t_audio)
        if a_durs:
            a_durs[-1] += start - t_audio
            t_audio = start
        else:
            t_audio = 0
        a_durs.extend([AAC] * n)
        t_audio += n * AAC
    return v_durs, a_durs


# ════════════════════════════════════════════════════════════════════════════
# Building the new index
# ════════════════════════════════════════════════════════════════════════════
def rle(values):
    out = []
    for v in values:
        if out and out[-1][1] == v:
            out[-1][0] += 1
        else:
            out.append([1, v])
    return out


def sample_tables(runs, kind, durs, keyframes=None):
    chunks, spc, sizes = [], [], []
    for k, off, s in runs:
        if k == kind and s:
            chunks.append(off)
            spc.append(len(s))
            sizes.extend(s)
    stts = rle(durs)
    stsc = []
    for ci, n in enumerate(spc, start=1):
        if not stsc or stsc[-1][1] != n:
            stsc.append([ci, n, 1])
    vf = b"\x00\x00\x00\x00"
    boxes = [
        [b"stts", vf + struct.pack(">I", len(stts)) + b"".join(struct.pack(">II", c, d) for c, d in stts)],
        [b"stsc", vf + struct.pack(">I", len(stsc)) + b"".join(struct.pack(">III", *r) for r in stsc)],
        [b"stsz", vf + struct.pack(">II", 0, len(sizes)) + struct.pack(f">{len(sizes)}I", *sizes)],
        [b"co64", vf + struct.pack(">I", len(chunks)) + struct.pack(f">{len(chunks)}Q", *chunks)],
    ]
    if keyframes is not None:
        boxes.insert(1, [b"stss", vf + struct.pack(">I", len(keyframes)) + struct.pack(f">{len(keyframes)}I", *keyframes)])
    return boxes, len(sizes), sum(durs)


def set_duration(body, off_v0, off_v1, value):
    b = bytearray(body)
    if b[0] == 1:
        struct.pack_into(">Q", b, off_v1, value)
    else:
        struct.pack_into(">I", b, off_v0, value)
    return bytes(b)


def build_moov(template_moov, runs, keyframes, v_durs, a_durs):
    """A new moov: the template's codec boxes (stsd) verbatim, fresh sample tables, no edit list."""
    moov = parse(template_moov[8:])
    mvhd = child(moov, b"mvhd")
    movie_ts = struct.unpack_from(">I", mvhd, 20 if mvhd[0] == 1 else 12)[0]
    movie_dur, out, report = 0, [], []
    for kind, body in moov:
        if kind != b"trak":
            out.append([kind, body])
            continue
        trak = [[k, b] for k, b in body if k != b"edts"]
        mdia = child(trak, b"mdia")
        htype = child(mdia, b"hdlr")[8:12]
        mdhd = child(mdia, b"mdhd")
        tk = "v" if htype == b"vide" else "a"
        # ⚠ Video durations are written in 90 kHz ticks, so the track must SAY 90 kHz. IRL Pro's
        # already does; an ffmpeg-made template ticked at 10,240 Hz and every frame came out 8.79x
        # too long. Audio keeps its own rate, which the durations were computed in.
        if tk == "v":
            mdhd = bytearray(mdhd)
            struct.pack_into(">I", mdhd, 20 if mdhd[0] == 1 else 12, VIDEO_TS)
            mdhd = bytes(mdhd)
            for i, (k, b) in enumerate(mdia):
                if k == b"mdhd":
                    mdia[i][1] = mdhd
        ts = struct.unpack_from(">I", mdhd, 20 if mdhd[0] == 1 else 12)[0]
        boxes, count, total = sample_tables(runs, tk, v_durs if tk == "v" else a_durs,
                                            keyframes if tk == "v" else None)
        stbl = child(child(mdia, b"minf"), b"stbl")
        stsd = next(b for k, b in stbl if k == b"stsd")
        stbl[:] = [[b"stsd", stsd]] + boxes
        for i, (k, b) in enumerate(mdia):
            if k == b"mdhd":
                mdia[i][1] = set_duration(b, 16, 24, total)
        mdur = round(total * movie_ts / ts)
        movie_dur = max(movie_dur, mdur)
        for i, (k, b) in enumerate(trak):
            if k == b"tkhd":
                trak[i][1] = set_duration(b, 20, 28, mdur)
        out.append([b"trak", trak])
        report.append((htype.decode(), count, total / ts))
    for i, (k, b) in enumerate(out):
        if k == b"mvhd":
            out[i][1] = set_duration(b, 16, 24, movie_dur)
    body = serialise(out)
    return struct.pack(">I4s", 8 + len(body), b"moov") + body, report


def keyframe_numbers(path, runs):
    f = open(path, "rb")
    m = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
    keys = [k for k, (off, _) in enumerate(flatten(runs, "v"), start=1) if slice_header_byte(m, off) == 0x65]
    m.close()
    f.close()
    return keys


def write_recovered(broken, out, runs, moov):
    """Clone the broken file (APFS clonefile where it can, so it is instant and costs no space),
    cut it after the last recovered sample, fix the mdat size, append the new moov. The broken
    file itself is never modified."""
    boxes = top_level(broken)
    _, moff, _, hl = next(b for b in boxes if b[0] == "mdat")
    last_end = max(off + sum(s) for _, off, s in runs)
    if subprocess.run(["cp", "-c", broken, out], capture_output=True).returncode != 0:
        shutil.copyfile(broken, out)
    with open(out, "r+b") as g:
        g.truncate(last_end)
        g.seek(moff)
        if hl == 16:
            g.write(struct.pack(">I4sQ", 1, b"mdat", last_end - moff))
        else:
            if last_end - moff >= 2 ** 32:
                raise SystemExit("32-bit mdat header cannot describe this size")
            g.write(struct.pack(">I4s", last_end - moff, b"mdat"))
        g.seek(last_end)
        g.write(moov)


# ════════════════════════════════════════════════════════════════════════════
# Checks against the reference
# ════════════════════════════════════════════════════════════════════════════
def validate_scan(prof):
    """Scan the reference and compare against its real index. Returns (video_exact, audio_rate)."""
    runs, stats = scan(prof.ref, prof)
    results = {}
    for kind, tt in (("v", "vide"), ("a", "soun")):
        truth = list(samples(prof.t[tt]))
        got = set(flatten(runs, kind))
        hit = [x in got for x in truth]
        results[tt] = (sum(hit), len(truth), len(got) - sum(hit), hit)
    vh, vn, vx, _ = results["vide"]
    ah, an, ax, ahit = results["soun"]
    held = ahit[prof.learned:]
    print(f"   video: {vh:,} of {vn:,} frames exact, {vx:,} spurious")
    print(f"   audio: {ah:,} of {an:,} frames exact ({ah / an:.3%}); "
          + (f"held out {sum(held):,} of {len(held):,} ({sum(held) / len(held):.3%})" if held else "no frames held out"))
    return runs, vh == vn and vx == 0, ah / an


def validate_timing(prof, runs):
    """How far the chunk clock lands from the reference's real timestamps."""
    v_durs, a_durs = timeline(runs, prof.chunk_s, prof.audio_lag_s, prof.audio_ts)

    def stamps(durs, ts):
        out, t = [], 0
        for d in durs:
            out.append(t / ts)
            t += d
        return out

    rv = stamps([d for n, d in prof.t["vide"]["stts"] for _ in range(n)], prof.t["vide"]["timescale"])
    ra = stamps([d for n, d in prof.t["soun"]["stts"] for _ in range(n)], prof.audio_ts)
    ev, ea = stamps(v_durs, VIDEO_TS), stamps(a_durs, prof.audio_ts)
    sync = []
    for i in range(0, min(len(ra), len(ea)), 50):
        j = min(bisect(rv, ra[i]), len(rv) - 1, len(ev) - 1)
        sync.append(abs((ea[i] - ev[j]) - (ra[i] - rv[j])))
    sync.sort()
    total_err = (ev[-1] - rv[-1]) if ev and rv else 0
    print(f"   timing: total {ev[-1] / 60:.1f} min vs real {rv[-1] / 60:.1f} min ({total_err:+.0f} s); "
          f"A/V sync median {sync[len(sync) // 2] * 1000:.0f} ms, p95 {sync[int(len(sync) * .95)] * 1000:.0f} ms")
    return abs(total_err) / rv[-1], sync[len(sync) // 2]


def verify_decode(path, points=5):
    """Decode a few stretches spread across the file; return the error lines."""
    from detect import ffmpeg
    info = subprocess.run([ffmpeg(), "-hide_banner", "-i", path], capture_output=True, text=True).stderr
    line = next((l for l in info.splitlines() if "Duration" in l), None)
    if not line:
        return ["ffmpeg cannot read the file at all"]
    h, mi, s = line.split("Duration:")[1].split(",")[0].strip().split(":")
    total = int(h) * 3600 + int(mi) * 60 + float(s)
    errors = []
    for k in range(points):
        at = 30 + (total - 60) * k / max(1, points - 1)
        r = subprocess.run([ffmpeg(), "-v", "error", "-ss", f"{at:.1f}", "-i", path, "-t", "8",
                            "-map", "0:v:0", "-map", "0:a:0?", "-f", "null", "-"], capture_output=True, text=True)
        bad = [l for l in r.stderr.splitlines() if l.strip()]
        print(f"   {at / 60:7.1f} min: {'clean' if not bad else f'{len(bad)} error lines'}")
        errors += bad
    return errors


# ════════════════════════════════════════════════════════════════════════════
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("broken", nargs="?", help="the recording that was cut short")
    ap.add_argument("--reference", help="a COMPLETE recording by the same phone, app and settings")
    ap.add_argument("-o", "--out", help="where to write the recovered file")
    ap.add_argument("--inspect", metavar="FILE", help="print a file's top-level boxes and stop")
    ap.add_argument("--force", action="store_true", help="build even if the reference gate fails (not advised)")
    args = ap.parse_args(argv)

    if args.inspect:
        size = os.path.getsize(args.inspect)
        for kind, off, sz, _ in top_level(args.inspect):
            past = "  ⚠ runs past the end of the file" if off + sz > size else ""
            print(f"  @{off:>15,}  {kind!r:<8} {sz:>16,} bytes{past}")
        return 0
    if not (args.broken and args.reference and args.out):
        ap.error("need BROKEN, --reference and -o (or --inspect FILE)")
    if os.path.exists(args.out):
        raise SystemExit(f"refusing to overwrite {args.out}")

    print(f"1. learning from the reference: {args.reference}")
    prof = Profile(args.reference)
    print(f"   {prof.summary()}")

    print("2. 🛑 gate: scanning the reference and comparing with its real index")
    ref_runs, video_exact, audio_rate = validate_scan(prof)
    if not video_exact and not args.force:
        raise SystemExit("   FAIL — the scanner cannot reproduce the reference's video exactly. "
                         "Is it really the same phone, app and settings? (--force overrides)")
    # 🛑 A gate on timing too, not just a report. The chunk clock is IRL Pro's habit of cutting a
    # chunk every ~1 s; on a file ffmpeg had remuxed (~28 ms chunks) it measured 40% long and the
    # first version built the file anyway.
    err, sync = validate_timing(prof, ref_runs)
    if (err > TIMING_MAX_ERROR or sync > SYNC_MAX_S) and not args.force:
        raise SystemExit(f"   FAIL — the chunk clock lands the reference {err:.1%} off with a {sync:.2f} s median A/V "
                         f"error. Its timing model does not fit this layout (it expects IRL Pro's ~1 s chunks). "
                         f"(--force overrides)")

    print(f"3. scanning the broken file: {args.broken}")
    runs, stats = scan(args.broken, prof)
    for k, v in stats.items():
        print(f"   {k}: {v:,}")
    tail = stats["unrecovered tail bytes"]
    if tail > MAX_CRASH_TAIL and not args.force:
        raise SystemExit(f"   STOP — the scan ended with {tail / 2**30:.2f} GiB unread. A crash leaves a few MB at "
                         f"most; this means it hit something it does not recognise, and the result would be "
                         f"silently truncated. (--force overrides)")
    bad = impossible_frames(args.broken, runs, prof)
    if bad:
        raise SystemExit(f"   {len(bad)} recovered frames have impossible slice headers (first at {bad[0]:,}) — stop")

    print("4. rebuilding the index")
    v_durs, a_durs = timeline(runs, prof.chunk_s, prof.audio_lag_s, prof.audio_ts)
    moov, report = build_moov(prof.moov, runs, keyframe_numbers(args.broken, runs), v_durs, a_durs)
    for htype, count, secs in report:
        print(f"   {htype}: {count:,} samples, {secs / 60:.1f} min")
    write_recovered(args.broken, args.out, runs, moov)
    print(f"   wrote {args.out} ({os.path.getsize(args.out) / 2**30:.2f} GiB)")

    print("5. decoding stretches of the result")
    errors = verify_decode(args.out)
    print("done — " + ("every stretch decoded clean" if not errors else f"{len(errors)} decoder lines; inspect before use"))
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
