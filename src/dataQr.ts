/**
 * Renders the `?data=1` QR code: the whole bar state, machine-readable, in the corner.
 *
 * Why this exists: `highlights/` finds events in a recording, and inferring them from the
 * picture is lossy — an event card can be dismissed inside two seconds and fall between
 * keyframes, which is how the first pass on match 2079 found 13 of the 15 wickets. A code
 * that is present in every frame turns detection from a sampling problem into a lookup.
 *
 * The geometry is not adjustable by accident. Version 3 and ECC-M are pinned, so a payload
 * that outgrows 42 bytes throws instead of silently becoming a version 4 code, which would
 * add four modules a side and invalidate the measurements this was sized against.
 *
 * Measured on a real IRL Pro recording (3840x2160, 14.96 Mb/s, the match rig): 55 of 55
 * sampled frames decoded byte-exact with the CRC passing. Read back with zxing-cpp, NOT
 * OpenCV — cv2.QRCodeDetector returns a str and mangles arbitrary bytes, recovering 0 of
 * 60 random payloads byte-exactly even from perfect uncompressed images.
 */
import { OUTCOME, packPayload, type DataFields } from './dataCode';
import { runsOffBat } from './utils';
import type { CricketAPIData } from './types';

/** Pinned. See the note above — these are load-bearing, not preferences. */
const QR_VERSION = 3;
const QR_ECC = 'M';
/**
 * CSS px per module, and the quiet zone in modules.
 *
 * Both are the smallest values measured safe, not the spec defaults. ISO/IEC 18004 asks
 * for a 4-module quiet zone; 2 decoded 6/6 through real h264 down to 1 Mb/s while 0
 * failed outright, so 2 is the floor worth trusting. 2px modules likewise decoded 6/6 at
 * 14.65, 3 and 1 Mb/s — a ~14x bitrate margin — where 1px only worked at full rate.
 *
 * Together these put the block at 66x66 CSS px, 0.21% of a 1920x1080 frame, against
 * 148x148 for the spec-default geometry.
 */
const MODULE_PX = 2;
const QUIET = 2;

const num = (s: string | number | undefined | null): number => {
    const v = parseInt(String(s ?? '0'), 10);
    return Number.isFinite(v) ? v : 0;
};

/**
 * "9.5" -> 59. The API only publishes overs, so this counts *legal* balls; a delivery that
 * was re-bowled never appears. Combined with `innings` it still identifies a ball uniquely,
 * which is all the highlights pipeline joins on.
 */
export function oversToBalls(overs: string | undefined): number {
    const [ov, ball] = String(overs ?? '0').split('.');
    return num(ov) * 6 + Math.min(5, num(ball));
}

/** Index into OUTCOME for a CricClubs ball string. */
export function outcomeCode(raw: string | undefined): number {
    const o = String(raw ?? '').toLowerCase().trim();
    if (!o) return OUTCOME.indexOf('other');
    if (o === 'w') return OUTCOME.indexOf('W');
    if (o === '.') return OUTCOME.indexOf('dot');
    if (o.endsWith('nb')) {
        // A boundary off a no-ball gets its own code, so the shot survives to the reel.
        const bat = runsOffBat(o);
        if (bat === 6) return OUTCOME.indexOf('6nb');
        if (bat === 4) return OUTCOME.indexOf('4nb');
        return OUTCOME.indexOf('nb');
    }
    if (o.endsWith('wd')) return num(o) >= 5 ? OUTCOME.indexOf('5wd') : OUTCOME.indexOf('wd');
    if (o.endsWith('lb')) return OUTCOME.indexOf('lb');
    if (o.endsWith('b')) return OUTCOME.indexOf('b');
    if (/^[1-6]$/.test(o)) return num(o);
    return OUTCOME.indexOf('other');
}

/**
 * Reads the same fields the bar reads, so the code and the picture can never disagree.
 * `batsman1` is the striker: `on-strike` is a static class on the first row, so the API's
 * ordering is what marks it.
 */
export function buildFields(data: CricketAPIData, sequence: number): DataFields {
    const v = data.values;
    const second = v.isSecondInningsStarted === 'true';
    const balls = data.balls ?? [];

    return {
        version: 1,
        frameType: 0,
        sequence: sequence & 0x7F,
        innings: second ? 1 : 0,
        teamRuns: num(second ? v.t2Total : v.t1Total),
        wickets: num(second ? v.t2Wickets : v.t1Wickets),
        ballsBowled: oversToBalls(second ? v.t2Overs : v.t1Overs),
        // What the bar itself shows as the target: the first innings total plus one.
        target: second ? num(v.t1Total) + 1 : 0,
        outcome: outcomeCode(balls[balls.length - 1]),
        strikerName: v.batsman1Name ?? '',
        strikerRuns: num(v.batsman1Runs),
        strikerBalls: num(v.batsman1Balls),
        strikerFours: num(v.batsman1Fours),
        strikerSixes: num(v.batsman1Sixers),
        nonStrikerRuns: num(v.batsman2Runs),
        nonStrikerBalls: num(v.batsman2Balls),
        bowlerName: v.bowlerName ?? '',
        bowlerBalls: oversToBalls(v.bowlerOvers),
        bowlerRuns: num(v.bowlerRuns),
        bowlerWickets: num(v.bowlerWickets),
        bowlerMaidens: num(v.bowlerMaidens),
        // The partnership lives in its own object, and CricClubs omits it between wickets.
        partnershipRuns: num(v.currentPartnershipMap?.partnershipTotalRuns),
        partnershipBalls: num(v.currentPartnershipMap?.partnershipTotalBalls),
        extras: num(second ? v.t2Extras : v.t1Extras),
    };
}

/** The last payload drawn, so a poll that changed nothing does not redraw. */
let lastBytes: string | null = null;
let sequence = 0;
/**
 * The QR encoder is loaded on demand. `?data=1` is opt-in scaffolding for highlights/, so
 * the ~30kB it costs should not land on every browser source that never asks for it — Vite
 * splits this into its own chunk.
 */
let encoder: typeof import('qrcode') | null = null;

export async function ensureDataQr(): Promise<void> {
    if (!encoder) encoder = await import('qrcode');
}

export function resetDataQrForTests(): void {
    lastBytes = null;
    sequence = 0;
    encoder = null;
}

/** Test seam: lets the suite supply the encoder without pulling in the dynamic import. */
export function setDataQrEncoderForTests(mod: typeof import('qrcode') | null): void {
    encoder = mod;
}

/**
 * Draws the code, and returns whether it actually redrew.
 *
 * Skipping an unchanged frame is not a micro-optimisation: a static graphic is nearly free
 * in h264 because it is coded as unchanged, and that discount is most of why a 4px module
 * survives 14.65 Mb/s over 4K. Redrawing every frame would forfeit it.
 */
export function renderDataCode(canvas: HTMLCanvasElement, data: CricketAPIData): boolean {
    if (!encoder) return false;   // ensureDataQr() has not resolved yet; the next poll will draw
    // Compare on the cricket data alone, with the sequence zeroed. The sequence is part of
    // the payload, so including it here would make every frame look different from the last
    // and defeat the redraw check entirely — which is what the test caught.
    const probe = buildFields(data, 0);
    const key = String.fromCharCode(...packPayload(probe));
    if (key === lastBytes) return false;

    // Advancing only on a real change makes this a count of distinct published states, so a
    // reader seeing one sequence across a long stretch knows nothing moved.
    const bytes = packPayload({ ...probe, sequence });

    const qr = encoder.create([{ data: bytes, mode: 'byte' }], {
        errorCorrectionLevel: QR_ECC,
        version: QR_VERSION,
    });
    const size = qr.modules.size;
    const side = (size + QUIET * 2) * MODULE_PX;

    if (canvas.width !== side) { canvas.width = side; canvas.height = side; }
    const ctx = canvas.getContext('2d');
    // Record the payload only once it is actually on the canvas. Marking it drawn before
    // the context is in hand would make a failed draw stick until the data changed again.
    if (!ctx) return false;
    lastBytes = key;
    sequence = (sequence + 1) & 0x7F;   // 7 bits, wraps about every 10 minutes of change

    // Pure black on pure white: 4:2:0 halves colour resolution but leaves luma untouched,
    // so luminance contrast is the only thing that reliably survives the encode.
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, side, side);
    ctx.fillStyle = '#000000';
    const bits = qr.modules.data;
    for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
            if (bits[row * size + col]) {
                ctx.fillRect((col + QUIET) * MODULE_PX, (row + QUIET) * MODULE_PX,
                             MODULE_PX, MODULE_PX);
            }
        }
    }
    return true;
}
