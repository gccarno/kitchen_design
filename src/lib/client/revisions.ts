import type { Project } from '../plan/schemas';
import type { Proposal } from '../plan/proposal';

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
    const body = (await res.json().catch(() => ({}))) as { project?: Project; error?: string };
    if (res.ok && body.project) return { ok: true, project: body.project };
    return { ok: false, stale: res.status === 409, error: body.error ?? `could not save (${res.status})` };
  } catch (err) {
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
    const body = (await res.json().catch(() => ({}))) as { project?: Project; error?: string };
    if (res.ok && body.project) return { ok: true, project: body.project };
    return { ok: false, stale: res.status === 409, error: body.error ?? `could not ${action} (${res.status})` };
  } catch (err) {
    return { ok: false, stale: false, error: (err as Error).message };
  }
}
