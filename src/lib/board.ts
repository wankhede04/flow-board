/**
 * Board snapshot loader. Returns the shape described in TechSpec §6.3.
 *
 * This is the hot path; we issue one query per related set rather than
 * an N+1 ride, but skip the LATERAL trickery suggested in the spec so the
 * code stays readable via plain Prisma queries.
 */

import { prisma } from './db';

export async function getBoardSnapshot(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, key: true, name: true, description: true, workspaceId: true },
  });
  if (!project) return null;

  const [columns, tickets, assignees, labels, commentCounts] = await Promise.all([
    prisma.workflowColumn.findMany({
      where: { projectId },
      orderBy: { position: 'asc' },
    }),
    prisma.ticket.findMany({
      where: { projectId, archivedAt: null },
      orderBy: { rank: 'asc' },
    }),
    prisma.ticketAssignee.findMany({
      where: { ticket: { projectId, archivedAt: null } },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true } },
      },
    }),
    prisma.ticketLabel.findMany({
      where: { ticket: { projectId, archivedAt: null } },
      include: { label: true },
    }),
    prisma.comment.groupBy({
      by: ['ticketId'],
      where: { ticket: { projectId, archivedAt: null } },
      _count: { _all: true },
    }),
  ]);

  const assigneesByTicket = new Map<string, Array<{ id: string; name: string; avatarUrl: string | null }>>();
  for (const a of assignees) {
    const arr = assigneesByTicket.get(a.ticketId) ?? [];
    arr.push(a.user);
    assigneesByTicket.set(a.ticketId, arr);
  }

  const labelsByTicket = new Map<string, Array<{ id: string; name: string; color: string }>>();
  for (const tl of labels) {
    const arr = labelsByTicket.get(tl.ticketId) ?? [];
    arr.push({ id: tl.label.id, name: tl.label.name, color: tl.label.color });
    labelsByTicket.set(tl.ticketId, arr);
  }

  const commentCountByTicket = new Map<string, number>();
  for (const c of commentCounts) {
    commentCountByTicket.set(c.ticketId, c._count._all);
  }

  const ticketsByColumn = new Map<string, typeof tickets>();
  for (const t of tickets) {
    const arr = ticketsByColumn.get(t.statusColumnId) ?? [];
    arr.push(t);
    ticketsByColumn.set(t.statusColumnId, arr);
  }

  return {
    project: {
      id: project.id,
      key: project.key,
      name: project.name,
      description: project.description,
      workspaceId: project.workspaceId,
    },
    columns: columns.map((col) => ({
      id: col.id,
      name: col.name,
      position: col.position,
      category: col.category,
      wipLimit: col.wipLimit,
      tickets: (ticketsByColumn.get(col.id) ?? []).map((t) => ({
        id: t.id,
        number: t.number,
        title: t.title,
        priority: t.priority,
        context: t.context,
        statusColumnId: t.statusColumnId,
        dueDate: t.dueDate,
        rank: t.rank,
        version: t.version,
        assignees: assigneesByTicket.get(t.id) ?? [],
        labels: labelsByTicket.get(t.id) ?? [],
        commentCount: commentCountByTicket.get(t.id) ?? 0,
      })),
    })),
  };
}

export type BoardSnapshot = NonNullable<Awaited<ReturnType<typeof getBoardSnapshot>>>;
export type BoardColumn = BoardSnapshot['columns'][number];
export type BoardTicket = BoardColumn['tickets'][number];
