import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./access', () => ({ extractAccessToken: vi.fn(), verifyAccessJwt: vi.fn() }));
vi.mock('./stats', () => ({ renderStats: vi.fn(async (_env, days: number) => `<html>days=${days}</html>`) }));

import worker from './index';
import { extractAccessToken, verifyAccessJwt } from './access';
import { renderStats } from './stats';
import type { Env } from './env';

const run = vi.fn(async () => ({ success: true }));
const bind = vi.fn((..._args: unknown[]) => ({ run }));
const prepare = vi.fn((_sql: string) => ({ bind }));

function env(overrides: Partial<Env> = {}): Env {
    return { DB: { prepare } as unknown as D1Database, ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '', ...overrides };
}

function request(path: string, init: RequestInit = {}, cf: Record<string, unknown> = { country: 'US', city: 'Austin', colo: 'DFW' }) {
    const req = new Request(`https://score.abhinav.dev${path}`, init);
    return Object.assign(req, { cf }) as unknown as Request<unknown, IncomingRequestCfProperties>;
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
    request('/api/collect', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json', 'user-agent': 'UA/1 OBS/30.2', 'cf-connecting-ip': '203.0.113.9', referer: 'https://score.abhinav.dev/?matchId=1', ...headers } });

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('routing', () => {
    it('404s anything outside the two routes', async () => {
        expect((await worker.fetch(request('/'), env())).status).toBe(404);
        expect((await worker.fetch(request('/api/other'), env())).status).toBe(404);
    });
});

describe('POST /api/collect', () => {
    it('rejects non-POST with 405 and an Allow header', async () => {
        const res = await worker.fetch(request('/api/collect'), env());
        expect(res.status).toBe(405);
        expect(res.headers.get('Allow')).toBe('POST');
    });

    it('rejects oversized bodies by content-length before reading them', async () => {
        const res = await worker.fetch(post({ event: 'home_view' }, { 'content-length': '999999' }), env());
        expect(res.status).toBe(413);
        expect(prepare).not.toHaveBeenCalled();
    });

    it('rejects bad JSON and unknown events with 400', async () => {
        expect((await worker.fetch(post('{nope'), env())).status).toBe(400);
        expect((await worker.fetch(post({ event: 'overlay_heartbeat' }), env())).status).toBe(400);
        expect(prepare).not.toHaveBeenCalled();
    });

    it('stores a valid event with request metadata and a hashed visitor, returning 204', async () => {
        const res = await worker.fetch(post({ event: 'overlay_start', clubId: '1089463', matchId: '2079', theme: 'kkr', client: 'obs', clientVersion: '30.2', os: 'windows', screen: '1920x1080' }), env({ VISITOR_SALT: 's' }));
        expect(res.status).toBe(204);
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        expect(prepare).toHaveBeenCalledTimes(1);
        expect(prepare.mock.calls[0][0]).toMatch(/INSERT INTO events/);

        const args = bind.mock.calls[0] as unknown[];
        expect(args).toHaveLength(19);
        const [ts, day, event, clubId, matchId, theme, logo, client, clientVersion, os, screen, videoId, outcome, country, city, colo, visitor, ua, referer] = args;
        expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(day).toBe((ts as string).slice(0, 10));
        expect([event, clubId, matchId, theme, logo, client, clientVersion, os, screen, videoId, outcome]).toEqual(['overlay_start', '1089463', '2079', 'kkr', null, 'obs', '30.2', 'windows', '1920x1080', null, null]);
        expect([country, city, colo]).toEqual(['US', 'Austin', 'DFW']);
        expect(visitor).toMatch(/^[0-9a-f]{16}$/);
        expect(ua).toBe('UA/1 OBS/30.2');
        expect(referer).toBe('https://score.abhinav.dev/?matchId=1');
        expect(run).toHaveBeenCalled();
    });

    it('copes with missing cf metadata, referer and salt', async () => {
        const req = request('/api/collect', { method: 'POST', body: JSON.stringify({ event: 'home_view' }) }, null as unknown as Record<string, unknown>);
        const res = await worker.fetch(req, env());
        expect(res.status).toBe(204);
        const args = bind.mock.calls[0] as unknown[];
        expect(args.slice(13, 16)).toEqual([null, null, null]);
        expect(args[18]).toBeNull();
    });

    it('returns 500 when the insert fails, without leaking the error', async () => {
        run.mockRejectedValueOnce(new Error('D1_ERROR: locked'));
        const res = await worker.fetch(post({ event: 'home_view' }), env());
        expect(res.status).toBe(500);
        expect(await res.text()).toBe('Storage error');
    });
});

describe('GET /stats authorisation', () => {
    it('is closed when neither Access nor a key is configured', async () => {
        const res = await worker.fetch(request('/stats?key=anything'), env());
        expect(res.status).toBe(401);
        expect(renderStats).not.toHaveBeenCalled();
    });

    it('accepts the shared key and rejects a wrong or missing one', async () => {
        const e = env({ STATS_KEY: 'secret' });
        expect((await worker.fetch(request('/stats'), e)).status).toBe(401);
        expect((await worker.fetch(request('/stats?key=wrong'), e)).status).toBe(401);
        const ok = await worker.fetch(request('/stats?key=secret'), e);
        expect(ok.status).toBe(200);
        expect(ok.headers.get('Content-Type')).toContain('text/html');
        expect(ok.headers.get('X-Robots-Tag')).toBe('noindex');
        expect(ok.headers.get('Cache-Control')).toBe('no-store');
    });

    it('uses Access when configured and ignores the key', async () => {
        const e = env({ STATS_KEY: 'secret', ACCESS_TEAM_DOMAIN: 't.cloudflareaccess.com', ACCESS_AUD: 'aud' });
        vi.mocked(extractAccessToken).mockReturnValue(null);
        expect((await worker.fetch(request('/stats?key=secret'), e)).status).toBe(401);

        vi.mocked(extractAccessToken).mockReturnValue('jwt');
        vi.mocked(verifyAccessJwt).mockResolvedValueOnce(false);
        expect((await worker.fetch(request('/stats'), e)).status).toBe(401);

        vi.mocked(verifyAccessJwt).mockResolvedValueOnce(true);
        expect((await worker.fetch(request('/stats'), e)).status).toBe(200);
        expect(verifyAccessJwt).toHaveBeenCalledWith('jwt', 't.cloudflareaccess.com', 'aud');

        vi.mocked(verifyAccessJwt).mockRejectedValueOnce(new Error('jwks down'));
        expect((await worker.fetch(request('/stats'), e)).status).toBe(401);
    });

    it('clamps the days parameter to 1..365, defaulting to 30 for missing, zero or non-numeric', async () => {
        const e = env({ STATS_KEY: 'k' });
        for (const [query, days] of [['', 30], ['&days=7', 7], ['&days=0', 30], ['&days=-5', 1], ['&days=9999', 365], ['&days=abc', 30]] as const) {
            vi.mocked(renderStats).mockClear();
            await worker.fetch(request(`/stats?key=k${query}`), e);
            expect(renderStats).toHaveBeenCalledWith(e, days);
        }
        expect((await worker.fetch(request('/stats/anything?key=k'), e)).status).toBe(200);
    });
});
