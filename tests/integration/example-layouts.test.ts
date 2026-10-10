// @vitest-environment node
/**
 * Integration check: build a gallery of realistic kitchens and closets the
 * way the app does — create a project over POST /api/projects, compile the
 * same commands the AI chat proposes, commit the patch over POST
 * /api/projects/[id]/revisions — then reload from disk and check every
 * example is valid with no design warnings.
 *
 * Runs in-process against the route handlers (no dev server). Set
 * EXAMPLES_DATA_DIR to keep the projects, e.g. EXAMPLES_DATA_DIR=./data to
 * open them in the app; otherwise they go to a temp dir that is removed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadCatalog } from '@/lib/catalog/loader';
import { compileClosetCommands, type ClosetCommand } from '@/lib/closet/commands';
import { compileCommands, type Command } from '@/lib/plan/commands';
import type { Point } from '@/lib/plan/geometry';
import { planToJsonPatch } from '@/lib/plan/diff';
import type { Project } from '@/lib/plan/schemas';
import { validatePlan } from '@/lib/plan/validate';
import { loadProject } from '@/lib/storage/projects';
import { POST as createProjectRoute } from '@/app/api/projects/route';
import { POST as commitRoute } from '@/app/api/projects/[id]/revisions/route';
import { POST as undoRoute } from '@/app/api/projects/[id]/undo/route';

const keep = process.env.EXAMPLES_DATA_DIR;
let dataDir: string;

beforeAll(() => {
  dataDir = keep ? resolve(keep) : mkdtempSync(join(tmpdir(), 'kd-examples-'));
  process.env.DATA_DIR = dataDir;
});
afterAll(() => {
  if (!keep) rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function create(name: string, kind: 'kitchen' | 'closet'): Promise<Project> {
  const res = await createProjectRoute(new Request('http://localhost/api/projects', json({ name, kind })));
  expect(res.status).toBe(201);
  return ((await res.json()) as { project: Project }).project;
}

async function commit(before: Project, after: Project, summary: string): Promise<Project> {
  const patch = planToJsonPatch(before, after);
  const res = await commitRoute(new Request(`http://localhost/api/projects/${before.id}/revisions`, json({ baseRevision: before.revision, patch, summary })), {
    params: Promise.resolve({ id: before.id }),
  });
  const body = (await res.json()) as { project?: Project; error?: string };
  expect(body.error).toBeUndefined();
  expect(res.status).toBe(200);
  return body.project!;
}

async function undo(before: Project): Promise<Project> {
  const res = await undoRoute(new Request(`http://localhost/api/projects/${before.id}/undo`, json({ action: 'undo', baseRevision: before.revision })), {
    params: Promise.resolve({ id: before.id }),
  });
  const body = (await res.json()) as { project?: Project; error?: string };
  expect(body.error).toBeUndefined();
  return body.project!;
}

/** Saved, reloaded from disk, error-free, and with exactly `warnings` (default none). */
function expectClean(project: Project, warnings: string[] = []) {
  const saved = loadProject(dataDir, project.id);
  expect(saved).toEqual(project);
  const result = validatePlan(saved);
  expect(result.errors).toEqual([]);
  expect(result.warnings, project.name).toEqual(warnings);
}

const rect = (w: number, d: number): Point[] => [
  [0, 0],
  [w, 0],
  [w, d],
  [0, d],
];

// --- Kitchens ---
// Walls run clockwise from the top-left corner: w1 top, w2 right, w3 bottom, w4 left.

/** A follow-up revision: more commands, or an undo of the last one. */
type Step = Command[] | 'undo';

interface KitchenExample {
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

const KITCHENS: KitchenExample[] = [
  {
    // Two facing runs, 1100 mm apart past the counter-depth fridge.
    name: 'Galley kitchen',
    room: rect(3600, 2400),
    commands: [
      { type: 'addOpening', wall: 'w4', kind: 'door', alongMm: 1200 },
      { type: 'addOpening', wall: 'w2', kind: 'window', alongMm: 1200, widthMm: 900 },
      // Cleanup side; the run keeps the fridge's 50 mm side gaps.
      { type: 'addRun', wall: 'w1', items: ['fridge-counter-depth-910', 'sink-base-900', 'dishwasher-600', 'base-600x560x720'], from: 'start' },
      { type: 'addRun', wall: 'w1', items: ['wall-600x320x720', 'wall-900x320x720', 'wall-600x320x720'], from: 'end' },
      // Cooking side: range between counters, hood over it, short of the door.
      { type: 'addRun', wall: 'w3', items: ['base-900x560x720', 'range-760', 'base-900x560x720'], from: 'start' },
      { type: 'addItem', catalogId: 'range-hood-760', wall: 'w3', alongMm: 1280 },
    ],
    has: ['fridge-counter-depth-910', 'sink-base-900', 'dishwasher-600', 'range-760', 'range-hood-760'],
  },
  {
    // A single wall of cabinets and a table for four.
    name: 'One-wall kitchen with dining table',
    room: rect(4200, 3600),
    commands: [
      { type: 'addOpening', wall: 'w2', kind: 'door', alongMm: 2800 },
      { type: 'addOpening', wall: 'w1', kind: 'window', alongMm: 2150, widthMm: 900 },
      { type: 'addItem', catalogId: 'fridge-counter-depth-910', wall: 'w1', alongMm: 505 },
      // 1300–4200: prep, sink under the window, dishwasher, range, prep.
      { type: 'addRun', wall: 'w1', items: ['base-450x560x720', 'sink-base-800', 'dishwasher-600', 'range-600', 'base-450x560x720'], from: 'end' },
      { type: 'addItem', catalogId: 'range-hood-760', wall: 'w1', alongMm: 3450 },
      { type: 'addItem', catalogId: 'wall-450x320x720', wall: 'w1', alongMm: 2825 },
      // A table for four: chairs on both long sides.
      { type: 'addItem', catalogId: 'table-dining-4', x: 1600, y: 2450 },
      { type: 'addItem', catalogId: 'chair-dining', x: 1300, y: 1800, rotationDeg: 180 },
      { type: 'addItem', catalogId: 'chair-dining', x: 1900, y: 1800, rotationDeg: 180 },
      { type: 'addItem', catalogId: 'chair-dining', x: 1300, y: 3100 },
      { type: 'addItem', catalogId: 'chair-dining', x: 1900, y: 3100 },
    ],
    has: ['fridge-counter-depth-910', 'sink-base-800', 'range-600', 'table-dining-4', 'chair-dining'],
  },
  {
    // A long main run, a big island with seating, and a fridge-and-pantry wall on the right.
    name: 'Family kitchen with big island',
    room: rect(5400, 4600),
    commands: [
      { type: 'addOpening', wall: 'w3', kind: 'door', alongMm: 4300 },
      { type: 'addOpening', wall: 'w1', kind: 'window', alongMm: 1650, widthMm: 900 },
      // 0–4800: two bases, sink under the window, dishwasher, base, range, base.
      {
        type: 'addRun',
        wall: 'w1',
        items: ['base-600x610x720', 'base-600x610x720', 'sink-base-900', 'dishwasher-600', 'base-600x610x720', 'range-900', 'base-600x610x720'],
        from: 'start',
      },
      { type: 'addItem', catalogId: 'range-hood-900', wall: 'w1', alongMm: 3750 },
      { type: 'addItem', catalogId: 'wall-600x320x900', wall: 'w1', alongMm: 3000 },
      { type: 'addItem', catalogId: 'wall-600x320x900', wall: 'w1', alongMm: 4500 },
      // Fridge and two pantry cabinets in the lower half of the right wall, clear of the main run.
      { type: 'addItem', catalogId: 'fridge-standard-910', wall: 'w2', alongMm: 2850 },
      { type: 'addRun', wall: 'w2', items: ['tall-600x560x2100', 'tall-600x560x2100'], from: 'end' },
      // Island 1000 mm from the fridge's door swing, working side to the main run, stools behind.
      { type: 'addItem', catalogId: 'island-2400x1000', x: 2200, y: 2300, rotationDeg: 180 },
      { type: 'addItem', catalogId: 'stool-counter-650', x: 1500, y: 3100 },
      { type: 'addItem', catalogId: 'stool-counter-650', x: 2200, y: 3100 },
      { type: 'addItem', catalogId: 'stool-counter-650', x: 2900, y: 3100 },
    ],
    has: ['range-900', 'range-hood-900', 'island-2400x1000', 'fridge-standard-910', 'stool-counter-650'],
  },
];

/** An L-shaped room: the full-width top, and a lower arm on the left. */
const L_ROOM: Point[] = [
  [0, 0],
  [4400, 0],
  [4400, 2400],
  [2800, 2400],
  [2800, 4600],
  [0, 4600],
];

const MORE_KITCHENS: KitchenExample[] = [
  {
    // Square studio: the small appliances in one centred run, a round table for two.
    name: 'Studio kitchenette',
    room: rect(3400, 3400),
    commands: [
      { type: 'addOpening', wall: 'w3', kind: 'door', alongMm: 2900 },
      { type: 'addOpening', wall: 'w2', kind: 'window', alongMm: 1700, widthMm: 1200 },
      { type: 'addRun', wall: 'w1', items: ['fridge-600', 'base-400x560x720', 'sink-base-800', 'dishwasher-450', 'range-600'], from: 'center' },
      { type: 'addItem', catalogId: 'range-hood-760', wall: 'w1', alongMm: 2675 },
      { type: 'addItem', catalogId: 'wall-400x320x720', wall: 'w1', alongMm: 1005 },
      { type: 'addItem', catalogId: 'microwave-countertop', wall: 'w1', alongMm: 1005 },
      { type: 'addItem', catalogId: 'table-dining-round-1000', x: 1700, y: 2150 },
      { type: 'addItem', catalogId: 'chair-dining', x: 950, y: 2150, rotationDeg: 90 },
      { type: 'addItem', catalogId: 'chair-dining', x: 2450, y: 2150, rotationDeg: 270 },
    ],
    has: ['fridge-600', 'dishwasher-450', 'range-600', 'microwave-countertop', 'table-dining-round-1000'],
  },
  {
    // Long and narrow: pantry cabinets, fridge and everything else on one thick exterior wall.
    name: 'Long narrow kitchen',
    room: rect(5200, 2200),
    commands: [
      { type: 'setWallThickness', wall: 'w1', thicknessMm: 300 },
      { type: 'addOpening', wall: 'w4', kind: 'door', alongMm: 1100 },
      { type: 'addOpening', wall: 'w2', kind: 'pass_through', alongMm: 1100, widthMm: 900 },
      { type: 'addOpening', wall: 'w3', kind: 'window', alongMm: 2600, widthMm: 1500 },
      {
        type: 'addRun',
        wall: 'w1',
        items: ['tall-400x560x2100', 'tall-500x560x2100', 'fridge-standard-910', 'base-450x560x720', 'range-760', 'base-450x560x720', 'sink-base-900', 'dishwasher-600'],
      },
      // The over-range microwave doubles as the hood.
      { type: 'addItem', catalogId: 'microwave-over-range-760', wall: 'w1', alongMm: 2740 },
      { type: 'addRun', wall: 'w1', items: ['wall-900x320x900', 'wall-600x320x900'], from: 'end' },
    ],
    has: ['tall-400x560x2100', 'tall-500x560x2100', 'microwave-over-range-760', 'wall-900x320x900'],
  },
  {
    // Open plan: a deep-cabinet run, fridge and pantry in the far corner, a table for six.
    name: 'Open-plan kitchen with dining for six',
    room: rect(6000, 4500),
    commands: [
      { type: 'addOpening', wall: 'w3', kind: 'door', alongMm: 5000 },
      { type: 'addOpening', wall: 'w1', kind: 'window', alongMm: 1050, widthMm: 900 },
      { type: 'addRun', wall: 'w1', items: ['fridge-standard-910', 'tall-600x560x2100'], from: 'end' },
      {
        type: 'addRun',
        wall: 'w1',
        items: ['base-300x610x720', 'sink-base-900', 'dishwasher-600', 'base-800x610x720', 'range-900', 'base-600x610x720', 'filler-base-100x560x720'],
      },
      { type: 'addItem', catalogId: 'range-hood-900', wall: 'w1', alongMm: 3050 },
      { type: 'addItem', catalogId: 'wall-800x320x720', wall: 'w1', alongMm: 2200 },
      { type: 'addItem', catalogId: 'wall-600x320x720', wall: 'w1', alongMm: 3800 },
      { type: 'addItem', catalogId: 'filler-wall-50x320x720', wall: 'w1', alongMm: 4125 },
      { type: 'addItem', catalogId: 'table-dining-6', x: 3000, y: 3200 },
      ...[2400, 3000, 3600].flatMap((x): Command[] => [
        { type: 'addItem', catalogId: 'chair-dining', x, y: 2490, rotationDeg: 180 },
        { type: 'addItem', catalogId: 'chair-dining', x, y: 3910 },
      ]),
    ],
    has: ['base-800x610x720', 'range-900', 'filler-base-100x560x720', 'filler-wall-50x320x720', 'table-dining-6'],
  },
  {
    // A centred run facing an island with bar stools along its far side.
    name: 'Island kitchen with breakfast bar',
    room: rect(4800, 4200),
    commands: [
      { type: 'addOpening', wall: 'w4', kind: 'door', alongMm: 800 },
      { type: 'addOpening', wall: 'w1', kind: 'window', alongMm: 2025, widthMm: 800 },
      {
        type: 'addRun',
        wall: 'w1',
        items: ['fridge-counter-depth-910', 'base-400x560x720', 'sink-base-800', 'dishwasher-600', 'base-400x560x720', 'range-760', 'base-400x560x720'],
        from: 'centre',
      },
      { type: 'addItem', catalogId: 'range-hood-760', wall: 'w1', alongMm: 3805 },
      { type: 'addItem', catalogId: 'microwave-countertop', wall: 'w1', alongMm: 1425 },
      { type: 'addItem', catalogId: 'wall-450x320x900', wall: 'w1', alongMm: 3200 },
      { type: 'addItem', catalogId: 'island-1800x900', x: 2400, y: 2300 },
      ...[1800, 2400, 3000].map((x): Command => ({ type: 'addItem', catalogId: 'stool-bar-750', x, y: 2960 })),
    ],
    has: ['island-1800x900', 'stool-bar-750', 'fridge-counter-depth-910', 'wall-450x320x900'],
  },
  {
    // Six walls: the kitchen along the top, a round table in the lower arm.
    name: 'Kitchen in an L-shaped room',
    room: L_ROOM,
    commands: [
      { type: 'addOpening', wall: 'w3', kind: 'door', alongMm: 800 },
      { type: 'addOpening', wall: 'w1', kind: 'window', alongMm: 2310, widthMm: 800 },
      { type: 'addOpening', wall: 'w6', kind: 'window', alongMm: 1200, widthMm: 1000 },
      {
        type: 'addRun',
        wall: 'w1',
        items: ['tall-450x560x2100', 'fridge-standard-910', 'base-400x560x720', 'sink-base-900', 'dishwasher-450', 'range-600', 'base-450x560x720'],
      },
      { type: 'addItem', catalogId: 'range-hood-760', wall: 'w1', alongMm: 3510 },
      { type: 'addItem', catalogId: 'wall-450x320x720', wall: 'w1', alongMm: 1635 },
      { type: 'addItem', catalogId: 'table-dining-round-1000', x: 1400, y: 3350 },
      { type: 'addItem', catalogId: 'chair-dining', x: 1400, y: 2590, rotationDeg: 180 },
      { type: 'addItem', catalogId: 'chair-dining', x: 1400, y: 4110 },
      { type: 'addItem', catalogId: 'chair-dining', x: 640, y: 3350, rotationDeg: 90 },
      { type: 'addItem', catalogId: 'chair-dining', x: 2160, y: 3350, rotationDeg: 270 },
    ],
    then: [[{ type: 'setWallThickness', wall: 'w1', thicknessMm: 200 }, { type: 'renameProject', name: 'L-shaped room kitchen' }]],
    finalName: 'L-shaped room kitchen',
    has: ['tall-450x560x2100', 'dishwasher-450', 'table-dining-round-1000'],
  },
  {
    // Built as a one-wall kitchen with a table, then remodelled into a galley; a mistake is undone.
    name: 'Remodel: one-wall to galley',
    room: rect(3800, 2600),
    commands: [
      { type: 'addOpening', wall: 'w4', kind: 'door', alongMm: 1300 },
      { type: 'addOpening', wall: 'w3', kind: 'window', alongMm: 1900, widthMm: 1000 },
      { type: 'addRun', wall: 'w1', items: ['fridge-standard-910', 'sink-base-800', 'dishwasher-600', 'range-760'], from: 'end' },
      { type: 'addItem', catalogId: 'table-dining-4', x: 1900, y: 1950 },
      { type: 'addItem', catalogId: 'chair-dining', x: 1600, y: 1290, rotationDeg: 180 },
      { type: 'addItem', catalogId: 'chair-dining', x: 2200, y: 1290, rotationDeg: 180 },
    ],
    then: [
      // i1–i4 the run, i5 the table, i6–i7 the chairs; o1 the door, o2 the window.
      [
        { type: 'removeItem', item: 'i5' },
        { type: 'removeItem', item: 'i6' },
        { type: 'removeItem', item: 'i7' },
        { type: 'removeOpening', opening: 'o2' },
        { type: 'addOpening', wall: 'w3', kind: 'pass_through', alongMm: 1000, widthMm: 1200 },
        // The fridge moves across to the new counter side.
        { type: 'moveItem', item: 'i1', wall: 'w3', alongMm: 2300 },
        { type: 'addRun', wall: 'w3', items: ['base-450x560x720', 'base-450x560x720'], from: 'start' },
      ],
      // Turning the range to face the wall is a mistake (no room in front of it)…
      [{ type: 'rotateItem', item: 'i4', rotationDeg: 180 }],
      // …so it's undone.
      'undo',
      [{ type: 'renameProject', name: 'Galley remodel' }],
    ],
    finalName: 'Galley remodel',
    has: ['fridge-standard-910', 'range-760', 'base-450x560x720'],
  },
  {
    // A big island with stools, a table for eight, and a pantry wall.
    name: "Entertainer's kitchen",
    room: rect(7400, 5600),
    commands: [
      { type: 'addOpening', wall: 'w3', kind: 'door', alongMm: 6600 },
      { type: 'addOpening', wall: 'w1', kind: 'window', alongMm: 1950, widthMm: 900 },
      { type: 'addOpening', wall: 'w4', kind: 'window', alongMm: 2800, widthMm: 1800 },
      {
        type: 'addRun',
        wall: 'w1',
        items: ['base-600x610x720', 'base-900x610x720', 'sink-base-900', 'dishwasher-600', 'base-1200x610x720', 'range-900', 'base-600x610x720'],
      },
      { type: 'addItem', catalogId: 'range-hood-900', wall: 'w1', alongMm: 4650 },
      { type: 'addItem', catalogId: 'wall-900x320x900', wall: 'w1', alongMm: 3600 },
      { type: 'addItem', catalogId: 'wall-600x320x900', wall: 'w1', alongMm: 5400 },
      { type: 'addItem', catalogId: 'microwave-countertop', wall: 'w1', alongMm: 3600 },
      { type: 'addRun', wall: 'w2', items: ['tall-400x560x2100', 'tall-600x560x2100', 'fridge-600'] },
      { type: 'addItem', catalogId: 'island-2400x1000', x: 2300, y: 2400, rotationDeg: 180 },
      ...[1500, 2300, 3100].map((x): Command => ({ type: 'addItem', catalogId: 'stool-counter-650', x, y: 3110 })),
      { type: 'addItem', catalogId: 'table-dining-8', x: 5300, y: 3800 },
      ...[4600, 5300, 6000].flatMap((x): Command[] => [
        { type: 'addItem', catalogId: 'chair-dining', x, y: 3040, rotationDeg: 180 },
        { type: 'addItem', catalogId: 'chair-dining', x, y: 4560 },
      ]),
      { type: 'addItem', catalogId: 'chair-dining', x: 3840, y: 3800, rotationDeg: 90 },
      { type: 'addItem', catalogId: 'chair-dining', x: 6760, y: 3800, rotationDeg: 270 },
    ],
    has: ['island-2400x1000', 'table-dining-8', 'stool-counter-650', 'fridge-600', 'tall-400x560x2100'],
  },
  {
    // The classic L: a corner cabinet joins a sink run and a cooking run.
    name: 'L-shaped kitchen with corner cabinet',
    room: rect(4000, 3600),
    commands: [
      { type: 'addOpening', wall: 'w3', kind: 'door', alongMm: 800 },
      { type: 'addItem', catalogId: 'corner-base-900x900x720', x: 450, y: 450 },
      { type: 'addRun', wall: 'w1', items: ['sink-base-900', 'dishwasher-600', 'base-450x560x720', 'fridge-standard-910'], from: 'end' },
      { type: 'addRun', wall: 'w4', items: ['range-760', 'base-600x560x720'], from: 'end' },
      { type: 'addItem', catalogId: 'corner-wall-600x600x720', x: 300, y: 300 },
    ],
    has: ['corner-base-900x900x720', 'corner-wall-600x600x720'],
  },
  {
    // Thick stone walls all round, windows set deep; a cosy kitchen with a small table.
    name: 'Thick-walled cottage kitchen',
    room: rect(3600, 3200),
    commands: [
      ...['w1', 'w2', 'w3', 'w4'].map((wall): Command => ({ type: 'setWallThickness', wall, thicknessMm: 450 })),
      { type: 'addOpening', wall: 'w3', kind: 'door', alongMm: 3000 },
      { type: 'addOpening', wall: 'w1', kind: 'window', alongMm: 2000, widthMm: 800 },
      { type: 'addRun', wall: 'w1', items: ['base-300x560x720', 'range-760', 'base-300x560x720', 'sink-base-800', 'dishwasher-600'], from: 'end' },
      { type: 'addItem', catalogId: 'range-hood-760', wall: 'w1', alongMm: 1520 },
      { type: 'addItem', catalogId: 'corner-wall-600x600x720', x: 300, y: 300 },
      { type: 'addItem', catalogId: 'filler-wall-75x320x720', wall: 'w1', alongMm: 637.5 },
      { type: 'addItem', catalogId: 'fridge-600', wall: 'w4', alongMm: 1800 },
      // The table fits exactly between the range's 1 m clearance and its own 750 mm to the wall.
      { type: 'addItem', catalogId: 'table-dining-4', x: 2200, y: 2050 },
      { type: 'addItem', catalogId: 'chair-dining', x: 1900, y: 2710 },
      { type: 'addItem', catalogId: 'chair-dining', x: 2500, y: 2710 },
    ],
    has: ['base-300x560x720', 'corner-wall-600x600x720', 'filler-wall-75x320x720', 'fridge-600'],
  },
  {
    // A small prep island, then turned round and moved: rotate and move on the island.
    name: 'Square kitchen with prep island',
    room: rect(4000, 4000),
    commands: [
      { type: 'addOpening', wall: 'w3', kind: 'door', alongMm: 3400 },
      { type: 'addOpening', wall: 'w2', kind: 'window', alongMm: 2000, widthMm: 1200 },
      { type: 'addRun', wall: 'w1', items: ['fridge-counter-depth-910', 'base-600x560x720', 'sink-base-900', 'dishwasher-600', 'range-600'], from: 'end' },
      { type: 'addItem', catalogId: 'island-1200x900', x: 2000, y: 2300 },
      { type: 'addItem', catalogId: 'stool-counter-650', x: 2810, y: 2300 },
    ],
    then: [
      [
        // i6 the island, i7 the stool.
        { type: 'rotateItem', item: 'i6', rotationDeg: 90 },
        { type: 'moveItem', item: 'i6', x: 1900, y: 2400 },
        { type: 'moveItem', item: 'i7', x: 1900, y: 3260 },
      ],
    ],
    has: ['island-1200x900', 'stool-counter-650', 'fridge-counter-depth-910'],
  },
];

describe('example kitchens', () => {
  const catalog = loadCatalog();

  it.each([...KITCHENS, ...MORE_KITCHENS])('$name', async ({ name, room, commands, then = [], has, finalName, knownWarnings }) => {
    const created = await create(name, 'kitchen');
    // A fresh project has four walls; a room with another outline needs one wall per side.
    const walls = room.length === created.room.walls.length ? created.room.walls : room.map(() => ({ id: randomUUID(), thicknessMm: 100 }));
    const empty: Project = { ...created, room: { ...created.room, polygon: room, walls, openings: [] } };
    let saved = await commit(created, compileCommands(empty, commands, catalog, randomUUID).project, `Lay out the ${name.toLowerCase()}`);
    expect(saved.revision).toBe(1);
    expect(saved.room.polygon).toEqual(room);

    for (const [k, step] of then.entries()) {
      const before = saved;
      saved = step === 'undo' ? await undo(saved) : await commit(saved, compileCommands(saved, step, catalog, randomUUID).project, `Step ${k + 2}`);
      expect(saved.revision).toBe(before.revision + 1);
    }

    const ids = saved.items.map((it) => it.catalogId);
    for (const id of has) expect(ids).toContain(id);
    expect(saved.name).toBe(finalName ?? name);
    expectClean(saved, knownWarnings);
  });
});

// --- Closets ---
// Front elevation of the back wall: x from the left side, y up from the floor.

interface ClosetExample {
  name: string;
  /** The first revision. */
  commands: ClosetCommand[];
  /** Later revisions: more commands, or an undo of the last one. */
  then?: Array<ClosetCommand[] | 'undo'>;
  /** Component kinds that must end up in the closet, sorted. */
  kinds: string[];
  finalName?: string;
  knownWarnings?: string[];
}

const CLOSETS: ClosetExample[] = [
  {
    // 6' bifold reach-in: double hang left, drawers in the middle, long hang right.
    name: 'Bedroom reach-in closet',
    commands: [
      { type: 'setClosetSize', widthMm: 1830, heightMm: 2438, depthMm: 610 },
      { type: 'setOpening', style: 'bifold' },
      { type: 'addComponent', kind: 'shelf', xMm: 0, widthMm: 1830, yMm: 2134 },
      { type: 'addComponent', kind: 'rod', xMm: 0, widthMm: 760, yMm: 2057 },
      { type: 'addComponent', kind: 'rod', xMm: 0, widthMm: 760, yMm: 1067 },
      { type: 'addComponent', kind: 'drawers', xMm: 760, widthMm: 610, count: 4 },
      { type: 'addComponent', kind: 'shelf', xMm: 760, widthMm: 610, yMm: 1524 },
      { type: 'addComponent', kind: 'rod', xMm: 1370, widthMm: 460, yMm: 1727 },
      { type: 'addComponent', kind: 'shoe_shelf', xMm: 1370, widthMm: 460 },
    ],
    kinds: ['drawers', 'rod', 'rod', 'rod', 'shelf', 'shelf', 'shoe_shelf'],
  },
  {
    // 30" wide, 18" deep, a single hinged door: shelves all the way up, hamper basket below.
    name: 'Linen closet',
    commands: [
      { type: 'setClosetSize', widthMm: 762, heightMm: 2438, depthMm: 457 },
      { type: 'setOpening', style: 'hinged' },
      { type: 'addComponent', kind: 'basket', xMm: 152, widthMm: 457, yMm: 0, depthMm: 406 },
      ...[406, 762, 1118, 1473, 1829, 2134].map((yMm): ClosetCommand => ({ type: 'addComponent', kind: 'shelf', xMm: 0, widthMm: 762, yMm, depthMm: 406 })),
    ],
    kinds: ['basket', 'shelf', 'shelf', 'shelf', 'shelf', 'shelf', 'shelf'],
  },
  {
    // 4' wide behind a 32" hinged door: coats on a rod, hats above, boots below.
    name: 'Hall coat closet',
    commands: [
      { type: 'setClosetSize', widthMm: 1219, heightMm: 2438, depthMm: 610 },
      { type: 'setOpening', style: 'hinged', leftMm: 203, widthMm: 813 },
      { type: 'addComponent', kind: 'shelf', xMm: 0, widthMm: 1219, yMm: 2134 },
      { type: 'addComponent', kind: 'shelf', xMm: 0, widthMm: 1219, yMm: 1829 },
      { type: 'addComponent', kind: 'rod', xMm: 0, widthMm: 1219, yMm: 1727 },
      { type: 'addComponent', kind: 'shoe_shelf', xMm: 0, widthMm: 1219 },
    ],
    kinds: ['rod', 'shelf', 'shelf', 'shoe_shelf'],
  },
  {
    // 5' with sliding doors: low rods a child can reach, drawers and baskets in the left half.
    name: "Kid's closet",
    commands: [
      { type: 'setClosetSize', widthMm: 1524, heightMm: 2438, depthMm: 610 },
      { type: 'setOpening', style: 'sliding' },
      { type: 'addComponent', kind: 'shelf', xMm: 0, widthMm: 1524, yMm: 2134 },
      { type: 'addComponent', kind: 'drawers', xMm: 76, widthMm: 610, count: 3, heightMm: 686 },
      { type: 'addComponent', kind: 'basket', xMm: 152, widthMm: 457, yMm: 762 },
      { type: 'addComponent', kind: 'basket', xMm: 152, widthMm: 457, yMm: 1067 },
      { type: 'addComponent', kind: 'rod', xMm: 762, widthMm: 762, yMm: 2057 },
      { type: 'addComponent', kind: 'rod', xMm: 762, widthMm: 762, yMm: 1067 },
      { type: 'addComponent', kind: 'hooks', xMm: 0, widthMm: 762, yMm: 1524 },
    ],
    kinds: ['basket', 'basket', 'drawers', 'hooks', 'rod', 'rod', 'shelf'],
  },
];

const MORE_CLOSETS: ClosetExample[] = [
  {
    // 10' of sliding doors: double hang, drawers with a valet rod, a shelf tower, long hang and shoes.
    name: 'Wall-to-wall sliding closet',
    commands: [
      { type: 'setClosetSize', widthMm: 3048, heightMm: 2438, depthMm: 610 },
      { type: 'setOpening', style: 'sliding' },
      { type: 'addComponent', kind: 'shelf', xMm: 0, widthMm: 3048, yMm: 2134 },
      { type: 'addComponent', kind: 'rod', xMm: 0, widthMm: 900, yMm: 2057 },
      { type: 'addComponent', kind: 'rod', xMm: 0, widthMm: 900, yMm: 1067 },
      // Drawers kept inside the left door's half.
      { type: 'addComponent', kind: 'drawers', xMm: 900, widthMm: 600, heightMm: 1000, count: 6 },
      { type: 'addComponent', kind: 'valet_rod', xMm: 1450, yMm: 1524 },
      { type: 'addComponent', kind: 'tower', xMm: 1500, widthMm: 400, count: 6 },
      { type: 'addComponent', kind: 'rod', xMm: 1900, widthMm: 1148, yMm: 1727 },
      { type: 'addComponent', kind: 'shoe_shelf', xMm: 1900, widthMm: 1148 },
    ],
    kinds: ['drawers', 'rod', 'rod', 'rod', 'shelf', 'shoe_shelf', 'tower', 'valet_rod'],
  },
  {
    // No doors at all: hooks for coats and bags, two shoe shelves, baskets for hats and gloves.
    name: 'Open mudroom nook',
    commands: [
      { type: 'setClosetSize', widthMm: 1219, heightMm: 2438, depthMm: 457 },
      { type: 'setOpening', style: 'open' },
      { type: 'addComponent', kind: 'shelf', xMm: 0, widthMm: 1219, yMm: 1829 },
      { type: 'addComponent', kind: 'hooks', xMm: 0, widthMm: 1219 },
      { type: 'addComponent', kind: 'shoe_shelf', xMm: 0, widthMm: 1219, yMm: 406 },
      { type: 'addComponent', kind: 'shoe_shelf', xMm: 0, widthMm: 1219 },
      { type: 'addComponent', kind: 'basket', xMm: 76, widthMm: 457, yMm: 1880 },
      { type: 'addComponent', kind: 'basket', xMm: 686, widthMm: 457, yMm: 1880 },
    ],
    kinds: ['basket', 'basket', 'hooks', 'shelf', 'shoe_shelf', 'shoe_shelf'],
  },
  {
    // A 3' pantry behind one door: six deep shelves and a floor bin, then tidied up.
    name: 'Pantry closet',
    commands: [
      { type: 'setClosetSize', widthMm: 914, heightMm: 2438, depthMm: 610 },
      { type: 'setOpening', style: 'hinged' },
      ...[457, 813, 1168, 1524, 1880, 2134].map((yMm): ClosetCommand => ({ type: 'addComponent', kind: 'shelf', xMm: 0, widthMm: 914, yMm, depthMm: 406 })),
      { type: 'addComponent', kind: 'basket', xMm: 228, widthMm: 457, yMm: 0, depthMm: 406 },
    ],
    then: [
      [
        // The top shelf gets shallower so tins at the back stay visible; the bin moves left.
        { type: 'resizeComponent', component: 'c6', depthMm: 305 },
        { type: 'moveComponent', component: 'c7', xMm: 76 },
        { type: 'renameProject', name: 'Walk-up pantry' },
      ],
    ],
    finalName: 'Walk-up pantry',
    kinds: ['basket', 'shelf', 'shelf', 'shelf', 'shelf', 'shelf', 'shelf'],
  },
  {
    // 2' wide: hooks for brooms and mops, the floor left for the vacuum, two shelves and a basket up top.
    name: 'Broom closet',
    commands: [
      { type: 'setClosetSize', widthMm: 610, heightMm: 2438, depthMm: 610 },
      { type: 'setOpening', style: 'hinged' },
      { type: 'addComponent', kind: 'hooks', xMm: 0, widthMm: 610 },
      { type: 'addComponent', kind: 'shelf', xMm: 0, widthMm: 610, yMm: 1829 },
      { type: 'addComponent', kind: 'shelf', xMm: 0, widthMm: 610, yMm: 2134 },
      { type: 'addComponent', kind: 'basket', xMm: 76, widthMm: 457, yMm: 1880 },
    ],
    kinds: ['basket', 'hooks', 'shelf', 'shelf'],
  },
  {
    // 8' bifold shared by two: double hang at each end, drawers and a shelf in the middle.
    name: "Couple's reach-in closet",
    commands: [
      { type: 'setClosetSize', widthMm: 2438, heightMm: 2438, depthMm: 610 },
      { type: 'setOpening', style: 'bifold' },
      { type: 'addComponent', kind: 'shelf', xMm: 0, widthMm: 2438, yMm: 2134 },
      { type: 'addComponent', kind: 'rod', xMm: 0, widthMm: 838, yMm: 2057 },
      { type: 'addComponent', kind: 'rod', xMm: 0, widthMm: 838, yMm: 1067 },
      { type: 'addComponent', kind: 'drawers', xMm: 838, widthMm: 762, count: 5 },
      { type: 'addComponent', kind: 'shelf', xMm: 838, widthMm: 762, yMm: 1219 },
      { type: 'addComponent', kind: 'rod', xMm: 1600, widthMm: 838, yMm: 2057 },
      { type: 'addComponent', kind: 'rod', xMm: 1600, widthMm: 838, yMm: 1067 },
    ],
    then: [[{ type: 'renameProject', name: 'His and hers closet' }]],
    finalName: 'His and hers closet',
    kinds: ['drawers', 'rod', 'rod', 'rod', 'rod', 'shelf', 'shelf'],
  },
  {
    // Sliding doors, 18" deep: a tall tower in the middle, baskets in each door's half, shelves either side.
    name: 'Sliding-door linen closet',
    commands: [
      { type: 'setClosetSize', widthMm: 1830, heightMm: 2438, depthMm: 457 },
      { type: 'setOpening', style: 'sliding' },
      { type: 'addComponent', kind: 'tower', xMm: 615, widthMm: 600, count: 8 },
      ...[100, 1273].flatMap((xMm) => [0, 300, 600].map((yMm): ClosetCommand => ({ type: 'addComponent', kind: 'basket', xMm, widthMm: 457, yMm }))),
      ...[0, 1215].flatMap((xMm) => [1067, 1473, 1829].map((yMm): ClosetCommand => ({ type: 'addComponent', kind: 'shelf', xMm, widthMm: 615, yMm }))),
      { type: 'addComponent', kind: 'shelf', xMm: 0, widthMm: 1830, yMm: 2134 },
    ],
    kinds: ['basket', 'basket', 'basket', 'basket', 'basket', 'basket', 'shelf', 'shelf', 'shelf', 'shelf', 'shelf', 'shelf', 'shelf', 'tower'],
  },
  {
    // Fitted for a toddler, then rearranged for a teenager: move, resize, remove and add.
    name: 'Kid’s closet that grows up',
    commands: [
      { type: 'setClosetSize', widthMm: 1524, heightMm: 2438, depthMm: 610 },
      { type: 'setOpening', style: 'bifold' },
      { type: 'addComponent', kind: 'shelf', xMm: 0, widthMm: 1524, yMm: 1829 },
      { type: 'addComponent', kind: 'rod', xMm: 0, widthMm: 900, yMm: 1067 },
      { type: 'addComponent', kind: 'drawers', xMm: 900, widthMm: 524, heightMm: 686, count: 3 },
      { type: 'addComponent', kind: 'hooks', xMm: 900, widthMm: 524, yMm: 1219 },
    ],
    then: [
      [
        // c1 shelf, c2 rod, c3 drawers, c4 hooks.
        { type: 'moveComponent', component: 'c1', yMm: 2134 },
        { type: 'moveComponent', component: 'c2', yMm: 2057 },
        { type: 'addComponent', kind: 'rod', xMm: 0, widthMm: 900, yMm: 1067 },
        { type: 'resizeComponent', component: 'c3', heightMm: 914, count: 4 },
        { type: 'removeComponent', component: 'c4' },
        { type: 'addComponent', kind: 'valet_rod', xMm: 1374, yMm: 1524 },
        { type: 'renameProject', name: 'Teen closet' },
      ],
    ],
    finalName: 'Teen closet',
    kinds: ['drawers', 'rod', 'rod', 'shelf', 'valet_rod'],
  },
  {
    // Fitted at the default 6', then remeasured at 7' and 26" deep; a bad move is undone.
    name: 'Remeasured closet',
    commands: [
      { type: 'addComponent', kind: 'shelf', xMm: 0, widthMm: 1830, yMm: 2134 },
      { type: 'addComponent', kind: 'rod', xMm: 0, widthMm: 1830, yMm: 2057 },
    ],
    then: [
      [
        { type: 'setClosetSize', widthMm: 2134, depthMm: 660 },
        { type: 'resizeComponent', component: 'c1', widthMm: 2134 },
        { type: 'resizeComponent', component: 'c2', widthMm: 2134 },
        { type: 'addComponent', kind: 'drawers', xMm: 762, widthMm: 610 },
      ],
      // Sliding the drawers into the corner puts them behind the bifold door…
      [{ type: 'moveComponent', component: 'c3', xMm: 0 }],
      // …so that's undone.
      'undo',
    ],
    kinds: ['drawers', 'rod', 'shelf'],
  },
  {
    // A wardrobe whose doors are narrower than the inside: everything within reach of the opening.
    name: 'Wardrobe with offset doors',
    commands: [
      { type: 'setClosetSize', widthMm: 1524, heightMm: 2438, depthMm: 610 },
      { type: 'setOpening', style: 'hinged', leftMm: 152, widthMm: 1219 },
      { type: 'addComponent', kind: 'shelf', xMm: 0, widthMm: 1524, yMm: 2134 },
      { type: 'addComponent', kind: 'rod', xMm: 0, widthMm: 762, yMm: 1727 },
      { type: 'addComponent', kind: 'shoe_shelf', xMm: 0, widthMm: 762 },
      { type: 'addComponent', kind: 'drawers', xMm: 812, widthMm: 508, count: 4 },
      { type: 'addComponent', kind: 'shelf', xMm: 762, widthMm: 762, yMm: 1371 },
      { type: 'addComponent', kind: 'hooks', xMm: 1321, widthMm: 203 },
    ],
    kinds: ['drawers', 'hooks', 'rod', 'shelf', 'shelf', 'shoe_shelf'],
  },
  {
    // 9' ceiling: a twelve-shelf tower and a storage shelf up high, which needs a step stool.
    name: 'High-ceiling closet',
    commands: [
      { type: 'setClosetSize', heightMm: 2743 },
      { type: 'addComponent', kind: 'shelf', xMm: 0, widthMm: 1830, yMm: 2438 },
      { type: 'addComponent', kind: 'shelf', xMm: 0, widthMm: 1373, yMm: 2134 },
      { type: 'addComponent', kind: 'rod', xMm: 0, widthMm: 1373, yMm: 2057 },
      { type: 'addComponent', kind: 'tower', xMm: 1373, widthMm: 457, heightMm: 2438, count: 12 },
    ],
    kinds: ['rod', 'shelf', 'shelf', 'tower'],
    knownWarnings: ['Shelf c1 is 2438 mm up: you’ll need a step stool'],
  },
];

describe('example closets', () => {
  it.each([...CLOSETS, ...MORE_CLOSETS])('$name', async ({ name, commands, then = [], kinds, finalName, knownWarnings }) => {
    const created = await create(name, 'closet');
    let saved = await commit(created, compileClosetCommands(created, commands, randomUUID).project, `Fit out the ${name.toLowerCase()}`);
    expect(saved.revision).toBe(1);

    for (const [k, step] of then.entries()) {
      const before = saved;
      saved = step === 'undo' ? await undo(saved) : await commit(saved, compileClosetCommands(saved, step, randomUUID).project, `Step ${k + 2}`);
      expect(saved.revision).toBe(before.revision + 1);
    }

    expect(saved.closet!.components.map((c) => c.kind).sort()).toEqual(kinds);
    expect(saved.room.polygon).toEqual(rect(saved.closet!.widthMm, saved.closet!.depthMm));
    expect(saved.name).toBe(finalName ?? name);
    expectClean(saved, knownWarnings);
  });

  it('the built-in sample cleaning closet', async () => {
    const res = await createProjectRoute(new Request('http://localhost/api/projects', json({ name: 'Sample cleaning closet', kind: 'closet', sample: true })));
    expect(res.status).toBe(201);
    expectClean(((await res.json()) as { project: Project }).project);
  });
});
