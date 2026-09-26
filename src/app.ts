/**
 * Application orchestration: the poll loop, the mode switch in updateScore(), and the
 * Link Live Stream form. Kept separate from script.ts (the entry point with side effects)
 * so it can be unit-tested.
 */
import { mock_1stInnings, mock_2ndInnings, mock_matchEnded, mock_toss, mock_noTeamImage, mock_view_1, mock_view_2, mock_view_3, mock_view_4, mock_view_5, mock_view_48, mock_view_49 } from './mockData';
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
import { ensureDataQr, renderDataCode, resetDataQrForTests } from './dataQr';
import { dismissPanel, enqueueCards, showSampleCard, dismissAll, isIdle, PanelEvent } from './cards';
import { apiBase, refreshMs, e2eLog } from './e2e';
import { MatchPhase, ViewCache, desiredView, isFullFrame, matchPhase, mergeCache, phasePanels, scoreChanged, stripPii, lineupPanel, inningsSummaryPanel, matchSummaryPanel } from './views';

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
/** Views that have used all their tries. Skipped rather than retried, so they cannot block the views after them. */
/**
 * Where frames come from, and where view switches go. Live, that is CricClubs. In replay it is a
 * whole simulated match played inside the page (sim/match.ts), so ?mode=replay runs the very same
 * render, peek and panel code a live match does — the only difference is the feed.
 */
interface Feed { read(): Promise<CricketAPIData>; switchTo(view: number): Promise<void>; }

function liveFeed(clubId: string, matchId: string): Feed {
    return {
        read: () => fetchScoreData(`${apiBase()}/liveScoreOverlayData.do?clubId=${clubId}&matchId=${matchId}`),
        switchTo: view => switchView(clubId, matchId, view, apiBase()),
    };
}

/** The replay feed, built once on the first replay poll and kept for the page's life. */
let replay: Promise<Feed> | null = null;

/**
 * A simulated CricClubs for ?mode=replay: toss to result, at ?speed= (default CONFIG.REPLAY_SPEED),
 * optionally from ?start=<phase> and as a tie decided by a super over with ?superover=1.
 * Loaded on demand, so a live overlay never downloads the simulator.
 */
async function replayFeed(p: ReturnType<typeof getQueryParams>): Promise<Feed> {
    const sim = await import('../sim/match.ts');
    const cfg = { ...sim.DEFAULT_CONFIG, superOver: p.superOver, ...(Number.isFinite(p.seed) ? { seed: p.seed as number } : {}) };
    const timeline = sim.buildTimeline(cfg);
    const speed = Math.min(CONFIG.REPLAY_MAX_SPEED, Math.max(1, Number.isFinite(p.speed) && p.speed! > 0 ? p.speed! : CONFIG.REPLAY_SPEED));
    const from = (p.start && timeline.find(x => x.phase === p.start)?.t) || 0;
    const began = Date.now();
    let view = 1;
    const now = () => from + ((Date.now() - began) / 1000) * speed;
    return {
        read: async () => sim.render(sim.snapshotAt(timeline, now()), view, cfg),
        switchTo: async next => { view = next; },
    };
}

/** Set when a poll asked CricClubs to switch view, so the next read comes almost at once. */
let peekFollowUp = false;
/** Fast reads in a row; capped so a feed stuck on a data view cannot fast-poll forever. */
let fastPolls = 0;
/** Phases whose panel has gone on air this load. Each goes on once, never on a loop. */
let panelsShown = new Set<MatchPhase>();
/** The batter names when the break began: the break's openers are "in" once these change. */
let breakBatters: string | null = null;
const gaveUp = () => new Set(Object.entries(peekAttempts).filter(([, n]) => n >= PEEK_ATTEMPTS).map(([v]) => Number(v)));

/** Test hook: forget replay position, last frame and whether a frame has rendered. */
export function resetAppStateForTests() {
    replay = null;
    hasRenderedScore = false;
    lastData = null;
    sampleCardShown = false;
    viewCache = {};
    peekAttempts = {};
    peekFollowUp = false;
    fastPolls = 0;
    panelsShown = new Set();
    breakBatters = null;
    resetDataQrForTests();
}

/**
 * Paint a frame and fire any cards its changes call for. Frames from a view peek (no live
 * fields) only feed the cache; they never touch the bar or count as a score change.
 */
function renderFrame(data: CricketAPIData, quiet: boolean, showData = false) {
    stripPii(data);
    viewCache = mergeCache(viewCache, data);
    e2eLog('frame', { view: data.view ?? 1, full: isFullFrame(data), phase: isFullFrame(data) ? matchPhase(data) : null, score: `${data.values.t1Total ?? ''}/${data.values.t1Wickets ?? ''}|${data.values.t2Total ?? ''}/${data.values.t2Wickets ?? ''}`, balls: data.balls?.length ?? 0 });
    if (!isFullFrame(data)) return;

    updateScoreboard(data);
    // Drawn after the bar so it is never blocked by a slow paint, and only when asked:
    // the code is scaffolding for highlights/, not part of the graphic.
    // 🛑 This sits below the isFullFrame guard on purpose — a view peek has no live
    // fields, and encoding one would hand highlights/ a CRC-valid frame of nonsense.
    setDataCode(data, showData);
    if (!quiet) {
        // Golden rule: a new ball dismisses whatever is showing before this frame's own cards play.
        if (scoreChanged(lastData, data)) dismissAll();
        enqueueCards(detectEvents(lastData, data));
        const phase = matchPhase(data);
        // Panels wait until the phase's peeks have landed (or been given up on), so they never render half-empty.
        const dataReady = desiredView(data, phase, viewCache, gaveUp()) === null;
        // Before the first ball and at the break, the panel comes off once both openers are in:
        // the players are walking out. At the break the names must also have changed, since the
        // last pair of the first innings may still be sitting in the fields.
        const early = openersIn(phase, data.values);
        if (phase === 'pre' && early) dismissPanel('lineup');
        if (phase === 'break' && early) dismissPanel('innings-summary');
        if (phase !== 'play' && dataReady && isIdle('panel') && !panelsShown.has(phase) && !early) {
            panelsShown.add(phase);
            enqueueCards(phasePanels(phase, data.values, viewCache));
        }
    }
    lastData = data;
}

function openersIn(phase: MatchPhase, v: CricketAPIData['values']): boolean {
    if (phase !== 'pre' && phase !== 'break') return false;
    const a = v.batsman1Name?.trim(), b = v.batsman2Name?.trim();
    const pair = `${a ?? ''}|${b ?? ''}`;
    if (phase === 'break') breakBatters ??= pair;
    return !!(a && b) && (phase === 'pre' || pair !== breakBatters);
}

function setDataCode(data: CricketAPIData, showData: boolean) {
    const canvas = DOM.dataCode;
    if (!canvas) return;
    canvas.hidden = !showData;
    if (showData) renderDataCode(canvas, data);
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
/** Asks for the next view the phase needs; true when it asked, so the caller reads again soon. */
async function steerView(data: CricketAPIData, feed: Feed): Promise<boolean> {
    const want = desiredView(data, isFullFrame(data) ? matchPhase(data) : (lastData ? matchPhase(lastData) : 'play'), viewCache, gaveUp());
    if (want !== null && want !== (data.view ?? 1)) {
        // desiredView() never returns a view that has used its tries, so this cannot run away.
        if (want !== 1) peekAttempts[want] = (peekAttempts[want] ?? 0) + 1;
        e2eLog('switch', { from: data.view ?? 1, to: want });
        await feed.switchTo(want);
        return true;
    }
    return false;
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
    // Pull in the QR encoder only for streams that asked for the data code.
    if (params.data) await ensureDataQr();

    const replaying = params.mode === 'replay';
    if (!params.matchId && !params.debug && !replaying) {
        return;
    }

    try {
        let data: CricketAPIData;
        let feed: Feed | null = null;
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
        } else if (replaying) {
            feed = await (replay ??= replayFeed(params));
            data = await feed.read();
        } else {
            trackOnce('overlay_start', { clubId: params.clubId, matchId: params.matchId, theme: params.theme, logo: params.logo });
            feed = liveFeed(params.clubId, params.matchId!);
            data = await feed.read();
        }

        if (isFullFrame(data)) await updateTeamLogos(data);
        renderFrame(data, params.quiet, params.data);
        // Debug has no feed, so it never switches views.
        if (feed) peekFollowUp = await steerView(data, feed);
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
    setTimeout(pollLoop, nextDelay());
}

/**
 * The normal refresh, or a short one straight after a view switch. A switch applies in under half a
 * second, so reading at once keeps CricClubs' own overlay on the data view for about a second per
 * peek instead of a whole refresh. Still one timeout chain, so polls never overlap.
 */
function nextDelay(): number {
    const normal = getQueryParams().mode === 'replay' ? CONFIG.REPLAY_REFRESH_MS : refreshMs();
    if (!peekFollowUp) { fastPolls = 0; return normal; }
    peekFollowUp = false;
    // 🛑 Coming home to the scorebar is not attempt-limited, so a feed stuck on a data view would
    // otherwise fast-poll forever. Past the cap this falls back to the old cadence.
    if (++fastPolls > CONFIG.MAX_FAST_POLLS) return normal;
    return Math.min(CONFIG.PEEK_FOLLOW_MS, normal);
}
