/**
 * A ready-made kitchen to look around in without photos or an LLM: one wall
 * of cabinets and appliances plus an island, in a 4.2 m × 3.6 m room. It
 * passes every layout check, so it's a fair example of a good plan. Built
 * with the same commands the AI chat proposes, so placement and validation
 * are the real thing.
 */

import type { Catalog } from '../catalog/loader';
import { compileCommands, type Command } from './commands';
import type { Point } from './geometry';
import type { Project } from './schemas';

const ROOM: Point[] = [
  [0, 0],
  [4200, 0],
  [4200, 3600],
  [0, 3600],
];

// Walls run clockwise from the top-left corner: w1 top, w2 right, w3 bottom, w4 left.
// A one-wall layout rather than an L: the clearance check wants 900 mm in
// front of every base cabinet, which an L's inside corner can't give. The run
// is the NKBA-friendly one: fridge, sink and range 1.2–1.5 m apart on a line
// (the only way a single wall keeps every side of the triangle within 2.7 m,
// which is why the fridge is the slim 600 mm one), and counter on both sides
// of the sink, the range and the fridge.
const COMMANDS: Command[] = [
  { type: 'addItem', catalogId: 'fridge-600', wall: 'w1', alongMm: 350 },
  { type: 'addItem', catalogId: 'base-600x560x720', wall: 'w1', alongMm: 1000 },
  { type: 'addItem', catalogId: 'sink-base-900', wall: 'w1', alongMm: 1750 },
  { type: 'addItem', catalogId: 'dishwasher-450', wall: 'w1', alongMm: 2425 },
  { type: 'addItem', catalogId: 'range-760', wall: 'w1', alongMm: 3030 },
  { type: 'addItem', catalogId: 'base-450x560x720', wall: 'w1', alongMm: 3635 },
  // Window over the sink; wall cabinets either side of the hood.
  { type: 'addOpening', wall: 'w1', kind: 'window', alongMm: 1750, widthMm: 900 },
  { type: 'addItem', catalogId: 'wall-600x320x720', wall: 'w1', alongMm: 1000 },
  { type: 'addItem', catalogId: 'range-hood-760', wall: 'w1', alongMm: 3030 },
  { type: 'addItem', catalogId: 'wall-450x320x720', wall: 'w1', alongMm: 3635 },
  // Island centred (it needs 1 m clear at each end), working side toward the
  // cabinets with a 1070 mm aisle (the range's front is the deepest, at 650 mm), stools behind.
  { type: 'addItem', catalogId: 'island-1800x900', x: 2100, y: 2170, rotationDeg: 180 },
  { type: 'addItem', catalogId: 'stool-counter-650', x: 1600, y: 2870 },
  { type: 'addItem', catalogId: 'stool-counter-650', x: 2100, y: 2870 },
  { type: 'addItem', catalogId: 'stool-counter-650', x: 2600, y: 2870 },
  // Door in the bottom wall, near the left corner.
  { type: 'addOpening', wall: 'w3', kind: 'door', alongMm: 3700 },
];

/** `base` (a freshly created kitchen) with the sample room and layout; id, walls and dates are kept. */
export function buildSampleKitchen(base: Project, catalog: Catalog, makeId: () => string): Project {
  const empty: Project = { ...base, room: { ...base.room, polygon: ROOM, openings: [] }, items: [] };
  return compileCommands(empty, COMMANDS, catalog, makeId).project;
}
