import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { detectClient, isTrackingEnabled, track, trackOnce, resetTrackingForTests,
         startSessionPings, stopSessionPings, sessionId, PING_MS } from './analytics';

function fakeWindow(userAgent: string, extra: Record<string, unknown> = {}): Window {
    return { navigator: { userAgent }, screen: { width: 1920, height: 1080 }, ...extra } as unknown as Window;
}

describe('detectClient', () => {
    it('detects OBS from the injected obsstudio object', () => {
        const info = detectClient(fakeWindow('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/127.0.0.0', { obsstudio: { pluginVersion: '30.2.3' } }));
        expect(info).toEqual({ client: 'obs', clientVersion: '30.2.3', os: 'windows', screen: '1920x1080' });
    });

    it('detects OBS from the user agent token when the object is missing', () => {
        const info = detectClient(fakeWindow('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/127.0.0.0 Safari/537.36 OBS/31.0.0'));
        expect(info.client).toBe('obs');
        expect(info.clientVersion).toBe('31.0.0');
        expect(info.os).toBe('macos');
    });

    it('detects other streaming apps and falls back to browser', () => {
        expect(detectClient(fakeWindow('Mozilla/5.0 (Windows NT 10.0) vMix/27')).client).toBe('vmix');
        expect(detectClient(fakeWindow('Mozilla/5.0 Streamlabs/1.0')).client).toBe('streamlabs');
        expect(detectClient(fakeWindow('Mozilla/5.0 PRISM Live Studio')).client).toBe('prism');
        expect(detectClient(fakeWindow('Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0')).client).toBe('browser');
    });
});

describe('isTrackingEnabled', () => {
    const base = { hostname: 'score.abhinav.dev', debug: null, mode: null, nostats: null, doNotTrack: null };

    it('is on for a normal production load', () => {
        expect(isTrackingEnabled(base)).toBe(true);
    });

    it('is off for localhost, debug, replay, nostats and Do Not Track', () => {
        expect(isTrackingEnabled({ ...base, hostname: 'localhost' })).toBe(false);
        expect(isTrackingEnabled({ ...base, debug: '1' })).toBe(false);
        expect(isTrackingEnabled({ ...base, mode: 'replay' })).toBe(false);
        expect(isTrackingEnabled({ ...base, nostats: '' })).toBe(false);
        expect(isTrackingEnabled({ ...base, nostats: '1' })).toBe(false);
        expect(isTrackingEnabled({ ...base, doNotTrack: '1' })).toBe(false);
    });
});

describe('track', () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    const beacon = vi.fn(() => true);
    const flush = () => vi.runAllTimers();

    // jsdom's Blob cannot be read back synchronously; record what was handed to the beacon instead.
    class FakeBlob { type: string; parts: string[]; constructor(parts: string[], opts?: { type?: string }) { this.parts = parts; this.type = opts?.type ?? ''; } }

    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('Blob', FakeBlob);
        vi.stubGlobal('fetch', fetchMock);
        Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true, writable: true });
        fetchMock.mockClear();
        beacon.mockClear();
        resetTrackingForTests();
        // jsdom defaults to localhost, which disables tracking; pretend we're in production.
        Object.defineProperty(window, 'location', {
            value: { hostname: 'score.abhinav.dev', search: '?matchId=2079&theme=kkr' },
            writable: true,
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('sends the event with client info as a beacon, after the page is idle', async () => {
        track('overlay_start', { clubId: '1089463', matchId: '2079', theme: 'kkr' });
        expect(beacon).not.toHaveBeenCalled(); // deferred, never on the critical path
        flush();

        expect(beacon).toHaveBeenCalledTimes(1);
        expect(fetchMock).not.toHaveBeenCalled();
        const [url, blob] = beacon.mock.calls[0] as unknown as [string, FakeBlob];
        expect(url).toBe('/api/collect');
        expect(blob.type).toBe('application/json');
        const body = JSON.parse((blob as unknown as { parts: string[] }).parts[0]); // FakeBlob records its parts
        expect(body).toMatchObject({ event: 'overlay_start', clubId: '1089463', matchId: '2079', theme: 'kkr', client: 'browser' });
        expect(body.screen).toMatch(/^\d+x\d+$/);
    });

    it('falls back to a keepalive fetch when beacons are unavailable or refused', () => {
        beacon.mockReturnValueOnce(false);
        track('home_view');
        flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('/api/collect');
        expect(init.keepalive).toBe(true);

        Object.defineProperty(navigator, 'sendBeacon', { value: undefined, configurable: true, writable: true });
        track('home_view');
        flush();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('sends nothing in debug mode', () => {
        Object.defineProperty(window, 'location', { value: { hostname: 'score.abhinav.dev', search: '?debug=1' }, writable: true });
        track('overlay_start');
        flush();
        expect(beacon).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('trackOnce only sends the first time per page load', () => {
        trackOnce('overlay_start', { matchId: '1' });
        trackOnce('overlay_start', { matchId: '1' });
        trackOnce('home_view');
        flush();
        expect(beacon).toHaveBeenCalledTimes(2);
    });

    it('never throws when sending fails', () => {
        beacon.mockImplementationOnce(() => { throw new Error('boom'); });
        expect(() => { track('home_view'); flush(); }).not.toThrow();
    });
});

describe('session heartbeat', () => {
    const beacon = vi.fn(() => true);
    class FakeBlob { type: string; parts: string[]; constructor(parts: string[], opts?: { type?: string }) { this.parts = parts; this.type = opts?.type ?? ''; } }

    /** The bodies handed to the beacon so far. */
    const bodies = () => beacon.mock.calls.map(c => JSON.parse((c as unknown as [string, FakeBlob])[1].parts[0]));

    /**
     * Advance `n` ping intervals and let the send happen.
     *
     * ⚠ The tail matters. `track` defers to an idle callback, so a beacon queued by the
     * interval at exactly the end of the window has not been handed over yet — assertions
     * landing precisely on the boundary saw zero pings and looked like a broken timer.
     */
    const ticks = (n: number) => vi.advanceTimersByTime(n * PING_MS + 10);

    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('Blob', FakeBlob);
        Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true, writable: true });
        beacon.mockClear();
        resetTrackingForTests();
        Object.defineProperty(window, 'location', {
            value: { hostname: 'score.abhinav.dev', search: '?matchId=4670&theme=kkr' },
            writable: true,
        });
    });

    afterEach(() => {
        stopSessionPings();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('issues one 16-hex id per load and puts it on every event', () => {
        expect(sessionId()).toMatch(/^[0-9a-f]{16}$/);
        track('overlay_start', { matchId: '4670' });
        vi.advanceTimersByTime(1);
        expect(bodies()[0].sessionId).toBe(sessionId());
    });

    it('pings every five minutes, not sooner', () => {
        startSessionPings({ clubId: '1089463', matchId: '4670' });
        expect(PING_MS).toBe(300_000);

        vi.advanceTimersByTime(PING_MS - 10);
        expect(beacon).not.toHaveBeenCalled();          // nothing early

        vi.advanceTimersByTime(20);
        expect(beacon).toHaveBeenCalledTimes(1);
        expect(bodies()[0]).toMatchObject({ event: 'overlay_ping', clubId: '1089463', matchId: '4670', sessionId: sessionId() });

        ticks(3);
        expect(beacon).toHaveBeenCalledTimes(4);
        // 🛑 36 pings over a three-hour match. If this number ever climbs, re-do the arithmetic
        // in the PING_MS comment before shipping it.
        ticks(32);
        expect(beacon).toHaveBeenCalledTimes(36);
    });

    it('ignores repeat starts, so a poll loop calling it every 5 s cannot multiply the rate', () => {
        for (let i = 0; i < 50; i++) startSessionPings({ matchId: '4670' });
        ticks(1);
        expect(beacon).toHaveBeenCalledTimes(1);
    });

    it('starts no heartbeat where tracking is off', () => {
        for (const search of ['?debug=1', '?mode=replay', '?nostats', '?matchId=1&nostats=1']) {
            resetTrackingForTests();
            beacon.mockClear();
            Object.defineProperty(window, 'location', { value: { hostname: 'score.abhinav.dev', search }, writable: true });
            startSessionPings({ matchId: '4670' });
            ticks(3);
            expect(beacon, search).not.toHaveBeenCalled();
        }
    });

    it('stops on request', () => {
        startSessionPings({ matchId: '4670' });
        ticks(1);
        stopSessionPings();
        ticks(10);
        expect(beacon).toHaveBeenCalledTimes(1);
    });

    it('leaves no pagehide listener behind after a stop/start cycle', () => {
        // ⚠ `{ once: true }` is not enough: a listener that never fires is never dropped, so
        // five cycles used to mean five final pings on one pagehide.
        for (let i = 0; i < 5; i++) {
            startSessionPings({ matchId: '4670' });
            stopSessionPings();
        }
        startSessionPings({ matchId: '4670' });
        window.dispatchEvent(new Event('pagehide'));
        vi.advanceTimersByTime(10);
        expect(beacon).toHaveBeenCalledTimes(1);
    });

    it('marks the end on pagehide and stops pinging afterwards', () => {
        startSessionPings({ matchId: '4670' });
        ticks(1);
        expect(beacon).toHaveBeenCalledTimes(1);

        window.dispatchEvent(new Event('pagehide'));
        vi.advanceTimersByTime(10);
        expect(beacon).toHaveBeenCalledTimes(2);          // best-effort final mark
        expect(bodies()[1]).toMatchObject({ event: 'overlay_ping' });

        // ⚠ pagehide is a bonus, never the source of truth: an OBS scene teardown often does
        // not fire it. What matters here is that it never leaves the timer running.
        ticks(5);
        expect(beacon).toHaveBeenCalledTimes(2);
    });
});
