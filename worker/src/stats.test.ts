import { describe, it, expect } from 'vitest';
import { renderStats, dur, sessionSummary } from './stats';
import type { Env } from './env';

type Row = Record<string, unknown>;

/**
 * Fake D1: returns one result set per prepared statement, in batch order.
 *
 * ⚠ The page runs TWO batches — the event aggregates, then the session ones — so the fake
 * answers them separately. Returning the same rows to both is what made the first draft of
 * these tests render a session section out of the summary row.
 * `sessions: 'missing'` makes the second batch throw, which is a database without 0002.
 */
function fakeEnv(results: Row[][], captured: { sql: string; since: string }[] = [],
                 sessions: Row[][] | 'missing' = [[], [], []]): Env {
    let call = 0;
    return {
        DB: {
            prepare: (sql: string) => ({ bind: (since: string) => { captured.push({ sql, since }); return { sql }; } }),
            batch: async () => {
                if (call++ === 0) return results.map(r => ({ results: r, success: true }));
                if (sessions === 'missing') throw new Error('no such table: sessions');
                return sessions.map(r => ({ results: r, success: true }));
            },
        } as unknown as D1Database,
        ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '',
    };
}

const empty = [[{}], [], [], [], [], [], []];

describe('renderStats', () => {
    it('runs every aggregate with the same since-date', async () => {
        const captured: { sql: string; since: string }[] = [];
        await renderStats(fakeEnv(empty, captured), 30);
        expect(captured).toHaveLength(10);          // 7 event aggregates + 3 session ones
        expect(new Set(captured.map(c => c.since)).size).toBe(1);
        expect(captured[0].since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        const expected = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
        expect(captured[0].since).toBe(expected);
    });

    it('renders summary numbers and marks the active range', async () => {
        const html = await renderStats(fakeEnv([[{ loads: 12, matches: 3, clubs: 1, visitors: 5, home_views: 2, link_submits: 4, link_ok: 3 }], [], [], [], [], [], []]), 90);
        expect(html).toContain('<div class="n">12</div><div class="l">overlay loads</div>');
        expect(html).toContain('<div class="n">3 / 4</div><div class="l">stream links</div>');
        expect(html).toContain('<b>90d</b>');
        expect(html).toContain('<a href="?days=30">30d</a>');
    });

    it('shows a placeholder for empty tables and zeros for a missing summary row', async () => {
        const html = await renderStats(fakeEnv([[], [], [], [], [], [], []]), 7);
        expect(html.match(/Nothing yet\./g)).toHaveLength(6);
        expect(html).toContain('<div class="n">0</div><div class="l">overlay loads</div>');
    });

    it('links matches to CricClubs and videos to YouTube', async () => {
        const matches = [{ club_id: '1089463', match_id: '2079', loads: 2, visitors: 1, first_seen: '2026-09-04T01:00:00.000Z', last_seen: '2026-09-04T02:30:00.000Z', themes: 'kkr', clients: 'obs', countries: 'US' }];
        const links = [{ ts: '2026-09-04T02:31:00.000Z', club_id: '1089463', match_id: '2079', video_id: 'dQw4w9WgXcQ', outcome: 'submitted', country: 'US', client: 'browser' }];
        const html = await renderStats(fakeEnv([[{}], [], matches, [], [], [], links]), 30);
        expect(html).toContain('href="https://cricclubs.com/CricClubsLiveCP.do?clubId=1089463&amp;matchId=2079"');
        expect(html).toContain('href="https://youtu.be/dQw4w9WgXcQ"');
        expect(html).toContain('<td>2026-09-04 02:30</td>');   // ISO timestamp shortened for display
    });

    it('escapes stored values so a hostile theme name cannot inject markup', async () => {
        const themes = [{ theme: '<script>alert(1)</script>', loads: 1 }];
        const clients = [{ client: 'browser', version: '"onmouseover="x', os: 'linux', screen: '1x1', loads: 1 }];
        const html = await renderStats(fakeEnv([[{}], [], [], themes, clients, [], []]), 30);
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(html).toContain('&quot;onmouseover=&quot;x');
    });
});

describe('dur', () => {
    it('reads under a ping interval as a floor, not as zero', () => {
        expect(dur(0)).toBe('<5m');
        expect(dur(299)).toBe('<5m');
        expect(dur(null)).toBe('<5m');
        expect(dur(-10)).toBe('<5m');          // clock skew between two pings
    });

    it('formats minutes and hours', () => {
        expect(dur(300)).toBe('5m');
        expect(dur(3540)).toBe('59m');
        expect(dur(3600)).toBe('1h 00m');
        expect(dur(11_700)).toBe('3h 15m');
    });
});

describe('sessionSummary', () => {
    it('takes the median of an odd and an even count', () => {
        expect(sessionSummary([{ secs: 600 }, { secs: 1800 }, { secs: 300 }]).median).toBe(600);
        expect(sessionSummary([{ secs: 600 }, { secs: 1800 }, { secs: 300 }, { secs: 900 }]).median).toBe(750);
    });

    it('counts only sessions that lived long enough to ping, and totals the hours', () => {
        const rows = [{ secs: 0, pings: 0 }, { secs: 3600, pings: 12 }, { secs: 1800, pings: 6 }];
        const sum = sessionSummary(rows);
        expect(sum.sessions).toBe(3);
        expect(sum.live).toBe(2);
        expect(sum.longest).toBe(3600);
        expect(sum.hours).toBe(1.5);
    });
});

describe('renderStats session section', () => {
    const durations = [{ secs: 7200, pings: 24 }, { secs: 1800, pings: 6 }, { secs: 0, pings: 0 }];
    const byMatch = [{ club_id: '1089463', match_id: '4670', sessions: 2, total_secs: 9000, longest_secs: 7200 }];
    const recent = [{ first_seen: '2026-09-27T01:00:00.000Z', last_seen: '2026-09-27T03:00:00.000Z', secs: 7200, pings: 24, club_id: '1089463', match_id: '4670', theme: 'kkr', client: 'obs', country: 'US' }];

    it('renders lengths, the on-air total and the floor caveat', async () => {
        const html = await renderStats(fakeEnv(empty, [], [durations, recent, byMatch]), 30);   // SESSION_QUERIES order
        expect(html).toContain('Session length');
        expect(html).toContain('<div class="n">3</div><div class="l">sessions</div>');
        expect(html).toContain('<div class="n">2</div><div class="l">reached 5 min</div>');
        expect(html).toContain('<div class="n">30m</div><div class="l">median</div>');
        expect(html).toContain('<div class="n">2h 00m</div><div class="l">longest</div>');
        expect(html).toContain('<div class="n">2.5</div><div class="l">overlay hours</div>');
        expect(html).toContain('every figure is a floor');
        expect(html).toContain('<td>2h 30m</td>');        // on-air total for the match
    });

    it('still renders the rest of the page when 0002 has not been applied yet', async () => {
        const html = await renderStats(fakeEnv(empty, [], 'missing'), 30);
        expect(html).toContain('Cricket Scorecard Overlay');
        expect(html).toContain('overlay loads');
        expect(html).not.toContain('Session length');
    });

    it('omits the section on a migrated but empty database', async () => {
        const html = await renderStats(fakeEnv(empty, [], [[], [], []]), 30);
        expect(html).not.toContain('Session length');
        expect(html).not.toContain('overlay hours');
    });
});
