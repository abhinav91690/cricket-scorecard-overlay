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
