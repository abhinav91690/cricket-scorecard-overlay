import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { linkLiveStream } from './liveStream';

describe('linkLiveStream', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('builds the correct request URL with encoded params and credentials included', async () => {
        (fetch as any).mockResolvedValue({
            ok: true,
            text: () => Promise.resolve('SUCCESS'),
        });

        await linkLiveStream({ clubId: '1089463', matchId: '2079', liveStreamURL: 'https://www.youtube.com/watch?v=abc123' });

        expect(fetch).toHaveBeenCalledWith(
            'https://cricclubs.com/updateLiveStreamURLFromCP.do?clubId=1089463&matchId=2079&liveStreamURL=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabc123',
            { credentials: 'include' }
        );
    });

    it('resolves when the response is ok and the body reports SUCCESS', async () => {
        (fetch as any).mockResolvedValue({
            ok: true,
            text: () => Promise.resolve('SUCCESS'),
        });

        await expect(
            linkLiveStream({ clubId: '1', matchId: '2', liveStreamURL: 'https://youtu.be/x' })
        ).resolves.toBeUndefined();
    });

    it('throws when the HTTP response is not ok', async () => {
        (fetch as any).mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('') });

        await expect(
            linkLiveStream({ clubId: '1', matchId: '2', liveStreamURL: 'https://youtu.be/x' })
        ).rejects.toThrow('HTTP error! status: 500');
    });

    it('throws when the response body does not indicate success', async () => {
        (fetch as any).mockResolvedValue({ ok: true, text: () => Promise.resolve('FAILURE') });

        await expect(
            linkLiveStream({ clubId: '1', matchId: '2', liveStreamURL: 'https://youtu.be/x' })
        ).rejects.toThrow('Unexpected response: FAILURE');
    });
});
