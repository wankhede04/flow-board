/**
 * Slack Events API endpoint. Handles the url_verification handshake and
 * acks event callbacks (§9.6 — always 200 fast; processing is best-effort).
 */

import { NextResponse } from 'next/server';
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

  let body: { type?: string; challenge?: string };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'bad payload' }, { status: 400 });
  }

  if (body.type === 'url_verification') {
    return NextResponse.json({ challenge: body.challenge });
  }

  // event_callback: ack immediately. (Two-way comment sync is a reserved
  // follow-up — see TechSpec §9.4; slack_message_ts is already on comments.)
  return NextResponse.json({ ok: true });
}
