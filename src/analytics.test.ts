import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { detectClient, isTrackingEnabled, track, trackOnce, resetTrackingForTests } from './analytics';

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

    beforeEach(() => {
        vi.stubGlobal('fetch', fetchMock);
        fetchMock.mockClear();
        resetTrackingForTests();
        // jsdom defaults to localhost, which disables tracking; pretend we're in production.
        Object.defineProperty(window, 'location', {
            value: { hostname: 'score.abhinav.dev', search: '?matchId=2079&theme=kkr' },
            writable: true,
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('posts the event with client info to the collect endpoint', () => {
        track('overlay_start', { clubId: '1089463', matchId: '2079', theme: 'kkr' });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('/api/collect');
        expect(init.method).toBe('POST');
        expect(init.keepalive).toBe(true);
        const body = JSON.parse(init.body as string);
        expect(body).toMatchObject({ event: 'overlay_start', clubId: '1089463', matchId: '2079', theme: 'kkr', client: 'browser' });
        expect(body.screen).toMatch(/^\d+x\d+$/);
    });

    it('sends nothing in debug mode', () => {
        Object.defineProperty(window, 'location', { value: { hostname: 'score.abhinav.dev', search: '?debug=1' }, writable: true });
        track('overlay_start');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('trackOnce only sends the first time per page load', () => {
        trackOnce('overlay_start', { matchId: '1' });
        trackOnce('overlay_start', { matchId: '1' });
        trackOnce('home_view');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('never throws when fetch fails', () => {
        fetchMock.mockImplementationOnce(() => Promise.reject(new Error('offline')));
        expect(() => track('home_view')).not.toThrow();
    });
});
