/**
 * Slack interactivity endpoint — handles button clicks on the DM cards we
 * post (reminder snooze/done, ticket done). TechSpec §9.3.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { snoozeReminder, updateReminder } from '@/lib/reminders';
import { transitionTicket } from '@/lib/tickets';
import { resolveMember, resolveWorkspaceForTeam, verifySlackSignature } from '@/lib/slack';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface BlockActionPayload {
  type: string;
  team?: { id: string };
  user?: { id: string };
  actions?: Array<{ action_id: string; value?: string }>;
}

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

  let payload: BlockActionPayload;
  try {
    payload = JSON.parse(new URLSearchParams(rawBody).get('payload') ?? '{}');
  } catch {
    return NextResponse.json({ error: 'bad payload' }, { status: 400 });
  }
  if (payload.type !== 'block_actions' || !payload.actions?.length) {
    return NextResponse.json({ ok: true }); // ack anything we don't handle
  }

  const teamId = payload.team?.id ?? '';
  const slackUserId = payload.user?.id ?? '';
  const workspaceId = await resolveWorkspaceForTeam(teamId);
  const member = workspaceId ? await resolveMember(workspaceId, slackUserId) : null;
  if (!member) {
    return NextResponse.json({ text: '⚠️ Could not match your Slack account to FlowBoard.' });
  }

  const action = payload.actions[0];
  try {
    if (action.action_id === 'reminder_snooze') {
      const { id, minutes } = JSON.parse(action.value ?? '{}') as { id: string; minutes: number };
      await snoozeReminder(id, member.userId, minutes ?? 15);
      return NextResponse.json({ text: `😴 Snoozed for ${minutes ?? 15} minutes.` });
    }
    if (action.action_id === 'reminder_done') {
      const { id } = JSON.parse(action.value ?? '{}') as { id: string };
      await updateReminder({ reminderId: id, userId: member.userId, patch: { status: 'done' } });
      return NextResponse.json({ text: '✅ Reminder marked done.' });
    }
    if (action.action_id === 'ticket_done') {
      const { id } = JSON.parse(action.value ?? '{}') as { id: string };
      const ticket = await prisma.ticket.findUnique({
        where: { id },
        select: { projectId: true },
      });
      const doneColumn = ticket
        ? await prisma.workflowColumn.findFirst({
            where: { projectId: ticket.projectId, category: 'done' },
            orderBy: { position: 'asc' },
          })
        : null;
      if (!ticket || !doneColumn) return NextResponse.json({ text: '⚠️ Ticket or Done column not found.' });
      await transitionTicket({
        ticketId: id,
        actorId: member.userId,
        targetColumnId: doneColumn.id,
        actorRoleForBypass: member.role as 'admin' | 'member',
      });
      return NextResponse.json({ text: '✅ Ticket moved to Done.' });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[slack] interactivity failed', err);
    return NextResponse.json({ text: '⚠️ Action failed.' });
  }
}
