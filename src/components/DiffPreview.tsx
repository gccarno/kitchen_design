'use client';

import React, { useMemo, useRef, useState } from 'react';
import PlanThumbnail from './PlanThumbnail';
import { describePlanChanges } from '@/lib/plan/changes';
import { validatePatchOnProject } from '@/lib/plan/diff';
import { polygonBounds, type Bounds, type Point } from '@/lib/plan/geometry';
import type { Project } from '@/lib/plan/schemas';
import type { Proposal } from '@/lib/plan/proposal';

export type { Proposal };

interface DiffPreviewProps {
  projectId: string;
  current: Project;
  proposal: Proposal;
  /** Called with the saved project after the server commits the patch. */
  onApplied: (project: Project) => void;
  onDiscard: () => void;
}

const LOW_CONFIDENCE = 0.5;

type Status = { state: 'idle' } | { state: 'applying' } | { state: 'stale' } | { state: 'error'; message: string };

/**
 * Current vs proposed plan, a plain-language change list, and an explicit
 * Apply / Discard. Nothing changes until Apply, which commits the patch
 * through POST /api/projects/[id]/revisions.
 */
export default function DiffPreview({ projectId, current, proposal, onApplied, onDiscard }: DiffPreviewProps) {
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  const inFlight = useRef(false);

  const preview = useMemo(() => validatePatchOnProject(current, proposal.patch), [current, proposal.patch]);
  const changes = useMemo(() => (preview.ok ? describePlanChanges(current, preview.value) : []), [current, preview]);
  const bounds = useMemo(
    () => (preview.ok ? unionBounds(current.room.polygon, preview.value.room.polygon) : undefined),
    [current, preview]
  );

  async function apply() {
    if (inFlight.current) return;
    inFlight.current = true;
    setStatus({ state: 'applying' });
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
      if (res.status === 409) {
        setStatus({ state: 'stale' });
      } else if (!res.ok || !body.project) {
        setStatus({ state: 'error', message: body.error ?? `could not apply (${res.status})` });
      } else {
        setStatus({ state: 'idle' });
        onApplied(body.project);
      }
    } catch (err) {
      setStatus({ state: 'error', message: (err as Error).message });
    } finally {
      inFlight.current = false;
    }
  }

  const canApply = preview.ok && proposal.patch.length > 0 && status.state !== 'applying' && status.state !== 'stale';

  return (
    <section className="flex flex-col gap-4 rounded border p-4" aria-label="Review proposed change">
      <h2 className="text-lg font-semibold">{proposal.summary}</h2>

      {proposal.source === 'llm' && proposal.confidence !== undefined && (
        <p className={proposal.confidence < LOW_CONFIDENCE ? 'font-medium text-amber-700' : 'text-gray-700'}>
          Model confidence: {Math.round(proposal.confidence * 100)}%
          {proposal.confidence < LOW_CONFIDENCE && ' — low confidence, check it carefully'}
        </p>
      )}
      {proposal.notes && <p className="rounded bg-gray-50 p-2 text-sm text-gray-700">{proposal.notes}</p>}
      {proposal.warnings && proposal.warnings.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-amber-700">
          {proposal.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {!preview.ok ? (
        <p role="alert" className="text-sm text-red-700">
          This change can’t be applied to the current plan: {preview.issues.join('; ')}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <figure className="flex flex-col gap-1">
              <figcaption className="text-sm text-gray-600">Current</figcaption>
              <PlanThumbnail room={current.room} items={current.items} bounds={bounds} label="Current plan" />
            </figure>
            <figure className="flex flex-col gap-1">
              <figcaption className="text-sm text-gray-600">Proposed</figcaption>
              <PlanThumbnail
                room={preview.value.room}
                items={preview.value.items}
                bounds={bounds}
                label="Proposed plan"
              />
            </figure>
          </div>
          {changes.length === 0 ? (
            <p className="text-sm text-gray-600">No changes.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {changes.map((c, i) => (
                <li key={i} className="flex gap-2">
                  <span className={`w-16 shrink-0 font-medium ${KIND_COLOR[c.kind]}`}>{c.kind}</span>
                  <span>{c.text}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {status.state === 'stale' && (
        <p role="alert" className="text-sm text-amber-700">
          The plan changed since this was proposed. Discard it and run it again.
        </p>
      )}
      {status.state === 'error' && (
        <p role="alert" className="text-sm text-red-700">
          Could not apply: {status.message}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-40"
          disabled={!canApply}
          onClick={apply}
        >
          {status.state === 'applying' ? 'Applying…' : 'Apply'}
        </button>
        <button type="button" className="rounded border px-4 py-2" onClick={onDiscard}>
          Discard
        </button>
      </div>
    </section>
  );
}

const KIND_COLOR = { added: 'text-green-700', removed: 'text-red-700', changed: 'text-blue-700' } as const;

function unionBounds(a: Project['room']['polygon'], b: Project['room']['polygon']): Bounds {
  return polygonBounds([...a, ...b] as Point[]);
}
