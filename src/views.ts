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
 * - Innings break / match over: peek the match summary once (cards, extras, fall of wickets).
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
    if (phase === 'break' || phase === 'ended') {
        const haveSummary = !!(cache.t1Batting && cache.t1Bowling && (phase === 'break' || (cache.t2Batting && cache.t2Bowling)));
        return haveSummary ? null : VIEW.summary;
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
    /** Team names as the data views report them (main-match order, see docs/cricclubs-api.md §3) */
    t1Name?: string;
    t2Name?: string;
    /** Fall of wickets per innings: wicket number -> team score when it fell */
    fow1?: Record<string, number>;
    fow2?: Record<string, number>;
}

export function mergeCache(cache: ViewCache, data: CricketAPIData): ViewCache {
    const v = data.values;
    const next: ViewCache = { ...cache };
    for (const key of ['t1Batting', 't2Batting', 't1Bowling', 't2Bowling', 't1PlayersList', 't2PlayersList', 't1Extras', 't2Extras', 't1Logo', 't2Logo'] as const) {
        const value = v[key];
        if (value !== undefined && value !== null && value !== '') (next as Record<string, unknown>)[key] = value;
    }
    // Names only from data views: the scorebar view can swap the sides during a super over.
    if (!isFullFrame(data)) {
        if (v.t1Name) next.t1Name = v.t1Name;
        if (v.t2Name) next.t2Name = v.t2Name;
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
import type { PanelEvent, PanelTeam } from './cards';

const teamLabel = (v: CricketAPIValues, n: 1 | 2, cache?: ViewCache) => (cache && (n === 1 ? cache.t1Name : cache.t2Name)) || (n === 1 ? v.t1Name : v.t2Name) || `Team ${n}`;
const scoreLabel = (v: CricketAPIValues, n: 1 | 2) => `${(n === 1 ? v.t1Total : v.t2Total) || '0'}/${(n === 1 ? v.t1Wickets : v.t2Wickets) || '0'}`;
const oversLabel = (v: CricketAPIValues, n: 1 | 2) => `${(n === 1 ? v.t1Overs : v.t2Overs) || '0.0'} ov`;

function team(v: CricketAPIValues, cache: ViewCache, n: 1 | 2): PanelTeam {
    const cached = n === 1 ? cache.t1Logo : cache.t2Logo;
    const base = n === 1 ? v.firstLogo : v.secondLogo;
    return { name: teamLabel(v, n, cache), logo: imageUrl(cached || base) };
}

/** Pre-match card: both line-ups, then the toss as the headline, series and ground as the caption. */
export function lineupPanel(v: CricketAPIValues, cache: ViewCache): PanelEvent {
    return {
        type: 'lineup',
        teams: [
            { ...team(v, cache, 1), players: squadRows(cache.t1PlayersList) },
            { ...team(v, cache, 2), players: squadRows(cache.t2PlayersList) },
        ],
        toss: v.toss || 'Toss to come',
        series: v.seriesName || '',
        ground: v.groundName || '',
    };
}

export function inningsSummaryPanel(v: CricketAPIValues, cache: ViewCache): PanelEvent {
    return {
        type: 'innings-summary', label: '1st innings', team: team(v, cache, 1), score: scoreLabel(v, 1), overs: oversLabel(v, 1),
        batters: topBatters(cache.t1Batting), bowlers: topBowlers(cache.t2Bowling),
        extras: cache.t1Extras || '', fow: fowText(cache.fow1),
    };
}

export function matchSummaryPanel(v: CricketAPIValues, cache: ViewCache): PanelEvent {
    return {
        type: 'match-summary', result: v.result || 'Match over',
        innings: [
            { team: team(v, cache, 1), score: scoreLabel(v, 1), overs: oversLabel(v, 1), batters: topBatters(cache.t1Batting, 2), bowlers: topBowlers(cache.t2Bowling, 1), fow: fowText(cache.fow1) },
            { team: team(v, cache, 2), score: scoreLabel(v, 2), overs: oversLabel(v, 2), batters: topBatters(cache.t2Batting, 2), bowlers: topBowlers(cache.t1Bowling, 1), fow: fowText(cache.fow2) },
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
