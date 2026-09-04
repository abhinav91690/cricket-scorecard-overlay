import { Config } from './types';
import pulteHomesLogo from './assets/images/PulteHomes.png';
import perryHomesLogo from './assets/images/PerryHomes.png';

export const CONFIG: Config = {
    REFRESH_RATE: 5000,
    DEFAULT_CLUB_ID: '1089463', // LPCL
    // Imported so Vite copies and hashes the files into dist/ and resolves the
    // URL relative to the deployed base (a plain '../assets/...' path 404s on
    // GitHub Pages because Vite never copies files outside src/ or public/).
    LOGO_MAP: {
        '1': pulteHomesLogo,
        '2': perryHomesLogo,
    },
    ANALYTICS_ENDPOINT: '/api/collect',
};
