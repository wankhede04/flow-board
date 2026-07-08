import { z } from 'zod';
import { ok, fail, parseJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { linkTicket, unlinkTicket } from '@/lib/goals';

export const dynamic = 'force-dynamic';

const schema = z.object({ ticketId: z.string().min(1) });

export async function POST(req: Request, ctx: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await parseJson(req, schema);
    const goal = await linkTicket(ctx.params.id, user.id, body.ticketId);
    return ok({ data: goal }, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request, ctx: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await parseJson(req, schema);
    const goal = await unlinkTicket(ctx.params.id, user.id, body.ticketId);
    return ok({ data: goal });
  } catch (err) {
    return fail(err);
  }
}
