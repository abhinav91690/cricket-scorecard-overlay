import { fetchScoreData } from './api';

export interface LinkLiveStreamParams {
    clubId: string;
    matchId: string;
    liveStreamURL: string;
}

export interface LinkLiveStreamOptions {
    /** Number of times to poll the read endpoint for confirmation before giving up. */
    verifyAttempts?: number;
    /** Delay between verification polls, in milliseconds. */
    verifyDelayMs?: number;
    /** How long to leave the request popup open before closing it, in milliseconds. */
    popupCloseDelayMs?: number;
}

const DEFAULT_VERIFY_ATTEMPTS = 3;
const DEFAULT_VERIFY_DELAY_MS = 1500;
const DEFAULT_POPUP_CLOSE_DELAY_MS = 2000;

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function extractYouTubeVideoId(url: string): string | null {
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
 * shortly after. Success is then confirmed by re-polling the public liveScoreOverlayData.do feed
 * (already CORS-open, already used for score polling) until it reports the video we set.
 */
export async function linkLiveStream(
    { clubId, matchId, liveStreamURL }: LinkLiveStreamParams,
    {
        verifyAttempts = DEFAULT_VERIFY_ATTEMPTS,
        verifyDelayMs = DEFAULT_VERIFY_DELAY_MS,
        popupCloseDelayMs = DEFAULT_POPUP_CLOSE_DELAY_MS,
    }: LinkLiveStreamOptions = {}
): Promise<void> {
    const videoId = extractYouTubeVideoId(liveStreamURL);
    if (!videoId) {
        throw new Error('Could not find a YouTube video ID in that URL.');
    }

    const updateParams = new URLSearchParams({ clubId, matchId, liveStreamURL });
    const updateUrl = `https://cricclubs.com/updateLiveStreamURLFromCP.do?${updateParams.toString()}`;

    const popup = window.open(updateUrl, 'linkLiveStreamPopup', 'width=480,height=360');
    if (!popup) {
        throw new Error('Your browser blocked the request popup. Please allow popups for this site and try again.');
    }

    await delay(popupCloseDelayMs);
    popup.close();

    const readUrl = `https://cricclubs.com/liveScoreOverlayData.do?clubId=${clubId}&matchId=${matchId}`;

    for (let attempt = 1; attempt <= verifyAttempts; attempt++) {
        await delay(verifyDelayMs);
        const data = await fetchScoreData(readUrl);
        if (data.values.liveYouTubeLink?.includes(videoId)) {
            return;
        }
    }

    throw new Error('Could not confirm the live stream was linked. Double check the match ID.');
}
