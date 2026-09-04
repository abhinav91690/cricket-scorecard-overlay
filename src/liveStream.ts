export interface LinkLiveStreamParams {
    clubId: string;
    matchId: string;
    liveStreamURL: string;
}

export interface LinkLiveStreamOptions {
    /** How long to leave the request popup open before closing it, in milliseconds. */
    popupCloseDelayMs?: number;
}

const DEFAULT_POPUP_CLOSE_DELAY_MS = 2000;

export type LinkLiveStreamErrorCode = 'invalid_url' | 'popup_blocked';

/** Thrown by linkLiveStream() so callers can tell the two user-facing failures apart. */
export class LinkLiveStreamError extends Error {
    constructor(public readonly code: LinkLiveStreamErrorCode, message: string) {
        super(message);
        this.name = 'LinkLiveStreamError';
    }
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function extractYouTubeVideoId(url: string): string | null {
    const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{6,})/);
    return match ? match[1] : null;
}

/**
 * Attaches a YouTube live stream URL to a CricClubs match via the control-panel endpoint.
 *
 * cricclubs.com rejects this endpoint as a cross-origin subresource — both a `fetch` (even
 * `mode: 'no-cors'`) and an `<img>`/`<iframe>` embed get blocked (Cross-Origin-Resource-Policy,
 * plus a WAF check that appears to specifically flag embedded/automated-looking requests). A
 * real top-level navigation isn't a subresource load, so it isn't subject to either check — it
 * behaves like the user pasting the URL into their address bar. We open it in a small popup
 * (must happen synchronously within a real click handler, or the browser blocks it) and close it
 * shortly after.
 *
 * There's no client-side way to confirm the update took effect: cricclubs.com's own
 * liveScoreOverlayData.do feed can take roughly a minute to reflect the new link, far longer
 * than a form submission should block on, so this only reports whether the request was sent —
 * not whether CricClubs applied it.
 */
export async function linkLiveStream(
    { clubId, matchId, liveStreamURL }: LinkLiveStreamParams,
    { popupCloseDelayMs = DEFAULT_POPUP_CLOSE_DELAY_MS }: LinkLiveStreamOptions = {}
): Promise<void> {
    const videoId = extractYouTubeVideoId(liveStreamURL);
    if (!videoId) {
        throw new LinkLiveStreamError('invalid_url', 'Could not find a YouTube video ID in that URL.');
    }

    const updateParams = new URLSearchParams({ clubId, matchId, liveStreamURL });
    const updateUrl = `https://cricclubs.com/updateLiveStreamURLFromCP.do?${updateParams.toString()}`;

    const popup = window.open(updateUrl, 'linkLiveStreamPopup', 'width=480,height=360');
    if (!popup) {
        throw new LinkLiveStreamError('popup_blocked', 'Your browser blocked the request popup. Please allow popups for this site and try again.');
    }

    await delay(popupCloseDelayMs);
    popup.close();
}
