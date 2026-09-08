/**
 * Drives the real overlay through an entire simulated match in headless Chrome and grades it.
 *
 *   node sim/run.ts [--speed 60] [--theme topguns-dark] [--refresh 250] [--out sim/out]
 *
 * Needs the Vite dev server (started automatically if :5173 is not answering) and Google Chrome.
 * Output: sim/out/<timestamp>/report.md, events.json and PNGs of every phase and card.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { startServer, type SimEvent } from './server.ts';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const SPEED = Number(arg('speed', '60'));
const THEME = arg('theme', 'topguns-dark');
const REFRESH = Number(arg('refresh', '250'));
const OUT = `${arg('out', 'sim/out')}/${new Date().toISOString().replace(/[:.]/g, '-')}`;
const CHROME = arg('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const SIM_PORT = 8788, DEV = 'http://localhost:5173', CDP_PORT = 9333;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const reachable = async (url: string) => { try { const r = await fetch(url); return r.ok || r.status < 500; } catch { return false; } };

// ---------- minimal Chrome DevTools Protocol client ----------
class Cdp {
    private id = 0; private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
    private ws: WebSocket;
    private constructor(ws: WebSocket) {
        this.ws = ws;
        ws.onmessage = (m) => { const msg = JSON.parse(String(m.data)); if (msg.id && this.pending.has(msg.id)) { const p = this.pending.get(msg.id)!; this.pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); } };
    }
    static async connect(wsUrl: string) { const ws = new WebSocket(wsUrl); await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = (e) => rej(e); }); return new Cdp(ws); }
    send(method: string, params: Record<string, unknown> = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise<any>((resolve, reject) => this.pending.set(id, { resolve, reject })); }
    close() { this.ws.close(); }
}

async function main() {
    mkdirSync(OUT, { recursive: true });
    const sim = startServer({ port: SIM_PORT, speed: SPEED });
    const end = sim.timeline[sim.timeline.length - 1].t;
    console.log(`sim server ${sim.url}, match ends at sim ${end}s (~${Math.round(end / SPEED)}s real at x${SPEED})`);

    let vite: ChildProcess | null = null;
    if (!(await reachable(DEV))) {
        vite = spawn('npx', ['vite', '--port', '5173', '--strictPort'], { stdio: 'ignore' });
        for (let i = 0; i < 60 && !(await reachable(DEV)); i++) await sleep(500);
    }

    const profile = `${OUT}/chrome-profile`;
    const chrome = spawn(CHROME, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox', '--hide-scrollbars', '--window-size=1920,1080', 'about:blank'], { stdio: 'ignore' });
    for (let i = 0; i < 40 && !(await reachable(`http://localhost:${CDP_PORT}/json/version`)); i++) await sleep(250);
    const targets = await (await fetch(`http://localhost:${CDP_PORT}/json`)).json() as { type: string; webSocketDebuggerUrl: string }[];
    const page = targets.find(t => t.type === 'page')!;
    const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 142, g: 157, b: 144, a: 255 } });
    const url = `${DEV}/?matchId=sim&clubId=sim&theme=${THEME}&api=${encodeURIComponent(sim.url)}&refresh=${REFRESH}&e2e`;
    await cdp.send('Page.navigate', { url });
    console.log('overlay:', url);

    const shots: { name: string; sim: number }[] = [];
    const shoot = async (name: string) => {
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
        const file = `${String(shots.length + 1).padStart(2, '0')}-${name}.png`;
        writeFileSync(`${OUT}/${file}`, Buffer.from(data, 'base64'));
        shots.push({ name: file, sim: Math.round(sim.simNow()) });
    };

    // ---------- drive: screenshot each phase and the first cards of each type ----------
    let lastPhase = ''; let seenEvents = 0; const cardShots = new Map<string, number>(); let endedAt = 0;
    const deadline = Date.now() + (end / SPEED) * 1000 + 60_000;
    while (Date.now() < deadline) {
        const state = await (await fetch(`${sim.url}/sim/state`)).json() as { phase: string; sim: number };
        if (state.phase !== lastPhase) { lastPhase = state.phase; await sleep(1200); await shoot(`phase-${state.phase}`); console.log(`  phase ${state.phase} at sim ${state.sim}s`); if (state.phase === 'ended') endedAt = Date.now(); }
        const { events } = await (await fetch(`${sim.url}/sim/events`)).json() as { events: SimEvent[] };
        for (const e of events.slice(seenEvents)) {
            const d = e.detail as any;
            if (e.kind === 'page' && d?.kind === 'card:show') {
                const key = `${d.detail.surface}-${d.detail.type}`;
                const n = (cardShots.get(key) ?? 0) + 1; cardShots.set(key, n);
                if (n <= 2) { await sleep(400); await shoot(`card-${d.detail.type}${n > 1 ? `-${n}` : ''}`); }
            }
        }
        seenEvents = events.length;
        if (endedAt && Date.now() - endedAt > 20_000) break;
        await sleep(200);
    }

    const { events, pollCount } = await (await fetch(`${sim.url}/sim/events`)).json() as { events: SimEvent[]; pollCount: number };
    const timeline = await (await fetch(`${sim.url}/sim/timeline`)).json() as { t: number; phase: string; t1: number; w1: number; t2: number | null; w2: number | null }[];
    writeFileSync(`${OUT}/events.json`, JSON.stringify({ events, timeline, shots }, null, 1));

    // ---------- grade ----------
    const page_ = (k: string) => events.filter(e => e.kind === 'page' && (e.detail as any).kind === k).map(e => ({ sim: e.sim, ...(e.detail as any).detail as any, t: (e.detail as any).t as number, seq: (e.detail as any).seq as number }));
    // The page numbers its log entries; a gap means a POST never reached us, not that the overlay skipped a step.
    const seqs = new Set(events.filter(e => e.kind === 'page').map(e => (e.detail as any).seq as number).filter(n => Number.isFinite(n)));
    const lost = seqs.size ? Math.max(...seqs) + 1 - seqs.size : 0;
    const logGap = (a: number, b: number) => { for (let i = a + 1; i < b; i++) if (!seqs.has(i)) return true; return false; };
    const frames = page_('frame'), shows = page_('card:show'), hides = page_('card:hide'), dismissals = page_('card:dismiss'), switches = page_('switch');
    const phaseAt = (simT: number) => { let p = 'pre'; for (const s of timeline) { if (s.t <= simT) p = s.phase; else break; } return p; };
    const checks: { name: string; pass: boolean; detail: string }[] = [];
    const check = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });

    const sw = switches.map(s => `${phaseAt(s.sim)}:${s.from}>${s.to}`);
    // returning to view 1 is always allowed; only outgoing peeks must avoid play
    check('Peeks only while idle: none requested during play', !switches.some(s => s.to !== 1 && ['inn1', 'inn2'].includes(phaseAt(s.sim))), sw.join(' '));
    check('Pre-match peeks: squads (48, 49) each followed by a return to view 1', /pre:1>48 pre:48>1 pre:1>49 pre:49>1/.test(sw.join(' ')), sw.filter(x => x.startsWith('pre')).join(' '));
    check('Break peeks team 1 cards (2, 3); end peeks team 2 cards (4, 5); each comes home', ['break:1>2', 'break:2>1', 'break:1>3', 'break:3>1', 'ended:1>4', 'ended:4>1', 'ended:1>5', 'ended:5>1'].every(x => sw.includes(x)), sw.filter(x => !x.startsWith('pre')).join(' '));
    const outgoing = switches.filter(s => s.to !== 1).map(s => `${phaseAt(s.sim)}:${s.to}`);
    check('No repeated peeks: each data view requested once per phase', new Set(outgoing).size === outgoing.length, outgoing.join(' '));
    const peekRuns = frames.reduce((acc, f, i) => (!f.full && !(frames[i - 1] && !frames[i - 1].full) ? acc + 1 : acc), 0);
    const longPeeks = frames.reduce((acc, f, i) => (!f.full && frames[i - 1] && !frames[i - 1].full && frames[i - 2] && !frames[i - 2].full ? acc + 1 : acc), 0);
    check('Bar never stale: no run of more than two non-live frames', longPeeks === 0, `${frames.length} frames, ${peekRuns} peeks, ${longPeeks} long runs`);

    const wickets = (timeline.at(-1)!.w1 ?? 0) + (timeline.at(-1)!.w2 ?? 0);
    const wicketShows = shows.filter(s => s.type === 'wicket').length;
    check('Every wicket produced a wicket card', wicketShows === wickets, `${wicketShows} cards for ${wickets} wickets`);
    check('Boundary flashes appeared', shows.some(s => s.type === 'boundary'), `${shows.filter(s => s.type === 'boundary').length} flashes`);
    check('Line-up panel shown before the first ball', shows.some(s => s.type === 'lineup' && phaseAt(s.sim) === 'pre'), '');
    check('Innings summary shown at the break', shows.some(s => s.type === 'innings-summary' && phaseAt(s.sim) === 'break'), '');
    check('Match summary shown after the result', shows.some(s => s.type === 'match-summary' && phaseAt(s.sim) === 'ended'), '');
    check('No panel during play', !shows.some(s => s.surface === 'panel' && ['inn1', 'inn2'].includes(phaseAt(s.sim))), '');

    const firstShow = (type: string) => shows.find(s => s.type === type);
    const lastPeekFrame = (view: number, before: number) => frames.filter(f => f.view === view && !f.full && f.t < before).at(-1);
    check('Line-up waited for both squad peeks', !!firstShow('lineup') && !!lastPeekFrame(48, firstShow('lineup')!.t) && !!lastPeekFrame(49, firstShow('lineup')!.t), '');
    check('Innings summary waited for both first-innings card peeks', !!firstShow('innings-summary') && !!lastPeekFrame(2, firstShow('innings-summary')!.t) && !!lastPeekFrame(3, firstShow('innings-summary')!.t), '');
    const endedShow = shows.find(s => s.type === 'match-summary' && phaseAt(s.sim) === 'ended');
    const endedPeek = frames.find(f => f.view === 5 && !f.full && phaseAt(f.sim) === 'ended');
    check('Match summary waited for the end-of-match peek', !!endedShow && !!endedPeek && endedPeek.t < endedShow.t, '');
    // every card left the screen within hold + 2 polls (naturally or dismissed)
    const overstays: string[] = [], inconclusive: string[] = [];
    for (const s of shows) {
        const gone = [...hides, ...dismissals].filter(h => h.surface === s.surface && h.t > s.t).sort((a, b) => a.t - b.t)[0];
        if (!gone) { if (Date.now() - s.t > s.hold + 2 * REFRESH + 1000) overstays.push(`${s.type} never hidden`); continue; }
        if (gone.t - s.t > s.hold + 2 * REFRESH + 500) {
            if (logGap(s.seq, gone.seq)) inconclusive.push(`${s.type} at sim ${s.sim}s: a log entry between show and hide was lost`);
            else overstays.push(`${s.type} stayed ${gone.t - s.t}ms (hold ${s.hold})`);
        }
    }
    check('Every card is timed: none outstayed its hold', overstays.length === 0, [...overstays, ...inconclusive].slice(0, 5).join('; '));
    check('Every page log entry reached the harness', lost === 0, lost ? `${lost} of ${seqs.size + lost} lost` : `${seqs.size} entries`);
    // every dismissal was caused by a score change on the poll right before it
    const scoreOf = (f: any) => f.score;
    const badDismiss = dismissals.filter(d => { const before = frames.filter(f => f.t <= d.t).slice(-2); return !(before.length === 2 && (scoreOf(before[0]) !== scoreOf(before[1]) || before[0].balls !== before[1].balls)); });
    check('Every dismissal followed a score change', badDismiss.length === 0, `${dismissals.length} dismissals, ${badDismiss.length} unexplained`);

    const report = [`# Simulated match run`, ``, `- theme: ${THEME}, speed x${SPEED}, poll ${REFRESH}ms, ${pollCount} polls, ${frames.length} frames logged`, `- result: ${timeline.at(-1) ? `${timeline.at(-1)!.t1}/${timeline.at(-1)!.w1} v ${timeline.at(-1)!.t2}/${timeline.at(-1)!.w2}` : ''}`, `- cards shown: ${[...cardShots].map(([k, v]) => `${k}×${v}`).join(', ')}`, `- view switches: ${sw.join(' ')}`, ``, `| check | result | detail |`, `|---|---|---|`,
        ...checks.map(c => `| ${c.name} | ${c.pass ? 'PASS' : 'FAIL'} | ${c.detail} |`), ``, `## Screenshots`, ...shots.map(s => `- ${s.name} (sim ${s.sim}s)`)].join('\n');
    writeFileSync(`${OUT}/report.md`, report);
    console.log(report);

    cdp.close(); chrome.kill(); vite?.kill(); sim.server.close();
    process.exit(checks.every(c => c.pass) ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(2); });
