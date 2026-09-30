import { describe, it, expect } from 'vitest';
import { compileCommands, CommandError, CommandSchema, planRefs, type Command } from './commands';
import { commitRevision } from './diff';
import { loadCatalog } from '../catalog/loader';
import { ProjectSchema, type PlacedItem, type Project } from './schemas';

const catalog = loadCatalog();

/** 3000 × 4000 room: w1 top (north), w2 right, w3 bottom, w4 left. */
function project(extra: Partial<Project> = {}): Project {
  return ProjectSchema.parse({
    id: 'p',
    name: 'Kitchen',
    units: 'mm',
    createdAt: 'x',
    updatedAt: 'x',
    revision: 5,
    photos: [],
    room: {
      polygon: [
        [0, 0],
        [3000, 0],
        [3000, 4000],
        [0, 4000],
      ],
      walls: ['wa', 'wb', 'wc', 'wd'].map((id) => ({ id, thicknessMm: 100 })),
      openings: [{ id: 'door', wallId: 'wd', kind: 'door', positionMm: 2800, widthMm: 800, heightMm: 2100 }],
    },
    items: [],
    history: [],
    ...extra,
  });
}

const dishwasher: PlacedItem = {
  id: 'dw',
  catalogId: 'dishwasher-600',
  sizeMm: { w: 600, d: 580, h: 850 },
  position: { x: 1250, y: 290 },
  rotationDeg: 0,
};

let n = 0;
const ids = () => `new-${++n}`;
const run = (p: Project, commands: Command[]) => compileCommands(p, commands, catalog, ids);

describe('planRefs', () => {
  it('gives short, 1-based refs in plan order', () => {
    const refs = planRefs(project({ items: [dishwasher] }));
    expect(refs.items).toEqual(new Map([['i1', 'dw']]));
    expect(refs.walls).toEqual(new Map([['w1', 0], ['w2', 1], ['w3', 2], ['w4', 3]]));
    expect(refs.openings).toEqual(new Map([['o1', 'door']]));
  });
});

describe('compileCommands', () => {
  it('adds a catalog item against a wall at a distance along it', () => {
    const { project: next } = run(project(), [{ type: 'addItem', catalogId: 'dishwasher-600', wall: 'w1', alongMm: 1250 }]);
    expect(next.items).toEqual([
      expect.objectContaining({
        catalogId: 'dishwasher-600',
        sizeMm: { w: 600, d: 580, h: 850 },
        clearanceMm: { front: 750, sides: 0 },
        position: { x: 1250, y: 290 },
        rotationDeg: 0,
      }),
    ]);
  });

  it('centres an item on the wall when no distance is given', () => {
    const { project: next } = run(project(), [{ type: 'addItem', catalogId: 'dishwasher-600', wall: 'w2' }]);
    expect(next.items[0]).toMatchObject({ position: { x: 2710, y: 2000 }, rotationDeg: 90 });
  });

  it('adds an item at x/y (free placement)', () => {
    const { project: next } = run(project(), [{ type: 'addItem', catalogId: 'island-1200x900', x: 1500, y: 2000 }]);
    expect(next.items[0]).toMatchObject({ position: { x: 1500, y: 2000 }, rotationDeg: 0 });
  });

  it('moves an item to another wall, keeping its position along the room', () => {
    // Bottom wall w3 runs (3000,4000) → (0,4000).
    const { project: next } = run(project({ items: [dishwasher] }), [{ type: 'moveItem', item: 'i1', wall: 'w3' }]);
    expect(next.items[0]).toMatchObject({ id: 'dw', position: { x: 1250, y: 3710 }, rotationDeg: 180 });
  });

  it('moves an item to x/y, keeping its rotation', () => {
    const rotated = { ...dishwasher, rotationDeg: 45 };
    const { project: next } = run(project({ items: [rotated] }), [{ type: 'moveItem', item: 'i1', x: 1500, y: 2000 }]);
    expect(next.items[0]).toMatchObject({ position: { x: 1500, y: 2000 }, rotationDeg: 45 });
  });

  it('rotates (normalised to 0–359°) and removes items', () => {
    const p = project({ items: [dishwasher] });
    expect(run(p, [{ type: 'rotateItem', item: 'i1', rotationDeg: 450 }]).project.items[0].rotationDeg).toBe(90);
    expect(run(p, [{ type: 'rotateItem', item: 'i1', rotationDeg: -90 }]).project.items[0].rotationDeg).toBe(270);
    expect(run(p, [{ type: 'removeItem', item: 'i1' }]).project.items).toEqual([]);
  });

  it('changes wall thickness, adds and removes openings, and renames', () => {
    const { project: next } = run(project(), [
      { type: 'setWallThickness', wall: 'w1', thicknessMm: 200 },
      { type: 'addOpening', wall: 'w1', kind: 'window', alongMm: 1500, widthMm: 1000 },
      { type: 'removeOpening', opening: 'o1' },
      { type: 'renameProject', name: 'Galley' },
    ]);
    expect(next.room.walls[0].thicknessMm).toBe(200);
    expect(next.room.openings).toEqual([
      expect.objectContaining({ wallId: 'wa', kind: 'window', positionMm: 1000, widthMm: 1000 }),
    ]);
    expect(next.name).toBe('Galley');
  });

  it('applies commands in order', () => {
    const { project: next } = run(project({ items: [dishwasher] }), [
      { type: 'moveItem', item: 'i1', wall: 'w2' },
      { type: 'rotateItem', item: 'i1', rotationDeg: 0 },
    ]);
    // On w2 it keeps its place along the room: y=290 → 300 (pushed off the corner).
    expect(next.items[0]).toMatchObject({ position: { x: 2710, y: 300 }, rotationDeg: 0 });
  });

  it('returns a patch that commits to exactly the compiled project', () => {
    const p = project({ items: [dishwasher] });
    const { project: next, patch } = run(p, [
      { type: 'moveItem', item: 'i1', wall: 'w2' },
      { type: 'addItem', catalogId: 'fridge-600', wall: 'w1', alongMm: 400 },
    ]);
    const committed = commitRevision(p, patch, { baseRevision: 5, source: 'llm', summary: 's' });
    expect(committed.items).toEqual(next.items);
  });

  it('names the command and the valid refs when a ref is unknown', () => {
    const err = (() => {
      try {
        run(project({ items: [dishwasher] }), [
          { type: 'rotateItem', item: 'i1', rotationDeg: 90 },
          { type: 'moveItem', item: 'i7', wall: 'w1' },
        ]);
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(CommandError);
    expect((err as Error).message).toBe('commands[1] (moveItem): unknown item "i7" — items are i1');
  });

  it('rejects unknown catalog ids, missing positions, and bad walls', () => {
    expect(() => run(project(), [{ type: 'addItem', catalogId: 'hot-tub' }])).toThrow(/unknown catalog id "hot-tub"/);
    expect(() => run(project(), [{ type: 'addItem', catalogId: 'dishwasher-600' }])).toThrow(/needs a wall.*or x and y/);
    expect(() => run(project(), [{ type: 'addItem', catalogId: 'dishwasher-600', wall: 'w9' }])).toThrow(
      /unknown wall "w9" — walls are w1–w4/
    );
    expect(() => run(project(), [{ type: 'addItem', catalogId: 'island-1200x900', x: 9000, y: 9000 }])).toThrow(
      /commands\[0\].*inside the room/
    );
  });

  it('rejects a result that breaks the plan (e.g. overlapping openings)', () => {
    expect(() => run(project(), [{ type: 'addOpening', wall: 'w4', kind: 'window', alongMm: 3100 }])).toThrow(
      /commands\[0\].*overlap/
    );
  });

  it('parses LLM command JSON with the schema', () => {
    expect(CommandSchema.parse({ type: 'moveItem', item: 'i1', wall: 'w2' })).toEqual({ type: 'moveItem', item: 'i1', wall: 'w2' });
    expect(() => CommandSchema.parse({ type: 'teleport', item: 'i1' })).toThrow();
  });
});
