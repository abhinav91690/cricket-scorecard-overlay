import { CONFIG } from './config';

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

export async function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
        img.src = url;
    });
}

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
