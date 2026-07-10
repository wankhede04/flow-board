/**
 * Demo login endpoint — LOCAL DEV ONLY. Signs into the seeded demo account
 * by setting the fb_user_id session cookie. Disabled unless
 * ALLOW_DEMO_LOGIN=true; production sign-in is Google/GitHub OAuth
 * (src/lib/oauth.ts). DELETE (sign-out) always works — it only clears the
 * session cookie.
 */

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ok, fail } from '@/lib/api';
import { prisma } from '@/lib/db';
import { ApiError, ErrorCodes } from '@/lib/errors';
import { SESSION_COOKIE, demoLoginEnabled } from '@/lib/auth';
import { bootstrapFirstUser } from '@/lib/bootstrap';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!demoLoginEnabled()) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Demo login is disabled on this instance. Sign in with Google or GitHub.' } },
      { status: 403 },
    );
  }
  try {
    const body = (await req.json().catch(() => ({}))) as { email?: string };
    const email = body.email ?? process.env.SEED_USER_EMAIL ?? 'demo@flowboard.app';
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Fresh deploy (empty DB): provision the demo user + starter workspace.
      user = await bootstrapFirstUser(email, process.env.SEED_USER_NAME ?? 'Demo User');
    }
    if (!user) {
      throw new ApiError(
        ErrorCodes.NOT_FOUND,
        `No user found for ${email}. Locally, run \`pnpm db:seed\`.`,
      );
    }
    cookies().set(SESSION_COOKIE, user.id, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });
    return ok({ user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE() {
  cookies().delete(SESSION_COOKIE);
  return ok({ ok: true });
}
