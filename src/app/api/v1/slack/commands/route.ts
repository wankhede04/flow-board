/**
 * Slack slash-command endpoint (`/flowboard …`). TechSpec §9.2/§9.5/§9.6.
 *
 * The raw body is read before parsing so the HMAC signature is computed over
 * exactly what Slack sent. Command execution is local-DB fast, so we respond
 * synchronously well inside Slack's 3-second window.
 */

import { NextResponse } from 'next/server';
import { executeSlashCommand } from '@/lib/slack-commands';
import { verifySlackSignature } from '@/lib/slack';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    return NextResponse.json({ error: 'Slack integration not configured' }, { status: 503 });
  }

  const rawBody = await req.text();
  const valid = verifySlackSignature({
    signingSecret,
    timestamp: req.headers.get('x-slack-request-timestamp'),
    signature: req.headers.get('x-slack-signature'),
    rawBody,
  });
  if (!valid) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  const params = new URLSearchParams(rawBody);
  const teamId = params.get('team_id') ?? '';
  const slackUserId = params.get('user_id') ?? '';
  const text = params.get('text') ?? '';

  const response = await executeSlashCommand({ teamId, slackUserId, text });
  return NextResponse.json(response);
}
