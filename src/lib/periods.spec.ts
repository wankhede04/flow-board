/**
 * Unit tests for cadence period helpers — key computation across timezones,
 * ISO-week edge cases at year boundaries, shifting, and validation.
 */

import { describe, it, expect } from 'vitest';
import {
  currentPeriodKeys,
  isValidPeriodKey,
  mondayOfIsoWeek,
  periodKeyFor,
  periodLabel,
  shiftPeriodKey,
} from './periods';

describe('periodKeyFor', () => {
  const d = new Date('2026-07-08T12:00:00Z');

  it('computes all cadences in UTC', () => {
    expect(periodKeyFor('daily', d)).toBe('2026-07-08');
    expect(periodKeyFor('weekly', d)).toBe('2026-W28');
    expect(periodKeyFor('monthly', d)).toBe('2026-07');
    expect(periodKeyFor('yearly', d)).toBe('2026');
  });

  it('rolls the day over at the local midnight of the given timezone', () => {
    const lateUtc = new Date('2026-07-08T02:00:00Z');
    // 02:00 UTC on the 8th is still July 7th in Los Angeles (UTC-7).
    expect(periodKeyFor('daily', lateUtc, 'America/Los_Angeles')).toBe('2026-07-07');
    expect(periodKeyFor('daily', lateUtc, 'UTC')).toBe('2026-07-08');
    // …and already July 8th in Tokyo.
    expect(periodKeyFor('daily', lateUtc, 'Asia/Tokyo')).toBe('2026-07-08');
  });

  it('falls back to UTC for an invalid timezone', () => {
    expect(periodKeyFor('daily', d, 'Not/AZone')).toBe('2026-07-08');
  });

  it('assigns early January to the previous ISO week-year when applicable', () => {
    // 2027-01-01 is a Friday → belongs to ISO week 53 of 2026.
    expect(periodKeyFor('weekly', new Date('2027-01-01T12:00:00Z'))).toBe('2026-W53');
    // 2026-01-01 is a Thursday → ISO week 1 of 2026.
    expect(periodKeyFor('weekly', new Date('2026-01-01T12:00:00Z'))).toBe('2026-W01');
    // 2024-12-30 (Monday) belongs to ISO week 1 of 2025.
    expect(periodKeyFor('weekly', new Date('2024-12-30T12:00:00Z'))).toBe('2025-W01');
  });
});

describe('currentPeriodKeys', () => {
  it('returns a consistent set for all four cadences', () => {
    const keys = currentPeriodKeys(new Date('2026-02-01T12:00:00Z'));
    expect(keys).toEqual({
      daily: '2026-02-01',
      weekly: '2026-W05',
      monthly: '2026-02',
      yearly: '2026',
    });
  });
});

describe('shiftPeriodKey', () => {
  it('shifts days across month/year boundaries', () => {
    expect(shiftPeriodKey('daily', '2026-07-08', 1)).toBe('2026-07-09');
    expect(shiftPeriodKey('daily', '2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftPeriodKey('daily', '2026-03-01', -1)).toBe('2026-02-28');
  });

  it('shifts weeks across ISO year boundaries', () => {
    expect(shiftPeriodKey('weekly', '2026-W28', 1)).toBe('2026-W29');
    expect(shiftPeriodKey('weekly', '2026-W53', 1)).toBe('2027-W01');
    expect(shiftPeriodKey('weekly', '2027-W01', -1)).toBe('2026-W53');
  });

  it('shifts months and years across boundaries, both directions', () => {
    expect(shiftPeriodKey('monthly', '2026-12', 1)).toBe('2027-01');
    expect(shiftPeriodKey('monthly', '2026-01', -1)).toBe('2025-12');
    expect(shiftPeriodKey('monthly', '2026-06', -18)).toBe('2024-12');
    expect(shiftPeriodKey('yearly', '2026', -3)).toBe('2023');
  });

  it('round-trips: shifting +n then -n returns the original key', () => {
    for (const [cadence, key] of [
      ['daily', '2026-01-01'],
      ['weekly', '2026-W01'],
      ['monthly', '2026-01'],
      ['yearly', '2026'],
    ] as const) {
      expect(shiftPeriodKey(cadence, shiftPeriodKey(cadence, key, 7), -7)).toBe(key);
    }
  });
});

describe('isValidPeriodKey', () => {
  it('accepts canonical keys and rejects mismatched cadences', () => {
    expect(isValidPeriodKey('daily', '2026-07-08')).toBe(true);
    expect(isValidPeriodKey('weekly', '2026-W28')).toBe(true);
    expect(isValidPeriodKey('monthly', '2026-07')).toBe(true);
    expect(isValidPeriodKey('yearly', '2026')).toBe(true);

    expect(isValidPeriodKey('daily', '2026-W28')).toBe(false);
    expect(isValidPeriodKey('weekly', '2026-07-08')).toBe(false);
    expect(isValidPeriodKey('monthly', '2026')).toBe(false);
    expect(isValidPeriodKey('yearly', 'nope')).toBe(false);
  });
});

describe('mondayOfIsoWeek / periodLabel', () => {
  it('finds the Monday that starts an ISO week', () => {
    const monday = mondayOfIsoWeek(2026, 28);
    expect(monday.toISOString().slice(0, 10)).toBe('2026-07-06');
    expect(monday.getUTCDay()).toBe(1);
  });

  it('renders human labels', () => {
    expect(periodLabel('daily', '2026-07-08')).toBe('Wed, Jul 8, 2026');
    expect(periodLabel('weekly', '2026-W28')).toContain('Week 28');
    expect(periodLabel('monthly', '2026-07')).toBe('July 2026');
    expect(periodLabel('yearly', '2026')).toBe('2026');
  });
});
