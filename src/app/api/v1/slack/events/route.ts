/**
 * Slack Events API endpoint. Handles the url_verification handshake and
 * message events from linked channels: a channel message creates a ticket,
 * a thread reply with a status keyword moves it (src/lib/slack-channel.ts).
 * Always acks fast (§9.6) — processing continues after the response.
 */

import { NextResponse } from 'next/server';
import { verifySlackSignature } from '@/lib/slack';
import { handleSlackEvent, type SlackEventEnvelope } from '@/lib/slack-channel';

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

  let body: SlackEventEnvelope & { challenge?: string };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'bad payload' }, { status: 400 });
  }

  if (body.type === 'url_verification') {
    return NextResponse.json({ challenge: body.challenge });
  }

  // Ack within Slack's 3s window; the handler keeps running after the
  // response (fine on the long-lived Node server this app targets).
  void handleSlackEvent(body).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[slack] event handling failed', err);
  });
  return NextResponse.json({ ok: true });
}
