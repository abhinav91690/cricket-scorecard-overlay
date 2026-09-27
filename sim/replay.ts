/**
 * Replays a recorded match (sim/record.ts) through the real overlay and grades it against what
 * the recording itself says happened. The simulator tests what we believe CricClubs does; this
 * tests what it actually did.
 *
 *   node sim/replay.ts sim/recordings/4651-2026-09-27.jsonl [--speed 10] [--from <minutes into the recording>]
 *
 * Serves the recording through the CricClubs endpoints, honouring the overlay's view switches:
 * a peek is answered with the data view the recording overlay received at about that moment.
 * Needs the Vite dev server (started if :5173 is not answering) and Google Chrome.
 * Output: sim/out/replay-<match>-<timestamp>/report.md and events.json.
 */
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const FILE = process.argv[2];
const SPEED = Number(arg('speed', '10'));
const FROM_MIN = Number(arg('from', '0'));
const PORT = 8789, CDP_PORT = 9335, DEV = 'http://localhost:5173';
const CHROME = arg('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
if (!FILE) { console.error('usage: node sim/replay.ts <recording.jsonl> [--speed 10]'); process.exit(1); }
const MATCH = FILE.replace(/^.*\//, '').replace(/\.jsonl$/, '');
const OUT = `sim/out/replay-${MATCH}-${new Date().toISOString().replace(/[:.]/g, '-')}`;

type V = Record<string, any>;
interface Row { t: number; kind: 'frame' | 'switch' | 'error'; view?: number; data?: { view?: number; values?: V; balls?: string[] } & V; text?: string; }
const rows: Row[] = readFileSync(FILE, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const frames = rows.filter(r => r.kind === 'frame');
const t0 = frames[0].t + FROM_MIN * 60_000;
const tEnd = frames[frames.length - 1].t;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const reachable = async (url: string) => { try { const r = await fetch(url); return r.ok || r.status < 500; } catch { return false; } };

// ---------- the recording as a fake CricClubs ----------
let view = 1;
const startWall = Date.now();
const recNow = () => t0 + (Date.now() - startWall) * SPEED;
const events: { wall: number; rec: number; kind: string; detail: unknown }[] = [];
const latest = (pred: (r: Row) => boolean, at: number) => { let hit: Row | undefined; for (const r of frames) { if (r.t > at) break; if (pred(r)) hit = r; } return hit; };
function frameFor(v: number, at: number): Row {
    const full = latest(r => r.view === 1, at) ?? frames.find(r => r.view === 1)!;
    if (v === 1) return full;
    // a peek: the data view the recording overlay got nearest to now, else nothing new (the overlay gives up)
    const views = frames.filter(r => r.view === v);
    if (!views.length) return full;
    return views.reduce((best, r) => Math.abs(r.t - at) < Math.abs(best.t - at) ? r : best);
}
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const json = (body: unknown, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST' }); return res.end(); }
    if (url.pathname === '/liveScoreOverlayData.do') return json(frameFor(view, recNow()).data);
    if (url.pathname === '/matchOverlayConfig.do') {
        const v = Number(url.searchParams.get('viewId'));
        if (v > 0) { view = v; events.push({ wall: Date.now(), rec: recNow(), kind: 'view', detail: { view } }); }
        res.writeHead(200, { 'content-type': 'text/html', 'access-control-allow-origin': '*' }); return res.end('success');
    }
    if (url.pathname === '/sim/event' && req.method === 'POST') {
        let body = ''; for await (const c of req) body += c;
        try { events.push({ wall: Date.now(), rec: recNow(), kind: 'page', detail: JSON.parse(body) }); } catch { /* ignore */ }
        return json({ ok: true }, 204);
    }
    json({ error: 'not found' }, 404);
});

// ---------- what the recording says should have gone on air ----------
function expectations() {
    const exp: { t: number; type: string; about: string }[] = [];
    let maxW = [0, 0, 0], prevOut = '', bat = new Map<string, number>(), bowl = new Map<string, number>();
    let breakSeen = false, preSeen = false, endSeen = false, inns = 1, first = true;
    for (const r of frames.filter(r => r.view === 1 && r.data?.values && 'batsman1Name' in r.data.values)) {
        const v = r.data!.values!, balls = r.data!.balls ?? [];
        const chase = String(v.isSecondInningsStarted) === 'true';
        const ended = String(v.isMatchEnded) === '1';
        if (String(v.isSuperOver) === 'true') continue;               // super overs: graded by the simulator
        if ((chase ? 2 : 1) !== inns) { inns = chase ? 2 : 1; bat = new Map(); bowl = new Map(); }
        const w = Number(chase ? v.t2Wickets : v.t1Wickets) || 0;
        const out = String(v.lastOutName ?? '');
        // The first frame is where the overlay starts, not an event; nothing is carded once the match is over.
        if (first) { first = false; maxW[inns] = w; prevOut = out; }
        else if (!ended && (w > maxW[inns] || (w === maxW[inns] && w > 0 && out && out !== prevOut))) exp.push({ t: r.t, type: 'wicket', about: `${w} ${out}` });
        if (w >= maxW[inns]) { maxW[inns] = w; prevOut = out; }
        for (const i of [1, 2]) {
            const id = String(v[`batsman${i}ID`] ?? ''), runs = Number(v[`batsman${i}Runs`]) || 0;
            if (!id) continue;
            const was = bat.get(id);
            for (const mark of [50, 100]) if (!ended && was !== undefined && was < mark && runs >= mark) exp.push({ t: r.t, type: 'milestone', about: `${mark} ${v[`batsman${i}Name`]}` });
            bat.set(id, runs);
        }
        const bid = String(v.bowlerID ?? v.bowlerName ?? ''), bw = Number(v.bowlerWickets) || 0;
        if (bid) { const was = bowl.get(bid); if (!ended && was !== undefined && was < 5 && bw >= 5) exp.push({ t: r.t, type: 'haul', about: `5 ${v.bowlerName}` }); bowl.set(bid, bw); }
        const total = Number(v.totalOvers) || 0, ov1 = parseFloat(String(v.t1Overs ?? '0')) || 0;
        const pre = !chase && !ov1 && !balls.length;
        if (pre && !preSeen) { preSeen = true; exp.push({ t: r.t, type: 'lineup', about: 'before the first ball' }); }
        const complete = !chase && (Number(v.t1Wickets) >= 10 || (total > 0 && ov1 >= total));
        if ((complete || (chase && !parseFloat(String(v.t2Overs ?? '0')) && !balls.length)) && !breakSeen && String(v.isMatchEnded) !== '1') { breakSeen = true; exp.push({ t: r.t, type: 'innings-summary', about: 'the break' }); }
        if (String(v.isMatchEnded) === '1' && !endSeen) { endSeen = true; exp.push({ t: r.t, type: 'match-summary', about: String(v.result ?? '') }); }
    }
    return exp;
}

class Cdp {
    private id = 0; private pending = new Map<number, (v: any) => void>(); private ws: WebSocket;
    private constructor(ws: WebSocket) { this.ws = ws; ws.onmessage = (m) => { const msg = JSON.parse(String(m.data)); if (msg.id && this.pending.has(msg.id)) { this.pending.get(msg.id)!(msg.result); this.pending.delete(msg.id); } }; }
    static async connect(url: string) { const ws = new WebSocket(url); await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = rej; }); return new Cdp(ws); }
    send(method: string, params: Record<string, unknown> = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise<any>(r => this.pending.set(id, r)); }
    close() { this.ws.close(); }
}

async function main() {
    mkdirSync(OUT, { recursive: true });
    server.listen(PORT);
    let vite: ChildProcess | null = null;
    if (!(await reachable(DEV))) { vite = spawn('npx', ['vite', '--port', '5173', '--strictPort'], { stdio: 'ignore' }); for (let i = 0; i < 60 && !(await reachable(DEV)); i++) await sleep(500); }
    const chrome = spawn(CHROME, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${OUT}/chrome-profile`, '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--window-size=1920,1080', 'about:blank'], { stdio: 'ignore' });
    const cleanup = () => { chrome.kill(); vite?.kill(); server.close(); };
    process.on('SIGINT', () => { cleanup(); process.exit(130); });
    try {
        for (let i = 0; i < 40 && !(await reachable(`http://localhost:${CDP_PORT}/json/version`)); i++) await sleep(250);
        const page = (await (await fetch(`http://localhost:${CDP_PORT}/json`)).json() as any[]).find(t => t.type === 'page');
        const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
        const refresh = Math.max(100, Math.round(5000 / SPEED));
        const url = `${DEV}/?matchId=rec&clubId=rec&api=${encodeURIComponent(`http://localhost:${PORT}`)}&refresh=${refresh}&e2e&data=1`;
        await cdp.send('Page.navigate', { url });
        const realMs = (tEnd - t0) / SPEED + 20_000;
        console.log(`replaying ${MATCH}: ${frames.length} frames, ${Math.round((tEnd - t0) / 60000)} min of match in ${Math.round(realMs / 1000)} s at x${SPEED}`);
        await sleep(realMs);
        cdp.close();
    } finally { cleanup(); }

    // ---------- grade ----------
    const page = events.filter(e => e.kind === 'page').map(e => ({ rec: e.rec, ...(e.detail as any) }));
    const queued = page.filter(e => e.kind === 'card:queue').map(e => ({ rec: e.rec, type: e.detail.type, mark: e.detail.mark }));
    const errors = rows.filter(r => r.kind === 'error');
    const exp = expectations();
    const lines: string[] = [];
    const check = (name: string, pass: boolean, detail: string) => lines.push(`| ${name} | ${pass ? 'PASS' : 'FAIL'} | ${detail} |`);
    const qtype = (e: { type: string; mark?: number }) => e.type === 'milestone' && e.mark === 5 ? 'haul' : e.type;
    for (const type of ['wicket', 'milestone', 'haul', 'lineup', 'innings-summary', 'match-summary']) {
        const want = exp.filter(e => e.type === type), got = queued.filter(q => qtype(q) === type);
        check(`${type}: one card per event in the recording`, got.length === want.length, `${got.length} queued for ${want.length} — ${want.map(w => w.about).join('; ').slice(0, 300)}`);
    }
    const shows = page.filter(e => e.kind === 'card:show');
    check('No page errors while recording', errors.length === 0, errors.map(e => e.text).join('; ').slice(0, 200) || 'none');
    const report = [`# Replay of ${MATCH}`, '', `- ${frames.length} recorded frames, x${SPEED}, ${queued.length} cards queued, ${shows.length} shown`, '', '| check | result | detail |', '|---|---|---|', ...lines].join('\n');
    writeFileSync(`${OUT}/report.md`, report);
    writeFileSync(`${OUT}/events.json`, JSON.stringify({ expectations: exp, events }, null, 1));
    console.log(report);
    process.exit(lines.some(l => l.includes('| FAIL |')) ? 1 : 0);
}
main();
