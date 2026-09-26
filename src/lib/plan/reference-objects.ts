/**
 * The one table of known-size reference objects. Nothing else in the app
 * hard-codes these dimensions — the reference route and the marker UI both
 * read from here.
 */

import { z } from 'zod';
import type { CheckResult } from '../result';
import { ReferenceObjectKind, ReferenceSide, type ReferenceObject } from './schemas';

export type BuiltInReferenceKind = Exclude<ReferenceObjectKind, 'custom'>;

export interface ReferenceObjectSpec {
  label: string;
  longMm: number;
  shortMm: number;
}

export const REFERENCE_OBJECTS: Record<BuiltInReferenceKind, ReferenceObjectSpec> = {
  credit_card: { label: 'Credit card', longMm: 85.6, shortMm: 53.98 }, // ISO/IEC 7810 ID-1
  a4_paper: { label: 'A4 paper', longMm: 297, shortMm: 210 },
  us_letter: { label: 'US Letter paper', longMm: 279.4, shortMm: 215.9 },
  coin_us_quarter: { label: 'US quarter', longMm: 24.26, shortMm: 24.26 }, // diameter
};

export function knownSizeMm(kind: BuiltInReferenceKind, side: ReferenceSide): number {
  const spec = REFERENCE_OBJECTS[kind];
  return side === 'long' ? spec.longMm : spec.shortMm;
}

/** What the client sends when the user marks a reference object. */
export const ReferenceInputSchema = z.object({
  kind: ReferenceObjectKind,
  side: ReferenceSide,
  customSizeMm: z.number().positive().optional(),
  pixelBox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});
export type ReferenceInput = z.infer<typeof ReferenceInputSchema>;

/**
 * Turn user input into a stored `ReferenceObject`: resolve the known size,
 * normalize the box so x1 < x2 and y1 < y2, and check it lies inside the
 * photo (natural pixels).
 */
export function resolveReference(
  input: ReferenceInput,
  photo: { width: number; height: number }
): CheckResult<ReferenceObject> {
  const issues: string[] = [];

  let size: number;
  if (input.kind === 'custom') {
    size = input.customSizeMm ?? NaN;
    if (!Number.isFinite(size) || size <= 0) {
      issues.push('customSizeMm must be a positive number for a custom reference');
    }
  } else {
    size = knownSizeMm(input.kind, input.side);
  }

  const [a, b, c, d] = input.pixelBox;
  const box: [number, number, number, number] = [
    Math.min(a, c),
    Math.min(b, d),
    Math.max(a, c),
    Math.max(b, d),
  ];
  if (!box.every(Number.isFinite)) {
    issues.push('pixelBox must contain four finite numbers');
  } else {
    if (box[2] - box[0] <= 0 || box[3] - box[1] <= 0) {
      issues.push('pixelBox has zero width or height');
    }
    if (box[0] < 0 || box[1] < 0 || box[2] > photo.width || box[3] > photo.height) {
      issues.push(`pixelBox lies outside the ${photo.width}×${photo.height} photo`);
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: { kind: input.kind, side: input.side, knownSizeMm: size, pixelBox: box } };
}
