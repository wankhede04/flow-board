'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/cn';

interface ReminderDto {
  id: string;
  title: string;
  notes: string | null;
  remindAt: string;
  recurrence: 'none' | 'daily' | 'weekly' | 'monthly';
  status: 'pending' | 'sent' | 'done' | 'cancelled';
  ticket: {
    id: string;
    title: string;
    number: number;
    projectId: string;
    project: { key: string };
  } | null;
}

interface Props {
  workspaceId: string;
}

/** Default new-reminder time: one hour from now, in local datetime-local format. */
function defaultRemindAt(): string {
  const d = new Date(Date.now() + 60 * 60_000);
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PlannerClient({ workspaceId }: Props) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [at, setAt] = useState(defaultRemindAt);
  const [recurrence, setRecurrence] = useState('none');
  const [showClosed, setShowClosed] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAt, setEditAt] = useState('');

  const queryKey = ['reminders', workspaceId, showClosed];
  const { data: reminders = [], isLoading } = useQuery<ReminderDto[]>({
    queryKey,
    queryFn: async () => {
      const status = showClosed ? '' : '&status=open';
      const res = await fetch(`/api/v1/workspaces/${workspaceId}/reminders?limit=100${status}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('Failed to load reminders');
      return (await res.json()).data;
    },
    refetchInterval: 30_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['reminders', workspaceId] });

  const createReminder = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/v1/workspaces/${workspaceId}/reminders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          remindAt: new Date(at).toISOString(),
          recurrence,
        }),
      });
      if (!res.ok) throw new Error('Create failed');
    },
    onSuccess: () => {
      setTitle('');
      setAt(defaultRemindAt());
      setRecurrence('none');
      invalidate();
    },
  });

  const patchReminder = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const res = await fetch(`/api/v1/reminders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error('Update failed');
    },
    onSuccess: () => {
      setEditingId(null);
      invalidate();
    },
  });

  const deleteReminder = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/v1/reminders/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
    },
    onSuccess: invalidate,
  });

  const { overdue, today, upcoming, closed } = useMemo(() => {
    const now = Date.now();
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    const open = reminders.filter((r) => r.status === 'pending' || r.status === 'sent');
    return {
      overdue: open.filter((r) => new Date(r.remindAt).getTime() < now),
      today: open.filter((r) => {
        const t = new Date(r.remindAt).getTime();
        return t >= now && t <= endOfDay.getTime();
      }),
      upcoming: open.filter((r) => new Date(r.remindAt).getTime() > endOfDay.getTime()),
      closed: reminders.filter((r) => r.status === 'done' || r.status === 'cancelled'),
    };
  }, [reminders]);

  const renderReminder = (r: ReminderDto) => {
    const fired = r.status === 'sent' || new Date(r.remindAt).getTime() < Date.now();
    const isClosed = r.status === 'done' || r.status === 'cancelled';
    return (
      <li key={r.id} className={cn('card', isClosed && 'opacity-50')}>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-base" aria-hidden>
            {isClosed ? '✅' : fired ? '🔔' : '⏰'}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn('text-sm text-text-primary', r.status === 'done' && 'line-through')}>
                {r.title}
              </span>
              {r.recurrence !== 'none' ? (
                <span className="rounded-full bg-accent/15 px-1.5 py-px text-[9px] font-medium text-accent">
                  {r.recurrence}
                </span>
              ) : null}
              {r.status === 'sent' ? (
                <span className="rounded-full bg-priority-high/15 px-1.5 py-px text-[9px] font-medium text-priority-high">
                  fired
                </span>
              ) : null}
            </div>
            {r.notes ? <p className="mt-0.5 text-xs text-text-muted">{r.notes}</p> : null}
            {r.ticket ? (
              <a
                className="mt-0.5 block text-[11px] text-text-secondary hover:text-text-primary hover:underline"
                href={`/workspace/${workspaceId}/projects/${r.ticket.projectId}?ticket=${r.ticket.id}`}
              >
                🎫 {r.ticket.project.key}-{r.ticket.number} {r.ticket.title}
              </a>
            ) : null}
            {editingId === r.id ? (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="datetime-local"
                  className="input w-auto py-1 text-xs"
                  value={editAt}
                  onChange={(e) => setEditAt(e.target.value)}
                />
                <button
                  className="btn btn-primary px-2 py-0.5 text-xs"
                  disabled={!editAt}
                  onClick={() =>
                    patchReminder.mutate({
                      id: r.id,
                      patch: { remindAt: new Date(editAt).toISOString() },
                    })
                  }
                >
                  Save
                </button>
                <button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => setEditingId(null)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="mt-1 text-xs text-text-muted hover:text-text-primary hover:underline"
                title="Click to reschedule"
                onClick={() => {
                  setEditingId(r.id);
                  const d = new Date(r.remindAt);
                  const pad = (n: number) => String(n).padStart(2, '0');
                  setEditAt(
                    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
                  );
                }}
              >
                {new Date(r.remindAt).toLocaleString()} ✎
              </button>
            )}
          </div>
          {!isClosed ? (
            <div className="flex shrink-0 flex-col items-end gap-1">
              <div className="flex gap-1">
                {[15, 60, 24 * 60].map((mins) => (
                  <button
                    key={mins}
                    className="btn btn-secondary px-1.5 py-0.5 text-[10px]"
                    title={`Snooze ${mins < 60 ? `${mins}m` : mins === 60 ? '1h' : '1d'}`}
                    onClick={() => patchReminder.mutate({ id: r.id, patch: { snoozeMinutes: mins } })}
                  >
                    +{mins < 60 ? `${mins}m` : mins === 60 ? '1h' : '1d'}
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                <button
                  className="btn btn-secondary px-1.5 py-0.5 text-[10px]"
                  onClick={() => patchReminder.mutate({ id: r.id, patch: { status: 'done' } })}
                >
                  Done
                </button>
                <button
                  className="btn btn-ghost px-1.5 py-0.5 text-[10px]"
                  aria-label={`Delete "${r.title}"`}
                  onClick={() => deleteReminder.mutate(r.id)}
                >
                  ✕
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </li>
    );
  };

  const section = (label: string, items: ReminderDto[], tone?: string) =>
    items.length ? (
      <section className="mb-6">
        <h2 className={cn('label mb-2', tone)}>{label} ({items.length})</h2>
        <ul className="space-y-2">{items.map(renderReminder)}</ul>
      </section>
    ) : null;

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-bg-border px-6 py-3">
        <h1 className="text-lg font-semibold">Planner</h1>
        <p className="text-xs text-text-muted">
          Set time reminders to organise your work — snooze, reschedule or repeat them as plans change.
        </p>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto max-w-2xl">
          <div className="card mb-6">
            <h2 className="label mb-2">New reminder</h2>
            <div className="flex flex-wrap gap-2">
              <input
                className="input min-w-[200px] flex-1"
                placeholder="What should I remind you about?"
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && title.trim()) createReminder.mutate();
                }}
              />
              <input
                type="datetime-local"
                className="input w-auto"
                value={at}
                onChange={(e) => setAt(e.target.value)}
              />
              <select
                className="input w-32"
                value={recurrence}
                onChange={(e) => setRecurrence(e.target.value)}
              >
                <option value="none">Once</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
              <button
                className="btn btn-primary"
                disabled={!title.trim() || !at || createReminder.isPending}
                onClick={() => createReminder.mutate()}
              >
                {createReminder.isPending ? 'Adding…' : 'Add'}
              </button>
            </div>
          </div>

          {isLoading ? (
            <p className="py-8 text-center text-sm text-text-muted">Loading…</p>
          ) : reminders.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-muted">
              No reminders yet. Add one above, from a ticket, or via <code>/flowboard remind in 30m …</code> in Slack.
            </p>
          ) : (
            <>
              {section('Overdue / fired', overdue, 'text-priority-urgent')}
              {section('Today', today)}
              {section('Upcoming', upcoming)}
              {showClosed ? section('Completed & cancelled', closed) : null}
            </>
          )}

          <button
            className="btn btn-ghost mt-2 text-xs"
            onClick={() => setShowClosed((v) => !v)}
          >
            {showClosed ? 'Hide' : 'Show'} completed
          </button>
        </div>
      </div>
    </div>
  );
}
