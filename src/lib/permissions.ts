/**
 * Centralized permission checks. See TechSpec §7.4.
 *
 * The spec calls for a PermissionService resolved via single SQL with joins
 * on workspace_members and project_members. We keep that shape here; in a
 * higher-traffic deployment this would be cached at request scope.
 */

import { prisma } from './db';
import { ApiError, ErrorCodes } from './errors';

type Role = 'admin' | 'member' | 'viewer' | 'guest';

export async function getProjectAccess(userId: string, projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, workspaceId: true },
  });
  if (!project) return null;

  const [pm, wm] = await Promise.all([
    prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { role: true },
    }),
    prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: project.workspaceId, userId } },
      select: { role: true },
    }),
  ]);

  return {
    project,
    projectRole: pm?.role as Role | undefined,
    workspaceRole: wm?.role as Role | undefined,
  };
}

export async function requireProjectAccess(
  userId: string,
  projectId: string,
  minimum: 'viewer' | 'member' | 'admin' = 'member',
) {
  const access = await getProjectAccess(userId, projectId);
  if (!access) {
    throw new ApiError(ErrorCodes.PROJECT_NOT_FOUND, 'Project not found');
  }
  const role = access.projectRole ?? access.workspaceRole;
  if (!role) {
    throw new ApiError(ErrorCodes.FORBIDDEN, 'No access to this project');
  }
  if (!roleSatisfies(role, minimum)) {
    throw new ApiError(ErrorCodes.FORBIDDEN, `Requires ${minimum} access`);
  }
  return access;
}

export async function requireWorkspaceMember(
  userId: string,
  workspaceId: string,
  minimum: 'viewer' | 'member' | 'admin' = 'member',
) {
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  });
  if (!member) {
    throw new ApiError(ErrorCodes.WORKSPACE_NOT_FOUND, 'Workspace not found');
  }
  if (!roleSatisfies(member.role as Role, minimum)) {
    throw new ApiError(ErrorCodes.FORBIDDEN, `Requires ${minimum} access`);
  }
  return member;
}

export function canBypassWipLimit(role: Role | undefined): boolean {
  return role === 'admin';
}

function roleSatisfies(actual: Role, minimum: 'viewer' | 'member' | 'admin'): boolean {
  const order: Record<string, number> = { guest: 0, viewer: 1, member: 2, admin: 3 };
  return (order[actual] ?? 0) >= (order[minimum] ?? 0);
}
