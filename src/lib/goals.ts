/**
 * Goal service — daily / weekly / monthly / yearly goals per user.
 *
 * Goals live in a workspace, belong to their creator, and are scoped to a
 * cadence period via `periodKey` (see src/lib/periods.ts). A goal can link
 * tickets; its derived progress counts linked tickets sitting in a `done`
 * category column.
 */

import { prisma } from './db';
import { newId } from './ids';
import { ApiError, ErrorCodes } from './errors';
import {
  type Cadence,
  type GoalContext,
  isValidPeriodKey,
  periodKeyFor,
} from './periods';

export interface GoalWithProgress {
  id: string;
  workspaceId: string;
  ownerId: string;
  title: string;
  notes: string | null;
  cadence: string;
  periodKey: string;
  context: string;
  status: string;
  completedAt: Date | null;
  position: number;
  createdAt: Date;
  updatedAt: Date;
  tickets: Array<{
    ticketId: string;
    title: string;
    number: number;
    projectKey: string;
    projectId: string;
    done: boolean;
  }>;
  progress: { linked: number; done: number };
}

const goalInclude = {
  tickets: {
    include: {
      ticket: {
        select: {
          id: true,
          title: true,
          number: true,
          projectId: true,
          project: { select: { key: true } },
          statusColumn: { select: { category: true } },
        },
      },
    },
  },
} as const;

type GoalRow = NonNullable<Awaited<ReturnType<typeof findGoalRow>>>;

function findGoalRow(id: string) {
  return prisma.goal.findUnique({ where: { id }, include: goalInclude });
}

export function shapeGoal(goal: GoalRow): GoalWithProgress {
  const tickets = goal.tickets.map((gt) => ({
    ticketId: gt.ticket.id,
    title: gt.ticket.title,
    number: gt.ticket.number,
    projectKey: gt.ticket.project.key,
    projectId: gt.ticket.projectId,
    done: gt.ticket.statusColumn.category === 'done',
  }));
  return {
    ...goal,
    tickets,
    progress: { linked: tickets.length, done: tickets.filter((t) => t.done).length },
  };
}

export async function listGoals(input: {
  workspaceId: string;
  ownerId: string;
  cadence?: Cadence;
  periodKey?: string;
  context?: GoalContext;
}): Promise<GoalWithProgress[]> {
  const goals = await prisma.goal.findMany({
    where: {
      workspaceId: input.workspaceId,
      ownerId: input.ownerId,
      ...(input.cadence ? { cadence: input.cadence } : {}),
      ...(input.periodKey ? { periodKey: input.periodKey } : {}),
      ...(input.context ? { context: input.context } : {}),
    },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    include: goalInclude,
  });
  return goals.map(shapeGoal);
}

export async function createGoal(input: {
  workspaceId: string;
  ownerId: string;
  title: string;
  notes?: string | null;
  cadence: Cadence;
  periodKey?: string; // defaults to the current period in `timezone`
  context?: GoalContext;
  timezone?: string;
}): Promise<GoalWithProgress> {
  const periodKey = input.periodKey ?? periodKeyFor(input.cadence, new Date(), input.timezone ?? 'UTC');
  if (!isValidPeriodKey(input.cadence, periodKey)) {
    throw new ApiError(ErrorCodes.VALIDATION_FAILED, `Invalid period key "${periodKey}" for cadence "${input.cadence}"`);
  }
  const last = await prisma.goal.findFirst({
    where: {
      workspaceId: input.workspaceId,
      ownerId: input.ownerId,
      cadence: input.cadence,
      periodKey,
    },
    orderBy: { position: 'desc' },
    select: { position: true },
  });
  const goal = await prisma.goal.create({
    data: {
      id: newId('gol'),
      workspaceId: input.workspaceId,
      ownerId: input.ownerId,
      title: input.title,
      notes: input.notes ?? null,
      cadence: input.cadence,
      periodKey,
      context: input.context ?? 'professional',
      position: (last?.position ?? -1) + 1,
    },
    include: goalInclude,
  });
  return shapeGoal(goal);
}

export async function updateGoal(input: {
  goalId: string;
  ownerId: string;
  patch: {
    title?: string;
    notes?: string | null;
    status?: 'active' | 'completed' | 'dropped';
    context?: GoalContext;
    periodKey?: string; // move goal to another period of the same cadence
    position?: number;
  };
}): Promise<GoalWithProgress> {
  const goal = await prisma.goal.findUnique({ where: { id: input.goalId } });
  if (!goal || goal.ownerId !== input.ownerId) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 'Goal not found');
  }
  if (
    input.patch.periodKey !== undefined &&
    !isValidPeriodKey(goal.cadence as Cadence, input.patch.periodKey)
  ) {
    throw new ApiError(ErrorCodes.VALIDATION_FAILED, `Invalid period key for cadence "${goal.cadence}"`);
  }

  const data: Record<string, unknown> = {};
  if (input.patch.title !== undefined) data.title = input.patch.title;
  if (input.patch.notes !== undefined) data.notes = input.patch.notes;
  if (input.patch.context !== undefined) data.context = input.patch.context;
  if (input.patch.periodKey !== undefined) data.periodKey = input.patch.periodKey;
  if (input.patch.position !== undefined) data.position = input.patch.position;
  if (input.patch.status !== undefined) {
    data.status = input.patch.status;
    data.completedAt = input.patch.status === 'completed' ? new Date() : null;
  }

  const updated = await prisma.goal.update({
    where: { id: input.goalId },
    data,
    include: goalInclude,
  });
  return shapeGoal(updated);
}

export async function deleteGoal(goalId: string, ownerId: string) {
  const goal = await prisma.goal.findUnique({ where: { id: goalId } });
  if (!goal || goal.ownerId !== ownerId) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 'Goal not found');
  }
  await prisma.goal.delete({ where: { id: goalId } });
}

export async function linkTicket(goalId: string, ownerId: string, ticketId: string) {
  const goal = await prisma.goal.findUnique({ where: { id: goalId } });
  if (!goal || goal.ownerId !== ownerId) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 'Goal not found');
  }
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true, workspaceId: true },
  });
  if (!ticket || ticket.workspaceId !== goal.workspaceId) {
    throw new ApiError(ErrorCodes.TICKET_NOT_FOUND, 'Ticket not found in this workspace');
  }
  await prisma.goalTicket.upsert({
    where: { goalId_ticketId: { goalId, ticketId } },
    update: {},
    create: { goalId, ticketId },
  });
  const updated = await findGoalRow(goalId);
  return shapeGoal(updated!);
}

export async function unlinkTicket(goalId: string, ownerId: string, ticketId: string) {
  const goal = await prisma.goal.findUnique({ where: { id: goalId } });
  if (!goal || goal.ownerId !== ownerId) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 'Goal not found');
  }
  await prisma.goalTicket.deleteMany({ where: { goalId, ticketId } });
  const updated = await findGoalRow(goalId);
  return shapeGoal(updated!);
}
