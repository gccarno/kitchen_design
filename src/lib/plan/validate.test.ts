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

describe('validatePlan: project kind', () => {
  const closet: NonNullable<Project['closet']> = {
    widthMm: 1830,
    heightMm: 2440,
    depthMm: 610,
    opening: { style: 'bifold', leftMm: 0, widthMm: 1830 },
    components: [],
  };

  it('accepts a closet project with a closet', () => {
    expect(validatePlan(newProject({ kind: 'closet', closet })).valid).toBe(true);
  });

  it('rejects a closet project without a closet', () => {
    expect(validatePlan(newProject({ kind: 'closet' })).errors).toContain('closet project has no closet');
  });

  it('rejects closet data on a kitchen', () => {
    expect(validatePlan(newProject({ closet })).errors).toContain('only closet projects can have a closet');
  });

  it('reports the closet’s own errors', () => {
    const bad = { ...closet, opening: { ...closet.opening, widthMm: 5000 } };
    expect(validatePlan(newProject({ kind: 'closet', closet: bad })).valid).toBe(false);
  });
});

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

  it('rejects openings that overlap on the same wall', () => {
    const r = validatePlan(
      newProject({
        room: {
          polygon: RECT,
          walls: wallsFor(RECT),
          openings: [
            { id: 'd1', wallId: 'w0', kind: 'door', positionMm: 100, widthMm: 900, heightMm: 2100 },
            { id: 'w1', wallId: 'w0', kind: 'window', positionMm: 900, widthMm: 1200, heightMm: 1200 },
            { id: 'w2', wallId: 'w1', kind: 'window', positionMm: 100, widthMm: 900, heightMm: 1200 },
          ],
        },
      })
    );
    expect(r.valid).toBe(false);
    expect(r.errors).toEqual(['openings "d1" and "w1" overlap on wall "w0"']);
  });

  it('allows openings that touch end to end', () => {
    const r = validatePlan(
      newProject({
        room: {
          polygon: RECT,
          walls: wallsFor(RECT),
          openings: [
            { id: 'd1', wallId: 'w0', kind: 'door', positionMm: 100, widthMm: 900, heightMm: 2100 },
            { id: 'w1', wallId: 'w0', kind: 'window', positionMm: 1000, widthMm: 1200, heightMm: 1200 },
          ],
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

  it('only checks overlap between items at the same mount level', () => {
    // A wall cabinet above a base cabinet, and a counter microwave on it: normal kitchen.
    const r = validatePlan(
      newProject({
        items: [
          item('base', 1000, 1000),
          item('wall', 1000, 1000, { mount: 'wall' }),
          item('micro', 1000, 1000, { mount: 'counter' }),
        ],
      })
    );
    expect(r.warnings).toEqual([]);
  });

  it('treats a missing mount as floor', () => {
    const r = validatePlan(newProject({ items: [item('a', 1000, 1000), item('b', 1050, 1050, { mount: 'floor' })] }));
    expect(r.warnings.join(' ')).toMatch(/overlap/);
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

  describe('clearances', () => {
    const fridge = (x: number, y: number, rotationDeg = 0): PlacedItem => ({
      id: `fridge-${x}-${y}`,
      catalogId: 'fridge-standard-910',
      sizeMm: { w: 910, d: 890, h: 1780 },
      clearanceMm: { front: 1000, sides: 50 },
      position: { x, y },
      rotationDeg,
    });
    // Against the top wall, front facing down into the room.
    const goodFridge = () => fridge(1500, 445);

    it('is quiet for a well-placed item', () => {
      expect(validatePlan(newProject({ items: [goodFridge()] })).warnings).toEqual([]);
    });

    it('warns when something stands in the front clearance', () => {
      const island = item('island', 1500, 1400, { catalogId: 'island-1200x900', sizeMm: { w: 1200, d: 900, h: 900 } });
      const r = validatePlan(newProject({ items: [goodFridge(), island] }));
      expect(r.warnings).toEqual(['not enough room in front of "fridge-standard-910": "island-1200x900" is in the way']);
    });

    it('ignores wall-mounted items above the clearance zone', () => {
      const wallCab = item('wc', 1500, 1400, { catalogId: 'wall-600x320x720', mount: 'wall' });
      expect(validatePlan(newProject({ items: [goodFridge(), wallCab] })).warnings).toEqual([]);
    });

    it('warns when the item faces a wall', () => {
      const r = validatePlan(newProject({ items: [fridge(1500, 445, 180)] }));
      expect(r.warnings).toContain('not enough room in front of "fridge-standard-910": it faces a wall');
    });

    it('warns when there is not enough room at the sides', () => {
      const r = validatePlan(newProject({ items: [fridge(455, 445)] })); // tucked into the corner
      expect(r.warnings).toEqual(['"fridge-standard-910" needs 50 mm at its sides: a wall is too close']);
      const tall = item('tall', 1500 + 455 + 20 + 300, 280, { catalogId: 'tall-600x560x2100' });
      const r2 = validatePlan(newProject({ items: [goodFridge(), tall] }));
      expect(r2.warnings).toEqual(['"fridge-standard-910" needs 50 mm at its sides: "tall-600x560x2100" is too close']);
    });

    it('skips items without a clearance snapshot', () => {
      const plain = { ...goodFridge(), clearanceMm: undefined };
      expect(validatePlan(newProject({ items: [plain, item('x', 1500, 1400)] })).warnings).toEqual([]);
    });
  });

  describe('door swing', () => {
    // A door on the top wall from x=1000 to x=1800 swings into the room over (1000..1800, 0..800).
    const door = { id: 'd', wallId: 'w0', kind: 'door' as const, positionMm: 1000, widthMm: 800, heightMm: 2100 };
    const room = { polygon: RECT, walls: wallsFor(RECT), openings: [door] };

    it('warns when a floor item is in the swing', () => {
      const r = validatePlan(newProject({ room, items: [item('table', 1400, 700, { catalogId: 'table-dining-4' })] }));
      expect(r.warnings).toEqual(['the door on wall 1 would hit "table-dining-4"']);
    });

    it('is quiet when the swing is clear, or the item is wall-mounted', () => {
      expect(validatePlan(newProject({ room, items: [item('t', 1400, 1500)] })).warnings).toEqual([]);
      expect(
        validatePlan(newProject({ room, items: [item('w', 1400, 300, { catalogId: 'wall-600x320x720', mount: 'wall' })] }))
          .warnings
      ).toEqual([]);
    });

    it('ignores windows', () => {
      const win = { ...door, kind: 'window' as const };
      const r = validatePlan(newProject({ room: { ...room, openings: [win] }, items: [item('t', 1400, 700)] }));
      expect(r.warnings).toEqual([]);
    });
  });
});
