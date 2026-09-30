/**
 * Undo and redo over the project's revision history. Undo and redo are
 * revisions like any other: an undo applies the `inverse` of the change
 * it reverts, a redo applies the `inverse` of the undo. Both go through
 * `commitRevision`, so they get the same allowlist, validation, and stale
 * check as every other edit, and survive a reload. What can be undone or
 * redone next is worked out by replaying the history.
 */

import { commitRevision } from './diff';
import type { PlanRevision, Project } from './schemas';

export interface UndoRedo {
  /** The change the next undo reverts (an edit, or a redo). */
  undo: PlanRevision | null;
  /** The undo the next redo reverts. */
  redo: PlanRevision | null;
}

export function undoRedoState(history: PlanRevision[]): UndoRedo {
  const done: PlanRevision[] = [];
  const undone: PlanRevision[] = [];
  for (const entry of history) {
    if (entry.undoes !== undefined) {
      if (done.at(-1)?.revision === entry.undoes) done.pop();
      undone.push(entry);
    } else if (entry.redoes !== undefined) {
      if (undone.at(-1)?.revision === entry.redoes) undone.pop();
      done.push(entry);
    } else {
      // A new edit starts a new branch: whatever was undone can't be redone.
      done.push(entry);
      undone.length = 0;
    }
  }
  return { undo: done.at(-1) ?? null, redo: undone.at(-1) ?? null };
}

/** The user-facing description of what a revision did, without Undo/Redo prefixes. */
export function changeSummary(entry: PlanRevision): string {
  return entry.summary.replace(/^(Undo|Redo): /, '') || `revision ${entry.revision}`;
}

/** Nothing to undo (or redo). */
export class NothingToUndoError extends Error {
  constructor(action: 'undo' | 'redo') {
    super(`nothing to ${action}`);
    this.name = 'NothingToUndoError';
  }
}

/**
 * Undo or redo as a new revision against `baseRevision`. Throws
 * `NothingToUndoError`, or the errors `commitRevision` throws (a stale
 * base, or a history entry that no longer applies).
 */
export function undoRedo(project: Project, action: 'undo' | 'redo', baseRevision: number, at?: string): Project {
  const state = undoRedoState(project.history);
  const target = state[action];
  if (!target) throw new NothingToUndoError(action);
  const summary = `${action === 'undo' ? 'Undo' : 'Redo'}: ${changeSummary(target)}`;
  return commitRevision(project, target.inverse, {
    baseRevision,
    source: 'user',
    summary,
    at,
    ...(action === 'undo' ? { undoes: target.revision } : { redoes: target.revision }),
  });
}
