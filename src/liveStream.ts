export interface LinkLiveStreamParams {
    clubId: string;
    matchId: string;
    liveStreamURL: string;
}

/**
 * Calls the CricClubs control-panel endpoint to attach a YouTube live stream URL to a match.
 * This endpoint is normally called same-origin from cricclubs.com using the caller's session
 * cookies for auth, so it only succeeds here if the browser is already logged into CricClubs
 * and cricclubs.com's CORS policy allows this origin.
 */
export async function linkLiveStream({ clubId, matchId, liveStreamURL }: LinkLiveStreamParams): Promise<void> {
    const params = new URLSearchParams({ clubId, matchId, liveStreamURL });
    const apiUrl = `https://cricclubs.com/updateLiveStreamURLFromCP.do?${params.toString()}`;

    const response = await fetch(apiUrl, { credentials: 'include' });
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    const text = (await response.text()).trim();
    if (!text.toUpperCase().includes('SUCCESS')) {
        throw new Error(`Unexpected response: ${text}`);
    }
}
