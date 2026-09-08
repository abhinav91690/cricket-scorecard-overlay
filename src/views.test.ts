import { describe, it, expect } from 'vitest';
import { VIEW, matchPhase, desiredView, isFullFrame, stripPii, mergeCache, scoreChanged, displayName, oversFromBalls, fowText, wicketFallText, topBatters, topBowlers, phasePanels, inningsSummaryPanel, imageUrl, initialsOf, roleTag, squadRows, tossInfo, tidyName } from './views';
import { mock_view_1, mock_view_2, mock_view_3, mock_view_4, mock_view_8, mock_view_48 } from './mockData';
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
            expect(inn.score).toBe('188/7'); // from the data views; the scorebar frame says 10/0 (super over)
            expect(inn.teams.map(t => t.name)).toEqual(['TOPGUNS UNITED', 'Lions']); // batted, bowled
            expect(inn.matchOvers).toBe('20 overs');
            expect(inn.series).toBe('2024 Fall Champions');
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
