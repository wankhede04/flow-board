import { z } from 'zod';
import { ok, fail, parseJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { deleteReminder, RECURRENCES, snoozeReminder, updateReminder, type ReminderRecurrence } from '@/lib/reminders';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  notes: z.string().max(5000).nullable().optional(),
  remindAt: z.string().datetime().optional(), // manual reschedule
  recurrence: z.enum(RECURRENCES as [string, ...string[]]).optional(),
  status: z.enum(['pending', 'done', 'cancelled']).optional(),
  snoozeMinutes: z.number().int().min(1).max(60 * 24 * 30).optional(),
});

export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await parseJson(req, patchSchema);

    if (body.snoozeMinutes !== undefined) {
      const snoozed = await snoozeReminder(ctx.params.id, user.id, body.snoozeMinutes);
      return ok({ data: snoozed });
    }

    const reminder = await updateReminder({
      reminderId: ctx.params.id,
      userId: user.id,
      patch: {
        title: body.title,
        notes: body.notes,
        remindAt: body.remindAt ? new Date(body.remindAt) : undefined,
        recurrence: body.recurrence as ReminderRecurrence | undefined,
        status: body.status,
      },
    });
    return ok({ data: reminder });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(_req: Request, ctx: { params: { id: string } }) {
  try {
    const user = await requireUser();
    await deleteReminder(ctx.params.id, user.id);
    return ok({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
