/**
 * Tests for the channel-driven ticket flow: status-keyword grammar (pure)
 * and handleSlackEvent against a hermetic SQLite DB — channel message →
 * ticket, thread reply → move, dedupe, and ignore rules.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';

let prisma: PrismaClient;
let tmpDir: string;
let dbUrl: string;

const id = (prefix: string) => `${prefix}_${ulid()}`;

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'fb-chan-test-'));
  dbUrl = `file:${path.join(tmpDir, 'test.db')}`;
  process.env.DATABASE_URL = dbUrl;
  delete process.env.SLACK_BOT_TOKEN; // outbound confirmations become no-ops
  execSync('npx prisma db push --skip-generate', {
    env: { ...process.env, DATABASE_URL: dbUrl },
    cwd: process.cwd(),
    stdio: 'pipe',
  });
  prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
  await prisma.slackEventDedup.deleteMany();
  // No FK to Workspace — must be cleared explicitly between fixtures.
  await prisma.slackChannelLink.deleteMany();
});

async function loadHandler() {
  process.env.DATABASE_URL = dbUrl;
  return import('./slack-channel');
}

interface Fixture {
  workspaceId: string;
  projectId: string;
  userId: string;
  columns: Array<{ id: string; name: string; category: string; position: number }>;
}

const TEAM = 'T_CHAN_TEST';
const CHANNEL = 'C_FLOWBOARD';

async function buildFixture(): Promise<Fixture> {
  const wsId = id('wsp');
  const userId = id('usr');
  const projectId = id('prj');
  await prisma.workspace.create({ data: { id: wsId, name: 'Test', slug: `t-${ulid()}` } });
  await prisma.user.create({ data: { id: userId, email: `u-${ulid()}@x.test`, name: 'Tester' } });
  await prisma.workspaceMember.create({
    data: { workspaceId: wsId, userId, role: 'admin', slackUserId: 'U_POSTER' },
  });
  await prisma.project.create({ data: { id: projectId, workspaceId: wsId, key: 'FB', name: 'Board' } });
  await prisma.projectMember.create({ data: { projectId, userId, role: 'admin' } });
  const columns = await Promise.all(
    [
      { name: 'Backlog', category: 'todo' },
      { name: 'In Progress', category: 'in_progress' },
      { name: 'Review', category: 'in_progress' },
      { name: 'Done', category: 'done' },
    ].map((c, i) =>
      prisma.workflowColumn.create({
        data: { id: id('col'), projectId, name: c.name, category: c.category, position: i },
      }),
    ),
  );
  await prisma.slackWorkspaceLink.create({
    data: { id: id('slk'), workspaceId: wsId, slackTeamId: TEAM },
  });
  await prisma.slackChannelLink.create({
    data: { id: id('scl'), workspaceId: wsId, projectId, slackChannelId: CHANNEL },
  });
  return { workspaceId: wsId, projectId, userId, columns };
}

function messageEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'event_callback',
    event_id: `Ev${ulid()}`,
    team_id: TEAM,
    event: {
      type: 'message',
      user: 'U_POSTER',
      channel: CHANNEL,
      ts: `${Date.now() / 1000}`,
      text: 'Fix the login redirect loop\nHappens on Safari only.',
      ...overrides,
    },
  };
}

describe('parseStatusKeyword', () => {
  it('maps the four requested keywords (and synonyms) to categories', async () => {
    const { parseStatusKeyword } = await loadHandler();
    expect(parseStatusKeyword('todo')).toEqual({ kind: 'category', category: 'todo' });
    expect(parseStatusKeyword('Pending')).toEqual({ kind: 'category', category: 'todo' });
    expect(parseStatusKeyword('in progress')).toEqual({ kind: 'category', category: 'in_progress' });
    expect(parseStatusKeyword('IN-PROGRESS')).toEqual({ kind: 'category', category: 'in_progress' });
    expect(parseStatusKeyword('wip')).toEqual({ kind: 'category', category: 'in_progress' });
    expect(parseStatusKeyword('done')).toEqual({ kind: 'category', category: 'done' });
    expect(parseStatusKeyword('completed!')).toEqual({ kind: 'category', category: 'done' });
    expect(parseStatusKeyword('status: done')).toEqual({ kind: 'category', category: 'done' });
    expect(parseStatusKeyword('move to done')).toEqual({ kind: 'category', category: 'done' });
  });

  it('falls back to a column-name match and rejects conversation', async () => {
    const { parseStatusKeyword } = await loadHandler();
    expect(parseStatusKeyword('review')).toEqual({ kind: 'name', name: 'review' });
    expect(parseStatusKeyword('I think this is basically done but needs another look from Priya')).toBeNull();
    expect(parseStatusKeyword('')).toBeNull();
  });
});

describe('handleSlackEvent — channel message → ticket', () => {
  it('creates a ticket in the first todo column and records the thread mapping', async () => {
    const fx = await buildFixture();
    const { handleSlackEvent } = await loadHandler();
    const envelope = messageEvent();

    const result = await handleSlackEvent(envelope);
    expect(result.action).toBe('ticket_created');

    const ticket = await prisma.ticket.findFirst({ where: { projectId: fx.projectId } });
    expect(ticket?.title).toBe('Fix the login redirect loop');
    expect(ticket?.description).toBe('Happens on Safari only.');
    expect(ticket?.statusColumnId).toBe(fx.columns[0].id);
    expect(ticket?.slackChannelId).toBe(CHANNEL);
    expect(ticket?.slackMessageTs).toBe(envelope.event.ts);
    expect(ticket?.reporterId).toBe(fx.userId);
  });

  it('dedupes retried deliveries by event_id', async () => {
    const fx = await buildFixture();
    const { handleSlackEvent } = await loadHandler();
    const envelope = messageEvent();
    expect((await handleSlackEvent(envelope)).action).toBe('ticket_created');
    expect((await handleSlackEvent(envelope)).action).toBe('ignored');
    expect(await prisma.ticket.count({ where: { projectId: fx.projectId } })).toBe(1);
  });

  it('ignores bot messages, subtypes, and unlinked channels', async () => {
    await buildFixture();
    const { handleSlackEvent } = await loadHandler();
    expect((await handleSlackEvent(messageEvent({ bot_id: 'B123' }))).action).toBe('ignored');
    expect((await handleSlackEvent(messageEvent({ subtype: 'message_changed' }))).action).toBe('ignored');
    expect((await handleSlackEvent(messageEvent({ channel: 'C_OTHER' }))).action).toBe('ignored');
    expect(await prisma.ticket.count()).toBe(0);
  });
});

describe('handleSlackEvent — thread status replies', () => {
  async function createViaChannel(fx: Fixture) {
    const { handleSlackEvent } = await loadHandler();
    const envelope = messageEvent();
    await handleSlackEvent(envelope);
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { projectId: fx.projectId } });
    return { rootTs: envelope.event.ts as string, ticket };
  }

  function threadReply(rootTs: string, text: string) {
    return messageEvent({ text, thread_ts: rootTs, ts: `${Date.now() / 1000 + 1}` });
  }

  it('moves the ticket through in progress → done from thread replies', async () => {
    const fx = await buildFixture();
    const { handleSlackEvent } = await loadHandler();
    const { rootTs, ticket } = await createViaChannel(fx);

    expect((await handleSlackEvent(threadReply(rootTs, 'in progress'))).action).toBe('ticket_moved');
    let fresh = await prisma.ticket.findUnique({ where: { id: ticket.id } });
    expect(fresh?.statusColumnId).toBe(fx.columns[1].id);

    expect((await handleSlackEvent(threadReply(rootTs, 'done'))).action).toBe('ticket_moved');
    fresh = await prisma.ticket.findUnique({ where: { id: ticket.id } });
    expect(fresh?.statusColumnId).toBe(fx.columns[3].id);
  });

  it('matches an exact column name like "review"', async () => {
    const fx = await buildFixture();
    const { handleSlackEvent } = await loadHandler();
    const { rootTs, ticket } = await createViaChannel(fx);
    expect((await handleSlackEvent(threadReply(rootTs, 'review'))).action).toBe('ticket_moved');
    const fresh = await prisma.ticket.findUnique({ where: { id: ticket.id } });
    expect(fresh?.statusColumnId).toBe(fx.columns[2].id);
  });

  it('ignores ordinary conversation and unrelated threads', async () => {
    const fx = await buildFixture();
    const { handleSlackEvent } = await loadHandler();
    const { rootTs, ticket } = await createViaChannel(fx);

    expect((await handleSlackEvent(threadReply(rootTs, 'thanks, will look tomorrow'))).action).toBe('ignored');
    expect(
      (await handleSlackEvent(messageEvent({ text: 'done', thread_ts: '999.999', ts: '1000.0' }))).action,
    ).toBe('ignored');
    const fresh = await prisma.ticket.findUnique({ where: { id: ticket.id } });
    expect(fresh?.statusColumnId).toBe(fx.columns[0].id); // unmoved
  });
});
