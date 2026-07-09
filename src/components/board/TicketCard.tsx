'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/cn';
import { Avatar } from './Avatar';
import { PriorityBadge } from './PriorityBadge';
import type { BoardTicket, Priority } from './types';

interface Props {
  ticket: BoardTicket;
  projectKey: string;
  onOpen: (ticketId: string) => void;
  isDragOverlay?: boolean;
}

export function TicketCard({ ticket, projectKey, onOpen, isDragOverlay }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: ticket.id,
      data: { type: 'ticket', ticket },
    });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  const dueLabel = formatDue(ticket.dueDate);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'card group cursor-pointer select-none',
        isDragging && !isDragOverlay && 'opacity-30',
        isDragOverlay && 'shadow-cardHover ring-2 ring-accent/50',
      )}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        // Avoid triggering open during drag start
        if ((e as unknown as { defaultPrevented?: boolean }).defaultPrevented) return;
        onOpen(ticket.id);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(ticket.id);
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open ${projectKey}-${ticket.number}: ${ticket.title}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-1.5 font-mono text-[10px] text-text-muted">
          {projectKey}-{ticket.number}
          {ticket.context === 'personal' ? (
            <span
              title="Personal task"
              className="rounded-full bg-teal-500/15 px-1.5 py-px font-sans text-[9px] font-medium text-teal-400"
            >
              personal
            </span>
          ) : null}
        </span>
        <PriorityBadge priority={ticket.priority as Priority} />
      </div>
      <h4 className="mt-1 line-clamp-3 text-sm leading-snug text-text-primary">
        {ticket.title}
      </h4>
      {ticket.labels.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {ticket.labels.slice(0, 4).map((l) => (
            <span
              key={l.id}
              className="label-pill"
              style={{
                backgroundColor: l.color + '24',
                color: l.color,
                border: `1px solid ${l.color}40`,
              }}
            >
              {l.name}
            </span>
          ))}
        </div>
      ) : null}
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] text-text-muted">
          {ticket.commentCount > 0 ? (
            <span title={`${ticket.commentCount} comments`}>💬 {ticket.commentCount}</span>
          ) : null}
          {dueLabel ? (
            <span
              title={`Due ${dueLabel.full}`}
              className={cn(
                dueLabel.overdue && 'text-priority-urgent',
                dueLabel.soon && !dueLabel.overdue && 'text-priority-high',
              )}
            >
              ⏰ {dueLabel.short}
            </span>
          ) : null}
        </div>
        <div className="flex -space-x-1.5">
          {ticket.assignees.slice(0, 3).map((a) => (
            <Avatar key={a.id} name={a.name} url={a.avatarUrl} size="xs" className="ring-2 ring-bg-raised" />
          ))}
        </div>
      </div>
    </div>
  );
}

function formatDue(due: Date | string | null) {
  if (!due) return null;
  const d = typeof due === 'string' ? new Date(due) : due;
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const ms = d.getTime() - now.getTime();
  const days = Math.round(ms / (1000 * 60 * 60 * 24));
  const overdue = ms < 0;
  const soon = days >= 0 && days <= 2;
  let short: string;
  if (days === 0) short = 'today';
  else if (days === 1) short = 'tomorrow';
  else if (days === -1) short = 'yesterday';
  else if (days > 0) short = `${days}d`;
  else short = `${Math.abs(days)}d ago`;
  return {
    short,
    full: d.toISOString().slice(0, 10),
    overdue,
    soon,
  };
}
