import { describe, it, expect } from 'vitest';
import { validatePlan } from './validate';
import { ProjectSchema, type PlacedItem, type Project } from './schemas';

type Poly = Project['room']['polygon'];

const RECT: Poly = [
  [0, 0],
  [3000, 0],
  [3000, 4000],
  [0, 4000],
];

/** One wall per polygon edge: w0..w{n-1}. */
function wallsFor(poly: Poly) {
  return poly.map((_, i) => ({ id: `w${i}`, thicknessMm: 100 }));
}

function newProject(overrides: Partial<Project> = {}): Project {
  const now = new Date('2026-01-01T00:00:00.000Z').toISOString();
  return ProjectSchema.parse({
    id: 'p1',
    name: 'P',
    units: 'mm',
    createdAt: now,
    updatedAt: now,
    revision: 0,
    photos: [],
    room: { polygon: RECT, walls: wallsFor(RECT), openings: [] },
    items: [],
    history: [],
    ...overrides,
  });
}

function item(id: string, x: number, y: number, extra: Partial<PlacedItem> = {}): PlacedItem {
  return {
    id,
    catalogId: 'base-600',
    sizeMm: { w: 600, d: 560, h: 720 },
    position: { x, y },
    rotationDeg: 0,
    ...extra,
  };
}

describe('validatePlan', () => {
  it('returns valid for a clean project', () => {
    const r = validatePlan(newProject());
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('rejects a self-intersecting polygon', () => {
    const polygon: Poly = [
      [0, 0],
      [4000, 4000],
      [4000, 0],
      [0, 4000],
    ];
    const r = validatePlan(newProject({ room: { polygon, walls: wallsFor(polygon), openings: [] } }));
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/self.intersect/i);
  });

  it('reports a zero-area room polygon', () => {
    const polygon: Poly = [
      [0, 0],
      [100, 0],
      [200, 0],
    ];
    const r = validatePlan(newProject({ room: { polygon, walls: wallsFor(polygon), openings: [] } }));
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/area/i);
  });

  it('requires exactly one wall per polygon edge', () => {
    const r = validatePlan(newProject({ room: { polygon: RECT, walls: wallsFor(RECT).slice(0, 3), openings: [] } }));
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/3 walls.*4 edges/);
  });

  it('reports duplicate wall ids', () => {
    const walls = wallsFor(RECT);
    walls[1].id = 'w0';
    const r = validatePlan(newProject({ room: { polygon: RECT, walls, openings: [] } }));
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/duplicate wall id/i);
  });

  it('rejects an opening referencing a non-existent wall', () => {
    const r = validatePlan(
      newProject({
        room: {
          polygon: RECT,
          walls: wallsFor(RECT),
          openings: [{ id: 'o0', wallId: 'w99', kind: 'door', positionMm: 0, widthMm: 900, heightMm: 2100 }],
        },
      })
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/unknown wall/i);
  });

  it('rejects an opening that runs past the end of its wall', () => {
    // w0 is the 3000mm edge (0,0)→(3000,0).
    const r = validatePlan(
      newProject({
        room: {
          polygon: RECT,
          walls: wallsFor(RECT),
          openings: [{ id: 'o0', wallId: 'w0', kind: 'window', positionMm: 2500, widthMm: 900, heightMm: 1200 }],
        },
      })
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/past the end/i);
  });

  it('accepts an opening that fits on its wall', () => {
    const r = validatePlan(
      newProject({
        room: {
          polygon: RECT,
          walls: wallsFor(RECT),
          openings: [{ id: 'o0', wallId: 'w0', kind: 'door', positionMm: 2100, widthMm: 900, heightMm: 2100 }],
        },
      })
    );
    expect(r.valid).toBe(true);
  });

  it('rejects a measurement referencing an unknown wall', () => {
    const r = validatePlan(
      newProject({
        room: {
          polygon: RECT,
          walls: wallsFor(RECT),
          openings: [],
          measurements: [{ wallId: 'nope', lengthMm: 3000, source: 'user' }],
        },
      })
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/measurement/i);
  });

  it('rejects a placed item whose centre is outside the room', () => {
    const r = validatePlan(newProject({ items: [item('i1', 10000, 10000)] }));
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/outside the room/i);
  });

  it('accepts a placed item fully inside the room', () => {
    const r = validatePlan(newProject({ items: [item('i1', 1500, 2000)] }));
    expect(r.valid).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it('warns when an item footprint pokes through a wall', () => {
    // Centre inside, but the 600mm-wide body extends 200mm past x=0.
    const r = validatePlan(newProject({ items: [item('i1', 100, 2000)] }));
    expect(r.valid).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/extends outside/i);
  });

  it('does not warn for items flush against the walls', () => {
    // Every corner of the room: footprints touch two walls exactly.
    const r = validatePlan(
      newProject({
        items: [item('a', 300, 280), item('b', 2700, 280), item('c', 2700, 3720), item('d', 300, 3720)],
      })
    );
    expect(r.warnings).toEqual([]);
  });

  it('reports overlapping items as warnings, not errors', () => {
    const r = validatePlan(newProject({ items: [item('i1', 1000, 1000), item('i2', 1050, 1050)] }));
    expect(r.valid).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/overlap/i);
  });

  it('uses each item size: small items side by side do not overlap', () => {
    const small = { sizeMm: { w: 100, d: 100, h: 100 } };
    const r = validatePlan(newProject({ items: [item('i1', 1000, 1000, small), item('i2', 1150, 1000, small)] }));
    expect(r.warnings).toEqual([]);
  });

  it('accounts for rotation when checking overlap', () => {
    // Two 1000×100 bars 300mm apart vertically: separate unrotated,
    // but crossing once one is rotated 90°.
    const bar = { sizeMm: { w: 1000, d: 100, h: 900 } };
    const apart = validatePlan(newProject({ items: [item('i1', 1500, 1000, bar), item('i2', 1500, 1300, bar)] }));
    expect(apart.warnings).toEqual([]);
    const crossed = validatePlan(
      newProject({ items: [item('i1', 1500, 1000, bar), item('i2', 1500, 1300, { ...bar, rotationDeg: 90 })] })
    );
    expect(crossed.warnings.join(' ')).toMatch(/overlap/i);
  });

  it('reports duplicate placed item ids', () => {
    const r = validatePlan(newProject({ items: [item('i1', 1000, 1000), item('i1', 2000, 3000)] }));
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/duplicate placed item id/i);
  });
});
