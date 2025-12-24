import { describe, it, expect } from 'vitest';
import { getBallStyleClass } from './utils';

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
