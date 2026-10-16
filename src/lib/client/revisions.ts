import type { Project } from '../plan/schemas';
import type { Proposal } from '../plan/proposal';
import { markOffline, markOnline } from './online';

/** Shown when the server rejects an edit because the project changed elsewhere (HTTP 409). */
export const STALE_MESSAGE = 'This project changed elsewhere — loaded the latest version; re-apply your change';
/** Fired on `window` after a 409 so the open editor can reload the latest project. */
export const STALE_EVENT = 'hd:project-stale';

function staleError(projectId: string): string {
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(STALE_EVENT, { detail: { projectId } }));
  } catch {
    /* best effort */
  }
  return STALE_MESSAGE;
}

export type SubmitResult =
  | { ok: true; project: Project }
  /** `stale`: the plan changed since the proposal was made (HTTP 409). */
  | { ok: false; stale: boolean; error: string };

/** Commit a proposal via POST /api/projects/[id]/revisions. Never throws. */
export async function submitRevision(projectId: string, proposal: Proposal): Promise<SubmitResult> {
  try {
    const res = await fetch(`/api/projects/${projectId}/revisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseRevision: proposal.baseRevision,
        patch: proposal.patch,
        summary: proposal.summary,
        source: proposal.source,
      }),
    });
    markOnline();
    const body = (await res.json().catch(() => ({}))) as { project?: Project; error?: string };
    if (res.ok && body.project) return { ok: true, project: body.project };
    if (res.status === 409) return { ok: false, stale: true, error: staleError(projectId) };
    return { ok: false, stale: false, error: body.error ?? `could not save (${res.status})` };
  } catch (err) {
    if (err instanceof TypeError) markOffline();
    return { ok: false, stale: false, error: (err as Error).message };
  }
}

/** Undo the last change, or redo the last undo, via POST /api/projects/[id]/undo. Never throws. */
export async function submitUndo(projectId: string, action: 'undo' | 'redo', baseRevision: number): Promise<SubmitResult> {
  try {
    const res = await fetch(`/api/projects/${projectId}/undo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, baseRevision }),
    });
    markOnline();
    const body = (await res.json().catch(() => ({}))) as { project?: Project; error?: string };
    if (res.ok && body.project) return { ok: true, project: body.project };
    if (res.status === 409) return { ok: false, stale: true, error: staleError(projectId) };
    return { ok: false, stale: false, error: body.error ?? `could not ${action} (${res.status})` };
  } catch (err) {
    if (err instanceof TypeError) markOffline();
    return { ok: false, stale: false, error: (err as Error).message };
  }
}
