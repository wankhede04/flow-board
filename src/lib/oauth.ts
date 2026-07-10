/**
 * Social sign-in via the OAuth 2.0 authorization-code flow — Google (OIDC)
 * and GitHub — implemented directly with fetch, no extra dependencies.
 *
 * Flow:
 *   GET /api/v1/auth/oauth/:provider           → 302 to the provider, with a
 *                                                 random `state` in an httpOnly
 *                                                 cookie (CSRF protection)
 *   GET /api/v1/auth/oauth/:provider/callback  → verify state, exchange the
 *                                                 code server-side, fetch the
 *                                                 profile, find-or-create the
 *                                                 user, set the session cookie
 *
 * Provisioning policy (see findOrCreateOAuthUser):
 *   - email already exists            → sign in as that user
 *   - empty database                  → first-boot bootstrap (admin + workspace)
 *   - otherwise                       → new user gets their OWN starter
 *                                       workspace; they never silently join
 *                                       someone else's
 *   - AUTH_ALLOWED_EMAIL_DOMAINS set  → sign-UP restricted to those domains
 *                                       (existing users always sign in)
 *
 * Config: GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET, GITHUB_CLIENT_ID/
 * GITHUB_CLIENT_SECRET, APP_BASE_URL (redirect URIs are
 * `$APP_BASE_URL/api/v1/auth/oauth/:provider/callback`).
 */

import { randomBytes } from 'crypto';
import { prisma } from './db';
import { newId } from './ids';
import { bootstrapFirstUser, provisionStarterWorkspace } from './bootstrap';

export type OAuthProviderId = 'google' | 'github';
export const OAUTH_PROVIDERS: OAuthProviderId[] = ['google', 'github'];

/** httpOnly cookie carrying the CSRF state between start and callback. */
export const OAUTH_STATE_COOKIE = 'fb_oauth_state';

export interface OAuthProfile {
  email: string;
  name: string;
  avatarUrl: string | null;
}

interface ProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  clientId: () => string | undefined;
  clientSecret: () => string | undefined;
  fetchProfile: (accessToken: string) => Promise<OAuthProfile | null>;
}

const PROVIDERS: Record<OAuthProviderId, ProviderConfig> = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    clientId: () => process.env.GOOGLE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
    fetchProfile: async (accessToken) => {
      const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return null;
      const p = (await res.json()) as {
        email?: string;
        email_verified?: boolean;
        name?: string;
        picture?: string;
      };
      if (!p.email || p.email_verified === false) return null;
      return { email: p.email, name: p.name ?? p.email.split('@')[0], avatarUrl: p.picture ?? null };
    },
  },
  github: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    clientId: () => process.env.GITHUB_CLIENT_ID,
    clientSecret: () => process.env.GITHUB_CLIENT_SECRET,
    fetchProfile: async (accessToken) => {
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'flowboard',
      };
      const [userRes, emailsRes] = await Promise.all([
        fetch('https://api.github.com/user', { headers }),
        fetch('https://api.github.com/user/emails', { headers }),
      ]);
      if (!userRes.ok) return null;
      const u = (await userRes.json()) as {
        login: string;
        name?: string | null;
        email?: string | null;
        avatar_url?: string;
      };
      let email = u.email ?? null;
      if (emailsRes.ok) {
        const emails = (await emailsRes.json()) as Array<{
          email: string;
          primary: boolean;
          verified: boolean;
        }>;
        email =
          emails.find((e) => e.primary && e.verified)?.email ??
          emails.find((e) => e.verified)?.email ??
          email;
      }
      if (!email) return null;
      return { email, name: u.name || u.login, avatarUrl: u.avatar_url ?? null };
    },
  },
};

export function isOAuthProvider(value: string): value is OAuthProviderId {
  return (OAUTH_PROVIDERS as string[]).includes(value);
}

export function isProviderConfigured(provider: OAuthProviderId): boolean {
  const p = PROVIDERS[provider];
  return Boolean(p.clientId() && p.clientSecret());
}

export function configuredProviders(): OAuthProviderId[] {
  return OAUTH_PROVIDERS.filter(isProviderConfigured);
}

function baseUrl(): string {
  return (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

export function redirectUri(provider: OAuthProviderId): string {
  return `${baseUrl()}/api/v1/auth/oauth/${provider}/callback`;
}

export function newStateToken(): string {
  return randomBytes(24).toString('hex');
}

export function buildAuthorizeUrl(provider: OAuthProviderId, state: string): string {
  const p = PROVIDERS[provider];
  const params = new URLSearchParams({
    client_id: p.clientId() ?? '',
    redirect_uri: redirectUri(provider),
    response_type: 'code',
    scope: p.scope,
    state,
  });
  return `${p.authorizeUrl}?${params.toString()}`;
}

/** Exchange the authorization code for an access token (server-side). */
export async function exchangeCode(provider: OAuthProviderId, code: string): Promise<string | null> {
  const p = PROVIDERS[provider];
  try {
    const res = await fetch(p.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: p.clientId() ?? '',
        client_secret: p.clientSecret() ?? '',
        code,
        redirect_uri: redirectUri(provider),
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { access_token?: string };
    return json.access_token ?? null;
  } catch {
    return null;
  }
}

export async function fetchProfile(
  provider: OAuthProviderId,
  accessToken: string,
): Promise<OAuthProfile | null> {
  try {
    return await PROVIDERS[provider].fetchProfile(accessToken);
  } catch {
    return null;
  }
}

export function emailDomainAllowed(email: string): boolean {
  const raw = process.env.AUTH_ALLOWED_EMAIL_DOMAINS?.trim();
  if (!raw) return true;
  const domain = email.split('@')[1]?.toLowerCase();
  return raw
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean)
    .includes(domain ?? '');
}

/**
 * Resolve an OAuth profile to a FlowBoard user, provisioning on first
 * sign-in. Returns null when sign-up is blocked by the domain allowlist.
 */
export async function findOrCreateOAuthUser(profile: OAuthProfile) {
  const existing = await prisma.user.findUnique({ where: { email: profile.email } });
  if (existing) {
    // Refresh avatar opportunistically; never overwrite a chosen name.
    if (profile.avatarUrl && profile.avatarUrl !== existing.avatarUrl) {
      return prisma.user.update({
        where: { id: existing.id },
        data: { avatarUrl: profile.avatarUrl },
      });
    }
    return existing;
  }

  if (!emailDomainAllowed(profile.email)) return null;

  // Empty instance: this user becomes the first admin.
  const first = await bootstrapFirstUser(profile.email, profile.name);
  if (first) {
    if (profile.avatarUrl) {
      return prisma.user.update({ where: { id: first.id }, data: { avatarUrl: profile.avatarUrl } });
    }
    return first;
  }

  // Live instance: new user gets their own starter workspace.
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        id: newId('usr'),
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
      },
    });
    const localPart = profile.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]+/g, '-');
    await provisionStarterWorkspace(tx, user.id, {
      workspaceName: `${profile.name.split(' ')[0]}'s Workspace`,
      slug: `${localPart}-${newId('wsp').slice(-6).toLowerCase()}`,
    });
    return user;
  });
}
