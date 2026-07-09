import { z } from 'zod';
import { ok, fail, parseJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { listNotifications, markRead, unreadCount } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const unreadOnly = url.searchParams.get('unread') === 'true';
    const [items, unread] = await Promise.all([
      listNotifications(user.id, { unreadOnly }),
      unreadCount(user.id),
    ]);
    return ok({ data: { items, unread } });
  } catch (err) {
    return fail(err);
  }
}

const readSchema = z.object({ id: z.string().min(1) }); // notification id or "all"

/** Mark a notification (or all) read. */
export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    const body = await parseJson(req, readSchema);
    await markRead(user.id, body.id === 'all' ? 'all' : body.id);
    return ok({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
