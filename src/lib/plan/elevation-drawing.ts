/**
 * One wall elevation as plain shapes, cabinet-maker style: plinths, door
 * panels, the countertop, named appliances, openings and dimensions.
 * Elevation mm with y DOWN: svgY = ceiling − height above the floor. Pure.
 */

import { INK, type Shape } from '../drawing/shapes';
import { CABINET_TAGS, ELEVATION, type ElevationPiece, type WallElevation } from './elevation';
import { COUNTERTOP_COLOR, DEFAULT_FINISHES, edgeColor } from './finishes';
import type { Finishes } from './schemas';
import { formatLength } from './viewport';

export const ELEVATION_MARGIN = { left: 450, right: 150, top: 300, bottom: 500 } as const;
export const PLINTH = '#9ca3af';
const WOOD = '#f3e8d2';
const WOOD_EDGE = '#8a6a3b';
const STEEL = '#e5e7eb';
const METAL = '#4b5563';
const DIM = '#374151';
const TEXT_MM = 60;
const CHAR_MM = TEXT_MM * 0.55;
const INSET_MM = 15;
const GLASS = '#dbeafe';

/** The drawing's extent, dimensions included. */
export function elevationFrame(e: WallElevation) {
  const m = ELEVATION_MARGIN;
  return { x: -m.left, y: -m.top, w: e.lengthMm + m.left + m.right, h: e.ceilingMm + m.top + m.bottom };
}

/** Door panels on a cabinet front: side by side, or (tall cabinets) two stacked. */
export function doorCount(p: ElevationPiece): { across: number; stacked: boolean } {
  if (!p.tag || !CABINET_TAGS.has(p.tag) || p.tag === 'filler') return { across: 0, stacked: false };
  if (p.tag === 'tall') return { across: 1, stacked: true };
  if (p.tag === 'sink') return { across: 2, stacked: false };
  if (p.tag === 'corner') return { across: 1, stacked: false };
  return { across: p.w < 600 ? 1 : 2, stacked: false };
}

/** The name if it fits, else the part before " (" or ",", else nothing. */
function fittingName(name: string, w: number): string | null {
  const fits = (t: string) => t.length * CHAR_MM <= w - 40;
  if (fits(name)) return name;
  const short = name.split(/ \(|,/)[0].trim();
  return short && fits(short) ? short : null;
}

/** `finishes` sets the cabinet colour, door style and countertop; the default is the standard look. */
export function elevationDrawing(e: WallElevation, units: 'mm' | 'in', finishes: Finishes = DEFAULT_FINISHES): Shape[] {
  const C = e.ceilingMm;
  const edge = edgeColor(finishes.cabinetColor, WOOD_EDGE);
  const Y = (heightMm: number) => C - heightMm;
  const out: Shape[] = [];

  out.push({ type: 'rect', x: 0, y: 0, w: e.lengthMm, h: C, fill: '#f9fafb', stroke: '#9ca3af', strokeWidth: 4 });

  for (const o of e.openings) {
    const top = Y(o.y + o.h);
    if (o.kind === 'window') {
      out.push({ type: 'rect', x: o.x, y: top, w: o.w, h: o.h, fill: '#ffffff', stroke: '#6b7280', strokeWidth: 6, dash: [40, 30] });
      out.push({ type: 'line', x1: o.x + o.w / 2, y1: top, x2: o.x + o.w / 2, y2: top + o.h, stroke: '#6b7280', strokeWidth: 4 });
    } else {
      out.push({ type: 'rect', x: o.x, y: top, w: o.w, h: o.h, fill: '#ffffff', stroke: '#6b7280', strokeWidth: 6 });
      if (o.kind === 'door') out.push({ type: 'line', x1: o.x, y1: C, x2: o.x + o.w, y2: top, stroke: '#9ca3af', strokeWidth: 3 });
    }
  }

  const drawPiece = (p: ElevationPiece) => {
    const id = p.itemId;
    const cabinet = !!p.tag && CABINET_TAGS.has(p.tag);
    const top = Y(p.y + p.h);
    out.push({ componentId: id, type: 'rect', x: p.x, y: top, w: p.w, h: p.h, fill: cabinet ? finishes.cabinetColor : STEEL, stroke: cabinet ? edge : METAL, strokeWidth: 6 });
    if (p.plinthMm > 0) out.push({ componentId: id, type: 'rect', x: p.x, y: Y(p.y + p.plinthMm), w: p.w, h: p.plinthMm, fill: PLINTH });
    const bodyBottom = Y(p.y + p.plinthMm);
    const bodyH = p.h - p.plinthMm;
    const { across, stacked } = doorCount(p);
    // A door front: a framed panel (shaker), a framed glass panel, or, for a slab, just the joints between doors.
    const panel = (x: number, y: number, w: number, h: number) =>
      out.push({ componentId: id, type: 'rect', x: x + INSET_MM, y: y + INSET_MM, w: w - 2 * INSET_MM, h: h - 2 * INSET_MM, fill: finishes.doorStyle === 'glass' ? GLASS : 'none', stroke: edge, strokeWidth: 3 });
    const joint = (x1: number, y1: number, x2: number, y2: number) =>
      out.push({ componentId: id, type: 'line', x1, y1, x2, y2, stroke: edge, strokeWidth: 3 });
    const slab = finishes.doorStyle === 'slab';
    if (stacked) {
      const lowH = (bodyH * 2) / 3;
      if (slab) joint(p.x, bodyBottom - lowH, p.x + p.w, bodyBottom - lowH);
      else for (const [y, h] of [[bodyBottom - lowH, lowH], [top, bodyH - lowH]] as const) panel(p.x, y, p.w, h);
    } else {
      const dw = p.w / Math.max(across, 1);
      for (let k = 0; k < across; k++) {
        if (!slab) panel(p.x + k * dw, top, dw, bodyH);
        else if (k > 0) joint(p.x + k * dw, top, p.x + k * dw, bodyBottom);
      }
    }
    if (!cabinet) {
      const name = fittingName(p.name, p.w);
      if (name) out.push({ componentId: id, type: 'text', x: p.x + p.w / 2, y: top + p.h / 2, text: name, size: TEXT_MM, anchor: 'middle', fill: INK });
    }
  };

  // Floor items, then the countertop over them, then wall and counter items.
  const low = e.pieces.filter((p) => p.y === 0);
  const high = e.pieces.filter((p) => p.y > 0);
  low.forEach(drawPiece);
  for (const c of e.counters) {
    out.push({ type: 'rect', x: c.x, y: Y(ELEVATION.counterTopMm), w: c.w, h: ELEVATION.counterThicknessMm, fill: COUNTERTOP_COLOR[finishes.countertop] });
  }
  high.forEach(drawPiece);

  out.push({ type: 'line', x1: -100, y1: C, x2: e.lengthMm + 100, y2: C, stroke: INK, strokeWidth: 12 });

  // Dimensions.
  const len = (mm: number) => formatLength(mm, units);
  const dim = (x1: number, x2: number, y: number) => {
    out.push({ type: 'line', x1, y1: y, x2, y2: y, stroke: DIM, strokeWidth: 4 });
    out.push({ type: 'line', x1, y1: y - 30, x2: x1, y2: y + 30, stroke: DIM, strokeWidth: 4 });
    out.push({ type: 'line', x1: x2, y1: y - 30, x2, y2: y + 30, stroke: DIM, strokeWidth: 4 });
    out.push({ type: 'text', x: (x1 + x2) / 2, y: y - 45, text: len(x2 - x1), size: TEXT_MM, anchor: 'middle', fill: INK });
  };
  for (const p of low) dim(p.x, p.x + p.w, C + 150);
  dim(0, e.lengthMm, C + 350);
  for (const p of e.pieces.filter((q) => q.y >= ELEVATION.wallCabinetBottomMm)) dim(p.x, p.x + p.w, -150);

  const wallCabinets = e.pieces.filter((p) => p.tag === 'wall' || (p.kind === 'wall' && p.tag === 'corner'));
  const heights = new Set<number>([ELEVATION.counterTopMm]);
  if (wallCabinets.length > 0) {
    heights.add(ELEVATION.wallCabinetBottomMm);
    heights.add(Math.max(...wallCabinets.map((p) => p.y + p.h)));
  }
  const topMark = Math.max(...heights);
  out.push({ type: 'line', x1: -80, y1: C, x2: -80, y2: Y(topMark), stroke: DIM, strokeWidth: 4 });
  for (const h of heights) {
    out.push({ type: 'line', x1: -110, y1: Y(h), x2: -50, y2: Y(h), stroke: DIM, strokeWidth: 4 });
    out.push({ type: 'text', x: -120, y: Y(h), text: len(h), size: TEXT_MM, anchor: 'end', fill: INK });
  }
  return out;
}
