import { describe, it, expect } from 'vitest';
import { loadCatalog } from '../catalog/loader';
import { rotateAround, type Point } from './geometry';
import { ProjectSchema, type Opening, type PlacedItem, type Project } from './schemas';
import { wallElevations, type WallElevation } from './elevation';

const catalog = loadCatalog();
const CW: Point[] = [[0, 0], [4000, 0], [4000, 3000], [0, 3000]]; // walls: north, east, south, west
const CCW: Point[] = [[0, 0], [0, 3000], [4000, 3000], [4000, 0]]; // walls: west, south, east, north

let n = 0;
/** A catalog item centred at (x, y), rotated, with its catalog mount and first tag. */
function at(catalogId: string, x: number, y: number, rotationDeg = 0): PlacedItem {
  const c = catalog.byId.get(catalogId);
  n += 1;
  return {
    id: `i${n}`,
    catalogId,
    sizeMm: c?.sizeMm ?? { w: 600, d: 560, h: 900 },
    ...(c && c.mount !== 'floor' ? { mount: c.mount } : {}),
    position: { x, y },
    rotationDeg,
    ...(c?.tags[0] ? { tag: c.tags[0] } : {}),
  };
}
/** Against the north wall (y = 0), left edge at `left`, facing south (into the room). */
function north(catalogId: string, left: number): PlacedItem {
  const { w, d } = catalog.byId.get(catalogId)!.sizeMm;
  return at(catalogId, left + w / 2, d / 2);
}

function kitchen(items: PlacedItem[], polygon: Point[] = CW, openings: Omit<Opening, 'id'>[] = [], units: 'mm' | 'in' = 'mm'): Project {
  const walls = polygon.map((_, i) => ({ id: `w${i}`, thicknessMm: 100 }));
  return ProjectSchema.parse({
    id: 'p', name: 'k', units, createdAt: 'x', updatedAt: 'x', revision: 0, photos: [],
    room: { polygon, walls, openings: openings.map((o, i) => ({ id: `o${i}`, ...o })) },
    items, history: [],
  });
}
const wall = (es: WallElevation[], label: RegExp) => es.find((e) => label.test(e.label))!;

describe('wallElevations — which items', () => {
  it('draws an item backed against a wall, seen from inside, with its label and the default ceiling', () => {
    const [e, ...rest] = wallElevations(kitchen([north('base-600x560x720', 300)]), catalog);
    expect(rest).toEqual([]); // walls with nothing on them are skipped
    expect(e).toMatchObject({ wallIndex: 0, label: 'Wall 1 — north, 4000 mm', lengthMm: 4000, ceilingMm: 2400, openings: [] });
    expect(e.pieces).toEqual([
      { itemId: expect.any(String), name: 'Base cabinet 600 mm', tag: 'base', kind: 'base', x: 300, w: 600, y: 0, h: 860, plinthMm: 100 },
    ]);
  });

  it('gives the same x in a room drawn the other way round', () => {
    const items = [north('base-600x560x720', 300)];
    expect(wall(wallElevations(kitchen(items, CCW), catalog), /north/).pieces[0].x).toBe(300);
    expect(wall(wallElevations(kitchen(items, CCW), catalog), /north/).label).toBe('Wall 4 — north, 4000 mm');
  });

  it('measures from the viewer’s left: north end of the east wall, and the far end of the west wall', () => {
    // East wall, facing west (rotation 90), spanning y 200..800.
    const east = at('base-600x560x720', 4000 - 280, 500, 90);
    // Corner cabinet in the north-west corner: on the north wall and the west wall.
    const corner = at('corner-base-900x900x720', 450, 450, 0);
    const es = wallElevations(kitchen([east, corner]), catalog);
    expect(wall(es, /east/).pieces[0]).toMatchObject({ x: 200, w: 600 });
    expect(wall(es, /north/).pieces[0]).toMatchObject({ x: 0, w: 900, kind: 'base', plinthMm: 100 });
    // Facing west, the left end of the west wall is its south end (y = 3000).
    expect(wall(es, /west/).pieces[0]).toMatchObject({ x: 2100, w: 900 });
  });

  it('leaves out items turned away, 60 mm off the wall, islands and tables', () => {
    const items = [
      at('base-600x560x720', 600, 280, 180),
      at('base-600x560x720', 1600, 340),
      at('island-1200x900', 3000, 450),
      at('table-dining-4', 3000, 2000),
    ];
    expect(wallElevations(kitchen(items), catalog)).toEqual([]);
  });

  it('clips an item that runs past the end of the wall', () => {
    expect(wallElevations(kitchen([at('base-600x560x720', 4100, 280)]), catalog)[0].pieces[0]).toMatchObject({ x: 3800, w: 200 });
  });

  it('gives the same elevations when the whole room is turned 30°', () => {
    const items = [north('base-600x560x720', 300), north('range-760', 900), at('base-600x560x720', 4000 - 280, 500, 90)];
    const turn = (p: Point) => rotateAround(p, [0, 0], 30);
    const turned = items.map((it) => {
      const [x, y] = turn([it.position.x, it.position.y]);
      return { ...it, position: { x, y }, rotationDeg: it.rotationDeg + 30 };
    });
    const strip = (es: WallElevation[]) => es.map((e) => ({ wallIndex: e.wallIndex, pieces: e.pieces.map((p) => ({ ...p, x: Math.round(p.x), w: Math.round(p.w) })) }));
    expect(strip(wallElevations(kitchen(turned, CW.map(turn)), catalog))).toEqual(strip(wallElevations(kitchen(items), catalog)));
  });

  it('labels an unknown catalog id with the id, uses inches for an inch project, and returns nothing for a closet', () => {
    const odd = { ...north('base-600x560x720', 0), catalogId: 'mystery-thing', tag: undefined };
    const [e] = wallElevations(kitchen([odd], CW, [], 'in'), catalog);
    expect(e.pieces[0]).toMatchObject({ name: 'mystery-thing', kind: 'appliance' });
    expect(e.label).toBe('Wall 1 — north, 13\' 1 1/2"');
    const closet = { ...kitchen([north('base-600x560x720', 0)]), kind: 'closet' as const };
    expect(wallElevations(closet, catalog)).toEqual([]);
  });
});

describe('wallElevations — heights', () => {
  it('gives each kind of item its standard height', () => {
    const items = [
      north('base-600x560x720', 0),
      north('sink-base-900', 600),
      north('filler-base-50x560x720', 1500),
      north('dishwasher-600', 1550),
      north('range-760', 2150),
      north('fridge-600', 2910),
      north('tall-400x560x2100', 3510),
      north('wall-600x320x720', 0),
      north('range-hood-760', 2150),
      north('microwave-over-range-760', 1300),
      north('microwave-countertop', 600),
    ];
    const e = wallElevations(kitchen(items), catalog)[0];
    const yhp = (id: string) => {
      const p = e.pieces.find((q) => q.name === catalog.byId.get(id)!.name)!;
      return [p.kind, p.y, p.h, p.plinthMm];
    };
    expect(yhp('base-600x560x720')).toEqual(['base', 0, 860, 100]);
    expect(yhp('sink-base-900')).toEqual(['base', 0, 860, 100]);
    expect(yhp('filler-base-50x560x720')).toEqual(['base', 0, 860, 100]);
    expect(yhp('dishwasher-600')).toEqual(['appliance', 0, 860, 0]);
    expect(yhp('range-760')).toEqual(['appliance', 0, 900, 0]);
    expect(yhp('fridge-600')).toEqual(['appliance', 0, catalog.byId.get('fridge-600')!.sizeMm.h, 0]);
    expect(yhp('tall-400x560x2100')).toEqual(['tall', 0, 2200, 100]);
    expect(yhp('wall-600x320x720')).toEqual(['wall', 1450, 720, 0]);
    expect(yhp('range-hood-760')).toEqual(['wall', 1600, catalog.byId.get('range-hood-760')!.sizeMm.h, 0]);
    expect(yhp('microwave-over-range-760')).toEqual(['wall', 1450, catalog.byId.get('microwave-over-range-760')!.sizeMm.h, 0]);
    expect(yhp('microwave-countertop')).toEqual(['counter-appliance', 900, catalog.byId.get('microwave-countertop')!.sizeMm.h, 0]);
    // Sorted by x, then by height above the floor.
    const xs = e.pieces.map((p) => [Math.round(p.x), p.y]);
    expect(xs).toEqual([...xs].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
  });

  it('raises the ceiling over anything taller than 2300 mm', () => {
    const tall = { ...north('tall-600x560x2100', 0), sizeMm: { w: 600, d: 560, h: 2400 } };
    expect(wallElevations(kitchen([tall]), catalog)[0].ceilingMm).toBe(2600);
  });
});

describe('wallElevations — countertop and openings', () => {
  it('runs the countertop over adjacent bases and dishwashers, broken by a range', () => {
    const items = [north('base-600x560x720', 0), north('dishwasher-600', 650), north('range-760', 1250), north('base-600x560x720', 2010)];
    expect(wallElevations(kitchen(items), catalog)[0].counters).toEqual([
      { x: 0, w: 1250 },
      { x: 2010, w: 600 },
    ]);
  });

  it('puts windows at the sill height and doors on the floor, flipped to the viewer’s left', () => {
    // CCW room: wall 0 is the west wall, from (0,0) to (0,3000); facing west, its left end is (0,3000).
    const items = [at('base-600x560x720', 280, 2000, 270), north('base-600x560x720', 0)];
    const es = wallElevations(
      kitchen(items, CCW, [
        { wallId: 'w0', kind: 'door', positionMm: 500, widthMm: 800, heightMm: 2100 },
        { wallId: 'w3', kind: 'window', positionMm: 1000, widthMm: 900, heightMm: 1200 },
      ]),
      catalog
    );
    expect(wall(es, /west/).openings).toEqual([{ openingId: 'o0', kind: 'door', x: 1700, w: 800, y: 0, h: 2100 }]);
    // CCW wall 3 runs from (4000,0) to (0,0): facing north its left end is (0,0), so x = 4000 − 1000 − 900.
    expect(wall(es, /north/).openings).toEqual([{ openingId: 'o1', kind: 'window', x: 2100, w: 900, y: 1050, h: 1200 }]);
  });
});
