import { z } from 'zod';
import { ok, fail, parseJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { deleteGoal, updateGoal } from '@/lib/goals';
import { GOAL_CONTEXTS } from '@/lib/periods';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  notes: z.string().max(5000).nullable().optional(),
  status: z.enum(['active', 'completed', 'dropped']).optional(),
  context: z.enum(GOAL_CONTEXTS as [string, ...string[]]).optional(),
  periodKey: z.string().max(10).optional(),
  position: z.number().int().min(0).optional(),
});

export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await parseJson(req, patchSchema);
    const goal = await updateGoal({
      goalId: ctx.params.id,
      ownerId: user.id,
      patch: {
        title: body.title,
        notes: body.notes,
        status: body.status,
        context: body.context as 'personal' | 'professional' | undefined,
        periodKey: body.periodKey,
        position: body.position,
      },
    });
    return ok({ data: goal });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(_req: Request, ctx: { params: { id: string } }) {
  try {
    const user = await requireUser();
    await deleteGoal(ctx.params.id, user.id);
    return ok({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
