import { Config } from './types';
import pulteHomesLogo from './assets/images/PulteHomes.png';
import perryHomesLogo from './assets/images/PerryHomes.png';

export const CONFIG: Config = {
    REFRESH_RATE: 5000,
    // A view switch applies in under half a second (measured, docs/cricclubs-api.md §2), so after
    // one the overlay reads again almost at once instead of leaving CricClubs' own overlay on the
    // data view for a whole refresh.
    PEEK_FOLLOW_MS: 300,
    // A normal phase needs 4 fast reads (peek, home, peek, home); retries and a late start need
    // up to 8. Past that the feed is stuck, and the normal cadence takes over.
    MAX_FAST_POLLS: 8,
    SWITCH_TIMEOUT_MS: 3000,
    // ?mode=replay reads its simulated match every second. A simulated ball is 30 s apart, so
    // up to x30 every ball is still seen by a read of its own, as a live ball is by a 5 s poll.
    REPLAY_REFRESH_MS: 1000,
    REPLAY_SPEED: 5,        // ~30 minutes toss to result; cards get about 6 s between balls
    REPLAY_MAX_SPEED: 30,
    DEFAULT_CLUB_ID: '1089463', // LPCL
    // Imported so Vite copies and hashes the files into dist/ and resolves the
    // URL relative to the deployed base (a plain '../assets/...' path 404s on
    // GitHub Pages because Vite never copies files outside src/ or public/).
    LOGO_MAP: {
        '1': pulteHomesLogo,
        '2': perryHomesLogo,
    },
    ANALYTICS_ENDPOINT: '/api/collect',
    API_BASE: 'https://cricclubs.com',
};
