import { DOM } from './dom';
import { loadImage, getBallStyleClass } from './utils';
import { CricketAPIData } from './types';

interface LogoSlot {
    /** Last URL we attempted (successfully or not), so a bad URL is only tried once. */
    attemptedUrl: string | null;
}

const logoSlots = {
    team1: { attemptedUrl: null } as LogoSlot,
    team2: { attemptedUrl: null } as LogoSlot,
};

let lastBallState = { balls: '', overs: '' };

/** Test hook: forget cached logos and the last rendered over. */
export function resetUiStateForTests() {
    logoSlots.team1.attemptedUrl = null;
    logoSlots.team2.attemptedUrl = null;
    lastBallState = { balls: '', overs: '' };
}

function getFullLogoUrl(path?: string): string {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) {
        return path;
    }
    return `https://cricclubs.com${path}`;
}

/**
 * Loads one team logo into its <img> if the URL changed since the last attempt.
 * Failures (and empty URLs) are remembered so the same URL isn't retried on every poll.
 */
async function updateTeamLogo(slot: LogoSlot, url: string, target: HTMLImageElement, label: string) {
    if (slot.attemptedUrl === url) return;
    slot.attemptedUrl = url;

    if (!url) {
        target.removeAttribute('src');
        return;
    }

    try {
        const img = await loadImage(url);
        target.src = img.src;
    } catch (error) {
        console.error(`Error loading ${label} logo:`, error);
    }
}

/**
 * Updates the team logos in the DOM based on the API data.
 * Only re-fetches when a logo URL changes; a URL that failed is not retried until it changes.
 * @param data - The full API data object containing logo URLs.
 */
export async function updateTeamLogos(data: CricketAPIData) {
    await Promise.all([
        updateTeamLogo(logoSlots.team1, getFullLogoUrl(data.values.firstLogo), DOM.battingTeamLogo, 'first'),
        updateTeamLogo(logoSlots.team2, getFullLogoUrl(data.values.secondLogo), DOM.bowlingTeamLogo, 'second'),
    ]);
}

/**
 * Updates the ball-by-ball indicator in the UI.
 * @param ballsArray - Array of strings representing recent ball outcomes.
 * @param teamOvers - Current overs string (e.g. "10.2") to determine balls remaining.
 */
export function updateBallByBall(ballsArray: string[], teamOvers: string) {
    const currentBallsJson = JSON.stringify(ballsArray);
    if (currentBallsJson === lastBallState.balls && teamOvers === lastBallState.overs) {
        return;
    }
    lastBallState = { balls: currentBallsJson, overs: teamOvers };

    DOM.ballContainer.innerHTML = '';

    ballsArray.forEach(ballOutcome => {
        const ballIndicator = document.createElement('div');
        ballIndicator.className = `ball-indicator ${getBallStyleClass(ballOutcome)}`;
        ballIndicator.textContent = ballOutcome;
        DOM.ballContainer.appendChild(ballIndicator);
    });

    const ballsRemaining = 6 - (parseInt(teamOvers.split('.')[1] || '0'));
    if (ballsRemaining < 6 || ballsArray.length <= 1) {
        for (let i = 0; i < ballsRemaining; i++) {
            const ballIndicator = document.createElement('div');
            ballIndicator.classList.add('ball-indicator');
            DOM.ballContainer.appendChild(ballIndicator);
        }
    }
}

/**
 * Updates the text content of a DOM element only if it has changed.
 * @param element - The DOM element to update.
 * @param text - The new text content.
 */
function setText(element: HTMLElement | null, text: string) {
    if (element && element.textContent !== text) {
        element.textContent = text;
    }
}

/**
 * Updates the display style of a DOM element only if it has changed.
 * @param element - The DOM element to update.
 * @param display - The new display value (e.g. 'none', 'block', 'flex').
 */
function setDisplay(element: HTMLElement | null, display: string) {
    if (element && element.style.display !== display) {
        element.style.display = display;
    }
}

/**
 * Toggles visibility of an element while preserving its layout space.
 * Uses visibility + opacity so the element still occupies space when hidden.
 * @param element - The DOM element to toggle.
 * @param visible - Whether the element should be visible.
 */
function setVisible(element: HTMLElement | null, visible: boolean) {
    if (!element) return;
    const current = element.classList.contains('is-visible');
    if (visible && !current) {
        element.classList.add('is-visible');
    } else if (!visible && current) {
        element.classList.remove('is-visible');
    }
}

/**
 * Updates the entire scoreboard UI with new data.
 * @param data - The full CricketAPIData object.
 */
export function updateScoreboard(data: CricketAPIData) {
    const { values } = data;

    // Batsman Info
    setText(DOM.batsman1Name, `${values.batsman1Name || 'Batsman 1'} *`);
    setText(DOM.batsman1RunsBalls, `${values.batsman1Runs || '0'} (${values.batsman1Balls || '0'})`);
    setText(DOM.batsman2Name, values.batsman2Name || 'Batsman 2');
    setText(DOM.batsman2RunsBalls, `${values.batsman2Runs || '0'} (${values.batsman2Balls || '0'})`);

    // Bowler Info
    setText(DOM.bowlerName, values.bowlerName || 'Bowler Name');
    setText(DOM.bowlerWicketsRuns, `${values.bowlerWickets || '0'}-${values.bowlerRuns || '0'}`);
    setText(DOM.bowlerOvers, `${values.bowlerOvers || '0.0'}`);

    const isSecondInnings = values.isSecondInningsStarted === "true";

    // Team 1 (Chasing Team in 2nd Innings, Batting Team in 1st)
    const currentTeamName = isSecondInnings ? values.t2Name : values.t1Name;
    const currentTeamScore = isSecondInnings ? values.t2Total : values.t1Total;
    const currentTeamWickets = isSecondInnings ? values.t2Wickets : values.t1Wickets;
    const currentTeamOvers = isSecondInnings ? values.t2Overs : values.t1Overs;

    setText(DOM.teamName, currentTeamName || 'Team 1');
    setText(DOM.teamScore, currentTeamScore || '0');
    setText(DOM.teamWickets, `/ ${currentTeamWickets || '0'}`);
    setText(DOM.teamOvers, `${currentTeamOvers || '0.0'}`);

    if (!isSecondInnings) {
        setVisible(DOM.secondInnings, false);
        setDisplay(DOM.result, 'none');
    } else {
        // Second Team (The team that batted first)
        setText(DOM.secondTeamName, values.t1Name || 'Team 1');
        setText(DOM.secondTeamScore, values.t1Total || '0');
        setText(DOM.secondTeamWickets, values.t1Wickets || '0');
        setText(DOM.secondTeamOvers, `${values.t1Overs || '0.0'}`);

        if (DOM.scoreNeeded) {
            const newHTML = values.showMsgForScoreNeeded || '-';
            if (DOM.scoreNeeded.innerHTML !== newHTML) {
                DOM.scoreNeeded.innerHTML = newHTML;
            }
        }

        const isMatchEnded = values.isMatchEnded === "1";

        setVisible(DOM.secondInnings, true);
        setDisplay(DOM.result, isMatchEnded ? 'flex' : 'none');
        setDisplay(DOM.scoreNeeded, isMatchEnded ? 'none' : 'block');

        if (isMatchEnded) {
            setText(DOM.matchResult, values.result || 'Match Result');
        }
    }

    updateBallByBall(data.balls || [], currentTeamOvers || '0.0');
}
