import { z } from 'zod';

// Primitives
const Point = z.tuple([z.number(), z.number()]);
const Units = z.enum(['mm', 'in']);

// Reference object: a known-size thing the user drew a box around on a photo,
// which lets us compute a pixel-to-mm scale for the rest of the image.
export const ReferenceObjectKind = z.enum([
  'credit_card',
  'a4_paper',
  'us_letter',
  'tape_measure',
  'coin_us_quarter',
  'custom',
]);
export type ReferenceObjectKind = z.infer<typeof ReferenceObjectKind>;

// A wall is a directed segment along the room polygon perimeter, with a thickness.
const WallSchema = z.object({
  id: z.string().min(1),
  from: Point,
  to: Point,
  thicknessMm: z.number().positive(),
});

// An opening (door / window / pass-through) sits on a wall.
const OpeningSchema = z.object({
  id: z.string().min(1),
  wallId: z.string().min(1),
  kind: z.enum(['door', 'window', 'pass_through']),
  positionMm: z.number().min(0),
  widthMm: z.number().positive(),
  heightMm: z.number().positive(),
});

// The room is a polygon (in mm, plan coords) with walls and openings.
const RoomSchema = z.object({
  polygon: z.array(Point).min(3),
  walls: z.array(WallSchema),
  openings: z.array(OpeningSchema),
});

// A photo with optional reference object for scale and optional wall hint.
const PhotoSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  referenceObject: z
    .object({
      kind: ReferenceObjectKind,
      knownSizeMm: z.number().positive(),
      customSizeMm: z.number().positive().optional(),
      pixelBox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    })
    .optional(),
  wallHint: z.enum(['north', 'east', 'south', 'west', 'unknown']).optional(),
});

// A single JSON-Patch op (RFC 6902) — produced by the LLM and applied on user confirm.
const JsonPatchOpSchema = z.object({
  op: z.enum(['add', 'remove', 'replace', 'move', 'copy', 'test']),
  path: z.string(),
  value: z.unknown().optional(),
  from: z.string().optional(),
});
export type JsonPatchOp = z.infer<typeof JsonPatchOpSchema>;

// An item placed on the plan from the catalog.
const PlacedItemSchema = z.object({
  id: z.string().min(1),
  catalogId: z.string().min(1),
  position: z.object({ x: z.number(), y: z.number() }),
  rotationDeg: z.number(),
  tag: z.string().optional(),
});

// One entry in the undo stack.
const PlanRevisionSchema = z.object({
  revision: z.number().int().nonnegative(),
  patch: z.array(JsonPatchOpSchema),
  at: z.string().min(1),
  source: z.enum(['user', 'llm']),
  summary: z.string(),
});

// Top-level project document. Single source of truth, versioned via `revision`.
export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  units: Units,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  revision: z.number().int().nonnegative(),
  photos: z.array(PhotoSchema),
  room: RoomSchema,
  items: z.array(PlacedItemSchema),
  history: z.array(PlanRevisionSchema),
});
export type Project = z.infer<typeof ProjectSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type Wall = z.infer<typeof WallSchema>;
export type Opening = z.infer<typeof OpeningSchema>;
export type PlacedItem = z.infer<typeof PlacedItemSchema>;
export type Photo = z.infer<typeof PhotoSchema>;
export type PlanRevision = z.infer<typeof PlanRevisionSchema>;
