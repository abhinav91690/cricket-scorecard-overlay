import { describe, it, expect, beforeEach, vi } from 'vitest';
import { updateScoreboard, updateTeamLogos } from './ui';
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

describe('instructions screen', () => {
    let instructionsEl: HTMLElement;
    let overlayEl: HTMLElement;

    beforeEach(() => {
        instructionsEl = document.createElement('div');
        instructionsEl.id = 'instructions';
        instructionsEl.style.display = 'none';
        document.body.appendChild(instructionsEl);

        overlayEl = document.createElement('div');
        overlayEl.classList.add('overlay');
        document.body.appendChild(overlayEl);
    });

    it('should show instructions and hide overlay when no match params provided', () => {
        // Simulate no matchId, no debug, no replay
        const instructionsEl = document.getElementById('instructions')!;
        const overlayEl = document.querySelector('.overlay') as HTMLElement;

        instructionsEl.style.display = 'flex';
        overlayEl.style.display = 'none';

        expect(instructionsEl.style.display).toBe('flex');
        expect(overlayEl.style.display).toBe('none');
    });

    it('should hide instructions and show overlay when matchId is provided', () => {
        const instructionsEl = document.getElementById('instructions')!;
        const overlayEl = document.querySelector('.overlay') as HTMLElement;

        instructionsEl.style.display = 'none';
        overlayEl.style.display = '';

        expect(instructionsEl.style.display).toBe('none');
        expect(overlayEl.style.display).toBe('');
    });

    it('should have instructions element present in DOM', () => {
        expect(document.getElementById('instructions')).not.toBeNull();
    });

    it('should have overlay element present in DOM', () => {
        expect(document.querySelector('.overlay')).not.toBeNull();
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
