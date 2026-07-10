'use client';

/**
 * App navigation. Three display modes:
 *   - Desktop expanded (default, 16rem)
 *   - Desktop collapsed — icon rail toggled by the ‹/› button, persisted in
 *     localStorage
 *   - Mobile — hidden behind a floating ☰ button, opens as an overlay drawer
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { NotificationBell } from './NotificationBell';
import { CreateProjectModal } from './CreateProjectModal';

interface SidebarProps {
  workspace: { id: string; name: string };
  projects: Array<{ id: string; key: string; name: string }>;
  user: { id: string; name: string; email: string };
}

const COLLAPSE_KEY = 'fb_sidebar_collapsed';

export function Sidebar({ workspace, projects, user }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((v) => {
      localStorage.setItem(COLLAPSE_KEY, v ? '0' : '1');
      return !v;
    });
  };

  // Close the mobile drawer whenever navigation happens.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const tools = [
    { href: `/workspace/${workspace.id}/goals`, icon: '🎯', label: 'Goals' },
    { href: `/workspace/${workspace.id}/planner`, icon: '⏰', label: 'Planner' },
    { href: `/workspace/${workspace.id}/schedule`, icon: '📅', label: 'Schedule' },
  ];

  const nav = (
    <>
      <div className={cn('flex items-center gap-1 px-3 py-4', collapsed && 'flex-col px-2')}>
        <Link
          href={`/workspace/${workspace.id}`}
          className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold"
          title={workspace.name}
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent/20 text-accent">
            ⚡
          </div>
          {!collapsed ? <div className="flex-1 truncate">{workspace.name}</div> : null}
        </Link>
        <button
          className="btn btn-ghost hidden px-1.5 py-0.5 text-xs md:inline-flex"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '»' : '«'}
        </button>
        <button
          className="btn btn-ghost px-1.5 py-0.5 text-xs md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
        >
          ✕
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        <ul className="mb-3 space-y-0.5">
          {tools.map((item) => {
            const active = pathname?.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  title={item.label}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                    collapsed && 'justify-center px-0',
                    active
                      ? 'bg-accent/15 text-text-primary'
                      : 'text-text-secondary hover:bg-bg-raised hover:text-text-primary',
                  )}
                >
                  <span aria-hidden>{item.icon}</span>
                  {!collapsed ? <span>{item.label}</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className={cn('mb-1 flex items-center justify-between px-2', collapsed && 'justify-center px-0')}>
          {!collapsed ? (
            <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
              Projects
            </span>
          ) : null}
          <button
            className="rounded px-1 text-sm leading-none text-text-muted hover:bg-bg-raised hover:text-text-primary"
            onClick={() => setCreating(true)}
            aria-label="New project"
            title="New project"
          >
            ＋
          </button>
        </div>
        <ul className="space-y-0.5">
          {projects.length === 0 ? (
            !collapsed ? <li className="px-2 py-1 text-xs text-text-muted">No projects yet.</li> : null
          ) : (
            projects.map((p) => {
              const href = `/workspace/${workspace.id}/projects/${p.id}`;
              const active = pathname?.startsWith(href);
              return (
                <li key={p.id}>
                  <Link
                    href={href}
                    title={p.name}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                      collapsed && 'justify-center px-0',
                      active
                        ? 'bg-accent/15 text-text-primary'
                        : 'text-text-secondary hover:bg-bg-raised hover:text-text-primary',
                    )}
                  >
                    <span className="rounded bg-bg-border px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
                      {p.key}
                    </span>
                    {!collapsed ? <span className="truncate">{p.name}</span> : null}
                  </Link>
                </li>
              );
            })
          )}
        </ul>
      </nav>

      <div className={cn('border-t border-bg-border p-3', collapsed && 'p-2')}>
        <div className="mb-2">
          <NotificationBell compact={collapsed} />
        </div>
        {!collapsed ? (
          <div className="mb-2 text-xs">
            <div className="font-medium text-text-primary">{user.name}</div>
            <div className="truncate text-text-muted">{user.email}</div>
          </div>
        ) : null}
        <button
          className={cn('btn btn-secondary w-full text-xs', collapsed && 'px-0')}
          title="Sign out"
          onClick={async () => {
            await fetch('/api/v1/auth/demo-login', { method: 'DELETE' });
            router.push('/');
            router.refresh();
          }}
        >
          {collapsed ? '⎋' : 'Sign out'}
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile: floating opener */}
      {!mobileOpen ? (
        <button
          className="fixed left-3 top-3 z-40 rounded-md border border-bg-border bg-bg-surface px-2.5 py-1.5 text-sm shadow-card md:hidden"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
        >
          ☰
        </button>
      ) : null}

      {/* Mobile: backdrop */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setMobileOpen(false)} />
      ) : null}

      <aside
        className={cn(
          'z-50 flex h-full flex-col border-r border-bg-border bg-bg-surface transition-transform',
          // Mobile: overlay drawer
          'fixed inset-y-0 left-0 w-64',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          // Desktop: static column, collapsible width
          'md:static md:translate-x-0',
          collapsed ? 'md:w-16' : 'md:w-64',
        )}
      >
        {nav}
      </aside>

      {creating ? (
        <CreateProjectModal workspaceId={workspace.id} onClose={() => setCreating(false)} />
      ) : null}
    </>
  );
}
