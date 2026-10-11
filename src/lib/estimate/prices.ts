/**
 * Default prices for the estimate: generic ballpark numbers in USD, not any
 * retailer's. A project can override any of them (`Project.pricing`).
 */

import type { Catalog } from '../catalog/loader';
import type { ClosetComponentKind } from '../plan/schemas';

export const DEFAULT_CURRENCY = 'USD';
export const DEFAULT_RATES = { countertopPerM2: 350, installPct: 30, taxPct: 0, hardwareEach: 4 };

/** Appliances, fixtures and furniture from the seed catalog, by id. */
export const SEED_PRICES: Record<string, number> = {
  'fridge-standard-910': 2200,
  'fridge-counter-depth-910': 2600,
  'fridge-600': 900,
  'range-600': 700,
  'range-760': 1000,
  'range-900': 1800,
  'dishwasher-600': 700,
  'dishwasher-450': 650,
  'range-hood-760': 300,
  'range-hood-900': 450,
  'microwave-over-range-760': 400,
  'microwave-countertop': 150,
  'sink-base-800': 450,
  'sink-base-900': 500,
  'island-1200x900': 1500,
  'island-1800x900': 2200,
  'island-2400x1000': 3000,
  'table-dining-4': 400,
  'table-dining-6': 700,
  'table-dining-8': 1000,
  'table-dining-round-1000': 450,
  'chair-dining': 90,
  'stool-counter-650': 80,
  'stool-bar-750': 90,
};

export type ClosetPriceUnit = 'm' | 'drawer' | 'each';

/** Closet parts: a price per metre of width, per drawer, or per piece. */
export const CLOSET_PRICES: Record<ClosetComponentKind, { price: number; unit: ClosetPriceUnit }> = {
  shelf: { price: 30, unit: 'm' },
  rod: { price: 15, unit: 'm' },
  tower: { price: 180, unit: 'each' },
  drawers: { price: 60, unit: 'drawer' },
  shoe_shelf: { price: 40, unit: 'm' },
  basket: { price: 25, unit: 'each' },
  hooks: { price: 20, unit: 'm' },
  valet_rod: { price: 20, unit: 'each' },
};

/** The price key of a closet component kind. */
export const closetKey = (kind: ClosetComponentKind) => `closet:${kind}`;

/** The default unit price for a line key: a catalog id, or `closet:<kind>`. 0 when unknown. */
export function defaultUnitPrice(key: string, catalog: Catalog): number {
  if (key.startsWith('closet:')) return CLOSET_PRICES[key.slice(7) as ClosetComponentKind]?.price ?? 0;
  if (key in SEED_PRICES) return SEED_PRICES[key];
  const item = catalog.byId.get(key);
  if (!item) return 0;
  const w = item.sizeMm.w;
  switch (item.tags[0]) {
    case 'base':
      return 120 + 0.25 * w;
    case 'wall':
      return 90 + 0.2 * w;
    case 'tall':
      return 300 + 0.5 * w;
    case 'corner':
      return item.mount === 'wall' ? 220 : 350;
    case 'filler':
      return 25;
    default:
      return 0;
  }
}
