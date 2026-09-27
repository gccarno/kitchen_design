/**
 * Editing the room outline while keeping walls, openings, and measurements
 * consistent. Walls are derived from polygon edges (wall i = edge i → i+1),
 * so every vertex edit also has to split, merge, or resize walls — and move
 * the openings that sit on them. All functions are pure.
 */

import { distance, type Point } from './geometry';
import type { Opening, Room } from './schemas';

const SAME_POINT_MM = 1;
/** A wall whose length changed by more than this loses its measurement. */
const LENGTH_CHANGE_MM = 0.5;

const edge = (room: Room, i: number): [Point, Point] => {
  const n = room.polygon.length;
  return [room.polygon[i] as Point, room.polygon[(i + 1) % n] as Point];
};

/** Shift an opening along its wall so it fits (if it can); width is never changed. */
function fit(positionMm: number, widthMm: number, wallMm: number): number {
  return Math.min(Math.max(positionMm, 0), Math.max(wallMm - widthMm, 0));
}

function dropMeasurements(room: Room, wallIds: Set<string>): Room['measurements'] {
  if (!room.measurements) return undefined;
  return room.measurements.filter((m) => !wallIds.has(m.wallId));
}

function withMeasurements(room: Room, measurements: Room['measurements']): Room {
  const { measurements: _old, ...rest } = room;
  return measurements === undefined ? rest : { ...rest, measurements };
}

/**
 * Add a corner on edge `edgeIndex`. `point` is projected onto the edge so
 * the outline keeps its shape. The wall splits in two: the original id keeps
 * the first part, `newWallId` takes the second. Openings go to the part
 * holding their centre.
 */
export function insertVertex(room: Room, edgeIndex: number, point: Point, newWallId: string): Room {
  const [a, b] = edge(room, edgeIndex);
  const len = distance(a, b);
  const t = len === 0 ? 0 : Math.min(1, Math.max(0, ((point[0] - a[0]) * (b[0] - a[0]) + (point[1] - a[1]) * (b[1] - a[1])) / (len * len)));
  const p: Point = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  const firstLen = distance(a, p);
  const secondLen = len - firstLen;
  if (firstLen < SAME_POINT_MM || secondLen < SAME_POINT_MM) {
    throw new Error('a new corner must not sit on an existing corner');
  }

  const splitWall = room.walls[edgeIndex];
  const polygon = [...room.polygon];
  polygon.splice(edgeIndex + 1, 0, p);
  const walls = [...room.walls];
  walls.splice(edgeIndex + 1, 0, { id: newWallId, thicknessMm: splitWall.thicknessMm });

  const openings = room.openings.map((o): Opening => {
    if (o.wallId !== splitWall.id) return o;
    const centre = o.positionMm + o.widthMm / 2;
    return centre <= firstLen
      ? { ...o, positionMm: fit(o.positionMm, o.widthMm, firstLen) }
      : { ...o, wallId: newWallId, positionMm: fit(o.positionMm - firstLen, o.widthMm, secondLen) };
  });

  return withMeasurements(
    { ...room, polygon, walls, openings },
    dropMeasurements(room, new Set([splitWall.id]))
  );
}

/**
 * Remove corner `vertexIndex`, merging the wall that ends there with the
 * wall that starts there. The earlier wall keeps its id. Openings keep their
 * place along the old two-wall path, mapped proportionally onto the merged wall.
 */
export function removeVertex(room: Room, vertexIndex: number): Room {
  const n = room.polygon.length;
  if (n <= 3) throw new Error('a room needs at least three corners');
  const prevIndex = (vertexIndex - 1 + n) % n;
  const kept = room.walls[prevIndex];
  const removed = room.walls[vertexIndex];
  const prevLen = distance(...edge(room, prevIndex));
  const pathLen = prevLen + distance(...edge(room, vertexIndex));

  const polygon = room.polygon.filter((_, i) => i !== vertexIndex);
  const walls = room.walls.filter((_, i) => i !== vertexIndex);
  const merged: Room = { ...room, polygon, walls };
  const keptIndex = walls.indexOf(kept);
  const mergedLen = distance(...edge(merged, keptIndex));

  const openings = room.openings.map((o): Opening => {
    if (o.wallId !== kept.id && o.wallId !== removed.id) return o;
    const along = o.wallId === kept.id ? o.positionMm : prevLen + o.positionMm;
    const position = pathLen === 0 ? 0 : (along / pathLen) * mergedLen;
    return { ...o, wallId: kept.id, positionMm: fit(position, o.widthMm, mergedLen) };
  });

  return withMeasurements({ ...merged, openings }, dropMeasurements(room, new Set([kept.id, removed.id])));
}

/**
 * Move corner `vertexIndex` to `point`. Openings on the two adjacent walls
 * keep their relative position; measurements of walls whose length changed
 * are dropped (they no longer describe the drawn wall).
 */
export function moveVertex(room: Room, vertexIndex: number, point: Point): Room {
  const n = room.polygon.length;
  const affected = [(vertexIndex - 1 + n) % n, vertexIndex];
  const before = new Map(affected.map((i) => [room.walls[i].id, distance(...edge(room, i))]));

  const polygon = room.polygon.map((p, i) => (i === vertexIndex ? point : p));
  const moved: Room = { ...room, polygon };
  const after = new Map(affected.map((i) => [room.walls[i].id, distance(...edge(moved, i))]));

  const openings = room.openings.map((o): Opening => {
    const oldLen = before.get(o.wallId);
    const newLen = after.get(o.wallId);
    if (oldLen === undefined || newLen === undefined) return o;
    const position = oldLen === 0 ? 0 : (o.positionMm * newLen) / oldLen;
    return { ...o, positionMm: fit(position, o.widthMm, newLen) };
  });

  const changed = new Set([...before].filter(([id, len]) => Math.abs(after.get(id)! - len) > LENGTH_CHANGE_MM).map(([id]) => id));
  return withMeasurements({ ...moved, openings }, dropMeasurements(room, changed));
}
