import { CricketAPIData, CricketAPIValues } from './types';
import { wicketFallText } from './views';

/**
 * Match events derived by diffing one poll against the previous one. Pure functions; the
 * card queue in cards.ts decides how they are shown.
 */
export type OverlayEvent =
    | { type: 'wicket'; name: string; runs: string; balls: string; dismissal: string; fow: string }
    | { type: 'milestone'; mark: 50 | 100; name: string; runs: string; balls: string; fours: string; sixes: string }
    | { type: 'partnership'; mark: 50 | 100; names: string; runs: string; balls: string }
    | { type: 'boundary'; runs: 4 | 6 };

const num = (v: unknown): number => {
    const n = parseInt(String(v ?? ''), 10);
    return Number.isFinite(n) ? n : 0;
};

const isChase = (v: CricketAPIValues) => String(v.isSecondInningsStarted) === 'true';
const battingWickets = (v: CricketAPIValues) => num(isChase(v) ? v.t2Wickets : v.t1Wickets);

/**
 * CricClubs sends the dismissal as HTML, e.g.
 *   "<span>b </span><span class='outname'>Siva Krishna V</span>"  or  "<span>run out </span><span class='outname'>(Aamir K)</span> "
 * Reduce it to plain text we render ourselves.
 */
export function parseDismissal(html: string | undefined | null): string {
    if (!html) return '';
    return html
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;|&#160;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .replace(/\s+([),.])/g, '$1')
        .trim();
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
    if (wicket) {
        events.push({
            type: 'wicket',
            name: b.lastOutName || 'Wicket',
            runs: String(b.lastOutRuns ?? '0'),
            balls: String(b.lastOutBalls ?? '0'),
            dismissal: parseDismissal(b.lastOutString),
            fow: wicketFallText(battingWickets(b), isChase(b) ? b.t2Total : b.t1Total),
        });
    }

    for (const i of [1, 2] as const) {
        const id = b[`batsman${i}ID`];
        if (id === undefined || id !== a[`batsman${i}ID`]) continue;
        const mark = crossed(num(a[`batsman${i}Runs`]), num(b[`batsman${i}Runs`]));
        if (mark) {
            events.push({
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
            events.push({ type: 'partnership', mark, names: names || 'Partnership', runs: String(pb.partnershipTotalRuns ?? '0'), balls: String(pb.partnershipTotalBalls ?? '0') });
        }
    }

    if (!wicket) {
        const last = newBalls(prev.balls, next.balls).at(-1);
        if (last === '4' || last === '6') events.push({ type: 'boundary', runs: last === '6' ? 6 : 4 });
    }

    return events;
}
