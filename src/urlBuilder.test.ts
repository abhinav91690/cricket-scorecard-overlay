import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./dom', () => ({ DOM: { overlayImage: document.createElement('img') } }));
vi.mock('./toast', () => ({ showToast: vi.fn() }));

import { buildOverlayUrl, themeLabel, setupUrlBuilder } from './urlBuilder';
import { showToast } from './toast';
import { CONFIG } from './config';
import { AVAILABLE_THEMES } from './theme';

const base = { origin: 'https://score.abhinav.dev', pathname: '/' };

describe('buildOverlayUrl', () => {
    it('includes only what differs from the defaults', () => {
        expect(buildOverlayUrl({ matchId: '2079', clubId: CONFIG.DEFAULT_CLUB_ID, theme: 'modern-light' }, base))
            .toBe('https://score.abhinav.dev/?matchId=2079');
    });

    it('adds club and theme when they are non-default', () => {
        expect(buildOverlayUrl({ matchId: ' 2079 ', clubId: ' 42 ', theme: 'kkr' }, base))
            .toBe('https://score.abhinav.dev/?matchId=2079&clubId=42&theme=kkr');
    });

    it('treats the legacy "modern" name as the default and omits it', () => {
        expect(buildOverlayUrl({ matchId: '1', clubId: '', theme: 'modern' }, base)).toBe('https://score.abhinav.dev/?matchId=1');
    });

    it('ignores unknown themes and keeps the path', () => {
        expect(buildOverlayUrl({ matchId: '1', clubId: '', theme: 'sparkly' }, { origin: 'http://localhost:5173', pathname: '/overlay/' }))
            .toBe('http://localhost:5173/overlay/?matchId=1');
    });
});

describe('themeLabel', () => {
    it('upper-cases short franchise codes and capitalises the core themes', () => {
        expect(themeLabel('kkr')).toBe('KKR');
        expect(themeLabel('pbks')).toBe('PBKS');
        expect(themeLabel('modern-light')).toBe('Modern Light');
        expect(themeLabel('neon')).toBe('NEON');
    });
});

describe('setupUrlBuilder', () => {
    const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
    const writeText = vi.fn(async () => {});

    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = `
            <form id="url-builder">
                <input id="build-match-id"><input id="build-club-id"><select id="build-theme"></select>
                <output id="build-url"></output><button type="button" id="build-copy">Copy</button>
                <a id="build-preview" href="#">Preview</a>
            </form>`;
        Object.defineProperty(window, 'location', { value: { origin: 'https://score.abhinav.dev', pathname: '/', search: '', hostname: 'score.abhinav.dev' }, writable: true });
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        setupUrlBuilder();
    });

    afterEach(() => vi.restoreAllMocks());

    it('lists every theme with modern selected and prefills the club id', () => {
        const options = Array.from(el<HTMLSelectElement>('build-theme').options);
        expect(options.map(o => o.value)).toEqual([...AVAILABLE_THEMES]);
        expect(el<HTMLSelectElement>('build-theme').value).toBe('modern-light');
        expect(el<HTMLInputElement>('build-club-id').value).toBe(CONFIG.DEFAULT_CLUB_ID);
    });

    it('starts incomplete and becomes ready as the match id is typed', () => {
        const out = el<HTMLOutputElement>('build-url');
        expect(out.dataset.state).toBe('incomplete');
        expect(out.textContent).toBe('https://score.abhinav.dev/?matchId=');

        const match = el<HTMLInputElement>('build-match-id');
        match.value = '2079';
        match.dispatchEvent(new Event('input'));
        expect(out.dataset.state).toBe('ready');
        expect(out.textContent).toBe('https://score.abhinav.dev/?matchId=2079');
    });

    it('reflects theme and club changes in the url and the preview link', () => {
        const theme = el<HTMLSelectElement>('build-theme');
        theme.value = 'csk';
        theme.dispatchEvent(new Event('change'));
        const club = el<HTMLInputElement>('build-club-id');
        club.value = '7';
        club.dispatchEvent(new Event('input'));

        expect(el<HTMLOutputElement>('build-url').textContent).toBe('https://score.abhinav.dev/?matchId=&clubId=7&theme=csk');
        expect(el<HTMLAnchorElement>('build-preview').getAttribute('href')).toBe('?debug=1&theme=csk');
    });

    it('copies the link and confirms, or asks for a match id first', async () => {
        el<HTMLButtonElement>('build-copy').click();
        await Promise.resolve();
        expect(writeText).not.toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith('Enter a match ID first.', 'error');

        const match = el<HTMLInputElement>('build-match-id');
        match.value = '2079';
        match.dispatchEvent(new Event('input'));
        el<HTMLButtonElement>('build-copy').click();
        await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('https://score.abhinav.dev/?matchId=2079'));
        expect(showToast).toHaveBeenLastCalledWith('Overlay link copied.', 'success');
    });

    it('reports a clipboard failure without throwing', async () => {
        writeText.mockRejectedValueOnce(new Error('denied'));
        const match = el<HTMLInputElement>('build-match-id');
        match.value = '1';
        match.dispatchEvent(new Event('input'));
        el<HTMLButtonElement>('build-copy').click();
        await vi.waitFor(() => expect(showToast).toHaveBeenLastCalledWith('Copy failed. Select the link and copy it manually.', 'error'));
    });

    it('is a no-op when the form is absent', () => {
        document.body.innerHTML = '';
        expect(() => setupUrlBuilder()).not.toThrow();
    });
});
