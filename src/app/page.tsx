import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { DemoLoginButton } from '@/components/DemoLoginButton';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const user = await getCurrentUser();
  if (user) {
    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: user.id },
      orderBy: { joinedAt: 'asc' },
    });
    if (membership) redirect(`/workspace/${membership.workspaceId}`);
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="w-full max-w-lg space-y-6 text-center">
        <div className="space-y-2">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/20 text-2xl font-bold text-accent">
            ⚡
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">FlowBoard</h1>
          <p className="text-text-secondary">
            A Slack-native Kanban tracker. Drag tickets, hit WIP limits, ship work.
          </p>
        </div>
        <div className="card space-y-4 text-left">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Demo access</h2>
            <p className="mt-1 text-xs text-text-secondary">
              Sign in below. On a fresh deployment the first sign-in creates the demo
              user and a starter workspace automatically; local dev can also seed a
              full sample board with <code className="rounded bg-bg-surface px-1">pnpm db:seed</code>.
            </p>
          </div>
          <DemoLoginButton />
          <div className="text-xs text-text-muted">
            Or hit the API directly:{' '}
            <code className="rounded bg-bg-surface px-1 py-0.5">POST /api/v1/auth/demo-login</code>
          </div>
        </div>
        <div className="text-xs text-text-muted">
          <Link className="hover:text-text-secondary" href="/api/healthz">
            healthz
          </Link>
          {' · '}
          <Link className="hover:text-text-secondary" href="/api/readyz">
            readyz
          </Link>
        </div>
      </div>
    </main>
  );
}
