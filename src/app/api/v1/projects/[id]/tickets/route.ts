import { z } from 'zod';
import { ok, fail, parseJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { requireProjectAccess } from '@/lib/permissions';
import { createTicket, PRIORITIES, TICKET_CONTEXTS, type Priority, type TicketContext } from '@/lib/tickets';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(50000).optional(),
  statusColumnId: z.string(),
  priority: z.enum(PRIORITIES as [string, ...string[]]).optional(),
  context: z.enum(TICKET_CONTEXTS as [string, ...string[]]).optional(),
  assigneeIds: z.array(z.string()).max(5).optional(),
  labelIds: z.array(z.string()).optional(),
  dueDate: z.string().datetime().optional(),
  estimate: z.number().min(0).max(999).optional(),
});

export async function POST(req: Request, ctx: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const access = await requireProjectAccess(user.id, ctx.params.id, 'member');
    const body = await parseJson(req, createSchema);

    const ticket = await createTicket({
      workspaceId: access.project.workspaceId,
      projectId: ctx.params.id,
      reporterId: user.id,
      title: body.title,
      description: body.description,
      statusColumnId: body.statusColumnId,
      priority: body.priority as Priority | undefined,
      context: body.context as TicketContext | undefined,
      assigneeIds: body.assigneeIds,
      labelIds: body.labelIds,
      dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
      estimate: body.estimate ?? null,
    });
    return ok({ data: ticket }, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}

export async function GET(req: Request, ctx: { params: { id: string } }) {
  try {
    const user = await requireUser();
    await requireProjectAccess(user.id, ctx.params.id, 'viewer');

    const url = new URL(req.url);
    const assignee = url.searchParams.get('assignee') || undefined;
    const priority = url.searchParams.get('priority') || undefined;
    const labelId = url.searchParams.get('label') || undefined;
    const dueBefore = url.searchParams.get('due_before') || undefined;
    const q = url.searchParams.get('q') || undefined;
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);

    const context = url.searchParams.get('context') || undefined;

    const where: Record<string, unknown> = { projectId: ctx.params.id, archivedAt: null };
    if (assignee) where.assignees = { some: { userId: assignee } };
    if (context) where.context = context;
    if (priority) where.priority = priority;
    if (labelId) where.labels = { some: { labelId } };
    if (dueBefore) where.dueDate = { lte: new Date(dueBefore) };
    if (q) where.title = { contains: q };

    const tickets = await prisma.ticket.findMany({
      where,
      orderBy: { rank: 'asc' },
      take: limit,
      include: {
        assignees: { include: { user: true } },
        labels: { include: { label: true } },
      },
    });
    return ok({ data: tickets });
  } catch (err) {
    return fail(err);
  }
}
