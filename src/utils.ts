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
        mode: urlParams.get('mode')
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
export function getBallStyleClass(ballOutcome: string): string {
    const outcome = ballOutcome.toLowerCase();
    if (outcome === 'w') return 'wicket';
    if (outcome === 'wd' || outcome.endsWith('wd')) return 'wide';
    if (outcome === 'nb' || outcome.endsWith('nb')) return 'no-ball';
    if (outcome === '1lb' || outcome.endsWith('lb')) return 'leg-bye';
    if (outcome === '1b' || outcome.endsWith('b')) return 'bye';
    if (outcome === '.') return 'dot';
    if (['1', '2', '3', '4', '5', '6'].includes(outcome)) return `run-${outcome}`;
    return 'ball-default';
}
