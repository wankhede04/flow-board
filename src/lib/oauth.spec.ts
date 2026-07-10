/**
 * Tests for social sign-in: authorize-URL construction, the email-domain
 * allowlist, and find-or-create provisioning against a hermetic SQLite DB.
 * Network-touching pieces (code exchange, profile fetch) are exercised via
 * the live server check in the PR verification, not mocked here.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';

let prisma: PrismaClient;
let tmpDir: string;
let dbUrl: string;

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'fb-oauth-test-'));
  dbUrl = `file:${path.join(tmpDir, 'test.db')}`;
  process.env.DATABASE_URL = dbUrl;
  process.env.APP_BASE_URL = 'https://flow.example.com';
  process.env.GOOGLE_CLIENT_ID = 'google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
  process.env.GITHUB_CLIENT_ID = 'github-client-id';
  process.env.GITHUB_CLIENT_SECRET = 'github-secret';
  execSync('npx prisma db push --skip-generate', {
    env: { ...process.env, DATABASE_URL: dbUrl },
    cwd: process.cwd(),
    stdio: 'pipe',
  });
  prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  delete process.env.AUTH_ALLOWED_EMAIL_DOMAINS;
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
});

async function loadOAuth() {
  process.env.DATABASE_URL = dbUrl;
  return import('./oauth');
}

describe('provider configuration & authorize URL', () => {
  it('reports configured providers from env', async () => {
    const { configuredProviders } = await loadOAuth();
    expect(configuredProviders()).toEqual(['google', 'github']);
  });

  it('builds a Google authorize URL with redirect, scope and state', async () => {
    const { buildAuthorizeUrl } = await loadOAuth();
    const url = new URL(buildAuthorizeUrl('google', 'state-123'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('google-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://flow.example.com/api/v1/auth/oauth/google/callback',
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toContain('email');
    expect(url.searchParams.get('state')).toBe('state-123');
  });

  it('builds a GitHub authorize URL with the user:email scope', async () => {
    const { buildAuthorizeUrl } = await loadOAuth();
    const url = new URL(buildAuthorizeUrl('github', 's'));
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('scope')).toContain('user:email');
  });
});

describe('emailDomainAllowed', () => {
  it('allows everyone when unset, filters when set (with or without @)', async () => {
    const { emailDomainAllowed } = await loadOAuth();
    expect(emailDomainAllowed('a@anywhere.io')).toBe(true);

    process.env.AUTH_ALLOWED_EMAIL_DOMAINS = 'syvora.com, @example.org';
    expect(emailDomainAllowed('vijay@syvora.com')).toBe(true);
    expect(emailDomainAllowed('x@EXAMPLE.ORG')).toBe(true);
    expect(emailDomainAllowed('mallory@gmail.com')).toBe(false);
  });
});

describe('findOrCreateOAuthUser', () => {
  const profile = { email: 'new@syvora.com', name: 'New Person', avatarUrl: 'https://img/x.png' };

  it('bootstraps the first user as admin on an empty instance', async () => {
    const { findOrCreateOAuthUser } = await loadOAuth();
    const user = await findOrCreateOAuthUser(profile);
    expect(user).not.toBeNull();
    expect(user!.avatarUrl).toBe(profile.avatarUrl);
    const member = await prisma.workspaceMember.findFirst({ where: { userId: user!.id } });
    expect(member?.role).toBe('admin');
  });

  it('signs an existing user in by email and refreshes the avatar', async () => {
    const { findOrCreateOAuthUser } = await loadOAuth();
    const existing = await prisma.user.create({
      data: { id: `usr_${ulid()}`, email: profile.email, name: 'Old Name', avatarUrl: null },
    });
    const user = await findOrCreateOAuthUser(profile);
    expect(user!.id).toBe(existing.id);
    expect(user!.name).toBe('Old Name'); // never overwrites the chosen name
    expect(user!.avatarUrl).toBe(profile.avatarUrl);
    expect(await prisma.user.count()).toBe(1);
  });

  it('gives a brand-new user on a live instance their own workspace', async () => {
    const { findOrCreateOAuthUser } = await loadOAuth();
    await prisma.user.create({
      data: { id: `usr_${ulid()}`, email: 'existing@syvora.com', name: 'Existing' },
    });
    const user = await findOrCreateOAuthUser(profile);
    expect(user).not.toBeNull();
    const memberships = await prisma.workspaceMember.findMany({ where: { userId: user!.id } });
    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe('admin');
    // …and did not join the pre-existing user's (nonexistent) workspace.
    const workspace = await prisma.workspace.findUnique({
      where: { id: memberships[0].workspaceId },
    });
    expect(workspace?.name).toBe("New's Workspace");
  });

  it('blocks sign-up (not sign-in) for disallowed domains', async () => {
    const { findOrCreateOAuthUser } = await loadOAuth();
    await prisma.user.create({
      data: { id: `usr_${ulid()}`, email: 'kept@gmail.com', name: 'Kept' },
    });
    process.env.AUTH_ALLOWED_EMAIL_DOMAINS = 'syvora.com';

    // New user from a blocked domain → rejected.
    const blocked = await findOrCreateOAuthUser({
      email: 'stranger@gmail.com',
      name: 'Stranger',
      avatarUrl: null,
    });
    expect(blocked).toBeNull();

    // Existing user from a blocked domain still signs in.
    const kept = await findOrCreateOAuthUser({
      email: 'kept@gmail.com',
      name: 'Kept',
      avatarUrl: null,
    });
    expect(kept).not.toBeNull();
  });
});
