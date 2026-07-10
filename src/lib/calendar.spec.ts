/**
 * Unit tests for the pure Google Calendar helpers — event normalisation,
 * selection merging on re-connect, auth URL construction, and the Schedule
 * view's period → date-range math.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { buildCalendarAuthUrl, mergeSelections, normalizeEvent } from './calendar';
import { rangeForPeriod } from '@/components/schedule/ScheduleClient';

beforeAll(() => {
  process.env.APP_BASE_URL = 'https://flow.example.com';
  process.env.GOOGLE_CLIENT_ID = 'google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
});

const CAL = { id: 'primary', summary: 'Work', color: '#4285F4' };

describe('normalizeEvent', () => {
  it('normalises a timed event', () => {
    const e = normalizeEvent(
      {
        id: 'ev1',
        summary: 'Standup',
        htmlLink: 'https://calendar.google.com/e/1',
        start: { dateTime: '2026-07-10T09:00:00+05:30' },
        end: { dateTime: '2026-07-10T09:15:00+05:30' },
      },
      CAL,
      'me@example.com',
    );
    expect(e).toMatchObject({
      id: 'primary:ev1',
      title: 'Standup',
      allDay: false,
      calendarName: 'Work',
      accountEmail: 'me@example.com',
      color: '#4285F4',
    });
  });

  it('marks date-only events as all-day and skips cancelled/incomplete ones', () => {
    const allDay = normalizeEvent(
      { id: 'ev2', summary: 'Holiday', start: { date: '2026-07-11' }, end: { date: '2026-07-12' } },
      CAL,
      'me@example.com',
    );
    expect(allDay?.allDay).toBe(true);
    expect(allDay?.start).toBe('2026-07-11');

    expect(
      normalizeEvent({ id: 'ev3', status: 'cancelled', start: { date: '2026-07-11' }, end: { date: '2026-07-12' } }, CAL, 'x'),
    ).toBeNull();
    expect(normalizeEvent({ id: 'ev4' }, CAL, 'x')).toBeNull();
  });
});

describe('mergeSelections', () => {
  it('keeps the previous selection for known calendars, defaults for new ones', () => {
    const previous = [
      { id: 'a', summary: 'A', color: null, primary: true, selected: false }, // user deselected
      { id: 'b', summary: 'B', color: null, primary: false, selected: true }, // user selected
    ];
    const fresh = [
      { id: 'a', summary: 'A', color: null, primary: true, selected: true },
      { id: 'b', summary: 'B', color: null, primary: false, selected: false },
      { id: 'c', summary: 'C (new)', color: null, primary: false, selected: false },
    ];
    const merged = mergeSelections(previous, fresh);
    expect(merged.find((c) => c.id === 'a')?.selected).toBe(false);
    expect(merged.find((c) => c.id === 'b')?.selected).toBe(true);
    expect(merged.find((c) => c.id === 'c')?.selected).toBe(false);
  });
});

describe('buildCalendarAuthUrl', () => {
  it('requests offline calendar.readonly access with consent + state', () => {
    const url = new URL(buildCalendarAuthUrl('state-xyz'));
    expect(url.searchParams.get('scope')).toContain('calendar.readonly');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('state')).toBe('state-xyz');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://flow.example.com/api/v1/calendar/google/callback',
    );
  });
});

describe('rangeForPeriod', () => {
  it('covers exactly one day / ISO week / calendar month', () => {
    const day = rangeForPeriod('daily', '2026-07-10');
    expect(day.from.toISOString()).toBe('2026-07-10T00:00:00.000Z');
    expect(day.to.getTime() - day.from.getTime()).toBe(24 * 3600_000);

    const week = rangeForPeriod('weekly', '2026-W28');
    expect(week.from.toISOString().slice(0, 10)).toBe('2026-07-06'); // Monday
    expect(week.to.getTime() - week.from.getTime()).toBe(7 * 24 * 3600_000);

    const month = rangeForPeriod('monthly', '2026-02');
    expect(month.from.toISOString().slice(0, 10)).toBe('2026-02-01');
    expect(month.to.toISOString().slice(0, 10)).toBe('2026-03-01');
  });
});
