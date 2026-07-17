/**
 * Integration tests for ticket service. Exercises the TechSpec §18.2
 * required scenarios: happy path, WIP limit (409), version conflict (409),
 * permission paths covered separately in permissions.spec.
 *
 * Runs against a throwaway Postgres database created per spec file — see
 * ./test-db.ts.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';
import { generateNKeysBetween } from 'fractional-indexing';
import { createTestDb, type TestDb } from './test-db';

let testDb: TestDb;
let prisma: PrismaClient;
let dbUrl: string;

const id = (prefix: string) => `${prefix}_${ulid()}`;

beforeAll(async () => {
  testDb = await createTestDb('tickets');
  prisma = testDb.prisma;
  dbUrl = testDb.dbUrl;
  process.env.DATABASE_URL = dbUrl;
});

afterAll(async () => {
  await testDb.teardown();
});

interface Fixture {
  workspaceId: string;
  projectId: string;
  userId: string;
  columns: Array<{ id: string; name: string; wipLimit: number | null }>;
}

async function buildFixture(overrides?: { wipLimits?: Array<number | null> }): Promise<Fixture> {
  const wsId = id('wsp');
  const userId = id('usr');
  const projectId = id('prj');
  await prisma.workspace.create({
    data: { id: wsId, name: 'Test', slug: `t-${ulid()}` },
  });
  await prisma.user.create({
    data: { id: userId, email: `u-${ulid()}@x.test`, name: 'Tester' },
  });
  await prisma.workspaceMember.create({
    data: { workspaceId: wsId, userId, role: 'admin' },
  });
  await prisma.project.create({
    data: { id: projectId, workspaceId: wsId, key: 'TS', name: 'Test Project' },
  });
  await prisma.projectMember.create({
    data: { projectId, userId, role: 'admin' },
  });

  const wipLimits = overrides?.wipLimits ?? [null, 2, null];
  const cols = await Promise.all(
    ['Todo', 'In Progress', 'Done'].map((name, i) =>
      prisma.workflowColumn.create({
        data: {
          id: id('col'),
          projectId,
          name,
          category: i === 0 ? 'todo' : i === 1 ? 'in_progress' : 'done',
          position: i,
          wipLimit: wipLimits[i],
        },
      }),
    ),
  );

  return { workspaceId: wsId, projectId, userId, columns: cols };
}

beforeEach(async () => {
  // Cascade-deletes via workspace
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
});

async function loadServices() {
  // Force tickets module to use our test prisma instance.
  process.env.DATABASE_URL = dbUrl;
  // Re-import to pick up env. Tests share Prisma instance via lib/db.
  return import('./tickets');
}

describe('createTicket', () => {
  it('creates a ticket, increments project ticket_seq, ranks at end of column', async () => {
    const fx = await buildFixture();
    const { createTicket } = await loadServices();
    const t1 = await createTicket({
      workspaceId: fx.workspaceId,
      projectId: fx.projectId,
      reporterId: fx.userId,
      title: 'First',
      statusColumnId: fx.columns[0].id,
    });
    const t2 = await createTicket({
      workspaceId: fx.workspaceId,
      projectId: fx.projectId,
      reporterId: fx.userId,
      title: 'Second',
      statusColumnId: fx.columns[0].id,
    });
    expect(t1.number).toBe(1);
    expect(t2.number).toBe(2);
    expect(t2.rank > t1.rank).toBe(true);
  });
});

describe('transitionTicket', () => {
  it('moves a ticket to another column and bumps version', async () => {
    const fx = await buildFixture();
    const { createTicket, transitionTicket } = await loadServices();
    const t = await createTicket({
      workspaceId: fx.workspaceId,
      projectId: fx.projectId,
      reporterId: fx.userId,
      title: 'Move me',
      statusColumnId: fx.columns[0].id,
    });
    const moved = await transitionTicket({
      ticketId: t.id,
      actorId: fx.userId,
      targetColumnId: fx.columns[1].id,
    });
    expect(moved.statusColumnId).toBe(fx.columns[1].id);
    expect(moved.version).toBe(t.version + 1);
  });

  it('rejects move with WIP_LIMIT_EXCEEDED when target is at limit', async () => {
    const fx = await buildFixture({ wipLimits: [null, 1, null] });
    const { createTicket, transitionTicket } = await loadServices();
    // Fill the In Progress column to its limit of 1.
    const occupant = await createTicket({
      workspaceId: fx.workspaceId,
      projectId: fx.projectId,
      reporterId: fx.userId,
      title: 'occupant',
      statusColumnId: fx.columns[1].id,
    });
    void occupant;
    const candidate = await createTicket({
      workspaceId: fx.workspaceId,
      projectId: fx.projectId,
      reporterId: fx.userId,
      title: 'candidate',
      statusColumnId: fx.columns[0].id,
    });
    await expect(
      transitionTicket({
        ticketId: candidate.id,
        actorId: fx.userId,
        targetColumnId: fx.columns[1].id,
        actorRoleForBypass: 'member',
      }),
    ).rejects.toMatchObject({ code: 'WIP_LIMIT_EXCEEDED', status: 409 });
  });

  it('admin can bypass WIP limit', async () => {
    const fx = await buildFixture({ wipLimits: [null, 1, null] });
    const { createTicket, transitionTicket } = await loadServices();
    await createTicket({
      workspaceId: fx.workspaceId,
      projectId: fx.projectId,
      reporterId: fx.userId,
      title: 'occupant',
      statusColumnId: fx.columns[1].id,
    });
    const candidate = await createTicket({
      workspaceId: fx.workspaceId,
      projectId: fx.projectId,
      reporterId: fx.userId,
      title: 'candidate',
      statusColumnId: fx.columns[0].id,
    });
    const moved = await transitionTicket({
      ticketId: candidate.id,
      actorId: fx.userId,
      targetColumnId: fx.columns[1].id,
      actorRoleForBypass: 'admin',
    });
    expect(moved.statusColumnId).toBe(fx.columns[1].id);
  });

  it('returns VERSION_CONFLICT when If-Match version is stale', async () => {
    const fx = await buildFixture();
    const { createTicket, transitionTicket } = await loadServices();
    const t = await createTicket({
      workspaceId: fx.workspaceId,
      projectId: fx.projectId,
      reporterId: fx.userId,
      title: 'concurrency',
      statusColumnId: fx.columns[0].id,
    });
    // First move bumps to v2.
    await transitionTicket({
      ticketId: t.id,
      actorId: fx.userId,
      targetColumnId: fx.columns[1].id,
    });
    // Stale client retries with the original version.
    await expect(
      transitionTicket({
        ticketId: t.id,
        actorId: fx.userId,
        targetColumnId: fx.columns[2].id,
        expectedVersion: t.version,
      }),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
  });

  it('records a status_changed activity event when columns differ', async () => {
    const fx = await buildFixture();
    const { createTicket, transitionTicket } = await loadServices();
    const t = await createTicket({
      workspaceId: fx.workspaceId,
      projectId: fx.projectId,
      reporterId: fx.userId,
      title: 'audit me',
      statusColumnId: fx.columns[0].id,
    });
    await transitionTicket({
      ticketId: t.id,
      actorId: fx.userId,
      targetColumnId: fx.columns[1].id,
    });
    const events = await prisma.activityEvent.findMany({
      where: { ticketId: t.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.eventType)).toEqual(['ticket_created', 'status_changed']);
  });
});

describe('rebalance via fractional-indexing', () => {
  it('produces sorted ranks for a fresh column', () => {
    const ranks = generateNKeysBetween(null, null, 5);
    expect(ranks).toEqual([...ranks].sort());
  });
});
