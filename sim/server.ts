/**
 * Fake CricClubs for end-to-end runs. Serves the simulated match through the real endpoint
 * shapes (liveScoreOverlayData.do, matchOverlayConfig.do) with a controllable clock, and
 * records everything the overlay does with it.
 *
 *   node sim/server.ts --port 8788 --speed 60
 *
 * Control:  GET /sim/state   GET /sim/events   GET /sim/control?speed=&pause=1|0&seek=<simSec>
 *           POST /sim/event  (the overlay's e2e timeline, when loaded with ?e2e)
 */
import http from 'node:http';
import { buildTimeline, render, snapshotAt, DEFAULT_CONFIG, type SimConfig, type Snapshot } from './match.ts';

export interface ServerOptions { port: number; speed: number; config?: Partial<SimConfig>; }

export interface SimEvent { wall: number; sim: number; kind: string; detail: unknown; }

export function startServer(opts: ServerOptions) {
    const cfg: SimConfig = { ...DEFAULT_CONFIG, ...(opts.config ?? {}) };
    const timeline = buildTimeline(cfg);
    let speed = opts.speed;
    let startWall = Date.now();
    let offset = 0;           // sim seconds already elapsed when the clock was last (re)started
    let paused = false;
    let view = 1;
    const events: SimEvent[] = [];
    const polls: { sim: number; view: number }[] = [];

    const simNow = () => (paused ? offset : offset + ((Date.now() - startWall) / 1000) * speed);
    const log = (kind: string, detail: unknown) => events.push({ wall: Date.now(), sim: Math.round(simNow()), kind, detail });

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://x');
        const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => {
            res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'cache-control': 'no-store', ...extra });
            res.end(JSON.stringify(body));
        };
        if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST' }); return res.end(); }

        if (url.pathname === '/liveScoreOverlayData.do') {
            const s = snapshotAt(timeline, simNow());
            polls.push({ sim: Math.round(simNow()), view });
            return json(render(s, view, cfg));
        }
        if (url.pathname === '/matchOverlayConfig.do') {
            const requested = Number(url.searchParams.get('viewId'));
            if (Number.isFinite(requested) && requested > 0) { view = requested; log('view', { view }); }
            res.writeHead(200, { 'content-type': 'text/html;charset=ISO-8859-1', 'access-control-allow-origin': '*' });
            return res.end('success');
        }
        if (url.pathname === '/sim/state') {
            const s = snapshotAt(timeline, simNow());
            return json({ sim: Math.round(simNow()), speed, paused, view, phase: s.phase, t1: `${s.inn1.total}/${s.inn1.wickets} (${Math.floor(s.inn1.legalBalls / 6)}.${s.inn1.legalBalls % 6})`, t2: s.inn2 ? `${s.inn2.total}/${s.inn2.wickets} (${Math.floor(s.inn2.legalBalls / 6)}.${s.inn2.legalBalls % 6})` : null, result: s.result, end: timeline[timeline.length - 1].t, snapshots: timeline.length });
        }
        if (url.pathname === '/sim/events') return json({ events, polls: polls.slice(-50), pollCount: polls.length });
        if (url.pathname === '/sim/timeline') return json(timeline.map(s => ({ t: s.t, phase: s.phase, t1: s.inn1.total, w1: s.inn1.wickets, t2: s.inn2?.total ?? null, w2: s.inn2?.wickets ?? null })));
        if (url.pathname === '/sim/control') {
            const now = simNow();
            if (url.searchParams.has('speed')) { offset = now; startWall = Date.now(); speed = Number(url.searchParams.get('speed')) || speed; }
            if (url.searchParams.get('pause') === '1') { offset = now; paused = true; }
            if (url.searchParams.get('pause') === '0') { startWall = Date.now(); paused = false; }
            if (url.searchParams.has('seek')) { offset = Number(url.searchParams.get('seek')) || 0; startWall = Date.now(); }
            if (url.searchParams.has('view')) { view = Number(url.searchParams.get('view')) || 1; }
            log('control', Object.fromEntries(url.searchParams));
            return json({ ok: true, sim: Math.round(simNow()), speed, paused, view });
        }
        if (url.pathname === '/sim/event' && req.method === 'POST') {
            let body = '';
            for await (const chunk of req) body += chunk;
            try { log('page', JSON.parse(body)); } catch { log('page', body); }
            return json({ ok: true }, 204);
        }
        json({ error: 'not found' }, 404);
    });
    server.listen(opts.port);
    return { server, timeline, cfg, url: `http://localhost:${opts.port}`, events, simNow: () => simNow() };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
    const s = startServer({ port: Number(arg('port', '8788')), speed: Number(arg('speed', '60')) });
    const last = s.timeline[s.timeline.length - 1];
    console.log(`sim CricClubs on ${s.url}  speed x${arg('speed', '60')}  match ends at sim ${last.t}s (${Math.round(last.t / Number(arg('speed', '60')))}s real)  snapshots ${s.timeline.length}`);
}
