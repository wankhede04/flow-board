import { z } from 'zod';
import { ok, fail, parseJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { requireWorkspaceMember } from '@/lib/permissions';
import { createReminder, listReminders, RECURRENCES, type ReminderRecurrence, type ReminderStatus } from '@/lib/reminders';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: { wid: string } }) {
  try {
    const user = await requireUser();
    await requireWorkspaceMember(user.id, ctx.params.wid, 'viewer');

    const url = new URL(req.url);
    const status = url.searchParams.get('status') || undefined;
    const from = url.searchParams.get('from') || undefined;
    const to = url.searchParams.get('to') || undefined;

    const reminders = await listReminders({
      workspaceId: ctx.params.wid,
      userId: user.id,
      status: status as ReminderStatus | 'open' | undefined,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
    return ok({ data: reminders });
  } catch (err) {
    return fail(err);
  }
}

const createSchema = z.object({
  title: z.string().min(1).max(200),
  notes: z.string().max(5000).nullable().optional(),
  remindAt: z.string().datetime(),
  ticketId: z.string().nullable().optional(),
  recurrence: z.enum(RECURRENCES as [string, ...string[]]).optional(),
});

export async function POST(req: Request, ctx: { params: { wid: string } }) {
  try {
    const user = await requireUser();
    await requireWorkspaceMember(user.id, ctx.params.wid, 'member');
    const body = await parseJson(req, createSchema);

    const reminder = await createReminder({
      workspaceId: ctx.params.wid,
      userId: user.id,
      title: body.title,
      notes: body.notes,
      remindAt: new Date(body.remindAt),
      ticketId: body.ticketId,
      recurrence: body.recurrence as ReminderRecurrence | undefined,
    });
    return ok({ data: reminder }, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}
