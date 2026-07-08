/**
 * Cadence period helpers for Goals.
 *
 * A goal belongs to exactly one period of its cadence, identified by a
 * canonical `periodKey`:
 *
 *   daily   → "2026-07-08"   (calendar date)
 *   weekly  → "2026-W28"     (ISO-8601 week, Monday-based)
 *   monthly → "2026-07"
 *   yearly  → "2026"
 *
 * Keys are computed in the user's timezone so "today" rolls over at the
 * user's local midnight, not UTC. This module is isomorphic — no server
 * imports — so client components reuse the exact same math.
 */

export type Cadence = 'daily' | 'weekly' | 'monthly' | 'yearly';
export const CADENCES: Cadence[] = ['daily', 'weekly', 'monthly', 'yearly'];

export type GoalContext = 'personal' | 'professional';
export const GOAL_CONTEXTS: GoalContext[] = ['personal', 'professional'];

interface Ymd {
  y: number;
  m: number; // 1-12
  d: number; // 1-31
}

/** Calendar date parts of `date` as seen in `timeZone`. */
export function datePartsInZone(date: Date, timeZone: string): Ymd {
  // en-CA formats as YYYY-MM-DD, which parses unambiguously.
  let formatted: string;
  try {
    formatted = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    formatted = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }
  const [y, m, d] = formatted.split('-').map(Number);
  return { y, m, d };
}

/** ISO week number + ISO week-based year for a calendar date. */
export function isoWeek({ y, m, d }: Ymd): { isoYear: number; week: number } {
  // Standard ISO-8601 algorithm on a UTC timestamp of the calendar date.
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = date.getUTCDay() || 7; // Mon=1..Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum); // nearest Thursday
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { isoYear, week };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function periodKeyFor(cadence: Cadence, date: Date, timeZone = 'UTC'): string {
  const p = datePartsInZone(date, timeZone);
  switch (cadence) {
    case 'daily':
      return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
    case 'weekly': {
      const { isoYear, week } = isoWeek(p);
      return `${isoYear}-W${pad(week)}`;
    }
    case 'monthly':
      return `${p.y}-${pad(p.m)}`;
    case 'yearly':
      return `${p.y}`;
  }
}

export function currentPeriodKeys(date: Date, timeZone = 'UTC'): Record<Cadence, string> {
  return {
    daily: periodKeyFor('daily', date, timeZone),
    weekly: periodKeyFor('weekly', date, timeZone),
    monthly: periodKeyFor('monthly', date, timeZone),
    yearly: periodKeyFor('yearly', date, timeZone),
  };
}

const KEY_PATTERNS: Record<Cadence, RegExp> = {
  daily: /^\d{4}-\d{2}-\d{2}$/,
  weekly: /^\d{4}-W\d{2}$/,
  monthly: /^\d{4}-\d{2}$/,
  yearly: /^\d{4}$/,
};

export function isValidPeriodKey(cadence: Cadence, key: string): boolean {
  return KEY_PATTERNS[cadence].test(key);
}

/** UTC date of the Monday that starts the given ISO week. */
export function mondayOfIsoWeek(isoYear: number, week: number): Date {
  const jan4 = new Date(Date.UTC(isoYear, 0, 4)); // always in ISO week 1
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  return monday;
}

/**
 * Shift a period key by `delta` periods of its cadence (delta may be
 * negative). Used by the UI's ‹ prev / next › navigation.
 */
export function shiftPeriodKey(cadence: Cadence, key: string, delta: number): string {
  switch (cadence) {
    case 'daily': {
      const [y, m, d] = key.split('-').map(Number);
      const date = new Date(Date.UTC(y, m - 1, d + delta));
      return periodKeyFor('daily', date, 'UTC');
    }
    case 'weekly': {
      const [ys, ws] = key.split('-W');
      const monday = mondayOfIsoWeek(Number(ys), Number(ws));
      monday.setUTCDate(monday.getUTCDate() + delta * 7);
      return periodKeyFor('weekly', monday, 'UTC');
    }
    case 'monthly': {
      const [y, m] = key.split('-').map(Number);
      const total = y * 12 + (m - 1) + delta;
      const ny = Math.floor(total / 12);
      const nm = (total % 12 + 12) % 12 + 1;
      return `${ny}-${pad(nm)}`;
    }
    case 'yearly':
      return String(Number(key) + delta);
  }
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Human label for a period key, e.g. "Tue, Jul 8 2026" / "Week 28, 2026". */
export function periodLabel(cadence: Cadence, key: string): string {
  switch (cadence) {
    case 'daily': {
      const [y, m, d] = key.split('-').map(Number);
      const date = new Date(Date.UTC(y, m - 1, d));
      const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getUTCDay()];
      return `${dow}, ${MONTHS[m - 1].slice(0, 3)} ${d}, ${y}`;
    }
    case 'weekly': {
      const [ys, ws] = key.split('-W');
      const monday = mondayOfIsoWeek(Number(ys), Number(ws));
      const sunday = new Date(monday);
      sunday.setUTCDate(monday.getUTCDate() + 6);
      const fmt = (dt: Date) => `${MONTHS[dt.getUTCMonth()].slice(0, 3)} ${dt.getUTCDate()}`;
      return `Week ${Number(ws)} · ${fmt(monday)} – ${fmt(sunday)}, ${ys}`;
    }
    case 'monthly': {
      const [y, m] = key.split('-').map(Number);
      return `${MONTHS[m - 1]} ${y}`;
    }
    case 'yearly':
      return key;
  }
}
