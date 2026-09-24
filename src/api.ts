import { CONFIG } from './config';
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
 *
 * Resolves once CricClubs has answered, so the caller can read the new view straight away — the
 * switch is applied by then (measured, docs/cricclubs-api.md §2). It never rejects: a failed switch
 * only means the next read has less data. And it stops waiting after SWITCH_TIMEOUT_MS, so a hung
 * request cannot stall the poll loop behind it.
 */
export function switchView(clubId: string, matchId: string, viewId: number, base = 'https://cricclubs.com'): Promise<void> {
    const url = `${base}/matchOverlayConfig.do?clubId=${encodeURIComponent(clubId)}&matchId=${encodeURIComponent(matchId)}&viewId=${viewId}`;
    const answered = fetch(url, { keepalive: true }).then(() => undefined, () => undefined);
    const ceiling = new Promise<void>(resolve => setTimeout(resolve, CONFIG.SWITCH_TIMEOUT_MS));
    return Promise.race([answered, ceiling]);
}
