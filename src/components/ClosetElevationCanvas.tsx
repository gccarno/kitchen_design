'use client';

import React, { useRef, useState } from 'react';
import { newId } from '@/lib/id';
import { CLOSET_COMPONENTS } from '@/lib/closet/catalog';
import { clientToElevation, dragTo, placeAt, resizeTo, type ViewBox } from '@/lib/closet/canvas';
import { componentBox } from '@/lib/closet/drawing';
import { validateCloset } from '@/lib/closet/validate';
import type { Closet, ClosetComponentKind } from '@/lib/plan/schemas';
import ClosetElevation, { ELEVATION_PAD_MM } from './ClosetElevation';

interface ClosetElevationCanvasProps {
  closet: Closet;
  /** Save an edit; resolves to null on success or an error message. */
  onEdit: (closet: Closet, summary: string) => Promise<string | null>;
  /** A component kind to place: the next tap puts one there. */
  placingKind: ClosetComponentKind | null;
  onPlacingDone: () => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

type DragTarget = { id: string } & (
  /** `grab`: component's left/bottom minus the grab point, so it doesn't jump. */
  | { kind: 'move'; grab: [number, number] }
  | { kind: 'resize'; side: 'left' | 'right' }
);
type Drag = DragTarget & { pointerId: number; start: [number, number]; moved: boolean };

/** Pixels a press must travel before it counts as a drag (not a tap). */
const DRAG_SLOP_PX = 4;

/**
 * The closet's front elevation, editable: tap to place the picked component,
 * drag a component to move it (it lines up with the sides and other
 * components' edges), drag the side handles of the selected one to resize
 * it. Each finished edit is saved as its own revision; edits that would
 * make the closet invalid are refused.
 */
export default function ClosetElevationCanvas({
  closet,
  onEdit,
  placingKind,
  onPlacingDone,
  selectedId,
  onSelect,
}: ClosetElevationCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [draft, setDraft] = useState<Closet | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = draft ?? closet;
  const H = closet.heightMm;
  const pad = ELEVATION_PAD_MM;
  const viewBox: ViewBox = { x: -pad, y: -pad, w: closet.widthMm + 2 * pad, h: H + 2 * pad };

  /** Client point → closet mm: x from the left side, y UP from the floor. */
  function toCloset(e: React.PointerEvent): [number, number] {
    const [ex, ey] = clientToElevation(svgRef.current!.getBoundingClientRect(), viewBox, e.clientX, e.clientY);
    return [ex, H - ey];
  }

  async function commit(next: Closet, summary: string): Promise<boolean> {
    const check = validateCloset(next);
    if (!check.valid) {
      setError(`Can’t do that: ${check.errors[0]}.`);
      setDraft(null);
      return false;
    }
    setError(null);
    setDraft(next);
    setSaving(true);
    const err = await onEdit(next, summary);
    setSaving(false);
    setDraft(null);
    if (err) setError(`Not saved: ${err}`);
    return err === null;
  }

  function onBackgroundDown(e: React.PointerEvent<SVGSVGElement>) {
    // Components and handles stop their own presses; everything else ignores the pointer.
    if (saving) return;
    if (placingKind) {
      const c = placeAt(closet, placingKind, newId(), toCloset(e));
      onPlacingDone();
      void commit({ ...closet, components: [...closet.components, c] }, `Add ${CLOSET_COMPONENTS[placingKind].name.toLowerCase()}`).then(
        (ok) => ok && onSelect(c.id)
      );
      return;
    }
    onSelect(null);
  }

  function startDrag(e: React.PointerEvent<SVGElement>, d: DragTarget) {
    e.stopPropagation();
    if (saving) return;
    try {
      svgRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // best-effort
    }
    drag.current = { ...d, pointerId: e.pointerId, start: [e.clientX, e.clientY], moved: false };
    onSelect(d.id);
  }

  function onComponentDown(id: string, e: React.PointerEvent<SVGElement>) {
    if (placingKind) return; // let the tap place the new component instead
    const c = closet.components.find((x) => x.id === id);
    if (!c) return;
    const [x, y] = toCloset(e);
    startDrag(e, { kind: 'move', id, grab: [c.xMm - x, c.yMm - y] });
  }

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.start[0], e.clientY - d.start[1]) < DRAG_SLOP_PX) return;
      d.moved = true;
    }
    const c = closet.components.find((x) => x.id === d.id);
    if (!c) return;
    const [x, y] = toCloset(e);
    const next = d.kind === 'move' ? dragTo(closet, c, x + d.grab[0], y + d.grab[1]) : resizeTo(closet, c, d.side, x);
    setDraft({ ...closet, components: closet.components.map((k) => (k.id === c.id ? next : k)) });
  }

  function onUp(e: React.PointerEvent<SVGSVGElement>) {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (d.moved && draft && e.type === 'pointerup') {
      const c = closet.components.find((x) => x.id === d.id);
      const name = c ? CLOSET_COMPONENTS[c.kind].name.toLowerCase() : 'component';
      void commit(draft, `${d.kind === 'move' ? 'Move' : 'Resize'} ${name}`);
    } else {
      setDraft(null);
    }
  }

  const selected = shown.components.find((c) => c.id === selectedId);
  const box = selected && componentBox(shown, selected);

  return (
    <div className="flex flex-col gap-2">
      <ClosetElevation
        closet={shown}
        label="Closet elevation"
        selectedId={selectedId}
        svgRef={svgRef}
        className={`h-[60vh] max-h-[560px] min-h-[280px] w-full touch-none select-none rounded border bg-white ${placingKind ? 'cursor-copy' : ''}`}
        onComponentPointerDown={onComponentDown}
        svgHandlers={{ onPointerDown: onBackgroundDown, onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onUp }}
      >
        {box && selected && !saving && (
          <g data-testid="resize-handles">
            {(['left', 'right'] as const).map((side) => (
              <rect
                key={side}
                data-handle={side}
                aria-label={`Resize from the ${side}`}
                x={(side === 'left' ? box.x : box.x + box.w) - 30}
                y={box.y + box.h / 2 - 60}
                width={60}
                height={120}
                rx={12}
                fill="white"
                stroke="#dc2626"
                strokeWidth={10}
                style={{ cursor: 'ew-resize' }}
                onPointerDown={(e) => startDrag(e, { kind: 'resize', id: selected.id, side })}
              />
            ))}
          </g>
        )}
      </ClosetElevation>
      {saving && <p className="text-sm text-gray-600">Saving…</p>}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
