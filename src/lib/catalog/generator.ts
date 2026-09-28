/**
 * Standard cabinet variants, generated rather than hand-written. Ids encode
 * the size (`base-600x560x720`) and must never change: saved plans store
 * them as `catalogId`.
 */

import type { CatalogItem } from './schema';

export const STANDARD_WIDTHS_MM = [300, 400, 450, 600, 800, 900, 1200] as const;
const BASE_DEPTHS_MM = [560, 610] as const; // European / US 24"
const BASE_HEIGHT_MM = 720; // carcass; plinth and worktop add ~150 mm
const WALL_DEPTH_MM = 320;
const WALL_HEIGHTS_MM = [720, 900] as const;
const TALL_WIDTHS_MM = [400, 450, 500, 600] as const;
const TALL = { d: 560, h: 2100 };
const FILLER_WIDTHS_MM = [50, 75, 100] as const;

const DRAWER_CLEARANCE = { front: 900, sides: 0 };

export function generateCabinets(): CatalogItem[] {
  const out: CatalogItem[] = [];

  for (const d of BASE_DEPTHS_MM) {
    for (const w of STANDARD_WIDTHS_MM) {
      out.push({
        id: `base-${w}x${d}x${BASE_HEIGHT_MM}`,
        name: `Base cabinet ${w} mm${d === 610 ? ' (deep, 610)' : ''}`,
        category: 'cabinet',
        mount: 'floor',
        sizeMm: { w, d, h: BASE_HEIGHT_MM },
        tags: ['base', 'base-cabinet', 'cabinet'],
        clearanceMm: DRAWER_CLEARANCE,
      });
    }
  }

  for (const h of WALL_HEIGHTS_MM) {
    for (const w of STANDARD_WIDTHS_MM) {
      out.push({
        id: `wall-${w}x${WALL_DEPTH_MM}x${h}`,
        name: `Wall cabinet ${w} mm${h === 900 ? ' (tall, 900)' : ''}`,
        category: 'cabinet',
        mount: 'wall',
        sizeMm: { w, d: WALL_DEPTH_MM, h },
        tags: ['wall', 'wall-cabinet', 'upper', 'cabinet'],
      });
    }
  }

  for (const w of TALL_WIDTHS_MM) {
    out.push({
      id: `tall-${w}x${TALL.d}x${TALL.h}`,
      name: `Tall cabinet (pantry) ${w} mm`,
      category: 'cabinet',
      mount: 'floor',
      sizeMm: { w, d: TALL.d, h: TALL.h },
      tags: ['tall', 'pantry', 'larder', 'cabinet'],
      clearanceMm: DRAWER_CLEARANCE,
    });
  }

  out.push(
    {
      id: `corner-base-900x900x${BASE_HEIGHT_MM}`,
      name: 'Corner base cabinet 900 × 900 mm',
      category: 'cabinet',
      mount: 'floor',
      sizeMm: { w: 900, d: 900, h: BASE_HEIGHT_MM },
      tags: ['corner', 'base', 'base-cabinet', 'cabinet'],
      clearanceMm: DRAWER_CLEARANCE,
    },
    {
      id: `corner-wall-600x600x720`,
      name: 'Corner wall cabinet 600 × 600 mm',
      category: 'cabinet',
      mount: 'wall',
      sizeMm: { w: 600, d: 600, h: 720 },
      tags: ['corner', 'wall', 'wall-cabinet', 'upper', 'cabinet'],
    }
  );

  for (const w of FILLER_WIDTHS_MM) {
    out.push(
      {
        id: `filler-base-${w}x${BASE_DEPTHS_MM[0]}x${BASE_HEIGHT_MM}`,
        name: `Filler strip, base ${w} mm`,
        category: 'cabinet',
        mount: 'floor',
        sizeMm: { w, d: BASE_DEPTHS_MM[0], h: BASE_HEIGHT_MM },
        tags: ['filler', 'base', 'cabinet'],
      },
      {
        id: `filler-wall-${w}x${WALL_DEPTH_MM}x720`,
        name: `Filler strip, wall ${w} mm`,
        category: 'cabinet',
        mount: 'wall',
        sizeMm: { w, d: WALL_DEPTH_MM, h: 720 },
        tags: ['filler', 'wall', 'cabinet'],
      }
    );
  }

  return out;
}
