import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchScoreData, switchView } from './api';

describe('fetchScoreData', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('returns the parsed JSON for a 200 response', async () => {
        const payload = { values: { t1Name: 'India' }, balls: ['1'] };
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })));

        await expect(fetchScoreData('https://cricclubs.com/liveScoreOverlayData.do?clubId=1&matchId=2')).resolves.toEqual(payload);
        expect(fetch).toHaveBeenCalledWith('https://cricclubs.com/liveScoreOverlayData.do?clubId=1&matchId=2');
    });

    it('throws with the status for a non-2xx response', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })));
        await expect(fetchScoreData('https://cricclubs.com/x')).rejects.toThrow('HTTP error! status: 503');
    });

    it('propagates network failures', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
        await expect(fetchScoreData('https://cricclubs.com/x')).rejects.toThrow('Failed to fetch');
    });
});

describe('switchView', () => {
    afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
    const URL = 'https://cricclubs.com/matchOverlayConfig.do?clubId=1089463&matchId=4631&viewId=48';

    it('resolves once CricClubs has answered, so the caller can read the view straight after', async () => {
        let answer!: () => void;
        vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(r => { answer = () => r(new Response('success')); })));
        let done = false;
        const p = switchView('1089463', '4631', 48).then(() => { done = true; });
        await Promise.resolve();
        expect(done).toBe(false);                    // still waiting on the answer
        answer(); await p;
        expect(done).toBe(true);
        expect(fetch).toHaveBeenCalledWith(URL, expect.objectContaining({ keepalive: true }));
    });

    it('never rejects: a failed switch only means the next read has less data', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down'); }));
        await expect(switchView('1089463', '4631', 48)).resolves.toBeUndefined();
    });

    it('gives up waiting after a ceiling, so a hung request cannot stall the poll loop', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => { /* never answers */ })));
        let done = false;
        switchView('1089463', '4631', 48).then(() => { done = true; });
        await vi.advanceTimersByTimeAsync(3000);
        expect(done).toBe(true);
    });
});
