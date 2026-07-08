import { z } from 'zod';
import { ok, fail, parseJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { requireProjectAccess } from '@/lib/permissions';
import { ApiError, ErrorCodes } from '@/lib/errors';
import { transitionTicket, computeRankForDrop } from '@/lib/tickets';
import { notifyTicketMoved } from '@/lib/slack';

export const dynamic = 'force-dynamic';

const schema = z.object({
  targetColumnId: z.string(),
  rank: z.string().optional(),
  // Optional: client provides desired position index for end-of-column drops.
  targetIndex: z.number().int().min(0).optional(),
});

export async function POST(req: Request, ctx: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const ticket = await prisma.ticket.findUnique({
      where: { id: ctx.params.id },
      select: { projectId: true, statusColumnId: true },
    });
    if (!ticket) throw new ApiError(ErrorCodes.TICKET_NOT_FOUND, 'Ticket not found');
    const access = await requireProjectAccess(user.id, ticket.projectId, 'member');

    const body = await parseJson(req, schema);
    const url = new URL(req.url);
    const overrideWip = url.searchParams.get('override_wip') === 'true';
    const ifMatch = req.headers.get('if-match');
    const expectedVersion = ifMatch ? parseInt(ifMatch, 10) : undefined;

    let resolvedRank = body.rank;
    if (!resolvedRank && body.targetIndex !== undefined) {
      resolvedRank = await computeRankForDrop(
        body.targetColumnId,
        body.targetIndex,
        ctx.params.id,
      );
    }

    const updated = await transitionTicket({
      ticketId: ctx.params.id,
      actorId: user.id,
      targetColumnId: body.targetColumnId,
      rank: resolvedRank,
      expectedVersion,
      overrideWip,
      actorRoleForBypass: (access.projectRole ?? access.workspaceRole) as
        | 'admin'
        | 'member'
        | 'viewer'
        | 'guest',
    });

    // Slack fan-out to reporter + assignees (no-op when Slack unconfigured).
    if (updated.statusColumnId !== ticket.statusColumnId) {
      await notifyTicketMoved({
        ticketId: updated.id,
        actorId: user.id,
        fromColumnId: ticket.statusColumnId,
        toColumnId: updated.statusColumnId,
      });
    }

    return ok({ data: updated });
  } catch (err) {
    return fail(err);
  }
}
