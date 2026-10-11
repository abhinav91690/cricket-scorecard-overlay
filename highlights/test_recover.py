"""Does recover.py rebuild a dead recording's index exactly — and refuse when it cannot?

No footage is used. The tests write SYNTHETIC recordings with IRL Pro's byte structure: ~1 s chunks
of video and audio back to back, one H.264 NAL per frame with a real slice header, raw AAC packets
that open with a learned prefix and close with the end code. A complete one is the reference; a
different one, cut off mid-frame with garbage in its mdat size, is the "dead phone".

Every test below is a mistake actually made while recovering the 2026-10-10 match:

  test_scan_rejects_the_4gib_fake    random bytes read as a 2.4 MB keyframe whose end landed on a
                                     real frame boundary; ~80 frames swallowed (slice header fixed it)
  test_scan_handles_in_band_sps_pps  a keyframe carrying SPS + PPS stopped the scan dead, silently
  test_split_prefers_two_frames      two real AAC frames glued together passed as one: half the audio
  test_timeline_has_no_rounding_drift per-run rounding put video 6 s away from the audio
  test_gate_refuses_a_mismatched_reference / test_timing_gate_refuses_a_bad_clock
                                     a check that only REPORTS is not a gate

    python highlights/test_recover.py     # standalone
    pytest highlights/test_recover.py
"""
import math
import os
import random
import struct
import subprocess
import sys
import tempfile
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import recover
from detect import ffmpeg

AAC_PREFIX = b"\x21\x1a\x00"
FILL = b"\x55"                      # 01010101: no 0x21/0x65/0x67/0x68, so no accidental candidates


def frames_this_second(c, rng):
    """⚠ A smoothly varying frame rate, as a throttling phone produces. Random 20-60 per second
    would trip the doubled-chunk detector and fail the timing tests for the wrong reason."""
    return 40 + int(15 * math.sin(c / 6)) + rng.randint(-2, 2)


# ---------- byte builders ----------
def bits(s: str) -> bytes:
    s = s + "0" * (-len(s) % 8)
    return bytes(int(s[i:i + 8], 2) for i in range(0, len(s), 8))


UE = {0: "1", 1: "010", 2: "011", 5: "00110", 7: "0001000"}


def slice_nal(n: int, idr=False, slice_type=None, pps=0, first_mb=0) -> bytes:
    """A length-prefixed slice NAL of n bytes (header included) with a parseable slice header."""
    st = (7 if idr else 0) if slice_type is None else slice_type
    head = bits(UE[first_mb] + UE[st] + UE[pps])
    body = bytes([0x65 if idr else 0x21]) + head
    return struct.pack(">I", n) + body + FILL * (n - len(body))


def param_nal(kind: int, n: int) -> bytes:
    return struct.pack(">I", n) + bytes([kind]) + FILL * (n - 1)


def aac(n: int) -> bytes:
    return AAC_PREFIX + FILL * (n - 4) + b"\x07"         # 0x07: ID_END (111), no padding


def profile(**over):
    p = SimpleNamespace(vmin=500, vmax=50_000, amin=200, amax=460,
                        prefix3={AAC_PREFIX}, prefix2={AAC_PREFIX[:2]},
                        chunk_s=1.0, audio_lag_s=0.0, audio_ts=44_100)
    p.__dict__.update(over)
    return p


# ---------- a synthetic IRL Pro recording ----------
def write_recording(path, seed, chunks=40, crash=False, decoy_at=None, inband_at=None, moov=None,
                    odd_prefix_at=None):
    """Write ftyp + free + 16-byte mdat + alternating ~1 s video/audio chunks.

    Returns (runs, video_durs, audio_durs, keyframes) — the TRUE layout and timing."""
    rng = random.Random(seed)
    head = struct.pack(">I4s4sI4s4s", 24, b"ftyp", b"mp42", 0, b"isom", b"mp42")
    head += struct.pack(">I4s", 3200, b"free") + b"\x00" * 3192
    mdat_at = len(head)
    payload = bytearray()
    base = mdat_at + 16
    runs, vd, ad, keys, nframe = [], [], [], [], 0
    for c in range(chunks):
        n = 1 if odd_prefix_at == c else frames_this_second(c, rng)
        sizes, off = [], base + len(payload)
        for i in range(n):
            nframe += 1
            idr = i == 0
            size = rng.randint(600, 900)
            if idr and inband_at == c:                # SPS + PPS + IDR in ONE sample
                sample = param_nal(0x67, 18) + param_nal(0x68, 4) + slice_nal(size, idr=True)
            else:
                sample = slice_nal(size, idr=idr)
            if idr:
                keys.append(nframe)
            payload += sample
            sizes.append(len(sample))
        runs.append(("v", off, sizes))
        # this second's frame durations, in whole 90 kHz ticks summing to exactly 1 s
        acc = 0
        for i in range(n):
            nxt = round(90_000 * (i + 1) / n)
            vd.append(nxt - acc)
            acc = nxt
        m = 43 if c % 7 else rng.randint(25, 40)       # some seconds drop audio
        sizes, off = [], base + len(payload)
        run = bytearray()
        starts = []
        for i in range(m):
            starts.append(len(run))
            pk = aac(rng.randint(220, 300))
            if odd_prefix_at == c and i == 0:          # an opening the reference never showed
                pk = b"\x21\x1a\x08" + pk[3:]
            run += pk
            sizes.append(len(pk))
        if decoy_at == c:
            # 🛑 the 4 GiB shape: a "keyframe" header with a BAD slice header (pps 2), long enough
            # to pass the size checks, whose length lands exactly on the next real video frame.
            # Placed inside a packet's filler, ~1000 bytes before the run ends.
            k = max(i for i, st in enumerate(starts) if st <= len(run) - 1000)
            pos = starts[k] + 8
            fake = struct.pack(">I", len(run) - pos - 4) + b"\x65" + bits(UE[0] + UE[7] + UE[2])
            run[pos:pos + len(fake)] = fake
        payload += run
        runs.append(("a", off, sizes))
        gap = 0 if m == 43 else (round(44_100 * 1.0) - m * 1024)
        ad.extend([1024] * m)
        ad[-1] += max(0, gap)
    if crash:                                          # dies mid-frame
        payload += slice_nal(800)[:300]
    size = 16 + len(payload)
    mdat = struct.pack(">I4sQ", 1, b"mdat", 4_557_430_888_798_830_399 if crash else size)
    with open(path, "wb") as f:
        f.write(head + mdat + payload)
        if moov:
            f.write(moov)
    return runs, vd, ad, keys


def template(d):
    """A tiny real MP4 whose moov supplies codec boxes (stsd) and track headers to rebuild with."""
    p = os.path.join(d, "template.mp4")
    subprocess.run([ffmpeg(), "-nostdin", "-loglevel", "error", "-f", "lavfi", "-i",
                    "testsrc=size=64x64:rate=10:duration=1", "-f", "lavfi", "-i", "sine=duration=1",
                    "-c:v", "mpeg4", "-c:a", "aac", "-shortest", "-y", p], check=True, capture_output=True)
    return recover.read_moov(p)


def reference(d, seed=1, chunks=40, durations=None):
    """A COMPLETE synthetic recording: its true moov is built from its true layout and timing."""
    path = os.path.join(d, "reference.mp4")
    runs, vd, ad, keys = write_recording(path, seed, chunks)
    if durations:
        vd, ad = durations(vd, ad)
    moov, _ = recover.build_moov(template(d), runs, keys, vd, ad)
    with open(path, "ab") as f:
        f.write(moov)
    return path, runs


def sha256(path):
    import hashlib
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def complete_samples(runs, kind):
    return list(recover.flatten(runs, kind))


# ════════════════════════════════════════════════════════════════════════════
def test_ue_reads_exp_golomb():
    for v, code in UE.items():
        assert recover.ue(bits(code), 0)[0] == v, (v, code)


def test_ends_frame_end_code_and_straddle():
    def ok(prev, last):
        return recover.ends_frame(bytes([prev, last]), 2, 0)
    assert ok(0x00, 0x07) and ok(0x00, 0xe0) and ok(0x00, 0x1c)
    assert ok(0x01, 0xc0), "111 split as 1 | 11 + padding"
    assert ok(0x03, 0x80), "111 split as 11 | 1 + padding"
    assert not ok(0x00, 0xc0), "only two of the three end bits"
    assert not ok(0x00, 0x06) and not ok(0x00, 0x00)


def test_slice_header_check():
    p = profile()
    m = lambda b: b + b"\x00" * 32
    assert recover.video_len(m(slice_nal(800)), 0, 832, p) == 804
    assert recover.video_len(m(slice_nal(800, idr=True)), 0, 832, p) == 804
    assert not recover.video_len(m(slice_nal(800, pps=2)), 0, 832, p), "pps 2: the 4 GiB fake"
    assert not recover.video_len(m(slice_nal(800, first_mb=1)), 0, 832, p)
    assert not recover.video_len(m(slice_nal(800, idr=True, slice_type=0)), 0, 832, p), "an IDR must be I"
    inband = param_nal(0x67, 18) + param_nal(0x68, 4) + slice_nal(800, idr=True)
    assert recover.video_len(m(inband), 0, len(inband) + 32, p) == len(inband)


def test_split_prefers_two_frames_over_a_merge():
    """Two real 210-byte frames also read as one valid 420-byte frame. Merging halved the audio."""
    run = aac(210) + aac(210)
    sizes, amb = recover.split_audio(run, 0, len(run), profile())
    assert amb, "both splits are valid — that is the point"
    assert sizes == [210, 210], sizes


def test_split_ignores_a_false_start_without_an_end_code():
    pk = bytearray(aac(300))
    pk[150:153] = AAC_PREFIX                           # looks like a start; byte before is not an end
    sizes, _ = recover.split_audio(bytes(pk), 0, 300, profile())
    assert sizes == [300], sizes


def test_scan_recovers_every_complete_sample_of_a_dead_recording():
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "dead.mp4")
        runs, *_ = write_recording(path, seed=7, crash=True)
        got, stats = recover.scan(path, profile())
        for k in ("v", "a"):
            assert complete_samples(got, k) == complete_samples(runs, k), k
        assert stats["unrecovered tail bytes"] == 300, "only the half-written frame is lost"


def test_scan_rejects_the_4gib_fake():
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "decoy.mp4")
        runs, *_ = write_recording(path, seed=3, crash=True, decoy_at=5)
        got, _ = recover.scan(path, profile())
        assert complete_samples(got, "v") == complete_samples(runs, "v"), \
            "a fake keyframe was accepted, swallowing real frames"


def test_scan_handles_in_band_sps_pps():
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "inband.mp4")
        runs, *_ = write_recording(path, seed=4, crash=True, inband_at=9)
        got, stats = recover.scan(path, profile())
        assert complete_samples(got, "v") == complete_samples(runs, "v")
        assert stats["unrecovered tail bytes"] == 300, "the scan stopped at the SPS/PPS keyframe"


def test_scan_survives_an_unlearned_aac_opening():
    """A one-frame video run followed by audio that opens with a 3-byte prefix the reference never
    showed. Checking the sample after a candidate frame against the LEARNED prefixes rejected the
    real frame there and the scan stopped — 10.8 GiB into a real file."""
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "odd.mp4")
        runs, *_ = write_recording(path, seed=5, crash=True, odd_prefix_at=8)
        got, stats = recover.scan(path, profile())
        assert complete_samples(got, "v") == complete_samples(runs, "v")
        assert stats["unrecovered tail bytes"] == 300, "the scan stopped at the unlearned opening"


def test_timeline_has_no_rounding_drift():
    rng = random.Random(9)
    runs = []
    for c in range(3000):
        runs.append(("v", 0, [1] * frames_this_second(c, rng)))
        runs.append(("a", 0, [1] * 43))
    # ⚠ 1.014 s, the chunk length measured on the real file — NOT 1.0. At exactly 1 s every run is
    # a whole 60 ticks, nothing rounds, and per-run rounding passes this test (it did, once).
    chunk = 1.014
    v, a = recover.timeline(runs, chunk, 0.0, 44_100)
    assert all(d % 1500 == 0 and d >= 1500 for d in v), "whole 1/60 s capture ticks"
    assert abs(sum(v) / 90_000 - 3000 * chunk) <= 1 / 60, \
        f"video drifted to {sum(v) / 90_000:.2f} s, expected {3000 * chunk:.2f}"
    # each audio run starts on its video run's slot: no accumulated drift between the two
    t_v = t_a = 0
    vi = ai = 0
    for k, run in enumerate(runs):
        if run[0] == "v":
            start_v = t_v
            for _ in run[2]:
                t_v += v[vi]
                vi += 1
        else:
            assert abs(t_a / 44_100 - start_v / 90_000) < 0.03, f"audio off its slot at run {k}"
            for _ in run[2]:
                t_a += a[ai]
                ai += 1


def test_recovery_end_to_end_rebuilds_the_true_index():
    with tempfile.TemporaryDirectory() as d:
        ref, _ = reference(d)
        dead = os.path.join(d, "dead.mp4")
        truth, *_ = write_recording(dead, seed=11, crash=True, decoy_at=6, inband_at=12)
        out = os.path.join(d, "out.mp4")
        before = sha256(dead)
        real_verify = recover.verify_decode
        recover.verify_decode = lambda path, points=5: []      # the synthetic frames are not real H.264
        try:
            assert recover.main([dead, "--reference", ref, "-o", out]) == 0
        finally:
            recover.verify_decode = real_verify
        t = recover.tables(recover.read_moov(out))
        assert list(recover.samples(t["vide"])) == complete_samples(truth, "v")
        assert list(recover.samples(t["soun"])) == complete_samples(truth, "a")
        assert sha256(dead) == before, "the broken file itself must never be modified"


def test_gate_refuses_a_mismatched_reference():
    """A reference the scanner cannot reproduce must stop recovery, not merely be reported."""
    with tempfile.TemporaryDirectory() as d:
        ref, runs = reference(d)
        _, off, sizes = runs[0]
        with open(ref, "r+b") as f:                    # break the 2nd frame's slice header
            f.seek(off + sizes[0] + 5)
            f.write(b"\x00")
        dead = os.path.join(d, "dead.mp4")
        write_recording(dead, seed=2, crash=True)
        out = os.path.join(d, "out.mp4")
        try:
            recover.main([dead, "--reference", ref, "-o", out])
            raise AssertionError("recovery went ahead on a reference it could not reproduce")
        except SystemExit as e:
            assert "FAIL" in str(e), e
        assert not os.path.exists(out)


def test_timing_gate_refuses_a_bad_clock():
    """A reference whose chunks are NOT ~1 s of real time breaks the chunk clock; it must stop."""
    def wrong(vd, ad):
        return [d * 3 if i % 2 else d for i, d in enumerate(vd)], ad     # 2x real time per chunk
    with tempfile.TemporaryDirectory() as d:
        ref, _ = reference(d, durations=wrong)
        dead = os.path.join(d, "dead.mp4")
        write_recording(dead, seed=2, crash=True)
        out = os.path.join(d, "out.mp4")
        try:
            recover.main([dead, "--reference", ref, "-o", out])
            raise AssertionError("recovery went ahead with a clock the reference contradicts")
        except SystemExit as e:
            assert "timing model does not fit" in str(e), e
        assert not os.path.exists(out)


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
            except (Exception, SystemExit) as e:         # noqa: BLE001 — a SystemExit is a failure too
                fails += 1
                print(f"  ERROR {name}: {type(e).__name__}: {e}")
    print("all passed" if not fails else f"{fails} failed")
    sys.exit(1 if fails else 0)
