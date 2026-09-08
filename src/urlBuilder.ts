import { CONFIG } from './config';
import { AVAILABLE_THEMES, DEFAULT_THEME, resolveTheme, ThemeName } from './theme';
import { showToast } from './toast';

export interface OverlayLinkParams {
    matchId: string;
    clubId: string;
    theme: string;
}

/**
 * Builds the overlay URL for the given match. Omits parameters that equal their defaults so the
 * link stays short. `base` defaults to the current page (origin + path, no query).
 */
export function buildOverlayUrl({ matchId, clubId, theme }: OverlayLinkParams, base: { origin: string; pathname: string } = window.location): string {
    const params = new URLSearchParams();
    params.set('matchId', matchId.trim());
    if (clubId.trim() && clubId.trim() !== CONFIG.DEFAULT_CLUB_ID) params.set('clubId', clubId.trim());
    const resolved = resolveTheme(theme);
    if (resolved !== DEFAULT_THEME) params.set('theme', resolved);
    return `${base.origin}${base.pathname}?${params.toString()}`;
}

/** Human label for the theme <select>: franchise codes upper-cased, core names title-cased. */
export function themeLabel(theme: ThemeName): string {
    if (theme.length <= 4) return theme.toUpperCase();
    return theme.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Wires the "Build your overlay link" form on the home screen: theme options, live URL, copy
 * button and the sample-data preview link.
 */
export function setupUrlBuilder() {
    const matchInput = document.getElementById('build-match-id') as HTMLInputElement | null;
    const clubInput = document.getElementById('build-club-id') as HTMLInputElement | null;
    const themeSelect = document.getElementById('build-theme') as HTMLSelectElement | null;
    const output = document.getElementById('build-url') as HTMLOutputElement | null;
    const copyButton = document.getElementById('build-copy') as HTMLButtonElement | null;
    const preview = document.getElementById('build-preview') as HTMLAnchorElement | null;
    if (!matchInput || !clubInput || !themeSelect || !output || !copyButton || !preview) return;

    for (const theme of AVAILABLE_THEMES) {
        const option = document.createElement('option');
        option.value = theme;
        option.textContent = themeLabel(theme);
        option.selected = theme === DEFAULT_THEME;
        themeSelect.appendChild(option);
    }
    clubInput.value = CONFIG.DEFAULT_CLUB_ID;

    const render = () => {
        const matchId = matchInput.value.trim();
        const url = buildOverlayUrl({ matchId, clubId: clubInput.value, theme: themeSelect.value });
        output.textContent = url;
        output.dataset.state = matchId ? 'ready' : 'incomplete';
        preview.href = `?debug=1&theme=${encodeURIComponent(themeSelect.value)}`;
    };

    [matchInput, clubInput].forEach(el => el.addEventListener('input', render));
    themeSelect.addEventListener('change', render);
    render();

    copyButton.addEventListener('click', async () => {
        if (!matchInput.value.trim()) {
            showToast('Enter a match ID first.', 'error');
            matchInput.focus();
            return;
        }
        try {
            await navigator.clipboard.writeText(output.textContent ?? '');
            showToast('Overlay link copied.', 'success');
        } catch {
            showToast('Copy failed. Select the link and copy it manually.', 'error');
        }
    });
}
