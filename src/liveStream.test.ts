import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { linkLiveStream } from './liveStream';

describe('linkLiveStream', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('opens the update URL as a real navigation and closes it before verifying', async () => {
        const close = vi.fn();
        const openSpy = vi.spyOn(window, 'open').mockReturnValue({ close } as any);
        (fetch as any).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ values: { liveYouTubeLink: '//www.youtube.com/embed/abc123' } }),
        });

        await linkLiveStream(
            { clubId: '1089463', matchId: '2079', liveStreamURL: 'https://www.youtube.com/watch?v=abc123' },
            { verifyAttempts: 1, verifyDelayMs: 0, popupCloseDelayMs: 0 }
        );

        expect(openSpy).toHaveBeenCalledWith(
            'https://cricclubs.com/updateLiveStreamURLFromCP.do?clubId=1089463&matchId=2079&liveStreamURL=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabc123',
            'linkLiveStreamPopup',
            'width=480,height=360'
        );
        expect(close).toHaveBeenCalled();
        expect(fetch).toHaveBeenCalledWith('https://cricclubs.com/liveScoreOverlayData.do?clubId=1089463&matchId=2079');
    });

    it('throws if the popup is blocked, without polling for confirmation', async () => {
        vi.spyOn(window, 'open').mockReturnValue(null);

        await expect(
            linkLiveStream({ clubId: '1', matchId: '2', liveStreamURL: 'https://youtu.be/abc123' })
        ).rejects.toThrow('Your browser blocked the request popup');

        expect(fetch).not.toHaveBeenCalled();
    });

    it('resolves once the read endpoint reflects the linked video id', async () => {
        vi.spyOn(window, 'open').mockReturnValue({ close: vi.fn() } as any);
        (fetch as any).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ values: { liveYouTubeLink: '//www.youtube.com/embed/abc123' } }),
        });

        await expect(
            linkLiveStream(
                { clubId: '1', matchId: '2', liveStreamURL: 'https://youtu.be/abc123' },
                { verifyAttempts: 1, verifyDelayMs: 0, popupCloseDelayMs: 0 }
            )
        ).resolves.toBeUndefined();
    });

    it('retries the read endpoint before giving up if the video id never appears', async () => {
        vi.spyOn(window, 'open').mockReturnValue({ close: vi.fn() } as any);
        (fetch as any).mockResolvedValue({ ok: true, json: () => Promise.resolve({ values: { liveYouTubeLink: '' } }) });

        await expect(
            linkLiveStream(
                { clubId: '1', matchId: '2', liveStreamURL: 'https://youtu.be/abc123' },
                { verifyAttempts: 2, verifyDelayMs: 0, popupCloseDelayMs: 0 }
            )
        ).rejects.toThrow('Could not confirm the live stream was linked.');

        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('throws immediately without opening a popup if the URL has no recognizable YouTube video id', async () => {
        const openSpy = vi.spyOn(window, 'open');

        await expect(
            linkLiveStream({ clubId: '1', matchId: '2', liveStreamURL: 'https://example.com/not-youtube' })
        ).rejects.toThrow('Could not find a YouTube video ID');

        expect(openSpy).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
    });
});
