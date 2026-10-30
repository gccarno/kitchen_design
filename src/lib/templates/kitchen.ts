/**
 * Starter kitchens, each built with the same commands the AI chat proposes,
 * so placement and validation are the real thing. Walls run clockwise from
 * the top-left corner: w1 top (left to right), w2 right (top to bottom), w3
 * bottom (right to left), w4 left (bottom to top); `alongMm` is measured
 * from a wall's start corner to the item's centre.
 *
 * Every layout is meant to pass the NKBA checks in `plan/layout-check.ts` with
 * no validation warnings. Where an L or U needs a corner, a corner base
 * cabinet sits in it: the clearance check can't give 900 mm in front of two
 * base cabinets meeting at an inside corner.
 */

import type { Catalog } from '../catalog/loader';
import { compileCommands, type Command } from '../plan/commands';
import type { Point } from '../plan/geometry';
import type { Project } from '../plan/schemas';
import { buildSampleKitchen } from '../plan/sample-kitchen';

export type KitchenBuilder = (base: Project, catalog: Catalog, makeId: () => string) => Project;

const rect = (w: number, h: number): Point[] => [
  [0, 0],
  [w, 0],
  [w, h],
  [0, h],
];

/** `base` (a freshly created kitchen) with an empty room of this shape and then `commands` applied. */
const kitchen =
  (polygon: Point[], commands: Command[]): KitchenBuilder =>
  (base, catalog, makeId) => {
    const empty: Project = { ...base, room: { ...base.room, polygon, openings: [] }, items: [] };
    return compileCommands(empty, commands, catalog, makeId).project;
  };

const CORNER = 'corner-base-900x900x720';

/**
 * Fridge, sink and range 1.2–1.5 m apart on one line: the only way a single
 * wall keeps every side of the triangle within 2.7 m.
 */
const ONE_WALL: Command[] = [
  { type: 'addItem', catalogId: 'fridge-600', wall: 'w1', alongMm: 350 },
  { type: 'addItem', catalogId: 'base-600x560x720', wall: 'w1', alongMm: 1000 },
  { type: 'addItem', catalogId: 'sink-base-900', wall: 'w1', alongMm: 1750 },
  { type: 'addItem', catalogId: 'dishwasher-450', wall: 'w1', alongMm: 2425 },
  { type: 'addItem', catalogId: 'range-760', wall: 'w1', alongMm: 3030 },
  { type: 'addItem', catalogId: 'base-450x560x720', wall: 'w1', alongMm: 3635 },
  { type: 'addOpening', wall: 'w1', kind: 'window', alongMm: 1750, widthMm: 900 },
  { type: 'addItem', catalogId: 'wall-600x320x720', wall: 'w1', alongMm: 1000 },
  { type: 'addItem', catalogId: 'range-hood-760', wall: 'w1', alongMm: 3030 },
  { type: 'addItem', catalogId: 'wall-450x320x720', wall: 'w1', alongMm: 3635 },
  { type: 'addOpening', wall: 'w3', kind: 'door', alongMm: 800, widthMm: 900 },
];

/** Sink and dishwasher on the right wall, range opposite; the fridge sits on the sink's side so no leg passes 2.7 m. */
const GALLEY: Command[] = [
  { type: 'addItem', catalogId: 'base-450x560x720', wall: 'w2', alongMm: 225 },
  { type: 'addItem', catalogId: 'sink-base-900', wall: 'w2', alongMm: 900 },
  { type: 'addItem', catalogId: 'dishwasher-600', wall: 'w2', alongMm: 1650 },
  { type: 'addItem', catalogId: 'fridge-600', wall: 'w2', alongMm: 2300 },
  { type: 'addItem', catalogId: 'base-450x560x720', wall: 'w4', alongMm: 3975 },
  { type: 'addItem', catalogId: 'range-760', wall: 'w4', alongMm: 3370 },
  { type: 'addItem', catalogId: 'base-450x560x720', wall: 'w4', alongMm: 2765 },
  { type: 'addOpening', wall: 'w1', kind: 'window', widthMm: 900 },
  { type: 'addItem', catalogId: 'wall-450x320x720', wall: 'w2', alongMm: 225 },
  { type: 'addItem', catalogId: 'wall-600x320x720', wall: 'w2', alongMm: 1650 },
  { type: 'addItem', catalogId: 'wall-450x320x720', wall: 'w4', alongMm: 3975 },
  { type: 'addItem', catalogId: 'range-hood-760', wall: 'w4', alongMm: 3370 },
  { type: 'addItem', catalogId: 'wall-450x320x720', wall: 'w4', alongMm: 2765 },
  { type: 'addOpening', wall: 'w3', kind: 'door', widthMm: 900 },
];

/** Corner cabinet at the top-left; sink and fridge along the top wall, range down the left wall. */
const COMPACT_L: Command[] = [
  { type: 'addItem', catalogId: CORNER, wall: 'w1', alongMm: 450 },
  { type: 'addItem', catalogId: 'sink-base-800', wall: 'w1', alongMm: 1300 },
  { type: 'addItem', catalogId: 'dishwasher-450', wall: 'w1', alongMm: 1925 },
  { type: 'addItem', catalogId: 'fridge-600', wall: 'w1', alongMm: 2550 },
  { type: 'addItem', catalogId: 'range-600', wall: 'w4', alongMm: 1800 },
  { type: 'addItem', catalogId: 'base-450x560x720', wall: 'w4', alongMm: 1275 },
  { type: 'addItem', catalogId: 'base-600x560x720', wall: 'w4', alongMm: 750 },
  { type: 'addOpening', wall: 'w1', kind: 'window', alongMm: 1300, widthMm: 800 },
  { type: 'addItem', catalogId: 'wall-450x320x720', wall: 'w1', alongMm: 1925 },
  { type: 'addItem', catalogId: 'range-hood-760', wall: 'w4', alongMm: 1800 },
  { type: 'addOpening', wall: 'w3', kind: 'door', alongMm: 600, widthMm: 900 },
];

/** The same L as `L_SHAPE`, opened up to take an island. */
const l = (wall4Mm: number): Command[] => [
  { type: 'addItem', catalogId: CORNER, wall: 'w1', alongMm: 450 },
  { type: 'addItem', catalogId: 'sink-base-900', wall: 'w1', alongMm: 1350 },
  { type: 'addItem', catalogId: 'dishwasher-600', wall: 'w1', alongMm: 2100 },
  { type: 'addItem', catalogId: 'fridge-600', wall: 'w1', alongMm: 2750 },
  // The left wall's run ends against the corner cabinet, which is 900 mm from the top.
  { type: 'addItem', catalogId: 'range-760', wall: 'w4', alongMm: wall4Mm - 900 - 380 },
  { type: 'addItem', catalogId: 'base-450x560x720', wall: 'w4', alongMm: wall4Mm - 900 - 760 - 225 },
  { type: 'addItem', catalogId: 'base-600x560x720', wall: 'w4', alongMm: wall4Mm - 900 - 760 - 450 - 300 },
  { type: 'addOpening', wall: 'w1', kind: 'window', alongMm: 1350, widthMm: 900 },
  { type: 'addItem', catalogId: 'wall-600x320x720', wall: 'w1', alongMm: 2100 },
  { type: 'addItem', catalogId: 'range-hood-760', wall: 'w4', alongMm: wall4Mm - 900 - 380 },
];

const L_SHAPE: Command[] = [...l(3300), { type: 'addOpening', wall: 'w3', kind: 'door', alongMm: 800, widthMm: 900 }];

const L_ISLAND: Command[] = [
  ...l(4000),
  // Island working side toward the cabinets (1.1 m aisle), stools behind it.
  { type: 'addItem', catalogId: 'island-1800x900', x: 3000, y: 2150, rotationDeg: 180 },
  { type: 'addItem', catalogId: 'stool-counter-650', x: 2400, y: 2850 },
  { type: 'addItem', catalogId: 'stool-counter-650', x: 3000, y: 2850 },
  { type: 'addItem', catalogId: 'stool-counter-650', x: 3600, y: 2850 },
  { type: 'addOpening', wall: 'w3', kind: 'door', alongMm: 800, widthMm: 900 },
];

/** Corner cabinets at both top corners; sink between them, dishwasher and range left, fridge right. */
const U_SHAPE: Command[] = [
  { type: 'addItem', catalogId: CORNER, wall: 'w1', alongMm: 450 },
  { type: 'addItem', catalogId: 'sink-base-900', wall: 'w1', alongMm: 1350 },
  { type: 'addItem', catalogId: 'base-450x560x720', wall: 'w1', alongMm: 2025 },
  { type: 'addItem', catalogId: CORNER, wall: 'w1', alongMm: 2750 },
  { type: 'addItem', catalogId: 'dishwasher-600', wall: 'w4', alongMm: 2200 },
  { type: 'addItem', catalogId: 'range-760', wall: 'w4', alongMm: 1520 },
  { type: 'addItem', catalogId: 'base-450x560x720', wall: 'w4', alongMm: 915 },
  { type: 'addItem', catalogId: 'base-600x560x720', wall: 'w4', alongMm: 390 },
  { type: 'addItem', catalogId: 'fridge-600', wall: 'w2', alongMm: 1250 },
  { type: 'addItem', catalogId: 'base-450x560x720', wall: 'w2', alongMm: 1825 },
  { type: 'addItem', catalogId: 'base-600x560x720', wall: 'w2', alongMm: 2350 },
  { type: 'addOpening', wall: 'w1', kind: 'window', alongMm: 1350, widthMm: 900 },
  { type: 'addItem', catalogId: 'wall-450x320x720', wall: 'w1', alongMm: 2025 },
  { type: 'addItem', catalogId: 'range-hood-760', wall: 'w4', alongMm: 1520 },
  { type: 'addOpening', wall: 'w3', kind: 'door', alongMm: 1600, widthMm: 900 },
];

export const KITCHEN_BUILDERS: Record<string, KitchenBuilder> = {
  'kitchen-one-wall': kitchen(rect(4400, 3000), ONE_WALL),
  'kitchen-galley': kitchen(rect(2600, 4200), GALLEY),
  'kitchen-compact-l': kitchen(rect(3000, 3000), COMPACT_L),
  'kitchen-l-shape': kitchen(rect(3300, 3300), L_SHAPE),
  'kitchen-u-shape': kitchen(rect(3200, 3400), U_SHAPE),
  'kitchen-l-island': kitchen(rect(5000, 4000), L_ISLAND),
  'kitchen-sample': buildSampleKitchen,
};
