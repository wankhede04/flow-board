'use client';

import { useState } from 'react';

interface Props {
  projectId: string;
  columnId: string;
  onClose: () => void;
  onCreated: () => void;
}

export function CreateTicketModal({ projectId, columnId, onClose, onCreated }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [context, setContext] = useState('professional');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          statusColumnId: columnId,
          priority,
          context,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error?.message ?? `HTTP ${res.status}`);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-bg-border bg-bg-surface p-5 shadow-cardHover"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-base font-semibold">New ticket</h2>
        <div className="space-y-3">
          <div>
            <label className="label">Title</label>
            <input
              className="input"
              autoFocus
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to happen?"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
              }}
            />
          </div>
          <div>
            <label className="label">Description</label>
            <textarea
              className="input min-h-[100px]"
              maxLength={50000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Markdown supported (rendering deferred)"
            />
          </div>
          <div>
            <label className="label">Priority</label>
            <select
              className="input"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
              <option value="lowest">Lowest</option>
            </select>
          </div>
          <div>
            <label className="label">Context</label>
            <select
              className="input"
              value={context}
              onChange={(e) => setContext(e.target.value)}
            >
              <option value="professional">Professional</option>
              <option value="personal">Personal</option>
            </select>
          </div>
        </div>
        {error ? (
          <p className="mt-3 text-xs text-priority-urgent">{error}</p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={submitting || !title.trim()}>
            {submitting ? 'Creating…' : 'Create ticket'}
          </button>
        </div>
      </div>
    </div>
  );
}
