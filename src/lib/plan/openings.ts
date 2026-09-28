/**
 * Doors, windows, and pass-throughs on walls. An opening is a span
 * [positionMm, positionMm + widthMm] along its wall, measured from the
 * wall's start vertex. Every edit keeps openings inside their wall and
 * off each other. All functions are pure.
 */

import { distance, type Point } from './geometry';
import type { Opening, OpeningKind, Room } from './schemas';

export const OPENING_DEFAULTS: Record<OpeningKind, { widthMm: number; heightMm: number }> = {
  door: { widthMm: 800, heightMm: 2100 },
  window: { widthMm: 1200, heightMm: 1200 },
  pass_through: { widthMm: 900, heightMm: 2100 },
};

export const MIN_OPENING_MM = 300;

export const OPENING_LABEL: Record<OpeningKind, string> = {
  door: 'door',
  window: 'window',
  pass_through: 'pass-through',
};

function wallEnds(room: Room, index: number): [Point, Point] {
  const n = room.polygon.length;
  return [room.polygon[index] as Point, room.polygon[(index + 1) % n] as Point];
}

export function wallIndexOf(room: Room, wallId: string): number {
  const i = room.walls.findIndex((w) => w.id === wallId);
  if (i < 0) throw new Error(`unknown wall "${wallId}"`);
  return i;
}

/** The closest point on any wall: which wall, how far along it, and how far away. */
export function nearestWallPoint(room: Room, p: Point): { wallIndex: number; alongMm: number; distanceMm: number } {
  let best = { wallIndex: 0, alongMm: 0, distanceMm: Infinity };
  for (let i = 0; i < room.polygon.length; i++) {
    const [a, b] = wallEnds(room, i);
    const len = distance(a, b);
    if (len === 0) continue;
    const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (len * len)));
    const q: Point = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    const d = distance(p, q);
    if (d < best.distanceMm) best = { wallIndex: i, alongMm: t * len, distanceMm: d };
  }
  return best;
}

/** How far along wall `wallIndex` the projection of `p` falls; not clamped to the wall. */
export function alongWallMm(room: Room, wallIndex: number, p: Point): number {
  const [a, b] = wallEnds(room, wallIndex);
  const len = distance(a, b);
  return len === 0 ? 0 : ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / len;
}

/** The free span on the opening's wall between its neighbours (or the wall ends). */
function freeSpan(room: Room, o: Opening): [number, number] {
  const len = distance(...wallEnds(room, wallIndexOf(room, o.wallId)));
  let lo = 0;
  let hi = len;
  for (const other of room.openings) {
    if (other.id === o.id || other.wallId !== o.wallId) continue;
    if (other.positionMm < o.positionMm) lo = Math.max(lo, other.positionMm + other.widthMm);
    else hi = Math.min(hi, other.positionMm);
  }
  return [lo, hi];
}

function replace(room: Room, id: string, change: (o: Opening) => Opening): Room {
  if (!room.openings.some((o) => o.id === id)) throw new Error(`unknown opening "${id}"`);
  return { ...room, openings: room.openings.map((o) => (o.id === id ? change(o) : o)) };
}

/**
 * Add a default-size opening of `kind` centred `centreMm` along wall
 * `wallIndex`, shifted (and, on a short wall, narrowed) to fit. Throws if it
 * would overlap another opening or the wall is too short.
 */
export function addOpening(room: Room, wallIndex: number, centreMm: number, kind: OpeningKind, id: string): Room {
  const len = distance(...wallEnds(room, wallIndex));
  if (len < MIN_OPENING_MM) throw new Error(`that wall is too short for a ${OPENING_LABEL[kind]}`);
  const { widthMm: defaultWidth, heightMm } = OPENING_DEFAULTS[kind];
  const widthMm = Math.min(defaultWidth, len);
  const positionMm = Math.min(Math.max(centreMm - widthMm / 2, 0), len - widthMm);
  const wallId = room.walls[wallIndex].id;

  const clash = room.openings.find(
    (o) => o.wallId === wallId && positionMm < o.positionMm + o.widthMm && o.positionMm < positionMm + widthMm
  );
  if (clash) throw new Error(`it would overlap the ${OPENING_LABEL[clash.kind]} already on that wall`);

  return { ...room, openings: [...room.openings, { id, wallId, kind, positionMm, widthMm, heightMm }] };
}

/** Slide an opening so it starts at `positionMm`, stopping at the wall ends and neighbours. */
export function moveOpening(room: Room, id: string, positionMm: number): Room {
  return replace(room, id, (o) => {
    const [lo, hi] = freeSpan(room, o);
    return { ...o, positionMm: Math.min(Math.max(positionMm, lo), Math.max(hi - o.widthMm, lo)) };
  });
}

/**
 * Drag one edge of an opening to `alongMm` (distance along the wall). The
 * other edge stays put; width never drops below MIN_OPENING_MM and the
 * edge stops at the wall ends and neighbours.
 */
export function resizeOpening(room: Room, id: string, edge: 'start' | 'end', alongMm: number): Room {
  return replace(room, id, (o) => {
    const [lo, hi] = freeSpan(room, o);
    const start = o.positionMm;
    const end = o.positionMm + o.widthMm;
    if (edge === 'end') {
      const newEnd = Math.min(Math.max(alongMm, start + MIN_OPENING_MM), hi);
      return { ...o, widthMm: newEnd - start };
    }
    const newStart = Math.max(Math.min(alongMm, end - MIN_OPENING_MM), lo);
    return { ...o, positionMm: newStart, widthMm: end - newStart };
  });
}

export function removeOpening(room: Room, id: string): Room {
  return { ...room, openings: room.openings.filter((o) => o.id !== id) };
}
