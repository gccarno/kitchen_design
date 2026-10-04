/**
 * Pure interaction math for the closet elevation editor: screen → closet
 * coordinates, snapping to the closet sides and other components' edges,
 * and where a tapped component goes. No DOM.
 */

import type { Closet, ClosetComponent, ClosetComponentKind } from '../plan/schemas';
import { CLOSET_COMPONENTS, newComponent } from './catalog';
import { clampComponent } from './commands';

/** Positions round to this when nothing to line up with is close. */
export const GRID_MM = 25;
/** An edge this close to another edge (or a closet side) lines up with it. */
export const EDGE_SNAP_MM = 40;
/** Boxes this close to the floor sit on it. */
export const FLOOR_SNAP_MM = 60;

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A client point → elevation mm (y down), for an SVG drawn into `rect` with
 * the default preserveAspectRatio (xMidYMid meet: uniform scale, centred).
 */
export function clientToElevation(rect: { left: number; top: number; width: number; height: number }, vb: ViewBox, clientX: number, clientY: number): [number, number] {
  const scale = Math.min(rect.width / vb.w, rect.height / vb.h);
  const offX = (rect.width - vb.w * scale) / 2;
  const offY = (rect.height - vb.h * scale) / 2;
  return [vb.x + (clientX - rect.left - offX) / scale, vb.y + (clientY - rect.top - offY) / scale];
}

const roundTo = (n: number, step: number) => Math.round(n / step) * step;

/** The left edge for a component `widthMm` wide, lined up with nearby edges or else on the grid. */
export function snapX(closet: Closet, xMm: number, widthMm: number, ignoreId?: string): number {
  const edges = [0, closet.widthMm];
  for (const c of closet.components) if (c.id !== ignoreId) edges.push(c.xMm, c.xMm + c.widthMm);
  let best: { x: number; d: number } | null = null;
  for (const e of edges) {
    for (const x of [e, e - widthMm]) {
      const d = Math.abs(x - xMm);
      if (d <= EDGE_SNAP_MM && (!best || d < best.d)) best = { x, d };
    }
  }
  return best ? best.x : roundTo(xMm, GRID_MM);
}

/** A height above the floor on the grid; boxes near the floor sit on it. */
export function snapY(kind: ClosetComponentKind, yMm: number): number {
  if (CLOSET_COMPONENTS[kind].box && yMm < FLOOR_SNAP_MM) return 0;
  return Math.max(0, roundTo(yMm, GRID_MM));
}

/**
 * A new component of `kind` placed where the user tapped (`at` = closet mm,
 * y up from the floor): centred on the tap; lines at the tapped height,
 * floor-standing boxes on the floor, baskets at the tapped height.
 */
export function placeAt(closet: Closet, kind: ClosetComponentKind, id: string, at: [number, number]): ClosetComponent {
  const spec = CLOSET_COMPONENTS[kind];
  const widthMm = Math.min(spec.defaults.widthMm, closet.widthMm);
  const floorStanding = spec.box && spec.defaults.yMm === 0;
  const yMm = floorStanding ? 0 : snapY(kind, at[1]);
  const xMm = snapX(closet, at[0] - widthMm / 2, widthMm);
  return clampComponent(closet, newComponent(kind, id, xMm, { widthMm, yMm }));
}

/** `c` dragged so its left edge is at `xMm` and its bottom (or line) at `yMm`, snapped and kept inside. */
export function dragTo(closet: Closet, c: ClosetComponent, xMm: number, yMm: number): ClosetComponent {
  return clampComponent(closet, { ...c, xMm: snapX(closet, xMm, c.widthMm, c.id), yMm: snapY(c.kind, yMm) });
}

/** `c` with one side dragged to `edgeMm`, snapped, no narrower than its kind allows. */
export function resizeTo(closet: Closet, c: ClosetComponent, side: 'left' | 'right', edgeMm: number): ClosetComponent {
  const min = CLOSET_COMPONENTS[c.kind].minWidthMm;
  const snapped = snapX(closet, edgeMm, 0, c.id);
  const edge = Math.min(Math.max(snapped, 0), closet.widthMm);
  if (side === 'left') {
    const right = c.xMm + c.widthMm;
    const left = Math.min(edge, right - min);
    return { ...c, xMm: left, widthMm: right - left };
  }
  const right = Math.max(edge, c.xMm + min);
  return clampComponent(closet, { ...c, widthMm: right - c.xMm });
}
