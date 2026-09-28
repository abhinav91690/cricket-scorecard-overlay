/**
 * The session SQL, run against real SQLite.
 *
 * 🛑 Why this file exists. `index.test.ts` and `stats.test.ts` mock D1, so they check which
 * statement was prepared and with what — never what SQLite does with it. A deliberate
 * mutation that made `ON CONFLICT` overwrite `first_seen` (turning every duration into zero)
 * passed the entire mocked suite. Everything here is a property of the SQL itself: the
 * migration, the UPSERT, and the `julianday` arithmetic behind every duration on the page.
 *
 * D1 is SQLite, and these statements use nothing D1-specific, so `node:sqlite` is a faithful
 * stand-in for the parts under test. ⚠ It is not a stand-in for the Worker runtime: the SQL
 * lives in `sessions.ts` because exporting it from `index.ts` stopped workerd booting, which
 * no test here could have caught. Run `wrangler dev` too.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SESSION_UPSERT } from './sessions';
import { SESSION_QUERIES } from './stats';

// ⚠ A path, not a `new URL(...)`: workers-types declares its own global URL, which does not
// match the one @types/node's readFileSync overloads expect.
const MIGRATION = join(import.meta.dirname, '../migrations/0002_sessions.sql');

let db: DatabaseSync;

/** One UPSERT with the same argument order `touchSession` binds. */
function touch(sessionId: string, ts: string, pings: 0 | 1, ctx: Partial<Record<string, string | null>> = {}) {
    const DEFAULTS: Record<string, string | null> = {
        clubId: '1089463', matchId: '4670', theme: 'kkr', client: 'obs', clientVersion: '30.2',
        os: 'windows', screen: '1920x1080', country: 'US', city: 'Austin', visitor: 'a1b2c3d4e5f60718',
    };
    // ⚠ `??` would turn an explicit null back into the default, which is how the first draft
    // of the no-context test passed while asserting the opposite of what it ran.
    const v = (k: string): string | null => (k in ctx ? ctx[k] ?? null : DEFAULTS[k]);
    db.prepare(SESSION_UPSERT).run(
        sessionId, ts, ts.slice(0, 10), pings,
        v('clubId'), v('matchId'), v('theme'), v('client'), v('clientVersion'),
        v('os'), v('screen'), v('country'), v('city'), v('visitor'),
    );
}

const row = (sessionId = 'a1b2c3d4e5f60718') =>
    db.prepare('SELECT * FROM sessions WHERE session_id = ?1').get(sessionId) as Record<string, string | number>;

const query = (name: keyof typeof SESSION_QUERIES, since = '2000-01-01') =>
    db.prepare(SESSION_QUERIES[name]).all(since) as Record<string, string | number>[];

beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(readFileSync(MIGRATION, 'utf8'));
});

describe('migration 0002', () => {
    it('applies, and applies twice without error', () => {
        db.exec(readFileSync(MIGRATION, 'utf8'));   // IF NOT EXISTS everywhere
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
        expect(tables.map(t => t.name)).toContain('sessions');
    });

    it('makes session_id the primary key, so a ping can only ever update its own row', () => {
        touch('a1b2c3d4e5f60718', '2026-09-27T01:00:00.000Z', 0);
        touch('00000000deadbeef', '2026-09-27T01:00:00.000Z', 0);
        expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toMatchObject({ n: 2 });
        expect(() => db.prepare('INSERT INTO sessions (session_id, first_seen, last_seen, day) VALUES (?1, ?2, ?2, ?3)')
            .run('a1b2c3d4e5f60718', '2026-09-27T02:00:00.000Z', '2026-09-27')).toThrow(/UNIQUE|PRIMARY/i);
    });
});

describe('SESSION_UPSERT', () => {
    it('inserts the first event of a load with a zero-length session', () => {
        touch('a1b2c3d4e5f60718', '2026-09-27T01:00:00.000Z', 0);
        const r = row();
        expect(r.first_seen).toBe('2026-09-27T01:00:00.000Z');
        expect(r.last_seen).toBe('2026-09-27T01:00:00.000Z');
        expect(r.pings).toBe(0);
        expect(r.day).toBe('2026-09-27');
        expect(r.match_id).toBe('4670');
    });

    it('moves last_seen forward and accumulates pings, never touching first_seen', () => {
        touch('a1b2c3d4e5f60718', '2026-09-27T01:00:00.000Z', 0);          // overlay_start
        for (let i = 1; i <= 24; i++) {                                     // 24 pings = 2 hours
            const t = new Date(Date.parse('2026-09-27T01:00:00.000Z') + i * 300_000).toISOString();
            touch('a1b2c3d4e5f60718', t, 1);
        }
        const r = row();
        // 🛑 The mutation this file was written for: first_seen must still be the load time.
        expect(r.first_seen).toBe('2026-09-27T01:00:00.000Z');
        expect(r.last_seen).toBe('2026-09-27T03:00:00.000Z');
        expect(r.pings).toBe(24);
        expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toMatchObject({ n: 1 });
    });

    it('keeps the context of the load, not of the latest ping', () => {
        touch('a1b2c3d4e5f60718', '2026-09-27T01:00:00.000Z', 0, { theme: 'kkr', matchId: '4670' });
        touch('a1b2c3d4e5f60718', '2026-09-27T01:05:00.000Z', 1, { theme: 'csk', matchId: '9999' });
        expect(row()).toMatchObject({ theme: 'kkr', match_id: '4670' });
    });

    it('survives a ping that arrives with no overlay context at all', () => {
        touch('a1b2c3d4e5f60718', '2026-09-27T01:00:00.000Z', 1, {
            clubId: null, matchId: null, theme: null, client: null, clientVersion: null,
            os: null, screen: null, country: null, city: null, visitor: null,
        });
        expect(row()).toMatchObject({ pings: 1, club_id: null, theme: null });
    });
});

describe('duration queries', () => {
    /** A load at `startIso` that pinged every 5 minutes for `pings` intervals. */
    function session(sessionId: string, startIso: string, pings: number, ctx: Partial<Record<string, string | null>> = {}) {
        touch(sessionId, startIso, 0, ctx);
        for (let i = 1; i <= pings; i++) {
            touch(sessionId, new Date(Date.parse(startIso) + i * 300_000).toISOString(), 1, ctx);
        }
    }

    it('computes seconds from the two timestamps', () => {
        session('0000000000000001', '2026-09-27T01:00:00.000Z', 24);      // 2h
        session('0000000000000002', '2026-09-27T05:00:00.000Z', 6);       // 30m
        session('0000000000000003', '2026-09-27T09:00:00.000Z', 0);       // under one ping
        const secs = query('durations').map(r => Number(r.secs)).sort((a, b) => a - b);
        expect(secs).toEqual([0, 1800, 7200]);
    });

    it('crosses midnight without going negative', () => {
        session('0000000000000004', '2026-09-27T23:30:00.000Z', 12);      // ends 01:30 next day
        const [r] = query('durations');
        expect(Number(r.secs)).toBe(3600);
        expect(row('0000000000000004').day).toBe('2026-09-27');           // filed under the start day
    });

    it('totals time on air per match and finds the longest session', () => {
        session('0000000000000005', '2026-09-27T01:00:00.000Z', 24, { matchId: '4670' });
        session('0000000000000006', '2026-09-27T01:02:00.000Z', 6, { matchId: '4670' });
        session('0000000000000007', '2026-09-27T05:00:00.000Z', 12, { matchId: '4671' });
        const byMatch = query('byMatch');
        expect(byMatch).toHaveLength(2);
        expect(byMatch[0]).toMatchObject({ match_id: '4670', sessions: 2, total_secs: 9000, longest_secs: 7200 });
        expect(byMatch[1]).toMatchObject({ match_id: '4671', sessions: 1, total_secs: 3600 });
    });

    it('lists recent sessions newest first, with their length', () => {
        session('0000000000000008', '2026-09-27T01:00:00.000Z', 6);
        session('0000000000000009', '2026-09-27T05:00:00.000Z', 24);
        const recent = query('recent');
        expect(recent.map(r => r.session_id ?? r.first_seen)).toEqual([
            '2026-09-27T05:00:00.000Z', '2026-09-27T01:00:00.000Z',
        ]);
        expect(Number(recent[0].secs)).toBe(7200);
    });

    it('honours the since-date on every query', () => {
        session('0000000000000010', '2026-09-20T01:00:00.000Z', 6);       // outside the window
        session('0000000000000011', '2026-09-27T01:00:00.000Z', 6);       // inside
        for (const name of ['durations', 'recent', 'byMatch'] as const) {
            expect(query(name, '2026-09-25'), name).toHaveLength(1);
        }
    });
});
