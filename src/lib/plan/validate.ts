/**
 * Semantic plan validation. `ProjectSchema` only checks per-field shape;
 * `validatePlan` checks cross-field consistency and geometry plausibility.
 *
 * Returns `{ valid, errors, warnings }` so the UI can:
 *   - block save when `errors` is non-empty
 *   - surface `warnings` (e.g. overlapping items) but let the user proceed
 */

import {
  convexPolygonsOverlap,
  distance,
  pointInPolygon,
  pointToSegmentDistance,
  polygonSelfIntersects,
  rotateAround,
  rotatedRectFootprint,
  signedPolygonArea,
  type Point,
} from './geometry';
import type { Mount, PlacedItem, Project, Room } from './schemas';
import { inwardNormal } from './walls';

export interface PlanValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** Length of wall i, i.e. polygon edge i → i+1. */
export function wallLengthMm(room: Room, wallIndex: number): number {
  const poly = room.polygon as Point[];
  return distance(poly[wallIndex], poly[(wallIndex + 1) % poly.length]);
}

export function validatePlan(plan: Project): PlanValidationResult {
  return validateRoom(plan.room, plan.items);
}

/** The checks behind `validatePlan`, for a candidate room (e.g. mid-edit) and the items in it. */
export function validateRoom(room: Room, items: PlacedItem[] = []): PlanValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const poly = room.polygon as Point[];

  // --- Room polygon ---
  if (poly.length < 3) {
    errors.push(`room polygon has ${poly.length} vertices; need at least 3`);
  } else {
    if (polygonSelfIntersects(poly)) {
      errors.push('room polygon is self-intersecting');
    }
    if (Math.abs(signedPolygonArea(poly)) < 1) {
      errors.push('room polygon has zero area (vertices appear collinear)');
    }
  }

  // --- Walls: one per polygon edge ---
  if (room.walls.length !== poly.length) {
    errors.push(`room has ${room.walls.length} walls but the polygon has ${poly.length} edges`);
  }
  const wallIndexById = new Map<string, number>();
  room.walls.forEach((w, i) => {
    if (wallIndexById.has(w.id)) {
      errors.push(`duplicate wall id "${w.id}" at index ${i}`);
    } else {
      wallIndexById.set(w.id, i);
    }
  });
  const wallLength = (id: string): number | undefined => {
    const i = wallIndexById.get(id);
    return i === undefined || i >= poly.length ? undefined : wallLengthMm(room, i);
  };

  // --- Openings ---
  for (const o of room.openings) {
    const len = wallLength(o.wallId);
    if (len === undefined) {
      errors.push(`opening "${o.id}" references unknown wall "${o.wallId}"`);
    } else if (o.positionMm + o.widthMm > len + 1) {
      errors.push(
        `opening "${o.id}" runs past the end of wall "${o.wallId}" (${o.positionMm} + ${o.widthMm} > ${Math.round(len)} mm)`
      );
    }
  }

  // Openings on the same wall must not overlap (touching end to end is fine).
  const byWall = new Map<string, typeof room.openings>();
  for (const o of room.openings) byWall.set(o.wallId, [...(byWall.get(o.wallId) ?? []), o]);
  for (const [wallId, list] of byWall) {
    const sorted = [...list].sort((p, q) => p.positionMm - q.positionMm);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      if (sorted[i].positionMm < prev.positionMm + prev.widthMm - 0.5) {
        errors.push(`openings "${prev.id}" and "${sorted[i].id}" overlap on wall "${wallId}"`);
      }
    }
  }

  // --- Measurements ---
  for (const m of room.measurements ?? []) {
    if (!wallIndexById.has(m.wallId)) {
      errors.push(`measurement references unknown wall "${m.wallId}"`);
    }
  }

  // --- Items ---
  // Items are named by catalog id in messages: users don't know the UUIDs.
  const label = (it: PlacedItem) => `"${it.catalogId}"`;
  const itemIds = new Set<string>();
  const placed: Array<{ item: PlacedItem; mount: Mount; poly: Point[] }> = [];
  items.forEach((it, i) => {
    if (itemIds.has(it.id)) {
      errors.push(`duplicate placed item id "${it.id}" at index ${i}`);
    }
    itemIds.add(it.id);

    const center: Point = [it.position.x, it.position.y];
    const footprint = rotatedRectFootprint(center, it.sizeMm.w, it.sizeMm.d, it.rotationDeg);
    placed.push({ item: it, mount: it.mount ?? 'floor', poly: footprint });

    if (poly.length < 3) return;
    if (!pointInPolygon(center, poly)) {
      errors.push(`${label(it)} is outside the room`);
    } else if (!footprint.every((c) => insideOrOnPerimeter(c, poly))) {
      warnings.push(`${label(it)} extends outside the room`);
    }
  });

  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      // Items at different levels (floor / counter / wall) can stack.
      if (placed[i].mount !== placed[j].mount) continue;
      if (convexPolygonsOverlap(placed[i].poly, placed[j].poly)) {
        warnings.push(`${label(placed[i].item)} and ${label(placed[j].item)} overlap`);
      }
    }
  }

  // --- Clearances (floor space only: wall-mounted items don't block it) ---
  const floorItems = placed.filter((p) => p.mount === 'floor');
  /** The first floor item (other than `self`) overlapping `zone`. */
  const blocker = (zone: Point[], self: PlacedItem) =>
    floorItems.find((p) => p.item !== self && convexPolygonsOverlap(zone, p.poly))?.item;
  const outsideRoom = (zone: Point[]) => poly.length >= 3 && !zone.every((c) => insideOrOnPerimeter(c, poly));

  for (const { item: it } of placed) {
    const c = it.clearanceMm;
    if (!c || poly.length < 3) continue;
    const { w, d } = it.sizeMm;
    if (c.front > 0) {
      const front = zone(it, [0, d / 2 + c.front / 2], w, c.front);
      const other = blocker(front, it);
      if (other) warnings.push(`not enough room in front of ${label(it)}: ${label(other)} is in the way`);
      else if (outsideRoom(front)) warnings.push(`not enough room in front of ${label(it)}: it faces a wall`);
    }
    if (c.sides > 0) {
      const sides = [-1, 1].map((k) => zone(it, [k * (w / 2 + c.sides / 2), 0], c.sides, d));
      const other = sides.map((z) => blocker(z, it)).find(Boolean);
      if (other) warnings.push(`${label(it)} needs ${c.sides} mm at its sides: ${label(other)} is too close`);
      else if (sides.some(outsideRoom)) warnings.push(`${label(it)} needs ${c.sides} mm at its sides: a wall is too close`);
    }
  }

  // --- Door swings: a door opening into the room sweeps a square as wide as the door ---
  for (const o of room.openings) {
    if (o.kind !== 'door') continue;
    const i = wallIndexById.get(o.wallId);
    if (i === undefined || i >= poly.length) continue;
    const [a, b] = [poly[i], poly[(i + 1) % poly.length]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const [ux, uy] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const [nx, ny] = inwardNormal(room, i);
    const along = o.positionMm + o.widthMm / 2;
    const centre: Point = [a[0] + ux * along + nx * (o.widthMm / 2), a[1] + uy * along + ny * (o.widthMm / 2)];
    const swing = rotatedRectFootprint(centre, o.widthMm, o.widthMm, (Math.atan2(uy, ux) * 180) / Math.PI);
    for (const p of floorItems) {
      if (convexPolygonsOverlap(swing, p.poly)) warnings.push(`the door on wall ${i + 1} would hit ${label(p.item)}`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// --- internals ---

/**
 * A w × d rectangle in an item's local frame (width along x, front at +y),
 * centred at `offset` from the item's centre, in world coordinates.
 */
function zone(it: PlacedItem, offset: Point, w: number, d: number): Point[] {
  const centre: Point = [it.position.x, it.position.y];
  const at = rotateAround([centre[0] + offset[0], centre[1] + offset[1]], centre, it.rotationDeg);
  return rotatedRectFootprint(at, w, d, it.rotationDeg);
}

const PERIMETER_EPSILON_MM = 1;

/** Inside the polygon, or within 1mm of its edge (items sit flush against walls). */
function insideOrOnPerimeter(p: Point, poly: ReadonlyArray<Point>): boolean {
  if (pointInPolygon(p, poly)) return true;
  for (let i = 0; i < poly.length; i++) {
    if (pointToSegmentDistance(p, poly[i], poly[(i + 1) % poly.length]) < PERIMETER_EPSILON_MM) return true;
  }
  return false;
}
