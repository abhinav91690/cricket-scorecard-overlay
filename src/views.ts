import { BattingStats, BowlingStats, CricketAPIData, CricketAPIValues, Player } from './types';

/**
 * CricClubs "views": the server-side setting that decides which extra data rides along with the
 * scorebar in every poll (see docs/cricclubs-api.md §3). We drive it ourselves so the overlay
 * always has the batting/bowling cards, squads and fall of wickets it needs.
 */
export const VIEW = {
    scorebar: 1,
    batting1: 2, bowling1: 3,
    batting2: 4, bowling2: 5,
    summary: 8,
    intro: 13, inningsBreak: 14, drinks: 15,
    team1: 48, team2: 49,
} as const;

export type MatchPhase = 'pre' | 'play' | 'break' | 'ended';

const isTrue = (v: unknown) => String(v) === 'true';
const noOvers = (v: string | undefined) => !v || v === '0' || v === '0.0';

export function matchPhase(data: CricketAPIData): MatchPhase {
    const v = data.values;
    if (String(v.isMatchEnded) === '1') return 'ended';
    const chase = isTrue(v.isSecondInningsStarted);
    const balls = data.balls ?? [];
    if (!chase && noOvers(v.t1Overs) && balls.length === 0) return 'pre';
    if (chase && noOvers(v.t2Overs) && balls.length === 0) return 'break';
    return 'play';
}

/**
 * Views other than the scorebar ones drop the live fields (batters, bowler, this over), so the
 * overlay must sit on the default view whenever a ball can be bowled. We only "peek" at a data
 * view for a single poll when nothing can be missed, then come straight back.
 */
export function isFullFrame(data: CricketAPIData): boolean {
    return 'batsman1Name' in data.values;
}

/**
 * The view to request after receiving `data`, or null to leave it alone.
 * - After any peek, come home to the scorebar.
 * - Pre-match: peek the two squads once.
 * - Innings break: peek team 1's batting and bowling cards once (views 2, 3). Match over: team 2's as well (4, 5).
 * - In play: never leave the scorebar.
 */
export function desiredView(data: CricketAPIData, phase: MatchPhase, cache: ViewCache): number | null {
    const current = data.view ?? VIEW.scorebar;
    if (!isFullFrame(data)) return current === VIEW.scorebar ? null : VIEW.scorebar;
    if (phase === 'pre') {
        if (!cache.t1PlayersList) return VIEW.team1;
        if (!cache.t2PlayersList) return VIEW.team2;
        return null;
    }
    // The full card views carry each side's fall of wickets; the summary view (8) only has the
    // latest innings', so the break peeks team 1's cards and the end peeks team 2's.
    if (phase === 'break' || phase === 'ended') {
        if (!cache.t1Batting) return VIEW.batting1;   // team 1 batted first
        if (!cache.t2Bowling) return VIEW.bowling1;   // team 2 bowled first
        if (phase === 'ended') {
            if (!cache.t2Batting) return VIEW.batting2;
            if (!cache.t1Bowling) return VIEW.bowling2;
        }
        return null;
    }
    return null;
}

/** Player rows carry email addresses. Remove them before the data goes anywhere else. */
export function stripPii(data: CricketAPIData): CricketAPIData {
    const v = data.values as unknown as Record<string, unknown>;
    for (const key of ['t1Batting', 't2Batting', 't1Bowling', 't2Bowling', 't1PlayersList', 't2PlayersList']) {
        const rows = v[key];
        if (Array.isArray(rows)) rows.forEach(r => { if (r && typeof r === 'object') delete (r as Record<string, unknown>).email; });
    }
    return data;
}

/** The richer data accumulated across views, kept so panels can render from any poll. */
export interface ViewCache {
    t1Batting?: BattingStats[];
    t2Batting?: BattingStats[];
    t1Bowling?: BowlingStats[];
    t2Bowling?: BowlingStats[];
    t1PlayersList?: Player[];
    t2PlayersList?: Player[];
    t1Extras?: string;
    t2Extras?: string;
    t1Logo?: string;
    t2Logo?: string;
    /** Team names and totals as the data views report them (main-match order and totals, see docs/cricclubs-api.md §3) */
    t1Name?: string;
    t2Name?: string;
    t1Total?: string; t1Wickets?: string; t1Overs?: string;
    t2Total?: string; t2Wickets?: string; t2Overs?: string;
    /** Fall of wickets per innings: wicket number -> team score when it fell */
    fow1?: Record<string, number>;
    fow2?: Record<string, number>;
}

export function mergeCache(cache: ViewCache, data: CricketAPIData): ViewCache {
    const v = data.values;
    const next: ViewCache = { ...cache };
    for (const key of ['t1Batting', 't2Batting', 't1Bowling', 't2Bowling', 't1PlayersList', 't2PlayersList', 't1Extras', 't2Extras', 't1Logo', 't2Logo'] as const) {
        const value = v[key];
        // Empty lists mean "not available yet" (the summary view sends [] for the side still to bat)
        if (value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0)) (next as Record<string, unknown>)[key] = value;
    }
    // Names and totals only from data views: the scorebar view swaps the sides and shows
    // super-over totals during a super over, while data views keep the main match.
    if (!isFullFrame(data)) {
        for (const key of ['t1Name', 't2Name', 't1Total', 't1Wickets', 't1Overs', 't2Total', 't2Wickets', 't2Overs'] as const) {
            const value = v[key];
            if (value !== undefined && value !== null && value !== '') next[key] = value;
        }
    }
    // partnerShip follows the *view's* team: views 2/3 are team 1's innings, 4/5 team 2's; the
    // summary/break views carry the latest innings.
    if (v.partnerShip && Object.keys(v.partnerShip).length) {
        const view = data.view ?? 0;
        const team1 = view === VIEW.batting1 || view === VIEW.bowling1 || (!isTrue(v.isSecondInningsStarted));
        if (team1) next.fow1 = v.partnerShip; else next.fow2 = v.partnerShip;
    }
    return next;
}

/** True when a ball has been added or the batting side's total, wickets or overs moved. */
export function scoreChanged(prev: CricketAPIData | null, next: CricketAPIData): boolean {
    if (!prev) return false;
    const a = prev.values, b = next.values;
    if (JSON.stringify(prev.balls ?? []) !== JSON.stringify(next.balls ?? [])) return true;
    const chaseA = isTrue(a.isSecondInningsStarted), chaseB = isTrue(b.isSecondInningsStarted);
    if (chaseA !== chaseB) return true;
    const pick = (v: CricketAPIValues, chase: boolean) => chase ? [v.t2Total, v.t2Wickets, v.t2Overs] : [v.t1Total, v.t1Wickets, v.t1Overs];
    return pick(a, chaseA).join('|') !== pick(b, chaseB).join('|');
}

// ---------- presentation helpers ----------

export function displayName(p: { firstName?: string; lastName?: string; shortName?: string }): string {
    if (p.shortName) return p.shortName;
    return [p.firstName, p.lastName ? p.lastName.charAt(0) : ''].filter(Boolean).join(' ').trim();
}

export function oversFromBalls(balls: number | undefined): string {
    const b = balls ?? 0;
    return `${Math.floor(b / 6)}.${b % 6}`;
}

const ORDINAL = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : (n % 10 < 4 ? n % 10 : 0)]}`;

/** "1-14, 2-21, 3-24" from the partnerShip map. */
export function fowText(fow: Record<string, number> | undefined): string {
    if (!fow) return '';
    return Object.keys(fow).map(Number).sort((a, b) => a - b).map(w => `${w}-${fow[String(w)]}`).join(', ');
}

/** "3rd wkt · 84/3" for the wicket card. */
export function wicketFallText(wickets: number, total: string | undefined): string {
    return `${ORDINAL(wickets)} wkt · ${total ?? '0'}/${wickets}`;
}

export interface PanelRow { name: string; value: string; note?: string; pic?: string; initials: string; captain?: boolean; }

/** Absolute URL for a CricClubs image path, or undefined for missing/placeholder pictures. */
export function imageUrl(path: string | undefined | null): string | undefined {
    if (!path || /no[-_]?image/i.test(path)) return undefined;
    return path.startsWith('http') ? path : `https://cricclubs.com${path}`;
}

export function initialsOf(p: { firstName?: string; lastName?: string }): string {
    return `${(p.firstName || '').charAt(0)}${(p.lastName || '').charAt(0)}`.toUpperCase() || '?';
}

/** Short role mark, broadcast style. */
export function roleTag(role: string | undefined): string {
    const r = (role || '').toLowerCase();
    if (r.includes('keeper')) return 'WK';
    if (r.includes('all')) return 'AR';
    if (r.includes('bowl')) return 'BOWL';
    if (r.includes('bat')) return 'BAT';
    return '';
}

export function topBatters(rows: BattingStats[] | undefined, n = 3): PanelRow[] {
    return (rows ?? [])
        .filter(r => (r.ballsFaced ?? 0) > 0 || (r.runsScored ?? 0) > 0)
        .sort((a, b) => (b.runsScored ?? 0) - (a.runsScored ?? 0) || (a.ballsFaced ?? 0) - (b.ballsFaced ?? 0))
        .slice(0, n)
        .map(r => ({ name: displayName(r), value: `${r.runsScored ?? 0} (${r.ballsFaced ?? 0})`, note: String(r.isOut) === '1' ? undefined : 'not out', pic: imageUrl(r.profilepic_file_path), initials: initialsOf(r) }));
}

export function topBowlers(rows: BowlingStats[] | undefined, n = 3): PanelRow[] {
    return (rows ?? [])
        .filter(r => (r.balls ?? 0) > 0)
        .sort((a, b) => (b.wickets ?? 0) - (a.wickets ?? 0) || (a.runs ?? 0) - (b.runs ?? 0))
        .slice(0, n)
        .map(r => ({ name: displayName(r), value: `${r.wickets ?? 0}-${r.runs ?? 0}`, note: `${oversFromBalls(r.balls)} ov`, pic: imageUrl(r.profilepic_file_path), initials: initialsOf(r) }));
}

export function squadRows(rows: Player[] | undefined): PanelRow[] {
    // Alphabetical, no role marks. The captain badge shows when a row carries a captain flag
    // (CricClubs does not expose one in any overlay view today; see docs/cricclubs-api.md).
    return (rows ?? [])
        .map(p => ({ name: displayName(p), value: '', pic: imageUrl(p.profilepic_file_path), initials: initialsOf(p), captain: Boolean((p as Player & { isCaptain?: boolean }).isCaptain) }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

// ---------- panel builders (what to show while nothing can happen) ----------
import type { PanelEvent, PanelMeta, PanelTeam } from './cards';

const teamLabel = (v: CricketAPIValues, n: 1 | 2, cache?: ViewCache) => (cache && (n === 1 ? cache.t1Name : cache.t2Name)) || (n === 1 ? v.t1Name : v.t2Name) || `Team ${n}`;
const pick = <K extends keyof ViewCache & keyof CricketAPIValues>(v: CricketAPIValues, cache: ViewCache, key: K) => (cache[key] as string | undefined) || (v[key] as string | undefined);
const scoreLabel = (v: CricketAPIValues, cache: ViewCache, n: 1 | 2) => `${pick(v, cache, n === 1 ? 't1Total' : 't2Total') || '0'}/${pick(v, cache, n === 1 ? 't1Wickets' : 't2Wickets') || '0'}`;
const oversLabel = (v: CricketAPIValues, cache: ViewCache, n: 1 | 2) => `${pick(v, cache, n === 1 ? 't1Overs' : 't2Overs') || '0.0'} ov`;

function team(v: CricketAPIValues, cache: ViewCache, n: 1 | 2): PanelTeam {
    const cached = n === 1 ? cache.t1Logo : cache.t2Logo;
    const base = n === 1 ? v.firstLogo : v.secondLogo;
    return { name: teamLabel(v, n, cache), logo: imageUrl(cached || base) };
}

export interface TossInfo { headline: string; batting?: 1 | 2; }

/** "TOPGUNS UNITED" → "Topguns United"; names that already carry case are left alone. */
export function tidyName(name: string): string {
    if (name !== name.toUpperCase() || !/[A-Z]/.test(name)) return name;
    return name.replace(/\S+/g, w => w.charAt(0) + w.slice(1).toLowerCase());
}

/**
 * Turns CricClubs' "X WON THE TOSS AND ELECTED TO BAT" into a short headline and works out
 * who bats first. Unknown wording is shown as-is and leaves the batting side undecided.
 */
export function tossInfo(toss: string | undefined, t1Name: string, t2Name: string): TossInfo {
    if (!toss) return { headline: 'Toss to come' };
    const m = /^(.+?)\s+won the toss and (?:elected|chose|opted|decided) to (bat|bowl|field)\b/i.exec(toss.trim());
    if (!m) return { headline: toss };
    const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
    const winner: 1 | 2 | undefined = same(m[1], t1Name) ? 1 : same(m[1], t2Name) ? 2 : undefined;
    const bats = m[2].toLowerCase() === 'bat';
    const name = winner === 1 ? t1Name : winner === 2 ? t2Name : m[1];
    const batting = winner === undefined ? undefined : bats ? winner : winner === 1 ? 2 : 1;
    return { headline: `${tidyName(name)} elected to ${bats ? 'bat' : 'bowl'}`, batting };
}

function panelMeta(v: CricketAPIValues): PanelMeta {
    return {
        series: (v.seriesName || '').replace(/-/g, ' '), // "2024-Fall-Champions" is a slug, not a title
        ground: v.groundName || '',
        matchOvers: v.totalOvers ? `${v.totalOvers} overs` : '',
    };
}

/** Pre-match card: meta strip, both teams, the toss, then the two XIs with who bats first. */
export function lineupPanel(v: CricketAPIValues, cache: ViewCache): PanelEvent {
    const t1 = team(v, cache, 1), t2 = team(v, cache, 2);
    const toss = tossInfo(v.toss, t1.name, t2.name);
    const role = (n: 1 | 2) => toss.batting === undefined ? undefined : toss.batting === n ? 'Batting' : 'Fielding';
    return {
        type: 'lineup',
        teams: [
            { ...t1, players: squadRows(cache.t1PlayersList), role: role(1) },
            { ...t2, players: squadRows(cache.t2PlayersList), role: role(2) },
        ],
        toss: toss.headline,
        ...panelMeta(v),
    };
}

/** "9.05" from a total and CricClubs overs ("20.0"); blank when nothing has been bowled. */
export function runRate(total: string | undefined, overs: string | undefined): string {
    const [o, b] = (overs || '0').split('.').map(Number);
    const balls = (o || 0) * 6 + (b || 0);
    return balls ? ((Number(total) || 0) * 6 / balls).toFixed(2) : '';
}

/** Fours and sixes across a batting card. */
export function boundaryCount(rows: BattingStats[] | undefined): { fours: number; sixes: number } {
    return (rows ?? []).reduce((acc, r) => ({ fours: acc.fours + (r.fours ?? 0), sixes: acc.sixes + (r.sixers ?? 0) }), { fours: 0, sixes: 0 });
}

/** Innings break card: the batting side and its total, run rate / boundaries / extras / target tiles, top scorers, best bowling, fall of wickets. */
export function inningsSummaryPanel(v: CricketAPIValues, cache: ViewCache): PanelEvent {
    const total = pick(v, cache, 't1Total') || '0', wickets = pick(v, cache, 't1Wickets') || '0', overs = pick(v, cache, 't1Overs') || '0.0';
    const { fours, sixes } = boundaryCount(cache.t1Batting);
    return {
        type: 'innings-summary', eyebrow: 'Innings break · 1st innings', team: team(v, cache, 1),
        runs: total, wickets, overs: `${overs.includes('.') ? overs : `${overs}.0`} ov`, // CricClubs says "20" for a full innings
        runRate: runRate(total, overs), fours: String(fours), sixes: String(sixes), extras: cache.t1Extras || '', target: String((Number(total) || 0) + 1),
        batters: topBatters(cache.t1Batting), bowlers: topBowlers(cache.t2Bowling),
        fow: fowText(cache.fow1),
    };
}

export function matchSummaryPanel(v: CricketAPIValues, cache: ViewCache): PanelEvent {
    return {
        type: 'match-summary', result: v.result || 'Match over',
        innings: [
            { team: team(v, cache, 1), score: scoreLabel(v, cache, 1), overs: oversLabel(v, cache, 1), batters: topBatters(cache.t1Batting, 2), bowlers: topBowlers(cache.t2Bowling, 1), fow: fowText(cache.fow1) },
            { team: team(v, cache, 2), score: scoreLabel(v, cache, 2), overs: oversLabel(v, cache, 2), batters: topBatters(cache.t2Batting, 2), bowlers: topBowlers(cache.t1Bowling, 1), fow: fowText(cache.fow2) },
        ],
    };
}

/** The panels to rotate through while the match is waiting, in order. Empty during play. */
export function phasePanels(phase: MatchPhase, v: CricketAPIValues, cache: ViewCache): PanelEvent[] {
    if (phase === 'pre') return [lineupPanel(v, cache)];
    if (phase === 'break') return [inningsSummaryPanel(v, cache)];
    if (phase === 'ended') return [matchSummaryPanel(v, cache)];
    return [];
}
