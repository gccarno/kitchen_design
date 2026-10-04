/**
 * The closet's front elevation as plain shapes, shared by the on-screen
 * elevation (React SVG) and the exported drawing (SVG string). Coordinates
 * are elevation mm with y DOWN (SVG convention): svgY = closet height − height
 * above the floor. Pure: no DOM.
 */

import type { Closet, ClosetComponent } from '../plan/schemas';
import { CLOSET_COMPONENTS, componentRef, topOf } from './catalog';
import { DOOR_STACK_MM, HANG_DROP_MM } from './validate';

export type Shape = { componentId?: string } & (
  | { type: 'rect'; x: number; y: number; w: number; h: number; fill: string; stroke?: string; strokeWidth?: number; dash?: number[] }
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; strokeWidth: number; dash?: number[] }
  | { type: 'circle'; cx: number; cy: number; r: number; fill: string; stroke?: string; strokeWidth?: number }
  | { type: 'text'; x: number; y: number; text: string; size: number; anchor: 'start' | 'middle' | 'end'; fill: string }
);

export const INK = '#111827';
const WOOD = '#f3e8d2';
const WOOD_EDGE = '#8a6a3b';
const METAL = '#4b5563';
const SHELF_MM = 25;
const LABEL_MM = 70;

/** Elevation-space rectangle a component occupies, y down; lines get a small hit band. */
export function componentBox(closet: Closet, c: ClosetComponent): { x: number; y: number; w: number; h: number } {
  const spec = CLOSET_COMPONENTS[c.kind];
  if (spec.box) return { x: c.xMm, y: closet.heightMm - topOf(c), w: c.widthMm, h: c.heightMm ?? 0 };
  const band = c.kind === 'shoe_shelf' ? 120 : 60;
  return { x: c.xMm, y: closet.heightMm - c.yMm - band / 2, w: c.widthMm, h: band };
}

export interface ClosetDrawingOptions {
  /** Highlight this component. */
  selectedId?: string | null;
  /** Show the light "where clothes hang" band under each rod (default true). */
  showHangZones?: boolean;
}

export function closetDrawing(closet: Closet, opts: ClosetDrawingOptions = {}): Shape[] {
  const { widthMm: W, heightMm: H, opening } = closet;
  const out: Shape[] = [];
  out.push({ type: 'rect', x: 0, y: 0, w: W, h: H, fill: '#f9fafb' });

  // Returns: the parts of the back wall behind the closet front, out of the opening.
  const oLeft = opening.leftMm;
  const oRight = opening.leftMm + opening.widthMm;
  if (oLeft > 0) out.push({ type: 'rect', x: 0, y: 0, w: oLeft, h: H, fill: '#e5e7eb' });
  if (oRight < W) out.push({ type: 'rect', x: oRight, y: 0, w: W - oRight, h: H, fill: '#e5e7eb' });

  if (opts.showHangZones !== false) {
    for (const c of closet.components.filter((x) => x.kind === 'rod')) {
      const top = H - c.yMm;
      const h = Math.min(HANG_DROP_MM, c.yMm);
      out.push({ type: 'rect', x: c.xMm, y: top, w: c.widthMm, h, fill: '#dbeafe' });
    }
  }

  // Boxes first, then lines on top.
  const ordered = [...closet.components].sort((a, b) => Number(!CLOSET_COMPONENTS[a.kind].box) - Number(!CLOSET_COMPONENTS[b.kind].box));
  for (const c of ordered) out.push(...componentShapes(closet, c, c.id === opts.selectedId));

  // Labels: the same refs the chat uses.
  closet.components.forEach((c, i) => {
    const b = componentBox(closet, c);
    // Boxes: top-left corner, clear of handles and dividers. Lines: centred just above.
    const box = CLOSET_COMPONENTS[c.kind].box;
    out.push({
      type: 'text',
      x: box ? c.xMm + 20 : c.xMm + c.widthMm / 2,
      y: box ? b.y + Math.min(b.h / 2, LABEL_MM) : b.y - 10,
      text: componentRef(i),
      size: LABEL_MM,
      anchor: box ? 'start' : 'middle',
      fill: INK,
      componentId: c.id,
    });
  });

  // Closet sides, floor, ceiling.
  out.push({ type: 'rect', x: 0, y: 0, w: W, h: H, fill: 'none', stroke: INK, strokeWidth: 16 });

  // Door opening: jambs, and the doors' stack-back at each side.
  if (opening.style !== 'open') {
    const stack = DOOR_STACK_MM[opening.style];
    for (const x of [oLeft, oRight]) out.push({ type: 'line', x1: x, y1: 0, x2: x, y2: H, stroke: '#dc2626', strokeWidth: 10, dash: [60, 40] });
    if (stack > 0) {
      out.push({ type: 'rect', x: oLeft, y: 0, w: stack, h: H, fill: 'rgba(220,38,38,0.08)' });
      out.push({ type: 'rect', x: oRight - stack, y: 0, w: stack, h: H, fill: 'rgba(220,38,38,0.08)' });
    }
    if (opening.style === 'sliding') {
      const mid = (oLeft + oRight) / 2;
      out.push({ type: 'line', x1: mid, y1: 0, x2: mid, y2: H, stroke: '#dc2626', strokeWidth: 6, dash: [20, 30] });
    }
  }
  return out;
}

function componentShapes(closet: Closet, c: ClosetComponent, selected: boolean): Shape[] {
  const H = closet.heightMm;
  const id = c.id;
  const x0 = c.xMm;
  const x1 = c.xMm + c.widthMm;
  const y = H - c.yMm; // the component's line, or a box's bottom
  const shapes: Shape[] = [];
  const stroke = selected ? '#dc2626' : undefined;

  switch (c.kind) {
    case 'shelf':
      shapes.push({ type: 'rect', x: x0, y, w: c.widthMm, h: SHELF_MM, fill: WOOD, stroke: stroke ?? WOOD_EDGE, strokeWidth: selected ? 12 : 6 });
      break;
    case 'rod':
      shapes.push({ type: 'line', x1: x0, y1: y, x2: x1, y2: y, stroke: stroke ?? METAL, strokeWidth: 22 });
      for (const x of [x0 + 10, x1 - 10]) shapes.push({ type: 'line', x1: x, y1: y - 40, x2: x, y2: y, stroke: METAL, strokeWidth: 10 });
      break;
    case 'shoe_shelf':
      shapes.push({ type: 'line', x1: x0, y1: y - 60, x2: x1, y2: y - 60, stroke: stroke ?? WOOD_EDGE, strokeWidth: selected ? 14 : 8, dash: [30, 15] });
      shapes.push({ type: 'rect', x: x0, y, w: c.widthMm, h: SHELF_MM, fill: WOOD, stroke: stroke ?? WOOD_EDGE, strokeWidth: 6 });
      shapes.push({ type: 'line', x1: x0, y1: y - 30, x2: x1, y2: y - 30, stroke: WOOD_EDGE, strokeWidth: 8 }); // shoe lip
      break;
    case 'hooks':
      shapes.push({ type: 'line', x1: x0, y1: y, x2: x1, y2: y, stroke: stroke ?? WOOD_EDGE, strokeWidth: 14 });
      for (let x = x0 + 40; x <= x1 - 20; x += 100) shapes.push({ type: 'circle', cx: x, cy: y + 30, r: 14, fill: 'none', stroke: METAL, strokeWidth: 8 });
      break;
    case 'valet_rod':
      shapes.push({ type: 'rect', x: x0, y: y - 15, w: c.widthMm, h: 30, fill: METAL, stroke: stroke ?? METAL, strokeWidth: selected ? 12 : 2 });
      break;
    case 'tower':
    case 'drawers':
    case 'basket': {
      const h = c.heightMm ?? 0;
      const top = y - h;
      shapes.push({ type: 'rect', x: x0, y: top, w: c.widthMm, h, fill: c.kind === 'basket' ? '#ffffff' : WOOD, stroke: stroke ?? WOOD_EDGE, strokeWidth: selected ? 14 : 8 });
      if (c.kind === 'tower') {
        const n = c.count ?? 0;
        for (let k = 1; k <= n; k++) {
          const sy = y - (h * k) / (n + 1);
          shapes.push({ type: 'line', x1: x0, y1: sy, x2: x1, y2: sy, stroke: WOOD_EDGE, strokeWidth: 8 });
        }
      } else if (c.kind === 'drawers') {
        const n = c.count ?? 1;
        for (let k = 0; k < n; k++) {
          const dy = top + (h * k) / n;
          if (k > 0) shapes.push({ type: 'line', x1: x0, y1: dy, x2: x1, y2: dy, stroke: WOOD_EDGE, strokeWidth: 8 });
          const mid = dy + h / n / 2;
          shapes.push({ type: 'line', x1: x0 + c.widthMm / 2 - 60, y1: mid, x2: x0 + c.widthMm / 2 + 60, y2: mid, stroke: METAL, strokeWidth: 12 });
        }
      } else {
        for (let x = x0 + 50; x < x1; x += 50) shapes.push({ type: 'line', x1: x, y1: top, x2: x, y2: y, stroke: METAL, strokeWidth: 3 });
      }
      break;
    }
  }
  return shapes.map((s) => ({ ...s, componentId: id }));
}
