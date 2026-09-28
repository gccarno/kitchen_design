/**
 * Wall geometry. The room polygon is the INTERIOR face of the walls (tape
 * measurements are taken inside), so each wall's body extends outward from
 * its polygon edge by its thickness.
 */

import { signedPolygonArea, type Point } from './geometry';
import type { Room } from './schemas';

/** Unit normal of wall `i` pointing into the room. */
export function inwardNormal(room: Room, i: number): Point {
  const n = room.polygon.length;
  const [a, b] = [room.polygon[i], room.polygon[(i + 1) % n]];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  // The left-hand normal points inside when the signed area is positive.
  const sign = signedPolygonArea(room.polygon as Point[]) >= 0 ? 1 : -1;
  return [(-(b[1] - a[1]) / len) * sign, ((b[0] - a[0]) / len) * sign];
}

/**
 * Each wall as a quadrilateral [innerStart, innerEnd, outerEnd, outerStart].
 * Outer corners are mitred: the intersection of adjacent walls' outer
 * faces, which is right for both convex and concave corners.
 */
export function wallQuads(room: Room): [Point, Point, Point, Point][] {
  const n = room.polygon.length;
  const poly = room.polygon as Point[];
  // Outer face of wall i: a point on it and its direction.
  const outer = poly.map((a, i) => {
    const b = poly[(i + 1) % n];
    const [nx, ny] = inwardNormal(room, i);
    const t = room.walls[i]?.thicknessMm ?? 0;
    return { p: [a[0] - nx * t, a[1] - ny * t] as Point, dir: [b[0] - a[0], b[1] - a[1]] as Point, t, nx, ny };
  });

  // Outer corner at vertex i, between wall i-1 and wall i.
  const corner = (i: number): Point => {
    const prev = outer[(i - 1 + n) % n];
    const cur = outer[i];
    const hit = intersect(prev.p, prev.dir, cur.p, cur.dir);
    // Parallel (straight run): just offset the vertex by the current wall.
    return hit ?? [poly[i][0] - cur.nx * cur.t, poly[i][1] - cur.ny * cur.t];
  };

  return poly.map((a, i) => {
    const b = poly[(i + 1) % n];
    return [a, b, corner((i + 1) % n), corner(i)];
  });
}

function intersect(p: Point, d: Point, q: Point, e: Point): Point | null {
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [p[0] + d[0] * t, p[1] + d[1] * t];
}
