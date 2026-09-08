/**
 * Builds a complete, plausible ball-by-ball match from the recorded CricClubs cards of match 2079
 * (src/mockData.ts), and renders any CricClubs view of it at any point in simulated time.
 * Deterministic for a given seed. No dependencies; runs on Node's native TypeScript support.
 */
import type { BattingStats, BowlingStats, CricketAPIData, Player } from '../src/types.ts';
import { mock_view_1, mock_view_2, mock_view_3, mock_view_4, mock_view_5, mock_view_8, mock_view_48, mock_view_49 } from '../src/mockData.ts';

export interface SimConfig {
    /** simulated seconds before the first ball */
    preMatchSec: number;
    /** simulated seconds between deliveries */
    ballIntervalSec: number;
    /** simulated seconds of innings break */
    breakSec: number;
    seed: number;
    totalOvers: number;
    /** wides sprinkled into each innings */
    extrasPerInnings: number;
}

export const DEFAULT_CONFIG: SimConfig = { preMatchSec: 900, ballIntervalSec: 30, breakSec: 300, seed: 7, totalOvers: 20, extrasPerInnings: 8 };

type V = Record<string, any>;
const v = (d: unknown) => (d as CricketAPIData).values as V;

interface TeamData { name: string; logo: string; players: Player[]; batting: BattingStats[]; bowling: BowlingStats[]; }

function teams(): [TeamData, TeamData] {
    // Data views keep main-match order: team 1 = TOPGUNS UNITED, team 2 = Lions.
    return [
        { name: v(mock_view_8).t1Name, logo: v(mock_view_8).t1Logo, players: v(mock_view_48).t1PlayersList, batting: v(mock_view_2).t1Batting, bowling: v(mock_view_5).t1Bowling },
        { name: v(mock_view_8).t2Name, logo: v(mock_view_8).t2Logo, players: v(mock_view_49).t2PlayersList, batting: v(mock_view_4).t2Batting, bowling: v(mock_view_3).t2Bowling },
    ];
}

function rng(seed: number) {
    let a = seed >>> 0;
    return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Per-ball run values for a batter that reproduce the card's runs, balls, fours and sixes. */
function batterSequence(row: BattingStats, rand: () => number): string[] {
    const out = String((row as V).isOut) === '1';
    const balls = Math.max(0, row.ballsFaced ?? 0);
    const scoring = Math.max(0, balls - (out ? 1 : 0));
    const fours = Math.min(row.fours ?? 0, scoring);
    const sixes = Math.min(row.sixers ?? 0, scoring - fours);
    let rest = Math.max(0, (row.runsScored ?? 0) - 4 * fours - 6 * sixes);
    const n = scoring - fours - sixes;
    const vals = new Array<number>(n).fill(0);
    let guard = 0;
    while (rest > 0 && guard++ < 10000) {
        const i = Math.floor(rand() * n);
        if (n === 0) break;
        if (vals[i] < 3) { vals[i]++; rest--; }
    }
    const codes = [...vals.map(String), ...Array(fours).fill('4'), ...Array(sixes).fill('6')];
    for (let i = codes.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [codes[i], codes[j]] = [codes[j], codes[i]]; }
    if (out) codes.push('W');
    return codes.map(c => (c === '0' ? '.' : c));
}

export interface BatterState { row: BattingStats; runs: number; balls: number; fours: number; sixes: number; out: boolean; outHtml: string; outText: string; seq: string[]; }
export interface BowlerState { row: BowlingStats; balls: number; runs: number; wickets: number; maidens: number; dots: number; wides: number; overRuns: number; }
export interface InningsState {
    battingTeam: 0 | 1;
    total: number; wickets: number; legalBalls: number;
    overBalls: string[];
    batters: BatterState[];           // in batting order
    strikerIdx: number; nonStrikerIdx: number; nextIdx: number;
    bowlers: BowlerState[]; bowlerIdx: number; prevBowlerIdx: number;
    fow: Record<string, number>;
    extras: number;
    lastOut?: BatterState;
    partnership: { runs: number; balls: number; a: number; b: number };
    complete: boolean;
}
export type Phase = 'pre' | 'inn1' | 'break' | 'inn2' | 'ended';
export interface Snapshot { t: number; phase: Phase; inn1: InningsState; inn2: InningsState | null; result: string; }

const clone = <T,>(x: T): T => structuredClone(x);

function startInnings(team: TeamData, bowlingTeam: TeamData, rand: () => number): InningsState {
    // Batting order from the card; rows that never batted (no balls, no dismissal) go last so
    // they only come in if the simulation runs out of recorded batters.
    const batted = (r: BattingStats) => (r.ballsFaced ?? 0) > 0 || String((r as V).isOut) === '1';
    const order = [...team.batting].sort((a, b) => Number(batted(b)) - Number(batted(a)) || (a.battingPosition ?? 99) - (b.battingPosition ?? 99));
    const batters: BatterState[] = order.map(row => ({
        row, runs: 0, balls: 0, fours: 0, sixes: 0, out: false,
        outHtml: (row as V).outStringCustomReq || `<span>b </span><span class='outname'>${bowlingTeam.bowling[0]?.firstName ?? 'Bowler'}</span>`,
        outText: row.outStringNoLink || 'b Bowler',
        seq: batterSequence(row, rand),
    }));
    const bowlers: BowlerState[] = [...bowlingTeam.bowling].sort((a, b) => (b.balls ?? 0) - (a.balls ?? 0))
        .map(row => ({ row, balls: 0, runs: 0, wickets: 0, maidens: 0, dots: 0, wides: 0, overRuns: 0 }));
    return { battingTeam: team === teams()[0] ? 0 : 1, total: 0, wickets: 0, legalBalls: 0, overBalls: [], batters, strikerIdx: 0, nonStrikerIdx: 1, nextIdx: 2, bowlers, bowlerIdx: 0, prevBowlerIdx: -1, fow: {}, extras: 0, partnership: { runs: 0, balls: 0, a: 0, b: 1 }, complete: false };
}

function pickBowler(inn: InningsState, cfg: SimConfig) {
    const quota = (b: BowlerState) => Math.max(1, Math.round((b.row.balls ?? 24) / 6));
    let idx = inn.bowlers.findIndex((b, i) => i !== inn.prevBowlerIdx && Math.floor(b.balls / 6) < quota(b));
    if (idx < 0) idx = inn.bowlers.findIndex((_, i) => i !== inn.prevBowlerIdx);
    if (idx < 0) idx = 0;
    inn.bowlerIdx = idx;
    void cfg;
}

/** Advances one delivery (legal or wide). Returns false when the innings is over. */
function deliver(inn: InningsState, cfg: SimConfig, rand: () => number, wideBudget: { left: number }): boolean {
    if (inn.complete) return false;
    if (inn.legalBalls % 6 === 0 && inn.overBalls.length && inn.overBalls.some(c => c !== '1wd' && c !== 'nb')) {
        // new over: the previous over stays on screen until this first ball; reset now
        inn.overBalls = [];
        [inn.strikerIdx, inn.nonStrikerIdx] = [inn.nonStrikerIdx, inn.strikerIdx];
        inn.bowlers[inn.bowlerIdx].overRuns = 0;
        inn.prevBowlerIdx = inn.bowlerIdx;
        pickBowler(inn, cfg);
    }
    if (inn.legalBalls === 0 && inn.overBalls.length === 0) pickBowler(inn, cfg);
    const bowler = inn.bowlers[inn.bowlerIdx];
    // A batter whose recorded innings is used up (not out) gives the strike to the partner
    if (inn.batters[inn.strikerIdx].seq.length === 0 && inn.batters[inn.nonStrikerIdx].seq.length > 0) {
        [inn.strikerIdx, inn.nonStrikerIdx] = [inn.nonStrikerIdx, inn.strikerIdx];
    }
    const striker = inn.batters[inn.strikerIdx];

    // a wide, sometimes
    if (wideBudget.left > 0 && rand() < wideBudget.left / (cfg.totalOvers * 6)) {
        wideBudget.left--;
        inn.total += 1; inn.extras += 1; bowler.runs += 1; bowler.wides += 1; bowler.overRuns += 1;
        inn.partnership.runs += 1;
        inn.overBalls.push('1wd');
        return true;
    }

    const code = striker.seq.shift() ?? '.';
    inn.legalBalls++; striker.balls++; bowler.balls++; inn.partnership.balls++;
    if (code === 'W') {
        striker.out = true; inn.wickets++; bowler.wickets++; bowler.dots++;
        inn.fow[String(inn.wickets)] = inn.total;
        inn.lastOut = clone(striker);
        inn.overBalls.push('W');
        if (inn.nextIdx < inn.batters.length) {
            inn.strikerIdx = inn.nextIdx++;
            inn.partnership = { runs: 0, balls: 0, a: inn.strikerIdx, b: inn.nonStrikerIdx };
        } else {
            inn.complete = true;
        }
    } else {
        const runs = code === '.' ? 0 : parseInt(code, 10);
        if (runs === 0) bowler.dots++;
        if (code === '4') striker.fours++;
        if (code === '6') striker.sixes++;
        striker.runs += runs; inn.total += runs; bowler.runs += runs; bowler.overRuns += runs; inn.partnership.runs += runs;
        inn.overBalls.push(code);
        if (runs % 2 === 1) [inn.strikerIdx, inn.nonStrikerIdx] = [inn.nonStrikerIdx, inn.strikerIdx];
    }
    if (inn.legalBalls % 6 === 0) {
        if (bowler.overRuns === 0) bowler.maidens++;
    }
    if (inn.legalBalls >= cfg.totalOvers * 6) inn.complete = true;
    if (inn.batters[inn.strikerIdx].seq.length === 0 && inn.batters[inn.nonStrikerIdx].seq.length === 0 && inn.nextIdx >= inn.batters.length) inn.complete = true;
    return true;
}

/** Every state change of the match, in simulated seconds. Serve the last snapshot with t <= now. */
export function buildTimeline(cfg: SimConfig = DEFAULT_CONFIG): Snapshot[] {
    const rand = rng(cfg.seed);
    const [t1, t2] = teams();
    const snaps: Snapshot[] = [];
    let t = 0;
    const inn1 = startInnings(t1, t2, rand);
    snaps.push({ t: 0, phase: 'pre', inn1: clone(inn1), inn2: null, result: '' });
    t = cfg.preMatchSec;
    const wides1 = { left: cfg.extrasPerInnings };
    while (deliver(inn1, cfg, rand, wides1)) { snaps.push({ t, phase: 'inn1', inn1: clone(inn1), inn2: null, result: '' }); t += cfg.ballIntervalSec; }
    const inn2 = startInnings(t2, t1, rand);
    snaps.push({ t, phase: 'break', inn1: clone(inn1), inn2: clone(inn2), result: '' });
    t += cfg.breakSec;
    const wides2 = { left: cfg.extrasPerInnings };
    const target = inn1.total + 1;
    while (deliver(inn2, cfg, rand, wides2)) {
        snaps.push({ t, phase: 'inn2', inn1: clone(inn1), inn2: clone(inn2), result: '' });
        t += cfg.ballIntervalSec;
        if (inn2.total >= target) break;
    }
    const result = inn2.total >= target
        ? `${t2.name} won by ${inn2.batters.length - 1 - inn2.wickets} wicket${inn2.batters.length - 1 - inn2.wickets === 1 ? '' : 's'}`
        : inn2.total === inn1.total ? 'Match tied' : `${t1.name} won by ${inn1.total - inn2.total} run${inn1.total - inn2.total === 1 ? '' : 's'}`;
    snaps.push({ t, phase: 'ended', inn1: clone(inn1), inn2: clone(inn2), result });
    return snaps;
}

export function snapshotAt(timeline: Snapshot[], t: number): Snapshot {
    let s = timeline[0];
    for (const x of timeline) { if (x.t <= t) s = x; else break; }
    return s;
}

// ---------------- payload rendering ----------------

const overs = (balls: number) => `${Math.floor(balls / 6)}.${balls % 6}`;
const rate = (runs: number, balls: number) => (balls ? (runs / (balls / 6)).toFixed(2) : '--.--');
const name = (p: { firstName?: string; lastName?: string }) => `${p.firstName ?? ''} ${(p.lastName ?? '').charAt(0)}`.trim();

function battingCard(inn: InningsState): V[] {
    return inn.batters.map((b, i) => ({
        ...b.row, battingPosition: i + 1, runsScored: b.runs, ballsFaced: b.balls, fours: b.fours, sixers: b.sixes,
        isOut: b.out ? '1' : '0', outStringNoLink: b.out ? b.outText : '', outStringCustomReq: b.out ? b.outHtml : '',
    })).filter((_, i) => i < inn.nextIdx || inn.batters[i].balls > 0);
}
function bowlingCard(inn: InningsState): V[] {
    return inn.bowlers.filter(b => b.balls > 0 || b.wides > 0).map(b => ({ ...b.row, balls: b.balls, runs: b.runs, wickets: b.wickets, maidens: b.maidens, dotBalls: b.dots, wides: b.wides, noBalls: 0 }));
}

/** The default scorebar view (1), with every live field. */
export function fullFrame(s: Snapshot, cfg: SimConfig = DEFAULT_CONFIG): CricketAPIData {
    const [t1, t2] = teams();
    const base = v(mock_view_1);
    const chase = s.phase === 'break' || s.phase === 'inn2' || s.phase === 'ended';
    const inn = (chase && s.inn2) ? s.inn2 : s.inn1;
    const live = s.phase === 'inn1' || s.phase === 'inn2';
    const striker = inn.batters[inn.strikerIdx]; const non = inn.batters[inn.nonStrikerIdx]; const bowler = inn.bowlers[inn.bowlerIdx];
    const target = s.inn1.total + 1;
    const values: V = {
        ...base,
        t1Name: t1.name, t2Name: t2.name, firstLogo: chase ? t2.logo : t1.logo, secondLogo: chase ? t1.logo : t2.logo, t1Logo: t1.logo, t2Logo: t2.logo,
        t1Total: String(s.inn1.total), t1Wickets: String(s.inn1.wickets), t1Overs: overs(s.inn1.legalBalls), t1RR: rate(s.inn1.total, s.inn1.legalBalls),
        t2Total: String(s.inn2?.total ?? 0), t2Wickets: String(s.inn2?.wickets ?? 0), t2Overs: overs(s.inn2?.legalBalls ?? 0), t2RR: rate(s.inn2?.total ?? 0, s.inn2?.legalBalls ?? 0),
        RRR: chase && s.inn2 && s.phase !== 'ended' ? rate(target - s.inn2.total, cfg.totalOvers * 6 - s.inn2.legalBalls) : '--.--',
        isSecondInningsStarted: chase ? 'true' : 'false', isMatchEnded: s.phase === 'ended' ? '1' : '0', result: s.result,
        totalOvers: cfg.totalOvers, toss: base.toss, seriesName: base.seriesName, groundName: base.groundName,
        batsman1Name: name(striker.row), batsman1Runs: String(striker.runs), batsman1Balls: String(striker.balls), batsman1Fours: String(striker.fours), batsman1Sixers: String(striker.sixes), batsman1ID: striker.row.playerID,
        batsman2Name: name(non.row), batsman2Runs: String(non.runs), batsman2Balls: String(non.balls), batsman2Fours: String(non.fours), batsman2Sixers: String(non.sixes), batsman2ID: non.row.playerID,
        bowlerName: live ? name(bowler.row) : '', bowlerRuns: String(bowler.runs), bowlerWickets: String(bowler.wickets), bowlerOvers: overs(bowler.balls), bowlerMaidens: String(bowler.maidens),
        lastOutName: inn.lastOut ? name(inn.lastOut.row) : '', lastOutRuns: inn.lastOut ? String(inn.lastOut.runs) : '', lastOutBalls: inn.lastOut ? String(inn.lastOut.balls) : '', lastOutString: inn.lastOut ? inn.lastOut.outHtml : '',
        currentPartnershipMap: { partnershipTotalRuns: String(inn.partnership.runs), partnershipTotalBalls: String(inn.partnership.balls), partnershipBatsman1ID: String(inn.batters[inn.partnership.a].row.playerID), partnershipBatsman2ID: String(inn.batters[inn.partnership.b].row.playerID), partnershipBatsman1FirstName: inn.batters[inn.partnership.a].row.firstName, partnershipBatsman2FirstName: inn.batters[inn.partnership.b].row.firstName },
        showMsgForScoreNeeded: '', customTextValue: '',
    };
    return { ...(mock_view_1 as CricketAPIData), view: 1, values: values as any, balls: live ? [...inn.overBalls] : [], isSecondInningsStarted: chase, isSuperOver: false } as CricketAPIData;
}

/** A data view, shaped like the real API: live fields dropped, extras added, balls empty. */
export function dataView(s: Snapshot, viewId: number, cfg: SimConfig = DEFAULT_CONFIG): CricketAPIData {
    const [t1, t2] = teams();
    const chase = s.phase !== 'pre' && s.phase !== 'inn1';
    const common: V = {
        isSecondInningsStarted: chase ? 'true' : 'false', isMatchEnded: s.phase === 'ended' ? '1' : '0', result: s.result,
        customTextValue: '', showMsgForScoreNeeded: '', firstnamefirst: 1, totalOvers: cfg.totalOvers,
    };
    const team1: V = { t1Name: t1.name, t1Logo: t1.logo, t1Total: String(s.inn1.total), t1Wickets: String(s.inn1.wickets), t1Overs: overs(s.inn1.legalBalls), t1Extras: String(s.inn1.extras) };
    const team2: V = { t2Name: t2.name, t2Logo: t2.logo, t2Total: String(s.inn2?.total ?? 0), t2Wickets: String(s.inn2?.wickets ?? 0), t2Overs: overs(s.inn2?.legalBalls ?? 0), t2Extras: String(s.inn2?.extras ?? 0) };
    let values: V;
    switch (viewId) {
        case 2: values = { ...common, ...team1, t1Batting: battingCard(s.inn1), partnerShip: s.inn1.fow }; break;
        case 3: values = { ...common, t1Total: team1.t1Total, t2Name: t2.name, t2Logo: t2.logo, t1Extras: team1.t1Extras, t2Bowling: bowlingCard(s.inn1), partnerShip: s.inn1.fow }; break;
        case 4: values = { ...common, ...team2, t2Batting: s.inn2 ? battingCard(s.inn2) : [], partnerShip: s.inn2?.fow ?? {} }; break;
        case 5: values = { ...common, t2Total: team2.t2Total, t1Name: t1.name, t1Logo: t1.logo, t2Extras: team2.t2Extras, t1Bowling: s.inn2 ? bowlingCard(s.inn2) : [], partnerShip: s.inn2?.fow ?? {} }; break;
        case 8: values = { ...common, ...team1, ...team2, t1Batting: battingCard(s.inn1).slice(0, 3), t2Bowling: bowlingCard(s.inn1).slice(0, 3), t2Batting: s.inn2 ? battingCard(s.inn2).slice(0, 3) : [], t1Bowling: s.inn2 ? bowlingCard(s.inn2).slice(0, 3) : [], partnerShip: (s.inn2 ?? s.inn1).fow }; break;
        case 48: values = { ...common, t1Name: t1.name, t1Logo: t1.logo, t1PlayersList: t1.players, t1Players: t1.players.map(p => `${p.firstName} ${p.lastName}`), t1PlayerPics: t1.players.map(p => p.profilepic_file_path) }; break;
        case 49: values = { ...common, t2Name: t2.name, t2Logo: t2.logo, t2PlayersList: t2.players, t2Players: t2.players.map(p => `${p.firstName} ${p.lastName}`), t2PlayerPics: t2.players.map(p => p.profilepic_file_path) }; break;
        default: values = { ...common, ...team1, ...team2, partnerShip: (s.inn2 ?? s.inn1).fow }; // 13/14/15 and unknown
    }
    return { view: viewId, values: values as any, balls: [], isSecondInningsStarted: chase, isSuperOver: false, isAutoSwitchEnabled: 0, displayNickNameOnOverlay: false, sponsorsImgPaths: [], comments: '' } as unknown as CricketAPIData;
}

export const SCOREBAR_VIEWS = new Set([1, 42, 45, 54]);

export function render(s: Snapshot, viewId: number, cfg: SimConfig = DEFAULT_CONFIG): CricketAPIData {
    return SCOREBAR_VIEWS.has(viewId) ? { ...fullFrame(s, cfg), view: viewId } : dataView(s, viewId, cfg);
}
