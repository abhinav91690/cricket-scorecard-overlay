import { CONFIG } from './config';

/**
 * Minimal first-party usage analytics. Posts a handful of events to the Cloudflare Worker
 * behind /api/collect (see worker/). No cookies, no identifiers; see README "Usage analytics".
 */

export type ClientKind = 'obs' | 'vmix' | 'streamlabs' | 'prism' | 'browser';

export interface ClientInfo {
    client: ClientKind;
    clientVersion: string | null;
    os: string;
    screen: string;
}

export type LinkOutcome = 'submitted' | 'invalid_url' | 'popup_blocked' | 'error';

interface TrackingContext {
    hostname: string;
    debug: string | null;
    mode: string | null;
    nostats: string | null;
    doNotTrack: string | null | undefined;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);

/** Nothing is sent from local dev, mock/replay modes, or when the viewer opted out. */
export function isTrackingEnabled(ctx: TrackingContext): boolean {
    if (LOCAL_HOSTS.has(ctx.hostname)) return false;
    if (ctx.debug || ctx.mode === 'replay') return false;
    if (ctx.nostats !== null) return false;
    if (ctx.doNotTrack === '1') return false;
    return true;
}

function detectOs(ua: string): string {
    if (/Windows/i.test(ua)) return 'windows';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    if (/Mac OS X/i.test(ua)) return 'macos';
    if (/Android/i.test(ua)) return 'android';
    if (/Linux/i.test(ua)) return 'linux';
    return 'other';
}

/**
 * Works out what is rendering the page. OBS's Browser Source injects `window.obsstudio` and puts
 * an `OBS/<version>` token in the user agent; other streaming apps only identify via user agent.
 */
export function detectClient(win: Window = window): ClientInfo {
    const ua = win.navigator.userAgent || '';
    const obs = (win as Window & { obsstudio?: { pluginVersion?: string } }).obsstudio;

    let client: ClientKind = 'browser';
    let clientVersion: string | null = null;

    const obsUa = /\bOBS\/([\d.]+)/.exec(ua);
    if (obs || obsUa) {
        client = 'obs';
        clientVersion = (typeof obs?.pluginVersion === 'string' ? obs.pluginVersion : null) ?? obsUa?.[1] ?? null;
    } else if (/vMix/i.test(ua)) {
        client = 'vmix';
    } else if (/Streamlabs/i.test(ua)) {
        client = 'streamlabs';
    } else if (/PRISM/i.test(ua)) {
        client = 'prism';
    }

    return { client, clientVersion, os: detectOs(ua), screen: `${win.screen.width}x${win.screen.height}` };
}

function currentContext(): TrackingContext {
    const params = new URLSearchParams(window.location.search);
    return {
        hostname: window.location.hostname,
        debug: params.get('debug'),
        mode: params.get('mode'),
        nostats: params.get('nostats'),
        doNotTrack: navigator.doNotTrack,
    };
}

/** Fire-and-forget. Any failure is swallowed: analytics must never affect the overlay. */
export function track(event: string, props: Record<string, string | null | undefined> = {}): void {
    try {
        if (!isTrackingEnabled(currentContext())) return;
        const body = JSON.stringify({ event, ...props, ...detectClient() });
        fetch(CONFIG.ANALYTICS_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            keepalive: true,
        }).catch(() => { /* ignore */ });
    } catch {
        /* ignore */
    }
}

const sent = new Set<string>();

/** Sends `event` at most once per page load, regardless of how often the poll loop calls it. */
export function trackOnce(event: string, props?: Record<string, string | null | undefined>): void {
    if (sent.has(event)) return;
    sent.add(event);
    track(event, props);
}

/** Test hook: forget which once-only events have been sent. */
export function resetTrackingForTests(): void {
    sent.clear();
}
