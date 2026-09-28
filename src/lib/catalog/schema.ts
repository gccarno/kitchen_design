import { z } from 'zod';
import { MountSchema } from '../plan/schemas';

export const CatalogCategorySchema = z.enum(['cabinet', 'appliance', 'furniture']);
export type CatalogCategory = z.infer<typeof CatalogCategorySchema>;

const positive = z.number().positive();

/** One thing you can place on the plan. Sizes in mm: w = width, d = depth, h = height. */
export const CatalogItemSchema = z.object({
  /** Stable, human-readable slug; saved plans reference it, so it must never change. */
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'ids are lowercase words joined by hyphens'),
  name: z.string().min(1),
  category: CatalogCategorySchema,
  mount: MountSchema,
  sizeMm: z.object({ w: positive, d: positive, h: positive }),
  tags: z.array(z.string().min(1)),
  /** Free space needed in front (e.g. to open a door) and at each side. */
  clearanceMm: z.object({ front: z.number().nonnegative(), sides: z.number().nonnegative() }).optional(),
});
export type CatalogItem = z.infer<typeof CatalogItemSchema>;
