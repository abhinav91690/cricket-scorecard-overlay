import { DOM } from './dom';
import { OverlayEvent } from './events';

/** How long each card stays up before sliding away. */
export const HOLD_MS: Record<OverlayEvent['type'], number> = {
    wicket: 8000,
    milestone: 8000,
    partnership: 6000,
    target: 10000,
    boundary: 2000,
};

/** Must match the CSS transition on .event-card. */
const TRANSITION_MS = 300;

export interface CardCopy { eyebrow: string; headline: string; detail: string; }

/** What each card says. Pure, so it can be tested without a DOM. */
export function cardCopy(e: OverlayEvent): CardCopy {
    switch (e.type) {
        case 'wicket':
            return { eyebrow: 'Wicket', headline: e.name, detail: [e.dismissal, `${e.runs} (${e.balls})`].filter(Boolean).join(' · ') };
        case 'milestone':
            return { eyebrow: e.mark === 100 ? 'Hundred' : 'Fifty', headline: e.name, detail: `${e.runs} (${e.balls}) · ${e.fours}×4 · ${e.sixes}×6` };
        case 'partnership':
            return { eyebrow: `${e.mark} partnership`, headline: e.names, detail: `${e.runs} (${e.balls})` };
        case 'boundary':
            return { eyebrow: '', headline: e.runs === 6 ? 'Six' : 'Four', detail: '' };
        case 'target':
            return {
                eyebrow: 'Target',
                headline: String(e.target),
                detail: [e.overs ? `off ${e.overs} overs` : '', e.rrr ? `RRR ${e.rrr}` : ''].filter(Boolean).join(' · '),
            };
    }
}

interface Queued { event: OverlayEvent; hold: number; }

let queue: Queued[] = [];
let showing = false;
let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * Queues cards to be shown one at a time. A boundary already waiting is not duplicated, and a
 * boundary is dropped when a wicket arrives in the same batch (detectEvents already avoids that).
 */
export function enqueueCards(events: OverlayEvent[], hold?: number): void {
    for (const event of events) {
        if (event.type === 'boundary' && queue.some(q => q.event.type === 'boundary')) continue;
        queue.push({ event, hold: hold ?? HOLD_MS[event.type] });
    }
    pump();
}

function render(event: OverlayEvent) {
    const copy = cardCopy(event);
    DOM.eventCard.dataset.type = event.type;
    DOM.eventEyebrow.textContent = copy.eyebrow;
    DOM.eventHeadline.textContent = copy.headline;
    DOM.eventDetail.textContent = copy.detail;
}

function pump() {
    if (showing || queue.length === 0) return;
    const { event, hold } = queue.shift()!;
    showing = true;
    render(event);
    DOM.eventCard.classList.add('is-visible');
    timer = setTimeout(() => {
        DOM.eventCard.classList.remove('is-visible');
        timer = setTimeout(() => {
            showing = false;
            pump();
        }, TRANSITION_MS);
    }, hold);
}

/** Sample cards for `?debug=…&card=<type>` so a card can be positioned in OBS without waiting for one. */
export const SAMPLE_EVENTS: Record<OverlayEvent['type'], OverlayEvent> = {
    wicket: { type: 'wicket', name: 'Vikas B', runs: '11', balls: '8', dismissal: 'c Ravi T b Siva Krishna V' },
    milestone: { type: 'milestone', mark: 50, name: 'Abhinav V', runs: '52', balls: '31', fours: '6', sixes: '2' },
    partnership: { type: 'partnership', mark: 50, names: 'Abhinav & Raja', runs: '54', balls: '38' },
    boundary: { type: 'boundary', runs: 6 },
    target: { type: 'target', target: 143, overs: 20, rrr: '7.15' },
};

export function showSampleCard(type: string): void {
    const event = (SAMPLE_EVENTS as Record<string, OverlayEvent>)[type];
    if (event) enqueueCards([event], 60 * 60 * 1000);
}

/** Test hook: clear the queue and any pending timers. */
export function resetCardsForTests(): void {
    queue = [];
    showing = false;
    if (timer) clearTimeout(timer);
    timer = undefined;
}
