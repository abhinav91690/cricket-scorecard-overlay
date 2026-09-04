/**
 * Application orchestration: the poll loop, the mode switch in updateScore(), and the
 * Link Live Stream form. Kept separate from script.ts (the entry point with side effects)
 * so it can be unit-tested.
 */
import { mock_1stInnings, mock_2ndInnings, mock_matchEnded, mock_toss, mock_noTeamImage } from './mockData';
import { sampleReplayData } from './replayData';
import { CONFIG } from './config';
import { DOM } from './dom';
import { getQueryParams } from './utils';
import { applyTheme, updateLogo } from './theme';
import { fetchScoreData } from './api';
import { updateTeamLogos, updateScoreboard } from './ui';
import { CricketAPIData } from './types';
import { linkLiveStream, LinkLiveStreamError, extractYouTubeVideoId } from './liveStream';
import { trackOnce, track, LinkOutcome } from './analytics';
import { showToast } from './toast';

let replayIndex = 0;
/** True once the overlay has painted at least one successful frame of live/mock data. */
let hasRenderedScore = false;

/** Test hook: forget replay position and whether a frame has rendered. */
export function resetAppStateForTests() {
    replayIndex = 0;
    hasRenderedScore = false;
}

/**
 * Wires up the "Link Live Stream" form shown on the instructions screen.
 * Prefills the club ID and submits the CricClubs control-panel call on submit.
 */
export function setupLinkStreamForm() {
    const form = document.getElementById('link-stream-form') as HTMLFormElement | null;
    const clubIdInput = document.getElementById('link-club-id') as HTMLInputElement | null;
    const matchIdInput = document.getElementById('link-match-id') as HTMLInputElement | null;
    const streamUrlInput = document.getElementById('link-stream-url') as HTMLInputElement | null;
    const submitButton = document.getElementById('link-stream-submit') as HTMLButtonElement | null;

    if (!form || !clubIdInput || !matchIdInput || !streamUrlInput || !submitButton) return;

    clubIdInput.value = CONFIG.DEFAULT_CLUB_ID;

    form.addEventListener('submit', async (event) => {
        event.preventDefault();

        const clubId = clubIdInput.value.trim();
        const matchId = matchIdInput.value.trim();
        const liveStreamURL = streamUrlInput.value.trim();
        if (!clubId || !matchId || !liveStreamURL) return;

        const originalLabel = submitButton.textContent;
        submitButton.disabled = true;
        submitButton.textContent = 'Linking...';
        const videoId = extractYouTubeVideoId(liveStreamURL);
        let outcome: LinkOutcome = 'submitted';
        try {
            await linkLiveStream({ clubId, matchId, liveStreamURL });
            showToast('Live stream link submitted!', 'success');
        } catch (error) {
            console.error('Error linking live stream:', error);
            outcome = error instanceof LinkLiveStreamError ? error.code : 'error';
            const message = error instanceof Error && error.message
                ? error.message
                : 'Failed to link live stream. Please try again.';
            showToast(message, 'error');
        } finally {
            track('link_stream_submit', { clubId, matchId, videoId, outcome });
            submitButton.disabled = false;
            submitButton.textContent = originalLabel;
        }
    });
}

/**
 * Main update function that fetches data (or uses mock data) and updates the UI.
 * Handles theme application, logging, and polling logic.
 */
export async function updateScore() {
    const params = getQueryParams();
    const instructionsEl = document.getElementById('instructions');
    const overlayEl = document.querySelector('.overlay') as HTMLElement;

    // Show instructions if no match context is provided
    if (!params.matchId && !params.debug && params.mode !== 'replay') {
        if (instructionsEl) instructionsEl.style.display = 'flex';
        if (overlayEl) overlayEl.style.display = 'none';
        trackOnce('home_view');
        return;
    }

    if (instructionsEl) instructionsEl.style.display = 'none';
    if (overlayEl) overlayEl.style.display = '';

    applyTheme(params.theme);
    updateLogo(params.logo);

    if (params.mode === 'replay') {
        const data = sampleReplayData[replayIndex] as unknown as CricketAPIData;
        updateScoreboard(data);
        replayIndex = (replayIndex + 1) % sampleReplayData.length;
        return;
    }

    if (!params.matchId && !params.debug) {
        return;
    }

    try {
        let data: CricketAPIData;
        if (params.debug) {
            // Mock Data Logic
            switch (params.debug) {
                case '2':
                    data = mock_2ndInnings as unknown as CricketAPIData;
                    break;
                case '3':
                    data = mock_matchEnded as unknown as CricketAPIData;
                    break;
                case '4':
                    data = mock_toss as unknown as CricketAPIData;
                    break;
                case '5':
                    data = mock_noTeamImage as unknown as CricketAPIData;
                    break;
                case '1':
                case 'true':
                default:
                    data = mock_1stInnings as unknown as CricketAPIData;
                    break;
            }
            console.log(`Using mock data: ${params.debug}`);
        } else {
            trackOnce('overlay_start', { clubId: params.clubId, matchId: params.matchId, theme: params.theme, logo: params.logo });
            const apiUrl = `https://cricclubs.com/liveScoreOverlayData.do?clubId=${params.clubId}&matchId=${params.matchId}`;
            data = await fetchScoreData(apiUrl);
        }

        await updateTeamLogos(data);
        updateScoreboard(data);
        hasRenderedScore = true;

    } catch (error) {
        console.error('Error fetching score data:', error);
        // Once we've shown real data, keep the last good frame on screen: a single
        // dropped poll mid-broadcast should not flash "Error" at viewers. Before the
        // first successful render there's nothing to keep, so surface the problem
        // (most likely a wrong matchId/clubId) to whoever is setting up the source.
        if (!hasRenderedScore) {
            DOM.teamName.textContent = 'Error';
        }
    }
}

/**
 * Polls with a fixed gap *after* each update finishes, so a slow response can't
 * overlap with the next poll and paint stale data over fresher data.
 */
export async function pollLoop() {
    try {
        await updateScore();
    } catch (error) {
        console.error('Unexpected error in update loop:', error);
    }
    setTimeout(pollLoop, CONFIG.REFRESH_RATE);
}
