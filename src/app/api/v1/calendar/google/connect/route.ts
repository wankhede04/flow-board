/**
 * Starts the Google Calendar connect flow for the signed-in user.
 * `?wid=` carries the workspace so the callback can land back on the
 * Schedule page. CSRF state + wid ride in an httpOnly cookie.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  buildCalendarAuthUrl,
  calendarConfigured,
  CALENDAR_STATE_COOKIE,
  newCalendarState,
} from '@/lib/calendar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL('/', process.env.APP_BASE_URL ?? new URL(req.url).origin));
  }
  if (!calendarConfigured()) {
    return NextResponse.json(
      { error: 'Google Calendar is not configured (GOOGLE_CLIENT_ID/SECRET missing)' },
      { status: 503 },
    );
  }

  const wid = new URL(req.url).searchParams.get('wid') ?? '';
  const { token, cookieValue } = newCalendarState(wid);
  const res = NextResponse.redirect(buildCalendarAuthUrl(token), 302);
  res.cookies.set(CALENDAR_STATE_COOKIE, cookieValue, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
}
