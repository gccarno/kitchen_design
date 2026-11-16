/**
 * Sample kitchens shared by the example gallery (tests/integration/example-layouts.test.ts)
 * and the sample-photo tests: a room outline plus the same commands the AI chat proposes.
 */
import type { Command } from '@/lib/plan/commands';
import type { Point } from '@/lib/plan/geometry';

/** A follow-up revision: more commands, or an undo of the last one. */
export type Step = Command[] | 'undo';

export interface KitchenExample {
  name: string;
  room: Point[];
  /** The first revision. */
  commands: Command[];
  /** Later revisions, each checked to compile and commit. */
  then?: Step[];
  /** Catalog ids that must end up in the plan. */
  has: string[];
  /** The project name at the end, when a step renames it. */
  finalName?: string;
  /** Warnings the layout is known to give (a limitation, recorded rather than hidden). */
  knownWarnings?: string[];
}

export const rect = (w: number, d: number): Point[] => [
  [0, 0],
  [w, 0],
  [w, d],
  [0, d],
];

// Walls run clockwise from the top-left corner: in a rectangle w1 top, w2 right, w3 bottom, w4 left.
export const SHAPED_KITCHENS: KitchenExample[] = [
  {
    // Three walls of cabinets round two corner units; the open side has the door.
    name: 'U-shaped kitchen',
    room: rect(3200, 3400),
    commands: [
      { type: 'addOpening', wall: 'w3', kind: 'door', alongMm: 1600 },
      { type: 'addOpening', wall: 'w1', kind: 'window', alongMm: 1300, widthMm: 800 },
      { type: 'addItem', catalogId: 'corner-base-900x900x720', x: 450, y: 450 },
      { type: 'addItem', catalogId: 'corner-base-900x900x720', x: 2750, y: 450, rotationDeg: 90 },
      { type: 'addRun', wall: 'w1', items: ['sink-base-800', 'dishwasher-600'], from: 'start' },
      { type: 'addRun', wall: 'w4', items: ['base-300x560x720', 'range-760', 'base-600x560x720'], from: 'end' },
      { type: 'addRun', wall: 'w2', items: ['fridge-counter-depth-910', 'base-600x560x720'], from: 'start' },
    ],
    has: ['corner-base-900x900x720', 'sink-base-800', 'range-760', 'fridge-counter-depth-910'],
  },
  {
    // Five walls: one corner is cut off at 45 degrees, and the door is in the angled wall.
    // One short run, so the layout check's counter-length guideline fails: recorded, as a small kitchen would be.
    name: 'Kitchen with a cut-off corner',
    room: [
      [0, 0],
      [4200, 0],
      [4200, 2400],
      [3000, 3600],
      [0, 3600],
    ],
    commands: [
      { type: 'addOpening', wall: 'w3', kind: 'door', alongMm: 850 },
      { type: 'addOpening', wall: 'w1', kind: 'window', alongMm: 1750, widthMm: 900 },
      { type: 'addRun', wall: 'w1', items: ['fridge-600', 'base-600x560x720', 'sink-base-900', 'dishwasher-450', 'range-760', 'base-450x560x720'], from: 'start' },
      { type: 'addItem', catalogId: 'range-hood-760', wall: 'w1', alongMm: 3030 },
      { type: 'addItem', catalogId: 'table-dining-round-1000', x: 1500, y: 2300 },
      { type: 'addItem', catalogId: 'chair-dining', x: 740, y: 2300, rotationDeg: 90 },
      { type: 'addItem', catalogId: 'chair-dining', x: 2260, y: 2300, rotationDeg: 270 },
    ],
    has: ['fridge-600', 'sink-base-900', 'range-760', 'table-dining-round-1000'],
  },
  {
    // A corridor kitchen with a door at each end: you walk through between the two runs.
    name: 'Walk-through galley',
    room: rect(2500, 4200),
    commands: [
      { type: 'addOpening', wall: 'w1', kind: 'door', alongMm: 1250 },
      { type: 'addOpening', wall: 'w3', kind: 'door', alongMm: 1250 },
      { type: 'addRun', wall: 'w4', items: ['base-450x560x720', 'sink-base-900', 'dishwasher-600', 'base-600x560x720'], from: 'end' },
      { type: 'addRun', wall: 'w2', items: ['fridge-600', 'base-600x560x720', 'range-600', 'base-600x560x720'], from: 'start' },
    ],
    has: ['sink-base-900', 'dishwasher-600', 'range-600', 'fridge-600'],
  },
  {
    // Room to turn a wheelchair: one wall of cabinets, a wide door and nothing in the middle.
    name: 'Accessible one-wall kitchen',
    room: rect(5000, 3600),
    commands: [
      { type: 'addOpening', wall: 'w3', kind: 'door', alongMm: 3600, widthMm: 900 },
      { type: 'addOpening', wall: 'w2', kind: 'window', alongMm: 1800, widthMm: 1200 },
      { type: 'addRun', wall: 'w1', items: ['fridge-600', 'base-600x560x720', 'sink-base-900', 'dishwasher-450', 'range-760', 'base-600x560x720', 'base-600x560x720', 'base-300x560x720'], from: 'start' },
      { type: 'addItem', catalogId: 'range-hood-760', wall: 'w1', alongMm: 3030 },
    ],
    has: ['fridge-600', 'sink-base-900', 'range-760', 'range-hood-760'],
  },
  {
    // Eight walls: a chimney breast juts 300 mm into the top wall; the kitchen runs along the bottom, with an island.
    name: 'Kitchen with a chimney breast',
    room: [
      [0, 0],
      [1500, 0],
      [1500, 300],
      [2400, 300],
      [2400, 0],
      [4200, 0],
      [4200, 3800],
      [0, 3800],
    ],
    commands: [
      { type: 'addOpening', wall: 'w6', kind: 'door', alongMm: 700 },
      { type: 'addOpening', wall: 'w8', kind: 'window', alongMm: 1700, widthMm: 1000 },
      { type: 'addRun', wall: 'w7', items: ['fridge-600', 'base-600x560x720', 'range-760', 'base-450x560x720', 'sink-base-900', 'dishwasher-600'], from: 'start' },
      { type: 'addItem', catalogId: 'range-hood-760', wall: 'w7', alongMm: 1680 },
      { type: 'addItem', catalogId: 'island-1200x900', x: 2100, y: 1620 },
    ],
    has: ['fridge-600', 'range-760', 'sink-base-900', 'range-hood-760', 'island-1200x900'],
  },
];
