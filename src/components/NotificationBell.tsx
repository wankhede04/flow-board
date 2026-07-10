'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/cn';

interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string | null;
  linkUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

export function NotificationBell({ compact = false }: { compact?: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data } = useQuery<{ items: NotificationDto[]; unread: number }>({
    queryKey: ['notifications'],
    queryFn: async () => {
      const res = await fetch('/api/v1/notifications', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load notifications');
      return (await res.json()).data;
    },
    refetchInterval: 20_000,
  });

  const unread = data?.unread ?? 0;

  const markRead = async (id: string) => {
    await fetch('/api/v1/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  return (
    <div className="relative">
      <button
        className={
          compact
            ? 'btn btn-ghost relative w-full justify-center text-sm'
            : 'btn btn-ghost relative w-full justify-start text-sm'
        }
        onClick={() => setOpen((v) => !v)}
        title="Notifications"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
      >
        🔔{compact ? '' : ' Notifications'}
        {unread > 0 ? (
          <span
            className={
              compact
                ? 'absolute -right-0.5 -top-0.5 rounded-full bg-accent px-1 py-px text-[9px] font-semibold text-white'
                : 'absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-accent px-1.5 py-px text-[10px] font-semibold text-white'
            }
          >
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute bottom-full left-0 z-40 mb-1 max-h-96 w-80 overflow-y-auto rounded-lg border border-bg-border bg-bg-surface p-2 shadow-cardHover">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-xs font-semibold">Notifications</span>
            {unread > 0 ? (
              <button className="text-[11px] text-accent hover:underline" onClick={() => markRead('all')}>
                Mark all read
              </button>
            ) : null}
          </div>
          {!data?.items.length ? (
            <p className="px-1 py-4 text-center text-xs text-text-muted">Nothing yet.</p>
          ) : (
            <ul className="space-y-1">
              {data.items.map((n) => (
                <li key={n.id}>
                  <a
                    href={n.linkUrl ?? '#'}
                    className={cn(
                      'block rounded-md px-2 py-1.5 hover:bg-bg-raised',
                      !n.readAt && 'bg-accent/5',
                    )}
                    onClick={() => markRead(n.id)}
                  >
                    <div className="flex items-start gap-1.5">
                      {!n.readAt ? (
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                      ) : (
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-xs text-text-primary">{n.title}</p>
                        {n.body ? <p className="mt-0.5 text-[11px] text-text-muted">{n.body}</p> : null}
                        <p className="mt-0.5 text-[10px] text-text-muted">
                          {new Date(n.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
