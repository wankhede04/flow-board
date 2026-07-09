import { z } from 'zod';
import { ok, fail, parseJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { requireWorkspaceMember } from '@/lib/permissions';
import { createGoal, listGoals } from '@/lib/goals';
import { CADENCES, GOAL_CONTEXTS, type Cadence, type GoalContext } from '@/lib/periods';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: { wid: string } }) {
  try {
    const user = await requireUser();
    await requireWorkspaceMember(user.id, ctx.params.wid, 'viewer');

    const url = new URL(req.url);
    const cadence = url.searchParams.get('cadence') || undefined;
    const periodKey = url.searchParams.get('period') || undefined;
    const context = url.searchParams.get('context') || undefined;

    const goals = await listGoals({
      workspaceId: ctx.params.wid,
      ownerId: user.id,
      cadence: cadence as Cadence | undefined,
      periodKey,
      context: context as GoalContext | undefined,
    });
    return ok({ data: goals });
  } catch (err) {
    return fail(err);
  }
}

const createSchema = z.object({
  title: z.string().min(1).max(200),
  notes: z.string().max(5000).nullable().optional(),
  cadence: z.enum(CADENCES as [string, ...string[]]),
  periodKey: z.string().max(10).optional(),
  context: z.enum(GOAL_CONTEXTS as [string, ...string[]]).optional(),
});

export async function POST(req: Request, ctx: { params: { wid: string } }) {
  try {
    const user = await requireUser();
    await requireWorkspaceMember(user.id, ctx.params.wid, 'member');
    const body = await parseJson(req, createSchema);

    const goal = await createGoal({
      workspaceId: ctx.params.wid,
      ownerId: user.id,
      title: body.title,
      notes: body.notes,
      cadence: body.cadence as Cadence,
      periodKey: body.periodKey,
      context: body.context as GoalContext | undefined,
      timezone: user.timezone,
    });
    return ok({ data: goal }, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}
