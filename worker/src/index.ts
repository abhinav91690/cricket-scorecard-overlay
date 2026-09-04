import type { Env } from './env';
import { normalizeEvent, visitorHash, MAX_BODY_BYTES } from './collect';
import { extractAccessToken, verifyAccessJwt } from './access';
import { renderStats } from './stats';

export default {
    async fetch(request, env): Promise<Response> {
        const url = new URL(request.url);
        if (url.pathname === '/api/collect') return handleCollect(request, env);
        if (url.pathname === '/stats' || url.pathname.startsWith('/stats/')) return handleStats(request, env, url);
        return new Response('Not found', { status: 404 });
    },
} satisfies ExportedHandler<Env>;

async function handleCollect(request: Request<unknown, IncomingRequestCfProperties>, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
    }
    const length = Number(request.headers.get('content-length') ?? 0);
    if (length > MAX_BODY_BYTES) return new Response('Payload too large', { status: 413 });

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return new Response('Bad JSON', { status: 400 });
    }
    const event = normalizeEvent(body);
    if (!event) return new Response('Unrecognised event', { status: 400 });

    const now = new Date();
    const ts = now.toISOString();
    const day = ts.slice(0, 10);
    const ua = (request.headers.get('user-agent') ?? '').slice(0, 256);
    const ip = request.headers.get('cf-connecting-ip') ?? '';
    const visitor = await visitorHash(ip, ua, day, env.VISITOR_SALT ?? '');
    const cf = request.cf;

    try {
        await env.DB.prepare(`
            INSERT INTO events (ts, day, event, club_id, match_id, theme, logo, client, client_version, os, screen,
                                video_id, outcome, country, city, colo, visitor, ua, referer)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)`)
            .bind(ts, day, event.event, event.clubId, event.matchId, event.theme, event.logo, event.client,
                  event.clientVersion, event.os, event.screen, event.videoId, event.outcome,
                  cf?.country ?? null, cf?.city ?? null, cf?.colo ?? null, visitor, ua,
                  (request.headers.get('referer') ?? '').slice(0, 256) || null)
            .run();
    } catch (error) {
        console.error('D1 insert failed', error);
        return new Response('Storage error', { status: 500 });
    }
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

async function handleStats(request: Request, env: Env, url: URL): Promise<Response> {
    if (!(await isAuthorised(request, env, url))) {
        return new Response('Unauthorised', { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }
    const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || 30));
    const html = await renderStats(env, days);
    return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
    });
}

/**
 * Access-protected when ACCESS_* is configured; otherwise a shared key in ?key= is accepted so the
 * page is usable before Access is set up. With neither configured the page is closed.
 */
async function isAuthorised(request: Request, env: Env, url: URL): Promise<boolean> {
    if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
        const token = extractAccessToken(request);
        if (!token) return false;
        try {
            return await verifyAccessJwt(token, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD);
        } catch (error) {
            console.error('Access verification failed', error);
            return false;
        }
    }
    if (env.STATS_KEY) return url.searchParams.get('key') === env.STATS_KEY;
    return false;
}
