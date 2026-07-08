'use client';

import type { LabelDef, Member, Priority } from './types';

export interface Filters {
  assignee: string | null;
  priority: string | null;
  label: string | null;
  context: string | null; // personal|professional
  q: string;
}

interface Props {
  filters: Filters;
  onChange: (f: Filters) => void;
  members: Member[];
  labels: LabelDef[];
  currentUserId: string;
}

const PRIORITIES: Priority[] = ['urgent', 'high', 'medium', 'low', 'lowest'];

export function BoardFilters({ filters, onChange, members, labels, currentUserId }: Props) {
  const update = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const hasActive =
    filters.assignee || filters.priority || filters.label || filters.context || filters.q;

  return (
    <div className="flex items-center gap-2">
      <div className="flex rounded-md border border-bg-border p-0.5 text-xs" role="group" aria-label="Task context">
        {[
          { value: null, label: 'All' },
          { value: 'professional', label: 'Work' },
          { value: 'personal', label: 'Personal' },
        ].map((opt) => (
          <button
            key={opt.label}
            className={
              'rounded px-2 py-0.5 ' +
              (filters.context === opt.value
                ? 'bg-accent/20 text-text-primary'
                : 'text-text-muted hover:text-text-primary')
            }
            onClick={() => update({ context: opt.value })}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <input
        className="input w-48 py-1 text-xs"
        placeholder="Search title…"
        value={filters.q}
        onChange={(e) => update({ q: e.target.value })}
      />
      <select
        className="input w-32 py-1 text-xs"
        value={filters.assignee ?? ''}
        onChange={(e) => update({ assignee: e.target.value || null })}
      >
        <option value="">All assignees</option>
        <option value={currentUserId}>Me</option>
        {members
          .filter((m) => m.id !== currentUserId)
          .map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
      </select>
      <select
        className="input w-32 py-1 text-xs"
        value={filters.priority ?? ''}
        onChange={(e) => update({ priority: e.target.value || null })}
      >
        <option value="">Any priority</option>
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <select
        className="input w-32 py-1 text-xs"
        value={filters.label ?? ''}
        onChange={(e) => update({ label: e.target.value || null })}
      >
        <option value="">Any label</option>
        {labels.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      {hasActive ? (
        <button
          className="btn btn-ghost text-xs"
          onClick={() => onChange({ assignee: null, priority: null, label: null, context: null, q: '' })}
        >
          Reset
        </button>
      ) : null}
    </div>
  );
}
