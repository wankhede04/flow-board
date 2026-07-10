/**
 * Ticket service. Implements TechSpec §7.1 (creation) and §7.2 (transition)
 * including WIP-limit enforcement and optimistic locking.
 */

import { prisma } from './db';
import { newId } from './ids';
import { ApiError, ErrorCodes } from './errors';
import { recordActivity } from './activity';
import { rankAfter, rankBetween } from './fractional-index';
import { canBypassWipLimit } from './permissions';

export type Priority = 'lowest' | 'low' | 'medium' | 'high' | 'urgent';
export const PRIORITIES: Priority[] = ['lowest', 'low', 'medium', 'high', 'urgent'];

export type TicketContext = 'personal' | 'professional';
export const TICKET_CONTEXTS: TicketContext[] = ['personal', 'professional'];

interface CreateTicketInput {
  workspaceId: string;
  projectId: string;
  reporterId: string;
  title: string;
  description?: string;
  statusColumnId: string;
  priority?: Priority;
  context?: TicketContext;
  assigneeIds?: string[];
  labelIds?: string[];
  dueDate?: Date | null;
  estimate?: number | null;
}

export async function createTicket(input: CreateTicketInput) {
  // Verify column belongs to project
  const col = await prisma.workflowColumn.findUnique({
    where: { id: input.statusColumnId },
    select: { id: true, projectId: true },
  });
  if (!col || col.projectId !== input.projectId) {
    throw new ApiError(ErrorCodes.COLUMN_NOT_FOUND, 'Target column does not belong to project');
  }

  return prisma.$transaction(async (tx) => {
    // Increment ticket sequence
    const project = await tx.project.update({
      where: { id: input.projectId },
      data: { ticketSeq: { increment: 1 } },
      select: { id: true, ticketSeq: true, key: true },
    });

    // Compute initial rank: append after current max in the column
    const last = await tx.ticket.findFirst({
      where: { statusColumnId: input.statusColumnId, archivedAt: null },
      orderBy: { rank: 'desc' },
      select: { rank: true },
    });
    const rank = rankAfter(last?.rank ?? null);

    const id = newId('tkt');
    const ticket = await tx.ticket.create({
      data: {
        id,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        number: project.ticketSeq,
        title: input.title,
        description: input.description ?? null,
        statusColumnId: input.statusColumnId,
        priority: input.priority ?? 'medium',
        context: input.context ?? 'professional',
        reporterId: input.reporterId,
        dueDate: input.dueDate ?? null,
        estimate: input.estimate ?? null,
        rank,
      },
    });

    // Always include reporter + assignees as watchers
    const watchers = new Set<string>([input.reporterId, ...(input.assigneeIds ?? [])]);
    await tx.ticketWatcher.createMany({
      data: [...watchers].map((userId) => ({ ticketId: id, userId })),
    });

    if (input.assigneeIds?.length) {
      await tx.ticketAssignee.createMany({
        data: input.assigneeIds.map((userId) => ({ ticketId: id, userId })),
      });
    }
    if (input.labelIds?.length) {
      await tx.ticketLabel.createMany({
        data: input.labelIds.map((labelId) => ({ ticketId: id, labelId })),
      });
    }

    await recordActivity({
      ticketId: id,
      actorId: input.reporterId,
      type: 'ticket_created',
      payload: { title: input.title, statusColumnId: input.statusColumnId },
      tx: tx as unknown as typeof prisma,
    });

    return ticket;
  });
}

interface TransitionInput {
  ticketId: string;
  actorId: string;
  targetColumnId: string;
  rank?: string;
  expectedVersion?: number;
  overrideWip?: boolean;
  actorRoleForBypass?: 'admin' | 'member' | 'viewer' | 'guest';
}

export async function transitionTicket(input: TransitionInput) {
  return prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findUnique({
      where: { id: input.ticketId },
      select: {
        id: true,
        projectId: true,
        statusColumnId: true,
        version: true,
        rank: true,
      },
    });
    if (!ticket) {
      throw new ApiError(ErrorCodes.TICKET_NOT_FOUND, 'Ticket not found');
    }
    if (
      input.expectedVersion !== undefined &&
      input.expectedVersion !== ticket.version
    ) {
      throw new ApiError(
        ErrorCodes.VERSION_CONFLICT,
        'Ticket was modified by another user',
        { current_version: ticket.version },
      );
    }

    const target = await tx.workflowColumn.findUnique({
      where: { id: input.targetColumnId },
      select: { id: true, projectId: true, wipLimit: true },
    });
    if (!target || target.projectId !== ticket.projectId) {
      throw new ApiError(
        ErrorCodes.COLUMN_NOT_FOUND,
        'Target column does not belong to project',
      );
    }

    // WIP limit check (skipped if same column or admin override)
    const movingColumns = target.id !== ticket.statusColumnId;
    if (movingColumns && target.wipLimit != null && !input.overrideWip) {
      const count = await tx.ticket.count({
        where: { statusColumnId: target.id, archivedAt: null },
      });
      if (count >= target.wipLimit) {
        if (!canBypassWipLimit(input.actorRoleForBypass)) {
          throw new ApiError(
            ErrorCodes.WIP_LIMIT_EXCEEDED,
            `Column has reached its WIP limit of ${target.wipLimit}`,
            { wip_limit: target.wipLimit, current_count: count },
          );
        }
      }
    }

    // Compute rank if not provided: place at end of target column
    let newRank = input.rank;
    if (!newRank) {
      const last = await tx.ticket.findFirst({
        where: {
          statusColumnId: target.id,
          archivedAt: null,
          NOT: { id: ticket.id },
        },
        orderBy: { rank: 'desc' },
        select: { rank: true },
      });
      newRank = rankAfter(last?.rank ?? null);
    }

    const updated = await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        statusColumnId: target.id,
        rank: newRank,
        version: { increment: 1 },
        ...(movingColumns ? { statusChangedAt: new Date() } : {}),
      },
    });

    if (movingColumns) {
      // Moving resets the stale-ticket notification so a future stall
      // in the new column notifies again.
      await tx.dueReminderSent.deleteMany({
        where: { ticketId: ticket.id, kind: 'stale_7d' },
      });
      await recordActivity({
        ticketId: ticket.id,
        actorId: input.actorId,
        type: 'status_changed',
        payload: { from: ticket.statusColumnId, to: target.id },
        tx: tx as unknown as typeof prisma,
      });
    }

    return updated;
  });
}

interface UpdateTicketInput {
  ticketId: string;
  actorId: string;
  expectedVersion?: number;
  patch: {
    title?: string;
    description?: string | null;
    priority?: Priority;
    context?: TicketContext;
    dueDate?: Date | null;
    estimate?: number | null;
    assigneeIds?: string[];
    labelIds?: string[];
  };
}

export async function updateTicket(input: UpdateTicketInput) {
  return prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findUnique({
      where: { id: input.ticketId },
      select: {
        id: true,
        version: true,
        priority: true,
        dueDate: true,
      },
    });
    if (!ticket) {
      throw new ApiError(ErrorCodes.TICKET_NOT_FOUND, 'Ticket not found');
    }
    if (
      input.expectedVersion !== undefined &&
      input.expectedVersion !== ticket.version
    ) {
      throw new ApiError(
        ErrorCodes.VERSION_CONFLICT,
        'Ticket was modified by another user',
        { current_version: ticket.version },
      );
    }

    const data: Record<string, unknown> = { version: { increment: 1 } };
    if (input.patch.title !== undefined) data.title = input.patch.title;
    if (input.patch.description !== undefined) data.description = input.patch.description;
    if (input.patch.priority !== undefined) data.priority = input.patch.priority;
    if (input.patch.context !== undefined) data.context = input.patch.context;
    if (input.patch.dueDate !== undefined) data.dueDate = input.patch.dueDate;
    if (input.patch.estimate !== undefined) data.estimate = input.patch.estimate;

    const updated = await tx.ticket.update({
      where: { id: ticket.id },
      data,
    });

    if (input.patch.assigneeIds) {
      await tx.ticketAssignee.deleteMany({ where: { ticketId: ticket.id } });
      await tx.ticketAssignee.createMany({
        data: input.patch.assigneeIds.map((userId) => ({ ticketId: ticket.id, userId })),
      });
    }
    if (input.patch.labelIds) {
      await tx.ticketLabel.deleteMany({ where: { ticketId: ticket.id } });
      await tx.ticketLabel.createMany({
        data: input.patch.labelIds.map((labelId) => ({ ticketId: ticket.id, labelId })),
      });
    }

    if (input.patch.priority && input.patch.priority !== ticket.priority) {
      await recordActivity({
        ticketId: ticket.id,
        actorId: input.actorId,
        type: 'priority_changed',
        payload: { from: ticket.priority, to: input.patch.priority },
        tx: tx as unknown as typeof prisma,
      });
    }
    if (
      input.patch.dueDate !== undefined &&
      String(input.patch.dueDate ?? '') !== String(ticket.dueDate ?? '')
    ) {
      await recordActivity({
        ticketId: ticket.id,
        actorId: input.actorId,
        type: 'due_date_changed',
        payload: { from: ticket.dueDate, to: input.patch.dueDate },
        tx: tx as unknown as typeof prisma,
      });
    }
    await recordActivity({
      ticketId: ticket.id,
      actorId: input.actorId,
      type: 'ticket_updated',
      payload: { fields: Object.keys(input.patch) },
      tx: tx as unknown as typeof prisma,
    });

    return updated;
  });
}

/**
 * Computes the rank for a card dropped into a target column at a given index
 * (0 = top of column). The drag-and-drop client passes the `targetIndex` it
 * computed from the user's drop position; we resolve it to neighbors and emit
 * a fractional key.
 */
export async function computeRankForDrop(
  targetColumnId: string,
  targetIndex: number,
  movingTicketId: string,
): Promise<string> {
  const sorted = await prisma.ticket.findMany({
    where: { statusColumnId: targetColumnId, archivedAt: null },
    orderBy: { rank: 'asc' },
    select: { id: true, rank: true },
  });
  const others = sorted.filter((t) => t.id !== movingTicketId);
  const before = others[targetIndex - 1] ?? null;
  const after = others[targetIndex] ?? null;
  return rankBetween(before?.rank ?? null, after?.rank ?? null);
}
