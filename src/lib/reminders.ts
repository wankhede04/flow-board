/**
 * Reminder service — set-time reminders to organise and plan work.
 *
 * A reminder fires when `remindAt` (UTC) passes. Delivery is performed by
 * the scheduler (src/lib/jobs.ts) which calls `deliverDueReminders()`:
 * an in-app Notification row is always created; a Slack DM is sent when
 * the workspace has Slack connected and the user is mapped to a Slack ID.
 *
 * Reminders are fully plannable and manually adjustable:
 *   - PATCH remindAt to any future time (reschedule)
 *   - snooze(+minutes) pushes the fire time forward, even after firing
 *   - recurrence none|daily|weekly|monthly re-arms the reminder after firing
 */

import { prisma } from './db';
import { newId } from './ids';
import { ApiError, ErrorCodes } from './errors';
import { createNotification } from './notifications';
import { sendSlackDm } from './slack';

export type ReminderRecurrence = 'none' | 'daily' | 'weekly' | 'monthly';
export const RECURRENCES: ReminderRecurrence[] = ['none', 'daily', 'weekly', 'monthly'];

export type ReminderStatus = 'pending' | 'sent' | 'done' | 'cancelled';

const reminderInclude = {
  ticket: {
    select: {
      id: true,
      title: true,
      number: true,
      projectId: true,
      project: { select: { key: true } },
    },
  },
} as const;

export async function createReminder(input: {
  workspaceId: string;
  userId: string;
  title: string;
  remindAt: Date;
  notes?: string | null;
  ticketId?: string | null;
  recurrence?: ReminderRecurrence;
}) {
  if (input.ticketId) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: input.ticketId },
      select: { workspaceId: true },
    });
    if (!ticket || ticket.workspaceId !== input.workspaceId) {
      throw new ApiError(ErrorCodes.TICKET_NOT_FOUND, 'Ticket not found in this workspace');
    }
  }
  return prisma.reminder.create({
    data: {
      id: newId('rem'),
      workspaceId: input.workspaceId,
      userId: input.userId,
      title: input.title,
      notes: input.notes ?? null,
      ticketId: input.ticketId ?? null,
      remindAt: input.remindAt,
      recurrence: input.recurrence ?? 'none',
    },
    include: reminderInclude,
  });
}

export async function listReminders(input: {
  workspaceId: string;
  userId: string;
  status?: ReminderStatus | 'open'; // open = pending|sent
  from?: Date;
  to?: Date;
  limit?: number;
}) {
  const statusWhere =
    input.status === 'open'
      ? { status: { in: ['pending', 'sent'] } }
      : input.status
        ? { status: input.status }
        : {};
  return prisma.reminder.findMany({
    where: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      ...statusWhere,
      ...(input.from || input.to
        ? { remindAt: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } }
        : {}),
    },
    orderBy: { remindAt: 'asc' },
    take: input.limit ?? 100,
    include: reminderInclude,
  });
}

async function requireOwnReminder(reminderId: string, userId: string) {
  const reminder = await prisma.reminder.findUnique({ where: { id: reminderId } });
  if (!reminder || reminder.userId !== userId) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 'Reminder not found');
  }
  return reminder;
}

export async function updateReminder(input: {
  reminderId: string;
  userId: string;
  patch: {
    title?: string;
    notes?: string | null;
    remindAt?: Date; // manual reschedule — re-arms a sent reminder
    recurrence?: ReminderRecurrence;
    status?: 'pending' | 'done' | 'cancelled';
  };
}) {
  await requireOwnReminder(input.reminderId, input.userId);
  const data: Record<string, unknown> = {};
  if (input.patch.title !== undefined) data.title = input.patch.title;
  if (input.patch.notes !== undefined) data.notes = input.patch.notes;
  if (input.patch.recurrence !== undefined) data.recurrence = input.patch.recurrence;
  if (input.patch.status !== undefined) data.status = input.patch.status;
  if (input.patch.remindAt !== undefined) {
    data.remindAt = input.patch.remindAt;
    // Rescheduling re-arms the reminder unless explicitly closed in the same patch.
    if (input.patch.status === undefined) data.status = 'pending';
  }
  return prisma.reminder.update({
    where: { id: input.reminderId },
    data,
    include: reminderInclude,
  });
}

/** Push the fire time forward by `minutes` from now (or from remindAt if later). */
export async function snoozeReminder(reminderId: string, userId: string, minutes: number) {
  const reminder = await requireOwnReminder(reminderId, userId);
  const base = Math.max(Date.now(), reminder.remindAt.getTime());
  return prisma.reminder.update({
    where: { id: reminderId },
    data: { remindAt: new Date(base + minutes * 60_000), status: 'pending' },
    include: reminderInclude,
  });
}

export async function deleteReminder(reminderId: string, userId: string) {
  await requireOwnReminder(reminderId, userId);
  await prisma.reminder.delete({ where: { id: reminderId } });
}

function nextOccurrence(after: Date, recurrence: ReminderRecurrence): Date | null {
  const next = new Date(after);
  switch (recurrence) {
    case 'daily':
      next.setUTCDate(next.getUTCDate() + 1);
      return next;
    case 'weekly':
      next.setUTCDate(next.getUTCDate() + 7);
      return next;
    case 'monthly':
      next.setUTCMonth(next.getUTCMonth() + 1);
      return next;
    default:
      return null;
  }
}

/**
 * Fire every pending reminder whose time has come. Called by the scheduler
 * every minute (and by POST /api/v1/jobs/tick for external cron).
 * Returns the number of reminders delivered.
 */
export async function deliverDueReminders(now = new Date()): Promise<number> {
  const due = await prisma.reminder.findMany({
    where: { status: 'pending', remindAt: { lte: now } },
    include: reminderInclude,
    take: 200,
  });

  for (const reminder of due) {
    const ticketRef = reminder.ticket
      ? ` [${reminder.ticket.project.key}-${reminder.ticket.number}]`
      : '';
    const linkUrl = reminder.ticket
      ? `/workspace/${reminder.workspaceId}/projects/${reminder.ticket.projectId}?ticket=${reminder.ticket.id}`
      : `/workspace/${reminder.workspaceId}/planner`;

    await createNotification({
      userId: reminder.userId,
      type: 'reminder_due',
      title: `⏰ Reminder: ${reminder.title}${ticketRef}`,
      body: reminder.notes,
      linkUrl,
    });

    // Best-effort Slack DM — never blocks in-app delivery.
    try {
      const text = `⏰ *Reminder:* ${reminder.title}${ticketRef}${reminder.notes ? `\n${reminder.notes}` : ''}`;
      await sendSlackDm(reminder.workspaceId, reminder.userId, {
        text,
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text } },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Snooze 15m' },
                action_id: 'reminder_snooze',
                value: JSON.stringify({ id: reminder.id, minutes: 15 }),
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Snooze 1h' },
                action_id: 'reminder_snooze',
                value: JSON.stringify({ id: reminder.id, minutes: 60 }),
              },
              {
                type: 'button',
                style: 'primary',
                text: { type: 'plain_text', text: 'Done' },
                action_id: 'reminder_done',
                value: JSON.stringify({ id: reminder.id }),
              },
            ],
          },
        ],
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[reminders] slack dm failed', reminder.id, err);
    }

    const next = nextOccurrence(reminder.remindAt, reminder.recurrence as ReminderRecurrence);
    await prisma.reminder.update({
      where: { id: reminder.id },
      data: next
        ? { sentAt: now, remindAt: next } // recurring: re-arm for next period
        : { sentAt: now, status: 'sent' },
    });
  }

  return due.length;
}
