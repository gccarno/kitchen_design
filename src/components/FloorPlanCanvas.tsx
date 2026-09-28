'use client';

import React, { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { newId } from '@/lib/id';
import { hitTest } from '@/lib/plan/canvas-hit';
import { polygonBounds, snapToGrid, type Point } from '@/lib/plan/geometry';
import { insertVertex, moveVertex, removeVertex } from '@/lib/plan/room-edit';
import {
  addOpening,
  alongWallMm,
  moveOpening,
  nearestWallPoint,
  OPENING_LABEL,
  removeOpening,
  resizeOpening,
  wallIndexOf,
} from '@/lib/plan/openings';
import type { OpeningKind, PlacedItem, Room } from '@/lib/plan/schemas';
import { OPENING_COLOR } from './plan-colors';
import { validateRoom } from '@/lib/plan/validate';
import { fitToBounds, formatLength, pan, pinch, rulerTicks, screenToWorld, zoomAt, type Viewport } from '@/lib/plan/viewport';

// Konva touches `window` at import time, so the stage only loads in the browser.
const FloorPlanStage = dynamic(() => import('./FloorPlanStage'), { ssr: false });

interface FloorPlanCanvasProps {
  room: Room;
  items: PlacedItem[];
  units: 'mm' | 'in';
  label: string;
  /**
   * Save an edited outline. Resolves to null on success or an error message.
   * Without it, the canvas is view-only.
   */
  onEditRoom?: (room: Room, summary: string) => Promise<string | null>;
}

const RULER_PX = 22;
const BUTTON_ZOOM = 1.25;
export const SNAP_MM = 50;
/** Handle hit radius in screen px: fingers need a bigger target than a mouse. */
const HIT_PX = { mouse: 12, touch: 22 } as const;
const PLACE_TOOLS: OpeningKind[] = ['door', 'window', 'pass_through'];

type Selection = { kind: 'corner'; index: number } | { kind: 'opening'; id: string } | null;
type Drag = { pointerId: number; moved: boolean } & (
  | { kind: 'corner'; index: number }
  | { kind: 'opening-end'; id: string; edge: 'start' | 'end' }
  /** `grabMm`: where along the opening it was grabbed, so it doesn't jump. */
  | { kind: 'opening-move'; id: string; grabMm: number }
);

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Pannable, zoomable view of the plan. Mouse: drag to pan, wheel to zoom
 * at the cursor. Touch: one finger pans, two fingers pinch-zoom. Rulers
 * along the top and left edges follow the view in the project's units.
 *
 * With `onEditRoom`, "Edit outline" shows handles: drag a corner to move it
 * (snapped to 50 mm unless turned off), tap a wall's "+" to add a corner,
 * pick "Add door/window/pass-through" and tap a wall to place one, drag an
 * opening's end squares to resize it or its body to slide it, and delete
 * whatever is selected. Each edit is saved as its own revision; edits that
 * would make walls cross or openings overlap are refused.
 */
export default function FloorPlanCanvas({ room, items, units, label, onEditRoom }: FloorPlanCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const pointers = useRef(new Map<number, Point>());

  const [editing, setEditing] = useState(false);
  const [snap, setSnap] = useState(true);
  const [selected, setSelected] = useState<Selection>(null);
  const [placing, setPlacing] = useState<OpeningKind | null>(null);
  // The outline shown while dragging or saving; null means "show `room`".
  const [draft, setDraft] = useState<Room | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const shown = draft ?? room;

  // Track the container size.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function fit() {
    if (!size) return;
    const b = polygonBounds(room.polygon as Point[]);
    // Fit into the area not covered by the rulers.
    setViewport(pan(fitToBounds(b, size.w - RULER_PX, size.h - RULER_PX), RULER_PX, RULER_PX));
  }

  // Fit on first layout and on resize.
  useEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size?.w, size?.h]);

  // Refit when the room is replaced wholesale (no wall ids in common), but not
  // after an edit to the current outline — the view shouldn't jump while editing.
  const wallKey = room.walls.map((w) => w.id).join(',');
  const lastWallIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(room.walls.map((w) => w.id));
    const prev = lastWallIds.current;
    lastWallIds.current = ids;
    if (prev && ![...ids].some((id) => prev.has(id))) {
      fit();
      setSelected(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallKey]);

  // Wheel zoom needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.pow(1.0015, -e.deltaY);
      const at = toLocal(el, e.clientX, e.clientY);
      setViewport((v) => v && zoomAt(v, at, factor));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const local = (e: React.PointerEvent): Point => toLocal(wrapRef.current!, e.clientX, e.clientY);

  async function commit(next: Room, summary: string): Promise<boolean> {
    if (!onEditRoom) return false;
    const check = validateRoom(next, items);
    if (!check.valid) {
      setEditError(`Can’t do that: ${check.errors[0]}.`);
      setDraft(null);
      return false;
    }
    setEditError(null);
    setDraft(next);
    setSaving(true);
    const error = await onEditRoom(next, summary);
    setSaving(false);
    setDraft(null);
    if (error) setEditError(`Not saved: ${error}`);
    return error === null;
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // best-effort
    }
    const at = local(e);

    if (editing && viewport && !saving && pointers.current.size === 0 && !drag.current) {
      const tolerance = e.pointerType === 'touch' ? HIT_PX.touch : HIT_PX.mouse;

      if (placing) {
        const near = nearestWallPoint(room, screenToWorld(viewport, at));
        if (near.distanceMm * viewport.scale > tolerance * 1.5) {
          setEditError(`Tap on a wall to place the ${OPENING_LABEL[placing]}.`);
          return;
        }
        const id = newId();
        let next: Room;
        try {
          next = addOpening(room, near.wallIndex, near.alongMm, placing, id);
        } catch (err) {
          setEditError(`Can’t place it there: ${(err as Error).message}.`);
          return;
        }
        const kind = placing;
        setPlacing(null);
        void commit(next, `Add ${OPENING_LABEL[kind]} on wall ${near.wallIndex + 1}`).then(
          (ok) => ok && setSelected({ kind: 'opening', id })
        );
        return;
      }

      const hit = hitTest(room, viewport, at, tolerance);
      if (hit?.kind === 'vertex') {
        drag.current = { pointerId: e.pointerId, moved: false, kind: 'corner', index: hit.index };
        setSelected({ kind: 'corner', index: hit.index });
        return;
      }
      if (hit?.kind === 'opening-end') {
        drag.current = { pointerId: e.pointerId, moved: false, kind: 'opening-end', id: hit.id, edge: hit.edge };
        setSelected({ kind: 'opening', id: hit.id });
        return;
      }
      if (hit?.kind === 'opening') {
        const o = room.openings.find((x) => x.id === hit.id)!;
        const grabMm = alongWallMm(room, wallIndexOf(room, o.wallId), screenToWorld(viewport, at)) - o.positionMm;
        drag.current = { pointerId: e.pointerId, moved: false, kind: 'opening-move', id: hit.id, grabMm };
        setSelected({ kind: 'opening', id: hit.id });
        return;
      }
      if (hit?.kind === 'edge') {
        const next = insertVertex(room, hit.index, hit.point, newId());
        void commit(next, `Add corner on wall ${hit.index + 1}`).then(
          (ok) => ok && setSelected({ kind: 'corner', index: hit.index + 1 })
        );
        return;
      }
    }
    pointers.current.set(e.pointerId, at);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (d && d.pointerId === e.pointerId && viewport) {
      const world = screenToWorld(viewport, local(e));
      d.moved = true;
      if (d.kind === 'corner') {
        setDraft(moveVertex(room, d.index, snap ? snapToGrid(world, SNAP_MM) : world));
        return;
      }
      const o = room.openings.find((x) => x.id === d.id);
      if (!o) return;
      const along = alongWallMm(room, wallIndexOf(room, o.wallId), world);
      const snapMm = (mm: number) => (snap ? Math.round(mm / SNAP_MM) * SNAP_MM : mm);
      setDraft(
        d.kind === 'opening-end'
          ? resizeOpening(room, d.id, d.edge, snapMm(along))
          : moveOpening(room, d.id, snapMm(along - d.grabMm))
      );
      return;
    }

    const map = pointers.current;
    const prev = map.get(e.pointerId);
    if (!prev) return;
    const next = local(e);
    if (map.size === 1) {
      setViewport((v) => v && pan(v, next[0] - prev[0], next[1] - prev[1]));
    } else if (map.size === 2) {
      const other = [...map.entries()].find(([id]) => id !== e.pointerId)![1];
      setViewport((v) => v && pinch(v, [prev, other], [next, other]));
    }
    map.set(e.pointerId, next);
  }

  function onPointerEnd(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (d && d.pointerId === e.pointerId) {
      drag.current = null;
      if (d.moved && draft && e.type === 'pointerup') {
        void commit(draft, dragSummary(d));
      } else {
        setDraft(null);
      }
      return;
    }
    pointers.current.delete(e.pointerId);
  }

  function openingWhere(id: string): string {
    const o = room.openings.find((x) => x.id === id);
    return o ? `${OPENING_LABEL[o.kind]} on wall ${wallIndexOf(room, o.wallId) + 1}` : 'opening';
  }

  function dragSummary(d: Drag): string {
    if (d.kind === 'corner') return `Move corner ${d.index + 1}`;
    return `${d.kind === 'opening-end' ? 'Resize' : 'Move'} ${openingWhere(d.id)}`;
  }

  function deleteSelected() {
    if (!selected) return;
    const [next, summary] =
      selected.kind === 'corner'
        ? [removeVertex(room, selected.index), `Remove corner ${selected.index + 1}`]
        : [removeOpening(room, selected.id), `Remove ${openingWhere(selected.id)}`];
    void commit(next, summary).then((ok) => ok && setSelected(null));
  }

  function zoomButton(factor: number) {
    if (!size) return;
    setViewport((v) => v && zoomAt(v, [size.w / 2, size.h / 2], factor));
  }

  const xTicks = viewport && size ? rulerTicks(viewport.scale, viewport.x, size.w, units).ticks : [];
  const yTicks = viewport && size ? rulerTicks(viewport.scale, viewport.y, size.h, units).ticks : [];
  const selectedOpening = selected?.kind === 'opening' ? room.openings.find((o) => o.id === selected.id) : undefined;
  const canDelete =
    editing &&
    !saving &&
    (selected?.kind === 'opening' ? !!selectedOpening : selected?.kind === 'corner' && room.polygon.length > 3);
  const deleteLabel =
    selected?.kind === 'corner'
      ? 'Delete corner'
      : selectedOpening
        ? `Delete ${OPENING_LABEL[selectedOpening.kind]}`
        : 'Delete';

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={wrapRef}
        data-testid="floor-plan"
        data-scale={viewport?.scale}
        data-x={viewport?.x}
        data-y={viewport?.y}
        role="img"
        aria-label={label}
        className="relative h-[60vh] max-h-[560px] min-h-[280px] w-full cursor-grab touch-none select-none overflow-hidden rounded border bg-white active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        {size && viewport && (
          <FloorPlanStage
            width={size.w}
            height={size.h}
            viewport={viewport}
            room={shown}
            items={items}
            units={units}
            editing={editing}
            selectedCorner={selected?.kind === 'corner' ? selected.index : null}
            selectedOpening={selected?.kind === 'opening' ? selected.id : null}
          />
        )}
        <div data-testid="ruler-x" aria-hidden className="pointer-events-none absolute inset-x-0 top-0 border-b bg-white/85 text-[10px] text-gray-600" style={{ height: RULER_PX }}>
          {xTicks.map((t) => (
            <span key={t.px} className="absolute top-0 h-full border-l border-gray-400 pl-0.5" style={{ left: t.px }}>
              {t.label}
            </span>
          ))}
        </div>
        <div data-testid="ruler-y" aria-hidden className="pointer-events-none absolute inset-y-0 left-0 border-r bg-white/85 text-[10px] text-gray-600" style={{ width: RULER_PX }}>
          {yTicks.map((t) => (
            <span key={t.px} className="absolute left-0 w-full border-t border-gray-400 [writing-mode:vertical-rl]" style={{ top: t.px }}>
              {t.label}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" className="rounded border px-3 py-1" onClick={() => zoomButton(BUTTON_ZOOM)}>
          Zoom in
        </button>
        <button type="button" className="rounded border px-3 py-1" onClick={() => zoomButton(1 / BUTTON_ZOOM)}>
          Zoom out
        </button>
        <button type="button" className="rounded border px-3 py-1" onClick={fit}>
          Fit
        </button>
        {onEditRoom && (
          <>
            <button
              type="button"
              className={`rounded border px-3 py-1 ${editing ? 'bg-black text-white' : ''}`}
              aria-pressed={editing}
              onClick={() => {
                setEditing((on) => !on);
                setSelected(null);
                setPlacing(null);
                setEditError(null);
              }}
            >
              {editing ? 'Done editing' : 'Edit outline'}
            </button>
            {editing && (
              <>
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
                  Snap to {SNAP_MM} mm
                </label>
                {PLACE_TOOLS.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className={`rounded border px-3 py-1 ${placing === kind ? 'bg-blue-600 text-white' : ''}`}
                    aria-pressed={placing === kind}
                    disabled={saving}
                    onClick={() => {
                      setPlacing((p) => (p === kind ? null : kind));
                      setEditError(null);
                    }}
                  >
                    Add {OPENING_LABEL[kind]}
                  </button>
                ))}
                <button
                  type="button"
                  className="rounded border px-3 py-1 disabled:opacity-40"
                  disabled={!canDelete}
                  onClick={deleteSelected}
                >
                  {deleteLabel}
                </button>
              </>
            )}
          </>
        )}
      </div>
      {editing && (
        <p className="text-sm text-gray-600">
          {placing
            ? `Tap a wall to place the ${OPENING_LABEL[placing]}.`
            : 'Drag a corner to move it; tap + on a wall to add one. Drag a door or window to slide it, or its end squares to resize it.'}
        </p>
      )}
      {room.openings.length > 0 && (
        <p className="flex gap-3 text-xs text-gray-600" data-testid="opening-legend">
          {(Object.keys(OPENING_COLOR) as OpeningKind[])
            .filter((k) => room.openings.some((o) => o.kind === k))
            .map((k) => (
              <span key={k} className="flex items-center gap-1">
                <span className="inline-block h-2 w-4 rounded-sm" style={{ background: OPENING_COLOR[k] }} />
                {capitalize(OPENING_LABEL[k])}
              </span>
            ))}
        </p>
      )}
      {editing && selectedOpening && (
        <p className="text-sm text-gray-700" data-testid="opening-info">
          {capitalize(openingWhere(selectedOpening.id))} · {formatLength(selectedOpening.widthMm, units)} wide ·{' '}
          {formatLength(selectedOpening.positionMm, units)} from the wall’s start
        </p>
      )}
      {saving && <p className="text-sm text-gray-600">Saving…</p>}
      {editError && (
        <p role="alert" className="text-sm text-red-700">
          {editError}
        </p>
      )}
    </div>
  );
}

/**
 * Client coordinates → coordinates inside the element's padding box, which
 * is where the Konva stage is drawn (getBoundingClientRect includes the border).
 */
function toLocal(el: HTMLElement, clientX: number, clientY: number): Point {
  const rect = el.getBoundingClientRect();
  return [clientX - rect.left - el.clientLeft, clientY - rect.top - el.clientTop];
}
