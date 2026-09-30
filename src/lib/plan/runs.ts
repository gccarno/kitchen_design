/**
 * Runs: several items packed back to back along one wall, as in a row of
 * cabinets. The LLM names the wall and the items in order; this does the
 * geometry, keeping clear of doors, windows (for wall cabinets and tall
 * items), items already on the wall, and runs on the neighbouring walls.
 * Pure functions.
 */

import { rotatedRectFootprint, type Point } from './geometry';
import type { Mount, Opening, PlacedItem, Room } from './schemas';
import { inwardNormal } from './walls';

/** Floor items at least this tall (fridges, pantries) block the wall-cabinet level too. */
export const TALL_ITEM_MM = 1400;

/** Which height band an item occupies against a wall. */
export type Band = 'low' | 'high' | 'both';

export function bandOf(mount: Mount | undefined, heightMm: number): Band {
  if (mount === 'wall') return 'high';
  return heightMm >= TALL_ITEM_MM ? 'both' : 'low';
}

const clash = (a: Band, b: Band) => a === 'both' || b === 'both' || a === b;
const openingBand = (o: Opening): Band => (o.kind === 'window' ? 'high' : 'both');

/** One item of a run: what the packer needs from a catalog item. */
export interface RunPiece {
  catalogId: string;
  sizeMm: { w: number; d: number; h: number };
  mount: Mount;
}

export type RunFrom = 'start' | 'end' | 'centre';

interface Obstacle {
  from: number;
  to: number;
  /** How far into the room its nearest point is from the wall's inside face. */
  depth: number;
  band: Band;
  label: string;
}

const EPS = 0.5;
const r = (n: number) => Math.round(n);

/**
 * Pack `pieces` along wall `wallIndex`, in order from the wall's start
 * corner toward its end, pushed against the start or end corner or centred.
 * Returns each piece's centre, as mm along the wall. Throws an Error
 * (worded for the LLM) when the run doesn't fit.
 */
export function packRun(
  room: Room,
  items: PlacedItem[],
  wallIndex: number,
  pieces: RunPiece[],
  from: RunFrom,
  label: { item: (it: PlacedItem) => string; opening: (o: Opening) => string }
): number[] {
  const n = room.polygon.length;
  const a = room.polygon[wallIndex] as Point;
  const b = room.polygon[(wallIndex + 1) % n] as Point;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const u: Point = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const nrm = inwardNormal(room, wallIndex);
  const along = (p: Point) => (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1];
  const perp = (p: Point) => (p[0] - a[0]) * nrm[0] + (p[1] - a[1]) * nrm[1];

  const wallId = room.walls[wallIndex].id;
  const obstacles: Obstacle[] = room.openings
    .filter((o) => o.wallId === wallId)
    .map((o) => ({ from: o.positionMm, to: o.positionMm + o.widthMm, depth: 0, band: openingBand(o), label: label.opening(o) }));
  for (const it of items) {
    const corners = rotatedRectFootprint([it.position.x, it.position.y], it.sizeMm.w, it.sizeMm.d, it.rotationDeg);
    const alongs = corners.map(along);
    const perps = corners.map(perp);
    const [lo, hi] = [Math.min(...alongs), Math.max(...alongs)];
    // Behind the wall (the other arm of an L-shaped room) or off its ends: not in the way.
    if (Math.max(...perps) <= EPS || hi <= EPS || lo >= len - EPS) continue;
    obstacles.push({
      from: lo,
      to: hi,
      depth: Math.max(0, Math.min(...perps)),
      band: bandOf(it.mount, it.sizeMm.h),
      label: label.item(it),
    });
  }

  const existing = [...obstacles];
  const total = pieces.reduce((s, p) => s + p.sizeMm.w, 0);
  const inTheWay = (p: RunPiece) => {
    const band = bandOf(p.mount, p.sizeMm.h);
    return obstacles.filter((o) => o.depth < p.sizeMm.d - EPS && clash(o.band, band));
  };
  const overlapping = (list: Obstacle[], s: number, e: number) => list.filter((o) => o.from < e - EPS && o.to > s + EPS);
  const fail = (p: RunPiece): never => {
    // Report against what was there before this run, so the model can resize the whole run.
    const band = bandOf(p.mount, p.sizeMm.h);
    const taken = existing
      .filter((o) => o.depth < p.sizeMm.d - EPS && clash(o.band, band))
      .map((o) => ({ ...o, from: Math.max(0, o.from), to: Math.min(len, o.to) }))
      .sort((x, y) => x.from - y.from);
    const free: Array<[number, number]> = [];
    let cursor = 0;
    for (const o of taken) {
      if (o.from > cursor + EPS) free.push([cursor, o.from]);
      cursor = Math.max(cursor, o.to);
    }
    if (len > cursor + EPS) free.push([cursor, len]);
    const freeMm = free.reduce((s, [x, y]) => s + y - x, 0);
    const widest = free.reduce((m, [x, y]) => Math.max(m, y - x), 0);
    throw new Error(
      `the items add up to ${r(total)} mm but ${p.catalogId} (${p.sizeMm.w} mm) does not fit on this ${r(len)} mm wall: ` +
        (free.length ? `free space is ${free.map(([x, y]) => `${r(x)}–${r(y)} mm`).join(' and ')} (${r(freeMm)} mm in total, at most ${r(widest)} mm in one piece)` : 'there is no free space') +
        (taken.length ? `; in the way: ${taken.map((o) => `${o.label} at ${r(o.from)}–${r(o.to)} mm`).join(', ')}` : '') +
        '. Use fewer or narrower items, or another wall.'
    );
  };
  const centres: number[] = new Array(pieces.length);
  const place = (k: number, s: number) => {
    const p = pieces[k];
    centres[k] = s + p.sizeMm.w / 2;
    obstacles.push({ from: s, to: s + p.sizeMm.w, depth: 0, band: bandOf(p.mount, p.sizeMm.h), label: p.catalogId });
  };

  if (from === 'end') {
    let end = len;
    for (let k = pieces.length - 1; k >= 0; k--) {
      const p = pieces[k];
      const blockers = inTheWay(p);
      for (let hit = overlapping(blockers, end - p.sizeMm.w, end); hit.length; hit = overlapping(blockers, end - p.sizeMm.w, end)) {
        end = Math.min(...hit.map((o) => o.from));
      }
      if (end - p.sizeMm.w < -EPS) fail(p);
      place(k, end - p.sizeMm.w);
      end -= p.sizeMm.w;
    }
  } else {
    let start = from === 'centre' ? Math.max(0, (len - total) / 2) : 0;
    pieces.forEach((p, k) => {
      const blockers = inTheWay(p);
      for (let hit = overlapping(blockers, start, start + p.sizeMm.w); hit.length; hit = overlapping(blockers, start, start + p.sizeMm.w)) {
        start = Math.max(...hit.map((o) => o.to));
      }
      if (start + p.sizeMm.w > len + EPS) fail(p);
      place(k, start);
      start += p.sizeMm.w;
    });
  }
  return centres;
}
