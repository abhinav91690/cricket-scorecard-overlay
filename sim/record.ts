/**
 * Records live matches exactly as the overlay receives them, anonymised, for replay.
 *
 *   node sim/record.ts --match 4651,4655 [--club 1089463] [--site https://score.abhinav.dev] [--after-end 20]
 *
 * Each match gets its own tab of the real overlay in headless Chrome; Chrome's network hooks
 * capture every liveScoreOverlayData response the overlay reads — its own peeks at the data views
 * included — and every view switch it asks for. So the recorder makes no requests of its own: the
 * only load on CricClubs is one ordinary overlay, whose peeks the club owner has accepted.
 *
 * Output, one JSON line per event, only when the frame changes:
 *   sim/recordings/<match>-<date>.jsonl   {t, kind: 'frame', view, data} | {t, kind: 'switch', view} | {t, kind: 'error', text}
 * 🛑 Frames are anonymised (sim/anonymise.ts) before they touch disk; sim/recordings/ is gitignored.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, rmSync } from 'node:fs';
import { Anonymiser, loadSalt } from './anonymise.ts';
import { reanonymise } from './reanonymise.ts';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const MATCHES = arg('match', '').split(',').map(s => s.trim()).filter(Boolean);
const CLUB = arg('club', '1089463');
const SITE = arg('site', 'https://score.abhinav.dev');
const AFTER_END_MIN = Number(arg('after-end', '20'));
const CHROME = arg('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const CDP_PORT = Number(arg('cdp', '9334'));
const DIR = 'sim/recordings';
if (!MATCHES.length) { console.error('usage: node sim/record.ts --match <id>[,<id>...]'); process.exit(1); }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const reachable = async (url: string) => { try { return (await fetch(url)).ok; } catch { return false; } };
const now = () => new Date().toTimeString().slice(0, 8);

class Cdp {
    private id = 0; private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
    private handlers = new Map<string, ((p: any) => void)[]>();
    private ws: WebSocket;
    private constructor(ws: WebSocket) {
        this.ws = ws;
        ws.onmessage = (m) => {
            const msg = JSON.parse(String(m.data));
            if (msg.id && this.pending.has(msg.id)) { const p = this.pending.get(msg.id)!; this.pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); }
            else if (msg.method) for (const h of this.handlers.get(msg.method) ?? []) h(msg.params);
        };
    }
    static async connect(url: string) { const ws = new WebSocket(url); await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = rej; }); return new Cdp(ws); }
    send(method: string, params: Record<string, unknown> = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise<any>((resolve, reject) => this.pending.set(id, { resolve, reject })); }
    on(method: string, h: (p: any) => void) { this.handlers.set(method, [...(this.handlers.get(method) ?? []), h]); }
    close() { this.ws.close(); }
}

async function recordMatch(match: string) {
    const file = `${DIR}/${match}-${new Date().toISOString().slice(0, 10)}.jsonl`;
    const anon = new Anonymiser(loadSalt());
    const write = (entry: Record<string, unknown>) => appendFileSync(file, JSON.stringify({ t: Date.now(), ...entry }) + '\n');
    const url = `${SITE}/?matchId=${match}&clubId=${CLUB}&data=1&nostats=1`;
    // Chrome can take a while to come up when several recorders start together: retry, don't give up.
    let tab: { id: string; webSocketDebuggerUrl: string } | undefined;
    for (let i = 0; !tab; i++) {
        try { tab = await (await fetch(`http://localhost:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })).json() as any; }
        catch (e) { if (i > 60) throw e; await sleep(1000); }
    }
    const targetId = tab.id;
    const cdp = await Cdp.connect(tab.webSocketDebuggerUrl);
    const feeds = new Set<string>();
    let last = '', endedAt = 0, frames = 0;
    cdp.on('Network.requestWillBeSent', p => {
        if (p.request.url.includes('liveScoreOverlayData')) feeds.add(p.requestId);
        const v = /matchOverlayConfig\.do.*viewId=(\d+)/.exec(p.request.url);
        if (v) write({ kind: 'switch', view: Number(v[1]) });
    });
    cdp.on('Network.loadingFinished', async p => {
        if (!feeds.delete(p.requestId)) return;
        try {
            const { body, base64Encoded } = await cdp.send('Network.getResponseBody', { requestId: p.requestId });
            const raw = JSON.parse(base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body);
            const data = anon.anonymise(raw);
            const text = JSON.stringify(data);
            if (text === last) return;
            last = text; frames++;
            write({ kind: 'frame', view: raw.view ?? 1, data });
            if (String(raw.values?.isMatchEnded) === '1' && !endedAt) { endedAt = Date.now(); console.log(`${now()} ${match} ended: ${raw.values?.result ?? ''}`); }
        } catch (e) { write({ kind: 'error', text: `record: ${e}` }); }
    });
    cdp.on('Runtime.exceptionThrown', p => write({ kind: 'error', text: p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text }));
    await cdp.send('Network.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url });
    console.log(`${now()} ${match} recording to ${file}`);
    for (;;) {
        await sleep(30_000);
        if (endedAt && Date.now() - endedAt > AFTER_END_MIN * 60_000) break;
    }
    reanonymise(file);   // second pass: names learned late are hidden in the early frames too
    console.log(`${now()} ${match} done, ${frames} distinct frames`);
    cdp.close();
    await fetch(`http://localhost:${CDP_PORT}/json/close/${targetId}`);
}

async function main() {
    mkdirSync(DIR, { recursive: true });
    const chrome = spawn(CHROME, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${DIR}/.chrome-${CDP_PORT}`, '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--window-size=1920,1080', 'about:blank'], { stdio: 'ignore' });
    // The profile is only a cache (~150 MB each): remove it, or a day of recorders leaves gigabytes.
    const stop = () => { chrome.kill(); setTimeout(() => { rmSync(`${DIR}/.chrome-${CDP_PORT}`, { recursive: true, force: true }); process.exit(0); }, 1000); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    for (let i = 0; i < 240 && !(await reachable(`http://localhost:${CDP_PORT}/json/version`)); i++) await sleep(250);
    await Promise.all(MATCHES.map(m => recordMatch(m).catch(e => console.error(`${m}: ${e}`))));
    stop();
}
main();
