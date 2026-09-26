import { CricketAPIData, CricketAPIValues } from './types';
import { wicketFallText } from './views';
import { battingSecond, runsOffBat } from './utils';

/**
 * Match events derived by diffing one poll against the previous one. Pure functions; the
 * card queue in cards.ts decides how they are shown.
 */
export type OverlayEvent =
    | { type: 'wicket'; name: string; runs: string; balls: string; dismissal: string; fow: string }
    | { type: 'milestone'; mark: 50 | 100; name: string; runs: string; balls: string; fours: string; sixes: string }
    // A bowler's five-wicket haul shares the milestone card, so its accent colour — which highlights/
    // reads to identify events (overlay.md §6a) — needs no new entry in the palette contract.
    | { type: 'milestone'; mark: 5; haul: true; name: string; figures: string; overs: string }
    | { type: 'partnership'; mark: 50 | 100; names: string; runs: string; balls: string }
    | { type: 'boundary'; runs: 4 | 6 };

const num = (v: unknown): number => {
    const n = parseInt(String(v ?? ''), 10);
    return Number.isFinite(n) ? n : 0;
};

const isChase = (v: CricketAPIValues) => battingSecond(v);
const battingWickets = (v: CricketAPIValues) => num(isChase(v) ? v.t2Wickets : v.t1Wickets);

/**
 * CricClubs sends the dismissal as HTML, e.g.
 *   "<span>b </span><span class='outname'>Siva Krishna V</span>"  or  "<span>run out </span><span class='outname'>(Aamir K)</span> "
 * Reduce it to plain text we render ourselves.
 */
export function parseDismissal(html: string | undefined | null): string {
    if (!html) return '';
    return decodeEntities(html.replace(/<[^>]*>/g, ' '))
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\s+([),.])/g, '$1')
        // CricClubs marks the keeper with a dagger in its own span: "c † Anand S" reads "c †Anand S".
        // Sometimes it sends no keeper name at all ("c † b Praharsha S", match 4658): leave that gap.
        .replace(/† (?!b\b)/g, '†')
        .trim()
        // No fielder named at all ("c † b X", "c b X"): the catcher was a substitute or not entered.
        .replace(/^c (†?) ?(?=b )/, (_, dagger: string) => `c ${dagger}Sub `);
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

/**
 * CricClubs escapes some characters as entities — a keeper catch arrives as "c &#8224; Anand S"
 * (seen live on match 4651). Decoded by hand, not via innerHTML, so nothing it sends is parsed as HTML.
 */
function decodeEntities(s: string): string {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
        if (e[0] !== '#') return NAMED[e.toLowerCase()] ?? m;
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    });
}

function crossed(prev: number, next: number): 50 | 100 | null {
    if (prev < 100 && next >= 100) return 100;
    if (prev < 50 && next >= 50) return 50;
    return null;
}

/** Balls that appear in `next` but not in `prev`: the tail of the same over, or a whole new over. */
function newBalls(prev: string[] | undefined, next: string[] | undefined): string[] {
    const p = prev ?? [];
    const n = next ?? [];
    const samePrefix = n.length > p.length && p.every((b, i) => n[i] === b);
    if (samePrefix) return n.slice(p.length);
    if (n.length && JSON.stringify(n) !== JSON.stringify(p) && n.length <= p.length) return n; // new over started
    return [];
}

export function detectEvents(prev: CricketAPIData | null, next: CricketAPIData): OverlayEvent[] {
    if (!prev) return [];
    const a = prev.values;
    const b = next.values;
    const events: OverlayEvent[] = [];

    if (String(b.isMatchEnded) === '1') return events;

    // Innings change: the numbers reset, so nothing is comparable this tick. The target itself
    // lives permanently in the team block's status line rather than on a card.
    if (isChase(a) !== isChase(b)) return events;

    const wicket = battingWickets(b) > battingWickets(a);
    // 🛑 Order matters: the bar plays cards first come, first served. The ball's own card goes first
    // (the wicket, or the four or six), then what it led to: a bowler's haul after the wicket, a
    // fifty or a partnership after the boundary that brought it up.
    const after: OverlayEvent[] = [];
    if (wicket) {
        events.push({
            type: 'wicket',
            name: b.lastOutName || 'Wicket',
            runs: String(b.lastOutRuns ?? '0'),
            balls: String(b.lastOutBalls ?? '0'),
            dismissal: parseDismissal(b.lastOutString),
            fow: wicketFallText(battingWickets(b), isChase(b) ? b.t2Total : b.t1Total),
        });
        const haul = fiveFor(a, b);
        if (haul) events.push(haul);
    }

    for (const i of [1, 2] as const) {
        const id = b[`batsman${i}ID`];
        if (id === undefined || id === null || String(id) === '') continue;
        // 🛑 Match the batter by ID across BOTH slots. batsman1 is always the striker, so the pair
        // swap slots on every odd run and at every over's end; comparing slot to slot silently
        // dropped any fifty reached with a single or on an over's last ball (match 4655).
        const j = ([1, 2] as const).find(k => String(a[`batsman${k}ID`]) === String(id));
        if (j === undefined) continue;
        const mark = crossed(num(a[`batsman${j}Runs`]), num(b[`batsman${i}Runs`]));
        if (mark) {
            after.push({
                type: 'milestone', mark,
                name: b[`batsman${i}Name`] || `Batsman ${i}`,
                runs: String(b[`batsman${i}Runs`] ?? '0'),
                balls: String(b[`batsman${i}Balls`] ?? '0'),
                fours: String(b[`batsman${i}Fours`] ?? '0'),
                sixes: String(b[`batsman${i}Sixers`] ?? '0'),
            });
        }
    }

    const pa = a.currentPartnershipMap;
    const pb = b.currentPartnershipMap;
    if (pa && pb && pa.partnershipBatsman1ID === pb.partnershipBatsman1ID && pa.partnershipBatsman2ID === pb.partnershipBatsman2ID) {
        const mark = crossed(num(pa.partnershipTotalRuns), num(pb.partnershipTotalRuns));
        if (mark) {
            const names = [pb.partnershipBatsman1FirstName, pb.partnershipBatsman2FirstName].filter(Boolean).join(' & ');
            after.push({ type: 'partnership', mark, names: names || 'Partnership', runs: String(pb.partnershipTotalRuns ?? '0'), balls: String(pb.partnershipTotalBalls ?? '0') });
        }
    }

    if (!wicket) {
        const last = newBalls(prev.balls, next.balls).at(-1);
        const bat = runsOffBat(last ?? '');
        if (bat === 4 || bat === 6) events.push({ type: 'boundary', runs: bat });
    }

    return [...events, ...after];
}

/** The bowler's fifth wicket, for the same bowler on both polls (matched by ID, or by name). */
function fiveFor(a: CricketAPIValues, b: CricketAPIValues): OverlayEvent | null {
    const same = b.bowlerID ? String(b.bowlerID) === String(a.bowlerID) : !!b.bowlerName && b.bowlerName === a.bowlerName;
    if (!same || num(a.bowlerWickets) >= 5 || num(b.bowlerWickets) < 5) return null;
    return { type: 'milestone', mark: 5, haul: true, name: b.bowlerName || 'Bowler', figures: `${num(b.bowlerWickets)}-${num(b.bowlerRuns)}`, overs: String(b.bowlerOvers ?? '') };
}
