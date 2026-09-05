import { z } from 'zod';

/** The kind of opening cut into a wall. */
export const OpeningKindSchema = z.enum(['door', 'window', 'pass_through']);
export type OpeningKind = z.infer<typeof OpeningKindSchema>;

/** One wall described as indices into the polygon vertex list. */
const ExtractedWallSchema = z.object({
  fromIdx: z.number().int().nonnegative(),
  toIdx: z.number().int().nonnegative(),
  thicknessMm: z.number().positive(),
});

/** One opening on a wall. `wallIdx` is the index into the walls array. */
const ExtractedOpeningSchema = z.object({
  wallIdx: z.number().int().nonnegative(),
  kind: OpeningKindSchema,
  positionMm: z.number().min(0),
  widthMm: z.number().positive(),
  heightMm: z.number().positive(),
});

/**
 * The shape we expect the vision LLM to return when extracting a room
 * from photos. Units are always millimetres — we convert at the call site
 * if the project uses inches.
 */
export const ExtractedRoomSchema = z.object({
  /** How confident the model is in the extraction (0..1). UI surfaces this. */
  confidence: z.number().min(0).max(1),
  /**
   * Room outline in mm, plan coordinates. Vertex order is significant
   * (counter-clockwise is conventional but we don't enforce it here).
   * At least 3 vertices.
   */
  polygonMm: z.array(z.tuple([z.number(), z.number()])).min(3),
  walls: z.array(ExtractedWallSchema),
  openings: z.array(ExtractedOpeningSchema),
  /** Free-form notes for the user. */
  notes: z.string(),
});
export type ExtractedRoom = z.infer<typeof ExtractedRoomSchema>;

/**
 * Result of refining a parsed ExtractedRoom with cross-field checks.
 * The schema only validates per-field shape; this checks semantic
 * consistency (indices in range, polygon not self-intersecting, area > 0).
 */
export type RefineResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: string[] };

/**
 * Cross-field validation for an ExtractedRoom. Use AFTER `ExtractedRoomSchema.parse`
 * to confirm the room is geometrically plausible. This is intentionally
 * minimal — the full geometry module is in `src/lib/plan/geometry.ts` (Task 6).
 */
export function refineExtractedRoom(room: ExtractedRoom): RefineResult<ExtractedRoom> {
  const issues: string[] = [];

  // Wall vertex indices in range.
  const n = room.polygonMm.length;
  for (let i = 0; i < room.walls.length; i++) {
    const w = room.walls[i];
    if (w.fromIdx >= n || w.toIdx >= n) {
      issues.push(
        `walls[${i}] references out-of-range vertex index (polygonMm has ${n} vertices, got fromIdx=${w.fromIdx}, toIdx=${w.toIdx})`
      );
    }
  }

  // Opening wall index in range.
  const wn = room.walls.length;
  for (let i = 0; i < room.openings.length; i++) {
    const o = room.openings[i];
    if (o.wallIdx >= wn) {
      issues.push(
        `openings[${i}] references out-of-range wall index (walls has ${wn} entries, got wallIdx=${o.wallIdx})`
      );
    }
  }

  // Polygon not self-intersecting (segments only). Cheap O(n) sweep via
  // segment-segment intersection.
  if (anySegmentsIntersect(room.polygonMm)) {
    issues.push('polygonMm is self-intersecting');
  }

  // Non-zero area (shoelace). Zero-area means the vertices are collinear.
  if (signedArea(room.polygonMm) === 0) {
    issues.push('polygonMm has zero area (vertices are collinear)');
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, value: room };
}

/** Signed area via the shoelace formula. Positive = CCW in screen coords. */
function signedArea(poly: ReadonlyArray<readonly [number, number]>): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

/**
 * True if any pair of non-adjacent polygon edges intersect. Adjacent edges
 * share a vertex and are allowed to touch there.
 */
function anySegmentsIntersect(poly: ReadonlyArray<readonly [number, number]>): boolean {
  const segs: Array<[[number, number], [number, number]]> = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as [number, number];
    const b = poly[(i + 1) % poly.length] as [number, number];
    segs.push([a, b]);
  }
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 2; j < segs.length; j++) {
      // Skip wrap-around adjacency (last edge touches first vertex).
      if (i === 0 && j === segs.length - 1) continue;
      if (segsIntersect(segs[i], segs[j])) return true;
    }
  }
  return false;
}

/** Standard orientation-based segment intersection test. */
function segsIntersect(
  s1: readonly [[number, number], [number, number]],
  s2: readonly [[number, number], [number, number]]
): boolean {
  const [p1, p2] = s1;
  const [p3, p4] = s2;
  const d1 = cross(p4, p3, p1);
  const d2 = cross(p4, p3, p2);
  const d3 = cross(p2, p1, p3);
  const d4 = cross(p2, p1, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return false;
}

function cross(o: readonly [number, number], a: readonly [number, number], b: readonly [number, number]): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}
