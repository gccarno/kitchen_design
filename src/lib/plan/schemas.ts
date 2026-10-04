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
  'coin_us_quarter',
  'custom',
]);
export type ReferenceObjectKind = z.infer<typeof ReferenceObjectKind>;

// Which edge of the reference object the user's box measures.
export const ReferenceSide = z.enum(['long', 'short']);
export type ReferenceSide = z.infer<typeof ReferenceSide>;

// A resolved reference: `knownSizeMm` comes from `reference-objects.ts` (or
// the user's custom value) and `pixelBox` is [x1, y1, x2, y2] in NATURAL
// image pixels (not CSS pixels), with x1 < x2 and y1 < y2.
export const ReferenceObjectSchema = z.object({
  kind: ReferenceObjectKind,
  side: ReferenceSide,
  knownSizeMm: z.number().positive(),
  pixelBox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});
export type ReferenceObject = z.infer<typeof ReferenceObjectSchema>;

// Wall i is the polygon edge polygon[i] → polygon[(i + 1) % n]. Its geometry is
// derived from the polygon, never stored, so editing a vertex can't desync
// walls from the outline. `validatePlan` enforces walls.length === polygon.length.
const WallSchema = z.object({
  id: z.string().min(1),
  thicknessMm: z.number().positive(),
});

// The kind of opening cut into a wall.
export const OpeningKindSchema = z.enum(['door', 'window', 'pass_through']);
export type OpeningKind = z.infer<typeof OpeningKindSchema>;

// An opening (door / window / pass-through) sits on a wall.
const OpeningSchema = z.object({
  id: z.string().min(1),
  wallId: z.string().min(1),
  kind: OpeningKindSchema,
  positionMm: z.number().min(0),
  widthMm: z.number().positive(),
  heightMm: z.number().positive(),
});

// A user-measured wall length — the scale source of truth for extraction.
const MeasurementSchema = z.object({
  wallId: z.string().min(1),
  lengthMm: z.number().positive(),
  source: z.literal('user'),
});

// The room is a polygon (in mm, plan coords) with walls and openings.
const RoomSchema = z.object({
  polygon: z.array(Point).min(3),
  walls: z.array(WallSchema),
  openings: z.array(OpeningSchema),
  measurements: z.array(MeasurementSchema).optional(),
});

// A photo with optional reference object for scale and optional wall hint.
const PhotoSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  referenceObject: ReferenceObjectSchema.optional(),
  wallHint: z.enum(['north', 'east', 'south', 'west', 'unknown']).optional(),
});

// A single JSON-Patch op (RFC 6902) — produced by the LLM and applied on user confirm.
export const JsonPatchOpSchema = z.object({
  op: z.enum(['add', 'remove', 'replace', 'move', 'copy', 'test']),
  path: z.string(),
  value: z.unknown().optional(),
  from: z.string().optional(),
});
export type JsonPatchOp = z.infer<typeof JsonPatchOpSchema>;

// Vertical level an item occupies. Items only collide with items at the same
// level: a wall cabinet can hang above a base cabinet, a microwave sit on a counter.
export const MountSchema = z.enum(['floor', 'counter', 'wall']);
export type Mount = z.infer<typeof MountSchema>;

// An item placed on the plan from the catalog.
const PlacedItemSchema = z.object({
  id: z.string().min(1),
  catalogId: z.string().min(1),
  // Snapshot of the catalog item's size at placement, so validation never
  // needs the catalog and plans survive catalog changes.
  sizeMm: z.object({ w: z.number().positive(), d: z.number().positive(), h: z.number().positive() }),
  // Level it occupies; absent means 'floor'. Snapshot from the catalog item.
  mount: MountSchema.optional(),
  // Free space it needs in front and at each side; snapshot from the catalog item.
  clearanceMm: z.object({ front: z.number().nonnegative(), sides: z.number().nonnegative() }).optional(),
  // Item centre, mm.
  position: z.object({ x: z.number(), y: z.number() }),
  rotationDeg: z.number(),
  tag: z.string().optional(),
});

// --- Closets ---
// A reach-in closet is drawn as a front elevation of its back wall: x runs
// right from the left side wall, y runs up from the floor, both in mm.

/** How the closet front opens. 'open' = no doors. */
export const ClosetDoorStyleSchema = z.enum(['bifold', 'sliding', 'hinged', 'open']);
export type ClosetDoorStyle = z.infer<typeof ClosetDoorStyleSchema>;

export const ClosetComponentKindSchema = z.enum([
  'shelf',
  'rod',
  'tower',
  'drawers',
  'shoe_shelf',
  'basket',
  'hooks',
  'valet_rod',
]);
export type ClosetComponentKind = z.infer<typeof ClosetComponentKindSchema>;

const ClosetComponentSchema = z.object({
  id: z.string().min(1),
  kind: ClosetComponentKindSchema,
  /** Left edge, from the closet's left side wall. */
  xMm: z.number(),
  widthMm: z.number().positive(),
  /** Height above the floor: of the rod/shelf/hooks itself, or of a box's bottom. */
  yMm: z.number(),
  /** Boxes only (tower, drawers, basket). */
  heightMm: z.number().positive().optional(),
  depthMm: z.number().positive().optional(),
  /** Drawers in a drawer unit, or shelves in a tower. */
  count: z.number().int().positive().optional(),
});

const ClosetSchema = z.object({
  /** Interior size. */
  widthMm: z.number().positive(),
  heightMm: z.number().positive(),
  depthMm: z.number().positive(),
  /** The door opening in the closet front, measured like components. */
  opening: z.object({
    style: ClosetDoorStyleSchema,
    leftMm: z.number().min(0),
    widthMm: z.number().positive(),
  }),
  components: z.array(ClosetComponentSchema),
});

/** What a project designs. Absent (projects from before closets) means 'kitchen'. */
export const ProjectKindSchema = z.enum(['kitchen', 'closet']);
export type ProjectKind = z.infer<typeof ProjectKindSchema>;

/** Longest revision summary the revisions endpoint accepts. */
export const SUMMARY_MAX_LENGTH = 500;

// One entry in the undo stack.
const PlanRevisionSchema = z.object({
  revision: z.number().int().nonnegative(),
  patch: z.array(JsonPatchOpSchema),
  // Patch that undoes `patch`; applied on undo.
  inverse: z.array(JsonPatchOpSchema),
  at: z.string().min(1),
  source: z.enum(['user', 'llm']),
  summary: z.string(),
  // Set on an undo: the revision whose change it reverts.
  undoes: z.number().int().nonnegative().optional(),
  // Set on a redo: the undo revision it reverts.
  redoes: z.number().int().nonnegative().optional(),
});

// Top-level project document. Single source of truth, versioned via `revision`.
export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: ProjectKindSchema.optional(),
  units: Units,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  revision: z.number().int().nonnegative(),
  photos: z.array(PhotoSchema),
  room: RoomSchema,
  items: z.array(PlacedItemSchema),
  /** Closet projects only (`validatePlan` checks it is there exactly then). */
  closet: ClosetSchema.optional(),
  history: z.array(PlanRevisionSchema),
});
export type Project = z.infer<typeof ProjectSchema>;
export type Closet = z.infer<typeof ClosetSchema>;
export type ClosetComponent = z.infer<typeof ClosetComponentSchema>;

export function projectKind(project: Pick<Project, 'kind'>): ProjectKind {
  return project.kind ?? 'kitchen';
}
export type Room = z.infer<typeof RoomSchema>;
export type Wall = z.infer<typeof WallSchema>;
export type Opening = z.infer<typeof OpeningSchema>;
export type PlacedItem = z.infer<typeof PlacedItemSchema>;
export type Photo = z.infer<typeof PhotoSchema>;
export type PlanRevision = z.infer<typeof PlanRevisionSchema>;
export type Measurement = z.infer<typeof MeasurementSchema>;
