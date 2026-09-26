import { BattingStats, BowlingStats, CricketAPIData, CricketAPIValues, Player } from './types';
import { battingSecond } from './utils';

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
    // 🛑 A super over swaps the scorebar's sides and totals (cricclubs-api.md §3), so the
    // gap between its two innings is indistinguishable from an innings break by overs and
    // balls alone: the chase has started, the second side has no overs, nothing is in hand.
    // Calling it 'break' puts the MAIN match's first innings on air labelled "1st innings",
    // stale, while a super over is being bowled. It is live cricket — never a break.
    if (isTrue(v.isSuperOver)) return 'play';
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
 * - A view in `gaveUp` has used all its tries and is skipped, so the next one is asked for.
 */
export function desiredView(data: CricketAPIData, phase: MatchPhase, cache: ViewCache, gaveUp: ReadonlySet<number> = NONE): number | null {
    const current = data.view ?? VIEW.scorebar;
    if (!isFullFrame(data)) return current === VIEW.scorebar ? null : VIEW.scorebar;
    // 🛑 The first piece still missing — but skipping any view that has already used its tries.
    // Asking for the first missing piece unconditionally meant one view that never yielded
    // blocked every view after it in the phase: a failed team 1 squad meant team 2's was never
    // requested, and the line-up showed with both XIs empty.
    const first = (...steps: [missing: boolean, view: number][]) => steps.find(([missing, v]) => missing && !gaveUp.has(v))?.[1] ?? null;
    if (phase === 'pre') return first([!cache.t1PlayersList, VIEW.team1], [!cache.t2PlayersList, VIEW.team2]);
    // The full card views carry each side's fall of wickets; the summary view (8) only has the
    // latest innings', so the break peeks team 1's cards and the end peeks team 2's.
    if (phase === 'break' || phase === 'ended') {
        const steps: [boolean, number][] = [
            [!cache.t1Batting, VIEW.batting1],   // team 1 batted first
            [!cache.t2Bowling, VIEW.bowling1],   // team 2 bowled first
        ];
        if (phase === 'ended') steps.push([!cache.t2Batting, VIEW.batting2], [!cache.t1Bowling, VIEW.bowling2]);
        return first(...steps);
    }
    return null;
}

const NONE: ReadonlySet<number> = new Set();

/** Field names deleted from anywhere in a payload. Player rows carry `email`. */
const PII_KEYS = ['email'] as const;

/**
 * Delete PII from anywhere in the payload, before it can reach the DOM, the view cache, a
 * log line, a screenshot or a committed fixture.
 *
 * Called as the **first** statement in `renderFrame()`, above the `isFullFrame()` guard,
 * because peek frames are precisely the ones carrying player rows.
 *
 * 🛑 This walks the whole object rather than a list of known keys. The list version was
 * correct for every view in cricclubs-api.md §3, but a new CricClubs view with a new
 * row-bearing key would have leaked emails **silently onto a public broadcast** — and
 * nobody would notice until someone paused the stream. The walk cannot be outrun by a
 * payload shape we have not seen.
 */
export function stripPii(data: CricketAPIData): CricketAPIData {
    const seen = new WeakSet<object>();
    const walk = (node: unknown): void => {
        if (!node || typeof node !== 'object') return;
        if (seen.has(node)) return;           // defensive: never loop on a cyclic payload
        seen.add(node);
        if (Array.isArray(node)) {
            node.forEach(walk);
            return;
        }
        const obj = node as Record<string, unknown>;
        for (const key of PII_KEYS) delete obj[key];
        for (const value of Object.values(obj)) walk(value);
    };
    walk(data);
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
    /** Three-letter team codes ("TGN"), in data-view order like the names above */
    t1Code?: string;
    t2Code?: string;
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
        for (const key of ['t1Name', 't2Name', 't1Code', 't2Code', 't1Total', 't1Wickets', 't1Overs', 't2Total', 't2Wickets', 't2Overs'] as const) {
            const value = v[key];
            if (value !== undefined && value !== null && value !== '') next[key] = value;
        }
    }
    // partnerShip follows the *view's* team: views 2/3 are team 1's innings, 4/5 team 2's; the
    // summary/break views carry the latest innings.
    if (v.partnerShip && Object.keys(v.partnerShip).length) {
        const view = data.view ?? 0;
        // Deliberately the main match's flag, not battingSecond(): only data views carry
        // partnerShip, and data views keep the main match's order even during a super over.
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
    const chaseA = battingSecond(a), chaseB = battingSecond(b);
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
import type { PanelEvent, PanelMeta, PanelTeam, ResultTeam } from './cards';

const teamLabel = (v: CricketAPIValues, n: 1 | 2, cache?: ViewCache) => (cache && (n === 1 ? cache.t1Name : cache.t2Name)) || (n === 1 ? v.t1Name : v.t2Name) || `Team ${n}`;
const pick = <K extends keyof ViewCache & keyof CricketAPIValues>(v: CricketAPIValues, cache: ViewCache, key: K) => (cache[key] as string | undefined) || (v[key] as string | undefined);

function team(v: CricketAPIValues, cache: ViewCache, n: 1 | 2): PanelTeam {
    const cached = n === 1 ? cache.t1Logo : cache.t2Logo;
    const base = n === 1 ? v.firstLogo : v.secondLogo;
    return { name: teamLabel(v, n, cache), logo: imageUrl(cached || base) };
}

export interface TossInfo { headline: string; batting?: 1 | 2; }

/** "TOPGUNS UNITED" → "Topguns United"; names that already carry case are left alone. */
export function tidyName(name: string): string {
    if (name !== name.toUpperCase() || !/[A-Z]/.test(name)) return name;
    // Initials and numerals stay capitals: "AVV XI" once went on air as "Avv Xi" (match 4651).
    // A short real word ("MOB") stays capitals too — acceptable, as only all-caps names get here.
    const keep = (w: string) => /^[IVXLC]+$/.test(w) || (w.length <= 3 && !COMMON.has(w));
    return name.replace(/\S+/g, w => keep(w) ? w : w.charAt(0) + w.slice(1).toLowerCase());
}
const COMMON = new Set(['THE', 'AND', 'OF']);

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

/** "59 (44)" for a batter, "4-27 (3.0)" for a bowler: one compact figure for the performers strip. */
const batFigure = (r: BattingStats) => `${r.runsScored ?? 0} (${r.ballsFaced ?? 0})`;
const bowlFigure = (r: BowlingStats) => `${r.wickets ?? 0}-${r.runs ?? 0} (${oversFromBalls(r.balls)})`;
const fullName = (p: { firstName?: string; lastName?: string }) => `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim().toLowerCase();
const byRuns = (a: BattingStats, b: BattingStats) => (b.runsScored ?? 0) - (a.runsScored ?? 0) || (a.ballsFaced ?? 0) - (b.ballsFaced ?? 0);
const byFigures = (a: BowlingStats, b: BowlingStats) => (b.wickets ?? 0) - (a.wickets ?? 0) || (a.runs ?? 0) - (b.runs ?? 0);
const batted = (rows: BattingStats[] | undefined) => (rows ?? []).filter(r => (r.ballsFaced ?? 0) > 0 || (r.runsScored ?? 0) > 0);
const bowled = (rows: BowlingStats[] | undefined) => (rows ?? []).filter(r => (r.balls ?? 0) > 0);

/**
 * Which side the result names as the winner, as 1 or 2 in panel order, or undefined for a tie,
 * no result, or wording we cannot pin to a team. CricClubs names the winner by full name
 * ("TOPGUNS UNITED won by 5 Wickets") or by code ("Match tied. TGN won the super over."), so
 * both are accepted. Undefined is the safe answer: it means no card gets the winner's accent.
 */
export function resultWinner(result: string | undefined, teams: { name: string; code?: string }[]): 1 | 2 | undefined {
    // The capture cannot cross a full stop: "Match tied. TGN won" must yield "TGN", not the whole lot.
    const m = /(?:^|[.!]\s+)([^.!]+?)\s+won\b/i.exec((result || '').trim());
    if (!m) return undefined;
    const who = m[1].trim().toLowerCase();
    const i = teams.findIndex(t => [t.name, t.code].some(x => x && x.trim().toLowerCase() === who));
    return i < 0 ? undefined : (i + 1) as 1 | 2;
}

/**
 * The result as a headline: team names title-cased, a winner named by code given its full name,
 * and "5 Wickets" lower-cased. Anything it does not recognise passes through unchanged.
 */
export function resultHeadline(result: string | undefined, teams: { name: string; code?: string }[]): string {
    let s = (result || '').trim();
    if (!s) return 'Match over';
    const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const t of teams) {
        if (!t.name) continue;
        s = s.replace(new RegExp(esc(t.name), 'gi'), tidyName(t.name));
        if (t.code) s = s.replace(new RegExp(`\\b${esc(t.code)}(?=\\s+won\\b)`, 'g'), tidyName(t.name));
    }
    return s.replace(/\bwon by (\d+) (runs?|wickets?)\b/i, (_, n, u) => `won by ${n} ${u.toLowerCase()}`);
}

/**
 * Up to three standout performances, with no one listed twice: CricClubs' own player of the match
 * when it names one, then the top scorer, the best bowling, and the other side's top scorer.
 *
 * ⚠ The player of the match is a full name ("Anand Babu Badrichetty") with no player id, so it is
 * matched to the cards by first and last name. Matched, it shows everything they did; unmatched,
 * it still shows the name CricClubs gave rather than dropping the award.
 */
export function topPerformers(cache: ViewCache, mom?: string, momPic?: string, n = 3): PanelRow[] {
    const bats = [batted(cache.t1Batting).map(r => ({ r, side: 1 })), batted(cache.t2Batting).map(r => ({ r, side: 2 }))].flat();
    const bowls = [...bowled(cache.t1Bowling), ...bowled(cache.t2Bowling)];
    const out: PanelRow[] = [];
    const seen = new Set<string>();
    const add = (key: string, row: PanelRow) => { if (key && !seen.has(key) && out.length < n) { seen.add(key); out.push(row); } };

    const award = (mom || '').trim();
    if (award) {
        const key = award.toLowerCase();
        const bat = bats.find(b => fullName(b.r) === key)?.r;
        const bowl = bowls.find(b => fullName(b) === key);
        const src = bat ?? bowl;
        const words = tidyName(award).split(/\s+/);
        const name = src ? displayName(src) : words.length > 1 ? `${words.slice(0, -1).join(' ')} ${words.at(-1)!.charAt(0)}` : words[0];
        const value = [bat && batFigure(bat), bowl && bowl.balls ? bowlFigure(bowl) : ''].filter(Boolean).join(' · ');
        add(key, { name, value, note: 'Player of the match', pic: imageUrl(src?.profilepic_file_path) ?? imageUrl(momPic), initials: src ? initialsOf(src) : words.map(w => w[0]).join('').slice(0, 2).toUpperCase() });
    }
    const batRow = (r: BattingStats): PanelRow => ({ name: displayName(r), value: batFigure(r), pic: imageUrl(r.profilepic_file_path), initials: initialsOf(r) });
    const top = [...bats].sort((a, b) => byRuns(a.r, b.r))[0];
    if (top) add(fullName(top.r), batRow(top.r));
    const best = [...bowls].sort(byFigures)[0];
    if (best) add(fullName(best), { name: displayName(best), value: bowlFigure(best), pic: imageUrl(best.profilepic_file_path), initials: initialsOf(best) });
    const other = top && bats.filter(b => b.side !== top.side).sort((a, b) => byRuns(a.r, b.r))[0];
    if (other) add(fullName(other.r), batRow(other.r));
    return out;
}

/** One side's card on the result panel: its own total, its own top two batters and its own best bowler. */
function resultTeam(v: CricketAPIValues, cache: ViewCache, n: 1 | 2): ResultTeam {
    const k = n === 1 ? 't1' : 't2';
    const overs = pick(v, cache, `${k}Overs`) || '';
    return {
        team: { ...team(v, cache, n), code: pick(v, cache, `${k}Code`) },
        runs: pick(v, cache, `${k}Total`) || '0',
        wickets: pick(v, cache, `${k}Wickets`) || '0',
        overs: overs ? `${overs.includes('.') ? overs : `${overs}.0`} ov` : '', // CricClubs says "20" for a full innings
        batters: topBatters(n === 1 ? cache.t1Batting : cache.t2Batting, 2),
        bowler: topBowlers(n === 1 ? cache.t1Bowling : cache.t2Bowling, 1)[0],
    };
}

/**
 * Match over: the result as the headline, then a card per side in batting order, then the
 * standout performers across the match.
 *
 * 🛑 Each card holds that side's OWN players — its batters and its bowler. The earlier panel paired
 * a side's batters with the opposition bowler who bowled at them, an innings view that read as if
 * the bowler belonged to the team named above him.
 */
export function matchSummaryPanel(v: CricketAPIValues, cache: ViewCache): PanelEvent {
    const teams: [ResultTeam, ResultTeam] = [resultTeam(v, cache, 1), resultTeam(v, cache, 2)];
    const named = teams.map(t => t.team);
    return {
        type: 'match-summary',
        result: resultHeadline(v.result, named),
        winner: resultWinner(v.result, named),
        teams,
        performers: topPerformers(cache, v.manOfTheMatch, v.momImagePath),
        ...panelMeta(v),
    };
}

/** The panels to rotate through while the match is waiting, in order. Empty during play. */
export function phasePanels(phase: MatchPhase, v: CricketAPIValues, cache: ViewCache): PanelEvent[] {
    if (phase === 'pre') return [lineupPanel(v, cache)];
    if (phase === 'break') return [inningsSummaryPanel(v, cache)];
    if (phase === 'ended') return [matchSummaryPanel(v, cache)];
    return [];
}
