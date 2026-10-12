# Kitchen Wall Elevations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read-only front elevations of each kitchen wall, worked out from the floor plan, shown in the editor and exported as SVG and PNG.

**Architecture:** Pure geometry (`wallElevations`) finds the items and openings on each wall and gives them standard heights. A pure drawing step (`elevationDrawing`) turns one elevation into the shared `Shape` list, which feeds both a React SVG view and an SVG string export (`elevationsToSvg`), the same pipeline the closet elevation uses. The PNG export reuses `svgToPng`.

**Tech Stack:** TypeScript, React 19, Next.js 15 route handlers, Vitest with Testing Library (no jest-dom: use `toBeTruthy()` / `not.toBeNull()`), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-11-elevations-design.md`

## Global Constraints

- All lengths are stored in mm. Text shown to the user goes through `formatLength(mm, project.units)` from `src/lib/plan/viewport.ts`.
- `ELEVATION = { againstMm: 50, plinthMm: 100, counterTopMm: 900, counterThicknessMm: 40, wallCabinetBottomMm: 1450, hoodBottomMm: 1600, otrMicrowaveBottomMm: 1450, windowSillMm: 1050, ceilingMm: 2400 }`.
- Base, sink, filler and corner floor cabinets are drawn 860 mm high including a 100 mm plinth. Tall cabinets are drawn at their stored height + 100. The countertop runs from 860 to 900 mm.
- Items are on a wall when their front faces the room square to it (within 1°) and their back is within 50 mm (|distance from centre to wall − d/2| ≤ 50). Corner cabinets: any footprint edge within 50 mm.
- Never drawn: tags `island`, `table`, `chair`, `stool`.
- Walls are seen from inside the room: x runs from the wall end on the viewer's left.
- Kitchens only. `wallElevations` returns `[]` for closets.
- Export filenames: `<slug>-elevations.svg|png` (fallback `kitchen-elevations`), with `@2x` before `.png` at scale 2.
- Empty-state copy: "Place cabinets or appliances against a wall to see its elevation."
- Plan refinements to the spec (recorded in it in Task 57):
  - An appliance name that doesn't fit falls back to its short name (before the first " (" or ","), and is left out only if that doesn't fit either.
  - Width dimensions are drawn for floor pieces (below the floor) and wall pieces (above the ceiling); counter-top appliances get none.
  - Header links are labelled "Elevations as SVG" and "Elevations as PNG" so they don't clash with the plan's "SVG" link.

## Review Focus

1. **Rooms drawn in either direction (clockwise or counter-clockwise):** the same wall gives the same left-to-right drawing. Tested in Task 53 ("same x in a room drawn the other way round").
2. **Angled walls:** turning the whole room and its items by 30° gives the same elevations. Tested in Task 53.
3. **The picked wall disappears** (an undo removes everything on it): the view falls back to the first elevation instead of showing nothing or crashing. Tested in Task 56.
4. **Project names or unknown catalog ids with `<`, `&` or `"`** must not break the exported SVG. Tested in Task 55.
5. **A kitchen with nothing against a wall:** no elevation links, the empty-state text, and both routes return 404 with a message. Tested in Tasks 55 and 56.

---

### Task 52: Shared shapes and compass modules (refactor, no behaviour change)

**Files:**
- Create: `src/lib/drawing/shapes.ts`, `src/lib/plan/compass.ts`
- Modify: `src/lib/closet/drawing.ts` (remove the `Shape` type and `INK`, re-export them), `src/lib/closet/svg.ts` (remove `shapeToSvg`, import it), `src/lib/llm/plan-context.ts` (remove `compass`, re-export it)

**Interfaces:**
- Produces:
  - `type Shape`, `INK`, `shapeToSvg(s: Shape): string` from `@/lib/drawing/shapes`.
  - `compass([dx, dy]: Point): string` from `@/lib/plan/compass`.
  - Existing imports (`closet/drawing` → `Shape`, `INK`; `closet/svg` → `shapeToSvg`; `llm/plan-context` → `compass`) keep working through re-exports.

- [ ] **Step 1: Create `src/lib/drawing/shapes.ts`.** Move `Shape` and `INK` verbatim from `closet/drawing.ts`, and `shapeToSvg` (with its `r` helper) from `closet/svg.ts`:

```ts
/**
 * Plain drawing shapes, shared by the on-screen elevations (React SVG) and
 * the exported drawings (SVG strings). Coordinates are mm, y down. Pure.
 */

import { escapeXml } from '../plan/svg';

export type Shape = { componentId?: string } & (
  | { type: 'rect'; x: number; y: number; w: number; h: number; fill: string; stroke?: string; strokeWidth?: number; dash?: number[] }
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; strokeWidth: number; dash?: number[] }
  | { type: 'circle'; cx: number; cy: number; r: number; fill: string; stroke?: string; strokeWidth?: number }
  | { type: 'text'; x: number; y: number; text: string; size: number; anchor: 'start' | 'middle' | 'end'; fill: string }
);

export const INK = '#111827';

const r = (n: number) => Math.round(n * 10) / 10;

export function shapeToSvg(s: Shape): string {
  const dash = 'dash' in s && s.dash ? ` stroke-dasharray="${s.dash.join(' ')}"` : '';
  switch (s.type) {
    case 'rect':
      return `<rect x="${r(s.x)}" y="${r(s.y)}" width="${r(s.w)}" height="${r(s.h)}" fill="${s.fill}"${s.stroke ? ` stroke="${s.stroke}" stroke-width="${s.strokeWidth ?? 1}"` : ''}${dash}/>`;
    case 'line':
      return `<line x1="${r(s.x1)}" y1="${r(s.y1)}" x2="${r(s.x2)}" y2="${r(s.y2)}" stroke="${s.stroke}" stroke-width="${s.strokeWidth}"${dash}/>`;
    case 'circle':
      return `<circle cx="${r(s.cx)}" cy="${r(s.cy)}" r="${r(s.r)}" fill="${s.fill}"${s.stroke ? ` stroke="${s.stroke}" stroke-width="${s.strokeWidth ?? 1}"` : ''}/>`;
    case 'text':
      return `<text x="${r(s.x)}" y="${r(s.y)}" font-size="${r(s.size)}" text-anchor="${s.anchor}" dominant-baseline="middle" fill="${s.fill}">${escapeXml(s.text)}</text>`;
  }
}
```

- [ ] **Step 2: Rewire the closet modules.** In `closet/drawing.ts`, delete the `Shape` type and `INK` and add:

```ts
import { INK, type Shape } from '../drawing/shapes';
export { INK, type Shape };
```

In `closet/svg.ts`, delete `shapeToSvg` but keep its `r` helper, which the dimension code still uses. Add `import { shapeToSvg } from '../drawing/shapes';` and `export { shapeToSvg };`. Change `import { closetDrawing, INK, type Shape } from './drawing'` to `import { closetDrawing, INK } from './drawing'`.

- [ ] **Step 3: Move `compass`.** Create `src/lib/plan/compass.ts` with `NAMES` and `compass` moved verbatim from `plan-context.ts`:

```ts
import type { Point } from './geometry';

const NAMES = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** Compass name of a direction vector in plan coordinates (x east, y south). */
export function compass([dx, dy]: Point): string {
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI; // 0 = north, 90 = east
  return NAMES[((Math.round(deg / 45) % 8) + 8) % 8];
}
```

In `plan-context.ts`, delete them and add `import { compass } from '../plan/compass';` plus `export { compass };`.

- [ ] **Step 4: Run everything that touches these modules.**

Run: `npx vitest run src/lib/closet src/lib/llm src/components/ClosetEditor.test.tsx tests/integration && npx tsc --noEmit -p .`
Expected: all PASS with no snapshot changes (`git status` shows no `.snap` changes).

- [ ] **Step 5: Commit.**

```bash
git add src/lib/drawing src/lib/plan/compass.ts src/lib/closet src/lib/llm/plan-context.ts
git commit -m "refactor: shared drawing shapes and compass modules"
```

---

### Task 53: Wall elevation geometry (`src/lib/plan/elevation.ts`)

**Files:**
- Create: `src/lib/plan/elevation.ts`, `src/lib/plan/elevation.test.ts`

**Interfaces:**
- Consumes: `compass` (Task 52); `inwardNormal(room, i)` from `./walls`; `rotateAround`, `rotatedRectFootprint`, `Point` from `./geometry`; `wallIndexOf` from `./openings`; `formatLength` from `./viewport`; `Catalog` from `../catalog/loader`.
- Produces (used by Tasks 54–57):

```ts
export type PieceKind = 'base' | 'appliance' | 'tall' | 'wall' | 'counter-appliance';
export interface ElevationPiece { itemId: string; name: string; tag?: string; kind: PieceKind; x: number; w: number; y: number; h: number; plinthMm: number }
export interface ElevationOpening { openingId: string; kind: OpeningKind; x: number; w: number; y: number; h: number }
export interface WallElevation { wallIndex: number; label: string; lengthMm: number; ceilingMm: number; pieces: ElevationPiece[]; counters: { x: number; w: number }[]; openings: ElevationOpening[] }
export const ELEVATION: { againstMm: 50; plinthMm: 100; counterTopMm: 900; counterThicknessMm: 40; wallCabinetBottomMm: 1450; hoodBottomMm: 1600; otrMicrowaveBottomMm: 1450; windowSillMm: 1050; ceilingMm: 2400 };
export const CABINET_TAGS: ReadonlySet<string>; // base, sink, filler, corner, wall, tall
export function wallElevations(project: Project, catalog: Catalog): WallElevation[];
```

- [ ] **Step 1: Write the failing tests** in `src/lib/plan/elevation.test.ts`:

```ts
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
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/lib/plan/elevation.test.ts`
Expected: FAIL, `Failed to resolve import "./elevation"`.

- [ ] **Step 3: Implement `src/lib/plan/elevation.ts`.**

```ts
/**
 * Kitchen wall elevations: each wall seen from inside the room, with the
 * items backed against it and the doors and windows in it. The plan stores
 * no mounting heights, so items get standard ones from their tag. Pure.
 */

import type { Catalog } from '../catalog/loader';
import { compass } from './compass';
import { rotateAround, rotatedRectFootprint, type Point } from './geometry';
import { wallIndexOf } from './openings';
import { projectKind, type OpeningKind, type PlacedItem, type Project } from './schemas';
import { formatLength } from './viewport';
import { inwardNormal } from './walls';

export type PieceKind = 'base' | 'appliance' | 'tall' | 'wall' | 'counter-appliance';

export interface ElevationPiece {
  itemId: string;
  name: string;
  tag?: string;
  kind: PieceKind;
  /** Left edge along the wall, from the wall's left end as seen from inside the room. */
  x: number;
  w: number;
  /** Bottom, above the floor. */
  y: number;
  /** Includes the plinth. */
  h: number;
  plinthMm: number;
}

export interface ElevationOpening {
  openingId: string;
  kind: OpeningKind;
  x: number;
  w: number;
  y: number;
  h: number;
}

export interface WallElevation {
  wallIndex: number;
  label: string;
  lengthMm: number;
  ceilingMm: number;
  pieces: ElevationPiece[];
  counters: { x: number; w: number }[];
  openings: ElevationOpening[];
}

export const ELEVATION = {
  againstMm: 50,
  plinthMm: 100,
  counterTopMm: 900,
  counterThicknessMm: 40,
  wallCabinetBottomMm: 1450,
  hoodBottomMm: 1600,
  otrMicrowaveBottomMm: 1450,
  windowSillMm: 1050,
  ceilingMm: 2400,
} as const;

/** Tags drawn as cabinets (doors, plinth) rather than as named appliances. */
export const CABINET_TAGS: ReadonlySet<string> = new Set(['base', 'sink', 'filler', 'corner', 'wall', 'tall']);
const NEVER = new Set(['island', 'table', 'chair', 'stool']);
const BASE_TAGS = new Set(['base', 'sink', 'filler', 'corner']);
/** Counter items closer than this join one countertop (the layout check's neighbour allowance). */
const COUNTER_JOIN_MM = 100;
const COS_1_DEG = Math.cos(Math.PI / 180);

type Height = Pick<ElevationPiece, 'kind' | 'y' | 'h' | 'plinthMm'>;

/** Standard height for an item, by mount and tag; null for things never drawn. */
function heightOf(it: PlacedItem): Height | null {
  const tag = it.tag;
  if (tag && NEVER.has(tag)) return null;
  const H = it.sizeMm.h;
  const mount = it.mount ?? 'floor';
  if (mount === 'wall') {
    const y = tag === 'range-hood' ? ELEVATION.hoodBottomMm : tag === 'microwave' ? ELEVATION.otrMicrowaveBottomMm : ELEVATION.wallCabinetBottomMm;
    return { kind: 'wall', y, h: H, plinthMm: 0 };
  }
  if (mount === 'counter') return { kind: 'counter-appliance', y: ELEVATION.counterTopMm, h: H, plinthMm: 0 };
  const counterUnder = ELEVATION.counterTopMm - ELEVATION.counterThicknessMm;
  if (tag && BASE_TAGS.has(tag)) return { kind: 'base', y: 0, h: counterUnder, plinthMm: ELEVATION.plinthMm };
  if (tag === 'dishwasher') return { kind: 'appliance', y: 0, h: counterUnder, plinthMm: 0 };
  if (tag === 'range') return { kind: 'appliance', y: 0, h: ELEVATION.counterTopMm, plinthMm: 0 };
  if (tag === 'tall') return { kind: 'tall', y: 0, h: H + ELEVATION.plinthMm, plinthMm: ELEVATION.plinthMm };
  return { kind: 'appliance', y: 0, h: H, plinthMm: 0 };
}

export function wallElevations(project: Project, catalog: Catalog): WallElevation[] {
  if (projectKind(project) === 'closet') return [];
  const { room } = project;
  const poly = room.polygon as Point[];
  const out: WallElevation[] = [];

  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const lengthMm = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (lengthMm === 0) return;
    const [nx, ny] = inwardNormal(room, i);
    // The viewer faces the wall, f = −n; their right is (−f.y, f.x).
    const right: Point = [ny, -nx];
    const dir: Point = [(b[0] - a[0]) / lengthMm, (b[1] - a[1]) / lengthMm];
    const fromStart = dir[0] * right[0] + dir[1] * right[1] > 0;
    const origin = fromStart ? a : b;
    const along: Point = fromStart ? dir : [-dir[0], -dir[1]];
    const alongOf = (p: Point) => (p[0] - origin[0]) * along[0] + (p[1] - origin[1]) * along[1];
    const offOf = (p: Point) => (p[0] - a[0]) * nx + (p[1] - a[1]) * ny;

    const pieces: ElevationPiece[] = [];
    for (const it of project.items) {
      const height = heightOf(it);
      if (!height) continue;
      const centre: Point = [it.position.x, it.position.y];
      const fp = rotatedRectFootprint(centre, it.sizeMm.w, it.sizeMm.d, it.rotationDeg);
      if (it.tag === 'corner') {
        const touches = fp.some((p, k) => {
          const q = fp[(k + 1) % fp.length];
          return Math.abs(offOf(p)) <= ELEVATION.againstMm && Math.abs(offOf(q)) <= ELEVATION.againstMm;
        });
        if (!touches) continue;
      } else {
        const front = rotateAround([0, 1], [0, 0], it.rotationDeg);
        if (front[0] * nx + front[1] * ny < COS_1_DEG) continue;
        if (Math.abs(offOf(centre) - it.sizeMm.d / 2) > ELEVATION.againstMm) continue;
      }
      const xs = fp.map(alongOf);
      const x0 = Math.max(0, Math.min(...xs));
      const x1 = Math.min(lengthMm, Math.max(...xs));
      if (x1 - x0 < 1) continue;
      pieces.push({
        itemId: it.id,
        name: catalog.byId.get(it.catalogId)?.name ?? it.catalogId,
        ...(it.tag ? { tag: it.tag } : {}),
        ...height,
        x: x0,
        w: x1 - x0,
      });
    }
    if (pieces.length === 0) return;
    pieces.sort((p, q) => p.x - q.x || p.y - q.y);

    const openings: ElevationOpening[] = room.openings
      .filter((o) => wallIndexOf(room, o.wallId) === i)
      .map((o) => ({
        openingId: o.id,
        kind: o.kind,
        x: fromStart ? o.positionMm : lengthMm - o.positionMm - o.widthMm,
        w: o.widthMm,
        y: o.kind === 'window' ? ELEVATION.windowSillMm : 0,
        h: o.heightMm,
      }));

    const top = Math.max(...pieces.map((p) => p.y + p.h), ...openings.map((o) => o.y + o.h));
    out.push({
      wallIndex: i,
      label: `Wall ${i + 1} — ${compass([-nx, -ny])}, ${formatLength(lengthMm, project.units)}`,
      lengthMm,
      ceilingMm: Math.max(ELEVATION.ceilingMm, top + 100),
      pieces,
      counters: counterRuns(pieces),
      openings,
    });
  });
  return out;
}

/** One countertop strip per run of adjacent base cabinets and dishwashers. */
function counterRuns(pieces: ElevationPiece[]): { x: number; w: number }[] {
  const under = pieces.filter((p) => p.kind === 'base' || p.tag === 'dishwasher').sort((p, q) => p.x - q.x);
  const runs: { x: number; end: number }[] = [];
  for (const p of under) {
    const last = runs[runs.length - 1];
    if (last && p.x - last.end <= COUNTER_JOIN_MM) last.end = Math.max(last.end, p.x + p.w);
    else runs.push({ x: p.x, end: p.x + p.w });
  }
  return runs.map((r) => ({ x: r.x, w: r.end - r.x }));
}
```

- [ ] **Step 4: Run the tests.**

Run: `npx vitest run src/lib/plan/elevation.test.ts`
Expected: PASS. If an `x` comes out as 299.99999999999994, the test is right and the code needs rounding: round `x0` and `x1` to 0.01 mm (`Math.round(v * 100) / 100`) before storing.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/plan/elevation.ts src/lib/plan/elevation.test.ts
git commit -m "feat(plan): wall elevations — items on each wall, standard heights, countertop runs, openings"
```

---

### Task 54: Elevation drawing (`src/lib/plan/elevation-drawing.ts`)

**Files:**
- Create: `src/lib/plan/elevation-drawing.ts`, `src/lib/plan/elevation-drawing.test.ts`

**Interfaces:**
- Consumes: `WallElevation`, `ElevationPiece`, `CABINET_TAGS`, `ELEVATION` (Task 53); `Shape`, `INK` (Task 52); `formatLength`.
- Produces:

```ts
export const ELEVATION_MARGIN: { left: 450; right: 150; top: 300; bottom: 500 };
export function elevationFrame(e: WallElevation): { x: number; y: number; w: number; h: number };
export function doorCount(p: ElevationPiece): { across: number; stacked: boolean };
export function elevationDrawing(e: WallElevation, units: 'mm' | 'in'): Shape[];
```

Piece shapes carry `componentId: p.itemId`. Door panels are `rect` shapes with `fill: 'none'`. The plinth is a `rect` with `fill: PLINTH` (`'#9ca3af'`).

- [ ] **Step 1: Write the failing tests** in `src/lib/plan/elevation-drawing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Shape } from '../drawing/shapes';
import type { ElevationPiece, WallElevation } from './elevation';
import { doorCount, elevationDrawing, elevationFrame, PLINTH } from './elevation-drawing';

const p = (over: Partial<ElevationPiece>): ElevationPiece => ({ itemId: 'x', name: 'Thing', kind: 'base', x: 0, w: 600, y: 0, h: 860, plinthMm: 100, ...over });
const elevation = (pieces: ElevationPiece[], over: Partial<WallElevation> = {}): WallElevation => ({
  wallIndex: 0, label: 'Wall 1 — north, 4000 mm', lengthMm: 4000, ceilingMm: 2400, pieces, counters: [], openings: [], ...over,
});
const texts = (shapes: Shape[]) => shapes.flatMap((s) => (s.type === 'text' ? [s.text] : []));
const doorsOf = (shapes: Shape[], id: string) => shapes.filter((s) => s.componentId === id && s.type === 'rect' && s.fill === 'none').length;

describe('doorCount', () => {
  it('gives doors by tag and width', () => {
    expect(doorCount(p({ tag: 'base', w: 450 }))).toEqual({ across: 1, stacked: false });
    expect(doorCount(p({ tag: 'base', w: 600 }))).toEqual({ across: 2, stacked: false });
    expect(doorCount(p({ tag: 'sink', w: 800 }))).toEqual({ across: 2, stacked: false });
    expect(doorCount(p({ tag: 'corner', w: 900 }))).toEqual({ across: 1, stacked: false });
    expect(doorCount(p({ tag: 'filler', w: 50 }))).toEqual({ across: 0, stacked: false });
    expect(doorCount(p({ tag: 'wall', kind: 'wall', w: 450 }))).toEqual({ across: 1, stacked: false });
    expect(doorCount(p({ tag: 'wall', kind: 'wall', w: 900 }))).toEqual({ across: 2, stacked: false });
    expect(doorCount(p({ tag: 'tall', kind: 'tall', w: 600 }))).toEqual({ across: 1, stacked: true });
    expect(doorCount(p({ tag: 'range', kind: 'appliance' }))).toEqual({ across: 0, stacked: false });
  });
});

describe('elevationDrawing', () => {
  it('draws door panels, the plinth and the countertop', () => {
    const shapes = elevationDrawing(
      elevation([p({ itemId: 'b', tag: 'base', w: 600 }), p({ itemId: 't', tag: 'tall', kind: 'tall', x: 600, h: 2200 })], { counters: [{ x: 0, w: 600 }] }),
      'mm'
    );
    expect(doorsOf(shapes, 'b')).toBe(2);
    expect(doorsOf(shapes, 't')).toBe(2); // stacked
    expect(shapes).toContainEqual(expect.objectContaining({ type: 'rect', componentId: 'b', fill: PLINTH, x: 0, y: 2300, w: 600, h: 100 }));
    // Countertop: 860–900 mm above the floor, so y = 2400 − 900.
    expect(shapes).toContainEqual(expect.objectContaining({ type: 'rect', x: 0, y: 1500, w: 600, h: 40 }));
  });

  it('names appliances, falling back to the short name, and leaves out a name that will not fit', () => {
    const shapes = elevationDrawing(
      elevation([
        p({ itemId: 'd', name: 'Dishwasher (600 mm)', tag: 'dishwasher', kind: 'appliance', plinthMm: 0 }),
        p({ itemId: 'f', name: 'Refrigerator, slim (600 mm)', tag: 'fridge', kind: 'appliance', x: 600, h: 1780, plinthMm: 0 }),
        p({ itemId: 'z', name: 'Something enormous', kind: 'appliance', x: 1200, w: 100, plinthMm: 0 }),
        p({ itemId: 'c', name: 'Base cabinet 600 mm', tag: 'base', x: 1300 }),
      ]),
      'mm'
    );
    const t = texts(shapes);
    expect(t).toContain('Dishwasher');
    expect(t).toContain('Refrigerator');
    expect(t.join('|')).not.toMatch(/Something|Base cabinet/);
  });

  it('dimensions each piece, the wall and the key heights, in the project units', () => {
    const e = elevation([p({ tag: 'base', w: 600 }), p({ itemId: 'w', tag: 'wall', kind: 'wall', y: 1450, h: 720, plinthMm: 0 })]);
    const mm = texts(elevationDrawing(e, 'mm'));
    for (const t of ['600 mm', '4000 mm', '900 mm', '1450 mm', '2170 mm']) expect(mm).toContain(t);
    const inches = texts(elevationDrawing(e, 'in'));
    expect(inches).toContain('1\' 11 1/2"');
    expect(inches.join('|')).not.toMatch(/\d mm/);
  });

  it('draws windows dashed and frames the drawing with room for the dimensions', () => {
    const e = elevation([p({})], { openings: [{ openingId: 'o', kind: 'window', x: 1000, w: 900, y: 1050, h: 1200 }] });
    expect(elevationDrawing(e, 'mm')).toContainEqual(expect.objectContaining({ type: 'rect', x: 1000, y: 150, w: 900, h: 1200, dash: [40, 30] }));
    expect(elevationFrame(e)).toEqual({ x: -450, y: -300, w: 4600, h: 3200 });
  });
});
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/lib/plan/elevation-drawing.test.ts`
Expected: FAIL, `Failed to resolve import "./elevation-drawing"`.

- [ ] **Step 3: Implement `src/lib/plan/elevation-drawing.ts`.**

```ts
/**
 * One wall elevation as plain shapes, cabinet-maker style: plinths, door
 * panels, the countertop, named appliances, openings and dimensions.
 * Elevation mm with y DOWN: svgY = ceiling − height above the floor. Pure.
 */

import { INK, type Shape } from '../drawing/shapes';
import { CABINET_TAGS, ELEVATION, type ElevationPiece, type WallElevation } from './elevation';
import { formatLength } from './viewport';

export const ELEVATION_MARGIN = { left: 450, right: 150, top: 300, bottom: 500 } as const;
export const PLINTH = '#9ca3af';
const WOOD = '#f3e8d2';
const WOOD_EDGE = '#8a6a3b';
const STEEL = '#e5e7eb';
const METAL = '#4b5563';
const DIM = '#374151';
const TEXT_MM = 60;
const CHAR_MM = TEXT_MM * 0.55;
const INSET_MM = 15;

/** The drawing's extent, dimensions included. */
export function elevationFrame(e: WallElevation) {
  const m = ELEVATION_MARGIN;
  return { x: -m.left, y: -m.top, w: e.lengthMm + m.left + m.right, h: e.ceilingMm + m.top + m.bottom };
}

/** Door panels on a cabinet front: side by side, or (tall cabinets) two stacked. */
export function doorCount(p: ElevationPiece): { across: number; stacked: boolean } {
  if (!p.tag || !CABINET_TAGS.has(p.tag) || p.tag === 'filler') return { across: 0, stacked: false };
  if (p.tag === 'tall') return { across: 1, stacked: true };
  if (p.tag === 'sink') return { across: 2, stacked: false };
  if (p.tag === 'corner') return { across: 1, stacked: false };
  return { across: p.w < 600 ? 1 : 2, stacked: false };
}

/** The name if it fits, else the part before " (" or ",", else nothing. */
function fittingName(name: string, w: number): string | null {
  const fits = (t: string) => t.length * CHAR_MM <= w - 40;
  if (fits(name)) return name;
  const short = name.split(/ \(|,/)[0].trim();
  return short && fits(short) ? short : null;
}

export function elevationDrawing(e: WallElevation, units: 'mm' | 'in'): Shape[] {
  const C = e.ceilingMm;
  const Y = (heightMm: number) => C - heightMm;
  const out: Shape[] = [];

  out.push({ type: 'rect', x: 0, y: 0, w: e.lengthMm, h: C, fill: '#f9fafb', stroke: '#9ca3af', strokeWidth: 4 });

  for (const o of e.openings) {
    const top = Y(o.y + o.h);
    if (o.kind === 'window') {
      out.push({ type: 'rect', x: o.x, y: top, w: o.w, h: o.h, fill: '#ffffff', stroke: '#6b7280', strokeWidth: 6, dash: [40, 30] });
      out.push({ type: 'line', x1: o.x + o.w / 2, y1: top, x2: o.x + o.w / 2, y2: top + o.h, stroke: '#6b7280', strokeWidth: 4 });
    } else {
      out.push({ type: 'rect', x: o.x, y: top, w: o.w, h: o.h, fill: '#ffffff', stroke: '#6b7280', strokeWidth: 6 });
      if (o.kind === 'door') out.push({ type: 'line', x1: o.x, y1: C, x2: o.x + o.w, y2: top, stroke: '#9ca3af', strokeWidth: 3 });
    }
  }

  const drawPiece = (p: ElevationPiece) => {
    const id = p.itemId;
    const cabinet = !!p.tag && CABINET_TAGS.has(p.tag);
    const top = Y(p.y + p.h);
    out.push({ componentId: id, type: 'rect', x: p.x, y: top, w: p.w, h: p.h, fill: cabinet ? WOOD : STEEL, stroke: cabinet ? WOOD_EDGE : METAL, strokeWidth: 6 });
    if (p.plinthMm > 0) out.push({ componentId: id, type: 'rect', x: p.x, y: Y(p.y + p.plinthMm), w: p.w, h: p.plinthMm, fill: PLINTH });
    const bodyBottom = Y(p.y + p.plinthMm);
    const bodyH = p.h - p.plinthMm;
    const { across, stacked } = doorCount(p);
    if (stacked) {
      const lowH = (bodyH * 2) / 3;
      for (const [y, h] of [[bodyBottom - lowH, lowH], [top, bodyH - lowH]] as const) {
        out.push({ componentId: id, type: 'rect', x: p.x + INSET_MM, y: y + INSET_MM, w: p.w - 2 * INSET_MM, h: h - 2 * INSET_MM, fill: 'none', stroke: WOOD_EDGE, strokeWidth: 3 });
      }
    } else {
      for (let k = 0; k < across; k++) {
        const dw = p.w / across;
        out.push({ componentId: id, type: 'rect', x: p.x + k * dw + INSET_MM, y: top + INSET_MM, w: dw - 2 * INSET_MM, h: bodyH - 2 * INSET_MM, fill: 'none', stroke: WOOD_EDGE, strokeWidth: 3 });
      }
    }
    if (!cabinet) {
      const name = fittingName(p.name, p.w);
      if (name) out.push({ componentId: id, type: 'text', x: p.x + p.w / 2, y: top + p.h / 2, text: name, size: TEXT_MM, anchor: 'middle', fill: INK });
    }
  };

  // Floor items, then the countertop over them, then wall and counter items.
  const low = e.pieces.filter((p) => p.y === 0);
  const high = e.pieces.filter((p) => p.y > 0);
  low.forEach(drawPiece);
  for (const c of e.counters) {
    out.push({ type: 'rect', x: c.x, y: Y(ELEVATION.counterTopMm), w: c.w, h: ELEVATION.counterThicknessMm, fill: '#374151' });
  }
  high.forEach(drawPiece);

  out.push({ type: 'line', x1: -100, y1: C, x2: e.lengthMm + 100, y2: C, stroke: INK, strokeWidth: 12 });

  // Dimensions.
  const len = (mm: number) => formatLength(mm, units);
  const dim = (x1: number, x2: number, y: number) => {
    out.push({ type: 'line', x1, y1: y, x2, y2: y, stroke: DIM, strokeWidth: 4 });
    out.push({ type: 'line', x1, y1: y - 30, x2: x1, y2: y + 30, stroke: DIM, strokeWidth: 4 });
    out.push({ type: 'line', x1: x2, y1: y - 30, x2, y2: y + 30, stroke: DIM, strokeWidth: 4 });
    out.push({ type: 'text', x: (x1 + x2) / 2, y: y - 45, text: len(x2 - x1), size: TEXT_MM, anchor: 'middle', fill: INK });
  };
  for (const p of low) dim(p.x, p.x + p.w, C + 150);
  dim(0, e.lengthMm, C + 350);
  for (const p of e.pieces.filter((q) => q.y >= ELEVATION.wallCabinetBottomMm)) dim(p.x, p.x + p.w, -150);

  const wallCabinets = e.pieces.filter((p) => p.tag === 'wall' || (p.kind === 'wall' && p.tag === 'corner'));
  const heights = new Set<number>([ELEVATION.counterTopMm]);
  if (wallCabinets.length > 0) {
    heights.add(ELEVATION.wallCabinetBottomMm);
    heights.add(Math.max(...wallCabinets.map((p) => p.y + p.h)));
  }
  const topMark = Math.max(...heights);
  out.push({ type: 'line', x1: -80, y1: C, x2: -80, y2: Y(topMark), stroke: DIM, strokeWidth: 4 });
  for (const h of heights) {
    out.push({ type: 'line', x1: -110, y1: Y(h), x2: -50, y2: Y(h), stroke: DIM, strokeWidth: 4 });
    out.push({ type: 'text', x: -120, y: Y(h), text: len(h), size: TEXT_MM, anchor: 'end', fill: INK });
  }
  return out;
}
```

- [ ] **Step 4: Run the tests.**

Run: `npx vitest run src/lib/plan/elevation-drawing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/plan/elevation-drawing.ts src/lib/plan/elevation-drawing.test.ts
git commit -m "feat(plan): draw a wall elevation — plinths, doors, countertop, appliances, dimensions"
```

---

### Task 55: Elevations export (SVG string, SVG and PNG routes)

**Files:**
- Create: `src/lib/plan/elevation-svg.ts`, `src/lib/plan/elevation-svg.test.ts`, `src/app/api/export/[id]/elevations/svg/route.ts` with its `route.test.ts`, `src/app/api/export/[id]/elevations/png/route.ts` with its `route.test.ts`
- Modify: `src/lib/export/drawing.ts` (add `loadElevations` and `elevationsFileName`)

**Interfaces:**
- Consumes: `wallElevations` (Task 53); `elevationDrawing`, `elevationFrame` (Task 54); `shapeToSvg` (Task 52); `escapeXml`, `SVG_SCALE`, `exportFileName` from `src/lib/plan/svg.ts`; `loadExportProject`, `svgToPng`, `PNG_SCALES`, `PngScale` from `src/lib/export/drawing.ts`.
- Produces:
  - `elevationsToSvg(project: Project, catalog: Catalog, opts?: { date?: string }): string`, which throws `Error('no wall elevations')` when there are none.
  - `loadElevations(id: string): { project: Project; svg: string } | { error: NextResponse }`.
  - `elevationsFileName(project: Project, ext: string): string`.

- [ ] **Step 1: Write the failing tests.** In `src/lib/plan/elevation-svg.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { loadCatalog } from '../catalog/loader';
import { buildSampleKitchen } from './sample-kitchen';
import { ProjectSchema, type Project } from './schemas';
import { elevationsToSvg } from './elevation-svg';

const catalog = loadCatalog();
function blank(name = 'Sample kitchen'): Project {
  return ProjectSchema.parse({
    id: randomUUID(), name, kind: 'kitchen', units: 'mm', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 0, photos: [],
    room: { polygon: [[0, 0], [3000, 0], [3000, 4000], [0, 4000]], walls: ['a', 'b', 'c', 'd'].map((id) => ({ id, thicknessMm: 100 })), openings: [] },
    items: [], history: [],
  });
}
let k = 0;
const sample = buildSampleKitchen(blank(), catalog, () => `id-${k++}`);

describe('elevationsToSvg', () => {
  const svg = elevationsToSvg(sample, catalog, { date: '2026-02-03' });

  it('stacks every elevation at 1:50 with a heading each and one title block', () => {
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 [\d.]+ [\d.]+" width="[\d.]+mm" height="[\d.]+mm"/);
    // The sample is a one-wall kitchen in a 4200 × 3600 mm room.
    expect(svg).toContain('>Wall 1 — north, 4200 mm</text>');
    expect(svg.match(/>Wall \d — /g)).toHaveLength(1);
    expect(svg).toContain('Wall elevations · Scale 1:50 · revision 0 · 2026-02-03');
    expect(svg).toMatchSnapshot();
  });

  it('escapes the project name and unknown catalog ids', () => {
    const odd: Project = { ...sample, name: 'Mum & Dad’s <kitchen>', items: sample.items.map((it, i) => (i === 0 ? { ...it, catalogId: 'a<b>&"c"', tag: undefined } : it)) };
    const out = elevationsToSvg(odd, catalog, { date: '2026-02-03' });
    expect(out).toContain('Mum &amp; Dad’s &lt;kitchen&gt;');
    expect(out).not.toMatch(/<b>|&"c"/);
  });

  it('throws when nothing is against a wall', () => {
    expect(() => elevationsToSvg(blank(), catalog)).toThrow('no wall elevations');
  });
});
```

In `src/app/api/export/[id]/elevations/svg/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject, loadProject, saveProject } from '@/lib/storage/projects';
import { GET } from './route';

const get = (id: string) => GET(new Request(`http://localhost/api/export/${id}/elevations/svg`), { params: Promise.resolve({ id }) });
const dw = { id: 'dw', catalogId: 'dishwasher-600', tag: 'dishwasher', sizeMm: { w: 600, d: 580, h: 850 }, position: { x: 1250, y: 290 }, rotationDeg: 0 };

describe('GET /api/export/[id]/elevations/svg', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'kd-elev-'));
    process.env.DATA_DIR = dataDir;
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('returns the wall elevations as SVG', async () => {
    const p = createProject(dataDir, { name: 'Our Kitchen!' });
    saveProject(dataDir, { ...loadProject(dataDir, p.id), items: [dw] });
    const res = await get(p.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe('inline; filename="our-kitchen-elevations.svg"');
    expect(await res.text()).toContain('>Dishwasher</text>');
  });

  it('404s a kitchen with nothing on a wall, a closet, and an unknown project; 400s a bad id', async () => {
    const empty = createProject(dataDir, { name: '***' });
    const res = await get(empty.id);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/nothing is against a wall/);
    const closet = createProject(dataDir, { name: 'c', kind: 'closet' });
    expect((await (await get(closet.id)).json()).error).toMatch(/closet/);
    expect((await get('00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await get('../etc')).status).toBe(400);
  });
});
```

In `src/app/api/export/[id]/elevations/png/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createProject, loadProject, saveProject } from '@/lib/storage/projects';
import { GET } from './route';

const get = (id: string, scale?: string) =>
  GET(new Request(`http://localhost/api/export/${id}/elevations/png${scale ? `?scale=${scale}` : ''}`), { params: Promise.resolve({ id }) });
const dw = { id: 'dw', catalogId: 'dishwasher-600', tag: 'dishwasher', sizeMm: { w: 600, d: 580, h: 850 }, position: { x: 1250, y: 290 }, rotationDeg: 0 };

describe('GET /api/export/[id]/elevations/png', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'kd-elevpng-'));
    process.env.DATA_DIR = dataDir;
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('rasterizes the elevations at 1× and 2×', async () => {
    const p = createProject(dataDir, { name: 'Our Kitchen' });
    saveProject(dataDir, { ...loadProject(dataDir, p.id), items: [dw] });
    const one = await get(p.id);
    expect(one.headers.get('content-type')).toBe('image/png');
    expect(one.headers.get('content-disposition')).toBe('inline; filename="our-kitchen-elevations.png"');
    const two = await get(p.id, '2');
    expect(two.headers.get('content-disposition')).toBe('inline; filename="our-kitchen-elevations@2x.png"');
    const [m1, m2] = await Promise.all([sharp(Buffer.from(await one.arrayBuffer())).metadata(), sharp(Buffer.from(await two.arrayBuffer())).metadata()]);
    expect(m2.width).toBeGreaterThan(m1.width! * 1.9);
  });

  it('400s a bad scale and 404s a kitchen with nothing on a wall', async () => {
    const p = createProject(dataDir, { name: 'x' });
    expect((await get(p.id, '3')).status).toBe(400);
    expect((await get(p.id)).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/lib/plan/elevation-svg.test.ts src/app/api/export/[id]/elevations`
Expected: FAIL, imports not found.

- [ ] **Step 3: Implement `src/lib/plan/elevation-svg.ts`.**

```ts
/**
 * Every wall elevation of a kitchen in one SVG, stacked down the page at
 * 1:SVG_SCALE (so the PNG rasterizer applies), with a heading per wall and
 * one title block. Pure: no DOM, no I/O.
 */

import type { Catalog } from '../catalog/loader';
import { INK, shapeToSvg } from '../drawing/shapes';
import { wallElevations } from './elevation';
import { elevationDrawing, elevationFrame } from './elevation-drawing';
import type { Project } from './schemas';
import { escapeXml, SVG_SCALE } from './svg';

const FONT = 'Helvetica, Arial, sans-serif';
const HEADING_MM = 110;
const TEXT_MM = 90;
const r = (n: number) => Math.round(n * 10) / 10;

export function elevationsToSvg(project: Project, catalog: Catalog, opts: { date?: string } = {}): string {
  const elevations = wallElevations(project, catalog);
  if (elevations.length === 0) throw new Error('no wall elevations');
  const pad = 200;
  const width = Math.max(3000, ...elevations.map((e) => elevationFrame(e).w)) + 2 * pad;

  const body: string[] = [];
  let y = pad;
  for (const e of elevations) {
    const f = elevationFrame(e);
    body.push(`<text x="${pad}" y="${r(y + HEADING_MM)}" font-size="${HEADING_MM}" font-weight="bold" fill="${INK}">${escapeXml(e.label)}</text>`);
    y += HEADING_MM + 100;
    body.push(`<g transform="translate(${r(pad - f.x)} ${r(y - f.y)})">`, ...elevationDrawing(e, project.units).map(shapeToSvg), '</g>');
    y += f.h + 150;
  }
  const date = (opts.date ?? project.updatedAt).slice(0, 10);
  body.push(
    `<g id="title" fill="${INK}">`,
    `<text x="${pad}" y="${r(y + TEXT_MM * 1.6)}" font-size="${TEXT_MM * 1.6}" font-weight="bold">${escapeXml(project.name)}</text>`,
    `<text x="${pad}" y="${r(y + TEXT_MM * 1.6 + 170)}" font-size="${TEXT_MM}">${escapeXml(`Wall elevations · Scale 1:${SVG_SCALE} · revision ${project.revision} · ${date}`)}</text>`,
    '</g>'
  );
  const height = y + TEXT_MM * 1.6 + 170 + pad;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r(width)} ${r(height)}" width="${r(width / SVG_SCALE)}mm" height="${r(height / SVG_SCALE)}mm" font-family="${FONT}">`,
    `<title>${escapeXml(`${project.name} — wall elevations`)}</title>`,
    `<rect x="0" y="0" width="${r(width)}" height="${r(height)}" fill="#ffffff"/>`,
    ...body,
    '</svg>',
  ].join('\n');
}
```

- [ ] **Step 4: Add the loader to `src/lib/export/drawing.ts`.** Add imports for `elevationsToSvg` and `wallElevations`, then:

```ts
/** A download name for the elevations, e.g. "our-kitchen-elevations.svg". */
export function elevationsFileName(project: Project, ext: string): string {
  return exportFileName(project.name, ext, 'kitchen').replace(new RegExp(`\\.${ext}$`), `-elevations.${ext}`);
}

/** The kitchen and its wall elevations as SVG, or an error response (400, or 404 with the reason). */
export function loadElevations(id: string): { project: Project; svg: string } | { error: NextResponse } {
  const loaded = loadExportProject(id);
  if ('error' in loaded) return loaded;
  const { project } = loaded;
  if (projectKind(project) === 'closet') {
    return { error: NextResponse.json({ error: 'closets have a front elevation, not wall elevations' }, { status: 404 }) };
  }
  const catalog = loadCatalog();
  if (wallElevations(project, catalog).length === 0) {
    return { error: NextResponse.json({ error: 'nothing is against a wall yet' }, { status: 404 }) };
  }
  return { project, svg: elevationsToSvg(project, catalog) };
}
```

- [ ] **Step 5: Add the routes.** `src/app/api/export/[id]/elevations/svg/route.ts`:

```ts
import { elevationsFileName, loadElevations } from '@/lib/export/drawing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/export/[id]/elevations/svg — every kitchen wall with something on it, as front elevations (1:50).
 *   200 image/svg+xml · 400 invalid id · 404 unknown project, closet, or nothing on a wall
 */
export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const drawing = loadElevations((await params).id);
  if ('error' in drawing) return drawing.error;
  return new Response(drawing.svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'content-disposition': `inline; filename="${elevationsFileName(drawing.project, 'svg')}"`,
      'cache-control': 'no-store',
    },
  });
}
```

`src/app/api/export/[id]/elevations/png/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { elevationsFileName, loadElevations, PNG_SCALES, svgToPng, type PngScale } from '@/lib/export/drawing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/export/[id]/elevations/png?scale=1|2 — the elevations SVG as a PNG.
 *   200 image/png · 400 invalid id or scale · 404 unknown project, closet, or nothing on a wall
 */
export async function GET(req: Request, { params }: Ctx): Promise<Response> {
  const scale = Number(new URL(req.url).searchParams.get('scale') ?? '1');
  if (!PNG_SCALES.includes(scale as PngScale)) {
    return NextResponse.json({ error: `scale must be ${PNG_SCALES.join(' or ')}` }, { status: 400 });
  }
  const drawing = loadElevations((await params).id);
  if ('error' in drawing) return drawing.error;
  const png = await svgToPng(drawing.svg, scale as PngScale);
  const suffix = scale === 1 ? '' : `@${scale}x`;
  return new Response(new Uint8Array(png), {
    headers: {
      'content-type': 'image/png',
      'content-disposition': `inline; filename="${elevationsFileName(drawing.project, 'png').replace(/\.png$/, `${suffix}.png`)}"`,
      'cache-control': 'no-store',
    },
  });
}
```

- [ ] **Step 6: Run the tests,** then open the snapshot's SVG once in a browser (write it to the scratchpad) and check it looks like an elevation.

Run: `npx vitest run src/lib/plan/elevation-svg.test.ts src/app/api/export`
Expected: PASS (the snapshot is written on the first run).

- [ ] **Step 7: Commit.**

```bash
git add src/lib/plan/elevation-svg.ts src/lib/plan/elevation-svg.test.ts src/lib/plan/__snapshots__ src/lib/export/drawing.ts "src/app/api/export/[id]/elevations"
git commit -m "feat(export): kitchen wall elevations as SVG and PNG"
```

---

### Task 56: Elevations in the editor

**Files:**
- Create: `src/components/DrawingShape.tsx` (moved out of `ClosetElevation.tsx`), `src/components/KitchenElevations.tsx`, `src/components/KitchenElevations.test.tsx`
- Modify: `src/components/ClosetElevation.tsx` (import `DrawingShape`), `src/components/ProjectEditor.tsx`, `src/components/ProjectEditor.test.tsx`

**Interfaces:**
- Consumes: `wallElevations`, `WallElevation` (Task 53); `elevationDrawing`, `elevationFrame` (Task 54); `Shape` (Task 52).
- Produces:
  - `DrawingShape({ shape, onPointerDown? })`: the SVG element for one `Shape`.
  - `KitchenElevations({ elevations, units }: { elevations: WallElevation[]; units: 'mm' | 'in' })`.

- [ ] **Step 1: Write the failing tests** in `src/components/KitchenElevations.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import React from 'react';
import KitchenElevations from './KitchenElevations';
import type { ElevationPiece, WallElevation } from '@/lib/plan/elevation';

const piece: ElevationPiece = { itemId: 'b', name: 'Base cabinet 600 mm', tag: 'base', kind: 'base', x: 0, w: 600, y: 0, h: 860, plinthMm: 100 };
const e = (wallIndex: number, label: string): WallElevation => ({ wallIndex, label, lengthMm: 3000, ceilingMm: 2400, pieces: [piece], counters: [], openings: [] });
const north = e(0, 'Wall 1 — north, 3000 mm');
const east = e(1, 'Wall 2 — east, 4000 mm');

describe('KitchenElevations', () => {
  it('shows the first wall, and another when picked', () => {
    render(<KitchenElevations elevations={[north, east]} units="mm" />);
    expect(screen.getByRole('img', { name: 'Elevation of Wall 1 — north, 3000 mm' })).toBeTruthy();
    const pick = screen.getByRole('button', { name: 'Wall 2 — east, 4000 mm' });
    expect(pick.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(pick);
    expect(pick.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('img', { name: 'Elevation of Wall 2 — east, 4000 mm' })).toBeTruthy();
  });

  it('falls back to the first wall when the picked one is gone', () => {
    const { rerender } = render(<KitchenElevations elevations={[north, east]} units="mm" />);
    fireEvent.click(screen.getByRole('button', { name: /^Wall 2/ }));
    rerender(<KitchenElevations elevations={[north]} units="mm" />);
    expect(screen.getByRole('img', { name: 'Elevation of Wall 1 — north, 3000 mm' })).toBeTruthy();
  });

  it('draws lengths in inches for an inch project', () => {
    render(<KitchenElevations elevations={[north]} units="in" />);
    expect(screen.getAllByText('1\' 11 1/2"').length).toBeGreaterThan(0);
    expect(screen.queryByText(/^\d+ mm$/)).toBeNull();
  });

  it('says what to do when nothing is against a wall', () => {
    render(<KitchenElevations elevations={[]} units="mm" />);
    expect(screen.getByText('Place cabinets or appliances against a wall to see its elevation.')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });
});
```

Add to `src/components/ProjectEditor.test.tsx`, inside `describe('ProjectEditor')`:

```tsx
  it('shows wall elevations and their downloads once something is against a wall', () => {
    const { unmount } = render(<ProjectEditor initialProject={project} />);
    expect(screen.getByRole('heading', { name: 'Wall elevations' })).not.toBeNull();
    expect(screen.queryByRole('link', { name: 'Elevations as SVG' })).toBeNull();
    unmount();
    useEditorStore.setState({ project: null, proposal: null });
    const dw: PlacedItem = { id: 'dw', catalogId: 'dishwasher-600', tag: 'dishwasher', sizeMm: { w: 600, d: 580, h: 850 }, position: { x: 1250, y: 290 }, rotationDeg: 0 };
    render(<ProjectEditor initialProject={{ ...project, items: [dw] }} />);
    expect(screen.getByRole('img', { name: 'Elevation of Wall 1 — north, 3000 mm' })).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Elevations as SVG' }).getAttribute('href')).toBe(`/api/export/${ID}/elevations/svg?rev=0`);
    expect(screen.getByRole('link', { name: 'Elevations as PNG' }).getAttribute('href')).toBe(`/api/export/${ID}/elevations/png?scale=1&rev=0`);
  });
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/components/KitchenElevations.test.tsx src/components/ProjectEditor.test.tsx`
Expected: FAIL, `./KitchenElevations` is not found, and the "Wall elevations" heading is missing.

- [ ] **Step 3: Move `ShapeEl` out of `ClosetElevation.tsx`** into `src/components/DrawingShape.tsx`, unchanged apart from its name and props type:

```tsx
import React from 'react';
import type { Shape } from '@/lib/drawing/shapes';

/** One drawing shape as an SVG element; with `onPointerDown`, shapes that carry a componentId are clickable. */
export default function DrawingShape({
  shape: s,
  onPointerDown,
}: {
  shape: Shape;
  onPointerDown?: (id: string, e: React.PointerEvent<SVGElement>) => void;
}) {
  // (the body of ClosetElevation's ShapeEl, verbatim)
}
```

In `ClosetElevation.tsx`, delete `ShapeEl`, `import DrawingShape from './DrawingShape'`, render `<DrawingShape key={i} shape={s} onPointerDown={onComponentPointerDown} />`, and import `Shape` no longer.

- [ ] **Step 4: Create `src/components/KitchenElevations.tsx`.**

```tsx
'use client';

import React, { useState } from 'react';
import DrawingShape from './DrawingShape';
import type { WallElevation } from '@/lib/plan/elevation';
import { elevationDrawing, elevationFrame } from '@/lib/plan/elevation-drawing';

/** The kitchen's walls as front elevations, one at a time, worked out from the plan. */
export default function KitchenElevations({ elevations, units }: { elevations: WallElevation[]; units: 'mm' | 'in' }) {
  const [picked, setPicked] = useState<number | null>(null);
  if (elevations.length === 0) {
    return <p className="text-sm text-gray-600">Place cabinets or appliances against a wall to see its elevation.</p>;
  }
  // The picked wall may have lost everything on it since (an edit, an undo).
  const shown = elevations.find((e) => e.wallIndex === picked) ?? elevations[0];
  const f = elevationFrame(shown);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Walls">
        {elevations.map((e) => (
          <button
            key={e.wallIndex}
            type="button"
            aria-pressed={e.wallIndex === shown.wallIndex}
            className={`rounded border px-3 py-1 text-sm ${e.wallIndex === shown.wallIndex ? 'bg-blue-600 text-white' : 'bg-white'}`}
            onClick={() => setPicked(e.wallIndex)}
          >
            {e.label}
          </button>
        ))}
      </div>
      <svg
        viewBox={`${f.x} ${f.y} ${f.w} ${f.h}`}
        className="max-h-96 w-full border bg-white"
        role="img"
        aria-label={`Elevation of ${shown.label}`}
        fontFamily="Helvetica, Arial, sans-serif"
      >
        {elevationDrawing(shown, units).map((s, i) => (
          <DrawingShape key={i} shape={s} />
        ))}
      </svg>
    </div>
  );
}
```

- [ ] **Step 5: Mount it in `ProjectEditor.tsx`.** Add the imports (`KitchenElevations`, `wallElevations`), then after `const layout = …`:

```tsx
  const elevations = useMemo(() => (project.closet ? [] : wallElevations(project, catalog)), [project, catalog]);
```

In the header, after the CSV link:

```tsx
          {elevations.length > 0 && (
            <>
              <span className="text-gray-500">Elevations:</span>
              <a className="text-blue-700 underline" aria-label="Elevations as SVG" href={`/api/export/${project.id}/elevations/svg?rev=${project.revision}`} download>
                SVG
              </a>
              <a className="text-blue-700 underline" aria-label="Elevations as PNG" href={`/api/export/${project.id}/elevations/png?scale=1&rev=${project.revision}`} download>
                PNG
              </a>
            </>
          )}
```

After the "Current room" `</section>` in the kitchen branch:

```tsx
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Wall elevations</h2>
            <KitchenElevations elevations={elevations} units={project.units} />
          </section>
```

- [ ] **Step 6: Run the component tests and the type check.**

Run: `npx vitest run src/components && npx tsc --noEmit -p . && npx eslint src/components`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add src/components
git commit -m "feat: wall elevations in the kitchen editor, with SVG and PNG downloads"
```

---

### Task 57: Example kitchens, e2e, docs

**Files:**
- Modify: `tests/integration/example-layouts.test.ts`, `docs/plan.md`, `README.md`, `docs/superpowers/specs/2026-10-11-elevations-design.md` (the plan refinements from Global Constraints)
- Create: `tests/e2e/elevations.spec.ts`

- [ ] **Step 1: Record each example kitchen's elevations.** In `tests/integration/example-layouts.test.ts`, import `wallElevations` from `@/lib/plan/elevation` and add, after the layout-check snapshot:

```ts
    // Wall elevations: what is drawn on each wall, recorded.
    const r = Math.round;
    expect(
      wallElevations(saved, catalog).map(
        (e) =>
          `${e.label}: ${e.pieces.map((p) => `${p.name} ${r(p.x)}+${r(p.w)}@${p.y}`).join(', ')}` +
          ` | counter ${e.counters.map((c) => `${r(c.x)}+${r(c.w)}`).join(', ')}` +
          ` | openings ${e.openings.map((o) => `${o.kind} ${r(o.x)}+${r(o.w)}`).join(', ')}`
      )
    ).toMatchSnapshot();
```

- [ ] **Step 2: Run it and read every new snapshot entry.** Each kitchen's runs should appear on the walls they were built against, with countertops over the base runs. If an item is missing from its wall, the membership rule is wrong, not the snapshot.

Run: `npx vitest run tests/integration/example-layouts.test.ts`
Expected: PASS; new entries written in `tests/integration/__snapshots__/example-layouts.test.ts.snap`.

- [ ] **Step 3: Write `tests/e2e/elevations.spec.ts`.** The sample kitchen is a single wall (cabinets, appliances, a window and wall cabinets on the top wall, plus an island that isn't drawn), so this checks one elevation and the download. Switching walls is covered by the component test.

```ts
import { test, expect } from '@playwright/test';

test('the sample kitchen shows its wall elevation, and it downloads as SVG', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a sample kitchen' }).click();
  await page.waitForURL(/\/project\/[0-9a-f-]{36}$/);

  const walls = page.getByRole('group', { name: 'Walls' }).getByRole('button');
  await expect(walls).toHaveCount(1);
  await expect(walls.first()).toHaveText('Wall 1 — north, 4200 mm');
  const drawing = page.getByRole('img', { name: 'Elevation of Wall 1 — north, 4200 mm' });
  await expect(drawing).toBeVisible();
  await expect(drawing.getByText('Refrigerator')).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Elevations as SVG' }).click()]);
  expect(download.suggestedFilename()).toBe('sample-kitchen-elevations.svg');
});
```

- [ ] **Step 4: Run it.**

Run: `npx playwright test tests/e2e/elevations.spec.ts`
Expected: PASS.

- [ ] **Step 5: Docs.**
  - Add `- [x] Phase 10 — Kitchen wall elevations (Tasks 52–57; see below)` to the status list in `docs/plan.md`, and a "Phase 10 — Kitchen wall elevations (tasks 52–57)" section after Phase 9 in the same style: what was built, what the example snapshots showed, and the known gaps (no stored heights, no neighbouring walls in section, no islands).
  - In `README.md`, add an "elevations" sentence after the estimate paragraph and a "Phase 10 — Elevations" status line, and change "Exports to JSON, SVG/PNG, and a CSV parts list." to "Exports to JSON, SVG/PNG (plan and wall elevations), and a CSV parts list."
  - In the spec, record the three plan refinements listed under Global Constraints.

- [ ] **Step 6: Run the full checks.**

Run: `npm test && npx tsc --noEmit -p . && npm run lint && npm run e2e`
Expected: all PASS.

- [ ] **Step 7: Commit.**

```bash
git add tests docs README.md
git commit -m "test: elevations over the example kitchens; e2e; docs"
```
