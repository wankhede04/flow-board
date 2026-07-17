/**
 * Integration tests for first-boot bootstrap (empty-DB self-provisioning
 * behind demo login). Throwaway Postgres database — see ./test-db.ts.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';
import { createTestDb, type TestDb } from './test-db';

let testDb: TestDb;
let prisma: PrismaClient;
let dbUrl: string;

beforeAll(async () => {
  testDb = await createTestDb('bootstrap');
  prisma = testDb.prisma;
  dbUrl = testDb.dbUrl;
  process.env.DATABASE_URL = dbUrl;
});

afterAll(async () => {
  await testDb.teardown();
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
