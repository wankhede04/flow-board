/**
 * Background jobs (TechSpec §10.5, adapted).
 *
 * `runJobsTick()` is the single entry point, invoked two ways:
 *   1. In-process scheduler: instrumentation.ts arms a 60s interval when
 *      ENABLE_SCHEDULER=true (default in the Docker image). Fine for the
 *      single-replica deploys this build targets.
 *   2. External cron: POST /api/v1/jobs/tick with `Authorization: Bearer
 *      $CRON_SECRET` — use this on serverless/multi-replica platforms and
 *      set ENABLE_SCHEDULER=false there.
 *
 * The tick is idempotent: reminders flip out of `pending` when delivered and
 * due-date nudges dedupe through the due_reminders_sent table, so overlapping
 * or duplicate ticks never double-notify.
 */

import { prisma } from './db';
import { createNotification } from './notifications';
import { deliverDueReminders } from './reminders';
import { postToProjectChannel, sendSlackDm } from './slack';

export interface TickResult {
  remindersDelivered: number;
  dueSoonNotified: number;
  overdueNotified: number;
  staleNotified: number;
}

/** Tickets sitting in an in_progress column longer than this are "stale". */
export const STALE_AFTER_DAYS = 7;

export async function runJobsTick(now = new Date()): Promise<TickResult> {
  const remindersDelivered = await deliverDueReminders(now);
  const dueSoonNotified = await scanDueTickets('due_soon', now);
  const overdueNotified = await scanDueTickets('overdue', now);
  const staleNotified = await scanStaleTickets(now);
  return { remindersDelivered, dueSoonNotified, overdueNotified, staleNotified };
}

/**
 * Notify assignees (fallback: reporter) about tickets due within 24h
 * (`due_soon`) or past due (`overdue`). One notification per ticket per kind.
 */
async function scanDueTickets(kind: 'due_soon' | 'overdue', now: Date): Promise<number> {
  const dueWhere =
    kind === 'due_soon'
      ? { gte: now, lte: new Date(now.getTime() + 24 * 3600_000) }
      : { lt: now };

  const tickets = await prisma.ticket.findMany({
    where: {
      archivedAt: null,
      dueDate: dueWhere,
      statusColumn: { category: { not: 'done' } },
    },
    include: {
      project: { select: { key: true } },
      assignees: { select: { userId: true } },
    },
    take: 200,
  });
  if (tickets.length === 0) return 0;

  const alreadySent = await prisma.dueReminderSent.findMany({
    where: { kind, ticketId: { in: tickets.map((t) => t.id) } },
    select: { ticketId: true },
  });
  const sentIds = new Set(alreadySent.map((r) => r.ticketId));
  const fresh = tickets.filter((t) => !sentIds.has(t.id));

  for (const ticket of fresh) {
    const recipients = ticket.assignees.length
      ? ticket.assignees.map((a) => a.userId)
      : [ticket.reporterId];
    const key = `${ticket.project.key}-${ticket.number}`;
    const title =
      kind === 'due_soon'
        ? `📅 Due soon: [${key}] ${ticket.title}`
        : `🔥 Overdue: [${key}] ${ticket.title}`;
    const linkUrl = `/workspace/${ticket.workspaceId}/projects/${ticket.projectId}?ticket=${ticket.id}`;

    for (const userId of recipients) {
      await createNotification({ userId, type: kind === 'due_soon' ? 'ticket_due_soon' : 'ticket_overdue', title, linkUrl });
      try {
        await sendSlackDm(ticket.workspaceId, userId, { text: title });
      } catch {
        /* best-effort */
      }
    }
    // Also announce in the project's linked channel (request #2).
    try {
      const dueStr = ticket.dueDate ? ticket.dueDate.toISOString().slice(0, 10) : '';
      await postToProjectChannel(
        ticket.workspaceId,
        ticket.projectId,
        kind === 'due_soon'
          ? `📅 *[${key}] ${ticket.title}* is due ${dueStr}.`
          : `🔥 *[${key}] ${ticket.title}* is overdue (was due ${dueStr}).`,
      );
    } catch {
      /* best-effort */
    }
    await prisma.dueReminderSent.create({ data: { ticketId: ticket.id, kind } });
  }
  return fresh.length;
}

/**
 * Notify the linked channel about tickets stuck in an in-progress column
 * for more than STALE_AFTER_DAYS (request #2). One notification per stall:
 * the dedupe row is cleared when the ticket next moves, so a ticket that
 * stalls again notifies again.
 */
async function scanStaleTickets(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_AFTER_DAYS * 24 * 3600_000);
  const tickets = await prisma.ticket.findMany({
    where: {
      archivedAt: null,
      statusChangedAt: { lte: cutoff },
      statusColumn: { category: 'in_progress' },
    },
    include: {
      project: { select: { key: true } },
      statusColumn: { select: { name: true } },
      assignees: { select: { userId: true } },
    },
    take: 200,
  });
  if (tickets.length === 0) return 0;

  const alreadySent = await prisma.dueReminderSent.findMany({
    where: { kind: 'stale_7d', ticketId: { in: tickets.map((t) => t.id) } },
    select: { ticketId: true },
  });
  const sentIds = new Set(alreadySent.map((r) => r.ticketId));
  const fresh = tickets.filter((t) => !sentIds.has(t.id));

  for (const ticket of fresh) {
    const key = `${ticket.project.key}-${ticket.number}`;
    const days = Math.floor((now.getTime() - ticket.statusChangedAt.getTime()) / (24 * 3600_000));
    const title = `🐢 Stale: [${key}] ${ticket.title} has been in "${ticket.statusColumn.name}" for ${days} days`;
    const linkUrl = `/workspace/${ticket.workspaceId}/projects/${ticket.projectId}?ticket=${ticket.id}`;

    const recipients = ticket.assignees.length
      ? ticket.assignees.map((a) => a.userId)
      : [ticket.reporterId];
    for (const userId of recipients) {
      await createNotification({ userId, type: 'ticket_overdue', title, linkUrl });
    }
    try {
      await postToProjectChannel(
        ticket.workspaceId,
        ticket.projectId,
        `🐢 *[${key}] ${ticket.title}* has been sitting in *${ticket.statusColumn.name}* for *${days} days* without moving.`,
      );
    } catch {
      /* best-effort */
    }
    await prisma.dueReminderSent.create({ data: { ticketId: ticket.id, kind: 'stale_7d' } });
  }
  return fresh.length;
}
