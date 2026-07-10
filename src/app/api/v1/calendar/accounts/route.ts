import { ok, fail } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { calendarConfigured, type CalendarInfo } from '@/lib/calendar';

export const dynamic = 'force-dynamic';

/** Connected Google accounts + their calendars for the current user. */
export async function GET() {
  try {
    const user = await requireUser();
    const accounts = await prisma.googleCalendarAccount.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    return ok({
      data: {
        configured: calendarConfigured(),
        accounts: accounts.map((a) => ({
          id: a.id,
          email: a.email,
          connectedAt: a.createdAt,
          calendars: JSON.parse(a.calendars) as CalendarInfo[],
        })),
      },
    });
  } catch (err) {
    return fail(err);
  }
}
