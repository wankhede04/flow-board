'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Avatar } from './Avatar';
import { PriorityBadge } from './PriorityBadge';
import { cn } from '@/lib/cn';
import type { LabelDef, Member, Priority } from './types';

interface TicketDetail {
  id: string;
  workspaceId: string;
  number: number;
  title: string;
  description: string | null;
  priority: Priority;
  context: 'personal' | 'professional';
  statusColumn: { id: string; name: string };
  dueDate: string | null;
  estimate: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  reporter: { id: string; name: string; avatarUrl: string | null };
  project: { id: string; key: string; name: string };
  assignees: Array<{ id: string; name: string; avatarUrl: string | null }>;
  labels: LabelDef[];
  comments: Array<{
    id: string;
    body: string;
    createdAt: string;
    editedAt: string | null;
    author: { id: string; name: string; avatarUrl: string | null };
  }>;
  activity: Array<{
    id: string;
    type: string;
    createdAt: string;
    actor: { id: string; name: string } | null;
    payload: Record<string, unknown>;
  }>;
}

interface Props {
  ticketId: string | null;
  onClose: () => void;
  members: Member[];
  labels: LabelDef[];
  onChanged: () => void;
}

export function TicketDrawer({ ticketId, onClose, members, labels, onChanged }: Props) {
  const qc = useQueryClient();
  const queryKey = ['ticket', ticketId];

  const { data, isLoading, error, refetch } = useQuery<TicketDetail>({
    queryKey,
    enabled: !!ticketId,
    queryFn: async () => {
      const res = await fetch(`/api/v1/tickets/${ticketId}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load ticket');
      const j = await res.json();
      return j.data;
    },
  });

  useEffect(() => {
    if (!ticketId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [ticketId, onClose]);

  if (!ticketId) return null;

  return (
    <div className="fixed inset-0 z-20 flex" role="dialog" aria-modal>
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <aside className="flex h-full w-full max-w-xl flex-col border-l border-bg-border bg-bg-surface">
        {isLoading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-text-muted">
            Loading…
          </div>
        ) : error ? (
          <div className="flex flex-1 items-center justify-center text-sm text-priority-urgent">
            {error instanceof Error ? error.message : 'Error'}
          </div>
        ) : data ? (
          <DrawerContents
            ticket={data}
            members={members}
            labels={labels}
            onClose={onClose}
            onChanged={() => {
              refetch();
              onChanged();
              qc.invalidateQueries({ queryKey });
            }}
          />
        ) : null}
      </aside>
    </div>
  );
}

function DrawerContents({
  ticket,
  members,
  labels,
  onClose,
  onChanged,
}: {
  ticket: TicketDetail;
  members: Member[];
  labels: LabelDef[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(ticket.title);
  const [descDraft, setDescDraft] = useState(ticket.description ?? '');
  const [editingDesc, setEditingDesc] = useState(false);
  const [comment, setComment] = useState('');
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  const patch = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/v1/tickets/${ticket.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': String(ticket.version),
      },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error?.message ?? `Patch failed (${res.status})`);
    onChanged();
  };

  const toggleAssignee = async (userId: string) => {
    const next = ticket.assignees.some((a) => a.id === userId)
      ? ticket.assignees.filter((a) => a.id !== userId).map((a) => a.id)
      : [...ticket.assignees.map((a) => a.id), userId];
    await patch({ assigneeIds: next });
  };

  const toggleLabel = async (labelId: string) => {
    const next = ticket.labels.some((l) => l.id === labelId)
      ? ticket.labels.filter((l) => l.id !== labelId).map((l) => l.id)
      : [...ticket.labels.map((l) => l.id), labelId];
    await patch({ labelIds: next });
  };

  const submitComment = async () => {
    if (!comment.trim()) return;
    setSubmitErr(null);
    try {
      const res = await fetch(`/api/v1/tickets/${ticket.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: comment.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error?.message ?? `HTTP ${res.status}`);
      setComment('');
      onChanged();
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : 'Comment failed');
    }
  };

  return (
    <>
      <header className="flex items-start justify-between gap-3 border-b border-bg-border px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span className="font-mono">
              {ticket.project.key}-{ticket.number}
            </span>
            <span>·</span>
            <span>{ticket.statusColumn.name}</span>
            <span>·</span>
            <span>v{ticket.version}</span>
          </div>
          {editingTitle ? (
            <input
              className="input mt-1 text-base font-semibold"
              autoFocus
              value={titleDraft}
              maxLength={200}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={async () => {
                if (titleDraft.trim() && titleDraft !== ticket.title) {
                  await patch({ title: titleDraft.trim() });
                }
                setEditingTitle(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') {
                  setTitleDraft(ticket.title);
                  setEditingTitle(false);
                }
              }}
            />
          ) : (
            <h2
              className="mt-1 cursor-text text-lg font-semibold"
              onClick={() => {
                setTitleDraft(ticket.title);
                setEditingTitle(true);
              }}
            >
              {ticket.title}
            </h2>
          )}
        </div>
        <button
          className="btn btn-ghost"
          onClick={onClose}
          aria-label="Close"
          title="Close (Esc)"
        >
          ✕
        </button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <section className="flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-6">
            <h3 className="label">Description</h3>
            {editingDesc ? (
              <div>
                <textarea
                  className="input min-h-[120px]"
                  autoFocus
                  value={descDraft}
                  maxLength={50000}
                  onChange={(e) => setDescDraft(e.target.value)}
                />
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      setDescDraft(ticket.description ?? '');
                      setEditingDesc(false);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={async () => {
                      await patch({ description: descDraft || null });
                      setEditingDesc(false);
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <div
                className="cursor-text whitespace-pre-wrap rounded-md border border-transparent px-3 py-2 text-sm text-text-secondary hover:border-bg-border"
                onClick={() => {
                  setDescDraft(ticket.description ?? '');
                  setEditingDesc(true);
                }}
              >
                {ticket.description?.trim() || (
                  <span className="text-text-muted">Click to add a description.</span>
                )}
              </div>
            )}
          </div>

          <div className="mb-6">
            <h3 className="label mb-2">Comments ({ticket.comments.length})</h3>
            <div className="space-y-3">
              {ticket.comments.map((c) => (
                <div key={c.id} className="flex gap-3">
                  <Avatar name={c.author.name} url={c.author.avatarUrl} size="sm" />
                  <div className="flex-1">
                    <div className="flex items-baseline gap-2 text-xs">
                      <span className="font-medium text-text-primary">
                        {c.author.name}
                      </span>
                      <span className="text-text-muted">
                        {new Date(c.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-text-secondary">
                      {c.body}
                    </p>
                  </div>
                </div>
              ))}
              {ticket.comments.length === 0 ? (
                <p className="text-xs text-text-muted">No comments yet.</p>
              ) : null}
            </div>
            <div className="mt-3">
              <textarea
                className="input min-h-[60px]"
                placeholder="Add a comment…"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitComment();
                }}
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] text-text-muted">⌘/Ctrl+Enter to send</span>
                <button
                  className="btn btn-primary"
                  onClick={submitComment}
                  disabled={!comment.trim()}
                >
                  Comment
                </button>
              </div>
              {submitErr ? (
                <p className="mt-1 text-xs text-priority-urgent">{submitErr}</p>
              ) : null}
            </div>
          </div>

          <div>
            <h3 className="label mb-2">Activity</h3>
            <ul className="space-y-1.5">
              {ticket.activity.map((e) => (
                <li key={e.id} className="text-xs text-text-secondary">
                  <span className="text-text-muted">
                    {new Date(e.createdAt).toLocaleString()}
                  </span>
                  {' · '}
                  <span className="font-medium text-text-primary">
                    {e.actor?.name ?? 'System'}
                  </span>
                  {' '}
                  <ActivityLine type={e.type} payload={e.payload} />
                </li>
              ))}
            </ul>
          </div>
        </section>

        <aside className="w-60 shrink-0 space-y-5 overflow-y-auto border-l border-bg-border bg-bg-base/40 px-4 py-4">
          <div>
            <h3 className="label">Reporter</h3>
            <div className="flex items-center gap-2 text-sm">
              <Avatar
                name={ticket.reporter.name}
                url={ticket.reporter.avatarUrl}
                size="sm"
              />
              <span>{ticket.reporter.name}</span>
            </div>
          </div>

          <div>
            <h3 className="label">Assignees</h3>
            <div className="space-y-1">
              {members.map((m) => {
                const active = ticket.assignees.some((a) => a.id === m.id);
                return (
                  <button
                    key={m.id}
                    onClick={() => toggleAssignee(m.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-bg-raised',
                      active && 'bg-bg-raised',
                    )}
                  >
                    <Avatar name={m.name} url={m.avatarUrl} size="xs" />
                    <span className="flex-1 truncate">{m.name}</span>
                    {active ? <span className="text-accent">✓</span> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <h3 className="label">Priority</h3>
            <select
              className="input py-1 text-xs"
              value={ticket.priority}
              onChange={(e) => patch({ priority: e.target.value })}
            >
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
              <option value="lowest">Lowest</option>
            </select>
            <div className="mt-2">
              <PriorityBadge priority={ticket.priority} showLabel />
            </div>
          </div>

          <div>
            <h3 className="label">Context</h3>
            <select
              className="input py-1 text-xs"
              value={ticket.context}
              onChange={(e) => patch({ context: e.target.value })}
            >
              <option value="professional">Professional</option>
              <option value="personal">Personal</option>
            </select>
          </div>

          <div>
            <h3 className="label">Due date</h3>
            <input
              type="date"
              className="input py-1 text-xs"
              value={ticket.dueDate ? ticket.dueDate.slice(0, 10) : ''}
              onChange={(e) =>
                patch({ dueDate: e.target.value ? new Date(e.target.value).toISOString() : null })
              }
            />
          </div>

          <div>
            <h3 className="label">Labels</h3>
            <div className="flex flex-wrap gap-1">
              {labels.map((l) => {
                const active = ticket.labels.some((tl) => tl.id === l.id);
                return (
                  <button
                    key={l.id}
                    onClick={() => toggleLabel(l.id)}
                    className="label-pill"
                    style={{
                      backgroundColor: active ? l.color + '40' : 'transparent',
                      color: l.color,
                      border: `1px solid ${l.color}${active ? '80' : '40'}`,
                    }}
                  >
                    {l.name}
                  </button>
                );
              })}
              {labels.length === 0 ? (
                <span className="text-xs text-text-muted">No labels defined.</span>
              ) : null}
            </div>
          </div>

          <ReminderQuickSet ticket={ticket} />

          <div>
            <h3 className="label">Created</h3>
            <p className="text-xs text-text-secondary">
              {new Date(ticket.createdAt).toLocaleString()}
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}

/** Quick "remind me about this ticket" — creates a Reminder linked to the ticket. */
function ReminderQuickSet({ ticket }: { ticket: TicketDetail }) {
  const [at, setAt] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const save = async () => {
    if (!at) return;
    setState('saving');
    try {
      const res = await fetch(`/api/v1/workspaces/${ticket.workspaceId}/reminders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${ticket.project.key}-${ticket.number}: ${ticket.title}`.slice(0, 200),
          ticketId: ticket.id,
          remindAt: new Date(at).toISOString(),
        }),
      });
      if (!res.ok) throw new Error();
      setState('saved');
      setAt('');
      setTimeout(() => setState('idle'), 2500);
    } catch {
      setState('error');
    }
  };

  return (
    <div>
      <h3 className="label">Remind me</h3>
      <input
        type="datetime-local"
        className="input py-1 text-xs"
        value={at}
        onChange={(e) => setAt(e.target.value)}
      />
      <button
        className="btn btn-secondary mt-2 w-full text-xs"
        onClick={save}
        disabled={!at || state === 'saving'}
      >
        {state === 'saving' ? 'Saving…' : state === 'saved' ? '✓ Reminder set' : 'Set reminder'}
      </button>
      {state === 'error' ? (
        <p className="mt-1 text-xs text-priority-urgent">Could not set reminder.</p>
      ) : null}
    </div>
  );
}

function ActivityLine({ type, payload }: { type: string; payload: Record<string, unknown> }) {
  switch (type) {
    case 'ticket_created':
      return <>created this ticket</>;
    case 'ticket_updated':
      return <>updated the ticket</>;
    case 'status_changed':
      return <>moved this ticket</>;
    case 'priority_changed':
      return (
        <>
          changed priority{' '}
          {payload.from && payload.to ? (
            <span className="text-text-muted">
              {String(payload.from)} → {String(payload.to)}
            </span>
          ) : null}
        </>
      );
    case 'due_date_changed':
      return <>changed the due date</>;
    case 'comment_added':
      return <>commented</>;
    default:
      return <>{type}</>;
  }
}
