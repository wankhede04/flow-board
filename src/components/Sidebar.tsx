'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { NotificationBell } from './NotificationBell';

interface SidebarProps {
  workspace: { id: string; name: string };
  projects: Array<{ id: string; key: string; name: string }>;
  user: { id: string; name: string; email: string };
}

export function Sidebar({ workspace, projects, user }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <aside className="flex w-64 flex-col border-r border-bg-border bg-bg-surface">
      <div className="px-4 py-4">
        <Link
          href={`/workspace/${workspace.id}`}
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/20 text-accent">
            ⚡
          </div>
          <div className="flex-1 truncate">{workspace.name}</div>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        <ul className="mb-3 space-y-0.5">
          {[
            { href: `/workspace/${workspace.id}/goals`, icon: '🎯', label: 'Goals' },
            { href: `/workspace/${workspace.id}/planner`, icon: '⏰', label: 'Planner' },
          ].map((item) => {
            const active = pathname?.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                    active
                      ? 'bg-accent/15 text-text-primary'
                      : 'text-text-secondary hover:bg-bg-raised hover:text-text-primary',
                  )}
                >
                  <span aria-hidden>{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wide text-text-muted">
          Projects
        </div>
        <ul className="space-y-0.5">
          {projects.length === 0 ? (
            <li className="px-2 py-1 text-xs text-text-muted">No projects yet.</li>
          ) : (
            projects.map((p) => {
              const href = `/workspace/${workspace.id}/projects/${p.id}`;
              const active = pathname?.startsWith(href);
              return (
                <li key={p.id}>
                  <Link
                    href={href}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                      active
                        ? 'bg-accent/15 text-text-primary'
                        : 'text-text-secondary hover:bg-bg-raised hover:text-text-primary',
                    )}
                  >
                    <span className="rounded bg-bg-border px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
                      {p.key}
                    </span>
                    <span className="truncate">{p.name}</span>
                  </Link>
                </li>
              );
            })
          )}
        </ul>
      </nav>

      <div className="border-t border-bg-border p-3">
        <div className="mb-2">
          <NotificationBell />
        </div>
        <div className="mb-2 text-xs">
          <div className="font-medium text-text-primary">{user.name}</div>
          <div className="truncate text-text-muted">{user.email}</div>
        </div>
        <button
          className="btn btn-secondary w-full text-xs"
          onClick={async () => {
            await fetch('/api/v1/auth/demo-login', { method: 'DELETE' });
            router.push('/');
            router.refresh();
          }}
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
