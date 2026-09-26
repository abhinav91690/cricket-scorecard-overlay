import { DOM } from './dom';
import { OverlayEvent } from './events';
import type { PanelRow } from './views';
import { e2eLog } from './e2e';

/**
 * Timed cards. Two surfaces: the in-bar event card (wicket, fifty, boundary, partnership) and the
 * panel above the bar (intro, squads, innings and match summaries). Both obey the same rules:
 * every card has a hold time, and any score change dismisses everything (see app.ts).
 */

export interface PanelTeam { name: string; logo?: string; code?: string; }
export interface LineupTeam extends PanelTeam { players: PanelRow[]; role?: 'Batting' | 'Fielding'; }
/** The strip along the top of a panel: competition, ground and the match length. */
export interface PanelMeta { series: string; ground: string; matchOvers: string; }
/** One side on the result card: its total, its own top batters and its own best bowler. */
export interface ResultTeam { team: PanelTeam; runs: string; wickets: string; overs: string; batters: PanelRow[]; bowler?: PanelRow; }

export type PanelEvent =
    | ({ type: 'lineup'; teams: [LineupTeam, LineupTeam]; toss: string } & PanelMeta)
    | { type: 'innings-summary'; eyebrow: string; team: PanelTeam; runs: string; wickets: string; overs: string; runRate: string; fours: string; sixes: string; extras: string; target: string; batters: PanelRow[]; bowlers: PanelRow[]; fow: string }
    | ({ type: 'match-summary'; result: string; winner?: 1 | 2; teams: [ResultTeam, ResultTeam]; performers: PanelRow[] } & PanelMeta);

export type AnyCard = OverlayEvent | PanelEvent;
type Surface = 'bar' | 'panel';

export const HOLD_MS: Record<AnyCard['type'], number> = {
    wicket: 8000,
    milestone: 8000,
    partnership: 6000,
    boundary: 2000,
    // The waiting panels each go on air once (app.ts). The line-up and innings summary sit over
    // the middle of the picture, so they come off early once both openers are in.
    lineup: 60000,
    'innings-summary': 120000,
    // The match is over: the result stays up for good (setTimeout's ceiling, ~24 days).
    'match-summary': 2 ** 31 - 1,
};

/** Must match the CSS transitions on .event-card and .panel-card. */
const TRANSITION_MS = 300;

const surfaceOf = (c: AnyCard): Surface =>
    c.type === 'lineup' || c.type === 'innings-summary' || c.type === 'match-summary' ? 'panel' : 'bar';

export interface CardCopy { eyebrow: string; headline: string; detail: string; }

/** What each in-bar card says. Pure, so it can be tested without a DOM. */
export function cardCopy(e: OverlayEvent): CardCopy {
    switch (e.type) {
        case 'wicket':
            return { eyebrow: 'Wicket', headline: e.name, detail: [e.dismissal, `${e.runs} (${e.balls})`, e.fow].filter(Boolean).join(' · ') };
        case 'milestone':
            if ('haul' in e) return { eyebrow: '5-wicket haul', headline: e.name, detail: [e.figures, e.overs && `${e.overs} ov`].filter(Boolean).join(' · ') };
            return { eyebrow: e.mark === 100 ? 'Hundred' : 'Fifty', headline: e.name, detail: `${e.runs} (${e.balls}) · ${e.fours}×4 · ${e.sixes}×6` };
        case 'partnership':
            return { eyebrow: `${e.mark} partnership`, headline: e.names, detail: `${e.runs} (${e.balls})` };
        case 'boundary':
            return { eyebrow: '', headline: e.runs === 6 ? 'Six' : 'Four', detail: '' };
    }
}

interface Queued { card: AnyCard; hold: number; }
interface SurfaceState { queue: Queued[]; showing: boolean; current?: AnyCard['type']; timer?: ReturnType<typeof setTimeout>; }

const state: Record<Surface, SurfaceState> = { bar: { queue: [], showing: false }, panel: { queue: [], showing: false } };

/** Queues cards; each surface plays one at a time. A boundary already waiting is not duplicated. */
export function enqueueCards(cards: AnyCard[], hold?: number): void {
    for (const card of cards) {
        const s = state[surfaceOf(card)];
        if (card.type === 'boundary' && s.queue.some(q => q.card.type === 'boundary')) continue;
        s.queue.push({ card, hold: hold ?? HOLD_MS[card.type] });
        e2eLog('card:queue', { surface: surfaceOf(card), type: card.type, ...(card.type === 'milestone' ? { mark: card.mark } : {}) });
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
            s.showing = false; s.current = undefined;
            e2eLog('card:dismiss', { surface });
        }
    }
}

/** Takes one kind of panel off air early, and drops any queued copy of it. Other panels are untouched. */
export function dismissPanel(type: PanelEvent['type']): void {
    const s = state.panel;
    s.queue = s.queue.filter(q => q.card.type !== type);
    if (!s.showing || s.current !== type) return;
    if (s.timer) clearTimeout(s.timer);
    // Cleared now, not after the fade: a poll landing mid-fade must not dismiss it again.
    s.current = undefined;
    element('panel').classList.remove('is-visible');
    e2eLog('card:dismiss', { surface: 'panel', type });
    s.timer = setTimeout(() => {
        s.showing = false;
        pump('panel');
    }, TRANSITION_MS);
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

function personRow(r: PanelRow, size: 'sm' | 'md' | null, extraClass = ''): HTMLElement {
    const row = document.createElement('li');
    row.className = `panel-row ${extraClass}`.trim();
    if (size) row.appendChild(avatar(r, size));
    row.appendChild(el('panel-name', r.name));
    if (r.captain) row.appendChild(el('panel-captain', 'C'));
    if (r.note) row.appendChild(el('panel-note', r.note));
    if (r.value) {
        const m = /^(.*\S)\s+\((\d+)\)$/.exec(r.value); // "59 (38)": balls faced smaller
        const value = el('panel-value', m ? m[1] : r.value);
        if (m) value.appendChild(el('panel-value-sub', `(${m[2]})`));
        row.appendChild(value);
    }
    return row;
}

function rowList(cls: string): HTMLUListElement {
    const ul = document.createElement('ul');
    ul.className = cls;
    return ul;
}

/** A titled column: "TEAM XI · FIELDING" rule, accent when it is the side of interest, then the rows. */
function column(title: string, tag: string | undefined, accent: boolean, rows: HTMLElement): HTMLElement {
    const block = el('panel-block');
    const head = el(`panel-col-head${accent ? ' is-accent' : ''}`);
    head.appendChild(el('panel-col-head-title', title));
    if (tag) head.appendChild(el('panel-col-head-tag', tag));
    block.append(head, rows);
    return block;
}

/** The crest when there is one, else the team code in a square badge ("TGN"), else nothing. */
function teamBadge(team: PanelTeam): HTMLElement | null {
    if (team.logo) {
        const img = document.createElement('img');
        img.className = 'panel-team-logo'; img.alt = ''; img.src = team.logo;
        return img;
    }
    return team.code ? el('result-code', team.code) : null;
}

/** One side's card: badge, name and total across the top, then its batters and its bowler. */
function resultCard(t: ResultTeam, winner: boolean): HTMLElement {
    const card = el(`result-card${winner ? ' is-winner' : ''}`);
    const head = el('result-head');
    const badge = teamBadge(t.team);
    if (badge) head.appendChild(badge);
    head.appendChild(el('panel-team-name', t.team.name));
    const score = el('result-score');
    score.append(el('panel-score-runs', t.runs), el('panel-score-wkts', `/${t.wickets}`));
    if (t.overs) score.appendChild(el('result-overs', t.overs));
    head.appendChild(score);
    const rows = rowList('result-rows');
    t.batters.forEach(r => rows.appendChild(personRow(r, null)));
    if (t.bowler) rows.appendChild(personRow(t.bowler, null, 'is-bowler'));
    card.append(head, rows);
    return card;
}

/** The inverted strip under the cards: headshot, name, the figure that earned the place. */
function performerStrip(rows: PanelRow[]) {
    DOM.panelFooter.replaceChildren();
    if (!rows.length) return;
    DOM.panelFooter.appendChild(el('perf-label', 'Top performers'));
    for (const r of rows) {
        const item = el('perf');
        const words = el('perf-text');
        words.appendChild(el('perf-name', r.name));
        if (r.note) words.appendChild(el('perf-note', r.note));
        item.append(avatar(r, 'sm'), words, el('perf-value', r.value));
        DOM.panelFooter.appendChild(item);
    }
}

function matchup(a: PanelTeam, b: PanelTeam) {
    DOM.panelMatchup.append(teamHead(a), el('panel-vs', 'v'), teamHead(b));
}

/** Series · ground on the left, match length on the right; rendered into the footer slot and ordered to the top by CSS. */
function metaStrip(meta: PanelMeta) {
    footer([['', meta.series], ['', meta.ground]]);
    if (meta.matchOvers) DOM.panelFooter.appendChild(el('panel-kv panel-kv-end', meta.matchOvers));
}

/** "181" big, "/7" smaller, "20.0 ov" muted: the total as the innings card's headline. */
function scoreBlock(runs: string, wickets: string, overs: string): HTMLElement {
    const block = el('panel-score');
    block.append(el('panel-score-runs', runs), el('panel-score-wkts', `/${wickets}`), el('panel-score-overs', overs));
    return block;
}

/** A stat tile: small-caps label over a value; `parts` alternate number / unit ("18", "4s", "7", "6s"). */
function tile(label: string, parts: string[], dark = false): HTMLElement {
    const t = el(`panel-tile${dark ? ' is-dark' : ''}`);
    t.appendChild(el('k', label));
    const v = el('v');
    parts.forEach((p, i) => v.appendChild(el(i % 2 ? 'u' : 'n', p)));
    t.appendChild(v);
    return t;
}

/** Footer as label/value pairs: labels stay small caps, values keep their case and tabular digits. */
function footer(pairs: [string, string][]) {
    DOM.panelFooter.replaceChildren();
    pairs.filter(([, v]) => v).forEach(([k, v], i) => {
        if (i) DOM.panelFooter.appendChild(el('panel-sep', '·'));
        const item = el('panel-kv');
        if (k) item.appendChild(el('k', k));
        item.appendChild(el('v', v));
        DOM.panelFooter.appendChild(item);
    });
}

function renderPanel(card: PanelEvent) {
    DOM.panelCard.dataset.type = card.type;
    DOM.panelMatchup.replaceChildren();
    DOM.panelColumns.replaceChildren();
    switch (card.type) {
        case 'lineup': {
            matchup(card.teams[0], card.teams[1]);
            text(DOM.panelEyebrow, 'Toss');
            text(DOM.panelHeadline, card.toss);
            text(DOM.panelDetail, '');
            for (const t of card.teams) {
                const grid = rowList('panel-xi');
                grid.style.setProperty('--rows', String(Math.max(1, Math.ceil(t.players.length / 2))));
                t.players.forEach(p => grid.appendChild(personRow(p, 'sm')));
                DOM.panelColumns.appendChild(column(/\bXI$/i.test(t.name.trim()) ? t.name : `${t.name} XI`, t.role, t.role === 'Batting', grid));
            }
            metaStrip(card);
            break;
        }
        case 'innings-summary': {
            DOM.panelMatchup.append(teamHead(card.team), scoreBlock(card.runs, card.wickets, card.overs));
            text(DOM.panelEyebrow, card.eyebrow);
            text(DOM.panelHeadline, '');
            DOM.panelDetail.replaceChildren(
                ...(card.runRate ? [tile('Run rate', [card.runRate])] : []),
                tile('Boundaries', [card.fours, '4s', card.sixes, '6s']),
                ...(card.extras ? [tile('Extras', [card.extras])] : []),
                tile('Target', [card.target], true),
            );
            const batting = rowList('panel-list'), bowling = rowList('panel-list');
            card.batters.forEach(r => batting.appendChild(personRow(r, 'md')));
            card.bowlers.forEach(r => bowling.appendChild(personRow(r, 'md')));
            DOM.panelColumns.append(column('Top scorers', undefined, false, batting), column('Best bowling', undefined, false, bowling));
            footer([['Fall of wickets', card.fow]]);
            break;
        }
        case 'match-summary': {
            text(DOM.panelEyebrow, ['Result', card.ground].filter(Boolean).join(' · '));
            text(DOM.panelHeadline, card.result);
            text(DOM.panelDetail, '');
            card.teams.forEach((t, i) => DOM.panelColumns.appendChild(resultCard(t, card.winner === i + 1)));
            performerStrip(card.performers);
            break;
        }
    }
}

function pump(surface: Surface) {
    const s = state[surface];
    if (s.showing || s.queue.length === 0) return;
    const { card, hold } = s.queue.shift()!;
    s.showing = true;
    s.current = card.type;
    if (surface === 'bar') renderBar(card as OverlayEvent); else renderPanel(card as PanelEvent);
    element(surface).classList.add('is-visible');
    e2eLog('card:show', { surface, type: card.type, hold, ...(card.type === 'milestone' ? { mark: card.mark } : {}) });
    s.timer = setTimeout(() => {
        element(surface).classList.remove('is-visible');
        e2eLog('card:hide', { surface, type: card.type });
        s.timer = setTimeout(() => {
            s.showing = false; s.current = undefined;
            pump(surface);
        }, TRANSITION_MS);
    }, hold);
}

/** Sample cards for `?debug=…&card=<type>` / `&panel=<type>` so they can be positioned
 *  in OBS without waiting for a real one. `four`/`six` are aliases so every card and
 *  panel type is individually addressable. */
export const SAMPLE_EVENTS: Record<string, AnyCard> = {
    wicket: { type: 'wicket', name: 'Vikas B', runs: '11', balls: '8', dismissal: 'c Ravi T b Siva Krishna V', fow: '3rd wkt · 84/3' },
    milestone: { type: 'milestone', mark: 50, name: 'Abhinav V', runs: '52', balls: '31', fours: '6', sixes: '2' },
    partnership: { type: 'partnership', mark: 50, names: 'Abhinav & Raja', runs: '54', balls: '38' },
    boundary: { type: 'boundary', runs: 6 },
    // Each boundary is also addressable on its own, so every card type can be
    // positioned in OBS and screenshotted without editing code.
    four: { type: 'boundary', runs: 4 },
    six: { type: 'boundary', runs: 6 },
    lineup: { type: 'lineup', toss: 'Topguns United elected to bat', series: '2024 Fall Champions', ground: 'LPCL-G1', matchOvers: '20 overs', teams: [
        { name: 'Lions', role: 'Fielding', players: ['Sumeer G','Qasim A','Ravi T','Aamir K','Nayan G','Vijaykumar V','Mahesh P','Ranjeet P','Goutham R','Vijay D','Manideep M'].map(n => ({ name: n, value: '', initials: n.split(' ').map(w => w[0]).join('') })).sort((a, b) => a.name.localeCompare(b.name)) },
        { name: 'Topguns United', role: 'Batting', players: ['Pavan V','Gautham R','Rakesh K','Abhinav V','Raja K','Chandu B','Vikas B','Siva Krishna V','Abhinandan K','Kiran R','Sandeep M'].map(n => ({ name: n, value: '', initials: n.split(' ').map(w => w[0]).join('') })).sort((a, b) => a.name.localeCompare(b.name)) },
    ] },
    'innings-summary': { type: 'innings-summary', eyebrow: 'Innings break · 1st innings', team: { name: 'Lions' }, runs: '142', wickets: '8', overs: '20.0 ov', runRate: '7.10', fours: '12', sixes: '4', extras: '11', target: '143',
        batters: [{ name: 'Pavan V', value: '45 (30)', initials: 'PV' }, { name: 'Gautham R', value: '32 (21)', note: 'not out', initials: 'GR' }, { name: 'Rakesh K', value: '18 (12)', initials: 'RK' }],
        bowlers: [{ name: 'Siva Krishna V', value: '3-21', note: '4.0 ov', initials: 'SV' }, { name: 'Chandu B', value: '2-18', note: '4.0 ov', initials: 'CB' }, { name: 'Aamir K', value: '1-24', note: '4.0 ov', initials: 'AK' }],
        fow: '1-14, 2-21, 3-24, 4-45, 5-90, 6-148, 7-171, 8-181' },
    // Each card holds that side's own players, drawn from the line-up sample above so the two agree.
    'match-summary': { type: 'match-summary', result: 'Topguns United won by 5 wickets', winner: 2,
        series: '2024 Fall Champions', ground: 'LPCL-G1', matchOvers: '20 overs',
        teams: [
            { team: { name: 'Lions', code: 'LNS' }, runs: '142', wickets: '8', overs: '20.0 ov',
              batters: [{ name: 'Sumeer G', value: '45 (30)', initials: 'SG' }, { name: 'Qasim A', value: '32 (21)', note: 'not out', initials: 'QA' }],
              bowler: { name: 'Ravi T', value: '2-30', note: '4.0 ov', initials: 'RT' } },
            { team: { name: 'Topguns United', code: 'TGN' }, runs: '143', wickets: '5', overs: '18.4 ov',
              batters: [{ name: 'Abhinav V', value: '52 (31)', initials: 'AV' }, { name: 'Raja K', value: '40 (28)', note: 'not out', initials: 'RK' }],
              bowler: { name: 'Siva Krishna V', value: '3-21', note: '4.0 ov', initials: 'SV' } },
        ],
        performers: [
            { name: 'Siva Krishna V', value: '3-21 (4.0)', note: 'Player of the match', initials: 'SV' },
            { name: 'Abhinav V', value: '52 (31)', initials: 'AV' },
            { name: 'Sumeer G', value: '45 (30)', initials: 'SG' },
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
        s.queue = []; s.showing = false; s.current = undefined;
        if (s.timer) clearTimeout(s.timer);
        s.timer = undefined;
    }
}
