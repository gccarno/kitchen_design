'use client';

import React, { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { newId } from '@/lib/id';
import { hitTest } from '@/lib/plan/canvas-hit';
import { polygonBounds, snapToGrid, type Point } from '@/lib/plan/geometry';
import { insertVertex, moveVertex, removeVertex } from '@/lib/plan/room-edit';
import type { PlacedItem, Room } from '@/lib/plan/schemas';
import { validateRoom } from '@/lib/plan/validate';
import { fitToBounds, pan, pinch, rulerTicks, screenToWorld, zoomAt, type Viewport } from '@/lib/plan/viewport';

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

/**
 * Pannable, zoomable view of the plan. Mouse: drag to pan, wheel to zoom
 * at the cursor. Touch: one finger pans, two fingers pinch-zoom. Rulers
 * along the top and left edges follow the view in the project's units.
 *
 * With `onEditRoom`, "Edit outline" shows handles: drag a corner to move it
 * (snapped to 50 mm unless turned off), tap a wall's "+" to add a corner,
 * select a corner and "Delete corner" to remove it. Each edit is saved as
 * its own revision; edits that would make walls cross are refused.
 */
export default function FloorPlanCanvas({ room, items, units, label, onEditRoom }: FloorPlanCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const pointers = useRef(new Map<number, Point>());

  const [editing, setEditing] = useState(false);
  const [snap, setSnap] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  // The outline shown while dragging or saving; null means "show `room`".
  const [draft, setDraft] = useState<Room | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const drag = useRef<{ pointerId: number; index: number; moved: boolean } | null>(null);
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
      const hit = hitTest(room, viewport, at, e.pointerType === 'touch' ? HIT_PX.touch : HIT_PX.mouse);
      if (hit?.kind === 'vertex') {
        drag.current = { pointerId: e.pointerId, index: hit.index, moved: false };
        setSelected(hit.index);
        return;
      }
      if (hit?.kind === 'edge') {
        const next = insertVertex(room, hit.index, hit.point, newId());
        void commit(next, `Add corner on wall ${hit.index + 1}`).then((ok) => ok && setSelected(hit.index + 1));
        return;
      }
    }
    pointers.current.set(e.pointerId, at);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (d && d.pointerId === e.pointerId && viewport) {
      const world = screenToWorld(viewport, local(e));
      const target = snap ? snapToGrid(world, SNAP_MM) : world;
      d.moved = true;
      setDraft(moveVertex(room, d.index, target));
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
        void commit(draft, `Move corner ${d.index + 1}`);
      } else {
        setDraft(null);
      }
      return;
    }
    pointers.current.delete(e.pointerId);
  }

  function deleteCorner() {
    if (selected === null) return;
    const index = selected;
    void commit(removeVertex(room, index), `Remove corner ${index + 1}`).then((ok) => ok && setSelected(null));
  }

  function zoomButton(factor: number) {
    if (!size) return;
    setViewport((v) => v && zoomAt(v, [size.w / 2, size.h / 2], factor));
  }

  const xTicks = viewport && size ? rulerTicks(viewport.scale, viewport.x, size.w, units).ticks : [];
  const yTicks = viewport && size ? rulerTicks(viewport.scale, viewport.y, size.h, units).ticks : [];
  const canDelete = editing && selected !== null && room.polygon.length > 3 && !saving;

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
            selected={selected}
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
                <button
                  type="button"
                  className="rounded border px-3 py-1 disabled:opacity-40"
                  disabled={!canDelete}
                  onClick={deleteCorner}
                >
                  Delete corner
                </button>
              </>
            )}
          </>
        )}
      </div>
      {editing && (
        <p className="text-sm text-gray-600">
          Drag a corner to move it. Tap + on a wall to add a corner. Select a corner, then Delete corner to remove it.
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
