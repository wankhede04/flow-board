import { z } from 'zod';
import { ok, fail, parseJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ApiError, ErrorCodes } from '@/lib/errors';
import type { CalendarInfo } from '@/lib/calendar';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  selectedCalendarIds: z.array(z.string()).max(100),
});

/** Update which of the account's calendars appear on the Schedule. */
export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const account = await prisma.googleCalendarAccount.findUnique({
      where: { id: ctx.params.id },
    });
    if (!account || account.userId !== user.id) {
      throw new ApiError(ErrorCodes.NOT_FOUND, 'Calendar account not found');
    }
    const body = await parseJson(req, patchSchema);
    const selected = new Set(body.selectedCalendarIds);
    const calendars = (JSON.parse(account.calendars) as CalendarInfo[]).map((c) => ({
      ...c,
      selected: selected.has(c.id),
    }));
    const updated = await prisma.googleCalendarAccount.update({
      where: { id: account.id },
      data: { calendars: JSON.stringify(calendars) },
    });
    return ok({ data: { id: updated.id, calendars } });
  } catch (err) {
    return fail(err);
  }
}

/** Disconnect the Google account. */
export async function DELETE(_req: Request, ctx: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const account = await prisma.googleCalendarAccount.findUnique({
      where: { id: ctx.params.id },
    });
    if (!account || account.userId !== user.id) {
      throw new ApiError(ErrorCodes.NOT_FOUND, 'Calendar account not found');
    }
    await prisma.googleCalendarAccount.delete({ where: { id: account.id } });
    return ok({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
