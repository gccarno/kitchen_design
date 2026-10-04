'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import ChatPanel from './ChatPanel';
import ClosetElevationCanvas from './ClosetElevationCanvas';
import HistoryControls from './HistoryControls';
import { CLOSET_COMPONENT_KINDS, CLOSET_COMPONENTS, componentRef } from '@/lib/closet/catalog';
import { CommandError } from '@/lib/plan/commands';
import { compileClosetCommands, type ClosetCommand } from '@/lib/closet/commands';
import { newId } from '@/lib/id';
import { submitRevision } from '@/lib/client/revisions';
import { proposalForCloset, type Proposal } from '@/lib/plan/proposal';
import { validatePlan } from '@/lib/plan/validate';
import { formatLength } from '@/lib/plan/viewport';
import type { Closet, ClosetComponent, ClosetComponentKind, ClosetDoorStyle, Project } from '@/lib/plan/schemas';

interface ClosetEditorProps {
  project: Project & { closet: Closet };
  /** A direct edit (or undo) was saved. */
  onSaved: (project: Project) => void;
  /** The chat proposed a change; it goes to the review step. */
  onProposal: (proposal: Proposal) => void;
}

const DOOR_STYLES: { value: ClosetDoorStyle; label: string }[] = [
  { value: 'bifold', label: 'Bifold' },
  { value: 'sliding', label: 'Sliding' },
  { value: 'hinged', label: 'Hinged' },
  { value: 'open', label: 'No doors' },
];

/**
 * A closet project's workspace: the front elevation to edit directly, the
 * chat, the component palette, and the closet's size and doors. Direct
 * edits save straight away as revisions (undoable); chat edits are reviewed.
 */
export default function ClosetEditor({ project, onSaved, onProposal }: ClosetEditorProps) {
  const closet = project.closet;
  const [placing, setPlacing] = useState<ClosetComponentKind | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const closetRef = useRef<HTMLElement>(null);
  const warnings = useMemo(() => validatePlan(project).warnings, [project]);
  const selectedIndex = closet.components.findIndex((c) => c.id === selectedId);
  const selected = selectedIndex >= 0 ? closet.components[selectedIndex] : undefined;

  // Forget a selection that no longer exists (removed, or undone away).
  useEffect(() => {
    if (selectedId && selectedIndex < 0) setSelectedId(null);
  }, [selectedId, selectedIndex]);

  async function save(next: Closet, summary: string): Promise<string | null> {
    const proposal = proposalForCloset(project, next, summary);
    if (proposal.patch.length === 0) return null;
    const result = await submitRevision(project.id, proposal);
    if (result.ok) {
      onSaved(result.project);
      return null;
    }
    return result.stale ? 'the closet changed in another tab — reload the page' : result.error;
  }

  /** Apply commands (clamped and validated like the chat's) and save them. */
  async function run(commands: ClosetCommand[], summary: string) {
    setFormError(null);
    let next: Project;
    try {
      next = compileClosetCommands(project, commands, newId).project;
    } catch (err) {
      if (!(err instanceof CommandError)) throw err;
      setFormError(err.message.replace(/^commands\[\d+\] \(\w+\): (the result would be invalid: )?/, 'Can’t do that: '));
      return;
    }
    const err = await save(next.closet!, summary);
    if (err) setFormError(`Not saved: ${err}`);
  }

  return (
    <>
      <section ref={closetRef} className="flex scroll-mt-4 flex-col gap-2">
        <h2 className="text-lg font-semibold">Closet</h2>
        <HistoryControls project={project} onSaved={onSaved} />
        <ClosetElevationCanvas
          closet={closet}
          onEdit={save}
          placingKind={placing}
          onPlacingDone={() => setPlacing(null)}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <p className="text-sm text-gray-600">
          {formatLength(closet.widthMm, project.units)} wide × {formatLength(closet.heightMm, project.units)} high ×{' '}
          {formatLength(closet.depthMm, project.units)} deep. Blue shows where clothes hang; red dashes mark the door opening.
        </p>
        {placing && (
          <div className="flex flex-wrap items-center gap-2 rounded bg-blue-50 p-2 text-sm">
            <span>
              Tap the closet to place a <strong>{CLOSET_COMPONENTS[placing].name.toLowerCase()}</strong>.
            </span>
            <button type="button" className="rounded border bg-white px-3 py-1" onClick={() => setPlacing(null)}>
              Cancel
            </button>
          </div>
        )}
        {selected && (
          <ComponentDetails
            key={selected.id}
            component={selected}
            ref_={componentRef(selectedIndex)}
            units={project.units}
            onChange={(cmd, summary) => run([cmd], summary)}
            onRemove={() =>
              run([{ type: 'removeComponent', component: componentRef(selectedIndex) }], `Remove ${CLOSET_COMPONENTS[selected.kind].name.toLowerCase()}`)
            }
          />
        )}
        {formError && (
          <p role="alert" className="text-sm text-red-700">
            {formError}
          </p>
        )}
        {warnings.length > 0 && (
          <div className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
            <p className="font-medium">Heads up</p>
            <ul aria-label="Closet warnings" className="list-disc pl-5">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Ask for changes</h2>
        <ChatPanel
          projectId={project.id}
          onProposal={onProposal}
          placeholder="e.g. double hang on the left, a drawer unit in the middle, shoe shelves under the long hang"
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Components</h2>
        <p className="text-sm text-gray-600">Pick one, then tap the closet to place it. Drag to move; drag the red side handles to resize.</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Closet components">
          {CLOSET_COMPONENT_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              title={CLOSET_COMPONENTS[kind].hint}
              aria-pressed={placing === kind}
              className={`rounded border px-3 py-2 text-left text-sm ${placing === kind ? 'bg-blue-600 text-white' : 'bg-white'}`}
              onClick={() => {
                setPlacing((p) => (p === kind ? null : kind));
                setSelectedId(null);
                // The closet is above the palette: bring it into view for the tap.
                closetRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
              }}
            >
              {CLOSET_COMPONENTS[kind].name}
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Size and doors</h2>
        <ClosetSettings closet={closet} onSave={(cmds) => run(cmds, 'Change closet size and doors')} />
      </section>
    </>
  );
}

/** A millimetre input that commits on Enter or when it loses focus. */
function MmField({ label, value, onCommit, min = 0 }: { label: string; value: number; onCommit: (v: number) => void; min?: number }) {
  const [text, setText] = useState(String(Math.round(value)));
  useEffect(() => setText(String(Math.round(value))), [value]);
  const commit = () => {
    const v = Number(text);
    if (text.trim() === '' || !Number.isFinite(v) || v < min) return setText(String(Math.round(value)));
    if (Math.round(v) !== Math.round(value)) onCommit(v);
  };
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span>{label}</span>
      <input
        className="w-24 rounded border px-2 py-1"
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
    </label>
  );
}

function ComponentDetails({
  component: c,
  ref_,
  units,
  onChange,
  onRemove,
}: {
  component: ClosetComponent;
  ref_: string;
  units: 'mm' | 'in';
  onChange: (cmd: ClosetCommand, summary: string) => void;
  onRemove: () => void;
}) {
  const spec = CLOSET_COMPONENTS[c.kind];
  const name = spec.name.toLowerCase();
  const move = (over: { xMm?: number; yMm?: number }) => onChange({ type: 'moveComponent', component: ref_, ...over }, `Move ${name}`);
  const resize = (over: { widthMm?: number; heightMm?: number; count?: number }) =>
    onChange({ type: 'resizeComponent', component: ref_, ...over }, `Resize ${name}`);
  return (
    <div className="flex flex-col gap-2 rounded border p-2" data-testid="component-info">
      <p className="text-sm font-medium">
        {spec.name} {ref_} · {formatLength(c.widthMm, units)} wide
        {c.heightMm !== undefined ? ` × ${formatLength(c.heightMm, units)} high` : ''} · {formatLength(c.yMm, units)} up
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <MmField label="From left (mm)" value={c.xMm} onCommit={(xMm) => move({ xMm })} />
        <MmField label={spec.box ? 'Bottom height (mm)' : 'Height (mm)'} value={c.yMm} onCommit={(yMm) => move({ yMm })} />
        <MmField label="Width (mm)" value={c.widthMm} min={1} onCommit={(widthMm) => resize({ widthMm })} />
        {spec.box && <MmField label="Box height (mm)" value={c.heightMm ?? 0} min={1} onCommit={(heightMm) => resize({ heightMm })} />}
        {spec.count && (
          <MmField
            label={c.kind === 'drawers' ? 'Drawers' : 'Shelves'}
            value={c.count ?? spec.count.min}
            min={spec.count.min}
            onCommit={(count) => resize({ count: Math.round(count) })}
          />
        )}
        <button type="button" className="rounded border px-3 py-1 text-sm text-red-700" onClick={onRemove}>
          Remove {name}
        </button>
      </div>
    </div>
  );
}

function ClosetSettings({ closet, onSave }: { closet: Closet; onSave: (cmds: ClosetCommand[]) => void }) {
  const [form, setForm] = useState(() => toForm(closet));
  useEffect(() => setForm(toForm(closet)), [closet]);
  const set = (k: keyof ReturnType<typeof toForm>) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const nums = ['widthMm', 'heightMm', 'depthMm', 'leftMm', 'openingMm'] as const;
  const valid = nums.every((k) => form[k].trim() !== '' && Number(form[k]) >= (k === 'leftMm' ? 0 : 1));
  const changed = JSON.stringify(form) !== JSON.stringify(toForm(closet));

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        // A full-width opening stays full width when only the closet's width is changed.
        const wasFull = closet.opening.leftMm === 0 && Math.round(closet.opening.widthMm) === Math.round(closet.widthMm);
        const openingUntouched = form.leftMm === toForm(closet).leftMm && form.openingMm === toForm(closet).openingMm;
        const openingMm = wasFull && openingUntouched ? form.widthMm : form.openingMm;
        onSave([
          { type: 'setClosetSize', widthMm: Number(form.widthMm), heightMm: Number(form.heightMm), depthMm: Number(form.depthMm) },
          { type: 'setOpening', style: form.style as ClosetDoorStyle, leftMm: Number(form.leftMm), widthMm: Number(openingMm) },
        ]);
      }}
    >
      {(
        [
          ['widthMm', 'Inside width (mm)'],
          ['heightMm', 'Inside height (mm)'],
          ['depthMm', 'Depth (mm)'],
        ] as const
      ).map(([k, label]) => (
        <label key={k} className="flex flex-col gap-1 text-sm">
          <span>{label}</span>
          <input className="w-24 rounded border px-2 py-1" inputMode="numeric" value={form[k]} onChange={set(k)} />
        </label>
      ))}
      <label className="flex flex-col gap-1 text-sm">
        <span>Doors</span>
        <select className="rounded border px-2 py-1" value={form.style} onChange={set('style')}>
          {DOOR_STYLES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span>Opening from left (mm)</span>
        <input className="w-24 rounded border px-2 py-1" inputMode="numeric" value={form.leftMm} onChange={set('leftMm')} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span>Opening width (mm)</span>
        <input className="w-24 rounded border px-2 py-1" inputMode="numeric" value={form.openingMm} onChange={set('openingMm')} />
      </label>
      <button type="submit" className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-40" disabled={!valid || !changed}>
        Save size and doors
      </button>
    </form>
  );
}

function toForm(c: Closet) {
  return {
    widthMm: String(Math.round(c.widthMm)),
    heightMm: String(Math.round(c.heightMm)),
    depthMm: String(Math.round(c.depthMm)),
    style: c.opening.style as string,
    leftMm: String(Math.round(c.opening.leftMm)),
    openingMm: String(Math.round(c.opening.widthMm)),
  };
}
