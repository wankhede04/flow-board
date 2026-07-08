/**
 * Executes parsed /flowboard slash commands against the domain services and
 * shapes the ephemeral response Slack shows the user. Kept separate from
 * slack.ts so the parser/signature helpers stay dependency-light for tests.
 */

import { prisma } from './db';
import { ApiError } from './errors';
import { createTicket, transitionTicket } from './tickets';
import { createReminder } from './reminders';
import {
  parseSlashCommand,
  resolveMember,
  resolveWorkspaceForTeam,
  SLASH_HELP_TEXT,
} from './slack';

export interface SlashResponse {
  response_type: 'ephemeral' | 'in_channel';
  text: string;
}

const ephemeral = (text: string): SlashResponse => ({ response_type: 'ephemeral', text });

export function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

function ticketUrl(workspaceId: string, projectId: string, ticketId: string): string {
  return `${appBaseUrl()}/workspace/${workspaceId}/projects/${projectId}?ticket=${ticketId}`;
}

export async function executeSlashCommand(input: {
  teamId: string;
  slackUserId: string;
  text: string;
}): Promise<SlashResponse> {
  const workspaceId = await resolveWorkspaceForTeam(input.teamId);
  if (!workspaceId) {
    return ephemeral('This Slack workspace is not linked to a FlowBoard workspace yet. Ask an admin to connect it.');
  }
  const member = await resolveMember(workspaceId, input.slackUserId);
  if (!member) {
    return ephemeral('I could not match your Slack account to a FlowBoard user. Make sure your Slack email matches your FlowBoard email.');
  }

  const cmd = parseSlashCommand(input.text);
  try {
    switch (cmd.action) {
      case 'help':
        return ephemeral(SLASH_HELP_TEXT);
      case 'error':
        return ephemeral(`⚠️ ${cmd.message}`);

      case 'create': {
        const project = await pickProject(workspaceId, member.userId, cmd.projectKey);
        if (!project) {
          return ephemeral(
            cmd.projectKey
              ? `⚠️ No project with key \`${cmd.projectKey}\` in this workspace.`
              : '⚠️ You are not a member of any project. Create one in FlowBoard first.',
          );
        }
        const column = await prisma.workflowColumn.findFirst({
          where: { projectId: project.id, category: 'todo' },
          orderBy: { position: 'asc' },
        }) ?? await prisma.workflowColumn.findFirst({
          where: { projectId: project.id },
          orderBy: { position: 'asc' },
        });
        if (!column) return ephemeral(`⚠️ Project ${project.key} has no columns.`);

        const ticket = await createTicket({
          workspaceId,
          projectId: project.id,
          reporterId: member.userId,
          title: cmd.title,
          statusColumnId: column.id,
          priority: cmd.priority,
          context: cmd.context,
          dueDate: cmd.dueDate ? new Date(`${cmd.dueDate}T00:00:00.000Z`) : undefined,
        });
        return ephemeral(
          `✅ Created *${project.key}-${ticket.number}: ${ticket.title}* in *${column.name}*` +
            (cmd.context === 'personal' ? ' _(personal)_' : '') +
            `\n${ticketUrl(workspaceId, project.id, ticket.id)}`,
        );
      }

      case 'move': {
        const [key, numStr] = cmd.ticketKey.split('-');
        const project = await prisma.project.findUnique({
          where: { workspaceId_key: { workspaceId, key } },
        });
        if (!project) return ephemeral(`⚠️ No project with key \`${key}\`.`);
        const ticket = await prisma.ticket.findUnique({
          where: { projectId_number: { projectId: project.id, number: Number(numStr) } },
        });
        if (!ticket) return ephemeral(`⚠️ Ticket ${cmd.ticketKey} not found.`);

        const columns = await prisma.workflowColumn.findMany({ where: { projectId: project.id } });
        const wanted = cmd.targetColumn.toLowerCase();
        const target =
          columns.find((c) => c.name.toLowerCase() === wanted) ??
          columns.find((c) => c.name.toLowerCase().startsWith(wanted)) ??
          (wanted === 'done' ? columns.find((c) => c.category === 'done') : undefined);
        if (!target) {
          return ephemeral(`⚠️ No column matching "${cmd.targetColumn}". Columns: ${columns.map((c) => c.name).join(', ')}`);
        }

        const membership = await prisma.projectMember.findUnique({
          where: { projectId_userId: { projectId: project.id, userId: member.userId } },
        });
        await transitionTicket({
          ticketId: ticket.id,
          actorId: member.userId,
          targetColumnId: target.id,
          actorRoleForBypass: (membership?.role ?? member.role) as 'admin' | 'member' | 'viewer',
        });
        return ephemeral(`🔀 Moved *${cmd.ticketKey}* to *${target.name}*.`);
      }

      case 'list': {
        const tickets = await prisma.ticket.findMany({
          where: {
            workspaceId,
            archivedAt: null,
            statusColumn: { category: { not: 'done' } },
            ...(cmd.scope === 'me' ? { assignees: { some: { userId: member.userId } } } : {}),
          },
          orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
          take: 10,
          include: {
            project: { select: { key: true } },
            statusColumn: { select: { name: true } },
          },
        });
        if (tickets.length === 0) {
          return ephemeral(cmd.scope === 'me' ? '🎉 Nothing assigned to you — enjoy the calm.' : 'No open tickets.');
        }
        const lines = tickets.map(
          (t) => `• *${t.project.key}-${t.number}* ${t.title} — _${t.statusColumn.name}_ (${t.priority})`,
        );
        return ephemeral(`*Open tickets (${cmd.scope}):*\n${lines.join('\n')}`);
      }

      case 'remind': {
        const remindAt = new Date(Date.now() + cmd.inMinutes * 60_000);
        await createReminder({
          workspaceId,
          userId: member.userId,
          title: cmd.title,
          remindAt,
        });
        return ephemeral(`⏰ Reminder set for <!date^${Math.floor(remindAt.getTime() / 1000)}^{date_short_pretty} {time}|${remindAt.toISOString()}>: *${cmd.title}*`);
      }
    }
  } catch (err) {
    if (err instanceof ApiError) return ephemeral(`⚠️ ${err.message}`);
    // eslint-disable-next-line no-console
    console.error('[slack] command failed', err);
    return ephemeral('⚠️ Something went wrong executing that command.');
  }
}

async function pickProject(workspaceId: string, userId: string, key?: string) {
  if (key) {
    return prisma.project.findUnique({ where: { workspaceId_key: { workspaceId, key } } });
  }
  const link = await prisma.slackWorkspaceLink.findUnique({ where: { workspaceId } });
  if (link?.defaultProjectId) {
    const p = await prisma.project.findUnique({ where: { id: link.defaultProjectId } });
    if (p) return p;
  }
  return prisma.project.findFirst({
    where: { workspaceId, archivedAt: null, members: { some: { userId } } },
    orderBy: { createdAt: 'asc' },
  });
}
