import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./dom', () => ({ DOM: { overlayImage: document.createElement('img') } }));

import { applyTheme, updateLogo, AVAILABLE_THEMES } from './theme';
import { DOM } from './dom';

describe('applyTheme', () => {
    beforeEach(() => {
        document.body.className = '';
    });

    it('adds the theme class and the broadcast skin for a broadcast theme', () => {
        applyTheme('kkr');
        expect(document.body.classList.contains('theme-kkr')).toBe(true);
        expect(document.body.classList.contains('skin-broadcast')).toBe(true);
    });

    it('adds only the theme class for a standalone theme', () => {
        applyTheme('classic');
        expect(document.body.classList.contains('theme-classic')).toBe(true);
        expect(document.body.classList.contains('skin-broadcast')).toBe(false);
    });

    it('falls back to modern for unknown or missing names', () => {
        applyTheme('not-a-theme');
        expect(document.body.className).toBe('theme-modern');
        applyTheme(null);
        expect(document.body.className).toBe('theme-modern');
    });

    it('removes the previous theme and skin when switching', () => {
        applyTheme('rcb');
        applyTheme('neon');
        expect(document.body.className).toBe('theme-neon');
    });

    it('exposes every theme listed on the instructions screen', () => {
        expect(AVAILABLE_THEMES).toEqual([
            'classic', 'modern', 'neon',
            'kkr', 'rcb', 'mi', 'csk', 'dc', 'rr', 'srh', 'pbks', 'gt', 'lsg',
            'tel', 'ted', 'tul', 'tud',
        ]);
    });
});

describe('updateLogo', () => {
    it('shows a known sponsor logo', () => {
        updateLogo('1');
        expect(DOM.overlayImage.style.display).toBe('block');
        expect(DOM.overlayImage.src).toContain('PulteHomes');
    });

    it('hides the logo for unknown or missing keys', () => {
        updateLogo('99');
        expect(DOM.overlayImage.style.display).toBe('none');
        updateLogo(null);
        expect(DOM.overlayImage.style.display).toBe('none');
    });
});
