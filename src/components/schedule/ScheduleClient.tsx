'use client';

/**
 * Schedule — merged Google Calendar view (daily / weekly / monthly) across
 * every connected account, with per-account calendar selection.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import {
  mondayOfIsoWeek,
  periodLabel,
  shiftPeriodKey,
  type Cadence,
} from '@/lib/periods';

type View = 'daily' | 'weekly' | 'monthly';
const VIEWS: View[] = ['daily', 'weekly', 'monthly'];
const VIEW_LABELS: Record<View, string> = { daily: 'Day', weekly: 'Week', monthly: 'Month' };

interface EventDto {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  calendarName: string;
  accountEmail: string;
  color: string | null;
  link: string | null;
}

interface AccountDto {
  id: string;
  email: string;
  calendars: Array<{ id: string; summary: string; color: string | null; selected: boolean }>;
}

/** UTC [from, to) range covered by a period key. */
export function rangeForPeriod(view: View, key: string): { from: Date; to: Date } {
  if (view === 'daily') {
    const from = new Date(`${key}T00:00:00.000Z`);
    return { from, to: new Date(from.getTime() + 24 * 3600_000) };
  }
  if (view === 'weekly') {
    const [ys, ws] = key.split('-W');
    const from = mondayOfIsoWeek(Number(ys), Number(ws));
    return { from, to: new Date(from.getTime() + 7 * 24 * 3600_000) };
  }
  const [y, m] = key.split('-').map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
}

const dayKey = (iso: string) => iso.slice(0, 10);
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

interface Props {
  workspaceId: string;
  initialPeriods: Record<Cadence, string>;
  calError: string | null;
}

export function ScheduleClient({ workspaceId, initialPeriods, calError }: Props) {
  const qc = useQueryClient();
  const [view, setView] = useState<View>('weekly');
  const [periods, setPeriods] = useState<Record<View, string>>({
    daily: initialPeriods.daily,
    weekly: initialPeriods.weekly,
    monthly: initialPeriods.monthly,
  });
  const [showSettings, setShowSettings] = useState(false);

  const period = periods[view];
  const { from, to } = rangeForPeriod(view, period);

  const accountsQuery = useQuery<{ configured: boolean; accounts: AccountDto[] }>({
    queryKey: ['calendar-accounts'],
    queryFn: async () => {
      const res = await fetch('/api/v1/calendar/accounts', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load calendar accounts');
      return (await res.json()).data;
    },
  });
  const accounts = accountsQuery.data?.accounts ?? [];

  const eventsQuery = useQuery<EventDto[]>({
    queryKey: ['calendar-events', from.toISOString(), to.toISOString()],
    enabled: accounts.length > 0,
    queryFn: async () => {
      const res = await fetch(
        `/api/v1/calendar/events?from=${from.toISOString()}&to=${to.toISOString()}`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error('Failed to load events');
      return (await res.json()).data;
    },
    staleTime: 60_000,
  });
  const events = eventsQuery.data ?? [];

  const eventsByDay = useMemo(() => {
    const map = new Map<string, EventDto[]>();
    for (const e of events) {
      const k = dayKey(e.start);
      map.set(k, [...(map.get(k) ?? []), e]);
    }
    return map;
  }, [events]);

  const updateSelection = useMutation({
    mutationFn: async ({ accountId, ids }: { accountId: string; ids: string[] }) => {
      const res = await fetch(`/api/v1/calendar/accounts/${accountId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedCalendarIds: ids }),
      });
      if (!res.ok) throw new Error('Update failed');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar-accounts'] });
      qc.invalidateQueries({ queryKey: ['calendar-events'] });
    },
  });

  const disconnect = useMutation({
    mutationFn: async (accountId: string) => {
      const res = await fetch(`/api/v1/calendar/accounts/${accountId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Disconnect failed');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar-accounts'] });
      qc.invalidateQueries({ queryKey: ['calendar-events'] });
    },
  });

  const connectHref = `/api/v1/calendar/google/connect?wid=${workspaceId}`;

  const days = useMemo(() => {
    const list: string[] = [];
    for (let t = from.getTime(); t < to.getTime(); t += 24 * 3600_000) {
      list.push(new Date(t).toISOString().slice(0, 10));
    }
    return list;
  }, [from, to]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-bg-border px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold">Schedule</h1>
          <p className="text-xs text-text-muted">
            Your Google Calendars, merged — connect as many accounts as you like.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a className="btn btn-secondary text-xs" href={connectHref}>
            + Connect Google Calendar
          </a>
          {accounts.length > 0 ? (
            <button className="btn btn-ghost text-xs" onClick={() => setShowSettings((v) => !v)}>
              ⚙ Calendars
            </button>
          ) : null}
        </div>
      </header>

      {calError ? (
        <div className="border-b border-priority-urgent/30 bg-priority-urgent/10 px-6 py-2 text-xs text-priority-urgent">
          {calError}
        </div>
      ) : null}

      {showSettings ? (
        <div className="border-b border-bg-border bg-bg-surface px-6 py-3">
          {accounts.map((a) => (
            <div key={a.id} className="mb-3 last:mb-0">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold">{a.email}</span>
                <button
                  className="text-[11px] text-priority-urgent hover:underline"
                  onClick={() => disconnect.mutate(a.id)}
                >
                  disconnect
                </button>
              </div>
              <div className="mt-1 flex flex-wrap gap-2">
                {a.calendars.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-accent"
                      checked={c.selected}
                      onChange={() =>
                        updateSelection.mutate({
                          accountId: a.id,
                          ids: a.calendars
                            .filter((x) => (x.id === c.id ? !c.selected : x.selected))
                            .map((x) => x.id),
                        })
                      }
                    />
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: c.color ?? '#6366f1' }}
                    />
                    {c.summary}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-b border-bg-border px-6 py-2.5">
        <div className="flex rounded-md border border-bg-border p-0.5 text-xs" role="tablist">
          {VIEWS.map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              className={cn(
                'rounded px-3 py-1',
                view === v ? 'bg-accent/20 text-text-primary' : 'text-text-muted hover:text-text-primary',
              )}
              onClick={() => setView(v)}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-sm">
          <button
            className="btn btn-ghost px-2 py-0.5"
            aria-label="Previous"
            onClick={() => setPeriods((p) => ({ ...p, [view]: shiftPeriodKey(view, p[view], -1) }))}
          >
            ‹
          </button>
          <span className="min-w-[190px] text-center text-xs font-medium">
            {periodLabel(view, period)}
          </span>
          <button
            className="btn btn-ghost px-2 py-0.5"
            aria-label="Next"
            onClick={() => setPeriods((p) => ({ ...p, [view]: shiftPeriodKey(view, p[view], 1) }))}
          >
            ›
          </button>
          {period !== initialPeriods[view] ? (
            <button
              className="btn btn-ghost px-2 py-0.5 text-xs"
              onClick={() => setPeriods((p) => ({ ...p, [view]: initialPeriods[view] }))}
            >
              Today
            </button>
          ) : null}
        </div>
        {eventsQuery.isFetching ? <span className="text-xs text-text-muted">Loading…</span> : null}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {accounts.length === 0 ? (
          <div className="mx-auto max-w-md py-16 text-center">
            <div className="text-3xl">📅</div>
            <h2 className="mt-2 text-sm font-semibold">No calendars connected</h2>
            <p className="mt-1 text-xs text-text-muted">
              Connect one or more Google accounts to see your daily, weekly and monthly
              schedule alongside your tasks.
            </p>
            <a className="btn btn-primary mt-4 text-xs" href={connectHref}>
              Connect Google Calendar
            </a>
            {accountsQuery.data && !accountsQuery.data.configured ? (
              <p className="mt-3 text-[11px] text-priority-high">
                Google OAuth is not configured on this instance — see DEPLOYMENT.md Step 5b.
              </p>
            ) : null}
          </div>
        ) : view === 'monthly' ? (
          <MonthGrid days={days} eventsByDay={eventsByDay} />
        ) : (
          <div className={cn('grid gap-3', view === 'weekly' ? 'grid-cols-7' : 'mx-auto max-w-2xl grid-cols-1')}>
            {days.map((d) => (
              <DayColumn key={d} day={d} events={eventsByDay.get(d) ?? []} single={view === 'daily'} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EventChip({ event, compact }: { event: EventDto; compact?: boolean }) {
  const body = (
    <div
      className={cn(
        'rounded border-l-2 bg-bg-raised px-1.5 py-1 text-left',
        compact ? 'text-[10px]' : 'text-xs',
      )}
      style={{ borderLeftColor: event.color ?? '#6366f1' }}
      title={`${event.title} · ${event.calendarName} (${event.accountEmail})`}
    >
      <div className="truncate font-medium text-text-primary">{event.title}</div>
      {!compact ? (
        <div className="text-[10px] text-text-muted">
          {event.allDay ? 'All day' : `${fmtTime(event.start)} – ${fmtTime(event.end)}`} ·{' '}
          {event.calendarName}
        </div>
      ) : null}
    </div>
  );
  return event.link ? (
    <a href={event.link} target="_blank" rel="noreferrer" className="block hover:opacity-80">
      {body}
    </a>
  ) : (
    body
  );
}

function DayColumn({ day, events, single }: { day: string; events: EventDto[]; single: boolean }) {
  const date = new Date(`${day}T00:00:00Z`);
  const isToday = day === new Date().toISOString().slice(0, 10);
  const label = date.toLocaleDateString([], {
    weekday: single ? 'long' : 'short',
    day: 'numeric',
    month: single ? 'long' : undefined,
    timeZone: 'UTC',
  });
  return (
    <div className={cn('rounded-md border border-bg-border p-2', isToday && 'border-accent/50 bg-accent/5')}>
      <div className={cn('mb-2 text-xs font-semibold', isToday ? 'text-accent' : 'text-text-secondary')}>
        {label}
      </div>
      {events.length === 0 ? (
        <p className="text-[10px] text-text-muted">—</p>
      ) : (
        <div className="space-y-1">
          {events.map((e) => (
            <EventChip key={e.id} event={e} />
          ))}
        </div>
      )}
    </div>
  );
}

function MonthGrid({ days, eventsByDay }: { days: string[]; eventsByDay: Map<string, EventDto[]> }) {
  // Pad so the grid starts on Monday.
  const first = new Date(`${days[0]}T00:00:00Z`);
  const lead = (first.getUTCDay() + 6) % 7;
  const cells: Array<string | null> = [...Array(lead).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium uppercase text-text-muted">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((day, i) =>
          day === null ? (
            <div key={`pad-${i}`} className="min-h-[92px] rounded-md bg-bg-surface/40" />
          ) : (
            <div
              key={day}
              className={cn(
                'min-h-[92px] rounded-md border border-bg-border p-1',
                day === today && 'border-accent/50 bg-accent/5',
              )}
            >
              <div className={cn('text-[10px] font-semibold', day === today ? 'text-accent' : 'text-text-muted')}>
                {Number(day.slice(8, 10))}
              </div>
              <div className="mt-0.5 space-y-0.5">
                {(eventsByDay.get(day) ?? []).slice(0, 3).map((e) => (
                  <EventChip key={e.id} event={e} compact />
                ))}
                {(eventsByDay.get(day)?.length ?? 0) > 3 ? (
                  <div className="text-[9px] text-text-muted">
                    +{(eventsByDay.get(day)?.length ?? 0) - 3} more
                  </div>
                ) : null}
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
