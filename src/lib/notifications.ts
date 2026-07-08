/**
 * In-app notifications. Rows land in the `notifications` table and surface
 * in the web client's bell menu (polled by TanStack Query). Slack delivery
 * for the same events is handled by src/lib/slack.ts callers.
 */

import { prisma } from './db';
import { newId } from './ids';

export type NotificationType =
  | 'reminder_due'
  | 'ticket_due_soon'
  | 'ticket_overdue'
  | 'assigned'
  | 'slack';

export async function createNotification(input: {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  linkUrl?: string | null;
}) {
  return prisma.notification.create({
    data: {
      id: newId('ntf'),
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      linkUrl: input.linkUrl ?? null,
    },
  });
}

export async function listNotifications(userId: string, opts?: { unreadOnly?: boolean; limit?: number }) {
  return prisma.notification.findMany({
    where: { userId, ...(opts?.unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: 'desc' },
    take: opts?.limit ?? 30,
  });
}

export async function unreadCount(userId: string) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function markRead(userId: string, notificationId: string | 'all') {
  if (notificationId === 'all') {
    await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return;
  }
  await prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { readAt: new Date() },
  });
}
