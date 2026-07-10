import { z } from 'zod';
import { ok, fail, parseJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { requireProjectAccess } from '@/lib/permissions';
import { ApiError, ErrorCodes } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  try {
    const user = await requireUser();
    await requireProjectAccess(user.id, ctx.params.id, 'viewer');

    const project = await prisma.project.findUnique({
      where: { id: ctx.params.id },
      include: {
        _count: { select: { tickets: { where: { archivedAt: null } } } },
        members: { include: { user: true } },
      },
    });
    if (!project) throw new ApiError(ErrorCodes.PROJECT_NOT_FOUND, 'Project not found');

    return ok({
      data: {
        id: project.id,
        key: project.key,
        name: project.name,
        description: project.description,
        ticketCount: project._count.tickets,
        members: project.members.map((m) => ({
          id: m.user.id,
          name: m.user.name,
          email: m.user.email,
          avatarUrl: m.user.avatarUrl,
          role: m.role,
        })),
      },
    });
  } catch (err) {
    return fail(err);
  }
}

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
});

/** Rename a project / edit its description (project admins). */
export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  try {
    const user = await requireUser();
    await requireProjectAccess(user.id, ctx.params.id, 'admin');
    const body = await parseJson(req, patchSchema);

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.description !== undefined) data.description = body.description;

    const project = await prisma.project.update({
      where: { id: ctx.params.id },
      data,
      select: { id: true, key: true, name: true, description: true },
    });
    return ok({ data: project });
  } catch (err) {
    return fail(err);
  }
}
