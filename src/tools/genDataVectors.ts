/**
 * Regenerates src/dataCode.vectors.json, the cross-language contract for the `?data=1`
 * payload. The Python decoder in highlights/ is tested against it, so the two
 * implementations cannot drift apart silently.
 *
 *     npx vite-node src/tools/genDataVectors.ts
 *
 * Run it only when the wire format changes on purpose, and commit the result with the
 * change that caused it. Nothing imports this file, so it is typechecked but never bundled.
 */
import { writeFileSync } from 'node:fs';
import { FIELDS, PAYLOAD_BYTES, packPayload, type DataFields } from '../dataCode';

const cases: Record<string, DataFields> = {
    /** The state at t=4020 of the reference recording, which the h264 bench also used. */
    sample: {
        version: 1, frameType: 0, sequence: 21,
        innings: 0, teamRuns: 88, wickets: 3, ballsBowled: 57, target: 0, outcome: 6,
        strikerName: 'VENU S', strikerRuns: 0, strikerBalls: 0, strikerFours: 0, strikerSixes: 0,
        nonStrikerRuns: 1, nonStrikerBalls: 5,
        bowlerName: 'ANKIT K', bowlerBalls: 11, bowlerRuns: 19, bowlerWickets: 2, bowlerMaidens: 0,
        partnershipRuns: 1, partnershipBalls: 5, extras: 7,
    },
    /** A second innings, with the punctuation that turns up in league names. */
    chase: {
        version: 1, frameType: 0, sequence: 127,
        innings: 1, teamRuns: 141, wickets: 6, ballsBowled: 108, target: 178, outcome: 13,
        strikerName: 'S.S. AKHILESH', strikerRuns: 63, strikerBalls: 41,
        strikerFours: 5, strikerSixes: 3,
        nonStrikerRuns: 12, nonStrikerBalls: 19,
        bowlerName: "O'BRIEN-RAO", bowlerBalls: 23, bowlerRuns: 44,
        bowlerWickets: 3, bowlerMaidens: 1,
        partnershipRuns: 48, partnershipBalls: 33, extras: 11,
    },
    zero: {},
    max: {},
};
for (const f of FIELDS) {
    cases.zero[f.key] = f.kind === 'name' ? '' : 0;
    cases.max[f.key] = f.kind === 'name' ? 'ABCDEFGHIJKLMNOPQR' : (1 << f.bits) - 1;
}

const out = {
    note: 'Generated from src/dataCode.ts by src/tools/genDataVectors.ts. '
        + 'highlights/test_payload.py is tested against it; do not edit by hand.',
    payloadBytes: PAYLOAD_BYTES,
    fields: FIELDS.map(f => ({ key: f.key, bits: f.bits, kind: f.kind })),
    vectors: Object.entries(cases).map(([name, fields]) => ({
        name, fields, bytes: Array.from(packPayload(fields)),
    })),
};
writeFileSync('src/dataCode.vectors.json', JSON.stringify(out, null, 1) + '\n');
console.log(`wrote src/dataCode.vectors.json — ${out.vectors.length} vectors, ${PAYLOAD_BYTES} bytes each`);
