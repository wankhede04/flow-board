/**
 * Minimal session helper. Per TechSpec Phase 2, full auth (NextAuth + JWT)
 * is deferred. For local development we resolve a single seeded user via
 * the `fb_user_id` cookie set by the demo login flow.
 *
 * Anywhere a route would call `@RequireProjectAccess('member')` per §4.5,
 * we instead call requireUser() + a permission check on the Project /
 * Workspace membership tables (see lib/permissions.ts).
 */

import { cookies } from 'next/headers';
import { prisma } from './db';
import { ApiError, ErrorCodes } from './errors';

export const SESSION_COOKIE = 'fb_user_id';

/**
 * Demo login is a local-dev convenience, off by default. Production
 * sign-in is Google/GitHub OAuth (src/lib/oauth.ts).
 */
export function demoLoginEnabled(): boolean {
  return process.env.ALLOW_DEMO_LOGIN === 'true';
}

export async function getCurrentUser() {
  const c = cookies().get(SESSION_COOKIE);
  if (!c?.value) return null;
  return prisma.user.findUnique({ where: { id: c.value } });
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) {
    throw new ApiError(ErrorCodes.UNAUTHORIZED, 'Not authenticated');
  }
  return user;
}
