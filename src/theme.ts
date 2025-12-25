import { CONFIG } from './config';
import { DOM } from './dom';

/**
 * Applies the selected CSS theme to the application.
 * @param theme - The theme name ('classic' or 'modern').
 */
export function applyTheme(theme: string | null) {
    const themeLink = document.getElementById('theme-stylesheet') as HTMLLinkElement;
    if (theme === 'classic') {
        themeLink.href = 'css/theme-classic.css';
    } else {
        themeLink.href = 'css/theme-modern.css';
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
