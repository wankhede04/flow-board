/**
 * Google Calendar integration (read-only) — request #6.
 *
 * A user connects one or more Google accounts; each connection stores an
 * offline refresh token scoped to calendar.readonly plus the set of
 * calendars selected for the Schedule view. Events for a date range are
 * fetched live from the Google Calendar API and merged across accounts.
 *
 * Reuses the login OAuth app (GOOGLE_CLIENT_ID/SECRET) with an extra scope
 * and its own redirect URI: $APP_BASE_URL/api/v1/calendar/google/callback.
 * Enable the "Google Calendar API" for the OAuth project in Google Cloud.
 */

import { randomBytes } from 'crypto';
import { prisma } from './db';
import { newId } from './ids';

export const CALENDAR_STATE_COOKIE = 'fb_cal_state';
export const CALENDAR_SCOPE = 'openid email https://www.googleapis.com/auth/calendar.readonly';

export interface CalendarInfo {
  id: string;
  summary: string;
  color: string | null;
  primary: boolean;
  selected: boolean;
}

export interface ScheduleEvent {
  id: string;
  title: string;
  start: string; // ISO datetime, or YYYY-MM-DD for all-day
  end: string;
  allDay: boolean;
  calendarId: string;
  calendarName: string;
  accountEmail: string;
  color: string | null;
  link: string | null;
}

function baseUrl(): string {
  return (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

export function calendarRedirectUri(): string {
  return `${baseUrl()}/api/v1/calendar/google/callback`;
}

export function calendarConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function newCalendarState(wid: string): { token: string; cookieValue: string } {
  const token = randomBytes(24).toString('hex');
  return { token, cookieValue: JSON.stringify({ token, wid }) };
}

export function buildCalendarAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: calendarRedirectUri(),
    response_type: 'code',
    scope: CALENDAR_SCOPE,
    access_type: 'offline',
    prompt: 'consent', // always mint a refresh token, even on re-connect
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

export async function exchangeCalendarCode(code: string): Promise<TokenResponse | null> {
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID ?? '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
        code,
        redirect_uri: calendarRedirectUri(),
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok) return null;
    return (await res.json()) as TokenResponse;
  } catch {
    return null;
  }
}

export async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const p = (await res.json()) as { email?: string };
    return p.email ?? null;
  } catch {
    return null;
  }
}

/** Valid access token for the account, refreshing (and persisting) if stale. */
export async function getAccessToken(accountId: string): Promise<string | null> {
  const account = await prisma.googleCalendarAccount.findUnique({ where: { id: accountId } });
  if (!account) return null;
  if (
    account.accessToken &&
    account.tokenExpiresAt &&
    account.tokenExpiresAt.getTime() > Date.now() + 60_000
  ) {
    return account.accessToken;
  }
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID ?? '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
        refresh_token: account.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as TokenResponse;
    if (!json.access_token) return null;
    await prisma.googleCalendarAccount.update({
      where: { id: accountId },
      data: {
        accessToken: json.access_token,
        tokenExpiresAt: new Date(Date.now() + (json.expires_in ?? 3600) * 1000),
      },
    });
    return json.access_token;
  } catch {
    return null;
  }
}

export async function fetchCalendarList(accessToken: string): Promise<CalendarInfo[]> {
  try {
    const res = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=100',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as {
      items?: Array<{ id: string; summary?: string; backgroundColor?: string; primary?: boolean }>;
    };
    return (json.items ?? []).map((c) => ({
      id: c.id,
      summary: c.summary ?? c.id,
      color: c.backgroundColor ?? null,
      primary: Boolean(c.primary),
      selected: Boolean(c.primary), // primary calendar selected by default
    }));
  } catch {
    return [];
  }
}

/** Create or refresh a connected account after the OAuth callback. */
export async function upsertCalendarAccount(input: {
  userId: string;
  email: string;
  refreshToken: string;
  accessToken: string;
  expiresIn: number;
}) {
  const existing = await prisma.googleCalendarAccount.findUnique({
    where: { userId_email: { userId: input.userId, email: input.email } },
  });
  const calendars = await fetchCalendarList(input.accessToken);
  const calendarsJson = JSON.stringify(
    // Preserve the user's previous selection when re-connecting.
    existing
      ? mergeSelections(JSON.parse(existing.calendars) as CalendarInfo[], calendars)
      : calendars,
  );
  return prisma.googleCalendarAccount.upsert({
    where: { userId_email: { userId: input.userId, email: input.email } },
    update: {
      refreshToken: input.refreshToken,
      accessToken: input.accessToken,
      tokenExpiresAt: new Date(Date.now() + input.expiresIn * 1000),
      calendars: calendarsJson,
    },
    create: {
      id: newId('gca'),
      userId: input.userId,
      email: input.email,
      refreshToken: input.refreshToken,
      accessToken: input.accessToken,
      tokenExpiresAt: new Date(Date.now() + input.expiresIn * 1000),
      calendars: calendarsJson,
    },
  });
}

export function mergeSelections(previous: CalendarInfo[], fresh: CalendarInfo[]): CalendarInfo[] {
  const prevById = new Map(previous.map((c) => [c.id, c]));
  return fresh.map((c) => ({ ...c, selected: prevById.get(c.id)?.selected ?? c.selected }));
}

interface GoogleEventItem {
  id: string;
  status?: string;
  summary?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

export function normalizeEvent(
  item: GoogleEventItem,
  calendar: { id: string; summary: string; color: string | null },
  accountEmail: string,
): ScheduleEvent | null {
  if (item.status === 'cancelled') return null;
  const start = item.start?.dateTime ?? item.start?.date;
  const end = item.end?.dateTime ?? item.end?.date;
  if (!start || !end) return null;
  return {
    id: `${calendar.id}:${item.id}`,
    title: item.summary ?? '(no title)',
    start,
    end,
    allDay: Boolean(item.start?.date),
    calendarId: calendar.id,
    calendarName: calendar.summary,
    accountEmail,
    color: calendar.color,
    link: item.htmlLink ?? null,
  };
}

/** Events across every selected calendar of every connected account. */
export async function fetchEventsForUser(
  userId: string,
  from: Date,
  to: Date,
): Promise<ScheduleEvent[]> {
  const accounts = await prisma.googleCalendarAccount.findMany({ where: { userId } });
  const all: ScheduleEvent[] = [];

  for (const account of accounts) {
    const token = await getAccessToken(account.id);
    if (!token) continue;
    const calendars = (JSON.parse(account.calendars) as CalendarInfo[]).filter((c) => c.selected);

    const results = await Promise.all(
      calendars.map(async (calendar) => {
        try {
          const params = new URLSearchParams({
            timeMin: from.toISOString(),
            timeMax: to.toISOString(),
            singleEvents: 'true',
            orderBy: 'startTime',
            maxResults: '250',
          });
          const res = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events?${params}`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (!res.ok) return [];
          const json = (await res.json()) as { items?: GoogleEventItem[] };
          return (json.items ?? [])
            .map((item) => normalizeEvent(item, calendar, account.email))
            .filter((e): e is ScheduleEvent => e !== null);
        } catch {
          return [];
        }
      }),
    );
    all.push(...results.flat());
  }

  return all.sort((a, b) => a.start.localeCompare(b.start));
}
