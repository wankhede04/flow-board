/**
 * Demo login endpoint. TechSpec §14.2 specifies email magic-link as Phase 2
 * auth; full magic-link delivery is deferred. For local development, this
 * endpoint signs the user into the seeded demo account by setting the
 * fb_user_id session cookie.
 */

import { cookies } from 'next/headers';
import { ok, fail } from '@/lib/api';
import { prisma } from '@/lib/db';
import { ApiError, ErrorCodes } from '@/lib/errors';
import { SESSION_COOKIE } from '@/lib/auth';
import { bootstrapFirstUser } from '@/lib/bootstrap';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
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
