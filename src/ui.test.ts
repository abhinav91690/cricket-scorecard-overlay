import { describe, it, expect, beforeEach, vi } from 'vitest';
import { updateScoreboard, updateTeamLogos, updateBallByBall, resetUiStateForTests } from './ui';
import { DOM } from './dom';

// Simple mock data for elements
const mockElements: Record<string, HTMLElement> = {};

function createMockElement(id: string) {
    const el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
    mockElements[id] = el;
    return el;
}

// Mock valid DOM structure
beforeEach(() => {
    document.body.innerHTML = '';
    createMockElement('batsman1-name');
    createMockElement('batsman1-runs-balls');
    createMockElement('batsman2-name');
    createMockElement('batsman2-runs-balls');
    createMockElement('bowler-name');
    createMockElement('bowler-figures');
    createMockElement('bowler-wickets-runs');
    createMockElement('bowler-overs');
    createMockElement('team-name');
    createMockElement('team-score');
    createMockElement('team-wickets');
    createMockElement('team-overs');

    const secondInnings = createMockElement('secondInnings');
    secondInnings.style.display = 'none';
    createMockElement('second-team-name');
    createMockElement('second-team-score');
    createMockElement('second-team-wickets');
    createMockElement('second-team-overs');
    const result = createMockElement('result');
    result.style.display = 'none';
    createMockElement('match-result');
    createMockElement('score-needed');
    createMockElement('ball-by-ball');
    createMockElement('overlay-image');
    createMockElement('batting-team-logo');
    createMockElement('bowling-team-logo');
    createMockElement('batsman-info');
    createMockElement('bowler-info');
});

// Stub image loading: jsdom never fires onload, so control success/failure per URL.
const loadImageMock = vi.fn();
vi.mock('./utils', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./utils')>();
    return { ...actual, loadImage: (url: string) => loadImageMock(url) };
});

// Mock the DOM module to return our dynamically created elements
vi.mock('./dom', () => {
    return {
        DOM: new Proxy({}, {
            get: (_target, prop: string) => {
                // Map camelCase prop to kebab-case ID if needed, 
                // but our test IDs match the property names mostly, except for casing.
                // Actually the real DOM object has explicit IDs. 
                // Let's just return document.getElementById based on a known map or strict ID.

                const idMap: Record<string, string> = {
                    batsman1Name: 'batsman1-name',
                    batsman1RunsBalls: 'batsman1-runs-balls',
                    batsman2Name: 'batsman2-name',
                    batsman2RunsBalls: 'batsman2-runs-balls',
                    bowlerName: 'bowler-name',
                    bowlerFigures: 'bowler-figures',
                    bowlerWicketsRuns: 'bowler-wickets-runs',
                    bowlerOvers: 'bowler-overs',
                    teamName: 'team-name',
                    teamScore: 'team-score',
                    teamWickets: 'team-wickets',
                    teamOvers: 'team-overs',
                    secondInnings: 'secondInnings', // ID matches prop
                    result: 'result',
                    matchResult: 'match-result',
                    secondTeamName: 'second-team-name',
                    secondTeamScore: 'second-team-score',
                    secondTeamWickets: 'second-team-wickets',
                    secondTeamOvers: 'second-team-overs',
                    scoreNeeded: 'score-needed',
                    ballContainer: 'ball-by-ball',
                    overlayImage: 'overlay-image',
                    battingTeamLogo: 'batting-team-logo',
                    bowlingTeamLogo: 'bowling-team-logo',
                    batsmanInfo: 'batsman-info',
                    bowlerInfo: 'bowler-info',
                };

                return document.getElementById(idMap[prop] || prop);
            }
        })
    };
});

describe('updateScoreboard', () => {
    it('should update batsman info correctly', () => {
        const mockData: any = {
            values: {
                batsman1Name: 'Kohli',
                batsman1Runs: '50',
                batsman1Balls: '30',
                batsman2Name: 'Rohit',
                batsman2Runs: '40',
                batsman2Balls: '25',
                isSecondInningsStarted: 'false',
                t1Name: 'India',
                t1Total: '100',
                t1Wickets: '0',
                t1Overs: '10.0'
            },
            balls: []
        };

        updateScoreboard(mockData);

        expect(DOM.batsman1Name.textContent).toBe('Kohli *');
        expect(DOM.batsman1RunsBalls.textContent).toBe('50 (30)');
        expect(DOM.batsman2Name.textContent).toBe('Rohit');
        expect(DOM.batsman2RunsBalls.textContent).toBe('40 (25)');
    });

    it('should display second innings info when active', () => {
        const mockData: any = {
            values: {
                isSecondInningsStarted: 'true',
                t1Name: 'India',
                t1Total: '200',
                t1Wickets: '5',
                t1Overs: '20.0',
                t2Name: 'Australia',
                t2Total: '50',
                t2Wickets: '1',
                t2Overs: '5.0',
                showMsgForScoreNeeded: 'Need 151 runs',
                isMatchEnded: '0'
            },
            balls: []
        };

        updateScoreboard(mockData);

        expect(DOM.teamName.textContent).toBe('Australia');
        expect(DOM.teamScore.textContent).toBe('50');
        expect(DOM.secondInnings.classList.contains('is-visible')).toBe(true);
        expect(DOM.secondTeamName.textContent).toBe('India');
    });
});

describe('updateScoreboard edge cases', () => {
    const base = { isSecondInningsStarted: 'false', t1Name: 'India', t1Total: '100', t1Wickets: '2', t1Overs: '10.0' };

    it('falls back to placeholders when values are missing', () => {
        updateScoreboard({ values: { ...base, t1Name: '', t1Total: '', t1Wickets: '', t1Overs: '' }, balls: [] } as any);
        expect(DOM.batsman1Name.textContent).toBe('Batsman 1 *');
        expect(DOM.batsman1RunsBalls.textContent).toBe('0 (0)');
        expect(DOM.batsman2Name.textContent).toBe('Batsman 2');
        expect(DOM.bowlerName.textContent).toBe('Bowler Name');
        expect(DOM.bowlerWicketsRuns.textContent).toBe('0-0');
        expect(DOM.bowlerOvers.textContent).toBe('0.0');
        expect(DOM.teamName.textContent).toBe('Team 1');
        expect(DOM.teamScore.textContent).toBe('0');
        expect(DOM.teamWickets.textContent).toBe('/ 0');
        expect(DOM.teamOvers.textContent).toBe('0.0');
    });

    it('hides the second innings bar and result during the first innings', () => {
        updateScoreboard({ values: base, balls: [] } as any);
        expect(DOM.secondInnings.classList.contains('is-visible')).toBe(false);
        expect(DOM.result.style.display).toBe('none');
    });

    it('shows the chase message during the second innings, as HTML', () => {
        updateScoreboard({ values: { ...base, isSecondInningsStarted: 'true', t2Name: 'Aus', t2Total: '20', t2Wickets: '1', t2Overs: '3.2', showMsgForScoreNeeded: '<span>Aus</span> NEED 81', isMatchEnded: '0' }, balls: [] } as any);
        expect(DOM.scoreNeeded.innerHTML).toBe('<span>Aus</span> NEED 81');
        expect(DOM.scoreNeeded.style.display).toBe('block');
        expect(DOM.result.style.display).toBe('none');
        expect(DOM.teamOvers.textContent).toBe('3.2');
        expect(DOM.secondTeamOvers.textContent).toBe('10.0');
    });

    it('shows the result and hides the chase message when the match has ended', () => {
        updateScoreboard({ values: { ...base, isSecondInningsStarted: 'true', t2Name: 'Aus', t2Total: '101', t2Wickets: '3', t2Overs: '18.4', isMatchEnded: '1', result: 'Aus won by 7 wickets' }, balls: [] } as any);
        expect(DOM.result.style.display).toBe('flex');
        expect(DOM.matchResult.textContent).toBe('Aus won by 7 wickets');
        expect(DOM.scoreNeeded.style.display).toBe('none');
        expect(DOM.secondInnings.classList.contains('is-visible')).toBe(true);
    });

    it('goes back to first-innings layout if the feed flips isSecondInningsStarted off', () => {
        updateScoreboard({ values: { ...base, isSecondInningsStarted: 'true', t2Name: 'Aus', isMatchEnded: '1', result: 'x' }, balls: [] } as any);
        updateScoreboard({ values: base, balls: [] } as any);
        expect(DOM.secondInnings.classList.contains('is-visible')).toBe(false);
        expect(DOM.result.style.display).toBe('none');
        expect(DOM.teamName.textContent).toBe('India');
    });

    it('only writes to the DOM when a value changes', () => {
        updateScoreboard({ values: base, balls: [] } as any);
        const spy = vi.spyOn(DOM.teamName, 'textContent', 'set');
        updateScoreboard({ values: base, balls: [] } as any);
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});

describe('updateBallByBall', () => {
    const indicators = () => Array.from(DOM.ballContainer.children).map(el => ({ cls: el.className, text: el.textContent }));

    beforeEach(() => resetUiStateForTests());

    it('renders one styled indicator per ball and pads the rest of the over', () => {
        updateBallByBall(['1', 'W', '4'], '10.3');
        const items = indicators();
        expect(items).toHaveLength(6);
        expect(items.slice(0, 3)).toEqual([
            { cls: 'ball-indicator run-1', text: '1' },
            { cls: 'ball-indicator wicket', text: 'W' },
            { cls: 'ball-indicator run-4', text: '4' },
        ]);
        expect(items.slice(3).every(i => i.cls === 'ball-indicator' && i.text === '')).toBe(true);
    });

    it('does not pad at the end of a completed over', () => {
        updateBallByBall(['.', '1', '2', '4', '6', 'W'], '11.0');
        expect(indicators()).toHaveLength(6);
        expect(indicators().every(i => i.text !== '')).toBe(true);
    });

    it('pads a full over of blanks for the first ball of a new over', () => {
        updateBallByBall(['1'], '12.0');
        expect(indicators()).toHaveLength(7); // the ball just bowled plus 6 blanks (overs still read .0)
    });

    it('extras extend the over beyond six indicators', () => {
        updateBallByBall(['1wd', 'nb', '1', '.', '2', '4', 'W'], '5.5');
        const items = indicators();
        expect(items).toHaveLength(8);
        expect(items[0].cls).toBe('ball-indicator wide');
        expect(items[1].cls).toBe('ball-indicator no-ball');
    });

    it('treats a missing decimal part as the start of an over', () => {
        updateBallByBall(['1'], '7');
        expect(indicators()).toHaveLength(1 + 6);
    });

    it('skips the re-render when balls and overs are unchanged', () => {
        updateBallByBall(['1', '4'], '3.2');
        const first = DOM.ballContainer.firstElementChild;
        updateBallByBall(['1', '4'], '3.2');
        expect(DOM.ballContainer.firstElementChild).toBe(first);
        updateBallByBall(['1', '4', '6'], '3.3');
        expect(DOM.ballContainer.firstElementChild).not.toBe(first);
    });
});

describe('updateTeamLogos', () => {
    // logoSlots is module-level state, so each test uses distinct URLs.
    const data = (firstLogo: string | undefined, secondLogo: string | undefined): any => ({
        values: { firstLogo, secondLogo },
        balls: [],
    });

    beforeEach(() => {
        loadImageMock.mockReset();
        loadImageMock.mockImplementation(async (url: string) => {
            if (url.includes('bad')) throw new Error(`Failed to load image: ${url}`);
            const img = document.createElement('img');
            img.src = url;
            return img;
        });
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('prefixes relative paths with the cricclubs origin and sets the img src', async () => {
        await updateTeamLogos(data('/documentsRep/a.jpg', 'https://cdn.example.com/b.jpg'));

        expect(loadImageMock).toHaveBeenCalledWith('https://cricclubs.com/documentsRep/a.jpg');
        expect(loadImageMock).toHaveBeenCalledWith('https://cdn.example.com/b.jpg');
        expect((DOM.battingTeamLogo as HTMLImageElement).src).toBe('https://cricclubs.com/documentsRep/a.jpg');
        expect((DOM.bowlingTeamLogo as HTMLImageElement).src).toBe('https://cdn.example.com/b.jpg');
    });

    it('does not re-fetch when the URLs are unchanged between polls', async () => {
        await updateTeamLogos(data('/c.jpg', '/d.jpg'));
        await updateTeamLogos(data('/c.jpg', '/d.jpg'));
        await updateTeamLogos(data('/c.jpg', '/d.jpg'));

        expect(loadImageMock).toHaveBeenCalledTimes(2);
    });

    it('retries a failed URL only once, not on every poll', async () => {
        await updateTeamLogos(data('/bad-1.jpg', '/e.jpg'));
        await updateTeamLogos(data('/bad-1.jpg', '/e.jpg'));

        const badCalls = loadImageMock.mock.calls.filter(([url]) => url.includes('bad-1'));
        expect(badCalls).toHaveLength(1);
    });

    it('re-fetches once a failed URL changes to a new one', async () => {
        await updateTeamLogos(data('/bad-2.jpg', '/f.jpg'));
        await updateTeamLogos(data('/g.jpg', '/f.jpg'));

        expect(loadImageMock).toHaveBeenCalledWith('https://cricclubs.com/g.jpg');
        expect((DOM.battingTeamLogo as HTMLImageElement).src).toBe('https://cricclubs.com/g.jpg');
    });

    it('does not attempt to load an empty logo URL', async () => {
        await updateTeamLogos(data(undefined, '/h.jpg'));
        await updateTeamLogos(data(undefined, '/h.jpg'));

        const emptyCalls = loadImageMock.mock.calls.filter(([url]) => url === '');
        expect(emptyCalls).toHaveLength(0);
        expect(DOM.battingTeamLogo.hasAttribute('src')).toBe(false);
    });
});
