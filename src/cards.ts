import { DOM } from './dom';
import { OverlayEvent } from './events';
import { PanelRow } from './views';

/**
 * Timed cards. Two surfaces: the in-bar event card (wicket, fifty, boundary, partnership) and the
 * panel above the bar (intro, squads, innings and match summaries). Both obey the same rules:
 * every card has a hold time, and any score change dismisses everything (see app.ts).
 */

export type PanelEvent =
    | { type: 'intro'; series: string; teams: string; ground: string; toss: string }
    | { type: 'squad'; team: string; players: PanelRow[] }
    | { type: 'innings-summary'; label: string; team: string; score: string; batters: PanelRow[]; bowlers: PanelRow[]; extras: string; fow: string; target: string }
    | { type: 'match-summary'; result: string; teams: string; innings: { team: string; score: string; batters: PanelRow[]; bowlers: PanelRow[]; fow: string }[] };

export type AnyCard = OverlayEvent | PanelEvent;
type Surface = 'bar' | 'panel';

export const HOLD_MS: Record<AnyCard['type'], number> = {
    wicket: 8000,
    milestone: 8000,
    partnership: 6000,
    boundary: 2000,
    intro: 12000,
    squad: 12000,
    'innings-summary': 15000,
    'match-summary': 15000,
};

/** Must match the CSS transitions on .event-card and .panel-card. */
const TRANSITION_MS = 300;

const surfaceOf = (c: AnyCard): Surface =>
    c.type === 'intro' || c.type === 'squad' || c.type === 'innings-summary' || c.type === 'match-summary' ? 'panel' : 'bar';

export interface CardCopy { eyebrow: string; headline: string; detail: string; }

/** What each in-bar card says. Pure, so it can be tested without a DOM. */
export function cardCopy(e: OverlayEvent): CardCopy {
    switch (e.type) {
        case 'wicket':
            return { eyebrow: 'Wicket', headline: e.name, detail: [e.dismissal, `${e.runs} (${e.balls})`, e.fow].filter(Boolean).join(' · ') };
        case 'milestone':
            return { eyebrow: e.mark === 100 ? 'Hundred' : 'Fifty', headline: e.name, detail: `${e.runs} (${e.balls}) · ${e.fours}×4 · ${e.sixes}×6` };
        case 'partnership':
            return { eyebrow: `${e.mark} partnership`, headline: e.names, detail: `${e.runs} (${e.balls})` };
        case 'boundary':
            return { eyebrow: '', headline: e.runs === 6 ? 'Six' : 'Four', detail: '' };
    }
}

interface Queued { card: AnyCard; hold: number; }
interface SurfaceState { queue: Queued[]; showing: boolean; timer?: ReturnType<typeof setTimeout>; }

const state: Record<Surface, SurfaceState> = { bar: { queue: [], showing: false }, panel: { queue: [], showing: false } };

/** Queues cards; each surface plays one at a time. A boundary already waiting is not duplicated. */
export function enqueueCards(cards: AnyCard[], hold?: number): void {
    for (const card of cards) {
        const s = state[surfaceOf(card)];
        if (card.type === 'boundary' && s.queue.some(q => q.card.type === 'boundary')) continue;
        s.queue.push({ card, hold: hold ?? HOLD_MS[card.type] });
    }
    pump('bar');
    pump('panel');
}

/** True when a surface has nothing showing and nothing waiting. */
export function isIdle(surface: Surface): boolean {
    return !state[surface].showing && state[surface].queue.length === 0;
}

/** Golden rule: a new ball dismisses whatever is on screen and empties both queues. */
export function dismissAll(): void {
    for (const surface of ['bar', 'panel'] as const) {
        const s = state[surface];
        s.queue = [];
        if (s.timer) clearTimeout(s.timer);
        s.timer = undefined;
        if (s.showing) {
            element(surface).classList.remove('is-visible');
            s.showing = false;
        }
    }
}

function element(surface: Surface): HTMLElement {
    return surface === 'bar' ? DOM.eventCard : DOM.panelCard;
}

function text(el: HTMLElement, value: string) { el.textContent = value; }

function renderBar(event: OverlayEvent) {
    const copy = cardCopy(event);
    DOM.eventCard.dataset.type = event.type;
    if (event.type === 'boundary') DOM.eventCard.dataset.runs = String(event.runs);
    else delete DOM.eventCard.dataset.runs;
    text(DOM.eventEyebrow, copy.eyebrow);
    text(DOM.eventHeadline, copy.headline);
    text(DOM.eventDetail, copy.detail);
}

function column(title: string, rows: PanelRow[]): HTMLElement {
    const col = document.createElement('div');
    col.className = 'panel-col';
    if (title) { const h = document.createElement('div'); h.className = 'panel-col-title'; h.textContent = title; col.appendChild(h); }
    for (const r of rows) {
        const row = document.createElement('div'); row.className = 'panel-row';
        const name = document.createElement('span'); name.className = 'panel-name'; name.textContent = r.name;
        row.appendChild(name);
        if (r.note) { const note = document.createElement('span'); note.className = 'panel-note'; note.textContent = r.note; row.appendChild(note); }
        if (r.value) { const val = document.createElement('span'); val.className = 'panel-value'; val.textContent = r.value; row.appendChild(val); }
        col.appendChild(row);
    }
    return col;
}

function renderPanel(card: PanelEvent) {
    DOM.panelCard.dataset.type = card.type;
    DOM.panelColumns.replaceChildren();
    switch (card.type) {
        case 'intro':
            text(DOM.panelEyebrow, card.series);
            text(DOM.panelHeadline, card.teams);
            text(DOM.panelDetail, card.ground);
            text(DOM.panelFooter, card.toss);
            break;
        case 'squad':
            text(DOM.panelEyebrow, 'Playing XI');
            text(DOM.panelHeadline, card.team);
            text(DOM.panelDetail, '');
            text(DOM.panelFooter, '');
            DOM.panelColumns.append(column('', card.players.slice(0, Math.ceil(card.players.length / 2))), column('', card.players.slice(Math.ceil(card.players.length / 2))));
            break;
        case 'innings-summary':
            text(DOM.panelEyebrow, card.label);
            text(DOM.panelHeadline, `${card.team} ${card.score}`);
            text(DOM.panelDetail, '');
            DOM.panelColumns.append(column('Batting', card.batters), column('Bowling', card.bowlers));
            text(DOM.panelFooter, [card.extras ? `Extras ${card.extras}` : '', card.fow ? `FoW ${card.fow}` : '', card.target].filter(Boolean).join('   ·   '));
            break;
        case 'match-summary':
            text(DOM.panelEyebrow, 'Match summary');
            text(DOM.panelHeadline, card.result);
            text(DOM.panelDetail, card.teams);
            for (const inn of card.innings) {
                const col = column(`${inn.team} ${inn.score}`, [...inn.batters, ...inn.bowlers]);
                DOM.panelColumns.appendChild(col);
            }
            text(DOM.panelFooter, card.innings.map(i => i.fow ? `${i.team} FoW ${i.fow}` : '').filter(Boolean).join('   ·   '));
            break;
    }
}

function pump(surface: Surface) {
    const s = state[surface];
    if (s.showing || s.queue.length === 0) return;
    const { card, hold } = s.queue.shift()!;
    s.showing = true;
    if (surface === 'bar') renderBar(card as OverlayEvent); else renderPanel(card as PanelEvent);
    element(surface).classList.add('is-visible');
    s.timer = setTimeout(() => {
        element(surface).classList.remove('is-visible');
        s.timer = setTimeout(() => {
            s.showing = false;
            pump(surface);
        }, TRANSITION_MS);
    }, hold);
}

/** Sample cards for `?debug=…&card=<type>` / `&panel=<type>` so they can be positioned in OBS. */
export const SAMPLE_EVENTS: Record<string, AnyCard> = {
    wicket: { type: 'wicket', name: 'Vikas B', runs: '11', balls: '8', dismissal: 'c Ravi T b Siva Krishna V', fow: '3rd wkt · 84/3' },
    milestone: { type: 'milestone', mark: 50, name: 'Abhinav V', runs: '52', balls: '31', fours: '6', sixes: '2' },
    partnership: { type: 'partnership', mark: 50, names: 'Abhinav & Raja', runs: '54', balls: '38' },
    boundary: { type: 'boundary', runs: 6 },
    intro: { type: 'intro', series: '2024 Fall Champions', teams: 'Lions v Topguns United', ground: 'LPCL-G1', toss: 'Topguns United won the toss and elected to bat' },
    squad: { type: 'squad', team: 'Topguns United', players: ['Pavan V','Gautham R','Rakesh K','Abhinav V','Raja K','Chandu B','Vikas B','Siva Krishna V','Ravi T','Aamir K','Sumeer G'].map((n, i) => ({ name: n, value: '', note: ['Batter','All Rounder','Bowler','Wicket Keeper'][i % 4] })) },
    'innings-summary': { type: 'innings-summary', label: '1st innings', team: 'Lions', score: '142/8 (20 ov)',
        batters: [{ name: 'Pavan V', value: '45 (30)' }, { name: 'Gautham R', value: '32 (21)', note: 'not out' }, { name: 'Rakesh K', value: '18 (12)' }],
        bowlers: [{ name: 'Siva Krishna V', value: '3-21', note: '4.0 ov' }, { name: 'Chandu B', value: '2-18', note: '4.0 ov' }, { name: 'Aamir K', value: '1-24', note: '4.0 ov' }],
        extras: '11', fow: '1-14, 2-21, 3-24, 4-45, 5-90, 6-148, 7-171, 8-181', target: 'Target 143' },
    'match-summary': { type: 'match-summary', result: 'Topguns United won by 5 wickets', teams: 'Lions v Topguns United',
        innings: [
            { team: 'Lions', score: '142/8 (20 ov)', batters: [{ name: 'Pavan V', value: '45 (30)' }, { name: 'Gautham R', value: '32 (21)' }], bowlers: [{ name: 'Siva Krishna V', value: '3-21', note: '4.0 ov' }], fow: '1-14, 2-21, 3-24' },
            { team: 'Topguns United', score: '143/5 (18.4 ov)', batters: [{ name: 'Abhinav V', value: '52 (31)' }, { name: 'Raja K', value: '40 (28)' }], bowlers: [{ name: 'Ravi T', value: '2-30', note: '4.0 ov' }], fow: '1-67, 2-82, 3-84' },
        ] },
};

export function showSampleCard(type: string): void {
    const card = SAMPLE_EVENTS[type];
    if (card) enqueueCards([card], 60 * 60 * 1000);
}

/** Test hook: clear both queues and any pending timers. */
export function resetCardsForTests(): void {
    for (const surface of ['bar', 'panel'] as const) {
        const s = state[surface];
        s.queue = []; s.showing = false;
        if (s.timer) clearTimeout(s.timer);
        s.timer = undefined;
    }
}
