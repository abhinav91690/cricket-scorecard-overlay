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
        panel: urlParams.get('panel'),
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

/**
 * Whether the side batting now is the one that batted second. The single place this is decided:
 * the bar, event detection, the dismiss-on-score rule and the ?data=1 code all ask here.
 *
 * 🛑 During a super over CricClubs tracks its innings with `isSuperOverSecondInningsStarted`. The one
 * super-over capture (match 2079, after the result) is consistent with `isSecondInningsStarted`
 * staying the MAIN match's flag — "true" — all the way through, in which case reading it names the
 * wrong side for the whole first super-over innings: the bar shows the side not batting, its wickets
 * go unseen, and the data code carries the wrong total. Preferring the super-over flag is right
 * under that reading and changes nothing under the other (a flag that follows the super over),
 * because then the two agree. A live super-over capture would settle which it is.
 */
export function battingSecond(v: { isSecondInningsStarted?: unknown; isSuperOver?: unknown; isSuperOverSecondInningsStarted?: unknown }): boolean {
    const on = (x: unknown) => String(x) === 'true';
    return on(v.isSuperOver) ? on(v.isSuperOverSecondInningsStarted) : on(v.isSecondInningsStarted);
}

/**
 * A team's overs in cricket notation ("0.3").
 *
 * 🛑 In a super over CricClubs sends a BALL COUNT: match 2079's capture has `t1Overs` "6" for a
 * completed one-over super over. Shown as-is, three balls in reads "3 ov", the this-over strip
 * miscounts balls left, and the ?data=1 code turns "3" into 18 balls. A value that already has a
 * decimal point is overs notation and passes through, so this is right in either form.
 *
 * ⚠ Team overs only. There is no evidence for a bowler's figure in a super over, and a plain "1"
 * there could mean an over or a ball, so bowler overs are left exactly as sent.
 */
export function teamOvers(v: { isSuperOver?: unknown }, raw: string | undefined): string {
    const s = (raw ?? '').trim();
    if (!s || String(v.isSuperOver) !== 'true' || s.includes('.')) return s;
    const balls = parseInt(s, 10);
    return Number.isFinite(balls) ? `${Math.floor(balls / 6)}.${balls % 6}` : s;
}

/** The length of the innings being played, in overs: one in a super over. */
export function matchOvers(v: { isSuperOver?: unknown; totalOvers?: number }): number | undefined {
    return String(v.isSuperOver) === 'true' ? 1 : v.totalOvers;
}
