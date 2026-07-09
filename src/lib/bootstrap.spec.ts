/**
 * Integration tests for first-boot bootstrap (empty-DB self-provisioning
 * behind demo login). Hermetic SQLite, same pattern as tickets.spec.ts.
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
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'fb-boot-test-'));
  dbUrl = `file:${path.join(tmpDir, 'test.db')}`;
  process.env.DATABASE_URL = dbUrl;
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
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
});

async function loadBootstrap() {
  process.env.DATABASE_URL = dbUrl;
  return import('./bootstrap');
}

describe('bootstrapFirstUser', () => {
  it('provisions user, workspace, project, columns and labels on an empty DB', async () => {
    const { bootstrapFirstUser } = await loadBootstrap();
    const user = await bootstrapFirstUser('owner@example.com', 'Owner');
    expect(user).not.toBeNull();
    expect(user!.email).toBe('owner@example.com');

    const member = await prisma.workspaceMember.findFirst({
      where: { userId: user!.id },
      include: { workspace: true },
    });
    expect(member?.role).toBe('admin');

    const project = await prisma.project.findFirst({
      where: { workspaceId: member!.workspaceId },
      include: { columns: { orderBy: { position: 'asc' } }, labels: true, members: true },
    });
    expect(project?.key).toBe('TASK');
    expect(project?.columns.map((c) => c.category)).toEqual([
      'todo',
      'in_progress',
      'in_progress',
      'done',
    ]);
    expect(project?.labels.length).toBeGreaterThan(0);
    expect(project?.members[0]?.userId).toBe(user!.id);
  });

  it('does nothing once any user exists — no self-provisioning on live instances', async () => {
    const { bootstrapFirstUser } = await loadBootstrap();
    await prisma.user.create({
      data: { id: `usr_${ulid()}`, email: 'existing@example.com', name: 'Existing' },
    });
    const result = await bootstrapFirstUser('intruder@example.com', 'Intruder');
    expect(result).toBeNull();
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.workspace.count()).toBe(0);
  });
});
