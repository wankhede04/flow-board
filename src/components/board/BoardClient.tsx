'use client';

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Column } from './Column';
import { TicketCard } from './TicketCard';
import { TicketDrawer } from './TicketDrawer';
import { CreateTicketModal } from './CreateTicketModal';
import { BoardFilters, type Filters } from './BoardFilters';
import type { BoardSnapshot, BoardTicket, LabelDef, Member, Priority } from './types';

interface Props {
  initialBoard: BoardSnapshot;
  members: Member[];
  labels: LabelDef[];
  currentUserId: string;
}

interface MovePayload {
  ticketId: string;
  targetColumnId: string;
  targetIndex: number;
  expectedVersion: number;
}

export function BoardClient({ initialBoard, members, labels, currentUserId }: Props) {
  const qc = useQueryClient();
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);
  const [createInColumn, setCreateInColumn] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({ assignee: null, priority: null, label: null, context: null, q: '' });
  const [moveError, setMoveError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const queryKey = ['board', initialBoard.project.id];
  const { data: board = initialBoard } = useQuery<BoardSnapshot>({
    queryKey,
    initialData: initialBoard,
    queryFn: async () => {
      const res = await fetch(`/api/v1/projects/${initialBoard.project.id}/board`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('Failed to load board');
      const j = await res.json();
      return j.data;
    },
    refetchInterval: 15_000,
  });

  const filteredBoard = useMemo(() => applyFilters(board, filters), [board, filters]);

  const moveMutation = useMutation({
    mutationFn: async (payload: MovePayload) => {
      const res = await fetch(`/api/v1/tickets/${payload.ticketId}/transitions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': String(payload.expectedVersion),
        },
        body: JSON.stringify({
          targetColumnId: payload.targetColumnId,
          targetIndex: payload.targetIndex,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(j.error?.message ?? `Move failed (${res.status})`);
      }
      return j.data;
    },
    onError: (err: Error) => {
      setMoveError(err.message);
      qc.invalidateQueries({ queryKey });
    },
    onSuccess: () => {
      setMoveError(null);
      qc.invalidateQueries({ queryKey });
    },
  });

  const findTicket = (id: string): { ticket: BoardTicket; columnId: string; index: number } | null => {
    for (const col of board.columns) {
      const idx = col.tickets.findIndex((t) => t.id === id);
      if (idx >= 0) {
        return { ticket: col.tickets[idx], columnId: col.id, index: idx };
      }
    }
    return null;
  };

  const handleDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id));
  };

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    const src = findTicket(activeId);
    if (!src) return;

    // Determine destination column.
    let destColumnId: string;
    let destIndex: number;
    const overTicket = findTicket(overId);
    if (overTicket) {
      destColumnId = overTicket.columnId;
      destIndex = overTicket.index;
      if (src.columnId === destColumnId && src.index < destIndex) {
        // dragging downwards: index shifts up by one
        destIndex += 0; // arrayMove logic handled server-side via fractional index
      }
    } else {
      // dropped on a column body
      destColumnId = overId;
      const col = board.columns.find((c) => c.id === destColumnId);
      destIndex = col?.tickets.length ?? 0;
    }

    // Optimistic update.
    qc.setQueryData<BoardSnapshot>(queryKey, (prev) => {
      if (!prev) return prev;
      const next: BoardSnapshot = {
        ...prev,
        columns: prev.columns.map((c) => ({ ...c, tickets: [...c.tickets] })),
      };
      const fromCol = next.columns.find((c) => c.id === src.columnId);
      const toCol = next.columns.find((c) => c.id === destColumnId);
      if (!fromCol || !toCol) return prev;
      const fromIdx = fromCol.tickets.findIndex((t) => t.id === activeId);
      if (fromIdx < 0) return prev;
      const [moving] = fromCol.tickets.splice(fromIdx, 1);
      const insertAt = Math.min(destIndex, toCol.tickets.length);
      moving.statusColumnId = destColumnId;
      toCol.tickets.splice(insertAt, 0, moving);

      // If same column reorder, simpler logic:
      if (fromCol.id === toCol.id) {
        const newTickets = arrayMove(
          prev.columns.find((c) => c.id === fromCol.id)!.tickets,
          src.index,
          insertAt,
        );
        toCol.tickets = newTickets;
      }
      return next;
    });

    moveMutation.mutate({
      ticketId: activeId,
      targetColumnId: destColumnId,
      targetIndex: destIndex,
      expectedVersion: src.ticket.version,
    });
  };

  const activeTicket = activeId ? findTicket(activeId)?.ticket : null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-2 border-b border-bg-border px-4 py-3 pl-14 md:flex-row md:items-center md:justify-between md:px-6 md:pl-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span>Project</span>
            <span className="rounded bg-bg-border px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
              {board.project.key}
            </span>
          </div>
          <ProjectName projectId={board.project.id} name={board.project.name} onRenamed={() => qc.invalidateQueries({ queryKey })} />
        </div>
        <BoardFilters
          filters={filters}
          onChange={setFilters}
          members={members}
          labels={labels}
          currentUserId={currentUserId}
        />
      </header>

      {moveError ? (
        <div className="border-b border-priority-urgent/30 bg-priority-urgent/10 px-6 py-2 text-xs text-priority-urgent">
          {moveError}
          <button
            className="ml-2 underline"
            onClick={() => setMoveError(null)}
          >
            dismiss
          </button>
        </div>
      ) : null}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="flex flex-1 gap-3 overflow-x-auto p-4">
          {filteredBoard.columns.map((col) => (
            <Column
              key={col.id}
              column={col}
              projectKey={board.project.key}
              onOpenTicket={(id) => setOpenTicketId(id)}
              onCreateTicket={(colId) => setCreateInColumn(colId)}
            />
          ))}
        </div>
        <DragOverlay>
          {activeTicket ? (
            <TicketCard
              ticket={activeTicket}
              projectKey={board.project.key}
              onOpen={() => undefined}
              isDragOverlay
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      <TicketDrawer
        ticketId={openTicketId}
        onClose={() => setOpenTicketId(null)}
        members={members}
        labels={labels}
        onChanged={() => qc.invalidateQueries({ queryKey })}
      />

      {createInColumn ? (
        <CreateTicketModal
          projectId={board.project.id}
          columnId={createInColumn}
          onClose={() => setCreateInColumn(null)}
          onCreated={() => {
            setCreateInColumn(null);
            qc.invalidateQueries({ queryKey });
          }}
        />
      ) : null}
    </div>
  );
}

/** Project title with click-to-rename (server enforces admin). */
function ProjectName({
  projectId,
  name,
  onRenamed,
}: {
  projectId: string;
  name: string;
  onRenamed: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === name) return;
    const res = await fetch(`/api/v1/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: next }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error?.message ?? 'Rename failed');
      setTimeout(() => setError(null), 4000);
      return;
    }
    onRenamed();
  };

  return editing ? (
    <input
      className="input mt-0.5 max-w-xs py-1 text-lg font-semibold"
      autoFocus
      value={draft}
      maxLength={120}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(name);
          setEditing(false);
        }
      }}
    />
  ) : (
    <div className="flex items-center gap-1.5">
      <h1
        className="cursor-text truncate text-lg font-semibold"
        title="Click to rename project"
        onClick={() => {
          setDraft(name);
          setEditing(true);
        }}
      >
        {name}
      </h1>
      <button
        className="text-xs text-text-muted hover:text-text-primary"
        aria-label="Rename project"
        title="Rename project"
        onClick={() => {
          setDraft(name);
          setEditing(true);
        }}
      >
        ✎
      </button>
      {error ? <span className="text-xs text-priority-urgent">{error}</span> : null}
    </div>
  );
}

function applyFilters(board: BoardSnapshot, filters: Filters): BoardSnapshot {
  if (!filters.assignee && !filters.priority && !filters.label && !filters.context && !filters.q)
    return board;
  const q = filters.q.trim().toLowerCase();
  return {
    ...board,
    columns: board.columns.map((c) => ({
      ...c,
      tickets: c.tickets.filter((t) => {
        if (filters.assignee && !t.assignees.some((a) => a.id === filters.assignee)) return false;
        if (filters.priority && t.priority !== filters.priority) return false;
        if (filters.label && !t.labels.some((l) => l.id === filters.label)) return false;
        if (filters.context && t.context !== filters.context) return false;
        if (q && !t.title.toLowerCase().includes(q)) return false;
        return true;
      }),
    })),
  };
}
