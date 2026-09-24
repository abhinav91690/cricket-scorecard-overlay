import { describe, it, expect, afterEach, vi } from 'vitest';
import { apiBase, refreshMs, e2eLog, isLocalhost } from './e2e';
import { CONFIG } from './config';

function at(hostname: string, search: string) {
    Object.defineProperty(window, 'location', { value: { hostname, search }, writable: true });
}

describe('e2e hooks', () => {
    afterEach(() => { vi.unstubAllGlobals(); delete window.__overlayLog; });

    it('are inert off localhost', () => {
        at('score.abhinav.dev', '?api=http://evil.example&refresh=100&e2e');
        expect(isLocalhost()).toBe(false);
        expect(apiBase()).toBe(CONFIG.API_BASE);
        expect(refreshMs()).toBe(CONFIG.REFRESH_RATE);
        e2eLog('frame', {});
        expect(window.__overlayLog).toBeUndefined();
    });

    it('honour api and refresh overrides on localhost', () => {
        at('localhost', '?api=http://localhost:8788/&refresh=250');
        expect(apiBase()).toBe('http://localhost:8788');
        expect(refreshMs()).toBe(250);
        at('localhost', '?refresh=10');
        expect(refreshMs()).toBe(CONFIG.REFRESH_RATE); // below the floor
    });

    it('records a timeline and posts it to the sim server when asked', () => {
        const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
        vi.stubGlobal('fetch', fetchMock);
        at('localhost', '?e2e&api=http://localhost:8788');
        e2eLog('card:show', { type: 'wicket' });
        expect(window.__overlayLog).toHaveLength(1);
        expect(window.__overlayLog![0]).toMatchObject({ kind: 'card:show', detail: { type: 'wicket' } });
        expect(fetchMock).toHaveBeenCalledWith('http://localhost:8788/sim/event', expect.objectContaining({ method: 'POST' }));
    });

    it('does nothing without ?e2e even on localhost', () => {
        at('localhost', '?api=http://localhost:8788');
        e2eLog('frame', {});
        expect(window.__overlayLog).toBeUndefined();
    });
});
