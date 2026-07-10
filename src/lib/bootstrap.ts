/**
 * First-boot bootstrap for self-hosted deploys.
 *
 * The production image does not bundle the dev seed script, so a fresh
 * volume starts with an empty database and demo-login would dead-end with
 * "No demo user found". Instead, the very first sign-in provisions the
 * demo user plus a ready-to-use workspace: one project with a standard
 * four-column workflow and starter labels.
 *
 * Deliberately guarded to run ONLY when the instance has no users at all —
 * once anyone exists, unknown emails are rejected as before, so an
 * in-use instance never self-provisions extra accounts.
 */

import { prisma } from './db';
import { newId } from './ids';

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Provision a starter workspace (project TASK, four-column workflow,
 * starter labels) owned by an existing user. Reused by first-boot
 * bootstrap and by OAuth sign-up for brand-new users.
 */
export async function provisionStarterWorkspace(
  tx: Tx,
  userId: string,
  opts?: { workspaceName?: string; slug?: string },
) {
  const workspaceId = newId('wsp');
  await tx.workspace.create({
    data: {
      id: workspaceId,
      name: opts?.workspaceName ?? 'My Workspace',
      slug: opts?.slug ?? 'my-workspace',
    },
  });
  await tx.workspaceMember.create({
    data: { workspaceId, userId, role: 'admin' },
  });

  const projectId = newId('prj');
  await tx.project.create({
    data: {
      id: projectId,
      workspaceId,
      key: 'TASK',
      name: 'My Tasks',
      description: 'Personal and professional tasks — rename or add projects any time.',
    },
  });
  await tx.projectMember.create({
    data: { projectId, userId, role: 'admin' },
  });

  const columns: Array<{ name: string; category: string; wipLimit: number | null }> = [
    { name: 'Backlog', category: 'todo', wipLimit: null },
    { name: 'In Progress', category: 'in_progress', wipLimit: 5 },
    { name: 'Review', category: 'in_progress', wipLimit: 3 },
    { name: 'Done', category: 'done', wipLimit: null },
  ];
  for (let i = 0; i < columns.length; i++) {
    await tx.workflowColumn.create({
      data: {
        id: newId('col'),
        projectId,
        name: columns[i].name,
        category: columns[i].category,
        position: i,
        wipLimit: columns[i].wipLimit,
      },
    });
  }

  const labels = [
    { name: 'urgent', color: '#ef4444' },
    { name: 'feature', color: '#6366f1' },
    { name: 'chore', color: '#14b8a6' },
  ];
  for (const l of labels) {
    await tx.label.create({
      data: { id: newId('lbl'), projectId, name: l.name, color: l.color },
    });
  }

  return workspaceId;
}

export async function bootstrapFirstUser(email: string, name: string) {
  const userCount = await prisma.user.count();
  if (userCount > 0) return null;

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { id: newId('usr'), email, name },
    });
    await provisionStarterWorkspace(tx, user.id);
    return user;
  });
}
