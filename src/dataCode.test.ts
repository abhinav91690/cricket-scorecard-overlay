import { describe, it, expect } from 'vitest';
import {
    FIELDS, OUTCOME, NAME_CHARS, PAYLOAD_BITS, PAYLOAD_BYTES,
    crc16, packPayload, unpackPayload, type DataFields,
} from './dataCode';

/** The state at t=4020 of the reference recording, which the h264 bench also used. */
const SAMPLE: DataFields = {
    version: 1, frameType: 0, sequence: 21,
    innings: 0, teamRuns: 88, wickets: 3, ballsBowled: 57, target: 0, outcome: 6,
    strikerName: 'VENU S', strikerRuns: 0, strikerBalls: 0, strikerFours: 0, strikerSixes: 0,
    nonStrikerRuns: 1, nonStrikerBalls: 5,
    bowlerName: 'ANKIT K', bowlerBalls: 11, bowlerRuns: 19, bowlerWickets: 2, bowlerMaidens: 0,
    partnershipRuns: 1, partnershipBalls: 5, extras: 7,
};

describe('the wire format', () => {
    it('is exactly 42 bytes, which is what keeps the QR at version 3', () => {
        // 43 bytes would tip ECC-M to version 4: 41 modules instead of 37, 164px instead of 148.
        expect(PAYLOAD_BITS).toBe(336);
        expect(PAYLOAD_BYTES).toBe(42);
        expect(packPayload(SAMPLE)).toHaveLength(42);
    });

    it('spends no bits on padding', () => {
        expect(PAYLOAD_BITS % 8).toBe(0);
    });

    it('carries both player names at the full width the bar can display', () => {
        const names = FIELDS.filter(f => f.kind === 'name');
        expect(names).toHaveLength(2);
        for (const f of names) expect(f.bits).toBe(NAME_CHARS * 5);
    });

    it('has a code for a boundary off a no-ball', () => {
        // The bug fixed in c455921: "7nb" is a six off the bat and must survive to the reel.
        expect(OUTCOME).toContain('6nb');
        expect(OUTCOME).toContain('4nb');
        expect(OUTCOME.length).toBeLessThanOrEqual(32); // the outcome field is 5 bits
    });
});

describe('packPayload / unpackPayload', () => {
    it('round-trips every field', () => {
        const { fields, crcOk } = unpackPayload(packPayload(SAMPLE));
        expect(crcOk).toBe(true);
        for (const [k, v] of Object.entries(SAMPLE)) expect(fields[k]).toBe(v);
    });

    it('round-trips the maximum value each field can hold', () => {
        const max: DataFields = {};
        for (const f of FIELDS) {
            max[f.key] = f.kind === 'name' ? 'ABCDEFGHIJKLMNOPQR' : (1 << f.bits) - 1;
        }
        const { fields, crcOk } = unpackPayload(packPayload(max));
        expect(crcOk).toBe(true);
        for (const f of FIELDS) expect(fields[f.key]).toBe(max[f.key]);
    });

    it('round-trips zero everywhere', () => {
        const zero: DataFields = {};
        for (const f of FIELDS) zero[f.key] = f.kind === 'name' ? '' : 0;
        const { fields, crcOk } = unpackPayload(packPayload(zero));
        expect(crcOk).toBe(true);
        expect(fields.strikerName).toBe('');
        expect(fields.teamRuns).toBe(0);
    });

    it('clamps an over-range value instead of shifting the fields after it', () => {
        // A shifted bitstream corrupts everything; a clamped number only loses itself.
        const bad = { ...SAMPLE, wickets: 99, teamRuns: 99999 };
        const { fields, crcOk } = unpackPayload(packPayload(bad));
        expect(crcOk).toBe(true);
        expect(fields.wickets).toBe(15);            // 4 bits
        expect(fields.teamRuns).toBe(511);          // 9 bits
        expect(fields.bowlerName).toBe('ANKIT K');  // everything downstream survives
        expect(fields.extras).toBe(7);
    });

    it('survives a negative or non-numeric value', () => {
        const bad = { ...SAMPLE, teamRuns: -5, wickets: NaN };
        const { fields, crcOk } = unpackPayload(packPayload(bad as DataFields));
        expect(crcOk).toBe(true);
        expect(fields.teamRuns).toBe(0);
        expect(fields.wickets).toBe(0);
    });
});

describe('names', () => {
    it('uppercases and strips the pad', () => {
        const { fields } = unpackPayload(packPayload({ ...SAMPLE, strikerName: 'venu s' }));
        expect(fields.strikerName).toBe('VENU S');
    });

    it('truncates at the width the bar itself truncates at', () => {
        const long = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const { fields } = unpackPayload(packPayload({ ...SAMPLE, strikerName: long }));
        expect(fields.strikerName).toBe(long.slice(0, NAME_CHARS));
    });

    it('keeps the punctuation that appears in league names', () => {
        for (const nm of ["O'BRIEN", 'S.S. AKHILESH', 'JAY-DEV', 'A/B SHARMA']) {
            const { fields } = unpackPayload(packPayload({ ...SAMPLE, strikerName: nm }));
            expect(fields.strikerName).toBe(nm.slice(0, NAME_CHARS));
        }
    });

    it('maps an unsupported character to a space rather than corrupting the field', () => {
        const { fields, crcOk } = unpackPayload(packPayload({ ...SAMPLE, strikerName: 'A1B' }));
        expect(crcOk).toBe(true);
        expect(fields.strikerName).toBe('A B');
    });
});

describe('crc16', () => {
    it('matches CRC-16/CCITT-FALSE on the standard check vector', () => {
        const bits: number[] = [];
        for (const ch of '123456789') {
            for (let i = 7; i >= 0; i--) bits.push((ch.charCodeAt(0) >> i) & 1);
        }
        expect(crc16(bits)).toBe(0x29B1);
    });

    it('rejects a single flipped bit anywhere in the payload', () => {
        const good = packPayload(SAMPLE);
        for (let i = 0; i < PAYLOAD_BITS; i += 7) {
            const bad = good.slice();
            bad[i >> 3] ^= 0x80 >> (i & 7);
            expect(unpackPayload(bad).crcOk).toBe(false);
        }
    });

    it('accepts the untouched payload', () => {
        expect(unpackPayload(packPayload(SAMPLE)).crcOk).toBe(true);
    });
});
