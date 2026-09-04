import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./dom', () => ({ DOM: { overlayImage: document.createElement('img') } }));

import { applyTheme, updateLogo, AVAILABLE_THEMES } from './theme';
import { DOM } from './dom';

describe('applyTheme', () => {
    beforeEach(() => {
        document.body.className = '';
    });

    it('adds exactly one theme class', () => {
        applyTheme('kkr');
        expect(document.body.className).toBe('theme-kkr');
    });

    it('falls back to modern-light for unknown or missing names', () => {
        applyTheme('not-a-theme');
        expect(document.body.className).toBe('theme-modern-light');
        applyTheme(null);
        expect(document.body.className).toBe('theme-modern-light');
    });

    it('keeps the old "modern" name working as an alias', () => {
        applyTheme('modern');
        expect(document.body.className).toBe('theme-modern-light');
    });

    it('removes the previous theme when switching', () => {
        applyTheme('rcb');
        applyTheme('neon');
        expect(document.body.className).toBe('theme-neon');
    });

    it('exposes every theme listed on the instructions screen', () => {
        expect(AVAILABLE_THEMES).toEqual([
            'classic', 'modern-light', 'modern-dark', 'neon',
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
