import { ok, fail } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { ApiError, ErrorCodes } from '@/lib/errors';
import { fetchEventsForUser } from '@/lib/calendar';

export const dynamic = 'force-dynamic';

/** Merged events across all connected accounts for [from, to]. */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const from = new Date(url.searchParams.get('from') ?? '');
    const to = new Date(url.searchParams.get('to') ?? '');
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
      throw new ApiError(ErrorCodes.VALIDATION_FAILED, 'from/to must be valid ISO dates with from < to');
    }
    if (to.getTime() - from.getTime() > 62 * 24 * 3600_000) {
      throw new ApiError(ErrorCodes.VALIDATION_FAILED, 'Range too large (max 62 days)');
    }
    const events = await fetchEventsForUser(user.id, from, to);
    return ok({ data: events });
  } catch (err) {
    return fail(err);
  }
}
