/**
 * Channel-driven ticket flow (request #1):
 *
 *   - A plain message posted in a linked channel (e.g. #flowboard) creates a
 *     ticket in the channel's project. The bot replies in the message's
 *     thread with the ticket key.
 *   - A reply in that thread containing a status keyword — todo / pending /
 *     in progress / done (plus common synonyms or an exact column name) —
 *     moves the ticket to the matching column.
 *
 * Channels are linked with `/flowboard link [PROJECT_KEY]` (see
 * docs/SLACK_CHANNEL_SETUP.md). Event deliveries are deduped by event_id
 * (Slack retries on slow acks — TechSpec §9.7).
 */

import { prisma } from './db';
import { createTicket, transitionTicket } from './tickets';
import { postToChannel, resolveMember, resolveWorkspaceForTeam } from './slack';

export interface SlackMessageEvent {
  type: string;
  subtype?: string;
  bot_id?: string;
  user?: string;
  text?: string;
  channel?: string;
  ts?: string;
  thread_ts?: string;
}

export interface SlackEventEnvelope {
  type?: string;
  event_id?: string;
  team_id?: string;
  event?: SlackMessageEvent;
}

// --------------------------------------------------------------------------
// Status keyword grammar
// --------------------------------------------------------------------------

type StatusTarget =
  | { kind: 'category'; category: 'todo' | 'in_progress' | 'done' }
  | { kind: 'name'; name: string };

const KEYWORDS: Array<{ re: RegExp; target: StatusTarget }> = [
  { re: /^(todo|to[\s-]?do|backlog|pending|open)$/, target: { kind: 'category', category: 'todo' } },
  {
    re: /^(in[\s-]?progress|doing|wip|started?|progress|working(\son\sit)?)$/,
    target: { kind: 'category', category: 'in_progress' },
  },
  {
    re: /^(done|complete[d]?|finish(ed)?|closed?|resolved|shipped)$/,
    target: { kind: 'category', category: 'done' },
  },
];

/**
 * Parse a thread reply into a status target. Deliberately strict: the whole
 * message (minus an optional "status:" / "move to" prefix and punctuation)
 * must be the keyword, so ordinary conversation never moves tickets.
 */
export function parseStatusKeyword(raw: string): StatusTarget | null {
  const text = raw
    .toLowerCase()
    .replace(/^\s*(status\s*[:=-]?|move\s+to|set\s+to)\s*/i, '')
    .replace(/[.!?✅✔️👍\s]+$/gu, '')
    .trim();
  if (!text || text.length > 30) return null;
  for (const { re, target } of KEYWORDS) {
    if (re.test(text)) return target;
  }
  // Fall back to an exact column-name match (e.g. "review").
  if (/^[\w][\w\s-]{0,28}$/.test(text)) return { kind: 'name', name: text };
  return null;
}

export function resolveTargetColumn<
  C extends { id: string; name: string; category: string; position: number },
>(columns: C[], target: StatusTarget): C | null {
  const sorted = [...columns].sort((a, b) => a.position - b.position);
  if (target.kind === 'name') {
    return sorted.find((c) => c.name.toLowerCase() === target.name) ?? null;
  }
  return sorted.find((c) => c.category === target.category) ?? null;
}

// --------------------------------------------------------------------------
// Event handling
// --------------------------------------------------------------------------

async function alreadyHandled(eventId: string | undefined): Promise<boolean> {
  if (!eventId) return false;
  try {
    await prisma.slackEventDedup.create({ data: { eventId } });
    return false;
  } catch {
    return true; // unique violation → duplicate delivery
  }
}

/** Reporter for channel-created tickets: mapped member, else workspace admin. */
async function reporterFor(workspaceId: string, slackUserId: string) {
  const member = await resolveMember(workspaceId, slackUserId);
  if (member) return member;
  return prisma.workspaceMember.findFirst({
    where: { workspaceId, role: 'admin' },
    include: { user: true },
    orderBy: { joinedAt: 'asc' },
  });
}

export interface HandleResult {
  action: 'ignored' | 'ticket_created' | 'ticket_moved' | 'move_failed';
  ticketId?: string;
  detail?: string;
}

export async function handleSlackEvent(envelope: SlackEventEnvelope): Promise<HandleResult> {
  const event = envelope.event;
  if (envelope.type !== 'event_callback' || !event || event.type !== 'message') {
    return { action: 'ignored', detail: 'not a message event' };
  }
  // Only plain user messages: no bots (including our own replies), no edits,
  // joins, or other subtypes.
  if (event.bot_id || event.subtype || !event.user || !event.channel || !event.ts) {
    return { action: 'ignored', detail: 'bot/subtype/incomplete' };
  }
  const text = (event.text ?? '').trim();
  if (!text) return { action: 'ignored', detail: 'empty text' };

  if (await alreadyHandled(envelope.event_id)) {
    return { action: 'ignored', detail: 'duplicate delivery' };
  }

  const workspaceId = envelope.team_id ? await resolveWorkspaceForTeam(envelope.team_id) : null;
  if (!workspaceId) return { action: 'ignored', detail: 'unlinked team' };

  const isThreadReply = Boolean(event.thread_ts && event.thread_ts !== event.ts);
  return isThreadReply
    ? handleThreadReply(workspaceId, event as Required<Pick<SlackMessageEvent, 'user' | 'channel' | 'ts'>> & SlackMessageEvent, text)
    : handleChannelMessage(workspaceId, event as Required<Pick<SlackMessageEvent, 'user' | 'channel' | 'ts'>> & SlackMessageEvent, text);
}

async function handleChannelMessage(
  workspaceId: string,
  event: SlackMessageEvent & { user: string; channel: string; ts: string },
  text: string,
): Promise<HandleResult> {
  const link = await prisma.slackChannelLink.findUnique({
    where: { slackChannelId: event.channel },
  });
  if (!link || link.workspaceId !== workspaceId) {
    return { action: 'ignored', detail: 'channel not linked' };
  }

  const reporter = await reporterFor(workspaceId, event.user);
  if (!reporter) return { action: 'ignored', detail: 'no reporter resolvable' };

  const column = await prisma.workflowColumn.findFirst({
    where: { projectId: link.projectId, category: 'todo' },
    orderBy: { position: 'asc' },
  }) ?? await prisma.workflowColumn.findFirst({
    where: { projectId: link.projectId },
    orderBy: { position: 'asc' },
  });
  if (!column) return { action: 'ignored', detail: 'project has no columns' };

  const [firstLine, ...restLines] = text.split('\n');
  const title = firstLine.trim().slice(0, 200) || 'Untitled from Slack';
  const rest = restLines.join('\n').trim();

  const ticket = await createTicket({
    workspaceId,
    projectId: link.projectId,
    reporterId: reporter.userId,
    title,
    description: rest || undefined,
    statusColumnId: column.id,
  });
  await prisma.ticket.update({
    where: { id: ticket.id },
    data: { slackChannelId: event.channel, slackMessageTs: event.ts },
  });

  const project = await prisma.project.findUnique({
    where: { id: link.projectId },
    select: { key: true },
  });
  // Thread confirmation is best-effort — the ticket exists either way.
  void postToChannel(workspaceId, event.channel, {
    threadTs: event.ts,
    text: `🎫 Created *${project?.key}-${ticket.number}: ${title}* in *${column.name}*. Reply in this thread with \`todo\`, \`pending\`, \`in progress\`, or \`done\` to move it.`,
  });

  return { action: 'ticket_created', ticketId: ticket.id };
}

async function handleThreadReply(
  workspaceId: string,
  event: SlackMessageEvent & { user: string; channel: string; ts: string },
  text: string,
): Promise<HandleResult> {
  const ticket = await prisma.ticket.findFirst({
    where: { slackChannelId: event.channel, slackMessageTs: event.thread_ts },
    include: { statusColumn: true },
  });
  if (!ticket) return { action: 'ignored', detail: 'thread not tied to a ticket' };

  const target = parseStatusKeyword(text);
  if (!target) return { action: 'ignored', detail: 'no status keyword' };

  const columns = await prisma.workflowColumn.findMany({
    where: { projectId: ticket.projectId },
  });
  const column = resolveTargetColumn(columns, target);
  if (!column) {
    // A keyword-shaped reply that matches nothing actionable: stay silent
    // for free-text names, only report failures for the four core keywords.
    if (target.kind === 'category') {
      void postToChannel(workspaceId, event.channel, {
        threadTs: event.thread_ts,
        text: `⚠️ No "${target.category}" column in this project.`,
      });
      return { action: 'move_failed', ticketId: ticket.id };
    }
    return { action: 'ignored', detail: 'no matching column' };
  }
  if (column.id === ticket.statusColumnId) {
    return { action: 'ignored', detail: 'already in column' };
  }

  const actor = await reporterFor(workspaceId, event.user);
  if (!actor) return { action: 'ignored', detail: 'no actor resolvable' };

  try {
    await transitionTicket({
      ticketId: ticket.id,
      actorId: actor.userId,
      targetColumnId: column.id,
      actorRoleForBypass: actor.role as 'admin' | 'member',
    });
  } catch (err) {
    void postToChannel(workspaceId, event.channel, {
      threadTs: event.thread_ts,
      text: `⚠️ Could not move the ticket: ${err instanceof Error ? err.message : 'unknown error'}`,
    });
    return { action: 'move_failed', ticketId: ticket.id };
  }

  const project = await prisma.project.findUnique({
    where: { id: ticket.projectId },
    select: { key: true },
  });
  void postToChannel(workspaceId, event.channel, {
    threadTs: event.thread_ts,
    text: `🔀 Moved *${project?.key}-${ticket.number}* to *${column.name}*.`,
  });
  return { action: 'ticket_moved', ticketId: ticket.id };
}
