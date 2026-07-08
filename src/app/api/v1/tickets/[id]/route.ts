import { z } from 'zod';
import { ok, fail, parseJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { requireProjectAccess } from '@/lib/permissions';
import { ApiError, ErrorCodes } from '@/lib/errors';
import { updateTicket, PRIORITIES, TICKET_CONTEXTS, type Priority, type TicketContext } from '@/lib/tickets';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const ticket = await prisma.ticket.findUnique({
      where: { id: ctx.params.id },
      include: {
        assignees: { include: { user: true } },
        labels: { include: { label: true } },
        watchers: { include: { user: true } },
        reporter: true,
        statusColumn: true,
        project: true,
      },
    });
    if (!ticket) throw new ApiError(ErrorCodes.TICKET_NOT_FOUND, 'Ticket not found');
    await requireProjectAccess(user.id, ticket.projectId, 'viewer');

    const [comments, activity] = await Promise.all([
      prisma.comment.findMany({
        where: { ticketId: ticket.id },
        orderBy: { createdAt: 'asc' },
        include: { author: true },
      }),
      prisma.activityEvent.findMany({
        where: { ticketId: ticket.id },
        orderBy: { createdAt: 'asc' },
        include: { actor: true },
      }),
    ]);

    return ok({
      data: {
        id: ticket.id,
        workspaceId: ticket.workspaceId,
        number: ticket.number,
        title: ticket.title,
        description: ticket.description,
        priority: ticket.priority,
        context: ticket.context,
        statusColumn: ticket.statusColumn,
        dueDate: ticket.dueDate,
        estimate: ticket.estimate,
        version: ticket.version,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        reporter: {
          id: ticket.reporter.id,
          name: ticket.reporter.name,
          avatarUrl: ticket.reporter.avatarUrl,
        },
        project: { id: ticket.project.id, key: ticket.project.key, name: ticket.project.name },
        assignees: ticket.assignees.map((a) => ({
          id: a.user.id,
          name: a.user.name,
          avatarUrl: a.user.avatarUrl,
        })),
        labels: ticket.labels.map((l) => l.label),
        watchers: ticket.watchers.map((w) => ({
          id: w.user.id,
          name: w.user.name,
        })),
        comments: comments.map((c) => ({
          id: c.id,
          body: c.body,
          createdAt: c.createdAt,
          editedAt: c.editedAt,
          author: { id: c.author.id, name: c.author.name, avatarUrl: c.author.avatarUrl },
        })),
        activity: activity.map((e) => ({
          id: e.id,
          type: e.eventType,
          createdAt: e.createdAt,
          actor: e.actor
            ? { id: e.actor.id, name: e.actor.name }
            : null,
          payload: JSON.parse(e.payload),
        })),
      },
    });
  } catch (err) {
    return fail(err);
  }
}

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(50000).nullable().optional(),
  priority: z.enum(PRIORITIES as [string, ...string[]]).optional(),
  context: z.enum(TICKET_CONTEXTS as [string, ...string[]]).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  estimate: z.number().min(0).max(999).nullable().optional(),
  assigneeIds: z.array(z.string()).max(5).optional(),
  labelIds: z.array(z.string()).optional(),
});

export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const ticket = await prisma.ticket.findUnique({
      where: { id: ctx.params.id },
      select: { projectId: true },
    });
    if (!ticket) throw new ApiError(ErrorCodes.TICKET_NOT_FOUND, 'Ticket not found');
    await requireProjectAccess(user.id, ticket.projectId, 'member');

    const body = await parseJson(req, patchSchema);
    const ifMatch = req.headers.get('if-match');
    const expectedVersion = ifMatch ? parseInt(ifMatch, 10) : undefined;

    const updated = await updateTicket({
      ticketId: ctx.params.id,
      actorId: user.id,
      expectedVersion,
      patch: {
        title: body.title,
        description: body.description ?? undefined,
        priority: body.priority as Priority | undefined,
        context: body.context as TicketContext | undefined,
        dueDate: body.dueDate === undefined ? undefined : body.dueDate ? new Date(body.dueDate) : null,
        estimate: body.estimate ?? undefined,
        assigneeIds: body.assigneeIds,
        labelIds: body.labelIds,
      },
    });
    return ok({ data: updated });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(_req: Request, ctx: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const ticket = await prisma.ticket.findUnique({
      where: { id: ctx.params.id },
      select: { projectId: true },
    });
    if (!ticket) throw new ApiError(ErrorCodes.TICKET_NOT_FOUND, 'Ticket not found');
    await requireProjectAccess(user.id, ticket.projectId, 'member');
    await prisma.ticket.update({
      where: { id: ctx.params.id },
      data: { archivedAt: new Date() },
    });
    return ok({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
