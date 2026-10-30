'use client';

import React, { useState } from 'react';
import { useOnline } from '@/lib/client/online';
import {
  COUNTERTOP_LABEL,
  DOOR_STYLE_LABEL,
  FINISH_COLORS,
  colorName,
  describeFinishes,
  finishChanges,
  finishesOf,
} from '@/lib/plan/finishes';
import { COUNTERTOP_MATERIALS, DOOR_STYLES, type CountertopMaterial, type DoorStyle, type Finishes, type Project } from '@/lib/plan/schemas';

interface FinishesPanelProps {
  project: Project;
  /** Save new finishes (`undefined`: back to the standard look); resolves to an error message, or null. */
  onSave: (finishes: Finishes | undefined, summary: string) => Promise<string | null>;
}

/**
 * Cabinet colour, door style and countertop. Each pick is saved straight away
 * as a revision (undoable), like a price edit; the elevations and the estimate
 * follow.
 */
export default function FinishesPanel({ project, onSave }: FinishesPanelProps) {
  const online = useOnline();
  const [error, setError] = useState<string | null>(null);
  const current = finishesOf(project);
  // A colour set by chat can be any code: keep it in the list so the picker shows it.
  const custom = FINISH_COLORS.every((c) => c.hex !== current.cabinetColor.toLowerCase());

  async function save(next: Finishes | undefined) {
    if (!online) return setError('Not saved: offline — editing is disabled');
    setError(null);
    const summary = next ? (finishChanges(current, next).join('; ') || describeFinishes(next)) : 'Reset finishes to standard';
    const err = await onSave(next, summary);
    if (err) setError(`Not saved: ${err}`);
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          Cabinet colour
          <select
            className="rounded border px-2 py-1"
            disabled={!online}
            value={current.cabinetColor.toLowerCase()}
            onChange={(e) => void save({ ...current, cabinetColor: e.target.value })}
          >
            {FINISH_COLORS.map((c) => (
              <option key={c.hex} value={c.hex}>
                {c.name}
              </option>
            ))}
            {custom && <option value={current.cabinetColor.toLowerCase()}>{colorName(current.cabinetColor)}</option>}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Door style
          <select
            className="rounded border px-2 py-1"
            disabled={!online}
            value={current.doorStyle}
            onChange={(e) => void save({ ...current, doorStyle: e.target.value as DoorStyle })}
          >
            {DOOR_STYLES.map((s) => (
              <option key={s} value={s}>
                {DOOR_STYLE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Countertop
          <select
            className="rounded border px-2 py-1"
            disabled={!online}
            value={current.countertop}
            onChange={(e) => void save({ ...current, countertop: e.target.value as CountertopMaterial })}
          >
            {COUNTERTOP_MATERIALS.map((m) => (
              <option key={m} value={m}>
                {COUNTERTOP_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        {project.finishes && (
          <button type="button" className="rounded border px-3 py-1 disabled:opacity-40" disabled={!online} onClick={() => void save(undefined)}>
            Reset to standard
          </button>
        )}
      </div>
      <p className="text-gray-600">
        {project.finishes ? describeFinishes(project.finishes) : 'Standard: natural wood cabinets, shaker doors, quartz countertop.'} Doors and countertop
        change the estimate.
      </p>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
