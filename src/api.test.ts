import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchScoreData } from './api';

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
