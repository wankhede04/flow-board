'use client';

import { useState } from 'react';
import { CreateProjectModal } from './CreateProjectModal';

export function NewProjectButton({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn btn-primary text-xs" onClick={() => setOpen(true)}>
        ＋ New project
      </button>
      {open ? <CreateProjectModal workspaceId={workspaceId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
