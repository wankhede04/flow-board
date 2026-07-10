import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { configuredProviders } from '@/lib/oauth';
import { DemoLoginButton } from '@/components/DemoLoginButton';
import { OAuthButtons } from '@/components/OAuthButtons';

export const dynamic = 'force-dynamic';

export default async function HomePage({
  searchParams,
}: {
  searchParams?: { auth_error?: string };
}) {
  const user = await getCurrentUser();
  if (user) {
    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: user.id },
      orderBy: { joinedAt: 'asc' },
    });
    if (membership) redirect(`/workspace/${membership.workspaceId}`);
  }

  const providers = configuredProviders();
  const authError = searchParams?.auth_error;

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
          {authError ? (
            <p className="rounded-md border border-priority-urgent/30 bg-priority-urgent/10 px-3 py-2 text-xs text-priority-urgent">
              {authError}
            </p>
          ) : null}
          {providers.length > 0 ? (
            <>
              <div>
                <h2 className="text-sm font-semibold text-text-primary">Sign in</h2>
                <p className="mt-1 text-xs text-text-secondary">
                  Your first sign-in creates a workspace for you automatically.
                </p>
              </div>
              <OAuthButtons providers={providers} />
              <div className="flex items-center gap-3 text-[10px] uppercase tracking-wide text-text-muted">
                <span className="h-px flex-1 bg-bg-border" />
                or
                <span className="h-px flex-1 bg-bg-border" />
              </div>
            </>
          ) : (
            <div>
              <h2 className="text-sm font-semibold text-text-primary">Demo access</h2>
              <p className="mt-1 text-xs text-text-secondary">
                Sign in below. On a fresh deployment the first sign-in creates the demo
                user and a starter workspace automatically; local dev can also seed a
                full sample board with <code className="rounded bg-bg-surface px-1">pnpm db:seed</code>.
              </p>
            </div>
          )}
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
