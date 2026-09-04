import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./dom', () => {
    const el = (id: string) => { const d = document.createElement('div'); d.id = id; document.body.appendChild(d); return d; };
    return { DOM: { eventCard: el('event-card'), eventEyebrow: el('event-eyebrow'), eventHeadline: el('event-headline'), eventDetail: el('event-detail') } };
});

import { cardCopy, enqueueCards, showSampleCard, resetCardsForTests, HOLD_MS, SAMPLE_EVENTS } from './cards';
import { DOM } from './dom';

describe('cardCopy', () => {
    it('writes each card type', () => {
        expect(cardCopy(SAMPLE_EVENTS.wicket)).toEqual({ eyebrow: 'Wicket', headline: 'Vikas B', detail: 'c Ravi T b Siva Krishna V · 11 (8)' });
        expect(cardCopy({ type: 'wicket', name: 'X', runs: '0', balls: '1', dismissal: '' }).detail).toBe('0 (1)');
        expect(cardCopy(SAMPLE_EVENTS.milestone)).toEqual({ eyebrow: 'Fifty', headline: 'Abhinav V', detail: '52 (31) · 6×4 · 2×6' });
        expect(cardCopy({ ...SAMPLE_EVENTS.milestone, mark: 100 } as any).eyebrow).toBe('Hundred');
        expect(cardCopy(SAMPLE_EVENTS.partnership)).toEqual({ eyebrow: '50 partnership', headline: 'Abhinav & Raja', detail: '54 (38)' });
        expect(cardCopy(SAMPLE_EVENTS.boundary)).toEqual({ eyebrow: '', headline: 'Six', detail: '' });
        expect(cardCopy({ type: 'boundary', runs: 4 }).headline).toBe('Four');
        expect(cardCopy(SAMPLE_EVENTS.target)).toEqual({ eyebrow: 'Target', headline: '143', detail: 'off 20 overs · RRR 7.15' });
        expect(cardCopy({ type: 'target', target: 90, overs: null, rrr: null }).detail).toBe('');
    });
});

describe('card queue', () => {
    beforeEach(() => { vi.useFakeTimers(); resetCardsForTests(); DOM.eventCard.classList.remove('is-visible'); });
    afterEach(() => vi.useRealTimers());

    it('shows a card, holds it, then hides it', () => {
        enqueueCards([SAMPLE_EVENTS.wicket]);
        expect(DOM.eventCard.classList.contains('is-visible')).toBe(true);
        expect(DOM.eventCard.dataset.type).toBe('wicket');
        expect(DOM.eventHeadline.textContent).toBe('Vikas B');
        vi.advanceTimersByTime(HOLD_MS.wicket - 1);
        expect(DOM.eventCard.classList.contains('is-visible')).toBe(true);
        vi.advanceTimersByTime(1);
        expect(DOM.eventCard.classList.contains('is-visible')).toBe(false);
    });

    it('plays cards one at a time, in order, with a gap for the exit transition', () => {
        enqueueCards([SAMPLE_EVENTS.wicket, SAMPLE_EVENTS.boundary]);
        expect(DOM.eventCard.dataset.type).toBe('wicket');
        vi.advanceTimersByTime(HOLD_MS.wicket);
        expect(DOM.eventCard.classList.contains('is-visible')).toBe(false);
        expect(DOM.eventCard.dataset.type).toBe('wicket');
        vi.advanceTimersByTime(300);
        expect(DOM.eventCard.dataset.type).toBe('boundary');
        expect(DOM.eventCard.classList.contains('is-visible')).toBe(true);
        vi.advanceTimersByTime(HOLD_MS.boundary + 300);
        expect(DOM.eventCard.classList.contains('is-visible')).toBe(false);
    });

    it('does not stack up boundary flashes', () => {
        enqueueCards([SAMPLE_EVENTS.wicket]);
        enqueueCards([SAMPLE_EVENTS.boundary]);
        enqueueCards([{ type: 'boundary', runs: 4 }]);
        vi.advanceTimersByTime(HOLD_MS.wicket + 300);
        expect(DOM.eventCard.dataset.type).toBe('boundary');
        vi.advanceTimersByTime(HOLD_MS.boundary + 300);
        expect(DOM.eventCard.classList.contains('is-visible')).toBe(false);
        vi.advanceTimersByTime(HOLD_MS.boundary + 300);
        expect(DOM.eventCard.classList.contains('is-visible')).toBe(false);
    });

    it('shows a sample card for a known type and ignores unknown ones', () => {
        showSampleCard('nope');
        expect(DOM.eventCard.classList.contains('is-visible')).toBe(false);
        showSampleCard('target');
        expect(DOM.eventCard.dataset.type).toBe('target');
        vi.advanceTimersByTime(HOLD_MS.target * 2);
        expect(DOM.eventCard.classList.contains('is-visible')).toBe(true); // samples stay up
    });
});
