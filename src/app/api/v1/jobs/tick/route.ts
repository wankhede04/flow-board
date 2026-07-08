/**
 * External-cron entry point for the background jobs (reminders + due-date
 * nudges). Protect with CRON_SECRET; use when ENABLE_SCHEDULER=false
 * (serverless / multi-replica deploys):
 *
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     https://flowboard.example.com/api/v1/jobs/tick
 */

import { NextResponse } from 'next/server';
import { ok, fail } from '@/lib/api';
import { runJobsTick } from '@/lib/jobs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  }
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const result = await runJobsTick();
    return ok({ data: result });
  } catch (err) {
    return fail(err);
  }
}
