import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./dom', () => {
    const el = (id: string) => { const d = document.createElement('div'); d.id = id; document.body.appendChild(d); return d; };
    return { DOM: {
        eventCard: el('event-card'), eventEyebrow: el('event-eyebrow'), eventHeadline: el('event-headline'), eventDetail: el('event-detail'),
        panelCard: el('panel-card'), panelEyebrow: el('panel-eyebrow'), panelHeadline: el('panel-headline'), panelDetail: el('panel-detail'), panelColumns: el('panel-columns'), panelFooter: el('panel-footer'),
    } };
});

import { cardCopy, enqueueCards, showSampleCard, resetCardsForTests, dismissAll, isIdle, HOLD_MS, SAMPLE_EVENTS, PanelEvent } from './cards';
import { OverlayEvent } from './events';
import { DOM } from './dom';

const ev = (k: string) => SAMPLE_EVENTS[k] as OverlayEvent;
const panel = (k: string) => SAMPLE_EVENTS[k] as PanelEvent;

describe('cardCopy', () => {
    it('writes each in-bar card type', () => {
        expect(cardCopy(ev('wicket'))).toEqual({ eyebrow: 'Wicket', headline: 'Vikas B', detail: 'c Ravi T b Siva Krishna V · 11 (8) · 3rd wkt · 84/3' });
        expect(cardCopy({ type: 'wicket', name: 'X', runs: '0', balls: '1', dismissal: '', fow: '' }).detail).toBe('0 (1)');
        expect(cardCopy(ev('milestone'))).toEqual({ eyebrow: 'Fifty', headline: 'Abhinav V', detail: '52 (31) · 6×4 · 2×6' });
        expect(cardCopy({ ...(ev('milestone') as any), mark: 100 }).eyebrow).toBe('Hundred');
        expect(cardCopy(ev('partnership'))).toEqual({ eyebrow: '50 partnership', headline: 'Abhinav & Raja', detail: '54 (38)' });
        expect(cardCopy(ev('boundary'))).toEqual({ eyebrow: '', headline: 'Six', detail: '' });
        expect(cardCopy({ type: 'boundary', runs: 4 }).headline).toBe('Four');
    });
});

describe('card queue', () => {
    beforeEach(() => { vi.useFakeTimers(); resetCardsForTests(); DOM.eventCard.classList.remove('is-visible'); DOM.panelCard.classList.remove('is-visible'); });
    afterEach(() => vi.useRealTimers());

    it('shows a card, holds it, then hides it', () => {
        enqueueCards([ev('wicket')]);
        expect(DOM.eventCard.classList.contains('is-visible')).toBe(true);
        expect(DOM.eventCard.dataset.type).toBe('wicket');
        expect(DOM.eventHeadline.textContent).toBe('Vikas B');
        vi.advanceTimersByTime(HOLD_MS.wicket - 1);
        expect(DOM.eventCard.classList.contains('is-visible')).toBe(true);
        vi.advanceTimersByTime(1);
        expect(DOM.eventCard.classList.contains('is-visible')).toBe(false);
    });

    it('plays bar cards one at a time, in order, with a gap for the exit transition', () => {
        enqueueCards([ev('wicket'), ev('boundary')]);
        expect(DOM.eventCard.dataset.type).toBe('wicket');
        vi.advanceTimersByTime(HOLD_MS.wicket);
        expect(DOM.eventCard.classList.contains('is-visible')).toBe(false);
        vi.advanceTimersByTime(300);
        expect(DOM.eventCard.dataset.type).toBe('boundary');
        expect(DOM.eventCard.dataset.runs).toBe('6');
        expect(DOM.eventCard.classList.contains('is-visible')).toBe(true);
    });

    it('does not stack up boundary flashes', () => {
        enqueueCards([ev('wicket')]);
        enqueueCards([ev('boundary')]);
        enqueueCards([{ type: 'boundary', runs: 4 }]);
        vi.advanceTimersByTime(HOLD_MS.wicket + 300);
        expect(DOM.eventCard.dataset.type).toBe('boundary');
        vi.advanceTimersByTime(HOLD_MS.boundary + 300);
        expect(DOM.eventCard.classList.contains('is-visible')).toBe(false);
        vi.advanceTimersByTime(HOLD_MS.boundary + 300);
        expect(DOM.eventCard.classList.contains('is-visible')).toBe(false);
    });

    it('runs the panel surface independently of the bar surface', () => {
        enqueueCards([panel('intro'), ev('wicket')]);
        expect(DOM.panelCard.classList.contains('is-visible')).toBe(true);
        expect(DOM.eventCard.classList.contains('is-visible')).toBe(true);
        expect(isIdle('panel')).toBe(false);
        vi.advanceTimersByTime(HOLD_MS.wicket + 300);
        expect(DOM.eventCard.classList.contains('is-visible')).toBe(false);
        expect(DOM.panelCard.classList.contains('is-visible')).toBe(true);
        vi.advanceTimersByTime(HOLD_MS.intro - HOLD_MS.wicket);
        expect(DOM.panelCard.classList.contains('is-visible')).toBe(false);
        vi.advanceTimersByTime(300);
        expect(isIdle('panel')).toBe(true);
    });

    it('renders each panel type into the panel skeleton without HTML injection', () => {
        enqueueCards([panel('intro')]);
        expect(DOM.panelEyebrow.textContent).toBe('2024 Fall Champions');
        expect(DOM.panelHeadline.textContent).toBe('Lions v Topguns United');
        expect(DOM.panelFooter.textContent).toContain('won the toss');
        resetCardsForTests();

        enqueueCards([{ type: 'squad', team: '<b>x</b>', players: [{ name: '<img src=x>', value: '', note: 'Batter' }] }]);
        expect(DOM.panelHeadline.textContent).toBe('<b>x</b>');
        expect(DOM.panelColumns.querySelector('img')).toBeNull();
        expect(DOM.panelColumns.querySelectorAll('.panel-row')).toHaveLength(1);
        resetCardsForTests();

        enqueueCards([panel('innings-summary')]);
        expect(DOM.panelHeadline.textContent).toBe('Lions 142/8 (20 ov)');
        expect(DOM.panelColumns.querySelectorAll('.panel-col')).toHaveLength(2);
        expect(DOM.panelColumns.querySelectorAll('.panel-row')).toHaveLength(6);
        expect(DOM.panelFooter.textContent).toContain('Target 143');
        expect(DOM.panelFooter.textContent).toContain('FoW 1-14');
        resetCardsForTests();

        enqueueCards([panel('match-summary')]);
        expect(DOM.panelHeadline.textContent).toBe('Lions v Topguns United');
        expect(DOM.panelColumns.querySelectorAll('.panel-col-title')).toHaveLength(2);
    });

    it('dismissAll hides both surfaces at once and empties the queues', () => {
        enqueueCards([panel('intro'), panel('squad'), ev('wicket'), ev('milestone')]);
        expect(DOM.panelCard.classList.contains('is-visible')).toBe(true);
        expect(DOM.eventCard.classList.contains('is-visible')).toBe(true);
        dismissAll();
        expect(DOM.panelCard.classList.contains('is-visible')).toBe(false);
        expect(DOM.eventCard.classList.contains('is-visible')).toBe(false);
        expect(isIdle('bar')).toBe(true);
        expect(isIdle('panel')).toBe(true);
        vi.advanceTimersByTime(60000);
        expect(DOM.eventCard.classList.contains('is-visible')).toBe(false);
        expect(DOM.panelCard.classList.contains('is-visible')).toBe(false);
    });

    it('shows a sample card for a known type and ignores unknown ones', () => {
        showSampleCard('nope');
        expect(DOM.eventCard.classList.contains('is-visible')).toBe(false);
        showSampleCard('partnership');
        expect(DOM.eventCard.dataset.type).toBe('partnership');
        showSampleCard('innings-summary');
        expect(DOM.panelCard.dataset.type).toBe('innings-summary');
        vi.advanceTimersByTime(HOLD_MS.partnership * 2);
        expect(DOM.eventCard.classList.contains('is-visible')).toBe(true); // samples stay up
    });
});
