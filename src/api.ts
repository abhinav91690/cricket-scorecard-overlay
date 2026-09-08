import { CricketAPIData } from './types';

/**
 * Fetches the cricket score data from the given API URL.
 * @param apiUrl - The URL to fetch data from.
 * @returns A promise that resolves to the CricketAPIData object.
 * @throws Will throw if the network response is not ok.
 */
export async function fetchScoreData(apiUrl: string): Promise<CricketAPIData> {
    const response = await fetch(apiUrl);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
}

/**
 * Asks CricClubs to switch the match's overlay view. Unauthenticated and CORS-allowed, so a plain
 * GET from the browser works; the next liveScoreOverlayData poll then carries that view's extra data.
 * Fire-and-forget: a failure only means the next poll has less data.
 */
export function switchView(clubId: string, matchId: string, viewId: number): void {
    const url = `https://cricclubs.com/matchOverlayConfig.do?clubId=${encodeURIComponent(clubId)}&matchId=${encodeURIComponent(matchId)}&viewId=${viewId}`;
    fetch(url, { keepalive: true }).catch(() => { /* next poll simply has less data */ });
}
