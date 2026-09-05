/**
 * Semantic plan validation. `ProjectSchema` only checks per-field shape;
 * `validatePlan` checks cross-field consistency and geometry plausibility.
 *
 * Returns `{ valid, errors, warnings }` so the UI can:
 *   - block save when `errors` is non-empty
 *   - surface `warnings` (e.g. overlapping items) but let the user proceed
 */

import { pointInPolygon, pointToSegmentDistance, rectsOverlap, type Point, type Rect } from './geometry';
import type { Project } from './schemas';

export interface PlanValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validatePlan(plan: Project): PlanValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // --- Room polygon ---
  const poly = plan.room.polygon as Point[];

  if (poly.length < 3) {
    errors.push(`room polygon has ${poly.length} vertices; need at least 3`);
  } else {
    if (polygonSelfIntersects(poly)) {
      errors.push('room polygon is self-intersecting');
    }
    if (Math.abs(signedArea(poly)) < 1) {
      errors.push('room polygon has zero area (vertices appear collinear)');
    }
  }

  // --- Walls ---
  const wallIds = new Set<string>();
  for (let i = 0; i < plan.room.walls.length; i++) {
    const w = plan.room.walls[i];
    if (wallIds.has(w.id)) {
      errors.push(`duplicate wall id "${w.id}" at index ${i}`);
    }
    wallIds.add(w.id);

    // Wall endpoints should lie on the polygon perimeter (within a
    // small tolerance). The `Project.Wall` schema stores absolute
    // coordinates, so we check distance to each polygon edge.
    if (!pointOnPerimeter(w.from, poly)) {
      errors.push(`wall "${w.id}".from (${w.from[0]}, ${w.from[1]}) is not on the polygon perimeter`);
    }
    if (!pointOnPerimeter(w.to, poly)) {
      errors.push(`wall "${w.id}".to (${w.to[0]}, ${w.to[1]}) is not on the polygon perimeter`);
    }
  }

  // --- Openings ---
  for (let i = 0; i < plan.room.openings.length; i++) {
    const o = plan.room.openings[i];
    if (!wallIds.has(o.wallId)) {
      errors.push(`opening "${o.id}" (index ${i}) references unknown wall "${o.wallId}"`);
    }
  }

  // --- Items ---
  const itemIds = new Set<string>();
  const itemRects: Array<{ id: string; rect: Rect }> = [];
  for (let i = 0; i < plan.items.length; i++) {
    const it = plan.items[i];
    if (itemIds.has(it.id)) {
      errors.push(`duplicate placed item id "${it.id}" at index ${i}`);
    }
    itemIds.add(it.id);

    if (poly.length >= 3 && !pointInPolygon([it.position.x, it.position.y], poly)) {
      errors.push(`placed item "${it.id}" position is outside the room polygon`);
    }

    // The item is treated as a 600×600mm box at its position for
    // collision purposes. (We don't have a catalog lookup here; a
    // future task will pass the real footprint in.)
    itemRects.push({
      id: it.id,
      rect: {
        x: it.position.x - 300,
        y: it.position.y - 300,
        w: 600,
        d: 600,
        rotationDeg: it.rotationDeg,
      },
    });
  }

  // Pairwise overlap warnings.
  for (let i = 0; i < itemRects.length; i++) {
    for (let j = i + 1; j < itemRects.length; j++) {
      if (rectsOverlap(itemRects[i].rect, itemRects[j].rect)) {
        warnings.push(
          `placed items "${itemRects[i].id}" and "${itemRects[j].id}" overlap`
        );
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// --- internals ---

function signedArea(poly: ReadonlyArray<Point>): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

/** True if any pair of non-adjacent polygon edges intersect. */
function polygonSelfIntersects(poly: ReadonlyArray<Point>): boolean {
  const segs: Array<[Point, Point]> = [];
  for (let i = 0; i < poly.length; i++) {
    segs.push([poly[i], poly[(i + 1) % poly.length]]);
  }
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 2; j < segs.length; j++) {
      if (i === 0 && j === segs.length - 1) continue;
      if (segsIntersect(segs[i], segs[j])) return true;
    }
  }
  return false;
}

function segsIntersect(s1: [Point, Point], s2: [Point, Point]): boolean {
  const [p1, p2] = s1;
  const [p3, p4] = s2;
  const d1 = cross(p4, p3, p1);
  const d2 = cross(p4, p3, p2);
  const d3 = cross(p2, p1, p3);
  const d4 = cross(p2, p1, p4);
  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  );
}

function cross(o: Point, a: Point, b: Point): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

const EPSILON_MM = 1; // 1 mm tolerance for "on the perimeter"

/** True if `p` is within 1mm of any polygon edge. */
function pointOnPerimeter(p: Point, poly: ReadonlyArray<Point>): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (pointToSegmentDistance(p, a, b) < EPSILON_MM) return true;
  }
  return false;
}
