import { CONFIG } from './config';
import { DOM } from './dom';
import './css/theme-classic.css';
import './css/theme-modern.css';
import './css/theme-neon.css';

const AVAILABLE_THEMES = ['classic', 'modern', 'neon'] as const;

/**
 * Applies the selected CSS theme to the application.
 * @param theme - The theme name ('classic', 'modern', or 'neon').
 */
export function applyTheme(theme: string | null) {
    document.body.classList.remove(...AVAILABLE_THEMES.map(t => `theme-${t}`));
    if (theme && AVAILABLE_THEMES.includes(theme as any)) {
        document.body.classList.add(`theme-${theme}`);
    } else {
        document.body.classList.add('theme-modern');
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
