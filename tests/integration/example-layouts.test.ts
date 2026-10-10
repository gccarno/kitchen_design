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

/** Saved, reloaded from disk, and free of errors and warnings. */
function expectClean(project: Project) {
  const saved = loadProject(dataDir, project.id);
  expect(saved).toEqual(project);
  const result = validatePlan(saved);
  expect(result.errors).toEqual([]);
  expect(result.warnings, project.name).toEqual([]);
}

const rect = (w: number, d: number): Point[] => [
  [0, 0],
  [w, 0],
  [w, d],
  [0, d],
];

// --- Kitchens ---
// Walls run clockwise from the top-left corner: w1 top, w2 right, w3 bottom, w4 left.

interface KitchenExample {
  name: string;
  room: Point[];
  commands: Command[];
  /** Catalog ids that must end up in the plan. */
  has: string[];
}

const KITCHENS: KitchenExample[] = [
  {
    // Two facing runs, 1100 mm apart past the counter-depth fridge.
    name: 'Galley kitchen',
    room: rect(3600, 2400),
    commands: [
      { type: 'addOpening', wall: 'w4', kind: 'door', alongMm: 1200 },
      { type: 'addOpening', wall: 'w2', kind: 'window', alongMm: 1200, widthMm: 900 },
      // Cleanup side. The fridge goes on its own, not in the run: a run packs it
      // tight against its neighbour, losing its 50 mm side gap.
      { type: 'addItem', catalogId: 'fridge-counter-depth-910', wall: 'w1', alongMm: 505 },
      { type: 'addRun', wall: 'w1', items: ['sink-base-900', 'dishwasher-600', 'base-600x560x720'], from: 'end' },
      { type: 'addRun', wall: 'w1', items: ['wall-600x320x720', 'wall-900x320x720', 'wall-600x320x720'], from: 'end' },
      // Cooking side: range between counters, hood over it, short of the door.
      { type: 'addRun', wall: 'w3', items: ['base-900x560x720', 'range-760', 'base-900x560x720'], from: 'start' },
      { type: 'addItem', catalogId: 'range-hood-760', wall: 'w3', alongMm: 1280 },
    ],
    has: ['fridge-counter-depth-910', 'sink-base-900', 'dishwasher-600', 'range-760', 'range-hood-760'],
  },
  {
    // A single wall of cabinets and a table for two.
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
      // Chairs on the table's back side only: the validator wants its front and ends clear.
      { type: 'addItem', catalogId: 'table-dining-4', x: 1600, y: 2450 },
      { type: 'addItem', catalogId: 'chair-dining', x: 1300, y: 1800, rotationDeg: 180 },
      { type: 'addItem', catalogId: 'chair-dining', x: 1900, y: 1800, rotationDeg: 180 },
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

describe('example kitchens', () => {
  const catalog = loadCatalog();

  it.each(KITCHENS)('$name', async ({ name, room, commands, has }) => {
    const created = await create(name, 'kitchen');
    const empty: Project = { ...created, room: { ...created.room, polygon: room, openings: [] } };
    const built = compileCommands(empty, commands, catalog, randomUUID).project;
    const saved = await commit(created, built, `Lay out the ${name.toLowerCase()}`);

    expect(saved.revision).toBe(1);
    expect(saved.room.polygon).toEqual(room);
    const ids = saved.items.map((it) => it.catalogId);
    for (const id of has) expect(ids).toContain(id);
    expectClean(saved);
  });
});

// --- Closets ---
// Front elevation of the back wall: x from the left side, y up from the floor.

interface ClosetExample {
  name: string;
  commands: ClosetCommand[];
  /** Component kinds that must end up in the closet, sorted. */
  kinds: string[];
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

describe('example closets', () => {
  it.each(CLOSETS)('$name', async ({ name, commands, kinds }) => {
    const created = await create(name, 'closet');
    const built = compileClosetCommands(created, commands, randomUUID).project;
    const saved = await commit(created, built, `Fit out the ${name.toLowerCase()}`);

    expect(saved.revision).toBe(1);
    expect(saved.closet!.components.map((c) => c.kind).sort()).toEqual(kinds);
    expect(saved.room.polygon).toEqual(rect(saved.closet!.widthMm, saved.closet!.depthMm));
    expectClean(saved);
  });

  it('the built-in sample cleaning closet', async () => {
    const res = await createProjectRoute(new Request('http://localhost/api/projects', json({ name: 'Sample cleaning closet', kind: 'closet', sample: true })));
    expect(res.status).toBe(201);
    expectClean(((await res.json()) as { project: Project }).project);
  });
});
