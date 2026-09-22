---
type: Wire Format Specification
title: The ?data=1 machine-readable code
description: "The 42-byte payload the overlay draws as a QR code so a recording can be read back: the field table, the pinned geometry and why each number is what it is, the cross-language contract, and the decoder that must be used."
tags: [data-code, qr, wire-format, highlights, geometry]
status: stable
generated: { by: claude/opus-5, at: 2026-09-21T22:32:46Z }
---

# data-code.md — the `?data=1` wire format

**Load before touching `src/dataCode.ts`, `src/dataQr.ts` or `highlights/payload.py`.**

`?data=1` draws a QR code flush into the frame's top-left corner carrying the whole bar state,
so [highlights.md](./highlights.md) can read events out of a recording instead of inferring
them from the picture. **Off by default**; nothing changes for a normal browser source.

🛑 **This is a wire format.** It is written in TypeScript on one side of a recording and read
in Python on the other, so the field order and every width are load-bearing. A recording made
today must still decode in a year.

---

## 1. Geometry, and why every number is what it is

| | |
|---|---|
| Version / ECC | **3 / M**, both pinned in `src/dataQr.ts` |
| Payload | **42 bytes** |
| Module | **2 CSS px** |
| Quiet zone | **2 modules** |
| Block | **66 × 66 CSS px** — 0.21% of a 1920×1080 frame |
| Position | flush top-left, inset 0 |
| Redraw | on the 5 s poll, never per frame |

**42 bytes** because that is exactly what a QR v3 at ECC-M holds. 43 tips it to v4, which adds
four modules a side; v2 holds only 26, unreachable without dropping a player name. So 42 is the
one size worth hitting, and getting there cost eight bits — taken from fields wider than
cricket needs rather than from the CRC. See §2.

🛑 **Version and ECC are pinned, not chosen per frame.** A payload that outgrows 42 bytes
*throws* instead of silently becoming a v4 code, which would change the geometry and invalidate
every measurement here.

**2 px modules and a 2-module quiet zone are measured floors, not spec defaults.** ISO/IEC
18004 asks for a 4-module quiet zone; 2 decoded 6/6 through real h264 down to 1 Mb/s while 0
failed outright. Every combination of quiet {4, 2, 1} × module {4, 3, 2} decoded 6/6 at 14.65,
3 and 1 Mb/s.

🛑 **1 px modules cannot work, and it is not a threshold you can tune past.** IRL Pro renders
the browser source at 1920 and upscales smoothly to 4K. Reading across a finder pattern in a
real recording, each dark module returns `63 0 0 63` — **only the middle 2 of its 4 file pixels
reach full black**, so the transition is a full module wide:

```
2 CSS px module = 4 file px  ->  2 px of clean centre  ->  luma separation 251/255
1 CSS px module = 2 file px  ->  no clean centre       ->  1 good frame in 12
```

Measured at 1/6 at full bitrate and 0/6 below it, and neither a larger quiet zone nor more ECC
helps. The limit is the compositing resolution, which is IRL Pro's to give and not ours.

**Redraw only when the data changes.** The overlay survives 0.03 bits/pixel because it is
static — h264 codes it as unchanged and spends the bitrate on the grass — and that discount is
most of why a 2 px module survives at all.

⚠ **The `sequence` field is part of the payload**, so comparing whole payloads made every frame
look new and defeated the redraw check entirely. `renderDataCode()` compares the cricket data
with the sequence zeroed. A useful side effect: `sequence` counts *distinct published states*
rather than polls, so a reader seeing one value across a long stretch knows nothing moved.

## 2. The field table — 336 bits, 42 bytes

| Group | Field | Bits | Note |
|---|---|---|---|
| header | version | 2 | format revision |
| header | frameType | 1 | 0 = full frame; one spare value for a future variant |
| header | sequence | 7 | wraps every ~10 min of change |
| match | innings | 1 | |
| match | teamRuns | 9 | 511; highest T20 total ever ≈ 340 |
| match | wickets | 4 | 4 bits is the minimum for 10 |
| match | ballsBowled | 9 | **per innings, LEGAL balls** — see §3 |
| match | target | 9 | 0 when not chasing |
| match | outcome | 5 | see §4 |
| striker | name | 90 | 18 chars × 5 bits |
| striker | runs | 9 | |
| striker | balls | 9 | |
| striker | fours | 6 | 63 |
| striker | sixes | 6 | 63 |
| non-striker | runs | 9 | |
| non-striker | balls | 8 | 255, against the 120 a 20-over innings offers |
| bowler | name | 90 | |
| bowler | balls | 7 | 127, against ~30 for a four-over spell |
| bowler | runs | 9 | |
| bowler | wickets | 4 | |
| bowler | maidens | 3 | |
| context | partnershipRuns | 9 | |
| context | partnershipBalls | 8 | 255 |
| context | extras | 6 | 63 |
| — | CRC-16 | 16 | CCITT-FALSE |

The eight bits trimmed to reach 42 bytes: `frameType` 3→1 (the rotating-frame variant was
rejected), `extras` 8→6, `teamRuns` and `target` 10→9, `nonStrikerBalls` and
`partnershipBalls` 9→8. Every remaining width still clears any real cricket value by 2× or more.

🛑 **Values are clamped, not wrapped.** A nonsense number from the API loses only itself;
letting it overflow would shift every field after it, and a shifted bitstream is unrecoverable
where a wrong score is obvious.

**Names**: 18 characters at 5 bits, charset `" ABCDEFGHIJKLMNOPQRSTUVWXYZ.-'/"` with index 31 as
pad and unknown characters mapped to a space. 18 is what the bar itself displays before it
truncates, so the code can never carry less than the graphic shows.

Names are 180 of the 336 bits — 54%. Converting both to CricClubs player IDs (24 bits each,
IDs run to ~5.1 M) would reach 26 bytes and drop the code to v2, 58 px. **Rejected**: it buys
8 px and costs the payload's self-containment, since an ID needs a squad list to resolve.
⚠ Converting only *one* name buys nothing — ~34 bytes is still above v2's 26-byte ceiling, so
it stays v3 at the same module count.

## 3. ⚠ `ballsBowled` counts legal balls, per innings

The API publishes overs, so `oversToBalls("9.5") = 59` counts *legal* deliveries — a re-bowled
ball never appears. With `innings` alongside it that still identifies a ball uniquely, which is
all the highlights join needs, **but it is not a delivery count**, and a no-ball leaves it
unchanged. That single fact shapes the event rules in [highlights.md](./highlights.md) §4.

## 4. Ball outcomes

```
0 dot   1..6 runs   7 W   8 wd   9 nb   10 lb   11 b   12 4nb   13 6nb   14 5wd   15 other
```

`4nb` and `6nb` are distinct codes so a boundary off a no-ball survives — the case fixed in
`c455921` and described in [overlay.md](./overlay.md) §6b.

## 5. 🛑 The cross-language contract

The format is implemented **twice**:

| | |
|---|---|
| `src/dataCode.ts` | packs (TypeScript, the overlay) |
| `highlights/payload.py` | unpacks (Python, the reader) |
| `src/dataCode.vectors.json` | the contract between them |
| `src/tools/genDataVectors.ts` | regenerates the vectors from the TypeScript |
| `highlights/test_payload.py` | checks the Python against the vectors |

Regenerate with `npx vite-node src/tools/genDataVectors.ts`, **only when the format changes on
purpose**, and commit the result with the change that caused it. Nothing imports that script,
so it is typechecked but never bundled.

A one-bit width change on either side breaks **five of the seven** contract tests. That is the
point — verified by widening `extras` in Python alone and watching it fail.

⚠ **Clear `highlights/__pycache__` around any format change.** A stale bytecode cache made a
restored file still report the old bit width, which looked for several minutes like the restore
had failed.

## 6. 🛑 Decode with zxing-cpp, never OpenCV

`cv2.QRCodeDetector` returns a **str**, so it mangles arbitrary bytes. It recovered **0 of 60**
random 42-byte payloads byte-exactly *from perfect, uncompressed images* — while reporting a
successful detection every single time. zxing-cpp returns raw bytes and recovered 60 of 60.

This matters more than it sounds. OpenCV is the obvious choice — the rest of `highlights/` is
numpy and ffmpeg — and it fails by returning **confident-looking garbage rather than an error**.
Every QR figure quoted before this was found had been measuring whether a code was *found*, not
whether the payload came *back*. It is pinned in `highlights/requirements.txt` with that
reasoning in a comment, because the next person will reach for cv2.

⚠ **Never generate a test QR with the Python `qrcode` library.** It inflates binary payloads: 42
random bytes became a **v14** code, 73 modules instead of 29, even in explicit byte mode. Any
bench must generate matrices with the **same npm encoder the overlay ships**, or it measures a
code two and a half times bigger than the one that gets drawn.

## 7. Verified against

Two real IRL Pro captures from the match rig, 3840×2160:

| Capture | Bitrate | Geometry | Result |
|---|---|---|---|
| `20260921_142013_37.mp4` | 14.96 Mb/s | 148 px (4 px modules) | **55 / 55** frames byte-exact, CRC passing |
| `20260921_170030_01.mp4` | 13.89 Mb/s | 66 px (2 px modules) | **55 / 55** frames byte-exact, CRC passing |

On the second, the symbol measured **116 × 116 file px = 4.00 px per module** against the
predicted 4.02 (2 CSS px × 2.01 upscale), and `sequence` started at 1 on a freshly loaded page
where the earlier capture started at 6 — the staleness counter behaving exactly as designed.

⚠ **Untested**: reading back from YouTube, which would be a second generation of compression;
and any recording profile where the browser source is *downscaled* rather than upscaled. A
720p recording would put a 2 px module below 2 file px. Both captures above had the source
rendered full-frame at 1920 and upscaled ~2×.
