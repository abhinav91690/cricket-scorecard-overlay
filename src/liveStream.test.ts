import { describe, it, expect, vi, afterEach } from 'vitest';
import { linkLiveStream } from './liveStream';

describe('linkLiveStream', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('opens the update URL as a real navigation and closes it', async () => {
        const close = vi.fn();
        const openSpy = vi.spyOn(window, 'open').mockReturnValue({ close } as any);

        await linkLiveStream(
            { clubId: '1089463', matchId: '2079', liveStreamURL: 'https://www.youtube.com/watch?v=abc123' },
            { popupCloseDelayMs: 0 }
        );

        expect(openSpy).toHaveBeenCalledWith(
            'https://cricclubs.com/updateLiveStreamURLFromCP.do?clubId=1089463&matchId=2079&liveStreamURL=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabc123',
            'linkLiveStreamPopup',
            'width=480,height=360'
        );
        expect(close).toHaveBeenCalled();
    });

    it('throws if the popup is blocked', async () => {
        vi.spyOn(window, 'open').mockReturnValue(null);

        await expect(
            linkLiveStream({ clubId: '1', matchId: '2', liveStreamURL: 'https://youtu.be/abc123' })
        ).rejects.toThrow('Your browser blocked the request popup');
    });

    it('throws immediately without opening a popup if the URL has no recognizable YouTube video id', async () => {
        const openSpy = vi.spyOn(window, 'open');

        await expect(
            linkLiveStream({ clubId: '1', matchId: '2', liveStreamURL: 'https://example.com/not-youtube' })
        ).rejects.toThrow('Could not find a YouTube video ID');

        expect(openSpy).not.toHaveBeenCalled();
    });
});
