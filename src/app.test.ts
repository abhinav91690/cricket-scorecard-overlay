import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./dom', () => ({ DOM: { teamName: document.createElement('div'),
    dataCode: document.createElement('canvas') } }));
vi.mock('./dataQr', () => ({ ensureDataQr: vi.fn(async () => {}),
    renderDataCode: vi.fn(), resetDataQrForTests: vi.fn() }));
vi.mock('./api', () => ({ fetchScoreData: vi.fn(), switchView: vi.fn() }));
vi.mock('./ui', () => ({ updateScoreboard: vi.fn(), updateTeamLogos: vi.fn(async () => {}) }));
vi.mock('./theme', () => ({ applyTheme: vi.fn(), updateLogo: vi.fn() }));
vi.mock('./analytics', () => ({ track: vi.fn(), trackOnce: vi.fn() }));
vi.mock('./toast', () => ({ showToast: vi.fn() }));
vi.mock('./events', () => ({ detectEvents: vi.fn(() => []) }));
vi.mock('./cards', () => ({ enqueueCards: vi.fn(), showSampleCard: vi.fn(), dismissAll: vi.fn(), dismissPanel: vi.fn(), isIdle: vi.fn(() => true) }));
vi.mock('./liveStream', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./liveStream')>();
    return { ...actual, linkLiveStream: vi.fn(async () => {}) };
});

import { updateScore, setupLinkStreamForm, pollLoop, resetAppStateForTests } from './app';
import { DOM } from './dom';
import { fetchScoreData, switchView } from './api';
import { renderDataCode } from './dataQr';
import { updateScoreboard, updateTeamLogos } from './ui';
import { applyTheme, updateLogo } from './theme';
import { track, trackOnce } from './analytics';
import { showToast } from './toast';
import { detectEvents } from './events';
import { enqueueCards, showSampleCard, dismissAll, dismissPanel } from './cards';
import { mock_view_48 } from './mockData';
import { linkLiveStream, LinkLiveStreamError } from './liveStream';
import { mock_1stInnings, mock_2ndInnings, mock_matchEnded, mock_toss, mock_noTeamImage } from './mockData';
import { buildTimeline, DEFAULT_CONFIG } from '../sim/match.ts';
import { CONFIG } from './config';

function setSearch(search: string) {
    Object.defineProperty(window, 'location', { value: { search, hostname: 'score.abhinav.dev' }, writable: true });
}

function mountShell() {
    document.body.innerHTML = `
        <div id="instructions" style="display:none">
            <form id="link-stream-form">
                <input id="link-club-id"><input id="link-match-id"><input id="link-stream-url">
                <button id="link-stream-submit" type="submit">Link Stream</button>
            </form>
        </div>
        <div class="overlay"></div>`;
}

const instructions = () => document.getElementById('instructions')!;
const overlay = () => document.querySelector('.overlay') as HTMLElement;
const live = { view: 1, values: { t1Name: 'Live', batsman1Name: 'A', isSecondInningsStarted: 'false', t1Overs: '5.0', t1Total: '40', t1Wickets: '1' }, balls: ['1'] } as any;

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    resetAppStateForTests();
    mountShell();
    DOM.teamName.textContent = 'Loading...';
});

afterEach(() => vi.restoreAllMocks());

describe('updateScore mode switch', () => {
    it('shows the home screen and records a home_view when there is no match context', async () => {
        setSearch('');
        await updateScore();
        expect(instructions().style.display).toBe('flex');
        expect(overlay().style.display).toBe('none');
        expect(trackOnce).toHaveBeenCalledWith('home_view');
        expect(fetchScoreData).not.toHaveBeenCalled();
        expect(applyTheme).not.toHaveBeenCalled();
    });

    it('renders mock data for ?debug= without touching the network or analytics', async () => {
        const cases: [string, unknown][] = [
            ['1', mock_1stInnings], ['true', mock_1stInnings], ['2', mock_2ndInnings],
            ['3', mock_matchEnded], ['4', mock_toss], ['5', mock_noTeamImage], ['garbage', mock_1stInnings],
        ];
        for (const [debug, expected] of cases) {
            vi.mocked(updateScoreboard).mockClear();
            setSearch(`?debug=${debug}&theme=kkr`);
            await updateScore();
            expect(updateScoreboard).toHaveBeenLastCalledWith(expected);
        }
        expect(fetchScoreData).not.toHaveBeenCalled();
        expect(trackOnce).not.toHaveBeenCalled();
        expect(instructions().style.display).toBe('none');
        expect(overlay().style.display).toBe('');
        expect(applyTheme).toHaveBeenCalledWith('kkr');
    });

    it('replays a whole simulated match, toss to result, with no network at all', async () => {
        // The replay is a simulated CricClubs inside the page: frames AND view switches go to it,
        // so peeks, panels and the result card run exactly the code a live match does.
        vi.useFakeTimers(); vi.setSystemTime(0);
        try {
            setSearch('?mode=replay&speed=30');
            await updateScore();
            const first = vi.mocked(updateScoreboard).mock.calls[0][0].values as any;
            expect(first.isMatchEnded).toBe('0');
            expect(first.isSecondInningsStarted).toBe('false');          // before the first ball
            await updateScore();                                          // team 1's squad lands, locally
            expect(vi.mocked(updateScoreboard)).toHaveBeenCalledTimes(1); // and stays off the bar
            for (let i = 0; i < 3; i++) await updateScore();              // home, team 2's squad, home
            const lineups = () => vi.mocked(enqueueCards).mock.calls.flat(2).filter((c: any) => c?.type === 'lineup');
            expect(lineups()).toHaveLength(1);                            // both squads in: the line-up plays
            // Jump past the last ball; the end-of-match peeks run, then the result card
            const end = buildTimeline(DEFAULT_CONFIG).at(-1)!.t;
            vi.setSystemTime((end / 30) * 1000 + 1000);
            for (let i = 0; i < 12; i++) await updateScore();
            const last = vi.mocked(updateScoreboard).mock.calls.at(-1)![0].values as any;
            expect(last.isMatchEnded).toBe('1');
            const types = vi.mocked(enqueueCards).mock.calls.flat(2).map((c: any) => c?.type);
            expect(types).toContain('match-summary');
            expect(fetchScoreData).not.toHaveBeenCalled();
            expect(switchView).not.toHaveBeenCalled();
        } finally { vi.useRealTimers(); }
    });

    it('starts from a chosen phase with ?start=', async () => {
        setSearch('?mode=replay&start=ended');
        await updateScore();
        expect((vi.mocked(updateScoreboard).mock.calls[0][0].values as any).isMatchEnded).toBe('1');
    });

    it('replays a tie decided by a super over with ?superover=1', async () => {
        setSearch('?mode=replay&superover=1&start=so1');
        await updateScore();
        const v = vi.mocked(updateScoreboard).mock.calls[0][0].values as any;
        expect(v.isSuperOver).toBe('true');
        expect(v.result).toBe('Super Over.');
    });

    it('caps the speed, so every simulated ball still gets a read of its own', async () => {
        // x1000 would be over in seconds; capped at REPLAY_MAX_SPEED ten real seconds are 300
        // simulated ones, still before the first ball.
        vi.useFakeTimers(); vi.setSystemTime(0);
        try {
            setSearch('?mode=replay&speed=1000');
            await updateScore();
            vi.setSystemTime(10_000);
            await updateScore();
            const v = vi.mocked(updateScoreboard).mock.calls.at(-1)![0].values as any;
            expect(v.isMatchEnded).toBe('0');
            expect(v.isSecondInningsStarted).toBe('false');
        } finally { vi.useRealTimers(); }
    });

    it('fetches the live feed for a matchId, applying theme/logo and recording overlay_start once', async () => {
        setSearch('?matchId=2079&clubId=42&theme=rcb&logo=1');
        vi.mocked(fetchScoreData).mockResolvedValue(live);

        await updateScore();
        await updateScore();

        expect(fetchScoreData).toHaveBeenCalledTimes(2);
        expect(fetchScoreData).toHaveBeenCalledWith('https://cricclubs.com/liveScoreOverlayData.do?clubId=42&matchId=2079');
        expect(updateTeamLogos).toHaveBeenCalledWith(live);
        expect(updateScoreboard).toHaveBeenCalledWith(live);
        expect(applyTheme).toHaveBeenCalledWith('rcb');
        expect(updateLogo).toHaveBeenCalledWith('1');
        // trackOnce is what de-duplicates; the app must route through it, not track()
        expect(trackOnce).toHaveBeenCalledWith('overlay_start', { clubId: '42', matchId: '2079', theme: 'rcb', logo: '1' });
        expect(track).not.toHaveBeenCalled();
    });

    it('uses the default club id when none is given', async () => {
        setSearch('?matchId=7');
        vi.mocked(fetchScoreData).mockResolvedValue(live);
        await updateScore();
        expect(fetchScoreData).toHaveBeenCalledWith(`https://cricclubs.com/liveScoreOverlayData.do?clubId=${CONFIG.DEFAULT_CLUB_ID}&matchId=7`);
    });
});

describe('event cards', () => {
    const frame2 = { ...live, values: { ...live.values, t1Wickets: '2' }, balls: ['1', 'W'] } as any;

    it('diffs consecutive frames and queues the resulting cards', async () => {
        setSearch('?matchId=1');
        vi.mocked(fetchScoreData).mockResolvedValueOnce(live).mockResolvedValueOnce(frame2);
        const wicket = { type: 'wicket', name: 'X', runs: '1', balls: '2', dismissal: '' };
        vi.mocked(detectEvents).mockReturnValueOnce([]).mockReturnValueOnce([wicket as any]);

        await updateScore();
        await updateScore();

        expect(detectEvents).toHaveBeenNthCalledWith(1, null, live);
        expect(detectEvents).toHaveBeenNthCalledWith(2, live, frame2);
        expect(enqueueCards).toHaveBeenLastCalledWith([wicket]);
    });

    it('also fires in replay mode', async () => {
        setSearch('?mode=replay&start=inn1');
        await updateScore();
        await updateScore();
        expect(detectEvents).toHaveBeenCalledTimes(2);
        const [prev, next] = vi.mocked(detectEvents).mock.calls[1];
        expect(prev).toBe(vi.mocked(detectEvents).mock.calls[0][1]);   // consecutive frames, as live
        expect(next).toBeTruthy();
    });

    it('is silenced by ?quiet', async () => {
        setSearch('?matchId=1&quiet');
        vi.mocked(fetchScoreData).mockResolvedValue(live);
        await updateScore();
        await updateScore();
        expect(detectEvents).not.toHaveBeenCalled();
        expect(enqueueCards).not.toHaveBeenCalled();
    });

    it('holds a sample card once in debug mode when asked', async () => {
        setSearch('?debug=1&card=wicket');
        await updateScore();
        await updateScore();
        expect(showSampleCard).toHaveBeenCalledTimes(1);
        expect(showSampleCard).toHaveBeenCalledWith('wicket');
    });
});

describe('views: peeks, dismissal and panels', () => {
    const pre = { view: 1, values: { t1Name: 'Lions', t2Name: 'TGU', batsman1Name: 'A', isSecondInningsStarted: 'false', t1Overs: '0.0', toss: 'Lions won the toss' }, balls: [] } as any;

    it('asks for the first squad before the match, then comes home after the peek', async () => {
        setSearch('?matchId=2079&clubId=1089463');
        vi.mocked(fetchScoreData).mockResolvedValueOnce(pre).mockResolvedValueOnce(mock_view_48 as any);
        await updateScore();
        expect(switchView).toHaveBeenCalledWith('1089463', '2079', 48, 'https://cricclubs.com');
        await updateScore();
        expect(switchView).toHaveBeenLastCalledWith('1089463', '2079', 1, 'https://cricclubs.com');
        // the peek frame never reached the bar or the event detector
        expect(updateScoreboard).toHaveBeenCalledTimes(1);
        expect(detectEvents).toHaveBeenCalledTimes(1);
    });

    it('never encodes a view peek into the ?data=1 code', async () => {
        // 🛑 A peek frame has no live fields. Encoding one would produce a CRC-VALID
        // payload of nonsense, which highlights/ would then trust and cut clips from —
        // the CRC cannot catch it, because the bytes are honestly what we encoded.
        setSearch('?matchId=2079&clubId=1089463&data=1');
        vi.mocked(fetchScoreData).mockResolvedValueOnce(pre).mockResolvedValueOnce(mock_view_48 as any);
        await updateScore();                                  // live frame
        expect(renderDataCode).toHaveBeenCalledTimes(1);
        await updateScore();                                  // peek frame lands
        expect(renderDataCode).toHaveBeenCalledTimes(1);      // still 1, not 2
    });

    it('moves on to the next view when one never yields, instead of blocking it', async () => {
        // 🛑 The squad view never arrives (the switch is ignored, every poll is the scorebar).
        // It used to stop asking for 48 after three tries but never move on: 49 was never
        // requested, and the line-up showed with BOTH XIs empty.
        setSearch('?matchId=2079&clubId=1089463');
        vi.mocked(fetchScoreData).mockResolvedValue(pre);
        const lineups = () => vi.mocked(enqueueCards).mock.calls.flat(2).filter((c: any) => c?.type === 'lineup');
        for (let i = 0; i < 4; i++) await updateScore();
        expect(vi.mocked(switchView).mock.calls.map(c => c[2])).toEqual([48, 48, 48, 49]);
        expect(lineups()).toHaveLength(0);          // still waiting: team 2's squad has not had its tries
        for (let i = 0; i < 3; i++) await updateScore();
        expect(vi.mocked(switchView).mock.calls.map(c => c[2])).toEqual([48, 48, 48, 49, 49, 49]);
        expect(lineups()).toHaveLength(1);          // every view has had its tries: show what there is
    });

    it('never switches views during play or in debug mode', async () => {
        setSearch('?matchId=1');
        vi.mocked(fetchScoreData).mockResolvedValue(live);
        await updateScore();
        expect(switchView).not.toHaveBeenCalled();
        setSearch('?debug=4');
        await updateScore();
        expect(switchView).not.toHaveBeenCalled();
    });

    it('dismisses everything when the score moves, before queueing that frame\'s cards', async () => {
        setSearch('?matchId=1');
        const next = { ...live, values: { ...live.values, t1Total: '44' }, balls: ['1', '4'] };
        vi.mocked(fetchScoreData).mockResolvedValueOnce(live).mockResolvedValueOnce(next);
        await updateScore();
        expect(dismissAll).not.toHaveBeenCalled();
        await updateScore();
        expect(dismissAll).toHaveBeenCalledTimes(1);
        const order = vi.mocked(dismissAll).mock.invocationCallOrder[0];
        const enq = vi.mocked(enqueueCards).mock.invocationCallOrder.filter(n => n > order);
        expect(enq.length).toBeGreaterThan(0);
    });

    it('holds phase panels until the phase\'s peeks have landed', async () => {
        setSearch('?matchId=2079&clubId=1');
        const squad49 = { ...(mock_view_48 as any), view: 49, values: { ...(mock_view_48 as any).values, t2Name: 'TGU', t2PlayersList: (mock_view_48 as any).values.t1PlayersList } };
        vi.mocked(fetchScoreData).mockResolvedValueOnce(pre).mockResolvedValueOnce(mock_view_48 as any).mockResolvedValueOnce(pre).mockResolvedValueOnce(squad49).mockResolvedValue(pre);
        const lineups = () => vi.mocked(enqueueCards).mock.calls.flat(2).filter((c: any) => c.type === 'lineup');
        await updateScore(); // pre, asks for 48
        expect(lineups()).toHaveLength(0);
        await updateScore(); // 48 lands (peek frame)
        await updateScore(); // pre, asks for 49
        expect(lineups()).toHaveLength(0);
        await updateScore(); // 49 lands
        await updateScore(); // pre, nothing left to fetch -> panel
        expect(lineups()).toHaveLength(1);
        expect(lineups()[0]).toMatchObject({ toss: 'Lions won the toss' });
        expect((lineups()[0] as any).teams[0].players.length).toBeGreaterThan(0);
    });

    it('shows the line-up once before the first ball, never on a loop', async () => {
        // It covers the middle of the picture, so it goes on air one time per load; the panel
        // surface going idle again (isIdle is always true here) must not bring it back.
        setSearch('?matchId=2079&clubId=1');
        const squad49 = { ...(mock_view_48 as any), view: 49, values: { ...(mock_view_48 as any).values, t2Name: 'TGU', t2PlayersList: (mock_view_48 as any).values.t1PlayersList } };
        vi.mocked(fetchScoreData).mockResolvedValueOnce(pre).mockResolvedValueOnce(mock_view_48 as any).mockResolvedValueOnce(pre).mockResolvedValueOnce(squad49).mockResolvedValue(pre);
        for (let i = 0; i < 12; i++) await updateScore();
        expect(vi.mocked(enqueueCards).mock.calls.flat(2).filter((c: any) => c.type === 'lineup')).toHaveLength(1);
        expect(dismissPanel).not.toHaveBeenCalled();     // one opener is not both
    });

    it('takes the line-up off once both openers are in, and skips it if they already are', async () => {
        setSearch('?matchId=2079&clubId=1');
        const squad49 = { ...(mock_view_48 as any), view: 49, values: { ...(mock_view_48 as any).values, t2Name: 'TGU', t2PlayersList: (mock_view_48 as any).values.t1PlayersList } };
        const openers = { ...pre, values: { ...pre.values, batsman2Name: 'B' } };
        vi.mocked(fetchScoreData).mockResolvedValueOnce(pre).mockResolvedValueOnce(mock_view_48 as any).mockResolvedValueOnce(pre).mockResolvedValueOnce(squad49).mockResolvedValueOnce(pre).mockResolvedValue(openers);
        const lineups = () => vi.mocked(enqueueCards).mock.calls.flat(2).filter((c: any) => c.type === 'lineup');
        for (let i = 0; i < 5; i++) await updateScore();
        expect(lineups()).toHaveLength(1);
        await updateScore();                             // the scorer picks the second opener
        expect(dismissPanel).toHaveBeenCalledWith('lineup');
        for (let i = 0; i < 3; i++) await updateScore();
        expect(lineups()).toHaveLength(1);

        resetAppStateForTests(); vi.mocked(enqueueCards).mockClear();
        vi.mocked(fetchScoreData).mockReset();
        vi.mocked(fetchScoreData).mockResolvedValueOnce(openers).mockResolvedValueOnce(mock_view_48 as any).mockResolvedValueOnce(openers).mockResolvedValueOnce(squad49).mockResolvedValue(openers);
        for (let i = 0; i < 8; i++) await updateScore();
        expect(lineups()).toHaveLength(0);               // loaded after the openers were in: never shown
    });

    it('shows the innings summary once at the break, and takes it off when new openers are in', async () => {
        setSearch('?matchId=2079&clubId=1');
        // The first innings' last pair is still in the fields when the break begins: that is not "openers in".
        const brk = { view: 1, values: { t1Name: 'Lions', t2Name: 'TGU', t1Total: '142', t1Wickets: '8', t1Overs: '20.0', t2Overs: '0', isSecondInningsStarted: 'true', batsman1Name: 'Last A', batsman2Name: 'Last B' }, balls: [] } as any;
        const resumed = { ...brk, values: { ...brk.values, batsman1Name: 'Open C', batsman2Name: 'Open D' } };
        vi.mocked(fetchScoreData).mockResolvedValue(brk);    // the card peeks never land: the panel shows after its tries
        const summaries = () => vi.mocked(enqueueCards).mock.calls.flat(2).filter((c: any) => c.type === 'innings-summary');
        for (let i = 0; i < 12; i++) await updateScore();
        expect(summaries()).toHaveLength(1);
        expect(dismissPanel).not.toHaveBeenCalled();
        vi.mocked(fetchScoreData).mockResolvedValue(resumed);
        await updateScore();
        expect(dismissPanel).toHaveBeenCalledWith('innings-summary');
        for (let i = 0; i < 3; i++) await updateScore();
        expect(summaries()).toHaveLength(1);
    });

    it('puts the result up once and leaves it there', async () => {
        setSearch('?matchId=2079&clubId=1');
        // (mock_matchEnded carries isMatchEnded "0", so the flag is set here.)
        const ended = { ...(mock_matchEnded as any), values: { ...(mock_matchEnded as any).values, isMatchEnded: '1' } };
        vi.mocked(fetchScoreData).mockResolvedValue(ended);
        for (let i = 0; i < 20; i++) await updateScore();   // four card views get their three tries first
        expect(vi.mocked(enqueueCards).mock.calls.flat(2).filter((c: any) => c.type === 'match-summary')).toHaveLength(1);
        expect(dismissPanel).not.toHaveBeenCalled();
    });

    it('gives up on a view that never yields and shows the panel anyway', async () => {
        setSearch('?matchId=2079&clubId=1');
        vi.mocked(fetchScoreData).mockResolvedValue(pre); // the peek never lands: every poll is the scorebar
        // Seven polls, not six: each squad view gets its three tries in turn. The six this used to
        // wait was only enough because team 2's squad was never asked for at all.
        for (let i = 0; i < 7; i++) await updateScore();
        const asks = (view: number) => vi.mocked(switchView).mock.calls.filter(c => c[2] === view).length;
        expect(asks(48)).toBe(3);
        expect(asks(49)).toBe(3);
        expect(vi.mocked(enqueueCards).mock.calls.flat(2).filter((c: any) => c.type === 'lineup').length).toBeGreaterThan(0);
    });

    it('strips emails before anything else sees the frame', async () => {
        setSearch('?matchId=1');
        const leaky = { ...live, values: { ...live.values, t1Batting: [{ firstName: 'A', email: 'a@b.c' }] } };
        vi.mocked(fetchScoreData).mockResolvedValue(leaky);
        await updateScore();
        expect(JSON.stringify(vi.mocked(updateScoreboard).mock.calls[0][0])).not.toContain('email');
    });
});

describe('updateScore error handling', () => {
    it('shows Error before any frame has rendered', async () => {
        setSearch('?matchId=1');
        vi.mocked(fetchScoreData).mockRejectedValue(new Error('HTTP error! status: 500'));
        await updateScore();
        expect(DOM.teamName.textContent).toBe('Error');
        expect(updateScoreboard).not.toHaveBeenCalled();
    });

    it('keeps the last good frame after a successful render', async () => {
        setSearch('?matchId=1');
        vi.mocked(fetchScoreData).mockResolvedValueOnce(live).mockRejectedValueOnce(new Error('timeout'));
        await updateScore();
        DOM.teamName.textContent = 'Lions'; // what updateScoreboard would have painted
        await updateScore();
        expect(DOM.teamName.textContent).toBe('Lions');
        expect(console.error).toHaveBeenCalled();
    });

    it('treats a logo failure like a fetch failure and does not paint half a frame', async () => {
        setSearch('?matchId=1');
        vi.mocked(fetchScoreData).mockResolvedValue(live);
        vi.mocked(updateTeamLogos).mockRejectedValueOnce(new Error('img'));
        await updateScore();
        expect(updateScoreboard).not.toHaveBeenCalled();
        expect(DOM.teamName.textContent).toBe('Error');
    });
});

describe('pollLoop', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('re-arms after each update completes and survives a thrown error', async () => {
        setSearch('?matchId=1');
        vi.mocked(fetchScoreData).mockResolvedValue(live);
        const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');

        await pollLoop();
        expect(timeoutSpy).toHaveBeenCalledWith(pollLoop, CONFIG.REFRESH_RATE); // no ?refresh override in tests
        expect(fetchScoreData).toHaveBeenCalledTimes(1);

        // Advance one interval: exactly one more poll, scheduled only after the first finished.
        await vi.advanceTimersByTimeAsync(CONFIG.REFRESH_RATE);
        expect(fetchScoreData).toHaveBeenCalledTimes(2);

        // Even an unexpected throw outside updateScore's own try/catch keeps the loop alive.
        vi.mocked(updateTeamLogos).mockImplementationOnce(() => { throw new Error('sync boom'); });
        await vi.advanceTimersByTimeAsync(CONFIG.REFRESH_RATE);
        await vi.advanceTimersByTimeAsync(CONFIG.REFRESH_RATE);
        expect(fetchScoreData).toHaveBeenCalledTimes(4);
    });

    // Delays pollLoop re-armed itself with, in order.
    const delays = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter(c => c[0] === pollLoop).map(c => c[1] as number);

    it('reads again almost at once after a peek, so CricClubs\' overlay is not left on the data view', async () => {
        // A switch applies in under half a second (measured, cricclubs-api.md §2). Waiting the full
        // refresh before reading it left CricClubs' own overlay on the squad or card view for ~5 s.
        setSearch('?matchId=2079&clubId=1089463');
        const pre = { view: 1, values: { t1Name: 'Lions', t2Name: 'TGU', batsman1Name: 'A', isSecondInningsStarted: 'false', t1Overs: '0.0' }, balls: [] } as any;
        vi.mocked(fetchScoreData).mockResolvedValueOnce(pre).mockResolvedValueOnce(mock_view_48 as any).mockResolvedValue(pre);
        const spy = vi.spyOn(globalThis, 'setTimeout');
        await pollLoop();                                            // live frame: asks for 48
        expect(switchView).toHaveBeenLastCalledWith('1089463', '2079', 48, 'https://cricclubs.com');
        expect(delays(spy).at(-1)).toBe(CONFIG.PEEK_FOLLOW_MS);
        await vi.advanceTimersByTimeAsync(CONFIG.PEEK_FOLLOW_MS);    // reads the squad, asks for home
        expect(fetchScoreData).toHaveBeenCalledTimes(2);
        expect(switchView).toHaveBeenLastCalledWith('1089463', '2079', 1, 'https://cricclubs.com');
        expect(delays(spy).at(-1)).toBe(CONFIG.PEEK_FOLLOW_MS);
    });

    it('reads a replay every REPLAY_REFRESH_MS, since there is no network to spare', async () => {
        setSearch('?mode=replay&start=inn1');
        const spy = vi.spyOn(globalThis, 'setTimeout');
        await pollLoop();
        expect(delays(spy).at(-1)).toBe(CONFIG.REPLAY_REFRESH_MS);
    });

    it('keeps the normal cadence when no switch was asked for', async () => {
        setSearch('?matchId=1');
        vi.mocked(fetchScoreData).mockResolvedValue(live);
        const spy = vi.spyOn(globalThis, 'setTimeout');
        await pollLoop();
        await vi.advanceTimersByTimeAsync(CONFIG.REFRESH_RATE);
        expect(delays(spy)).toEqual([CONFIG.REFRESH_RATE, CONFIG.REFRESH_RATE]);
    });

    it('falls back to the normal cadence if CricClubs never comes home', async () => {
        // 🛑 Coming home is not attempt-limited, so a feed stuck on a data view would otherwise
        // fast-poll forever. Past the cap it behaves exactly as it did before this change.
        setSearch('?matchId=2079&clubId=1089463');
        vi.mocked(fetchScoreData).mockResolvedValue(mock_view_48 as any);
        const spy = vi.spyOn(globalThis, 'setTimeout');
        await pollLoop();
        for (let i = 0; i < 11; i++) await vi.advanceTimersByTimeAsync(delays(spy).at(-1)!);
        const d = delays(spy);
        expect(d.slice(0, CONFIG.MAX_FAST_POLLS)).toEqual(Array(CONFIG.MAX_FAST_POLLS).fill(CONFIG.PEEK_FOLLOW_MS));
        expect(d.slice(CONFIG.MAX_FAST_POLLS)).toEqual(Array(d.length - CONFIG.MAX_FAST_POLLS).fill(CONFIG.REFRESH_RATE));
    });
});

describe('setupLinkStreamForm', () => {
    const form = () => document.getElementById('link-stream-form') as HTMLFormElement;
    const input = (id: string) => document.getElementById(id) as HTMLInputElement;
    const button = () => document.getElementById('link-stream-submit') as HTMLButtonElement;
    const submit = async () => {
        form().dispatchEvent(new Event('submit', { cancelable: true }));
        await vi.waitFor(() => expect(button().hasAttribute('aria-busy')).toBe(false));
    };

    beforeEach(() => {
        setupLinkStreamForm();
        input('link-match-id').value = ' 2079 ';
        input('link-stream-url').value = ' https://www.youtube.com/watch?v=dQw4w9WgXcQ ';
    });

    it('prefills the default club id', () => {
        expect(input('link-club-id').value).toBe(CONFIG.DEFAULT_CLUB_ID);
    });

    it('does nothing when a field is blank', async () => {
        input('link-match-id').value = '';
        form().dispatchEvent(new Event('submit', { cancelable: true }));
        expect(linkLiveStream).not.toHaveBeenCalled();
        expect(track).not.toHaveBeenCalled();
    });

    it('submits trimmed values, toasts success and records the outcome', async () => {
        await submit();
        expect(linkLiveStream).toHaveBeenCalledWith({ clubId: CONFIG.DEFAULT_CLUB_ID, matchId: '2079', liveStreamURL: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
        expect(showToast).toHaveBeenCalledWith('Live stream link submitted!', 'success');
        expect(track).toHaveBeenCalledWith('link_stream_submit', { clubId: CONFIG.DEFAULT_CLUB_ID, matchId: '2079', videoId: 'dQw4w9WgXcQ', outcome: 'submitted' });
        expect(button().textContent).toBe('Link Stream');
    });

    it('marks the button busy while in flight, ignores repeat submits, then restores it', async () => {
        let release!: () => void;
        vi.mocked(linkLiveStream).mockImplementationOnce(() => new Promise<void>(r => { release = r; }));
        form().dispatchEvent(new Event('submit', { cancelable: true }));
        expect(button().getAttribute('aria-busy')).toBe('true');
        expect(button().textContent).toBe('Linking...');
        expect(button().disabled).toBe(false);

        form().dispatchEvent(new Event('submit', { cancelable: true }));
        expect(linkLiveStream).toHaveBeenCalledTimes(1);

        release();
        await vi.waitFor(() => expect(button().hasAttribute('aria-busy')).toBe(false));
        expect(button().textContent).toBe('Link Stream');
    });

    it('maps typed failures to their outcome codes and shows the error message', async () => {
        vi.mocked(linkLiveStream).mockRejectedValueOnce(new LinkLiveStreamError('popup_blocked', 'Your browser blocked the request popup.'));
        await submit();
        expect(showToast).toHaveBeenCalledWith('Your browser blocked the request popup.', 'error');
        expect(track).toHaveBeenCalledWith('link_stream_submit', expect.objectContaining({ outcome: 'popup_blocked' }));

        vi.mocked(linkLiveStream).mockRejectedValueOnce(new LinkLiveStreamError('invalid_url', 'Could not find a YouTube video ID in that URL.'));
        await submit();
        expect(track).toHaveBeenLastCalledWith('link_stream_submit', expect.objectContaining({ outcome: 'invalid_url' }));
    });

    it('reports unknown failures as error with a generic message when there is none', async () => {
        vi.mocked(linkLiveStream).mockRejectedValueOnce(new Error(''));
        await submit();
        expect(showToast).toHaveBeenCalledWith('Failed to link live stream. Please try again.', 'error');
        expect(track).toHaveBeenLastCalledWith('link_stream_submit', expect.objectContaining({ outcome: 'error' }));
    });
});
