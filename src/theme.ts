import { CONFIG } from './config';
import { DOM } from './dom';

export function applyTheme(theme: string | null) {
    const themeLink = document.getElementById('theme-stylesheet') as HTMLLinkElement;
    if (theme === 'classic') {
        themeLink.href = 'css/theme-classic.css';
    } else {
        themeLink.href = 'css/theme-modern.css';
    }
}

export function updateLogo(logoParam: string | null) {
    const logoUrl = logoParam ? CONFIG.LOGO_MAP[logoParam] : undefined;
    if (logoUrl) {
        DOM.overlayImage.src = logoUrl;
        DOM.overlayImage.style.display = 'block';
    } else {
        DOM.overlayImage.style.display = 'none';
    }
}
