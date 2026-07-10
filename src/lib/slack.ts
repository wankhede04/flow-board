/**
 * Slack integration (TechSpec §9, adapted to the single-service build).
 *
 * Inbound:  signed webhooks — slash commands (/flowboard …), interactive
 *           button clicks, and the Events API URL-verification handshake.
 * Outbound: chat.postMessage / conversations.open via the Slack Web API,
 *           used for reminder DMs and ticket-move notifications.
 *
 * Configuration (single-tenant self-hosted):
 *   SLACK_SIGNING_SECRET — verifies inbound requests (§9.5)
 *   SLACK_BOT_TOKEN      — xoxb- token used for outbound calls; when unset
 *                          every outbound call is a silent no-op, so the app
 *                          is fully functional without Slack.
 * A workspace is bound to a Slack team either by env (first workspace) or a
 * SlackWorkspaceLink row; members map via workspace_members.slack_user_id.
 */

// Bare specifier (not `node:crypto`): the instrumentation bundle's webpack
// pass in Next 14 does not resolve the `node:` URI scheme.
import { createHmac, timingSafeEqual } from 'crypto';
import { prisma } from './db';
import { newId } from './ids';
import { PRIORITIES, type Priority } from './tickets';

// --------------------------------------------------------------------------
// §9.5 Signature verification
// --------------------------------------------------------------------------

export const SLACK_REPLAY_WINDOW_SECONDS = 300;

export function computeSlackSignature(signingSecret: string, timestamp: string, rawBody: string): string {
  const hmac = createHmac('sha256', signingSecret);
  hmac.update(`v0:${timestamp}:${rawBody}`);
  return `v0=${hmac.digest('hex')}`;
}

export function verifySlackSignature(input: {
  signingSecret: string;
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
  nowMs?: number;
}): boolean {
  const { signingSecret, timestamp, signature, rawBody } = input;
  if (!signingSecret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const nowSec = (input.nowMs ?? Date.now()) / 1000;
  if (Math.abs(nowSec - ts) > SLACK_REPLAY_WINDOW_SECONDS) return false; // replay attack

  const expected = Buffer.from(computeSlackSignature(signingSecret, timestamp, rawBody));
  const given = Buffer.from(signature);
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

// --------------------------------------------------------------------------
// Slash-command grammar
// --------------------------------------------------------------------------
//
//   /flowboard create <title> [in <PROJECT_KEY>] [p:<priority>] [due:YYYY-MM-DD] [ctx:personal]
//   /flowboard move <KEY-123> to <column name>
//   /flowboard list [me|all]
//   /flowboard remind <in 30m | in 2h | in 1d | tomorrow> <title…>
//   /flowboard help

export type SlashCommand =
  | {
      action: 'create';
      title: string;
      projectKey?: string;
      priority?: Priority;
      dueDate?: string; // YYYY-MM-DD
      context?: 'personal' | 'professional';
    }
  | { action: 'move'; ticketKey: string; targetColumn: string }
  | { action: 'list'; scope: 'me' | 'all' }
  | { action: 'remind'; inMinutes: number; title: string }
  | { action: 'link'; projectKey?: string }
  | { action: 'unlink' }
  | { action: 'help' }
  | { action: 'error'; message: string };

const DURATION_RE = /^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i;

export function parseDuration(text: string): number | null {
  const m = text.trim().match(DURATION_RE);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (unit.startsWith('m')) return n;
  if (unit.startsWith('h')) return n * 60;
  return n * 60 * 24;
}

export function parseSlashCommand(raw: string): SlashCommand {
  const text = raw.trim();
  if (!text || /^help$/i.test(text)) return { action: 'help' };

  const [verb, ...restParts] = text.split(/\s+/);
  const rest = restParts.join(' ');

  switch (verb.toLowerCase()) {
    case 'create': {
      if (!rest) return { action: 'error', message: 'Usage: `/flowboard create <title> [in KEY] [p:high] [due:2026-12-31] [ctx:personal]`' };
      let title = rest;
      const out: Extract<SlashCommand, { action: 'create' }> = { action: 'create', title: '' };

      const inMatch = title.match(/\s+in\s+([A-Za-z][A-Za-z0-9]{1,9})\s*$/i) ?? title.match(/\s+in\s+([A-Za-z][A-Za-z0-9]{1,9})(?=\s)/i);
      if (inMatch) {
        out.projectKey = inMatch[1].toUpperCase();
        title = title.replace(inMatch[0], ' ');
      }
      const pMatch = title.match(/\bp:(\w+)\b/i);
      if (pMatch) {
        const p = pMatch[1].toLowerCase();
        if (!PRIORITIES.includes(p as Priority)) {
          return { action: 'error', message: `Unknown priority "${p}". Use one of: ${PRIORITIES.join(', ')}` };
        }
        out.priority = p as Priority;
        title = title.replace(pMatch[0], ' ');
      }
      const dueMatch = title.match(/\bdue:(\d{4}-\d{2}-\d{2})\b/i);
      if (dueMatch) {
        out.dueDate = dueMatch[1];
        title = title.replace(dueMatch[0], ' ');
      }
      const ctxMatch = title.match(/\bctx:(personal|professional)\b/i);
      if (ctxMatch) {
        out.context = ctxMatch[1].toLowerCase() as 'personal' | 'professional';
        title = title.replace(ctxMatch[0], ' ');
      }
      out.title = title.replace(/\s{2,}/g, ' ').trim();
      if (!out.title) return { action: 'error', message: 'The ticket needs a title.' };
      return out;
    }

    case 'move': {
      const m = rest.match(/^([A-Za-z][A-Za-z0-9]{1,9}-\d+)\s+to\s+(.+)$/i);
      if (!m) return { action: 'error', message: 'Usage: `/flowboard move FB-12 to Done`' };
      return { action: 'move', ticketKey: m[1].toUpperCase(), targetColumn: m[2].trim() };
    }

    case 'list': {
      const scope = /^all$/i.test(rest.trim()) ? 'all' : 'me';
      return { action: 'list', scope };
    }

    case 'link': {
      const key = rest.trim();
      if (key && !/^[A-Za-z][A-Za-z0-9]{1,9}$/.test(key)) {
        return { action: 'error', message: 'Usage: `/flowboard link [PROJECT_KEY]` (run inside the channel to link)' };
      }
      return { action: 'link', projectKey: key ? key.toUpperCase() : undefined };
    }

    case 'unlink':
      return { action: 'unlink' };

    case 'remind': {
      let m = rest.match(/^in\s+(\S+(?:\s+\S+)?)\s+(.+)$/i);
      if (m) {
        // try two-token duration ("30 m") then single-token ("30m")
        const twoTok = parseDuration(m[1]);
        if (twoTok != null) return { action: 'remind', inMinutes: twoTok, title: m[2].trim() };
        m = rest.match(/^in\s+(\S+)\s+(.+)$/i);
        const oneTok = m ? parseDuration(m[1]) : null;
        if (m && oneTok != null) return { action: 'remind', inMinutes: oneTok, title: m[2].trim() };
        return { action: 'error', message: 'Usage: `/flowboard remind in 30m <title>` (units: m, h, d)' };
      }
      const tomorrow = rest.match(/^tomorrow\s+(.+)$/i);
      if (tomorrow) return { action: 'remind', inMinutes: 24 * 60, title: tomorrow[1].trim() };
      return { action: 'error', message: 'Usage: `/flowboard remind in 30m <title>` or `/flowboard remind tomorrow <title>`' };
    }

    default:
      return { action: 'error', message: `Unknown command "${verb}". Try \`/flowboard help\`.` };
  }
}

export const SLASH_HELP_TEXT = [
  '*FlowBoard commands*',
  '• `/flowboard create <title> [in KEY] [p:high] [due:2026-12-31] [ctx:personal]` — create a ticket',
  '• `/flowboard move FB-12 to Done` — move a ticket to a column',
  '• `/flowboard list [me|all]` — your open tickets (or all)',
  '• `/flowboard remind in 30m <title>` — set a reminder (units m/h/d, or `tomorrow`)',
  '• `/flowboard link [KEY]` — link *this channel* to a project: messages here become tickets, and due/stale/reminder notifications post here',
  '• `/flowboard unlink` — unlink this channel',
  '• `/flowboard help` — this message',
].join('\n');

// --------------------------------------------------------------------------
// Workspace ↔ Slack team resolution
// --------------------------------------------------------------------------

export interface SlackContext {
  workspaceId: string;
  botToken: string | null;
}

/**
 * Resolve the FlowBoard workspace for a Slack team_id. Creates a
 * SlackWorkspaceLink lazily on first contact: if exactly one workspace
 * exists (self-hosted single-tenant), it is bound automatically.
 */
export async function resolveWorkspaceForTeam(teamId: string): Promise<string | null> {
  const link = await prisma.slackWorkspaceLink.findUnique({ where: { slackTeamId: teamId } });
  if (link) return link.workspaceId;

  const bySlackTeam = await prisma.workspace.findUnique({ where: { slackTeamId: teamId } });
  if (bySlackTeam) {
    await ensureLink(bySlackTeam.id, teamId);
    return bySlackTeam.id;
  }

  const workspaces = await prisma.workspace.findMany({ select: { id: true }, take: 2 });
  if (workspaces.length === 1) {
    await ensureLink(workspaces[0].id, teamId);
    return workspaces[0].id;
  }
  return null;
}

async function ensureLink(workspaceId: string, teamId: string) {
  await prisma.slackWorkspaceLink.upsert({
    where: { workspaceId },
    update: { slackTeamId: teamId },
    create: { id: newId('slk'), workspaceId, slackTeamId: teamId },
  });
}

export async function getBotToken(workspaceId: string): Promise<string | null> {
  const link = await prisma.slackWorkspaceLink.findUnique({ where: { workspaceId } });
  return link?.botToken || process.env.SLACK_BOT_TOKEN || null;
}

/**
 * Map an inbound Slack user to a FlowBoard user in the workspace.
 * Prefers the stored slack_user_id mapping; falls back to matching the
 * Slack profile email against workspace members (and stores the mapping).
 */
export async function resolveMember(workspaceId: string, slackUserId: string) {
  const mapped = await prisma.workspaceMember.findFirst({
    where: { workspaceId, slackUserId },
    include: { user: true },
  });
  if (mapped) return mapped;

  const token = await getBotToken(workspaceId);
  if (token) {
    const info = await slackApi('users.info', token, { user: slackUserId });
    const email = (info?.user as { profile?: { email?: string } } | undefined)?.profile?.email;
    if (email) {
      const byEmail = await prisma.workspaceMember.findFirst({
        where: { workspaceId, user: { email } },
        include: { user: true },
      });
      if (byEmail) {
        await prisma.workspaceMember.update({
          where: { workspaceId_userId: { workspaceId, userId: byEmail.userId } },
          data: { slackUserId },
        });
        return byEmail;
      }
    }
  }

  // Deterministic demo/dev fallback: map to the workspace admin so the
  // integration is exercisable without a users:read.email scope.
  if (process.env.SLACK_MAP_UNKNOWN_TO_ADMIN === 'true') {
    const admin = await prisma.workspaceMember.findFirst({
      where: { workspaceId, role: 'admin' },
      include: { user: true },
      orderBy: { joinedAt: 'asc' },
    });
    if (admin) {
      await prisma.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId, userId: admin.userId } },
        data: { slackUserId },
      });
      return admin;
    }
  }
  return null;
}

// --------------------------------------------------------------------------
// Slack Web API client (outbound)
// --------------------------------------------------------------------------

export async function slackApi(
  method: string,
  token: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!json.ok) {
      // eslint-disable-next-line no-console
      console.error(`[slack] ${method} failed:`, json.error);
      return null;
    }
    return json;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[slack] ${method} network error:`, err);
    return null;
  }
}

/**
 * DM a FlowBoard user on Slack. Silent no-op (returns false) when Slack is
 * not configured or the user has no Slack mapping — callers never need to
 * guard on configuration.
 */
export async function sendSlackDm(
  workspaceId: string,
  userId: string,
  message: { text: string; blocks?: unknown[] },
): Promise<boolean> {
  const token = await getBotToken(workspaceId);
  if (!token) return false;

  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
  if (!member?.slackUserId) return false;

  const open = await slackApi('conversations.open', token, { users: member.slackUserId });
  const channelId = (open?.channel as { id?: string } | undefined)?.id;
  if (!channelId) return false;

  const posted = await slackApi('chat.postMessage', token, {
    channel: channelId,
    text: message.text,
    ...(message.blocks ? { blocks: message.blocks } : {}),
  });
  return posted != null;
}

/** Post a message to a channel (optionally into a thread). Best-effort. */
export async function postToChannel(
  workspaceId: string,
  channelId: string,
  message: { text: string; threadTs?: string; blocks?: unknown[] },
): Promise<boolean> {
  const token = await getBotToken(workspaceId);
  if (!token) return false;
  const posted = await slackApi('chat.postMessage', token, {
    channel: channelId,
    text: message.text,
    ...(message.threadTs ? { thread_ts: message.threadTs } : {}),
    ...(message.blocks ? { blocks: message.blocks } : {}),
  });
  return posted != null;
}

/**
 * The channel to notify for a project: its linked channel if one exists,
 * else the workspace's default channel (set on first `/flowboard link`).
 */
export async function channelForProject(
  workspaceId: string,
  projectId: string | null,
): Promise<string | null> {
  if (projectId) {
    const link = await prisma.slackChannelLink.findFirst({ where: { projectId } });
    if (link) return link.slackChannelId;
  }
  const ws = await prisma.slackWorkspaceLink.findUnique({ where: { workspaceId } });
  return ws?.defaultChannelId ?? null;
}

/** Post to the project's linked channel (workspace default as fallback). */
export async function postToProjectChannel(
  workspaceId: string,
  projectId: string | null,
  text: string,
): Promise<boolean> {
  const channelId = await channelForProject(workspaceId, projectId);
  if (!channelId) return false;
  return postToChannel(workspaceId, channelId, { text });
}

/** Slack mention for a user when their Slack ID is mapped, else their name. */
export async function slackMention(workspaceId: string, userId: string): Promise<string> {
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    include: { user: { select: { name: true } } },
  });
  if (member?.slackUserId) return `<@${member.slackUserId}>`;
  return member?.user.name ?? 'someone';
}

/**
 * Best-effort Slack fan-out when a ticket changes status: DMs the reporter
 * and assignees (minus the actor). Called outside the DB transaction.
 */
export async function notifyTicketMoved(input: {
  ticketId: string;
  actorId: string;
  fromColumnId: string;
  toColumnId: string;
}) {
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: input.ticketId },
      include: {
        project: { select: { key: true } },
        assignees: { select: { userId: true } },
      },
    });
    if (!ticket) return;
    const [from, to, actor] = await Promise.all([
      prisma.workflowColumn.findUnique({ where: { id: input.fromColumnId }, select: { name: true } }),
      prisma.workflowColumn.findUnique({ where: { id: input.toColumnId }, select: { name: true } }),
      prisma.user.findUnique({ where: { id: input.actorId }, select: { name: true } }),
    ]);
    const recipients = new Set<string>([ticket.reporterId, ...ticket.assignees.map((a) => a.userId)]);
    recipients.delete(input.actorId);
    const text = `🔀 *[${ticket.project.key}-${ticket.number}] ${ticket.title}* moved from *${from?.name ?? '?'}* to *${to?.name ?? '?'}* by ${actor?.name ?? 'someone'}.`;
    await Promise.all([...recipients].map((uid) => sendSlackDm(ticket.workspaceId, uid, { text })));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[slack] notifyTicketMoved failed', err);
  }
}
