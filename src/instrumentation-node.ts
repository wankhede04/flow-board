/**
 * Node-runtime side of the instrumentation hook. Arms the in-process job
 * scheduler so reminders and due-date nudges fire without external cron.
 * Disable with ENABLE_SCHEDULER=false and hit POST /api/v1/jobs/tick from
 * real cron instead (multi-replica deploys).
 */

import { runJobsTick } from './lib/jobs';

export function armScheduler() {
  if (process.env.ENABLE_SCHEDULER === 'false') return;
  // Never run intervals inside `next build` workers or tests.
  if (process.env.npm_lifecycle_event === 'build') return;

  const intervalMs = Number(process.env.SCHEDULER_INTERVAL_MS ?? 60_000);

  const globalAny = globalThis as { __flowboardScheduler?: NodeJS.Timeout };
  if (globalAny.__flowboardScheduler) return; // hot-reload guard

  // eslint-disable-next-line no-console
  console.log(`[scheduler] armed — tick every ${intervalMs}ms`);
  globalAny.__flowboardScheduler = setInterval(async () => {
    try {
      const result = await runJobsTick();
      if (result.remindersDelivered + result.dueSoonNotified + result.overdueNotified > 0) {
        // eslint-disable-next-line no-console
        console.log('[scheduler] tick', JSON.stringify(result));
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[scheduler] tick failed', err);
    }
  }, intervalMs);
  globalAny.__flowboardScheduler.unref?.();
}
