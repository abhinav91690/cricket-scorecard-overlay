import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    oversToBalls, outcomeCode, buildFields, renderDataCode,
    resetDataQrForTests, setDataQrEncoderForTests, ensureDataQr,
} from './dataQr';
import QRCodeLib from 'qrcode';
import { OUTCOME, packPayload, unpackPayload } from './dataCode';
import type { CricketAPIData } from './types';

/** jsdom has no 2D context, so stand one up and record what gets painted. */
function stubCanvas() {
    const rects: number[][] = [];
    const canvas = document.createElement('canvas');
    canvas.getContext = vi.fn(() => ({
        set fillStyle(_v: string) { /* recorded via the rect list instead */ },
        get fillStyle() { return ''; },
        fillRect: (x: number, y: number, w: number, h: number) => { rects.push([x, y, w, h]); },
    })) as unknown as HTMLCanvasElement['getContext'];
    return { canvas, rects };
}

const frame = (over: Partial<CricketAPIData['values']> = {}, balls: string[] = ['1']) => ({
    values: {
        isSecondInningsStarted: 'false',
        t1Total: '88', t1Wickets: '3', t1Overs: '9.5', t1Extras: '7',
        t2Total: '0', t2Wickets: '0', t2Overs: '0.0', t2Extras: '0',
        batsman1Name: 'venu s', batsman1Runs: '0', batsman1Balls: '0',
        batsman1Fours: '0', batsman1Sixers: '0',
        batsman2Name: 'Rakesh G', batsman2Runs: '1', batsman2Balls: '5',
        bowlerName: 'Ankit K', bowlerOvers: '1.5', bowlerRuns: '19',
        bowlerWickets: '2', bowlerMaidens: '0',
        currentPartnershipMap: { partnershipTotalRuns: '1', partnershipTotalBalls: '5' },
        ...over,
    },
    balls,
} as unknown as CricketAPIData);

beforeEach(() => {
    resetDataQrForTests();
    // The encoder is a lazy chunk in production; hand it over directly here.
    setDataQrEncoderForTests(QRCodeLib);
});

describe('oversToBalls', () => {
    it('converts the API overs notation', () => {
        expect(oversToBalls('0.0')).toBe(0);
        expect(oversToBalls('1.5')).toBe(11);
        expect(oversToBalls('9.5')).toBe(59);
        expect(oversToBalls('20.0')).toBe(120);
    });

    it('survives a missing or malformed value', () => {
        expect(oversToBalls(undefined)).toBe(0);
        expect(oversToBalls('')).toBe(0);
        expect(oversToBalls('abc')).toBe(0);
        expect(oversToBalls('7')).toBe(42);
    });

    it('never lets a bogus ball count leak past six', () => {
        expect(oversToBalls('3.9')).toBe(23);
    });
});

describe('outcomeCode', () => {
    it('codes the ordinary outcomes', () => {
        expect(OUTCOME[outcomeCode('.')]).toBe('dot');
        expect(OUTCOME[outcomeCode('1')]).toBe('1');
        expect(OUTCOME[outcomeCode('4')]).toBe('4');
        expect(OUTCOME[outcomeCode('6')]).toBe('6');
        expect(OUTCOME[outcomeCode('W')]).toBe('W');
    });

    it('gives a boundary off a no-ball its own code', () => {
        // The bug fixed in c455921 — "7nb" is a six off the bat and must reach the reel.
        expect(OUTCOME[outcomeCode('7nb')]).toBe('6nb');
        expect(OUTCOME[outcomeCode('6nb')]).toBe('6nb');
        expect(OUTCOME[outcomeCode('5nb')]).toBe('4nb');
        expect(OUTCOME[outcomeCode('1nb')]).toBe('nb');
        expect(OUTCOME[outcomeCode('nb')]).toBe('nb');
    });

    it('separates a boundary wide from an ordinary one', () => {
        expect(OUTCOME[outcomeCode('5wd')]).toBe('5wd');
        expect(OUTCOME[outcomeCode('1wd')]).toBe('wd');
        expect(OUTCOME[outcomeCode('wd')]).toBe('wd');
    });

    it('codes byes and leg byes without confusing them for each other', () => {
        expect(OUTCOME[outcomeCode('1lb')]).toBe('lb');
        expect(OUTCOME[outcomeCode('4b')]).toBe('b');
    });

    it('falls back to other rather than guessing', () => {
        expect(OUTCOME[outcomeCode('')]).toBe('other');
        expect(OUTCOME[outcomeCode(undefined)]).toBe('other');
        expect(OUTCOME[outcomeCode('xyz')]).toBe('other');
    });

    it('fits the 5-bit field', () => {
        for (const s of ['.', '1', '6', 'W', '7nb', '5wd', '4b', 'xyz']) {
            expect(outcomeCode(s)).toBeLessThan(32);
        }
    });
});

describe('buildFields in a super over', () => {
    it('encodes the runs of the side batting in the first super-over innings', () => {
        // highlights/ reads teamRuns and innings off every frame; the wrong side's total would make
        // every super-over ball in the first innings look like nothing happened.
        const f = buildFields(frame({ isSuperOver: 'true', isSuperOverSecondInningsStarted: 'false', isSecondInningsStarted: 'true', t1Total: '8', t1Wickets: '1', t1Overs: '6', t2Total: '0', t2Wickets: '0', t2Overs: '0' } as any), 0);
        expect(f.teamRuns).toBe(8);
        expect(f.innings).toBe(0);
        expect(f.wickets).toBe(1);
    });

    it('numbers super-over balls from the ball count, not as whole overs', () => {
        // oversToBalls("3") is 18: every super-over delivery would carry the wrong ball number.
        const f = buildFields(frame({ isSuperOver: 'true', isSuperOverSecondInningsStarted: 'false', isSecondInningsStarted: 'true', t1Total: '7', t1Wickets: '0', t1Overs: '3', t2Total: '0', t2Overs: '0' } as any), 0);
        expect(f.ballsBowled).toBe(3);
    });
});

describe('buildFields', () => {
    it('reads the first-innings side, matching what the bar shows', () => {
        const f = buildFields(frame(), 0);
        expect(f.innings).toBe(0);
        expect(f.teamRuns).toBe(88);
        expect(f.wickets).toBe(3);
        expect(f.ballsBowled).toBe(59);
        expect(f.target).toBe(0);      // not chasing
        expect(f.extras).toBe(7);
    });

    it('switches to the second-innings side and derives the target the bar prints', () => {
        const f = buildFields(frame({
            isSecondInningsStarted: 'true',
            t2Total: '141', t2Wickets: '6', t2Overs: '18.0', t2Extras: '11',
        }), 0);
        expect(f.innings).toBe(1);
        expect(f.teamRuns).toBe(141);
        expect(f.ballsBowled).toBe(108);
        expect(f.target).toBe(89);     // t1Total 88 + 1, exactly as statusText computes it
        expect(f.extras).toBe(11);
    });

    it('takes batsman1 as the striker, since on-strike is static on the first row', () => {
        const f = buildFields(frame(), 0);
        expect(f.strikerName).toBe('venu s');
        expect(f.nonStrikerRuns).toBe(1);
        expect(f.nonStrikerBalls).toBe(5);
    });

    it('carries the bowler as balls rather than overs', () => {
        const f = buildFields(frame(), 0);
        expect(f.bowlerBalls).toBe(11);   // 1.5 overs
        expect(f.bowlerRuns).toBe(19);
        expect(f.bowlerWickets).toBe(2);
    });

    it('survives the partnership object CricClubs omits between wickets', () => {
        const f = buildFields(frame({ currentPartnershipMap: undefined }), 0);
        expect(f.partnershipRuns).toBe(0);
        expect(f.partnershipBalls).toBe(0);
    });

    it('takes the outcome from the most recent ball', () => {
        expect(OUTCOME[buildFields(frame({}, ['1', '.', '7nb']), 0).outcome as number]).toBe('6nb');
        expect(OUTCOME[buildFields(frame({}, []), 0).outcome as number]).toBe('other');
    });

    it('produces a payload that round-trips through the wire format', () => {
        const f = buildFields(frame(), 5);
        const { fields, crcOk } = unpackPayload(packPayload(f));
        expect(crcOk).toBe(true);
        expect(fields.strikerName).toBe('VENU S');
        expect(fields.bowlerName).toBe('ANKIT K');
        expect(fields.teamRuns).toBe(88);
        expect(fields.sequence).toBe(5);
    });
});

describe('renderDataCode', () => {
    it('draws a 66px code — 29 modules plus a 2-module quiet zone, at 2px each', () => {
        // 66px is the measured-safe geometry, not the spec default: quiet 2 and 2px modules
        // both decoded 6/6 through real h264 down to 1 Mb/s. See the note in dataQr.ts.
        const { canvas, rects } = stubCanvas();
        expect(renderDataCode(canvas, frame())).toBe(true);
        expect(canvas.width).toBe(66);
        expect(canvas.height).toBe(66);
        // one white background plus one rect per dark module
        expect(rects[0]).toEqual([0, 0, 66, 66]);
        expect(rects.length).toBeGreaterThan(100);
        for (const [x, y, w, h] of rects.slice(1)) {
            expect(w).toBe(2);
            expect(h).toBe(2);
            expect(x).toBeGreaterThanOrEqual(4);    // clear of the 2-module quiet zone
            expect(y).toBeGreaterThanOrEqual(4);
            expect(x).toBeLessThan(66 - 4);
            expect(y).toBeLessThan(66 - 4);
        }
    });

    it('does not redraw when the poll changed nothing', () => {
        // A static graphic is nearly free in h264; redrawing every frame forfeits that.
        const { canvas } = stubCanvas();
        expect(renderDataCode(canvas, frame())).toBe(true);
        expect(renderDataCode(canvas, frame())).toBe(false);
        expect(renderDataCode(canvas, frame())).toBe(false);
    });

    it('redraws when the score moves', () => {
        const { canvas } = stubCanvas();
        expect(renderDataCode(canvas, frame())).toBe(true);
        expect(renderDataCode(canvas, frame({ t1Total: '92' }))).toBe(true);
    });

    it('reports failure without remembering the frame when there is no context', () => {
        const canvas = document.createElement('canvas');
        canvas.getContext = vi.fn(() => null) as unknown as HTMLCanvasElement['getContext'];
        expect(renderDataCode(canvas, frame())).toBe(false);
        // the payload must not be marked drawn, or a recovered canvas would stay blank
        const good = stubCanvas();
        expect(renderDataCode(good.canvas, frame())).toBe(true);
    });
});

describe('the lazy encoder', () => {
    it('draws nothing until the encoder has loaded, rather than throwing', () => {
        // ?data=1 is opt-in, so qrcode is a separate chunk; the first poll can land first.
        resetDataQrForTests();
        const { canvas, rects } = stubCanvas();
        expect(renderDataCode(canvas, frame())).toBe(false);
        expect(rects).toHaveLength(0);
    });

    it('draws once the encoder is in place, without losing the pending frame', () => {
        resetDataQrForTests();
        const { canvas } = stubCanvas();
        expect(renderDataCode(canvas, frame())).toBe(false);
        setDataQrEncoderForTests(QRCodeLib);
        expect(renderDataCode(canvas, frame())).toBe(true);
    });

    it('ensureDataQr resolves and leaves the encoder usable', async () => {
        resetDataQrForTests();
        await ensureDataQr();
        const { canvas } = stubCanvas();
        expect(renderDataCode(canvas, frame())).toBe(true);
    });
});
