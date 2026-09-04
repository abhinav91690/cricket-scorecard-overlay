/** Validation and normalisation of incoming events. Pure functions, unit-tested. */

export const EVENTS = ['overlay_start', 'home_view', 'link_stream_submit'] as const;
export const CLIENTS = ['obs', 'vmix', 'streamlabs', 'prism', 'browser'] as const;
export const OUTCOMES = ['submitted', 'invalid_url', 'popup_blocked', 'error'] as const;

export type EventName = typeof EVENTS[number];

export interface NormalizedEvent {
    event: EventName;
    clubId: string | null;
    matchId: string | null;
    theme: string | null;
    logo: string | null;
    client: string | null;
    clientVersion: string | null;
    os: string | null;
    screen: string | null;
    videoId: string | null;
    outcome: string | null;
}

/** Max accepted request body, in bytes. Real payloads are ~300 bytes. */
export const MAX_BODY_BYTES = 4096;

function str(value: unknown, max: number): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, max) : null;
}

function oneOf<T extends readonly string[]>(value: unknown, allowed: T): T[number] | null {
    return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value : null;
}

/** Digits only, as CricClubs IDs are numeric. Anything else is dropped rather than stored. */
function id(value: unknown): string | null {
    const s = str(value, 20);
    return s && /^\d+$/.test(s) ? s : null;
}

/**
 * Turns an untrusted JSON body into a row-ready event, or null if it isn't one we accept.
 * Every field is allow-listed or length-capped so the table can't be used as free storage.
 */
export function normalizeEvent(input: unknown): NormalizedEvent | null {
    if (!input || typeof input !== 'object') return null;
    const body = input as Record<string, unknown>;

    const event = oneOf(body.event, EVENTS);
    if (!event) return null;

    const normalized: NormalizedEvent = {
        event,
        clubId: id(body.clubId),
        matchId: id(body.matchId),
        theme: str(body.theme, 32),
        logo: str(body.logo, 16),
        client: oneOf(body.client, CLIENTS),
        clientVersion: str(body.clientVersion, 32),
        os: str(body.os, 16),
        screen: str(body.screen, 16),
        videoId: null,
        outcome: null,
    };

    if (event === 'link_stream_submit') {
        const videoId = str(body.videoId, 32);
        normalized.videoId = videoId && /^[\w-]+$/.test(videoId) ? videoId : null;
        normalized.outcome = oneOf(body.outcome, OUTCOMES) ?? 'error';
    }

    return normalized;
}

/** sha256 of ip|ua|day|salt, shortened. Rotates daily so it can't track anyone across days. */
export async function visitorHash(ip: string, ua: string, day: string, salt: string): Promise<string> {
    const data = new TextEncoder().encode(`${ip}|${ua}|${day}|${salt}`);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest).slice(0, 8), b => b.toString(16).padStart(2, '0')).join('');
}
