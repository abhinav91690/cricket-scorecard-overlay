import { describe, it, expect } from 'vitest';
import { normalizeEvent, visitorHash } from './collect';

describe('normalizeEvent', () => {
    it('accepts a well-formed overlay_start and trims/caps fields', () => {
        const e = normalizeEvent({
            event: 'overlay_start', clubId: '1089463', matchId: ' 2079 ', theme: 'kkr', logo: '1',
            client: 'obs', clientVersion: '30.2.3', os: 'windows', screen: '1920x1080',
        });
        expect(e).toMatchObject({ event: 'overlay_start', clubId: '1089463', matchId: '2079', theme: 'kkr', client: 'obs', clientVersion: '30.2.3' });
        expect(e?.videoId).toBeNull();
        expect(e?.outcome).toBeNull();
    });

    it('rejects unknown events and non-objects', () => {
        expect(normalizeEvent({ event: 'overlay_heartbeat' })).toBeNull();
        expect(normalizeEvent({ event: 'drop table' })).toBeNull();
        expect(normalizeEvent('overlay_start')).toBeNull();
        expect(normalizeEvent(null)).toBeNull();
    });

    it('drops non-numeric ids and unknown clients instead of storing them', () => {
        const e = normalizeEvent({ event: 'overlay_start', clubId: 'abc', matchId: '12; DROP', client: 'chrome' });
        expect(e?.clubId).toBeNull();
        expect(e?.matchId).toBeNull();
        expect(e?.client).toBeNull();
    });

    it('caps free-text fields', () => {
        const e = normalizeEvent({ event: 'overlay_start', theme: 'x'.repeat(500) });
        expect(e?.theme).toHaveLength(32);
    });

    it('keeps video id and outcome only for link_stream_submit', () => {
        const link = normalizeEvent({ event: 'link_stream_submit', clubId: '1', matchId: '2', videoId: 'dQw4w9WgXcQ', outcome: 'submitted' });
        expect(link).toMatchObject({ videoId: 'dQw4w9WgXcQ', outcome: 'submitted' });

        const other = normalizeEvent({ event: 'home_view', videoId: 'dQw4w9WgXcQ', outcome: 'submitted' });
        expect(other?.videoId).toBeNull();
        expect(other?.outcome).toBeNull();
    });

    it('defaults an unknown link outcome to error and drops malformed video ids', () => {
        const e = normalizeEvent({ event: 'link_stream_submit', videoId: 'not a video id!', outcome: 'exploded' });
        expect(e?.videoId).toBeNull();
        expect(e?.outcome).toBe('error');
    });
});

describe('session ids', () => {
    it('accepts exactly the 16 lowercase hex characters analytics.ts issues', () => {
        expect(normalizeEvent({ event: 'home_view', sessionId: 'a1b2c3d4e5f60718' })?.sessionId).toBe('a1b2c3d4e5f60718');
    });

    it('drops anything else, because the value is a PRIMARY KEY', () => {
        const bad = ['A1B2C3D4E5F60718', 'a1b2c3d4e5f6071', 'a1b2c3d4e5f607189', 'a1b2c3d4-e5f6-0718',
                     'zzzzzzzzzzzzzzzz', '', '  ', 'a1b2c3d4e5f60718 or 1=1'];
        for (const sessionId of bad) {
            expect(normalizeEvent({ event: 'home_view', sessionId })?.sessionId, sessionId).toBeNull();
        }
        expect(normalizeEvent({ event: 'home_view', sessionId: 42 })?.sessionId).toBeNull();
        expect(normalizeEvent({ event: 'home_view' })?.sessionId).toBeNull();
    });

    it('accepts a ping with a session id and rejects one without', () => {
        expect(normalizeEvent({ event: 'overlay_ping', sessionId: 'a1b2c3d4e5f60718' })).toMatchObject({
            event: 'overlay_ping', sessionId: 'a1b2c3d4e5f60718',
        });
        // 🛑 A ping with no usable session id has nothing to update, so it is refused outright
        // rather than written somewhere harmless.
        expect(normalizeEvent({ event: 'overlay_ping' })).toBeNull();
        expect(normalizeEvent({ event: 'overlay_ping', sessionId: 'NOPE' })).toBeNull();
    });

    it('carries the overlay context on a ping, so a session needs no join', () => {
        const e = normalizeEvent({ event: 'overlay_ping', sessionId: '0000000000000001', clubId: '1089463', matchId: '4670', theme: 'kkr', client: 'obs', os: 'windows', screen: '1920x1080' });
        expect(e).toMatchObject({ clubId: '1089463', matchId: '4670', theme: 'kkr', client: 'obs', os: 'windows' });
    });
});

describe('visitorHash', () => {
    it('is stable for the same inputs and changes with the day', async () => {
        const a = await visitorHash('1.2.3.4', 'ua', '2026-09-03', 'salt');
        const b = await visitorHash('1.2.3.4', 'ua', '2026-09-03', 'salt');
        const c = await visitorHash('1.2.3.4', 'ua', '2026-09-04', 'salt');
        expect(a).toBe(b);
        expect(a).not.toBe(c);
        expect(a).toMatch(/^[0-9a-f]{16}$/);
    });
});
