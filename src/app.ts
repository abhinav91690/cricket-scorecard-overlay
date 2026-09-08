/**
 * Application orchestration: the poll loop, the mode switch in updateScore(), and the
 * Link Live Stream form. Kept separate from script.ts (the entry point with side effects)
 * so it can be unit-tested.
 */
import { mock_1stInnings, mock_2ndInnings, mock_matchEnded, mock_toss, mock_noTeamImage, mock_view_1, mock_view_2, mock_view_3, mock_view_4, mock_view_5, mock_view_48, mock_view_49 } from './mockData';
import { sampleReplayData } from './replayData';
import { CONFIG } from './config';
import { DOM } from './dom';
import { getQueryParams } from './utils';
import { applyTheme, updateLogo } from './theme';
import { fetchScoreData, switchView } from './api';
import { updateTeamLogos, updateScoreboard } from './ui';
import { CricketAPIData } from './types';
import { linkLiveStream, LinkLiveStreamError, extractYouTubeVideoId } from './liveStream';
import { trackOnce, track, LinkOutcome } from './analytics';
import { showToast } from './toast';
import { detectEvents } from './events';
import { enqueueCards, showSampleCard, dismissAll, isIdle, PanelEvent } from './cards';
import { apiBase, refreshMs, e2eLog } from './e2e';
import { ViewCache, desiredView, isFullFrame, matchPhase, mergeCache, phasePanels, scoreChanged, stripPii, lineupPanel, inningsSummaryPanel, matchSummaryPanel } from './views';

let replayIndex = 0;
/** True once the overlay has painted at least one successful frame of live/mock data. */
let hasRenderedScore = false;
/** The previous frame, so events (wicket, fifty, boundary, target) can be derived from the diff. */
let lastData: CricketAPIData | null = null;
let sampleCardShown = false;
/** Richer data gathered from view peeks (cards, squads, fall of wickets). */
let viewCache: ViewCache = {};
/** How many times each data view has been requested; after PEEK_ATTEMPTS we stop waiting for it. */
let peekAttempts: Record<number, number> = {};
const PEEK_ATTEMPTS = 3;

/** Test hook: forget replay position, last frame and whether a frame has rendered. */
export function resetAppStateForTests() {
    replayIndex = 0;
    hasRenderedScore = false;
    lastData = null;
    sampleCardShown = false;
    viewCache = {};
    peekAttempts = {};
}

/**
 * Paint a frame and fire any cards its changes call for. Frames from a view peek (no live
 * fields) only feed the cache; they never touch the bar or count as a score change.
 */
function renderFrame(data: CricketAPIData, quiet: boolean) {
    stripPii(data);
    viewCache = mergeCache(viewCache, data);
    e2eLog('frame', { view: data.view ?? 1, full: isFullFrame(data), phase: isFullFrame(data) ? matchPhase(data) : null, score: `${data.values.t1Total ?? ''}/${data.values.t1Wickets ?? ''}|${data.values.t2Total ?? ''}/${data.values.t2Wickets ?? ''}`, balls: data.balls?.length ?? 0 });
    if (!isFullFrame(data)) return;

    updateScoreboard(data);
    if (!quiet) {
        // Golden rule: a new ball dismisses whatever is showing before this frame's own cards play.
        if (scoreChanged(lastData, data)) dismissAll();
        enqueueCards(detectEvents(lastData, data));
        const phase = matchPhase(data);
        // Panels wait until the phase's peeks have landed (or been given up on), so they never render half-empty.
        const pending = desiredView(data, phase, viewCache);
        const dataReady = pending === null || (peekAttempts[pending] ?? 0) >= PEEK_ATTEMPTS;
        if (phase !== 'play' && dataReady && isIdle('panel')) enqueueCards(phasePanels(phase, data.values, viewCache));
    }
    lastData = data;
}

/**
 * A sample panel for `?debug=…&panel=<type>`. Built entirely from one recorded match (the view
 * fixtures captured from match 2079) so teams, crests, squads and cards all agree, whatever
 * debug state the bar is showing.
 */
function samplePanel(type: string): PanelEvent | null {
    const match = mock_view_1 as unknown as CricketAPIData;
    const cache = [mock_view_2, mock_view_3, mock_view_4, mock_view_5, mock_view_48, mock_view_49]
        .reduce<ViewCache>((c, v) => mergeCache(c, stripPii(v as unknown as CricketAPIData)), {});
    switch (type) {
        case 'lineup': return lineupPanel(match.values, cache);
        case 'innings-summary': return inningsSummaryPanel(match.values, cache);
        case 'match-summary': return matchSummaryPanel(match.values, cache);
        default: return null;
    }
}

/** Ask CricClubs for the next view we want, if any (live matches only). */
function steerView(data: CricketAPIData, clubId: string, matchId: string) {
    const want = desiredView(data, isFullFrame(data) ? matchPhase(data) : (lastData ? matchPhase(lastData) : 'play'), viewCache);
    if (want !== null && want !== (data.view ?? 1)) {
        if (want !== 1) {
            peekAttempts[want] = (peekAttempts[want] ?? 0) + 1;
            if (peekAttempts[want] > PEEK_ATTEMPTS) return; // this view never yields; stop asking
        }
        e2eLog('switch', { from: data.view ?? 1, to: want });
        switchView(clubId, matchId, want, apiBase());
    }
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

    let inFlight = false;
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (inFlight) return;

        const clubId = clubIdInput.value.trim();
        const matchId = matchIdInput.value.trim();
        const liveStreamURL = streamUrlInput.value.trim();
        if (!clubId || !matchId || !liveStreamURL) return;

        // Busy state rather than `disabled`: the button stays focusable and announced.
        inFlight = true;
        const originalLabel = submitButton.textContent;
        submitButton.setAttribute('aria-busy', 'true');
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
            submitButton.removeAttribute('aria-busy');
            submitButton.textContent = originalLabel;
            inFlight = false;
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
        renderFrame(data, params.quiet);
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
            if ((params.card || params.panel) && !sampleCardShown) {
                sampleCardShown = true;
                if (params.card) showSampleCard(params.card);
                if (params.panel) {
                    const panel = samplePanel(params.panel);
                    if (panel) enqueueCards([panel], 60 * 60 * 1000);
                }
            }
        } else {
            trackOnce('overlay_start', { clubId: params.clubId, matchId: params.matchId, theme: params.theme, logo: params.logo });
            const apiUrl = `${apiBase()}/liveScoreOverlayData.do?clubId=${params.clubId}&matchId=${params.matchId}`;
            data = await fetchScoreData(apiUrl);
        }

        if (isFullFrame(data)) await updateTeamLogos(data);
        renderFrame(data, params.quiet);
        if (!params.debug) steerView(data, params.clubId, params.matchId!);
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
    setTimeout(pollLoop, refreshMs());
}
