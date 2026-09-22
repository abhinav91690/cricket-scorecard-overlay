/**
 * The `?data=1` payload: everything the bar shows, packed into 42 bytes.
 *
 * Why 42 and not 43: a QR code at version 3 with ECC-M holds exactly 42 bytes, and 43
 * tips it to version 4 — 37 modules square becomes 41, which is 148px against 164px at
 * 4px modules. The next step down (version 2) holds only 26 bytes and is unreachable
 * without dropping a player name, so 42 is the one size worth hitting.
 *
 * Field widths are therefore deliberately snug, but every one still has at least 2x
 * headroom over anything cricket produces (see FIELDS). Values are clamped rather than
 * allowed to overflow, because a nonsense reading from the API must not corrupt the
 * neighbouring fields — a wrong score is recoverable, a shifted bitstream is not.
 *
 * `highlights/` decodes this from the recording, so THIS FILE IS A WIRE FORMAT. Changing
 * a width or the field order breaks every reader. Bump `version` and keep the old path if
 * you have to. `dataCode.vectors.json` is the cross-language contract: the Python decoder
 * is tested against it, so regenerate it deliberately, never incidentally.
 */

/** 32 symbols in 5 bits. Index 31 pads a short name; unknown characters become a space. */
const CHARSET = " ABCDEFGHIJKLMNOPQRSTUVWXYZ.-'/";
const PAD = 31;
/** What the bar itself can display before it truncates, so the code never carries less. */
export const NAME_CHARS = 18;

type FieldKind = 'uint' | 'name';
interface Field { key: string; bits: number; kind: FieldKind; }

const u = (key: string, bits: number): Field => ({ key, bits, kind: 'uint' });
const n = (key: string): Field => ({ key, bits: NAME_CHARS * 5, kind: 'name' });

/**
 * The wire order. Comments give the real-world ceiling each width has to clear, which is
 * what justifies the narrow ones: a 20-over innings is 120 legal balls, no individual
 * innings approaches 255, and the highest T20 total ever recorded is around 340.
 */
export const FIELDS: readonly Field[] = [
    u('version', 2),          // format revision
    u('frameType', 1),        // 0 = the full frame; one spare value for a future variant
    u('sequence', 7),         // increments per poll; wraps every ~10 min, so a stale frame shows
    u('innings', 1),          // 0 = first, 1 = second
    u('teamRuns', 9),         // 511
    u('wickets', 4),          // 15; 10 is the real ceiling and 4 bits is the minimum for it
    u('ballsBowled', 9),      // 511, per innings, counting every delivery
    u('target', 9),           // 511; 0 when not chasing
    u('outcome', 5),          // see OUTCOME
    n('strikerName'),
    u('strikerRuns', 9),      // 511
    u('strikerBalls', 9),     // 511
    u('strikerFours', 6),     // 63
    u('strikerSixes', 6),     // 63
    u('nonStrikerRuns', 9),   // 511
    u('nonStrikerBalls', 8),  // 255, against the 120 a 20-over innings makes available
    n('bowlerName'),
    u('bowlerBalls', 7),      // 127, against ~30 for a four-over spell
    u('bowlerRuns', 9),       // 511
    u('bowlerWickets', 4),    // 15
    u('bowlerMaidens', 3),    // 7
    u('partnershipRuns', 9),  // 511
    u('partnershipBalls', 8), // 255
    u('extras', 6),           // 63
];

/** Ball outcomes. The two no-ball boundaries are distinct so a six off a no-ball survives. */
export const OUTCOME = [
    'dot', '1', '2', '3', '4', '5', '6', 'W',
    'wd', 'nb', 'lb', 'b', '4nb', '6nb', '5wd', 'other',
] as const;

export const PAYLOAD_BITS = FIELDS.reduce((t, f) => t + f.bits, 0) + 16; // + CRC-16
export const PAYLOAD_BYTES = PAYLOAD_BITS / 8;

export type DataFields = Record<string, number | string>;

/** CRC-16/CCITT-FALSE. Reed-Solomon inside the QR corrects; this catches a mis-decode. */
export function crc16(bits: readonly number[]): number {
    let crc = 0xFFFF;
    for (let i = 0; i < bits.length; i += 8) {
        let byte = 0;
        for (let j = 0; j < 8; j++) byte = (byte << 1) | (bits[i + j] ?? 0);
        crc ^= byte << 8;
        for (let j = 0; j < 8; j++) {
            crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
        }
    }
    return crc;
}

function pushUint(bits: number[], value: number, width: number): void {
    // Clamp, so a bad API value cannot shift every field after it.
    const max = (1 << width) - 1;
    const v = !Number.isFinite(value) ? 0 : Math.min(max, Math.max(0, Math.round(value)));
    for (let i = width - 1; i >= 0; i--) bits.push((v >> i) & 1);
}

function pushName(bits: number[], raw: string): void {
    const s = (raw || '').toUpperCase().slice(0, NAME_CHARS);
    for (let i = 0; i < NAME_CHARS; i++) {
        if (i >= s.length) { pushUint(bits, PAD, 5); continue; }
        const idx = CHARSET.indexOf(s.charAt(i));
        pushUint(bits, idx < 0 ? 0 : idx, 5);
    }
}

/** Pack the fields into exactly PAYLOAD_BYTES bytes, CRC last. */
export function packPayload(fields: DataFields): Uint8Array {
    const bits: number[] = [];
    for (const f of FIELDS) {
        if (f.kind === 'name') pushName(bits, String(fields[f.key] ?? ''));
        else pushUint(bits, Number(fields[f.key] ?? 0), f.bits);
    }
    const body = bits.slice();
    pushUint(bits, crc16(body), 16);

    const out = new Uint8Array(PAYLOAD_BYTES);
    for (let i = 0; i < bits.length; i++) {
        if (bits[i]) out[i >> 3] |= 0x80 >> (i & 7);
    }
    return out;
}

export interface Unpacked { fields: DataFields; crcOk: boolean; }

/** The mirror of packPayload. Exists so the format is testable and self-documenting. */
export function unpackPayload(bytes: Uint8Array): Unpacked {
    const bits: number[] = [];
    for (let i = 0; i < PAYLOAD_BITS; i++) {
        bits.push((bytes[i >> 3] >> (7 - (i & 7))) & 1);
    }
    let at = 0;
    const take = (width: number): number => {
        let v = 0;
        for (let i = 0; i < width; i++) v = (v << 1) | (bits[at++] ?? 0);
        return v;
    };

    const fields: DataFields = {};
    for (const f of FIELDS) {
        if (f.kind === 'name') {
            let s = '';
            for (let i = 0; i < NAME_CHARS; i++) {
                const c = take(5);
                if (c !== PAD) s += CHARSET.charAt(c);
            }
            fields[f.key] = s.replace(/\s+$/, '');
        } else {
            fields[f.key] = take(f.bits);
        }
    }
    const bodyLen = at;
    const got = take(16);
    return { fields, crcOk: got === crc16(bits.slice(0, bodyLen)) };
}
