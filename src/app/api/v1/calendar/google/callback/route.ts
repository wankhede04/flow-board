/**
 * Google Calendar connect callback: verifies state, exchanges the code,
 * stores the account (refresh token + calendar list), and returns to the
 * Schedule page. Errors land back on the page with ?cal_error=.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  CALENDAR_STATE_COOKIE,
  exchangeCalendarCode,
  fetchGoogleEmail,
  upsertCalendarAccount,
} from '@/lib/calendar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export async function GET(req: Request) {
  const base = process.env.APP_BASE_URL ?? new URL(req.url).origin;
  const stateCookie = readCookie(req, CALENDAR_STATE_COOKIE);
  let wid = '';
  let expectedToken = '';
  try {
    const parsed = JSON.parse(stateCookie ?? '{}') as { token?: string; wid?: string };
    wid = parsed.wid ?? '';
    expectedToken = parsed.token ?? '';
  } catch {
    /* fall through to error redirect */
  }

  const target = wid ? `/workspace/${wid}/schedule` : '/';
  const redirect = (error?: string) => {
    const url = new URL(target, base);
    if (error) url.searchParams.set('cal_error', error);
    const res = NextResponse.redirect(url, 302);
    res.cookies.delete(CALENDAR_STATE_COOKIE);
    return res;
  };

  const user = await getCurrentUser();
  if (!user) return redirect('Your session expired — sign in and try again.');

  const url = new URL(req.url);
  if (url.searchParams.get('error')) return redirect('Connection was cancelled.');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state || !expectedToken || state !== expectedToken) {
    return redirect('Connection session expired or was tampered with. Please try again.');
  }

  const tokens = await exchangeCalendarCode(code);
  if (!tokens?.access_token) return redirect('Could not complete the Google connection.');
  if (!tokens.refresh_token) {
    return redirect('Google did not grant offline access — remove FlowBoard from your Google account permissions and try again.');
  }

  const email = await fetchGoogleEmail(tokens.access_token);
  if (!email) return redirect('Could not read the Google account email.');

  await upsertCalendarAccount({
    userId: user.id,
    email,
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    expiresIn: tokens.expires_in ?? 3600,
  });

  return redirect();
}
