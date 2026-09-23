import { describe, it, expect } from 'vitest';
import { VIEW, matchPhase, desiredView, isFullFrame, stripPii, mergeCache, scoreChanged, displayName, oversFromBalls, fowText, wicketFallText, topBatters, topBowlers, phasePanels, inningsSummaryPanel, matchSummaryPanel, resultWinner, resultHeadline, topPerformers, imageUrl, initialsOf, roleTag, squadRows, tossInfo, tidyName, runRate, boundaryCount } from './views';
import { mock_view_1, mock_view_2, mock_view_3, mock_view_4, mock_view_5, mock_view_8, mock_view_48 } from './mockData';
import { CricketAPIData } from './types';

const frame = (values: Record<string, unknown>, balls: string[] = [], view = 1) => ({ view, values, balls } as unknown as CricketAPIData);

describe('matchPhase', () => {
    it('classifies pre-match, play, break and ended', () => {
        expect(matchPhase(frame({ isSecondInningsStarted: 'false', t1Overs: '0.0' }))).toBe('pre');
        expect(matchPhase(frame({ isSecondInningsStarted: 'false', t1Overs: '0.1' }, ['1']))).toBe('play');
        expect(matchPhase(frame({ isSecondInningsStarted: 'true', t2Overs: '0.0' }))).toBe('break');
        expect(matchPhase(frame({ isSecondInningsStarted: 'true', t2Overs: '0.0' }, ['4']))).toBe('play');
        expect(matchPhase(frame({ isSecondInningsStarted: 'true', t2Overs: '3.2' }, ['1']))).toBe('play');
        expect(matchPhase(frame({ isMatchEnded: '1', isSecondInningsStarted: 'true', t2Overs: '18.4' }))).toBe('ended');
    });

    it('does not call a live super over an innings break', () => {
        // 🛑 The scorebar swaps to the super-over sides and totals (cricclubs-api.md §3),
        // so between the two super-over innings it looks exactly like an innings break:
        // the chase has started, the "second" side has no overs and no balls are in hand.
        // Reading it as 'break' puts the MAIN match's first innings on air, stale and
        // labelled "1st innings", while a super over is actually being bowled.
        //
        // Shape taken from the real match 2079 capture, wound back to mid-super-over:
        // that fixture has isMatchEnded '1', so the real frame short-circuits to 'ended'
        // and never exposed this.
        const midSuperOver = {
            isSuperOver: 'true', isSuperOverSecondInningsStarted: 'false',
            isMatchEnded: '0', isSecondInningsStarted: 'true',
            t1Name: 'Lions', t1Total: '10', t1Wickets: '0', t1Overs: '6',
            t2Name: 'TOPGUNS UNITED', t2Total: '0', t2Wickets: '0', t2Overs: '0',
        };
        expect(matchPhase(frame(midSuperOver))).toBe('play');
        // Mid-innings of the super over, with a ball in hand, is play either way.
        expect(matchPhase(frame({ ...midSuperOver, t2Overs: '3' }, ['4']))).toBe('play');
        // A finished super over is still 'ended' — the real 2079 frame, unchanged.
        expect(matchPhase(mock_view_1 as CricketAPIData)).toBe('ended');
        // And the boolean form of the flag, which types.ts also allows.
        expect(matchPhase(frame({ ...midSuperOver, isSuperOver: true }))).toBe('play');
    });

    it('still reports a normal innings break when no super over is involved', () => {
        expect(matchPhase(frame({ isSuperOver: 'false', isSecondInningsStarted: 'true', t2Overs: '0.0' }))).toBe('break');
    });
});

describe('isFullFrame', () => {
    it('is true only for scorebar views, using live captures', () => {
        expect(isFullFrame(mock_view_1 as CricketAPIData)).toBe(true);
        expect(isFullFrame(mock_view_2 as CricketAPIData)).toBe(false);
        expect(isFullFrame(mock_view_8 as CricketAPIData)).toBe(false);
        expect(isFullFrame(mock_view_48 as CricketAPIData)).toBe(false);
    });
});

describe('desiredView', () => {
    const full = (phaseValues: Record<string, unknown>, view = 1) => frame({ batsman1Name: 'x', ...phaseValues }, [], view);

    it('always comes home to the scorebar after a peek', () => {
        expect(desiredView(mock_view_2 as CricketAPIData, 'play', {})).toBe(VIEW.scorebar);
        expect(desiredView(mock_view_48 as CricketAPIData, 'pre', {})).toBe(VIEW.scorebar);
    });

    it('never leaves the scorebar during play', () => {
        expect(desiredView(full({}), 'play', {})).toBeNull();
    });

    it('peeks each squad once before the match', () => {
        expect(desiredView(full({}), 'pre', {})).toBe(VIEW.team1);
        expect(desiredView(full({}), 'pre', { t1PlayersList: [] as any })).toBe(VIEW.team2);
        expect(desiredView(full({}), 'pre', { t1PlayersList: [] as any, t2PlayersList: [] as any })).toBeNull();
    });

    it('peeks the first-innings cards at the break and the second-innings cards at the end', () => {
        expect(desiredView(full({}), 'break', {})).toBe(VIEW.batting1);
        expect(desiredView(full({}), 'break', { t1Batting: [{}] as any })).toBe(VIEW.bowling1);
        const firstInnings = { t1Batting: [{}] as any, t2Bowling: [{}] as any }; // team 1 batted, team 2 bowled
        expect(desiredView(full({}), 'break', firstInnings)).toBeNull();
        expect(desiredView(full({}), 'break', { t1Batting: [{}] as any, t1Bowling: [{}] as any })).toBe(VIEW.bowling1); // wrong bowling side is not enough
        expect(desiredView(full({}), 'ended', firstInnings)).toBe(VIEW.batting2);
        expect(desiredView(full({}), 'ended', { ...firstInnings, t2Batting: [{}] as any })).toBe(VIEW.bowling2);
        expect(desiredView(full({}), 'ended', { ...firstInnings, t2Batting: [{}] as any, t1Bowling: [{}] as any })).toBeNull();
    });
});

describe('stripPii', () => {
    it('removes email from every player row and nothing else', () => {
        const data = frame({ t1Batting: [{ firstName: 'A', email: 'a@b.c', runsScored: 1 }], t2Bowling: [{ email: 'x' }], t1PlayersList: [{ email: 'y', playingRole: 'Batter' }] });
        stripPii(data);
        expect(JSON.stringify(data)).not.toContain('email');
        expect((data.values as any).t1Batting[0]).toEqual({ firstName: 'A', runsScored: 1 });
    });

    it('removes email from anywhere in the payload, not just the known keys', () => {
        // 🛑 The key list was correct for every documented view, but a new CricClubs view
        // with a new row-bearing key would have leaked emails silently onto a public
        // broadcast — nobody would notice until someone paused the stream. So the strip
        // walks the payload instead of trusting a list.
        const data = frame({
            someNewCardView: [{ firstName: 'B', email: 'leak@example.com' }],   // unknown key
            nested: { deeper: { players: [{ email: 'deep@example.com' }] } },   // nested
            t1Batting: [{ firstName: 'A', email: 'a@b.c', runsScored: 1 }],     // known key
        });
        (data as any).overlayConfig = { contact: { email: 'club@example.com' } };  // outside values
        stripPii(data);
        expect(JSON.stringify(data)).not.toContain('email');
        expect(JSON.stringify(data)).not.toContain('example.com');
        // everything that is not PII survives untouched
        expect((data.values as any).someNewCardView[0]).toEqual({ firstName: 'B' });
        expect((data.values as any).t1Batting[0]).toEqual({ firstName: 'A', runsScored: 1 });
    });

    it('does not loop forever on a cyclic payload', () => {
        const data = frame({ t1Batting: [{ email: 'a@b.c' }] });
        (data.values as any).self = data;      // defensive: JSON should never do this
        stripPii(data);
        expect(JSON.stringify((data.values as any).t1Batting)).not.toContain('email');
    });
});

describe('mergeCache', () => {
    it('accumulates cards, squads and extras across views', () => {
        let cache = mergeCache({}, mock_view_2 as CricketAPIData);
        expect(cache.t1Batting?.length).toBeGreaterThan(5);
        expect(cache.t1Extras).toBe('11');
        cache = mergeCache(cache, mock_view_3 as CricketAPIData);
        expect(cache.t2Bowling?.length).toBeGreaterThan(0);
        expect(cache.t1Batting?.length).toBeGreaterThan(5); // still there
        cache = mergeCache(cache, mock_view_48 as CricketAPIData);
        expect(cache.t1PlayersList?.length).toBeGreaterThan(5);
        expect(cache.t1Name).toBe('TOPGUNS UNITED'); // from the data view, not the scorebar frame
        expect(cache.t1Total).toBe('188'); // main-match total, not the super-over 10
        expect(mergeCache({}, mock_view_1 as CricketAPIData).t1Name).toBeUndefined();
    });

    it('ignores empty card lists so the summary is peeked again once the side has batted', () => {
        const atBreak = frame({ t1Batting: [{ firstName: 'A' }], t2Bowling: [{ firstName: 'B' }], t2Batting: [], t1Bowling: [] }, [], 8);
        const c = mergeCache({}, atBreak);
        expect(c.t1Batting).toHaveLength(1);
        expect(c.t2Batting).toBeUndefined();
        expect(c.t1Bowling).toBeUndefined();
        expect(desiredView(frame({ batsman1Name: 'x' }), 'ended', c)).toBe(VIEW.batting2);
    });

    it('files fall of wickets under the view\'s team, not the current innings', () => {
        const c = mergeCache(mergeCache({}, mock_view_2 as CricketAPIData), mock_view_4 as CricketAPIData);
        expect(c.fow1).toEqual(mock_view_2.values.partnerShip);
        expect(c.fow2).toEqual(mock_view_4.values.partnerShip);
        expect(c.fow1).not.toEqual(c.fow2);
    });
});

describe('scoreChanged', () => {
    const base = { isSecondInningsStarted: 'false', t1Total: '70', t1Wickets: '1', t1Overs: '5.0' };
    it('is false on the first frame and for unrelated changes', () => {
        expect(scoreChanged(null, frame(base))).toBe(false);
        expect(scoreChanged(frame(base, ['1']), frame({ ...base, bowlerName: 'new' }, ['1']))).toBe(false);
    });
    it('is true for a new ball, runs, a wicket, more overs or an innings change', () => {
        expect(scoreChanged(frame(base, ['1']), frame(base, ['1', '.']))).toBe(true);
        expect(scoreChanged(frame(base), frame({ ...base, t1Total: '74' }))).toBe(true);
        expect(scoreChanged(frame(base), frame({ ...base, t1Wickets: '2' }))).toBe(true);
        expect(scoreChanged(frame(base), frame({ ...base, t1Overs: '5.1' }))).toBe(true);
        expect(scoreChanged(frame(base), frame({ ...base, isSecondInningsStarted: 'true' }))).toBe(true);
    });
});

describe('formatting helpers', () => {
    it('names, overs, fall of wickets', () => {
        expect(displayName({ firstName: 'Pavan', lastName: 'Vakkalam' })).toBe('Pavan V');
        expect(displayName({ firstName: 'Pavan', lastName: 'Vakkalam', shortName: 'PV' })).toBe('PV');
        expect(oversFromBalls(25)).toBe('4.1');
        expect(oversFromBalls(undefined)).toBe('0.0');
        expect(fowText({ '2': 21, '1': 14, '10': 99 })).toBe('1-14, 2-21, 10-99');
        expect(fowText(undefined)).toBe('');
        expect(wicketFallText(1, '14')).toBe('1st wkt · 14/1');
        expect(wicketFallText(2, '21')).toBe('2nd wkt · 21/2');
        expect(wicketFallText(3, '24')).toBe('3rd wkt · 24/3');
        expect(wicketFallText(11, '100')).toBe('11th wkt · 100/11');
    });

    it('ranks batters by runs and bowlers by wickets then economy, from live rows', () => {
        const batters = topBatters(mock_view_2.values.t1Batting as any);
        expect(batters).toHaveLength(3);
        expect(batters[0].value).toMatch(/^\d+ \(\d+\)$/);
        const runs = batters.map(b => parseInt(b.value));
        expect(runs).toEqual([...runs].sort((a, b) => b - a));
        const bowlers = topBowlers(mock_view_3.values.t2Bowling as any);
        expect(bowlers[0].value).toMatch(/^\d+-\d+$/);
        expect(bowlers[0].note).toMatch(/ov$/);
    });
});

describe('people helpers', () => {
    it('resolves pictures, skips placeholders, builds initials and role tags', () => {
        expect(imageUrl('/documentsRep/profilePics/abc.jpeg')).toBe('https://cricclubs.com/documentsRep/profilePics/abc.jpeg');
        expect(imageUrl('/documentsRep/profilePics/no_image.png')).toBeUndefined();
        expect(imageUrl('https://static.cricclubs.com/utilsv2/img/icons/no-image-team3.jpg')).toBeUndefined();
        expect(imageUrl('')).toBeUndefined();
        expect(initialsOf({ firstName: 'Pavan', lastName: 'Vakkalam' })).toBe('PV');
        expect(initialsOf({})).toBe('?');
        expect(roleTag('Wicket Keeper')).toBe('WK');
        expect(roleTag('All Rounder')).toBe('AR');
        expect(roleTag('Bowler')).toBe('BOWL');
        expect(roleTag('Batter')).toBe('BAT');
        expect(roleTag(undefined)).toBe('');
        const rows = squadRows(mock_view_48.values.t1PlayersList as any);
        expect(rows.length).toBeGreaterThan(5);
        expect(rows[0]).toMatchObject({ initials: expect.stringMatching(/^[A-Z]{1,2}$/) });
        expect(rows.every(r => r.note === undefined)).toBe(true); // no role marks
        expect(rows.map(r => r.name)).toEqual([...rows.map(r => r.name)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
        expect(squadRows([{ firstName: 'A', lastName: 'B', isCaptain: true } as any])[0].captain).toBe(true);
    });
});

describe('phasePanels', () => {
    it('builds the right set per phase and nothing during play', () => {
        const cache = mergeCache(mergeCache(mergeCache({}, mock_view_2 as CricketAPIData), mock_view_3 as CricketAPIData), mock_view_48 as CricketAPIData);
        const v = (mock_view_1 as CricketAPIData).values;
        expect(phasePanels('play', v, cache)).toEqual([]);
        expect(phasePanels('pre', v, cache).map(p => p.type)).toEqual(['lineup']);
        const lineup = phasePanels('pre', v, cache)[0];
        if (lineup.type === 'lineup') {
            expect(lineup.teams[0].name).toBe('TOPGUNS UNITED'); // roster, crest and name from the same source
            expect(lineup.teams[0].players.length).toBeGreaterThan(10);
            expect(lineup.teams[1].players).toEqual([]); // team 2 squad not cached yet
            expect(lineup.toss).toBe('Topguns United elected to bat');
            expect(lineup.teams.map(t => t.role)).toEqual(['Batting', 'Fielding']);
            expect(lineup.matchOvers).toBe('20 overs');
            expect(lineup.series).toBe('2024 Fall Champions');
        }
        expect(phasePanels('break', v, cache).map(p => p.type)).toEqual(['innings-summary']);
        expect(phasePanels('ended', v, cache).map(p => p.type)).toEqual(['match-summary']);
        const inn = inningsSummaryPanel(v, cache);
        expect(inn.type).toBe('innings-summary');
        if (inn.type === 'innings-summary') {
            expect([inn.runs, inn.wickets, inn.overs]).toEqual(['188', '7', '20.0 ov']); // from the data views; the scorebar frame says 10/0 (super over)
            expect(inn.team.name).toBe('TOPGUNS UNITED');
            expect(inn.target).toBe('189');
            expect(inn.runRate).toBe('9.40');
            expect(Number(inn.fours)).toBeGreaterThan(0);
            expect(inn.eyebrow).toBe('Innings break · 1st innings');
            expect(inn.batters.length).toBe(3);
            expect(inn.batters[0].initials).toMatch(/^[A-Z]{1,2}$/);
            expect(inn.fow).toContain('1-');
        }
    });
});

describe('tossInfo', () => {
    it('shortens the CricClubs wording and works out who bats first', () => {
        expect(tossInfo('TOPGUNS UNITED WON THE TOSS AND ELECTED TO BAT', 'Lions', 'TOPGUNS UNITED')).toEqual({ headline: 'Topguns United elected to bat', batting: 2 });
        expect(tossInfo('Lions WON THE TOSS AND ELECTED TO BOWL', 'Lions', 'TOPGUNS UNITED')).toEqual({ headline: 'Lions elected to bowl', batting: 2 });
        expect(tossInfo('Lions won the toss and chose to field', 'Lions', 'Stags')).toEqual({ headline: 'Lions elected to bowl', batting: 2 });
        expect(tossInfo('Stags won the toss and elected to bat', 'Lions', 'Stags')).toEqual({ headline: 'Stags elected to bat', batting: 2 });
    });
    it('keeps unknown wording and leaves the batting side undecided', () => {
        expect(tossInfo(undefined, 'A', 'B')).toEqual({ headline: 'Toss to come' });
        expect(tossInfo('', 'A', 'B')).toEqual({ headline: 'Toss to come' });
        expect(tossInfo('Toss delayed by rain', 'A', 'B')).toEqual({ headline: 'Toss delayed by rain' });
        expect(tossInfo('Hutto Hippos WON THE TOSS AND ELECTED TO BAT', 'Lions', 'Stags')).toEqual({ headline: 'Hutto Hippos elected to bat', batting: undefined });
    });
    it('title-cases only all-caps names', () => {
        expect(tidyName('TOPGUNS UNITED')).toBe('Topguns United');
        expect(tidyName('Hutto Hippos')).toBe('Hutto Hippos');
        expect(tidyName('LPCL')).toBe('Lpcl');
    });
});

describe('innings tiles', () => {
    it('computes the run rate from the total and overs', () => {
        expect(runRate('181', '20.0')).toBe('9.05');
        expect(runRate('47', '5.3')).toBe('8.55');
        expect(runRate('0', '0.0')).toBe('');
        expect(runRate(undefined, undefined)).toBe('');
    });
    it('adds up boundaries across a batting card', () => {
        expect(boundaryCount([{ fours: 2, sixers: 1 }, { fours: 3, sixers: 0 }, {}] as any)).toEqual({ fours: 5, sixes: 1 });
        expect(boundaryCount(undefined)).toEqual({ fours: 0, sixes: 0 });
    });
});

describe('result card', () => {
    const teams = [{ name: 'TOPGUNS UNITED', code: 'TGN' }, { name: 'Lions', code: 'LNS' }];

    it('finds the winner by full name or by team code', () => {
        expect(resultWinner('TOPGUNS UNITED won by 5 Wickets', teams)).toBe(1);
        expect(resultWinner('Lions won by 12 runs', teams)).toBe(2);
        // the real 2079 wording names the winner by code, after a tie
        expect(resultWinner('Match tied. TGN won the super over.', teams)).toBe(1);
    });

    it('marks no winner when the result cannot be pinned to a side', () => {
        expect(resultWinner('Match tied', teams)).toBeUndefined();
        expect(resultWinner('No result', teams)).toBeUndefined();
        expect(resultWinner('Hippos won by 3 runs', teams)).toBeUndefined();   // not either side
        expect(resultWinner(undefined, teams)).toBeUndefined();
    });

    it('turns the CricClubs wording into a headline', () => {
        expect(resultHeadline('TOPGUNS UNITED won by 5 Wickets', teams)).toBe('Topguns United won by 5 wickets');
        expect(resultHeadline('Match tied. TGN won the super over.', teams)).toBe('Match tied. Topguns United won the super over.');
        expect(resultHeadline('Lions won by 12 Runs', teams)).toBe('Lions won by 12 runs');
        expect(resultHeadline('', teams)).toBe('Match over');
        // a code not followed by "won" is left alone
        expect(resultHeadline('TGN v LNS abandoned', teams)).toBe('TGN v LNS abandoned');
    });

    // The real match 2079 cards: TOPGUNS UNITED 188 v Lions 188, then a super over.
    const cache = [mock_view_2, mock_view_3, mock_view_4, mock_view_5, mock_view_8]
        .reduce((c, v) => mergeCache(c, stripPii(v as CricketAPIData)), {} as ReturnType<typeof mergeCache>);
    const scorebar = (mock_view_1 as CricketAPIData).values;

    it('fills each card with that side\'s OWN batters and bowler', () => {
        // 🛑 The old panel put the opposition bowler under each side, which read as if he
        // belonged to the team named above him.
        const p = matchSummaryPanel(scorebar, cache);
        if (p.type !== 'match-summary') throw new Error('wrong panel');
        const own = (rows: { firstName?: string; lastName?: string }[] | undefined) =>
            new Set((rows ?? []).map(r => displayName(r)));
        const t1 = own([...(cache.t1Batting ?? []), ...(cache.t1Bowling ?? [])]);
        const t2 = own([...(cache.t2Batting ?? []), ...(cache.t2Bowling ?? [])]);
        const card1 = [...p.teams[0].batters, p.teams[0].bowler!].map(r => r.name);
        const card2 = [...p.teams[1].batters, p.teams[1].bowler!].map(r => r.name);
        expect(card1.every(n => t1.has(n))).toBe(true);
        expect(card2.every(n => t2.has(n))).toBe(true);
        expect(p.teams[0].batters).toHaveLength(2);
    });

    it('takes names, codes and totals from the data views, not the swapped super-over scorebar', () => {
        const p = matchSummaryPanel(scorebar, cache);
        if (p.type !== 'match-summary') throw new Error('wrong panel');
        // the scorebar frame says Lions/LNS 10 first; the main match was TOPGUNS UNITED 188 first
        expect(p.teams.map(t => [t.team.name, t.team.code, t.runs])).toEqual([['TOPGUNS UNITED', 'TGN', '188'], ['Lions', 'LNS', '188']]);
        expect(p.teams[0].overs).toBe('20.0 ov');
        expect(p.winner).toBe(1);   // "TGN won the super over", resolved through the code
        expect(p.result).toBe('Match tied. Topguns United won the super over.');
        expect(p.ground).toBe('LPCL-G1');
    });

    it('leads the performers with CricClubs\' own player of the match, and lists nobody twice', () => {
        const perf = topPerformers(cache, 'Anand Babu Badrichetty');
        expect(perf[0].note).toBe('Player of the match');
        expect(perf[0].name).toMatch(/^Anand Babu/);
        expect(perf.length).toBeLessThanOrEqual(3);
        expect(new Set(perf.map(p => p.name)).size).toBe(perf.length);
    });

    it('still shows an award it cannot match to a card, rather than dropping it', () => {
        const perf = topPerformers({}, 'Rakesh Gopishetty');
        expect(perf).toEqual([{ name: 'Rakesh G', value: '', note: 'Player of the match', pic: undefined, initials: 'RG' }]);
    });

    it('without an award: top scorer, best bowling, then the other side\'s top scorer', () => {
        const perf = topPerformers({
            t1Batting: [{ firstName: 'A', lastName: 'One', runsScored: 70, ballsFaced: 40 }, { firstName: 'B', lastName: 'Two', runsScored: 20, ballsFaced: 15 }] as any,
            t2Batting: [{ firstName: 'C', lastName: 'Three', runsScored: 45, ballsFaced: 30 }] as any,
            t1Bowling: [{ firstName: 'D', lastName: 'Four', wickets: 4, runs: 20, balls: 24 }] as any,
            t2Bowling: [{ firstName: 'E', lastName: 'Five', wickets: 2, runs: 30, balls: 24 }] as any,
        });
        expect(perf.map(p => [p.name, p.value])).toEqual([['A O', '70 (40)'], ['D F', '4-20 (4.0)'], ['C T', '45 (30)']]);
    });

    it('lists nothing when no cards have been peeked yet', () => {
        expect(topPerformers({})).toEqual([]);
    });
});
