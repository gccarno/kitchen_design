/**
 * Kitchen wall elevations: each wall seen from inside the room, with the
 * items backed against it and the doors and windows in it. The plan stores
 * no mounting heights, so items get standard ones from their tag. Pure.
 */

import type { Catalog } from '../catalog/loader';
import { compass } from './compass';
import { rotateAround, rotatedRectFootprint, type Point } from './geometry';
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

/** Round to 0.01 mm so rotated footprints don't leave float dust in x and w. */
const round2 = (v: number) => Math.round(v * 100) / 100;

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
  const wallIndex = new Map(room.walls.map((w, i) => [w.id, i]));

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
      const x0 = round2(Math.max(0, Math.min(...xs)));
      const x1 = round2(Math.min(lengthMm, Math.max(...xs)));
      if (x1 - x0 < 1) continue;
      pieces.push({
        itemId: it.id,
        name: catalog.byId.get(it.catalogId)?.name ?? it.catalogId,
        ...(it.tag ? { tag: it.tag } : {}),
        ...height,
        x: x0,
        w: round2(x1 - x0),
      });
    }
    if (pieces.length === 0) return;
    pieces.sort((p, q) => p.x - q.x || p.y - q.y);

    const openings: ElevationOpening[] = room.openings
      .filter((o) => wallIndex.get(o.wallId) === i)
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
  // A range, fridge or tall item is not in `under`, so it leaves a gap wider than the join and breaks the run.
  for (const p of under) {
    const last = runs[runs.length - 1];
    if (last && p.x - last.end <= COUNTER_JOIN_MM) last.end = Math.max(last.end, p.x + p.w);
    else runs.push({ x: p.x, end: p.x + p.w });
  }
  return runs.map((r) => ({ x: r.x, w: round2(r.end - r.x) }));
}
