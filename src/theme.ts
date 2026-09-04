import { CONFIG } from './config';
import { DOM } from './dom';
import './css/broadcast-base.css';
import './css/theme-classic.css';
import './css/theme-modern.css';
import './css/theme-neon.css';
import './css/theme-kkr.css';
import './css/theme-rcb.css';
import './css/theme-mi.css';
import './css/theme-csk.css';
import './css/theme-dc.css';
import './css/theme-rr.css';
import './css/theme-srh.css';
import './css/theme-pbks.css';
import './css/theme-gt.css';
import './css/theme-lsg.css';
import './css/theme-tel.css';
import './css/theme-ted.css';
import './css/theme-tul.css';
import './css/theme-tud.css';

/**
 * `standalone` themes ship a complete stylesheet of their own.
 * `broadcast` themes are a block of colour tokens layered on `broadcast-base.css`,
 * which is activated by the `skin-broadcast` class on <body>.
 */
const THEMES = {
    classic: 'standalone',
    modern: 'standalone',
    neon: 'standalone',
    kkr: 'broadcast',
    rcb: 'broadcast',
    mi: 'broadcast',
    csk: 'broadcast',
    dc: 'broadcast',
    rr: 'broadcast',
    srh: 'broadcast',
    pbks: 'broadcast',
    gt: 'broadcast',
    lsg: 'broadcast',
    tel: 'broadcast',
    ted: 'broadcast',
    tul: 'broadcast',
    tud: 'broadcast',
} as const satisfies Record<string, 'standalone' | 'broadcast'>;

export type ThemeName = keyof typeof THEMES;

export const AVAILABLE_THEMES = Object.keys(THEMES) as ThemeName[];
const DEFAULT_THEME: ThemeName = 'modern';
const BROADCAST_SKIN_CLASS = 'skin-broadcast';

function isThemeName(theme: string | null): theme is ThemeName {
    return theme !== null && Object.prototype.hasOwnProperty.call(THEMES, theme);
}

/**
 * Applies the selected theme to <body>, falling back to the default for unknown names.
 * @param theme - The theme name from the `?theme=` query parameter.
 */
export function applyTheme(theme: string | null) {
    const name = isThemeName(theme) ? theme : DEFAULT_THEME;
    document.body.classList.remove(BROADCAST_SKIN_CLASS, ...AVAILABLE_THEMES.map(t => `theme-${t}`));
    document.body.classList.add(`theme-${name}`);
    if (THEMES[name] === 'broadcast') {
        document.body.classList.add(BROADCAST_SKIN_CLASS);
    }
}

/**
 * Updates the overlay logo based on the query parameter.
 * @param logoParam - The logo key from the query parameters.
 */
export function updateLogo(logoParam: string | null) {
    const logoUrl = logoParam ? CONFIG.LOGO_MAP[logoParam] : undefined;
    if (logoUrl) {
        DOM.overlayImage.src = logoUrl;
        DOM.overlayImage.style.display = 'block';
    } else {
        DOM.overlayImage.style.display = 'none';
    }
}
