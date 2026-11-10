/**
 * The kitchen as solids for the 3D view. Everything is a prism: a footprint
 * in plan coordinates (mm) between two heights. Walls are cut around doors and
 * windows into pieces; items stand at the same standard heights the
 * elevations use. Pure: the renderer only turns prisms into meshes.
 */

import { COUNTERTOP_COLOR, finishesOf } from './finishes';
import { CABINET_TAGS, ELEVATION, verticalPlacement } from './elevation';
import { rotatedRectFootprint, type Bounds, type Point } from './geometry';
import { projectKind, type Project } from './schemas';
import { inwardNormal, wallQuads } from './walls';

export type SceneKind = 'floor' | 'wall' | 'pane' | 'cabinet' | 'appliance' | 'furniture' | 'slab';

export interface Prism {
  kind: SceneKind;
  /** Corners in plan coordinates, mm, in either winding. */
  footprint: Point[];
  /** Heights above the floor, mm. */
  bottom: number;
  top: number;
  color: string;
  /** Below 1 for glass. */
  opacity?: number;
  /** The placed item or opening this came from, when there is one. */
  sourceId?: string;
  /** Walls and panes: unit vector pointing out of the room, so a viewer outside can hide the piece. */
  outward?: Point;
}

export interface Scene {
  prisms: Prism[];
  /** Plan-view bounds of everything, walls included. */
  bounds: Bounds;
  ceilingMm: number;
}

export const SCENE_COLORS = {
  floor: '#d6cfc4',
  wall: '#ece8e1',
  glass: '#9cc5e8',
  appliance: '#b8bcc2',
  furniture: '#c8a27a',
} as const;
const GLASS_OPACITY = 0.35;
/** Where across the wall's thickness a window pane sits (0 = room face, 1 = outer face), and how thick it is. */
const PANE_FROM = 0.4;
const PANE_TO = 0.6;

const EMPTY: Scene = { prisms: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, ceilingMm: ELEVATION.ceilingMm };

export function buildScene(project: Project): Scene {
  if (projectKind(project) === 'closet') return EMPTY;
  const { room } = project;
  const poly = room.polygon as Point[];
  const ceiling = ELEVATION.ceilingMm;
  const finishes = finishesOf(project);
  const prisms: Prism[] = [{ kind: 'floor', footprint: poly, bottom: -20, top: 0, color: SCENE_COLORS.floor }];

  const quads = wallQuads(room);
  const wallIndex = new Map(room.walls.map((w, i) => [w.id, i]));
  quads.forEach(([a, b, outerEnd, outerStart], i) => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length === 0) return;
    // A point `s` mm along the wall, on its room face and on its outer face. The two
    // ends of the wall follow the corner mitre; a cut in between is square to the wall.
    const [nx, ny] = inwardNormal(room, i);
    const thickness = room.walls[i]?.thicknessMm ?? 0;
    const inner = (s: number): Point => [a[0] + ((b[0] - a[0]) * s) / length, a[1] + ((b[1] - a[1]) * s) / length];
    const outer = (s: number): Point => {
      if (s <= 0) return outerStart;
      if (s >= length) return outerEnd;
      const p = inner(s);
      return [p[0] - nx * thickness, p[1] - ny * thickness];
    };
    const between = (s: number, k: number): Point => {
      const p = inner(s);
      const q = outer(s);
      return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
    };
    const piece = (kind: 'wall' | 'pane', from: number, to: number, bottom: number, top: number, extra: Partial<Prism> = {}) => {
      if (to - from < 1 || top - bottom < 1) return;
      const [k0, k1] = kind === 'pane' ? [PANE_FROM, PANE_TO] : [0, 1];
      prisms.push({
        kind,
        footprint: [between(from, k0), between(to, k0), between(to, k1), between(from, k1)],
        bottom,
        top,
        color: kind === 'wall' ? SCENE_COLORS.wall : SCENE_COLORS.glass,
        outward: [-nx, -ny],
        ...extra,
      });
    };

    const openings = room.openings
      .filter((o) => wallIndex.get(o.wallId) === i)
      .sort((p, q) => p.positionMm - q.positionMm);
    let cursor = 0;
    for (const o of openings) {
      const from = Math.max(cursor, o.positionMm, 0);
      const to = Math.min(length, o.positionMm + o.widthMm);
      if (to <= from) continue;
      piece('wall', cursor, from, 0, ceiling);
      if (o.kind === 'window') {
        const sill = ELEVATION.windowSillMm;
        const head = sill + o.heightMm;
        piece('wall', from, to, 0, sill);
        piece('wall', from, to, head, ceiling);
        piece('pane', from, to, sill, Math.min(head, ceiling), { opacity: GLASS_OPACITY, sourceId: o.id });
      } else {
        piece('wall', from, to, o.heightMm, ceiling);
      }
      cursor = to;
    }
    piece('wall', cursor, length, 0, ceiling);
  });

  for (const it of project.items) {
    const place = verticalPlacement(it);
    const footprint = rotatedRectFootprint([it.position.x, it.position.y], it.sizeMm.w, it.sizeMm.d, it.rotationDeg);
    const tag = it.tag;
    const cabinetLike = (tag !== undefined && CABINET_TAGS.has(tag)) || tag === 'island';
    const kind: SceneKind = cabinetLike ? 'cabinet' : place.kind === 'free' ? 'furniture' : 'appliance';
    const color = kind === 'cabinet' ? finishes.cabinetColor : kind === 'furniture' ? SCENE_COLORS.furniture : SCENE_COLORS.appliance;
    const bottom = place.y;
    let top = place.y + place.h;
    // A countertop slab sits on base cabinets, dishwashers and islands.
    const slabbed = place.kind === 'base' || tag === 'dishwasher' || tag === 'island';
    if (slabbed) {
      const under = tag === 'island' ? it.sizeMm.h - ELEVATION.counterThicknessMm : top;
      top = Math.min(top, under);
      prisms.push({
        kind: 'slab',
        footprint,
        bottom: top,
        top: top + ELEVATION.counterThicknessMm,
        color: COUNTERTOP_COLOR[finishes.countertop],
        sourceId: it.id,
      });
    }
    prisms.push({ kind, footprint, bottom, top, color, sourceId: it.id });
  }

  const bounds = boundsOf(prisms);
  return { prisms, bounds, ceilingMm: ceiling };
}

function boundsOf(prisms: Prism[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of prisms) {
    for (const [x, y] of p.footprint) {
      minX = Math.min(minX, Math.round(x * 100) / 100);
      minY = Math.min(minY, Math.round(y * 100) / 100);
      maxX = Math.max(maxX, Math.round(x * 100) / 100);
      maxY = Math.max(maxY, Math.round(y * 100) / 100);
    }
  }
  return { minX, minY, maxX, maxY };
}
