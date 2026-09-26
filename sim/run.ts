/**
 * Drives the real overlay through an entire simulated match in headless Chrome and grades it.
 *
 *   node sim/run.ts [--speed 60] [--theme topguns-dark] [--refresh 250] [--out sim/out] [--super-over] [--seed 7]
 *
 * Needs the Vite dev server (started automatically if :5173 is not answering) and Google Chrome.
 * Output: sim/out/<timestamp>/report.md, events.json and PNGs of every phase and card.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { startServer, type SimEvent } from './server.ts';
import { SUPER_OVER_PHASES, bowlerCap, teamNames, type Phase } from './match.ts';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const SPEED = Number(arg('speed', '60'));
const THEME = arg('theme', 'topguns-dark');
const REFRESH = Number(arg('refresh', '250'));
const OUT = `${arg('out', 'sim/out')}/${new Date().toISOString().replace(/[:.]/g, '-')}`;
const CHROME = arg('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const SIM_PORT = 8788, DEV = 'http://localhost:5173', CDP_PORT = 9333;
const SUPER_OVER = process.argv.includes('--super-over');
const SEED = Number(arg('seed', '7'));

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
    const sim = startServer({ port: SIM_PORT, speed: SPEED, config: { superOver: SUPER_OVER, seed: SEED } });
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
    const evaluate = async (expression: string) => (await cdp.send('Runtime.evaluate', { expression, returnByValue: true })).result?.value;
    // What the bar says is batting, sampled through each super-over innings once it has settled.
    const barSamples: { phase: string; team: string; overs: string }[] = [];
    // What the result card said when it went on air.
    const resultCards: { headline: string; teams: string[]; runs: string[] }[] = [];
    let phaseSince = Date.now();
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
        if (state.phase !== lastPhase) { lastPhase = state.phase; phaseSince = Date.now(); await sleep(1200); await shoot(`phase-${state.phase}`); console.log(`  phase ${state.phase} at sim ${state.sim}s`); if (state.phase === 'ended') endedAt = Date.now(); }
        if ((state.phase === 'so1' || state.phase === 'so2') && Date.now() - phaseSince > 1500) {
            barSamples.push({ phase: state.phase,
                team: String(await evaluate(`document.getElementById('team-name')?.textContent ?? ''`)).trim(),
                overs: String(await evaluate(`document.getElementById('team-overs')?.textContent ?? ''`)).trim() });
        }
        const { events } = await (await fetch(`${sim.url}/sim/events`)).json() as { events: SimEvent[] };
        for (const e of events.slice(seenEvents)) {
            const d = e.detail as any;
            if (e.kind === 'page' && d?.kind === 'card:show') {
                const key = `${d.detail.surface}-${d.detail.type}`;
                const n = (cardShots.get(key) ?? 0) + 1; cardShots.set(key, n);
                if (n <= 2) { await sleep(400); await shoot(`card-${d.detail.type}${n > 1 ? `-${n}` : ''}`); }
                if (d.detail.type === 'match-summary') resultCards.push(await evaluate(`({
                    headline: document.getElementById('panel-headline')?.textContent ?? '',
                    teams: [...document.querySelectorAll('.result-card .panel-team-name')].map(e => e.textContent),
                    runs: [...document.querySelectorAll('.result-card .panel-score-runs')].map(e => e.textContent) })`));
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
    // The ball that ends the first innings starts the break: the overlay treats a complete innings as one.
    const phaseAt = (simT: number) => { let p = 'pre'; for (const s of sim.timeline) { if (s.t <= simT) p = s.phase === 'inn1' && s.inn1.complete ? 'break' : s.phase; else break; } return p; };
    const checks: { name: string; pass: boolean; detail: string }[] = [];
    const check = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });

    const sw = switches.map(s => `${phaseAt(s.sim)}:${s.from}>${s.to}`);
    // A super over is live cricket from the tie to its last ball: no peek, no panel, at any point of it.
    const busy = (p: string) => p === 'inn1' || p === 'inn2' || SUPER_OVER_PHASES.has(p as Phase);
    // returning to view 1 is always allowed; only outgoing peeks must avoid play
    check('Peeks only while idle: none requested during play or a super over', !switches.some(s => s.to !== 1 && busy(phaseAt(s.sim))), sw.join(' '));
    check('Pre-match peeks: squads (48, 49) each followed by a return to view 1', /pre:1>48 pre:48>1 pre:1>49 pre:49>1/.test(sw.join(' ')), sw.filter(x => x.startsWith('pre')).join(' '));
    check('Break peeks team 1 cards (2, 3); end peeks team 2 cards (4, 5); each comes home', ['break:1>2', 'break:2>1', 'break:1>3', 'break:3>1', 'ended:1>4', 'ended:4>1', 'ended:1>5', 'ended:5>1'].every(x => sw.includes(x)), sw.filter(x => !x.startsWith('pre')).join(' '));
    const outgoing = switches.filter(s => s.to !== 1).map(s => `${phaseAt(s.sim)}:${s.to}`);
    check('No repeated peeks: each data view requested once per phase', new Set(outgoing).size === outgoing.length, outgoing.join(' '));
    const peekRuns = frames.reduce((acc, f, i) => (!f.full && !(frames[i - 1] && !frames[i - 1].full) ? acc + 1 : acc), 0);
    const longPeeks = frames.reduce((acc, f, i) => (!f.full && frames[i - 1] && !frames[i - 1].full && frames[i - 2] && !frames[i - 2].full ? acc + 1 : acc), 0);
    check('Bar never stale: no run of more than two non-live frames', longPeeks === 0, `${frames.length} frames, ${peekRuns} peeks, ${longPeeks} long runs`);

    const final = sim.timeline.at(-1)!;
    const innings = [final.inn1, final.inn2, final.so1, final.so2].filter(Boolean) as NonNullable<typeof final.inn2>[];
    const wickets = innings.reduce((n, i) => n + i.wickets, 0);
    const wicketShows = shows.filter(s => s.type === 'wicket').length;
    check('Every wicket produced a wicket card', wicketShows === wickets, `${wicketShows} cards for ${wickets} wickets`);
    // Fifties and hundreds, counted from the scorecard. A milestone reached with a single or on an
    // over's last ball swaps the batters' slots; comparing slot to slot once dropped those (match 4655).
    const marks = innings.flatMap(i => i.batters).reduce((n, b) => n + (b.runs >= 100 ? 2 : b.runs >= 50 ? 1 : 0), 0);
    const markShows = shows.filter(s => s.type === 'milestone').length;
    check('Every fifty and hundred produced a milestone card', markShows === marks, `${markShows} cards for ${marks} milestones`);
    check('Boundary flashes appeared', shows.some(s => s.type === 'boundary'), `${shows.filter(s => s.type === 'boundary').length} flashes`);
    check('Line-up panel shown before the first ball', shows.some(s => s.type === 'lineup' && phaseAt(s.sim) === 'pre'), '');
    check('Innings summary shown at the break', shows.some(s => s.type === 'innings-summary' && phaseAt(s.sim) === 'break'), '');
    check('Match summary shown after the result', shows.some(s => s.type === 'match-summary' && phaseAt(s.sim) === 'ended'), '');
    check('No panel during play or a super over', !shows.some(s => s.surface === 'panel' && busy(phaseAt(s.sim))), '');
    // Overs past the usual fifth are a legal CricClubs override, so they are reported, not failed.
    const overrides = innings.flatMap((inn, k) => inn.bowlers.filter(b => b.balls > bowlerCap(k < 2 ? 20 : 1) * 6)
        .map(b => `${b.row.firstName} ${Math.floor(b.balls / 6)}.${b.balls % 6} ov`));
    const mostOvers = Math.max(...innings.slice(0, 2).flatMap(i => i.bowlers.map(b => b.balls))) / 6;
    if (SUPER_OVER) {
        const [main1, main2] = teamNames();
        // The side that batted second bats first in the super over.
        const expect = { so1: main2, so2: main1 } as Record<string, string>;
        const wrong = barSamples.filter(b => b.team.toLowerCase() !== expect[b.phase].toLowerCase());
        check('Super over: the bar names the side actually batting', barSamples.length > 0 && wrong.length === 0,
            barSamples.length ? `${barSamples.length} samples, ${wrong.length} wrong${wrong[0] ? ` (e.g. ${wrong[0].phase} showed ${wrong[0].team}, batting: ${expect[wrong[0].phase]})` : ''}` : 'no samples taken');
        // CricClubs sends super-over overs as a ball count ("6" when complete); on air they must
        // read as overs, and never past one.
        const badOvers = barSamples.filter(b => !/^(0\.[0-5]|1\.0)$/.test(b.overs));
        check('Super over: the bar shows overs, not a raw ball count', barSamples.length > 0 && badOvers.length === 0,
            barSamples.length ? `${[...new Set(barSamples.map(b => b.overs))].join(', ')}${badOvers[0] ? ` — "${badOvers[0].overs}" is not overs notation` : ''}` : 'no samples taken');
        const card = resultCards.at(-1);
        const tie = String(final.inn1.total);
        check('Super over: result card shows the tied main match and names the super-over winner',
            !!card && /won the super over/i.test(card.headline) && card.runs.length === 2 && card.runs.every(r => r === tie)
                && card.teams.map(t => (t ?? '').toLowerCase()).join('|') === [main1, main2].map(t => t.toLowerCase()).join('|'),
            card ? `"${card.headline}" · ${card.teams.map((t, i) => `${t} ${card.runs[i]}`).join(' v ')} (main match ${tie} all)` : 'no result card seen');
    }

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
    // The exceptions: the line-up and the innings summary come off early once both openers are in.
    // At the break the summary may come off either way: dismissPanel() when the names change, or the
    // score-change rule when the scorer starts the second innings, which is the same moment.
    const earlyOff = (d: any) => (d.type === 'lineup' && phaseAt(d.sim) === 'pre') || (d.surface === 'panel' && phaseAt(d.sim) === 'break');
    const badDismiss = dismissals.filter(d => !earlyOff(d)).filter(d => { const before = frames.filter(f => f.t <= d.t).slice(-2); return !(before.length === 2 && (scoreOf(before[0]) !== scoreOf(before[1]) || before[0].balls !== before[1].balls)); });
    for (const [type, phase, label] of [['lineup', 'pre', 'Line-up'], ['innings-summary', 'break', 'Innings summary']] as const) {
        const off = dismissals.filter(d => (d as any).type === type || (type === 'innings-summary' && (d as any).surface === 'panel' && !(d as any).type && phaseAt(d.sim) === 'break'));
        check(`${label} came off once, when the openers were in`, off.length === 1 && phaseAt(off[0].sim) === phase, `${off.length} early dismissals`);
    }
    check('Every dismissal followed a score change', badDismiss.length === 0, `${dismissals.length} dismissals, ${badDismiss.length} unexplained`);

    const report = [`# Simulated match run`, ``, `- scenario: ${SUPER_OVER ? 'tie decided by a super over' : 'ordinary match'}, seed ${SEED}`, `- theme: ${THEME}, speed x${SPEED}, poll ${REFRESH}ms, ${pollCount} polls, ${frames.length} frames logged`, `- result: ${final.inn1.total}/${final.inn1.wickets} v ${final.inn2?.total}/${final.inn2?.wickets}${final.so1 ? `, super over ${final.so1.total}/${final.so1.wickets} v ${final.so2?.total}/${final.so2?.wickets}` : ''} — ${final.result}`, `- cards shown: ${[...cardShots].map(([k, v]) => `${k}×${v}`).join(', ')}`, `- bowling: most ${mostOvers} overs by one bowler; fifth-over overrides: ${overrides.join(', ') || 'none'}`, `- view switches: ${sw.join(' ')}`, ``, `| check | result | detail |`, `|---|---|---|`,
        ...checks.map(c => `| ${c.name} | ${c.pass ? 'PASS' : 'FAIL'} | ${c.detail} |`), ``, `## Screenshots`, ...shots.map(s => `- ${s.name} (sim ${s.sim}s)`)].join('\n');
    writeFileSync(`${OUT}/report.md`, report);
    console.log(report);

    cdp.close(); chrome.kill(); vite?.kill(); sim.server.close();
    process.exit(checks.every(c => c.pass) ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(2); });
