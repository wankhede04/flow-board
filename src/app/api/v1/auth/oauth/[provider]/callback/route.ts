/**
 * OAuth callback: verifies the CSRF state, exchanges the code server-side,
 * resolves/provisions the user, sets the session cookie and redirects home.
 * All failures land back on the login page with a human-readable
 * `?auth_error=` message instead of a bare JSON error.
 */

import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';
import {
  exchangeCode,
  fetchProfile,
  findOrCreateOAuthUser,
  isOAuthProvider,
  isProviderConfigured,
  OAUTH_STATE_COOKIE,
} from '@/lib/oauth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function loginRedirect(req: Request, error?: string) {
  const base = process.env.APP_BASE_URL ?? new URL(req.url).origin;
  const url = new URL('/', base);
  if (error) url.searchParams.set('auth_error', error);
  const res = NextResponse.redirect(url, 302);
  res.cookies.delete(OAUTH_STATE_COOKIE);
  return res;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export async function GET(req: Request, ctx: { params: { provider: string } }) {
  const provider = ctx.params.provider;
  if (!isOAuthProvider(provider) || !isProviderConfigured(provider)) {
    return loginRedirect(req, 'This sign-in method is not configured.');
  }

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expectedState = readCookie(req, OAUTH_STATE_COOKIE);

  if (url.searchParams.get('error')) {
    return loginRedirect(req, 'Sign-in was cancelled.');
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    return loginRedirect(req, 'Sign-in session expired or was tampered with. Please try again.');
  }

  const accessToken = await exchangeCode(provider, code);
  if (!accessToken) {
    return loginRedirect(req, 'Could not complete sign-in with the provider. Please try again.');
  }

  const profile = await fetchProfile(provider, accessToken);
  if (!profile) {
    return loginRedirect(req, 'Your account has no verified email address we can use.');
  }

  const user = await findOrCreateOAuthUser(profile);
  if (!user) {
    return loginRedirect(req, 'Sign-ups from this email domain are not allowed on this instance.');
  }

  const res = loginRedirect(req);
  res.cookies.set(SESSION_COOKIE, user.id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
}
