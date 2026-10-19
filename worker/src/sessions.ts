/**
 * The `sessions` table: one row per page load that reached a live match, moved forward by the
 * 5-minute ping. Duration is `last_seen - first_seen`. → docs/analytics.md §5
 *
 * 🛑 Why this is not in `index.ts`. A Worker entry module may export **only** handlers. Adding
 * `export const SESSION_UPSERT` there made workerd refuse to start the Worker outright —
 * "Incorrect type for map entry 'SESSION_UPSERT': the provided value is not of type 'function
 * or ExportedHandler'" — while tsc and the whole test suite stayed green. Only `wrangler dev`
 * showed it. Keep anything that needs exporting out of the entry module.
 */
import type { Env } from './env';
import type { NormalizedEvent } from './collect';

/**
 * Creates the session row on first sight and moves `last_seen` forward after that.
 *
 * ⚠ `first_seen` and the overlay context are written ONCE, by `DO UPDATE ... last_seen`
 * leaving them alone. A later ping carries the same context anyway, but pinning the first
 * value keeps the row honest if a param somehow changes mid-load.
 *
 * 🛑 That pinning is UPSERT semantics, which a mocked D1 cannot check — a mutation adding
 * `first_seen = excluded.last_seen` here passed the whole mocked suite. `sessions.test.ts`
 * runs this exact statement against real SQLite; keep it doing so.
 */
export const SESSION_UPSERT = `
    INSERT INTO sessions (session_id, first_seen, last_seen, day, pings, club_id, match_id,
                          theme, client, client_version, os, screen, country, city, visitor,
                          asn_org, timezone, language, app, viewport)
    VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
    ON CONFLICT (session_id) DO UPDATE SET
        last_seen = excluded.last_seen,
        pings     = sessions.pings + excluded.pings`;

/** The network's AS number, from Cloudflare. A number or nothing. */
export function asn(cf: IncomingRequestCfProperties | undefined): number | null {
    const n = Number(cf?.asn);
    return Number.isInteger(n) && n > 0 ? n : null;
}

/** The network's name ("Sri Lanka Telecom", "Hetzner Online GmbH"), capped. */
export function asnOrg(cf: IncomingRequestCfProperties | undefined): string | null {
    const s = typeof cf?.asOrganization === 'string' ? cf.asOrganization.trim() : '';
    return s ? s.slice(0, 64) : null;
}

export async function touchSession(env: Env, event: NormalizedEvent, ts: string, day: string,
                                   visitor: string, cf: IncomingRequestCfProperties | undefined): Promise<void> {
    if (!event.sessionId) return;
    await env.DB.prepare(SESSION_UPSERT)
        .bind(event.sessionId, ts, day, event.event === 'overlay_ping' ? 1 : 0,
              event.clubId, event.matchId, event.theme, event.client, event.clientVersion,
              event.os, event.screen, cf?.country ?? null, cf?.city ?? null, visitor,
              asnOrg(cf), event.timezone, event.language, event.app, event.viewport)
        .run();
}
