/**
 * Demo seed — TechSpec §19.3.
 *
 * Creates: 1 workspace, 1 project, 4 columns, 3 users, ~30 tickets
 * spread across columns and assignees, sample labels and comments.
 *
 * Idempotent: re-running upserts the workspace/users and clears tickets.
 */

import { PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';
import { generateNKeysBetween } from 'fractional-indexing';
import { currentPeriodKeys } from '../src/lib/periods';

const prisma = new PrismaClient();

const id = (prefix: string) => `${prefix}_${ulid()}`;

async function main() {
  const seedEmail = process.env.SEED_USER_EMAIL ?? 'demo@flowboard.app';
  const seedName = process.env.SEED_USER_NAME ?? 'Demo User';

  // Reset just the demo workspace's data so re-runs are deterministic.
  const existing = await prisma.workspace.findUnique({ where: { slug: 'demo' } });
  if (existing) {
    await prisma.workspace.delete({ where: { id: existing.id } });
  }

  const wsId = id('wsp');
  const workspace = await prisma.workspace.create({
    data: {
      id: wsId,
      name: 'Demo Workspace',
      slug: 'demo',
      plan: 'pro',
    },
  });

  const users = await Promise.all(
    [
      { email: seedEmail, name: seedName },
      { email: 'priya@flowboard.app', name: 'Priya Shah' },
      { email: 'marcus@flowboard.app', name: 'Marcus Allen' },
      { email: 'lena@flowboard.app', name: 'Lena Park' },
    ].map((u) =>
      prisma.user.upsert({
        where: { email: u.email },
        update: { name: u.name },
        create: { id: id('usr'), email: u.email, name: u.name, timezone: 'America/Los_Angeles' },
      }),
    ),
  );

  const [demoUser, priya, marcus, lena] = users;

  await prisma.workspaceMember.createMany({
    data: users.map((u, i) => ({
      workspaceId: wsId,
      userId: u.id,
      role: i === 0 ? 'admin' : 'member',
    })),
  });

  const projectId = id('prj');
  await prisma.project.create({
    data: {
      id: projectId,
      workspaceId: wsId,
      key: 'FB',
      name: 'FlowBoard MVP',
      description: 'Build the v1 of the Slack-native Kanban tracker per TechSpec.',
    },
  });
  await prisma.projectMember.createMany({
    data: users.map((u, i) => ({
      projectId,
      userId: u.id,
      role: i === 0 ? 'admin' : 'member',
    })),
  });

  const columnDefs: Array<{
    name: string;
    category: 'todo' | 'in_progress' | 'done';
    wipLimit: number | null;
  }> = [
    { name: 'Backlog', category: 'todo', wipLimit: null },
    { name: 'In Progress', category: 'in_progress', wipLimit: 5 },
    { name: 'Review', category: 'in_progress', wipLimit: 3 },
    { name: 'Done', category: 'done', wipLimit: null },
  ];
  const columns = await Promise.all(
    columnDefs.map((c, i) =>
      prisma.workflowColumn.create({
        data: {
          id: id('col'),
          projectId,
          name: c.name,
          category: c.category,
          position: i,
          wipLimit: c.wipLimit,
        },
      }),
    ),
  );

  const labelDefs = [
    { name: 'bug', color: '#ef4444' },
    { name: 'feature', color: '#6366f1' },
    { name: 'infra', color: '#14b8a6' },
    { name: 'docs', color: '#a78bfa' },
    { name: 'spike', color: '#f59e0b' },
  ];
  const labels = await Promise.all(
    labelDefs.map((l) =>
      prisma.label.create({
        data: { id: id('lbl'), projectId, name: l.name, color: l.color },
      }),
    ),
  );

  const ticketTitles: Array<{
    col: number;
    title: string;
    priority: string;
    labels?: string[];
    context?: 'personal' | 'professional';
  }> = [
    { col: 0, title: 'Set up monorepo and tooling', priority: 'high', labels: ['infra'] },
    { col: 0, title: 'Spike: evaluate dnd-kit vs alternatives', priority: 'medium', labels: ['spike'] },
    { col: 0, title: 'Define Postgres schema & migrations', priority: 'high', labels: ['infra'] },
    { col: 0, title: 'Slack OAuth install flow', priority: 'medium', labels: ['feature'] },
    { col: 0, title: 'Notification preferences UI', priority: 'low', labels: ['feature'] },
    { col: 0, title: 'Document API contract in OpenAPI', priority: 'medium', labels: ['docs'] },
    { col: 0, title: 'Saved filters + smart views', priority: 'low', labels: ['feature'] },
    { col: 0, title: 'Email magic-link auth', priority: 'medium', labels: ['feature'] },
    { col: 0, title: 'Quiet hours scheduling', priority: 'low', labels: ['feature'] },
    { col: 0, title: 'Audit log retention policy', priority: 'lowest', labels: ['infra'] },
    { col: 1, title: 'Implement ticket transition + WIP limits', priority: 'urgent', labels: ['feature'] },
    { col: 1, title: 'Fractional indexing helper + tests', priority: 'high', labels: ['feature'] },
    { col: 1, title: 'Board snapshot endpoint optimization', priority: 'high', labels: ['feature'] },
    { col: 1, title: 'Optimistic locking on ticket PATCH', priority: 'high', labels: ['feature'] },
    { col: 2, title: 'Code review: comment threads', priority: 'medium', labels: ['feature'] },
    { col: 2, title: 'QA: drag-and-drop edge cases', priority: 'high', labels: ['bug'] },
    { col: 3, title: 'Init Prisma + SQLite local dev', priority: 'medium', labels: ['infra'] },
    { col: 3, title: 'Tailwind theme + design tokens', priority: 'low', labels: ['feature'] },
    { col: 3, title: 'Health & readiness endpoints', priority: 'lowest', labels: ['infra'] },
    { col: 3, title: 'Workspace + project scaffolding', priority: 'medium', labels: ['feature'] },
    // Personal-context tasks — exercised by the board's Personal/Professional filter.
    { col: 0, title: 'Book dentist appointment', priority: 'medium', context: 'personal' },
    { col: 0, title: 'Renew passport', priority: 'high', context: 'personal' },
    { col: 1, title: 'Plan weekend hiking trip', priority: 'low', context: 'personal' },
    { col: 3, title: 'File tax return', priority: 'urgent', context: 'personal' },
  ];

  const ranksPerColumn: Record<string, string[]> = {};
  for (let i = 0; i < columns.length; i++) {
    const ticketsInCol = ticketTitles.filter((t) => t.col === i).length;
    ranksPerColumn[columns[i].id] = generateNKeysBetween(null, null, Math.max(ticketsInCol, 1));
  }

  const labelByName = new Map(labels.map((l) => [l.name, l]));
  const colCounters: Record<string, number> = {};

  let seq = 0;
  for (const t of ticketTitles) {
    seq += 1;
    const col = columns[t.col];
    colCounters[col.id] = (colCounters[col.id] ?? 0);
    const rank = ranksPerColumn[col.id][colCounters[col.id]];
    colCounters[col.id]++;

    const ticketId = id('tkt');
    const assignees = pickAssignees(seq, [priya.id, marcus.id, lena.id, demoUser.id]);
    const dueDate = pickDueDate(seq);

    await prisma.ticket.create({
      data: {
        id: ticketId,
        workspaceId: wsId,
        projectId,
        number: seq,
        title: t.title,
        description: `Detailed work for **${t.title}**.\n\nSee TechSpec for context.`,
        statusColumnId: col.id,
        priority: t.priority,
        context: t.context ?? 'professional',
        reporterId: demoUser.id,
        rank,
        dueDate,
      },
    });

    await prisma.ticketAssignee.createMany({
      data: assignees.map((userId) => ({ ticketId, userId })),
    });
    await prisma.ticketWatcher.createMany({
      data: [demoUser.id, ...assignees]
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .map((userId) => ({ ticketId, userId })),
    });

    if (t.labels?.length) {
      await prisma.ticketLabel.createMany({
        data: t.labels
          .map((n) => labelByName.get(n))
          .filter((l): l is NonNullable<typeof l> => !!l)
          .map((l) => ({ ticketId, labelId: l.id })),
      });
    }

    await prisma.activityEvent.create({
      data: {
        id: id('evt'),
        ticketId,
        actorId: demoUser.id,
        eventType: 'ticket_created',
        payload: JSON.stringify({ title: t.title }),
      },
    });

    if (seq % 4 === 0) {
      await prisma.comment.create({
        data: {
          id: id('cmt'),
          ticketId,
          authorId: assignees[0] ?? demoUser.id,
          body: 'Started looking at this — first pass coming today.',
        },
      });
      await prisma.activityEvent.create({
        data: {
          id: id('evt'),
          ticketId,
          actorId: assignees[0] ?? demoUser.id,
          eventType: 'comment_added',
          payload: JSON.stringify({}),
        },
      });
    }
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { ticketSeq: seq },
  });

  // --- Goals: one per cadence for the demo user, in the current periods ---
  const keys = currentPeriodKeys(new Date(), 'America/Los_Angeles');
  const firstTickets = await prisma.ticket.findMany({
    where: { projectId, context: 'professional' },
    orderBy: { number: 'asc' },
    take: 3,
    select: { id: true },
  });
  const goalDefs = [
    { cadence: 'daily', title: 'Clear review queue before standup', context: 'professional' },
    { cadence: 'daily', title: '30 minutes of exercise', context: 'personal' },
    { cadence: 'weekly', title: 'Ship the board snapshot optimization', context: 'professional', tickets: firstTickets.slice(0, 2) },
    { cadence: 'weekly', title: 'Cook at home 4 nights', context: 'personal' },
    { cadence: 'monthly', title: 'Land Slack integration end-to-end', context: 'professional', tickets: firstTickets.slice(2) },
    { cadence: 'yearly', title: 'Mentor two junior engineers', context: 'professional' },
    { cadence: 'yearly', title: 'Run a half marathon', context: 'personal' },
  ] as const;
  let goalPos = 0;
  for (const g of goalDefs) {
    const goalId = id('gol');
    await prisma.goal.create({
      data: {
        id: goalId,
        workspaceId: wsId,
        ownerId: demoUser.id,
        title: g.title,
        cadence: g.cadence,
        periodKey: keys[g.cadence],
        context: g.context,
        position: goalPos++,
      },
    });
    if ('tickets' in g && g.tickets?.length) {
      await prisma.goalTicket.createMany({
        data: g.tickets.map((t) => ({ goalId, ticketId: t.id })),
      });
    }
  }

  // --- Reminders: one due imminently (scheduler demo), two planned ahead ---
  const anyTicket = await prisma.ticket.findFirst({
    where: { projectId },
    orderBy: { number: 'asc' },
    select: { id: true },
  });
  const inMinutes = (m: number) => new Date(Date.now() + m * 60_000);
  await prisma.reminder.createMany({
    data: [
      {
        id: id('rem'),
        workspaceId: wsId,
        userId: demoUser.id,
        title: 'Prep notes for standup',
        remindAt: inMinutes(2),
      },
      {
        id: id('rem'),
        workspaceId: wsId,
        userId: demoUser.id,
        title: 'Review open PRs',
        notes: 'Check the FlowBoard MVP review column first.',
        ticketId: anyTicket?.id ?? null,
        remindAt: inMinutes(120),
        recurrence: 'daily',
      },
      {
        id: id('rem'),
        workspaceId: wsId,
        userId: demoUser.id,
        title: 'Weekly planning session',
        remindAt: inMinutes(60 * 24),
        recurrence: 'weekly',
      },
    ],
  });

  console.log(`Seeded workspace ${workspace.slug} with ${seq} tickets, ${goalDefs.length} goals, 3 reminders.`);
  console.log(`Sign in as: ${seedEmail}`);
}

function pickAssignees(seed: number, pool: string[]): string[] {
  if (seed % 5 === 0) return [];
  if (seed % 3 === 0) return [pool[seed % pool.length], pool[(seed + 1) % pool.length]];
  return [pool[seed % pool.length]];
}

function pickDueDate(seed: number): Date | null {
  if (seed % 3 === 0) return null;
  const offset = ((seed * 7) % 21) - 5; // -5..15 days from today
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(0, 0, 0, 0);
  return d;
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    return prisma.$disconnect().finally(() => process.exit(1));
  });
