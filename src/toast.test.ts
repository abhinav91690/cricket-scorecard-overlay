import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { showToast } from './toast';

describe('showToast', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
        document.body.innerHTML = '<div id="toast-container"></div>';
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('appends a visible toast with the message and type', () => {
        showToast('Saved', 'success');
        const toast = document.querySelector('#toast-container .toast') as HTMLElement;
        expect(toast.textContent).toBe('Saved');
        expect(toast.classList.contains('toast-success')).toBe(true);
        expect(toast.classList.contains('is-visible')).toBe(true);
    });

    it('defaults to the success type', () => {
        showToast('Hi');
        expect(document.querySelector('.toast-success')).not.toBeNull();
    });

    it('uses textContent, so markup in the message is not interpreted', () => {
        showToast('<img src=x onerror=alert(1)>', 'error');
        expect(document.querySelector('#toast-container img')).toBeNull();
        expect(document.querySelector('.toast-error')!.textContent).toBe('<img src=x onerror=alert(1)>');
    });

    it('hides after the duration and removes itself once the transition ends', () => {
        showToast('Bye', 'error', 1000);
        const toast = document.querySelector('.toast') as HTMLElement;

        vi.advanceTimersByTime(999);
        expect(toast.classList.contains('is-visible')).toBe(true);

        vi.advanceTimersByTime(1);
        expect(toast.classList.contains('is-visible')).toBe(false);
        expect(document.body.contains(toast)).toBe(true);

        toast.dispatchEvent(new Event('transitionend'));
        expect(document.body.contains(toast)).toBe(false);
    });

    it('does nothing when the container is missing', () => {
        document.body.innerHTML = '';
        expect(() => showToast('x')).not.toThrow();
        expect(document.querySelector('.toast')).toBeNull();
    });
});
