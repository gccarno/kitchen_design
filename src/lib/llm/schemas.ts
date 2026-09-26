import { z } from 'zod';
import { distance, polygonSelfIntersects, signedPolygonArea, type Point } from '../plan/geometry';
import type { CheckResult } from '../result';

/** The kind of opening cut into a wall. */
export const OpeningKindSchema = z.enum(['door', 'window', 'pass_through']);
export type OpeningKind = z.infer<typeof OpeningKindSchema>;

/** walls[i] is the polygon edge polygonMm[i] → polygonMm[(i + 1) % n]. */
const ExtractedWallSchema = z.object({
  thicknessMm: z.number().positive(),
});

/** One opening on a wall. `wallIdx` is the index into the walls array (= edge index). */
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
  /**
   * For each user measurement (in order), the index of the wall it measures.
   * Lets the server rescale the outline so measured walls come out exact.
   */
  measuredWalls: z.array(z.number().int().nonnegative()).default([]),
  /** Free-form notes for the user. */
  notes: z.string(),
});
export type ExtractedRoom = z.infer<typeof ExtractedRoomSchema>;

/**
 * Cross-field validation for an ExtractedRoom. Use AFTER `ExtractedRoomSchema.parse`
 * to confirm the room is geometrically plausible: one wall per edge, openings
 * on real walls and within their length, polygon simple with non-zero area.
 */
export function refineExtractedRoom(
  room: ExtractedRoom,
  opts: { measurementCount?: number } = {}
): CheckResult<ExtractedRoom> {
  const issues: string[] = [];
  const poly = room.polygonMm as Point[];
  const n = poly.length;

  const expected = opts.measurementCount ?? 0;
  if (room.measuredWalls.length !== expected) {
    issues.push(
      `measuredWalls has ${room.measuredWalls.length} entries but there are ${expected} measurements; give exactly one wall index per measurement`
    );
  }
  room.measuredWalls.forEach((w, i) => {
    if (w >= n) issues.push(`measuredWalls[${i}] is ${w}, but walls are numbered 0..${n - 1}`);
  });

  if (room.walls.length !== n) {
    issues.push(`got ${room.walls.length} walls but polygonMm has ${n} edges; return exactly one wall per edge`);
  }

  room.openings.forEach((o, i) => {
    if (o.wallIdx >= n) {
      issues.push(`openings[${i}] references out-of-range wall index ${o.wallIdx} (polygon has ${n} edges)`);
      return;
    }
    const len = distance(poly[o.wallIdx], poly[(o.wallIdx + 1) % n]);
    if (o.positionMm + o.widthMm > len + 1) {
      issues.push(
        `openings[${i}] runs past the end of wall ${o.wallIdx} (${o.positionMm} + ${o.widthMm} > ${Math.round(len)} mm)`
      );
    }
  });

  if (polygonSelfIntersects(poly)) {
    issues.push('polygonMm is self-intersecting');
  }
  if (Math.abs(signedPolygonArea(poly)) < 1) {
    issues.push('polygonMm has zero area (vertices are collinear)');
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: room };
}
