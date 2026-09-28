'use client';

import React, { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { newId } from '@/lib/id';
import type { CatalogItem } from '@/lib/catalog/schema';
import { hitTest, itemsAt } from '@/lib/plan/canvas-hit';
import { polygonBounds, snapToGrid, type Point } from '@/lib/plan/geometry';
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
import { positionItem } from '@/lib/plan/placement';
import { insertVertex, moveVertex, removeVertex } from '@/lib/plan/room-edit';
import type { OpeningKind, PlacedItem, Room } from '@/lib/plan/schemas';
import { validateRoom } from '@/lib/plan/validate';
import { fitToBounds, formatLength, pan, pinch, rulerTicks, screenToWorld, zoomAt, type Viewport } from '@/lib/plan/viewport';
import { OPENING_COLOR } from './plan-colors';

// Konva touches `window` at import time, so the stage only loads in the browser.
const FloorPlanStage = dynamic(() => import('./FloorPlanStage'), { ssr: false });

/** A change to the plan: a new outline (with its openings), new items, or both. */
export interface PlanChange {
  room?: Room;
  items?: PlacedItem[];
}

interface FloorPlanCanvasProps {
  room: Room;
  items: PlacedItem[];
  units: 'mm' | 'in';
  label: string;
  /**
   * Save an edit. Resolves to null on success or an error message. Without
   * it, the canvas is view-only.
   */
  onEdit?: (change: PlanChange, summary: string) => Promise<string | null>;
  /** A catalog item to place: the next tap on the plan puts it there. */
  placingItem?: CatalogItem | null;
  /** Called when placing finishes or is cancelled. */
  onPlacingDone?: () => void;
  /** Display names for placed items, by item id. */
  itemLabels?: Record<string, string>;
}

const RULER_PX = 22;
const BUTTON_ZOOM = 1.25;
export const SNAP_MM = 50;
/** Handle hit radius in screen px: fingers need a bigger target than a mouse. */
const HIT_PX = { mouse: 12, touch: 22 } as const;
const PLACE_TOOLS: OpeningKind[] = ['door', 'window', 'pass_through'];

type Selection =
  | { kind: 'corner'; index: number }
  | { kind: 'opening'; id: string }
  | { kind: 'item'; id: string }
  | null;
type Drag = { pointerId: number; moved: boolean } & (
  | { kind: 'corner'; index: number }
  | { kind: 'opening-end'; id: string; edge: 'start' | 'end' }
  /** `grabMm`: where along the opening it was grabbed, so it doesn't jump. */
  | { kind: 'opening-move'; id: string; grabMm: number }
  /** `grab`: item centre minus the grab point. `stack`: items under the pointer, for tap-to-cycle. */
  | { kind: 'item'; id: string; grab: Point; wasSelected: boolean; stack: string[] }
);

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Pannable, zoomable view of the plan. Mouse: drag to pan, wheel to zoom
 * at the cursor. Touch: one finger pans, two fingers pinch-zoom. Rulers
 * along the top and left edges follow the view in the project's units.
 *
 * With `onEdit`:
 * - Items: pick one in the catalog (`placingItem`) and tap the plan to place
 *   it — near a wall it goes back-to-wall, facing into the room. Tap an item
 *   to select it (tap again to cycle through stacked items), drag to move,
 *   Rotate / Remove from the toolbar.
 * - "Edit outline": drag corners, tap a wall's "+" to add one, place doors /
 *   windows / pass-throughs, drag their ends to resize or bodies to slide.
 * Every edit is saved as its own revision; invalid edits are refused.
 */
export default function FloorPlanCanvas({
  room,
  items,
  units,
  label,
  onEdit,
  placingItem = null,
  onPlacingDone,
  itemLabels = {},
}: FloorPlanCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const pointers = useRef(new Map<number, Point>());

  const [editing, setEditing] = useState(false);
  const [snap, setSnap] = useState(true);
  const [selected, setSelected] = useState<Selection>(null);
  const [placing, setPlacing] = useState<OpeningKind | null>(null);
  // What's shown while dragging or saving; null means "show the props".
  const [draft, setDraft] = useState<{ room: Room; items: PlacedItem[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const shownRoom = draft?.room ?? room;
  const shownItems = draft?.items ?? items;
  const snapMm = snap ? SNAP_MM : 0;

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
    // Fit into the area not covered by the rulers, leaving room outside the
    // walls for their length labels.
    setViewport(pan(fitToBounds(b, size.w - RULER_PX, size.h - RULER_PX, 0.12), RULER_PX, RULER_PX));
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

  // Starting to place a catalog item leaves outline editing.
  useEffect(() => {
    if (placingItem) {
      setEditing(false);
      setPlacing(null);
      setEditError(null);
    }
  }, [placingItem]);

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
  const nameOf = (it: PlacedItem) => itemLabels[it.id] ?? it.catalogId;

  async function commit(change: PlanChange, summary: string): Promise<boolean> {
    if (!onEdit) return false;
    const nextRoom = change.room ?? room;
    const nextItems = change.items ?? items;
    const check = validateRoom(nextRoom, nextItems);
    if (!check.valid) {
      setEditError(`Can’t do that: ${check.errors[0]}.`);
      setDraft(null);
      return false;
    }
    setEditError(null);
    setDraft({ room: nextRoom, items: nextItems });
    setSaving(true);
    const error = await onEdit(change, summary);
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
    const canAct = onEdit && viewport && !saving && pointers.current.size === 0 && !drag.current;

    if (canAct && placingItem) {
      placeCatalogItem(placingItem, screenToWorld(viewport, at));
      return;
    }
    if (canAct && editing) {
      if (outlinePointerDown(e, at, viewport)) return;
    } else if (canAct) {
      const world = screenToWorld(viewport, at);
      const stack = itemsAt(items, world);
      if (stack.length > 0) {
        const wasSelected = selected?.kind === 'item' && stack.includes(selected.id);
        const id = wasSelected ? (selected as { id: string }).id : stack[0];
        const it = items.find((x) => x.id === id)!;
        drag.current = {
          pointerId: e.pointerId,
          moved: false,
          kind: 'item',
          id,
          grab: [it.position.x - world[0], it.position.y - world[1]],
          wasSelected,
          stack,
        };
        setSelected({ kind: 'item', id });
        return;
      }
      setSelected(null);
    }
    pointers.current.set(e.pointerId, at);
  }

  function placeCatalogItem(item: CatalogItem, world: Point) {
    let pose;
    try {
      pose = positionItem(room, item.sizeMm, item.mount, world, { snapMm });
    } catch (err) {
      setEditError(`Can’t place it there: ${(err as Error).message}.`);
      return;
    }
    const placed: PlacedItem = {
      id: newId(),
      catalogId: item.id,
      sizeMm: item.sizeMm,
      ...(item.mount !== 'floor' ? { mount: item.mount } : {}),
      ...(item.clearanceMm ? { clearanceMm: item.clearanceMm } : {}),
      ...(item.tags[0] ? { tag: item.tags[0] } : {}),
      position: pose.position,
      rotationDeg: pose.rotationDeg,
    };
    onPlacingDone?.();
    void commit({ items: [...items, placed] }, `Add ${item.name}`).then(
      (ok) => ok && setSelected({ kind: 'item', id: placed.id })
    );
  }

  /** Outline-editing gestures; returns true if the pointer-down was consumed. */
  function outlinePointerDown(e: React.PointerEvent, at: Point, v: Viewport): boolean {
    const tolerance = e.pointerType === 'touch' ? HIT_PX.touch : HIT_PX.mouse;

    if (placing) {
      const near = nearestWallPoint(room, screenToWorld(v, at));
      if (near.distanceMm * v.scale > tolerance * 1.5) {
        setEditError(`Tap on a wall to place the ${OPENING_LABEL[placing]}.`);
        return true;
      }
      const id = newId();
      let next: Room;
      try {
        const centre = snapMm ? Math.round(near.alongMm / snapMm) * snapMm : near.alongMm;
        next = addOpening(room, near.wallIndex, centre, placing, id);
      } catch (err) {
        setEditError(`Can’t place it there: ${(err as Error).message}.`);
        return true;
      }
      const kind = placing;
      setPlacing(null);
      void commit({ room: next }, `Add ${OPENING_LABEL[kind]} on wall ${near.wallIndex + 1}`).then(
        (ok) => ok && setSelected({ kind: 'opening', id })
      );
      return true;
    }

    const hit = hitTest(room, v, at, tolerance);
    if (hit?.kind === 'vertex') {
      drag.current = { pointerId: e.pointerId, moved: false, kind: 'corner', index: hit.index };
      setSelected({ kind: 'corner', index: hit.index });
      return true;
    }
    if (hit?.kind === 'opening-end') {
      drag.current = { pointerId: e.pointerId, moved: false, kind: 'opening-end', id: hit.id, edge: hit.edge };
      setSelected({ kind: 'opening', id: hit.id });
      return true;
    }
    if (hit?.kind === 'opening') {
      const o = room.openings.find((x) => x.id === hit.id)!;
      const grabMm = alongWallMm(room, wallIndexOf(room, o.wallId), screenToWorld(v, at)) - o.positionMm;
      drag.current = { pointerId: e.pointerId, moved: false, kind: 'opening-move', id: hit.id, grabMm };
      setSelected({ kind: 'opening', id: hit.id });
      return true;
    }
    if (hit?.kind === 'edge') {
      const next = insertVertex(room, hit.index, hit.point, newId());
      void commit({ room: next }, `Add corner on wall ${hit.index + 1}`).then(
        (ok) => ok && setSelected({ kind: 'corner', index: hit.index + 1 })
      );
      return true;
    }
    return false;
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (d && d.pointerId === e.pointerId && viewport) {
      const world = screenToWorld(viewport, local(e));
      d.moved = true;
      if (d.kind === 'item') {
        const it = items.find((x) => x.id === d.id);
        if (!it) return;
        try {
          const pose = positionItem(room, it.sizeMm, it.mount ?? 'floor', [world[0] + d.grab[0], world[1] + d.grab[1]], {
            snapMm,
            rotationDeg: it.rotationDeg,
          });
          const moved = { ...it, position: pose.position, rotationDeg: pose.rotationDeg };
          setDraft({ room, items: items.map((x) => (x.id === it.id ? moved : x)) });
        } catch {
          // Outside the room (or a wall item away from walls): keep the last good spot.
        }
        return;
      }
      if (d.kind === 'corner') {
        setDraft({ room: moveVertex(room, d.index, snap ? snapToGrid(world, SNAP_MM) : world), items });
        return;
      }
      const o = room.openings.find((x) => x.id === d.id);
      if (!o) return;
      const along = alongWallMm(room, wallIndexOf(room, o.wallId), world);
      const snapAlong = (mm: number) => (snap ? Math.round(mm / SNAP_MM) * SNAP_MM : mm);
      const next =
        d.kind === 'opening-end'
          ? resizeOpening(room, d.id, d.edge, snapAlong(along))
          : moveOpening(room, d.id, snapAlong(along - d.grabMm));
      setDraft({ room: next, items });
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
        const change = d.kind === 'item' ? { items: draft.items } : { room: draft.room };
        void commit(change, dragSummary(d));
      } else {
        setDraft(null);
        // A second tap on a stack of items selects the next one down.
        if (d.kind === 'item' && !d.moved && d.wasSelected && d.stack.length > 1) {
          const next = d.stack[(d.stack.indexOf(d.id) + 1) % d.stack.length];
          setSelected({ kind: 'item', id: next });
        }
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
    if (d.kind === 'item') {
      const it = items.find((x) => x.id === d.id);
      return `Move ${it ? nameOf(it) : 'item'}`;
    }
    return `${d.kind === 'opening-end' ? 'Resize' : 'Move'} ${openingWhere(d.id)}`;
  }

  function deleteSelected() {
    if (!selected) return;
    let change: PlanChange;
    let summary: string;
    if (selected.kind === 'corner') {
      change = { room: removeVertex(room, selected.index) };
      summary = `Remove corner ${selected.index + 1}`;
    } else if (selected.kind === 'opening') {
      change = { room: removeOpening(room, selected.id) };
      summary = `Remove ${openingWhere(selected.id)}`;
    } else {
      const it = items.find((x) => x.id === selected.id);
      change = { items: items.filter((x) => x.id !== selected.id) };
      summary = `Remove ${it ? nameOf(it) : 'item'}`;
    }
    void commit(change, summary).then((ok) => ok && setSelected(null));
  }

  function rotateSelectedItem() {
    if (selected?.kind !== 'item') return;
    const it = items.find((x) => x.id === selected.id);
    if (!it) return;
    const rotated = { ...it, rotationDeg: (it.rotationDeg + 90) % 360 };
    void commit({ items: items.map((x) => (x.id === it.id ? rotated : x)) }, `Rotate ${nameOf(it)}`);
  }

  function zoomButton(factor: number) {
    if (!size) return;
    setViewport((v) => v && zoomAt(v, [size.w / 2, size.h / 2], factor));
  }

  const xTicks = viewport && size ? rulerTicks(viewport.scale, viewport.x, size.w, units).ticks : [];
  const yTicks = viewport && size ? rulerTicks(viewport.scale, viewport.y, size.h, units).ticks : [];
  const selectedOpening = selected?.kind === 'opening' ? room.openings.find((o) => o.id === selected.id) : undefined;
  const selectedItem = selected?.kind === 'item' ? items.find((x) => x.id === selected.id) : undefined;
  const canDeleteOutline =
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
        className={`relative h-[60vh] max-h-[560px] min-h-[280px] w-full touch-none select-none overflow-hidden rounded border bg-white ${
          placingItem ? 'cursor-copy' : 'cursor-grab active:cursor-grabbing'
        }`}
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
            room={shownRoom}
            items={shownItems}
            units={units}
            editing={editing}
            selectedCorner={selected?.kind === 'corner' ? selected.index : null}
            selectedOpening={selected?.kind === 'opening' ? selected.id : null}
            selectedItem={selected?.kind === 'item' ? selected.id : null}
            itemLabels={itemLabels}
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

      {placingItem && (
        <div className="flex flex-wrap items-center gap-2 rounded bg-blue-50 p-2 text-sm">
          <span>
            Tap the plan to place <strong>{placingItem.name}</strong>. Near a wall it goes back-to-wall.
          </span>
          <button type="button" className="rounded border bg-white px-3 py-1" onClick={() => onPlacingDone?.()}>
            Cancel
          </button>
        </div>
      )}

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
        {onEdit && (
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
                onPlacingDone?.();
              }}
            >
              {editing ? 'Done editing' : 'Edit outline'}
            </button>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
              Snap to {SNAP_MM} mm
            </label>
            {editing && (
              <>
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
                  disabled={!canDeleteOutline}
                  onClick={deleteSelected}
                >
                  {deleteLabel}
                </button>
              </>
            )}
            {!editing && selectedItem && (
              <>
                <button type="button" className="rounded border px-3 py-1" disabled={saving} onClick={rotateSelectedItem}>
                  Rotate 90°
                </button>
                <button type="button" className="rounded border px-3 py-1" disabled={saving} onClick={deleteSelected}>
                  Remove item
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
      {!editing && selectedItem && (
        <p className="text-sm text-gray-700" data-testid="item-info">
          {nameOf(selectedItem)} · {formatLength(selectedItem.sizeMm.w, units)} × {formatLength(selectedItem.sizeMm.d, units)}
          {selectedItem.mount === 'wall' ? ' · wall-mounted' : selectedItem.mount === 'counter' ? ' · on the counter' : ''}
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
