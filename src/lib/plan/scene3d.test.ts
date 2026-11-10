import { describe, it, expect } from 'vitest';
import { loadCatalog } from '../catalog/loader';
import type { Point } from './geometry';
import { ProjectSchema, type Finishes, type Opening, type PlacedItem, type Project } from './schemas';
import { buildScene, type Prism } from './scene3d';

const catalog = loadCatalog();
const CW: Point[] = [[0, 0], [4000, 0], [4000, 3000], [0, 3000]];
const L_SHAPE: Point[] = [[0, 0], [4000, 0], [4000, 1500], [2000, 1500], [2000, 3000], [0, 3000]];

let n = 0;
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
const north = (catalogId: string, left: number): PlacedItem => {
  const { w, d } = catalog.byId.get(catalogId)!.sizeMm;
  return at(catalogId, left + w / 2, d / 2);
};

function kitchen(items: PlacedItem[] = [], opts: { polygon?: Point[]; openings?: Omit<Opening, 'id'>[]; finishes?: Finishes } = {}): Project {
  const polygon = opts.polygon ?? CW;
  return ProjectSchema.parse({
    id: 'p', name: 'k', units: 'mm', createdAt: 'x', updatedAt: 'x', revision: 0, photos: [],
    room: {
      polygon,
      walls: polygon.map((_, i) => ({ id: `w${i}`, thicknessMm: 100 })),
      openings: (opts.openings ?? []).map((o, i) => ({ id: `o${i}`, ...o })),
    },
    items,
    ...(opts.finishes ? { finishes: opts.finishes } : {}),
    history: [],
  });
}

const of = (prisms: Prism[], kind: Prism['kind']) => prisms.filter((p) => p.kind === kind);
const xs = (p: Prism) => p.footprint.map((q) => q[0]);
const ys = (p: Prism) => p.footprint.map((q) => q[1]);
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('buildScene — the room', () => {
  it('has the floor as the room outline, and one full-height wall prism per wall when nothing is cut', () => {
    const { prisms, ceilingMm } = buildScene(kitchen());
    expect(ceilingMm).toBe(2400);
    const [floor] = of(prisms, 'floor');
    expect(floor.footprint).toEqual(CW);
    expect(floor.top).toBe(0);
    const walls = of(prisms, 'wall');
    expect(walls).toHaveLength(4);
    for (const w of walls) expect([w.bottom, w.top]).toEqual([0, 2400]);
  });

  it('puts each wall outside the room outline, mitred at the corners, with its inner face on the outline', () => {
    const north = of(buildScene(kitchen()).prisms, 'wall')[0];
    const pts = north.footprint.map(([x, y]) => `${Math.round(x)},${Math.round(y)}`).sort();
    expect(pts).toEqual(['-100,-100', '0,0', '4000,0', '4100,-100'].sort());
  });

  it('says which way each wall faces out, so the walls between the camera and the room can be hidden', () => {
    const outward = of(buildScene(kitchen()).prisms, 'wall').map((w) => w.outward!.map((v) => Math.round(v) + 0));
    expect(outward).toEqual([[0, -1], [1, 0], [0, 1], [-1, 0]]);
  });

  it('handles an L-shaped room: six walls', () => {
    const { prisms, bounds } = buildScene(kitchen([], { polygon: L_SHAPE }));
    expect(of(prisms, 'wall')).toHaveLength(6);
    expect(of(prisms, 'floor')[0].footprint).toEqual(L_SHAPE);
    expect(bounds.minX).toBeLessThan(0);
    expect(bounds.maxX).toBeGreaterThan(4000);
  });

  it('bounds cover the outer faces of the walls', () => {
    const { bounds } = buildScene(kitchen());
    expect(bounds).toEqual({ minX: -100, minY: -100, maxX: 4100, maxY: 3100 });
  });

  it('is empty for a closet', () => {
    const closet = { ...kitchen(), kind: 'closet' as const, closet: { widthMm: 1000, heightMm: 2400, depthMm: 600, opening: { style: 'open' as const, leftMm: 0, widthMm: 1000 }, components: [] } };
    expect(buildScene(closet).prisms).toEqual([]);
  });
});

describe('buildScene — doors and windows', () => {
  it('a door splits its wall in three: either side full height, and a lintel over the door', () => {
    const project = kitchen([], { openings: [{ wallId: 'w0', kind: 'door', positionMm: 1000, widthMm: 900, heightMm: 2000 }] });
    const walls = of(buildScene(project).prisms, 'wall');
    expect(walls).toHaveLength(6); // 3 on the north wall, 3 other walls
    const onNorth = walls.filter((w) => ys(w).every((y) => y <= 1e-6)).sort((a, b) => Math.min(...xs(a)) - Math.min(...xs(b)));
    expect(onNorth).toHaveLength(3);
    const lintel = onNorth.find((w) => w.bottom === 2000)!;
    expect(lintel.top).toBe(2400);
    close(Math.min(...xs(lintel)), 1000);
    close(Math.max(...xs(lintel)), 1900);
    expect(onNorth.filter((w) => w.bottom === 0)).toHaveLength(2);
  });

  it('a window leaves wall below the sill and above the head, and a pane between', () => {
    const project = kitchen([], { openings: [{ wallId: 'w0', kind: 'window', positionMm: 1000, widthMm: 1000, heightMm: 1200 }] });
    const { prisms } = buildScene(project);
    const [pane] = of(prisms, 'pane');
    expect([pane.bottom, pane.top]).toEqual([1050, 2250]);
    expect(pane.opacity).toBeLessThan(1);
    const walls = of(prisms, 'wall');
    expect(walls.find((w) => w.bottom === 0 && w.top === 1050)).toBeTruthy();
    expect(walls.find((w) => w.bottom === 2250 && w.top === 2400)).toBeTruthy();
    // 2 full pieces beside the window, sill, head, and the other 3 walls
    expect(walls).toHaveLength(7);
  });

  it('a window taller than the wall has no head piece', () => {
    const project = kitchen([], { openings: [{ wallId: 'w0', kind: 'window', positionMm: 1000, widthMm: 1000, heightMm: 1350 }] });
    expect(of(buildScene(project).prisms, 'wall').filter((w) => w.bottom >= 2400)).toHaveLength(0);
  });

  it('never makes an empty or inside-out piece, even for overlapping or off-the-end openings', () => {
    const project = kitchen([], {
      openings: [
        { wallId: 'w0', kind: 'door', positionMm: 100, widthMm: 900, heightMm: 2000 },
        { wallId: 'w0', kind: 'window', positionMm: 600, widthMm: 900, heightMm: 1000 },
        { wallId: 'w0', kind: 'door', positionMm: 3700, widthMm: 900, heightMm: 2000 },
      ],
    });
    for (const p of buildScene(project).prisms) {
      expect(p.top).toBeGreaterThan(p.bottom);
      const w = Math.max(...xs(p)) - Math.min(...xs(p));
      const d = Math.max(...ys(p)) - Math.min(...ys(p));
      expect(w * d).toBeGreaterThan(0);
    }
  });
});

describe('buildScene — items', () => {
  it('a base cabinet is a box to the counter underside, topped by a countertop slab, in the finishes colours', () => {
    const { prisms } = buildScene(kitchen([north('base-600x560x720', 0)]));
    const [cabinet] = of(prisms, 'cabinet');
    expect([cabinet.bottom, cabinet.top]).toEqual([0, 860]);
    expect(cabinet.color).toBe('#f3e8d2');
    const [slab] = of(prisms, 'slab');
    expect([slab.bottom, slab.top]).toEqual([860, 900]);
    expect(slab.color).toBe('#374151');
    expect(xs(cabinet).sort()).toEqual(xs(slab).sort());
  });

  it('follows the finishes', () => {
    const finishes: Finishes = { cabinetColor: '#1e3a5f', doorStyle: 'slab', countertop: 'granite' };
    const { prisms } = buildScene(kitchen([north('base-600x560x720', 0)], { finishes }));
    expect(of(prisms, 'cabinet')[0].color).toBe('#1e3a5f');
    expect(of(prisms, 'slab')[0].color).toBe('#6b6258');
  });

  it('hangs wall cabinets at 1450 mm and the range hood at 1600 mm', () => {
    const { prisms } = buildScene(kitchen([north('wall-600x320x720', 0), north('range-hood-760', 1000)]));
    const wallCabinet = of(prisms, 'cabinet')[0];
    expect(wallCabinet.bottom).toBe(1450);
    expect(wallCabinet.top).toBe(1450 + 720);
    const hood = of(prisms, 'appliance')[0];
    expect(hood.bottom).toBe(1600);
    expect(hood.top).toBe(1900);
    expect(of(prisms, 'slab')).toHaveLength(0);
  });

  it('draws a fridge to its own height in appliance grey, and a range to counter height with no slab', () => {
    const { prisms } = buildScene(kitchen([north('fridge-standard-910', 0), north('range-760', 1000)]));
    const [fridge, range] = of(prisms, 'appliance');
    expect([fridge.bottom, fridge.top]).toEqual([0, 1780]);
    expect([range.bottom, range.top]).toEqual([0, 900]);
    expect(fridge.color).toBe(range.color);
    expect(of(prisms, 'slab')).toHaveLength(0);
  });

  it('a dishwasher gets a countertop over it', () => {
    const { prisms } = buildScene(kitchen([north('dishwasher-600', 0)]));
    expect([of(prisms, 'appliance')[0].top]).toEqual([860]);
    expect(of(prisms, 'slab')).toHaveLength(1);
  });

  it('an island is cabinet colour with a slab; a table and a stool are plain furniture', () => {
    const { prisms } = buildScene(kitchen([at('island-1200x900', 2000, 1500), at('table-dining-4', 1000, 2200), at('stool-counter-650', 3000, 2200)]));
    const island = of(prisms, 'cabinet')[0];
    expect([island.bottom, island.top]).toEqual([0, 860]);
    const [slab] = of(prisms, 'slab');
    expect([slab.bottom, slab.top]).toEqual([860, 900]);
    const [table, stool] = of(prisms, 'furniture');
    expect([table.bottom, table.top]).toEqual([0, 750]);
    expect([stool.bottom, stool.top]).toEqual([0, 650]);
  });

  it('rotates an item with its footprint', () => {
    const { prisms } = buildScene(kitchen([at('fridge-standard-910', 2000, 1500, 90)]));
    const f = of(prisms, 'appliance')[0];
    close(Math.max(...xs(f)) - Math.min(...xs(f)), 890);
    close(Math.max(...ys(f)) - Math.min(...ys(f)), 910);
  });
});
