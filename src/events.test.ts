import { describe, it, expect } from 'vitest';
import { detectEvents, parseDismissal } from './events';

const state = (values: Record<string, unknown>, balls: string[] = []) => ({ values, balls } as any);
const first = (over: Record<string, unknown> = {}, balls: string[] = []) =>
    state({ isSecondInningsStarted: 'false', t1Wickets: '1', t2Wickets: '0', batsman1ID: 11, batsman1Name: 'Abhinav V', batsman1Runs: '43', batsman1Balls: '30', batsman1Fours: '5', batsman1Sixers: '1',
            batsman2ID: 22, batsman2Name: 'Raja K', batsman2Runs: '7', batsman2Balls: '3',
            currentPartnershipMap: { partnershipBatsman1ID: '11', partnershipBatsman2ID: '22', partnershipBatsman1FirstName: 'Abhinav', partnershipBatsman2FirstName: 'Raja', partnershipTotalRuns: '48', partnershipTotalBalls: '33' },
            ...over }, balls);

describe('parseDismissal', () => {
    it('reduces the CricClubs markup to plain text', () => {
        expect(parseDismissal("<span>b </span><span class='outname'>Siva Krishna V</span>")).toBe('b Siva Krishna V');
        expect(parseDismissal("<span>run out </span><span class='outname'>(Aamir K)</span> ")).toBe('run out (Aamir K)');
        expect(parseDismissal("<span>c&nbsp;</span><span>Ravi T</span><span> b </span><span>Siva &amp; Co</span>")).toBe('c Ravi T b Siva & Co');
    });

    it('is empty for nothing', () => {
        expect(parseDismissal('')).toBe('');
        expect(parseDismissal(undefined)).toBe('');
    });
});

describe('detectEvents', () => {
    it('emits nothing on the first poll', () => {
        expect(detectEvents(null, first())).toEqual([]);
    });

    it('emits nothing when nothing changed', () => {
        expect(detectEvents(first({}, ['1', '4']), first({}, ['1', '4']))).toEqual([]);
    });

    it('detects a wicket from the batting side wicket count and reads the last-out fields', () => {
        const next = first({ t1Wickets: '2', lastOutName: 'Raja K', lastOutRuns: '7', lastOutBalls: '4', lastOutString: "<span>b </span><span class='outname'>Chandu B</span>" }, ['1', '4', 'W']);
        expect(detectEvents(first({ t1Total: '84' }, ['1', '4']), { ...next, values: { ...next.values, t1Total: '84' } })).toEqual([
            { type: 'wicket', name: 'Raja K', runs: '7', balls: '4', dismissal: 'b Chandu B', fow: '2nd wkt · 84/2' },
        ]);
    });

    it('uses the second-innings wicket count during a chase', () => {
        const a = first({ isSecondInningsStarted: 'true', t2Wickets: '3' });
        const b = first({ isSecondInningsStarted: 'true', t2Wickets: '4', t1Wickets: '9', lastOutName: 'X' });
        expect(detectEvents(a, b).map(e => e.type)).toEqual(['wicket']);
    });

    it('detects a fifty and a hundred for the same batter only', () => {
        expect(detectEvents(first(), first({ batsman1Runs: '50' }))).toEqual([
            { type: 'milestone', mark: 50, name: 'Abhinav V', runs: '50', balls: '30', fours: '5', sixes: '1' },
        ]);
        expect(detectEvents(first({ batsman1Runs: '98' }), first({ batsman1Runs: '102' }))[0]).toMatchObject({ type: 'milestone', mark: 100 });
        // new batter arriving on 50+ is not a milestone
        expect(detectEvents(first(), first({ batsman1ID: 99, batsman1Runs: '55' }))).toEqual([]);
    });

    it('detects a partnership milestone for the same pair', () => {
        const next = first({ currentPartnershipMap: { partnershipBatsman1ID: '11', partnershipBatsman2ID: '22', partnershipBatsman1FirstName: 'Abhinav', partnershipBatsman2FirstName: 'Raja', partnershipTotalRuns: '52', partnershipTotalBalls: '36' } });
        expect(detectEvents(first(), next)).toEqual([{ type: 'partnership', mark: 50, names: 'Abhinav & Raja', runs: '52', balls: '36' }]);
        const newPair = first({ currentPartnershipMap: { partnershipBatsman1ID: '11', partnershipBatsman2ID: '33', partnershipTotalRuns: '60' } });
        expect(detectEvents(first(), newPair)).toEqual([]);
    });

    it('flashes the newest boundary within an over and at the start of a new over', () => {
        expect(detectEvents(first({}, ['1', '.']), first({}, ['1', '.', '4']))).toEqual([{ type: 'boundary', runs: 4 }]);
        expect(detectEvents(first({}, ['1', '.', '4', '2', '1', '6']), first({}, ['6']))).toEqual([{ type: 'boundary', runs: 6 }]);
        expect(detectEvents(first({}, ['1']), first({}, ['1', '2']))).toEqual([]);
    });

    it('does not flash a boundary when a wicket fell in the same poll', () => {
        const next = first({ t1Wickets: '2', lastOutName: 'Raja K' }, ['4', 'W']);
        expect(detectEvents(first({}, ['4']), next).map(e => e.type)).toEqual(['wicket']);
    });

    it('emits nothing on the tick the innings changes, since the numbers reset', () => {
        const a = first({ t1Total: '142', t1Wickets: '8' }, ['1', '4', '6']);
        const b = first({ isSecondInningsStarted: 'true', t1Total: '142', t1Wickets: '8', t2Wickets: '0' }, ['4']);
        expect(detectEvents(a, b)).toEqual([]);
    });

    it('is silent once the match has ended', () => {
        expect(detectEvents(first(), first({ isMatchEnded: '1', t1Wickets: '5' }))).toEqual([]);
    });
});
