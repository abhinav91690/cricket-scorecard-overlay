import { describe, it, expect } from 'vitest';
import { getBallStyleClass, getQueryParams } from './utils';

describe('getBallStyleClass', () => {
    it('should return wicket for "W" or "w"', () => {
        expect(getBallStyleClass('W')).toBe('wicket');
        expect(getBallStyleClass('w')).toBe('wicket');
    });

    it('should return wide for "wd" variations', () => {
        expect(getBallStyleClass('wd')).toBe('wide');
        expect(getBallStyleClass('1wd')).toBe('wide');
    });

    it('should return no-ball for "nb" variations', () => {
        expect(getBallStyleClass('nb')).toBe('no-ball');
        expect(getBallStyleClass('1nb')).toBe('no-ball');
    });

    it('should return dot for "."', () => {
        expect(getBallStyleClass('.')).toBe('dot');
    });

    it('should return run classes for runs', () => {
        expect(getBallStyleClass('1')).toBe('run-1');
        expect(getBallStyleClass('4')).toBe('run-4');
        expect(getBallStyleClass('6')).toBe('run-6');
    });

    it('should return default for unknown input', () => {
        expect(getBallStyleClass('xyz')).toBe('ball-default');
    });
});

describe('getQueryParams', () => {
    // Helper to mock window.location.search
    const mockLocationSearch = (search: string) => {
        Object.defineProperty(window, 'location', {
            value: {
                search: search,
                href: `http://localhost/${search}`,
                origin: 'http://localhost'
            },
            writable: true
        });
    };

    it('should parse matchId correctly', () => {
        mockLocationSearch('?matchId=12345');
        const params = getQueryParams();
        expect(params.matchId).toBe('12345');
    });

    it('should use default clubId if not provided', () => {
        mockLocationSearch('');
        const params = getQueryParams();
        expect(params.clubId).toBe('1089463'); // Values from CONFIG.DEFAULT_CLUB_ID
    });

    it('should override clubId if provided', () => {
        mockLocationSearch('?clubId=999');
        const params = getQueryParams();
        expect(params.clubId).toBe('999');
    });

    it('should parse logo parameter', () => {
        mockLocationSearch('?logo=1');
        const params = getQueryParams();
        expect(params.logo).toBe('1');
    });

    it('should parse debug parameter', () => {
        mockLocationSearch('?debug=true');
        const params = getQueryParams();
        expect(params.debug).toBe('true');
    });

    it('should parse multiple parameters', () => {
        mockLocationSearch('?matchId=100&clubId=200&debug=true&mode=replay');
        const params = getQueryParams();
        expect(params.matchId).toBe('100');
        expect(params.clubId).toBe('200');
        expect(params.debug).toBe('true');
        expect(params.mode).toBe('replay');
    });
});
