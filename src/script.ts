import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import './css/instructions.css';
import { mock_1stInnings, mock_2ndInnings, mock_matchEnded, mock_toss, mock_noTeamImage } from './mockData';
import { sampleReplayData } from './replayData';
import { CONFIG } from './config';
import { DOM } from './dom';
import { getQueryParams } from './utils';
import { applyTheme, updateLogo } from './theme';
import { fetchScoreData } from './api';
import { updateTeamLogos, updateScoreboard } from './ui';
import { CricketAPIData } from './types';
import { linkLiveStream } from './liveStream';
import { showToast } from './toast';

let replayIndex = 0;

/**
 * Wires up the "Link Live Stream" form shown on the instructions screen.
 * Prefills the club ID and submits the CricClubs control-panel call on submit.
 */
function setupLinkStreamForm() {
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
        try {
            await linkLiveStream({ clubId, matchId, liveStreamURL });
            showToast('Live stream link submitted!', 'success');
        } catch (error) {
            console.error('Error linking live stream:', error);
            const message = error instanceof Error && error.message
                ? error.message
                : 'Failed to link live stream. Please try again.';
            showToast(message, 'error');
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = originalLabel;
        }
    });
}

/**
 * Main update function that fetches data (or uses mock data) and updates the UI.
 * Handles theme application, logging, and polling logic.
 */
async function updateScore() {
    const params = getQueryParams();
    const instructionsEl = document.getElementById('instructions');
    const overlayEl = document.querySelector('.overlay') as HTMLElement;

    // Show instructions if no match context is provided
    if (!params.matchId && !params.debug && params.mode !== 'replay') {
        if (instructionsEl) instructionsEl.style.display = 'flex';
        if (overlayEl) overlayEl.style.display = 'none';
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
            const apiUrl = `https://cricclubs.com/liveScoreOverlayData.do?clubId=${params.clubId}&matchId=${params.matchId}`;
            data = await fetchScoreData(apiUrl);
        }

        await updateTeamLogos(data);
        updateScoreboard(data);

    } catch (error) {
        console.error('Error fetching score data:', error);
        DOM.teamName.textContent = 'Error';
    }
}

// Initial call
setupLinkStreamForm();
updateScore();
// Update loop
setInterval(updateScore, CONFIG.REFRESH_RATE);
