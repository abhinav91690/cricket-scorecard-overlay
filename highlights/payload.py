"""Decoder for the overlay's `?data=1` QR payload.

This mirrors src/dataCode.ts deliberately rather than sharing code, because the two run in
different languages on opposite sides of a recording. The field table below is written out
independently; src/dataCode.vectors.json is the contract that proves the two agree, and
test_payload.py checks this file against it. If you change one side, the test fails — which
is the point.

The payload is 42 bytes because that is exactly what a QR version 3 at ECC-M holds. 43
would tip it to version 4 and grow the block from 148px to 164px at 4px modules.
"""
from __future__ import annotations

CHARSET = " ABCDEFGHIJKLMNOPQRSTUVWXYZ.-'/"
PAD = 31
NAME_CHARS = 18

# (key, bits, kind). Order is the wire order and must not change without a version bump.
FIELDS: list[tuple[str, int, str]] = [
    ("version", 2, "uint"),
    ("frameType", 1, "uint"),
    ("sequence", 7, "uint"),
    ("innings", 1, "uint"),
    ("teamRuns", 9, "uint"),
    ("wickets", 4, "uint"),
    ("ballsBowled", 9, "uint"),          # per innings, every delivery
    ("target", 9, "uint"),
    ("outcome", 5, "uint"),
    ("strikerName", NAME_CHARS * 5, "name"),
    ("strikerRuns", 9, "uint"),
    ("strikerBalls", 9, "uint"),
    ("strikerFours", 6, "uint"),
    ("strikerSixes", 6, "uint"),
    ("nonStrikerRuns", 9, "uint"),
    ("nonStrikerBalls", 8, "uint"),
    ("bowlerName", NAME_CHARS * 5, "name"),
    ("bowlerBalls", 7, "uint"),
    ("bowlerRuns", 9, "uint"),
    ("bowlerWickets", 4, "uint"),
    ("bowlerMaidens", 3, "uint"),
    ("partnershipRuns", 9, "uint"),
    ("partnershipBalls", 8, "uint"),
    ("extras", 6, "uint"),
]

OUTCOME = ["dot", "1", "2", "3", "4", "5", "6", "W",
           "wd", "nb", "lb", "b", "4nb", "6nb", "5wd", "other"]

PAYLOAD_BITS = sum(b for _, b, _ in FIELDS) + 16      # + CRC-16
PAYLOAD_BYTES = PAYLOAD_BITS // 8


def crc16(bits) -> int:
    """CRC-16/CCITT-FALSE. Reed-Solomon in the QR corrects; this catches a mis-decode."""
    crc = 0xFFFF
    for i in range(0, len(bits), 8):
        byte = 0
        for j in range(8):
            byte = (byte << 1) | (bits[i + j] if i + j < len(bits) else 0)
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


def _push(bits: list[int], value, width: int) -> None:
    try:
        v = int(round(float(value)))
    except (TypeError, ValueError):
        v = 0
    v = max(0, min((1 << width) - 1, v))          # clamp, never shift the fields after
    for i in range(width - 1, -1, -1):
        bits.append((v >> i) & 1)


def pack(fields: dict) -> bytes:
    bits: list[int] = []
    for key, width, kind in FIELDS:
        if kind == "name":
            s = str(fields.get(key, "") or "").upper()[:NAME_CHARS]
            for i in range(NAME_CHARS):
                if i >= len(s):
                    _push(bits, PAD, 5)
                else:
                    idx = CHARSET.find(s[i])
                    _push(bits, 0 if idx < 0 else idx, 5)
        else:
            _push(bits, fields.get(key, 0), width)
    _push(bits, crc16(bits[:]), 16)
    out = bytearray(PAYLOAD_BYTES)
    for i, b in enumerate(bits):
        if b:
            out[i >> 3] |= 0x80 >> (i & 7)
    return bytes(out)


def unpack(data: bytes) -> tuple[dict, bool]:
    """Returns (fields, crc_ok). A false crc_ok means discard the frame, never trust it."""
    bits = [(data[i >> 3] >> (7 - (i & 7))) & 1 for i in range(PAYLOAD_BITS)]
    at = 0

    def take(width: int) -> int:
        nonlocal at
        v = 0
        for _ in range(width):
            v = (v << 1) | bits[at]
            at += 1
        return v

    fields: dict = {}
    for key, width, kind in FIELDS:
        if kind == "name":
            s = ""
            for _ in range(NAME_CHARS):
                c = take(5)
                if c != PAD:
                    s += CHARSET[c]
            fields[key] = s.rstrip()
        else:
            fields[key] = take(width)
    body_len = at
    got = take(16)
    return fields, got == crc16(bits[:body_len])


def describe(fields: dict) -> str:
    """One line for a log or a chapter title."""
    o = fields.get("outcome", 0)
    return (f"{fields.get('teamRuns')}/{fields.get('wickets')} "
            f"({fields.get('ballsBowled')} balls, inns {fields.get('innings', 0) + 1}) "
            f"{fields.get('strikerName')} {fields.get('strikerRuns')}"
            f"({fields.get('strikerBalls')}) vs {fields.get('bowlerName')} "
            f"{fields.get('bowlerWickets')}-{fields.get('bowlerRuns')} "
            f"· {OUTCOME[o] if o < len(OUTCOME) else '?'}")
