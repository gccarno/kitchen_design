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
  rotatedRectFootprint,
  signedPolygonArea,
  type Point,
} from './geometry';
import type { PlacedItem, Project, Room } from './schemas';

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
  const itemIds = new Set<string>();
  const footprints: Array<{ id: string; poly: Point[] }> = [];
  items.forEach((it, i) => {
    if (itemIds.has(it.id)) {
      errors.push(`duplicate placed item id "${it.id}" at index ${i}`);
    }
    itemIds.add(it.id);

    const center: Point = [it.position.x, it.position.y];
    const footprint = rotatedRectFootprint(center, it.sizeMm.w, it.sizeMm.d, it.rotationDeg);
    footprints.push({ id: it.id, poly: footprint });

    if (poly.length < 3) return;
    if (!pointInPolygon(center, poly)) {
      errors.push(`placed item "${it.id}" is outside the room`);
    } else if (!footprint.every((c) => insideOrOnPerimeter(c, poly))) {
      warnings.push(`placed item "${it.id}" extends outside the room`);
    }
  });

  for (let i = 0; i < footprints.length; i++) {
    for (let j = i + 1; j < footprints.length; j++) {
      if (convexPolygonsOverlap(footprints[i].poly, footprints[j].poly)) {
        warnings.push(`placed items "${footprints[i].id}" and "${footprints[j].id}" overlap`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// --- internals ---

const PERIMETER_EPSILON_MM = 1;

/** Inside the polygon, or within 1mm of its edge (items sit flush against walls). */
function insideOrOnPerimeter(p: Point, poly: ReadonlyArray<Point>): boolean {
  if (pointInPolygon(p, poly)) return true;
  for (let i = 0; i < poly.length; i++) {
    if (pointToSegmentDistance(p, poly[i], poly[(i + 1) % poly.length]) < PERIMETER_EPSILON_MM) return true;
  }
  return false;
}
