'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  workspaceId: string;
  onClose: () => void;
}

/** Suggest an uppercase key from the project name, e.g. "Home Chores" → "HC". */
function suggestKey(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const key =
    words.length >= 2
      ? words.map((w) => w[0]).join('')
      : (words[0] ?? '').slice(0, 4);
  return key.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

export function CreateProjectModal({ workspaceId, onClose }: Props) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveKey = keyTouched ? key : suggestKey(name);

  const submit = async () => {
    if (!name.trim() || effectiveKey.length < 2) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/workspaces/${workspaceId}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          key: effectiveKey,
          description: description.trim() || undefined,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error?.message ?? `HTTP ${res.status}`);
      onClose();
      router.push(`/workspace/${workspaceId}/projects/${j.data.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-bg-border bg-bg-surface p-5 shadow-cardHover"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-base font-semibold">New project</h2>
        <div className="space-y-3">
          <div>
            <label className="label">Name</label>
            <input
              className="input"
              autoFocus
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Home Renovation"
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
            />
          </div>
          <div>
            <label className="label">Key</label>
            <input
              className="input font-mono uppercase"
              maxLength={8}
              value={effectiveKey}
              onChange={(e) => {
                setKeyTouched(true);
                setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
              }}
              placeholder="HR"
            />
            <p className="mt-1 text-[11px] text-text-muted">
              2–8 uppercase letters/digits — prefixes ticket numbers ({effectiveKey || 'KEY'}-1).
              Cannot be changed later.
            </p>
          </div>
          <div>
            <label className="label">Description (optional)</label>
            <textarea
              className="input min-h-[70px]"
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        {error ? <p className="mt-3 text-xs text-priority-urgent">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={submit}
            disabled={submitting || !name.trim() || effectiveKey.length < 2}
          >
            {submitting ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </div>
    </div>
  );
}
