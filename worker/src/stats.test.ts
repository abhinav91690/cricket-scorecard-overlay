import { describe, it, expect } from 'vitest';
import { renderStats } from './stats';
import type { Env } from './env';

type Row = Record<string, unknown>;

/** Fake D1: returns one result set per prepared statement, in batch order. */
function fakeEnv(results: Row[][], captured: { sql: string; since: string }[] = []): Env {
    return {
        DB: {
            prepare: (sql: string) => ({ bind: (since: string) => { captured.push({ sql, since }); return { sql }; } }),
            batch: async () => results.map(r => ({ results: r, success: true })),
        } as unknown as D1Database,
        ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '',
    };
}

const empty = [[{}], [], [], [], [], [], []];

describe('renderStats', () => {
    it('runs all seven aggregates in one batch with the same since-date', async () => {
        const captured: { sql: string; since: string }[] = [];
        await renderStats(fakeEnv(empty, captured), 30);
        expect(captured).toHaveLength(7);
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
