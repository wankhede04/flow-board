import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { Sidebar } from '@/components/Sidebar';

export const dynamic = 'force-dynamic';

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { wid: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/');

  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: params.wid, userId: user.id } },
    include: {
      workspace: true,
    },
  });
  if (!member) redirect('/');

  const projects = await prisma.project.findMany({
    where: { workspaceId: params.wid, archivedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, key: true, name: true },
  });

  return (
    <div className="flex h-screen w-full">
      <Sidebar
        workspace={{ id: member.workspace.id, name: member.workspace.name }}
        projects={projects}
        user={{ id: user.id, name: user.name, email: user.email }}
      />
      <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
