/**
 * Integration tests for the goals, reminders and background-jobs services,
 * against a hermetic SQLite DB (same pattern as tickets.spec.ts).
 *
 * Covers: goal CRUD + linked-ticket progress, reminder lifecycle
 * (deliver → sent, recurrence re-arm, snooze, manual reschedule) and the
 * due-date scan's dedupe behaviour.
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

const id = (prefix: string) => `${prefix}_${ulid()}`;

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'fb-grj-test-'));
  dbUrl = `file:${path.join(tmpDir, 'test.db')}`;
  process.env.DATABASE_URL = dbUrl;
  delete process.env.SLACK_BOT_TOKEN; // keep Slack outbound a guaranteed no-op
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
  await prisma.notification.deleteMany();
  await prisma.dueReminderSent.deleteMany();
});

interface Fixture {
  workspaceId: string;
  projectId: string;
  userId: string;
  todoColumnId: string;
  doneColumnId: string;
}

async function buildFixture(): Promise<Fixture> {
  const wsId = id('wsp');
  const userId = id('usr');
  const projectId = id('prj');
  await prisma.workspace.create({ data: { id: wsId, name: 'Test', slug: `t-${ulid()}` } });
  await prisma.user.create({ data: { id: userId, email: `u-${ulid()}@x.test`, name: 'Tester' } });
  await prisma.workspaceMember.create({ data: { workspaceId: wsId, userId, role: 'admin' } });
  await prisma.project.create({ data: { id: projectId, workspaceId: wsId, key: 'TS', name: 'Test Project' } });
  await prisma.projectMember.create({ data: { projectId, userId, role: 'admin' } });
  const [todo, done] = await Promise.all(
    [
      { name: 'Todo', category: 'todo', position: 0 },
      { name: 'Done', category: 'done', position: 1 },
    ].map((c) =>
      prisma.workflowColumn.create({
        data: { id: id('col'), projectId, name: c.name, category: c.category, position: c.position },
      }),
    ),
  );
  return { workspaceId: wsId, projectId, userId, todoColumnId: todo.id, doneColumnId: done.id };
}

async function loadServices() {
  process.env.DATABASE_URL = dbUrl;
  const [goals, reminders, jobs, tickets] = await Promise.all([
    import('./goals'),
    import('./reminders'),
    import('./jobs'),
    import('./tickets'),
  ]);
  return { ...goals, ...reminders, ...jobs, ...tickets };
}

describe('goals', () => {
  it('creates a goal defaulting to the current period and increments position', async () => {
    const fx = await buildFixture();
    const { createGoal } = await loadServices();
    const g1 = await createGoal({
      workspaceId: fx.workspaceId,
      ownerId: fx.userId,
      title: 'First',
      cadence: 'weekly',
    });
    const g2 = await createGoal({
      workspaceId: fx.workspaceId,
      ownerId: fx.userId,
      title: 'Second',
      cadence: 'weekly',
    });
    expect(g1.periodKey).toMatch(/^\d{4}-W\d{2}$/);
    expect(g2.position).toBe(g1.position + 1);
  });

  it('rejects a period key that does not match the cadence', async () => {
    const fx = await buildFixture();
    const { createGoal } = await loadServices();
    await expect(
      createGoal({
        workspaceId: fx.workspaceId,
        ownerId: fx.userId,
        title: 'Broken',
        cadence: 'daily',
        periodKey: '2026-W28',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('derives progress from linked tickets in done-category columns', async () => {
    const fx = await buildFixture();
    const { createGoal, createTicket, linkTicket, transitionTicket } = await loadServices();
    const goal = await createGoal({
      workspaceId: fx.workspaceId,
      ownerId: fx.userId,
      title: 'Ship it',
      cadence: 'monthly',
    });
    const t1 = await createTicket({
      workspaceId: fx.workspaceId,
      projectId: fx.projectId,
      reporterId: fx.userId,
      title: 'A',
      statusColumnId: fx.todoColumnId,
    });
    const t2 = await createTicket({
      workspaceId: fx.workspaceId,
      projectId: fx.projectId,
      reporterId: fx.userId,
      title: 'B',
      statusColumnId: fx.todoColumnId,
    });
    await linkTicket(goal.id, fx.userId, t1.id);
    let updated = await linkTicket(goal.id, fx.userId, t2.id);
    expect(updated.progress).toEqual({ linked: 2, done: 0 });

    await transitionTicket({
      ticketId: t1.id,
      actorId: fx.userId,
      targetColumnId: fx.doneColumnId,
    });
    updated = await linkTicket(goal.id, fx.userId, t2.id); // idempotent re-link re-reads
    expect(updated.progress).toEqual({ linked: 2, done: 1 });
  });

  it('sets completedAt when completing, clears it when reopening', async () => {
    const fx = await buildFixture();
    const { createGoal, updateGoal } = await loadServices();
    const goal = await createGoal({
      workspaceId: fx.workspaceId,
      ownerId: fx.userId,
      title: 'Done soon',
      cadence: 'daily',
    });
    const completed = await updateGoal({
      goalId: goal.id,
      ownerId: fx.userId,
      patch: { status: 'completed' },
    });
    expect(completed.status).toBe('completed');
    expect(completed.completedAt).not.toBeNull();
    const reopened = await updateGoal({
      goalId: goal.id,
      ownerId: fx.userId,
      patch: { status: 'active' },
    });
    expect(reopened.completedAt).toBeNull();
  });

  it("refuses to touch another user's goal", async () => {
    const fx = await buildFixture();
    const { createGoal, updateGoal } = await loadServices();
    const goal = await createGoal({
      workspaceId: fx.workspaceId,
      ownerId: fx.userId,
      title: 'Mine',
      cadence: 'daily',
    });
    await expect(
      updateGoal({ goalId: goal.id, ownerId: 'usr_someoneelse', patch: { title: 'Stolen' } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('reminders', () => {
  it('delivers a due reminder: creates a notification and marks it sent', async () => {
    const fx = await buildFixture();
    const { createReminder, deliverDueReminders } = await loadServices();
    const due = await createReminder({
      workspaceId: fx.workspaceId,
      userId: fx.userId,
      title: 'Standup prep',
      remindAt: new Date(Date.now() - 60_000),
    });
    const future = await createReminder({
      workspaceId: fx.workspaceId,
      userId: fx.userId,
      title: 'Later',
      remindAt: new Date(Date.now() + 3600_000),
    });

    const delivered = await deliverDueReminders();
    expect(delivered).toBe(1);

    const dueAfter = await prisma.reminder.findUnique({ where: { id: due.id } });
    expect(dueAfter?.status).toBe('sent');
    expect(dueAfter?.sentAt).not.toBeNull();
    const futureAfter = await prisma.reminder.findUnique({ where: { id: future.id } });
    expect(futureAfter?.status).toBe('pending');

    const notifications = await prisma.notification.findMany({ where: { userId: fx.userId } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe('reminder_due');
    expect(notifications[0].title).toContain('Standup prep');

    // Second tick is a no-op — the reminder is no longer pending.
    expect(await deliverDueReminders()).toBe(0);
  });

  it('re-arms recurring reminders instead of closing them', async () => {
    const fx = await buildFixture();
    const { createReminder, deliverDueReminders } = await loadServices();
    const firedAt = new Date(Date.now() - 60_000);
    const rec = await createReminder({
      workspaceId: fx.workspaceId,
      userId: fx.userId,
      title: 'Daily review',
      remindAt: firedAt,
      recurrence: 'daily',
    });
    await deliverDueReminders();
    const after = await prisma.reminder.findUnique({ where: { id: rec.id } });
    expect(after?.status).toBe('pending'); // still armed
    expect(after?.remindAt.getTime()).toBe(firedAt.getTime() + 24 * 3600_000);
  });

  it('snoozes forward from now and re-arms a sent reminder', async () => {
    const fx = await buildFixture();
    const { createReminder, deliverDueReminders, snoozeReminder } = await loadServices();
    const r = await createReminder({
      workspaceId: fx.workspaceId,
      userId: fx.userId,
      title: 'Snooze me',
      remindAt: new Date(Date.now() - 60_000),
    });
    await deliverDueReminders();
    const before = Date.now();
    const snoozed = await snoozeReminder(r.id, fx.userId, 15);
    expect(snoozed.status).toBe('pending');
    expect(snoozed.remindAt.getTime()).toBeGreaterThanOrEqual(before + 15 * 60_000 - 1000);
  });

  it('manual reschedule via updateReminder re-arms and moves the fire time', async () => {
    const fx = await buildFixture();
    const { createReminder, deliverDueReminders, updateReminder } = await loadServices();
    const r = await createReminder({
      workspaceId: fx.workspaceId,
      userId: fx.userId,
      title: 'Adjust me',
      remindAt: new Date(Date.now() - 60_000),
    });
    await deliverDueReminders();
    const newTime = new Date(Date.now() + 7200_000);
    const updated = await updateReminder({
      reminderId: r.id,
      userId: fx.userId,
      patch: { remindAt: newTime },
    });
    expect(updated.status).toBe('pending');
    expect(updated.remindAt.getTime()).toBe(newTime.getTime());
  });

  it('rejects linking a reminder to a ticket outside the workspace', async () => {
    const fx = await buildFixture();
    const { createReminder } = await loadServices();
    await expect(
      createReminder({
        workspaceId: fx.workspaceId,
        userId: fx.userId,
        title: 'Bad link',
        remindAt: new Date(),
        ticketId: 'tkt_doesnotexist',
      }),
    ).rejects.toMatchObject({ code: 'TICKET_NOT_FOUND' });
  });
});

describe('jobs tick — due-date scan', () => {
  it('notifies once per ticket per kind (due_soon / overdue), deduped across ticks', async () => {
    const fx = await buildFixture();
    const { createTicket, runJobsTick } = await loadServices();

    await createTicket({
      workspaceId: fx.workspaceId,
      projectId: fx.projectId,
      reporterId: fx.userId,
      title: 'Due in 12h',
      statusColumnId: fx.todoColumnId,
      dueDate: new Date(Date.now() + 12 * 3600_000),
    });
    await createTicket({
      workspaceId: fx.workspaceId,
      projectId: fx.projectId,
      reporterId: fx.userId,
      title: 'Already late',
      statusColumnId: fx.todoColumnId,
      dueDate: new Date(Date.now() - 3600_000),
    });
    // Done tickets are never nudged, even when overdue.
    await createTicket({
      workspaceId: fx.workspaceId,
      projectId: fx.projectId,
      reporterId: fx.userId,
      title: 'Late but done',
      statusColumnId: fx.doneColumnId,
      dueDate: new Date(Date.now() - 3600_000),
    });

    const first = await runJobsTick();
    expect(first.dueSoonNotified).toBe(1);
    expect(first.overdueNotified).toBe(1);

    const second = await runJobsTick();
    expect(second.dueSoonNotified).toBe(0);
    expect(second.overdueNotified).toBe(0);

    const notifications = await prisma.notification.findMany({ where: { userId: fx.userId } });
    const types = notifications.map((n) => n.type).sort();
    expect(types).toEqual(['ticket_due_soon', 'ticket_overdue']);
  });

  it('flags tickets stuck in progress for 7+ days once, re-arming on move', async () => {
    const fx = await buildFixture();
    const { createTicket, transitionTicket, runJobsTick } = await loadServices();

    // Need an in_progress column: repurpose the fixture by adding one.
    const inProgress = await prisma.workflowColumn.create({
      data: {
        id: `col_${ulid()}`,
        projectId: fx.projectId,
        name: 'In Progress',
        category: 'in_progress',
        position: 2,
      },
    });
    const ticket = await createTicket({
      workspaceId: fx.workspaceId,
      projectId: fx.projectId,
      reporterId: fx.userId,
      title: 'Stuck work',
      statusColumnId: inProgress.id,
    });
    // Backdate the last status change by 8 days.
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { statusChangedAt: new Date(Date.now() - 8 * 24 * 3600_000) },
    });

    const first = await runJobsTick();
    expect(first.staleNotified).toBe(1);
    // Never re-notifies while it stays put.
    expect((await runJobsTick()).staleNotified).toBe(0);

    const stale = await prisma.notification.findFirst({
      where: { userId: fx.userId, title: { contains: 'Stale' } },
    });
    expect(stale).not.toBeNull();

    // Moving the ticket clears the dedupe row and resets the clock…
    await transitionTicket({
      ticketId: ticket.id,
      actorId: fx.userId,
      targetColumnId: fx.todoColumnId,
    });
    expect(
      await prisma.dueReminderSent.findUnique({
        where: { ticketId_kind: { ticketId: ticket.id, kind: 'stale_7d' } },
      }),
    ).toBeNull();
    const moved = await prisma.ticket.findUnique({ where: { id: ticket.id } });
    expect(moved!.statusChangedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);

    // …and a fresh 8-day stall in an in-progress column notifies again.
    await transitionTicket({ ticketId: ticket.id, actorId: fx.userId, targetColumnId: inProgress.id });
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { statusChangedAt: new Date(Date.now() - 8 * 24 * 3600_000) },
    });
    expect((await runJobsTick()).staleNotified).toBe(1);
  });
});
