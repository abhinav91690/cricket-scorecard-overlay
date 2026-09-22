import { CONFIG } from './config';

/**
 * Parses query parameters from the URL.
 * @returns An object containing the parsed query parameters (matchId, clubId, logo, debug, theme, mode).
 */
export function getQueryParams() {
    const urlParams = new URLSearchParams(window.location.search);
    return {
        matchId: urlParams.get('matchId'),
        clubId: urlParams.get('clubId') || CONFIG.DEFAULT_CLUB_ID,
        logo: urlParams.get('logo'),
        debug: urlParams.get('debug'), // Returns string value or null
        theme: urlParams.get('theme'),
        mode: urlParams.get('mode'),
        quiet: urlParams.has('quiet'),
        card: urlParams.get('card'),
        // ?data=1 draws the machine-readable code for highlights/. Off by default, so a
        // normal browser source never shows it.
        data: urlParams.has('data') && urlParams.get('data') !== '0',
    };
}

/**
 * Loads an image from a given URL.
 * @param url - The URL of the image to load.
 * @returns A promise that resolves with the loaded HTMLImageElement.
 * @throws Will reject the promise if the image fails to load.
 */
export async function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
        img.src = url;
    });
}

/**
 * Determines the CSS class for a cricket ball based on its outcome.
 * @param ballOutcome - The string representation of the ball's outcome (e.g., "4", "W", "1wd").
 * @returns The corresponding CSS class name for the ball.
 */
/**
 * Runs scored off the bat for a CricClubs ball string, or 0 when none were.
 *
 * This matters because a boundary off an illegal delivery arrives fused with the
 * penalty: a six off a no-ball reads `7nb`, not `6`. Exact-matching `'6'` missed it,
 * so neither the six card nor the ball colour fired and the highlight tool never saw
 * the shot. Scorers are inconsistent about whether they include the penalty, so both
 * conventions are accepted: `6nb` and `7nb` are both a six.
 *
 * Wides, byes and leg-byes score nothing off the bat however many runs they carry, so
 * a boundary from one is not a batting boundary.
 */
export function runsOffBat(ballOutcome: string): number {
    const o = (ballOutcome || '').toLowerCase().trim();
    if (o === 'w' || o === '.' || o === '') return 0;
    if (o.endsWith('wd') || o.endsWith('lb') || (o.endsWith('b') && !o.endsWith('nb'))) return 0;
    const n = parseInt(o, 10);
    if (!Number.isFinite(n)) return 0;
    if (o.endsWith('nb')) {
        if (n === 6 || n === 7) return 6;   // with or without the one-run penalty
        if (n === 4 || n === 5) return 4;
        return 0;
    }
    return /^\d+$/.test(o) ? n : 0;
}

export function getBallStyleClass(ballOutcome: string): string {
    const outcome = ballOutcome.toLowerCase();
    if (outcome === 'w') return 'wicket';
    // A boundary off a no-ball is coloured as the boundary, because that is the notable
    // thing; the disc still prints the raw outcome, so "7nb" stays legible.
    if (outcome.endsWith('nb')) {
        const bat = runsOffBat(outcome);
        if (bat === 4 || bat === 6) return `run-${bat}`;
    }
    if (outcome === 'wd' || outcome.endsWith('wd')) return 'wide';
    if (outcome === 'nb' || outcome.endsWith('nb')) return 'no-ball';
    if (outcome === '1lb' || outcome.endsWith('lb')) return 'leg-bye';
    if (outcome === '1b' || outcome.endsWith('b')) return 'bye';
    if (outcome === '.') return 'dot';
    if (['1', '2', '3', '4', '5', '6'].includes(outcome)) return `run-${outcome}`;
    return 'ball-default';
}

