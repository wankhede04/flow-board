/**
 * OAuth start: redirects to the provider's consent screen with a CSRF
 * `state` bound to an httpOnly cookie.
 */

import { NextResponse } from 'next/server';
import {
  buildAuthorizeUrl,
  isOAuthProvider,
  isProviderConfigured,
  newStateToken,
  OAUTH_STATE_COOKIE,
} from '@/lib/oauth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, ctx: { params: { provider: string } }) {
  const provider = ctx.params.provider;
  if (!isOAuthProvider(provider) || !isProviderConfigured(provider)) {
    return NextResponse.json(
      { error: `OAuth provider "${provider}" is not configured` },
      { status: 404 },
    );
  }

  const state = newStateToken();
  const res = NextResponse.redirect(buildAuthorizeUrl(provider, state), 302);
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 minutes to complete the consent screen
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
}
