import { describe, it, expect, beforeEach, vi } from 'vitest';
import { updateScoreboard } from './ui';
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
        expect(DOM.secondInnings.style.display).toBe('flex');
        expect(DOM.secondTeamName.textContent).toBe('India');
    });
});
