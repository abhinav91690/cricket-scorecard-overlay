import { CONFIG } from './config';
import { DOM } from './dom';
import './css/overlay-base.css';
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

/** Every theme is a colour palette layered on overlay-base.css. */
export const AVAILABLE_THEMES = [
    'classic', 'modern', 'neon',
    'kkr', 'rcb', 'mi', 'csk', 'dc', 'rr', 'srh', 'pbks', 'gt', 'lsg',
    'tel', 'ted', 'tul', 'tud',
] as const;

export type ThemeName = typeof AVAILABLE_THEMES[number];
export const DEFAULT_THEME: ThemeName = 'modern';

export function isThemeName(theme: string | null): theme is ThemeName {
    return theme !== null && (AVAILABLE_THEMES as readonly string[]).includes(theme);
}

/**
 * Applies the selected theme to <body>, falling back to the default for unknown names.
 * @param theme - The theme name from the `?theme=` query parameter.
 */
export function applyTheme(theme: string | null) {
    const name = isThemeName(theme) ? theme : DEFAULT_THEME;
    document.body.classList.remove(...AVAILABLE_THEMES.map(t => `theme-${t}`));
    document.body.classList.add(`theme-${name}`);
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
