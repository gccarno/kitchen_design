/**
 * Domain types for the plan document.
 *
 * The Zod schemas in `./schemas.ts` are the source of truth. The TypeScript
 * types below are re-derived from those schemas so they can never drift.
 */
export type {
  Project,
  Room,
  Wall,
  Opening,
  PlacedItem,
  Photo,
  PlanRevision,
  JsonPatchOp,
  ReferenceObjectKind,
} from './schemas';
