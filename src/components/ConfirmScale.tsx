'use client';

import React, { useMemo, useState } from 'react';
import LengthInput from './LengthInput';
import { compass } from '@/lib/plan/compass';
import { parseLength } from '@/lib/plan/length';
import { OPENING_LABEL, wallIndexOf } from '@/lib/plan/openings';
import { proposalForPlan, type Proposal } from '@/lib/plan/proposal';
import { rescaleToKnownLength, type ScaleTarget } from '@/lib/plan/scale';
import type { Project } from '@/lib/plan/schemas';
import { wallLengthMm } from '@/lib/plan/validate';
import { inwardNormal } from '@/lib/plan/walls';
import { formatLength } from '@/lib/plan/viewport';

interface ConfirmScaleProps {
  project: Project;
  /** Gets the rescale as a proposal for the usual review step. */
  onProposal: (proposal: Proposal) => void;
}

/** A real size that changes the room by more than this factor (either way) is most likely a typo. */
const IMPLAUSIBLE = 5;

interface Choice {
  key: string;
  target: ScaleTarget;
  /** In the list: what it is and how big the plan has it now. */
  label: string;
  /** In the change summary. */
  short: string;
  currentMm: number;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * One real measurement fixes the scale of a whole design: pick a wall, door
 * or window, type how big it really is, and the room (and where things stand
 * in it) is rescaled to match. Goes through the review step like any edit.
 */
export default function ConfirmScale({ project, onProposal }: ConfirmScaleProps) {
  const { room, units } = project;
  const choices = useMemo<Choice[]>(() => {
    const walls = room.walls.map((w, i): Choice => {
      const [nx, ny] = inwardNormal(room, i);
      const length = wallLengthMm(room, i);
      return {
        key: `wall:${w.id}`,
        target: { kind: 'wall', id: w.id },
        label: `Wall ${i + 1} — ${compass([-nx, -ny])}, ${formatLength(length, units)}`,
        short: `Wall ${i + 1}`,
        currentMm: length,
      };
    });
    const openings = room.openings.map((o): Choice => {
      const where = `${capitalise(OPENING_LABEL[o.kind])} on wall ${wallIndexOf(room, o.wallId) + 1}`;
      return {
        key: `opening:${o.id}`,
        target: { kind: 'opening', id: o.id },
        label: `${where}, ${formatLength(o.widthMm, units)} wide`,
        short: where,
        currentMm: o.widthMm,
      };
    });
    return [...walls, ...openings];
  }, [room, units]);

  const [selected, setSelected] = useState(choices[0]?.key ?? '');
  const [text, setText] = useState('');

  const choice = choices.find((c) => c.key === selected) ?? choices[0];
  if (!choice) return null;
  const real = parseLength(text, units);
  const factor = real !== null && choice.currentMm > 0 ? real / choice.currentMm : null;
  const implausible = factor !== null && (factor > IMPLAUSIBLE || factor < 1 / IMPLAUSIBLE);
  const canRescale = factor !== null && !implausible;

  const percent = factor === null ? null : Math.round((factor - 1) * 100);
  const change =
    percent === null ? null : percent === 0 ? 'about the same as the plan has now' : `changes the room by ${percent > 0 ? '+' : '−'}${Math.abs(percent)}%`;

  function rescale() {
    if (real === null || !canRescale) return;
    const { room: nextRoom, items } = rescaleToKnownLength(project, choice.target, real);
    onProposal(proposalForPlan(project, { room: nextRoom, items }, `Confirm the room size: ${choice.short} is ${formatLength(real, units)}`));
    setText('');
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-600">
        One real measurement makes every size right. Measure something in the room with a tape, pick it here, and type how big it really is.
      </p>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span>What did you measure?</span>
          <select className="max-w-full rounded border px-2 py-1" value={choice.key} onChange={(e) => setSelected(e.target.value)}>
            {choices.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span>Its real size{units === 'in' ? ' (ft/in)' : ' (mm)'}</span>
          <LengthInput className="w-32 rounded border px-2 py-1" units={units} value={text} onChange={setText} />
        </label>
        <button type="button" className="rounded bg-black px-4 py-2 text-white disabled:opacity-40" disabled={!canRescale} onClick={rescale}>
          Rescale the room
        </button>
      </div>
      {change && !implausible && <p className="text-sm text-gray-600">That {change}.</p>}
      {implausible && (
        <p role="alert" className="text-sm text-amber-700">
          That is very different from what the plan has now (about ×{factor!.toFixed(1)}). Check the number and the units.
        </p>
      )}
    </div>
  );
}
