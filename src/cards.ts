import { DOM } from './dom';
import { OverlayEvent } from './events';
import type { PanelRow } from './views';

/**
 * Timed cards. Two surfaces: the in-bar event card (wicket, fifty, boundary, partnership) and the
 * panel above the bar (intro, squads, innings and match summaries). Both obey the same rules:
 * every card has a hold time, and any score change dismisses everything (see app.ts).
 */

export interface PanelTeam { name: string; logo?: string; }
export interface InningsBlock { team: PanelTeam; score: string; overs: string; batters: PanelRow[]; bowlers: PanelRow[]; fow: string; }

export type PanelEvent =
    | { type: 'intro'; teams: [PanelTeam, PanelTeam]; toss: string; series: string; ground: string }
    | { type: 'squads'; teams: (PanelTeam & { players: PanelRow[] })[] }
    | { type: 'innings-summary'; label: string; team: PanelTeam; score: string; overs: string; batters: PanelRow[]; bowlers: PanelRow[]; extras: string; fow: string }
    | { type: 'match-summary'; result: string; innings: InningsBlock[] };

export type AnyCard = OverlayEvent | PanelEvent;
type Surface = 'bar' | 'panel';

export const HOLD_MS: Record<AnyCard['type'], number> = {
    wicket: 8000,
    milestone: 8000,
    partnership: 6000,
    boundary: 2000,
    intro: 12000,
    squads: 14000,
    'innings-summary': 15000,
    'match-summary': 15000,
};

/** Must match the CSS transitions on .event-card and .panel-card. */
const TRANSITION_MS = 300;

const surfaceOf = (c: AnyCard): Surface =>
    c.type === 'intro' || c.type === 'squads' || c.type === 'innings-summary' || c.type === 'match-summary' ? 'panel' : 'bar';

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

function el(cls: string, textContent?: string): HTMLElement {
    const d = document.createElement('div');
    d.className = cls;
    if (textContent !== undefined) d.textContent = textContent;
    return d;
}

/** Circular headshot with an initials disc as the fallback (missing or failed picture). */
function avatar(row: { pic?: string; initials: string }, size: 'sm' | 'md'): HTMLElement {
    const wrap = el(`avatar avatar-${size}`);
    const fallback = el('avatar-initials', row.initials);
    if (row.pic) {
        const img = document.createElement('img');
        img.alt = '';
        img.loading = 'lazy';
        img.addEventListener('error', () => img.replaceWith(fallback));
        img.src = row.pic;
        wrap.appendChild(img);
    } else {
        wrap.appendChild(fallback);
    }
    return wrap;
}

function teamHead(team: PanelTeam, extra?: string): HTMLElement {
    const head = el('panel-team-head');
    if (team.logo) {
        const img = document.createElement('img');
        img.className = 'panel-team-logo'; img.alt = ''; img.src = team.logo;
        head.appendChild(img);
    }
    head.appendChild(el('panel-team-name', team.name));
    if (extra) head.appendChild(el('panel-team-extra', extra));
    return head;
}

function personRow(r: PanelRow, size: 'sm' | 'md'): HTMLElement {
    const row = el('panel-row');
    row.appendChild(avatar(r, size));
    row.appendChild(el('panel-name', r.name));
    if (r.note) row.appendChild(el('panel-note', r.note));
    if (r.value) row.appendChild(el('panel-value', r.value));
    return row;
}

function list(title: string, rows: PanelRow[]): HTMLElement {
    const col = el('panel-col');
    if (title) col.appendChild(el('panel-col-title', title));
    rows.forEach(r => col.appendChild(personRow(r, 'md')));
    return col;
}

function renderPanel(card: PanelEvent) {
    DOM.panelCard.dataset.type = card.type;
    DOM.panelMatchup.replaceChildren();
    DOM.panelColumns.replaceChildren();
    switch (card.type) {
        case 'intro': {
            const [a, b] = card.teams;
            DOM.panelMatchup.append(teamHead(a), el('panel-vs', 'v'), teamHead(b));
            text(DOM.panelEyebrow, 'Toss');
            text(DOM.panelHeadline, card.toss);
            text(DOM.panelDetail, '');
            text(DOM.panelFooter, [card.series, card.ground].filter(Boolean).join(' · '));
            break;
        }
        case 'squads': {
            text(DOM.panelEyebrow, 'Playing XI');
            text(DOM.panelHeadline, '');
            text(DOM.panelDetail, '');
            text(DOM.panelFooter, '');
            for (const t of card.teams) {
                const block = el('panel-block');
                block.appendChild(teamHead(t));
                const grid = el('panel-xi');
                t.players.forEach(p => grid.appendChild(personRow(p, 'sm')));
                block.appendChild(grid);
                DOM.panelColumns.appendChild(block);
            }
            break;
        }
        case 'innings-summary': {
            DOM.panelMatchup.appendChild(teamHead(card.team, card.label));
            text(DOM.panelEyebrow, '');
            text(DOM.panelHeadline, `${card.score}  ${card.overs}`);
            text(DOM.panelDetail, '');
            DOM.panelColumns.append(list('Top scorers', card.batters), list('Best bowling', card.bowlers));
            text(DOM.panelFooter, [card.extras ? `Extras ${card.extras}` : '', card.fow ? `FoW ${card.fow}` : ''].filter(Boolean).join('   ·   '));
            break;
        }
        case 'match-summary': {
            text(DOM.panelEyebrow, 'Result');
            text(DOM.panelHeadline, card.result);
            text(DOM.panelDetail, '');
            for (const inn of card.innings) {
                const block = el('panel-block');
                block.appendChild(teamHead(inn.team, `${inn.score}  ${inn.overs}`));
                [...inn.batters, ...inn.bowlers].forEach(r => block.appendChild(personRow(r, 'md')));
                DOM.panelColumns.appendChild(block);
            }
            text(DOM.panelFooter, card.innings.map(i => i.fow ? `${i.team.name} FoW ${i.fow}` : '').filter(Boolean).join('   ·   '));
            break;
        }
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
    intro: { type: 'intro', teams: [{ name: 'Lions' }, { name: 'Topguns United' }], toss: 'Topguns United won the toss and elected to bat', series: '2024 Fall Champions', ground: 'LPCL-G1' },
    squads: { type: 'squads', teams: [
        { name: 'Lions', players: ['Sumeer G','Qasim A','Ravi T','Aamir K','Nayan G','Vijaykumar V','Mahesh P','Ranjeet P','Goutham R','Vijay D','Manideep M'].map((n, i) => ({ name: n, value: '', note: ['BAT','AR','BOWL','WK'][i % 4], initials: n.split(' ').map(w => w[0]).join('') })) },
        { name: 'Topguns United', players: ['Pavan V','Gautham R','Rakesh K','Abhinav V','Raja K','Chandu B','Vikas B','Siva Krishna V','Abhinandan K','Kiran R','Sandeep M'].map((n, i) => ({ name: n, value: '', note: ['WK','BAT','AR','BOWL'][i % 4], initials: n.split(' ').map(w => w[0]).join('') })) },
    ] },
    'innings-summary': { type: 'innings-summary', label: '1st innings', team: { name: 'Lions' }, score: '142/8', overs: '20 ov',
        batters: [{ name: 'Pavan V', value: '45 (30)', initials: 'PV' }, { name: 'Gautham R', value: '32 (21)', note: 'not out', initials: 'GR' }, { name: 'Rakesh K', value: '18 (12)', initials: 'RK' }],
        bowlers: [{ name: 'Siva Krishna V', value: '3-21', note: '4.0 ov', initials: 'SV' }, { name: 'Chandu B', value: '2-18', note: '4.0 ov', initials: 'CB' }, { name: 'Aamir K', value: '1-24', note: '4.0 ov', initials: 'AK' }],
        extras: '11', fow: '1-14, 2-21, 3-24, 4-45, 5-90, 6-148, 7-171, 8-181' },
    'match-summary': { type: 'match-summary', result: 'Topguns United won by 5 wickets',
        innings: [
            { team: { name: 'Lions' }, score: '142/8', overs: '20 ov', batters: [{ name: 'Pavan V', value: '45 (30)', initials: 'PV' }, { name: 'Gautham R', value: '32 (21)', initials: 'GR' }], bowlers: [{ name: 'Siva Krishna V', value: '3-21', note: '4.0 ov', initials: 'SV' }], fow: '1-14, 2-21, 3-24' },
            { team: { name: 'Topguns United' }, score: '143/5', overs: '18.4 ov', batters: [{ name: 'Abhinav V', value: '52 (31)', initials: 'AV' }, { name: 'Raja K', value: '40 (28)', initials: 'RK' }], bowlers: [{ name: 'Ravi T', value: '2-30', note: '4.0 ov', initials: 'RT' }], fow: '1-67, 2-82, 3-84' },
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
