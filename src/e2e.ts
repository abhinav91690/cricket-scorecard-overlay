/**
 * End-to-end test hooks. Everything here is inert unless the page is served from localhost,
 * so production is untouched. Used by sim/run.ts to drive a whole simulated match.
 *
 *   ?api=http://localhost:8788   point the overlay at the fake CricClubs (sim/server.ts)
 *   ?refresh=250                 poll interval in ms
 *   ?e2e                         record a timeline of frames, cards, panels and view switches
 */
import { CONFIG } from './config';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isLocalhost(): boolean {
    return LOCAL_HOSTS.has(window.location.hostname);
}

function param(name: string): string | null {
    return new URLSearchParams(window.location.search).get(name);
}

/** Base URL for CricClubs endpoints. Overridable on localhost only. */
export function apiBase(): string {
    const override = isLocalhost() ? param('api') : null;
    return (override || CONFIG.API_BASE).replace(/\/$/, '');
}

/** Poll interval in ms. Overridable on localhost only (min 100ms). */
export function refreshMs(): number {
    const override = isLocalhost() ? Number(param('refresh')) : NaN;
    return Number.isFinite(override) && override >= 100 ? override : CONFIG.REFRESH_RATE;
}

export interface TimelineEntry { t: number; kind: string; detail: unknown; }

declare global { interface Window { __overlayLog?: TimelineEntry[]; } }

/** Records to window.__overlayLog and, when an api override is set, POSTs to <api>/sim/event. */
export function e2eLog(kind: string, detail: unknown = {}): void {
    if (!isLocalhost() || param('e2e') === null) return;
    const entry: TimelineEntry = { t: Date.now(), kind, detail };
    (window.__overlayLog ??= []).push(entry);
    const api = param('api');
    if (api) {
        fetch(`${api.replace(/\/$/, '')}/sim/event`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(entry), keepalive: true }).catch(() => { /* ignore */ });
    }
}
