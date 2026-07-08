'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import {
  CADENCES,
  periodLabel,
  shiftPeriodKey,
  type Cadence,
} from '@/lib/periods';

interface GoalDto {
  id: string;
  title: string;
  notes: string | null;
  cadence: Cadence;
  periodKey: string;
  context: 'personal' | 'professional';
  status: 'active' | 'completed' | 'dropped';
  tickets: Array<{
    ticketId: string;
    title: string;
    number: number;
    projectKey: string;
    projectId: string;
    done: boolean;
  }>;
  progress: { linked: number; done: number };
}

const CADENCE_LABELS: Record<Cadence, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

interface Props {
  workspaceId: string;
  initialPeriods: Record<Cadence, string>;
}

export function GoalsClient({ workspaceId, initialPeriods }: Props) {
  const qc = useQueryClient();
  const [cadence, setCadence] = useState<Cadence>('daily');
  const [periods, setPeriods] = useState(initialPeriods);
  const [contextFilter, setContextFilter] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newContext, setNewContext] = useState<'professional' | 'personal'>('professional');

  const period = periods[cadence];
  const isCurrentPeriod = period === initialPeriods[cadence];
  const queryKey = ['goals', workspaceId, cadence, period];

  const { data: goals = [], isLoading } = useQuery<GoalDto[]>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(
        `/api/v1/workspaces/${workspaceId}/goals?cadence=${cadence}&period=${encodeURIComponent(period)}`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error('Failed to load goals');
      return (await res.json()).data;
    },
    refetchInterval: 30_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['goals', workspaceId] });

  const createGoal = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/v1/workspaces/${workspaceId}/goals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle.trim(),
          cadence,
          periodKey: period,
          context: newContext,
        }),
      });
      if (!res.ok) throw new Error('Create failed');
    },
    onSuccess: () => {
      setNewTitle('');
      invalidate();
    },
  });

  const patchGoal = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const res = await fetch(`/api/v1/goals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error('Update failed');
    },
    onSuccess: invalidate,
  });

  const deleteGoal = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/v1/goals/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
    },
    onSuccess: invalidate,
  });

  const visible = useMemo(
    () => goals.filter((g) => !contextFilter || g.context === contextFilter),
    [goals, contextFilter],
  );
  const completed = visible.filter((g) => g.status === 'completed').length;

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-bg-border px-6 py-3">
        <h1 className="text-lg font-semibold">Goals</h1>
        <p className="text-xs text-text-muted">
          Plan your day, week, month and year — check goals off as you land them.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3 border-b border-bg-border px-6 py-2.5">
        <div className="flex rounded-md border border-bg-border p-0.5 text-xs" role="tablist">
          {CADENCES.map((c) => (
            <button
              key={c}
              role="tab"
              aria-selected={cadence === c}
              className={cn(
                'rounded px-3 py-1',
                cadence === c
                  ? 'bg-accent/20 text-text-primary'
                  : 'text-text-muted hover:text-text-primary',
              )}
              onClick={() => setCadence(c)}
            >
              {CADENCE_LABELS[c]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 text-sm">
          <button
            className="btn btn-ghost px-2 py-0.5"
            aria-label="Previous period"
            onClick={() => setPeriods((p) => ({ ...p, [cadence]: shiftPeriodKey(cadence, p[cadence], -1) }))}
          >
            ‹
          </button>
          <span className="min-w-[180px] text-center text-xs font-medium">
            {periodLabel(cadence, period)}
            {isCurrentPeriod ? <span className="ml-1.5 text-accent">• now</span> : null}
          </span>
          <button
            className="btn btn-ghost px-2 py-0.5"
            aria-label="Next period"
            onClick={() => setPeriods((p) => ({ ...p, [cadence]: shiftPeriodKey(cadence, p[cadence], 1) }))}
          >
            ›
          </button>
          {!isCurrentPeriod ? (
            <button
              className="btn btn-ghost px-2 py-0.5 text-xs"
              onClick={() => setPeriods((p) => ({ ...p, [cadence]: initialPeriods[cadence] }))}
            >
              Today
            </button>
          ) : null}
        </div>

        <div className="flex rounded-md border border-bg-border p-0.5 text-xs">
          {[
            { value: null, label: 'All' },
            { value: 'professional', label: 'Work' },
            { value: 'personal', label: 'Personal' },
          ].map((opt) => (
            <button
              key={opt.label}
              className={cn(
                'rounded px-2 py-0.5',
                contextFilter === opt.value
                  ? 'bg-accent/20 text-text-primary'
                  : 'text-text-muted hover:text-text-primary',
              )}
              onClick={() => setContextFilter(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <span className="ml-auto text-xs text-text-muted">
          {completed}/{visible.length} completed
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto max-w-2xl">
          <div className="mb-4 flex gap-2">
            <input
              className="input flex-1"
              placeholder={`Add a ${cadence} goal…`}
              value={newTitle}
              maxLength={200}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newTitle.trim()) createGoal.mutate();
              }}
            />
            <select
              className="input w-36"
              value={newContext}
              onChange={(e) => setNewContext(e.target.value as 'professional' | 'personal')}
            >
              <option value="professional">Professional</option>
              <option value="personal">Personal</option>
            </select>
            <button
              className="btn btn-primary"
              disabled={!newTitle.trim() || createGoal.isPending}
              onClick={() => createGoal.mutate()}
            >
              Add
            </button>
          </div>

          {isLoading ? (
            <p className="py-8 text-center text-sm text-text-muted">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-muted">
              No {contextFilter ?? ''} goals for this {cadence === 'daily' ? 'day' : cadence.replace('ly', '')}.
              Add one above.
            </p>
          ) : (
            <ul className="space-y-2">
              {visible.map((g) => (
                <li key={g.id} className={cn('card', g.status === 'completed' && 'opacity-60')}>
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 accent-accent"
                      checked={g.status === 'completed'}
                      aria-label={`Mark "${g.title}" ${g.status === 'completed' ? 'active' : 'completed'}`}
                      onChange={() =>
                        patchGoal.mutate({
                          id: g.id,
                          patch: { status: g.status === 'completed' ? 'active' : 'completed' },
                        })
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'text-sm text-text-primary',
                            g.status === 'completed' && 'line-through',
                          )}
                        >
                          {g.title}
                        </span>
                        {g.context === 'personal' ? (
                          <span className="rounded-full bg-teal-500/15 px-1.5 py-px text-[9px] font-medium text-teal-400">
                            personal
                          </span>
                        ) : null}
                      </div>
                      {g.notes ? (
                        <p className="mt-0.5 text-xs text-text-muted">{g.notes}</p>
                      ) : null}
                      {g.progress.linked > 0 ? (
                        <div className="mt-2">
                          <div className="flex items-center justify-between text-[10px] text-text-muted">
                            <span>
                              {g.progress.done}/{g.progress.linked} linked tickets done
                            </span>
                          </div>
                          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-bg-border">
                            <div
                              className="h-full rounded-full bg-accent transition-all"
                              style={{ width: `${(g.progress.done / g.progress.linked) * 100}%` }}
                            />
                          </div>
                          <ul className="mt-1.5 space-y-0.5">
                            {g.tickets.map((t) => (
                              <li key={t.ticketId} className="text-[11px] text-text-secondary">
                                <a
                                  className="hover:text-text-primary hover:underline"
                                  href={`/workspace/${workspaceId}/projects/${t.projectId}?ticket=${t.ticketId}`}
                                >
                                  {t.done ? '✅' : '◻️'} {t.projectKey}-{t.number} {t.title}
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                    <button
                      className="btn btn-ghost px-2 py-0.5 text-xs"
                      title="Delete goal"
                      aria-label={`Delete "${g.title}"`}
                      onClick={() => deleteGoal.mutate(g.id)}
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
