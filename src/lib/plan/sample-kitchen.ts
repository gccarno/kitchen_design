/**
 * A ready-made kitchen to look around in without photos or an LLM: one wall
 * of cabinets and appliances plus an island, in a 4.2 m × 3.6 m room. Built
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
// front of every base cabinet, which an L's inside corner can't give.
const COMMANDS: Command[] = [
  // Fridge in the left corner, its 50 mm side gap to the wall kept.
  { type: 'addItem', catalogId: 'fridge-counter-depth-910', wall: 'w1', alongMm: 505 },
  // The rest of the top wall, packed against the right corner.
  {
    type: 'addRun',
    wall: 'w1',
    items: ['sink-base-900', 'dishwasher-600', 'base-450x560x720', 'range-760', 'base-450x560x720'],
    from: 'end',
  },
  // Window over the sink; wall cabinets either side of the hood.
  { type: 'addOpening', wall: 'w1', kind: 'window', alongMm: 1490, widthMm: 900 },
  { type: 'addItem', catalogId: 'wall-600x320x720', wall: 'w1', alongMm: 2240 },
  { type: 'addItem', catalogId: 'wall-450x320x720', wall: 'w1', alongMm: 2765 },
  { type: 'addItem', catalogId: 'range-hood-760', wall: 'w1', alongMm: 3370 },
  { type: 'addItem', catalogId: 'wall-450x320x720', wall: 'w1', alongMm: 3975 },
  // Island centred (it needs 1 m clear at each end), working side toward the cabinets, stools behind.
  { type: 'addItem', catalogId: 'island-1800x900', x: 2100, y: 2100, rotationDeg: 180 },
  { type: 'addItem', catalogId: 'stool-counter-650', x: 1600, y: 2850 },
  { type: 'addItem', catalogId: 'stool-counter-650', x: 2100, y: 2850 },
  { type: 'addItem', catalogId: 'stool-counter-650', x: 2600, y: 2850 },
  // Door in the bottom wall, near the left corner.
  { type: 'addOpening', wall: 'w3', kind: 'door', alongMm: 3700 },
];

/** `base` (a freshly created kitchen) with the sample room and layout; id, walls and dates are kept. */
export function buildSampleKitchen(base: Project, catalog: Catalog, makeId: () => string): Project {
  const empty: Project = { ...base, room: { ...base.room, polygon: ROOM, openings: [] }, items: [] };
  return compileCommands(empty, COMMANDS, catalog, makeId).project;
}
