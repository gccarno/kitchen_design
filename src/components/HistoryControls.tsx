'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { changeSummary, undoRedoState } from '@/lib/plan/history';
import type { Project } from '@/lib/plan/schemas';
import { submitUndo } from '@/lib/client/revisions';

const SHOWN = 20;

/**
 * Undo / Redo buttons (and Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y) plus the list of
 * recent changes. Undo and redo are saved on the server as revisions, so
 * they work across reloads.
 */
export default function HistoryControls({ project, onSaved }: { project: Project; onSaved: (p: Project) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { undo, redo } = undoRedoState(project.history);

  const run = useCallback(
    async (action: 'undo' | 'redo') => {
      if (busy || !(action === 'undo' ? undo : redo)) return;
      setBusy(true);
      setError(null);
      const result = await submitUndo(project.id, action, project.revision);
      setBusy(false);
      if (result.ok) onSaved(result.project);
      else setError(result.stale ? 'the plan changed in another tab — reload the page' : result.error);
    },
    [busy, undo, redo, project.id, project.revision, onSaved]
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        void run('undo');
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        void run('redo');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run]);

  const recent = project.history.slice(-SHOWN).reverse();

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded border px-3 py-1 text-sm disabled:opacity-50"
          disabled={busy || !undo}
          onClick={() => run('undo')}
          title={undo ? `Undo: ${changeSummary(undo)} (Ctrl+Z)` : 'Nothing to undo'}
        >
          Undo
        </button>
        <button
          type="button"
          className="rounded border px-3 py-1 text-sm disabled:opacity-50"
          disabled={busy || !redo}
          onClick={() => run('redo')}
          title={redo ? `Redo: ${changeSummary(redo)} (Ctrl+Shift+Z)` : 'Nothing to redo'}
        >
          Redo
        </button>
        {undo && !busy && <span className="text-sm text-gray-600">Last change: {changeSummary(undo)}</span>}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          Couldn’t do that: {error}
        </p>
      )}
      {recent.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-gray-600">History ({project.history.length})</summary>
          <ol aria-label="Change history" className="mt-1 flex flex-col gap-0.5 pl-1">
            {recent.map((h) => (
              <li key={h.revision} className="text-gray-700">
                <span className="text-gray-400">#{h.revision}</span> {h.summary || 'change'}
                {h.source === 'llm' && <span className="text-gray-400"> · suggested</span>}
                <span className="text-gray-400"> · {new Date(h.at).toLocaleString()}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
