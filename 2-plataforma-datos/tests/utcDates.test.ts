import { describe, expect, it } from 'vitest';
import { normalizeIsoUtcDateTime } from '../src/utils/utcDates';

describe('UTC date policy helpers', () => {
    it('normalizes naive date-times to ISO UTC strings with Z', () => {
        expect(normalizeIsoUtcDateTime('2026-07-02T14:14:35')).toBe('2026-07-02T14:14:35.000Z');
        expect(normalizeIsoUtcDateTime('2026-07-02')).toBe('2026-07-02T00:00:00.000Z');
    });
});
