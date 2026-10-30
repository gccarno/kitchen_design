/**
 * Suggested kitchen layouts for a room that already exists. Candidates in four
 * shapes (one wall, galley, L, U) are laid out against each wall of a
 * rectangular room, in both directions, with the same commands the AI chat and
 * the starter templates use, so placement and validation are the real thing.
 * Each is scored with the layout check and the best of each shape is kept.
 *
 * The room and its doors and windows are kept; its items are replaced.
 * Rooms that aren't rectangles aren't handled (`reason` says so). Pure.
 */

import type { Catalog } from '../catalog/loader';
import { compileCommands, type Command } from './commands';
import { checkLayout, layoutSummary } from './layout-check';
import { alongWallMm } from './openings';
import { projectKind, type Project } from './schemas';
import { validatePlan } from './validate';

export type LayoutShape = 'one-wall' | 'galley' | 'l-shape' | 'u-shape';

const SHAPE_LABEL: Record<LayoutShape, string> = {
  'one-wall': 'One-wall',
  galley: 'Galley',
  'l-shape': 'L-shape',
  'u-shape': 'U-shape',
};

export interface LayoutProposal {
  shape: LayoutShape;
  label: string;
  /** The room furnished with this layout. */
  project: Project;
  /** Layout-check rules passed, of those counted. */
  passed: number;
  counted: number;
  /** Validation warnings (clearances and the like). */
  warnings: number;
}

export interface LayoutProposals {
  proposals: LayoutProposal[];
  /** Why there are none. */
  reason?: string;
}

const CORNER = 'corner-base-900x900x720';
const FRIDGE = 'fridge-600';
const HOOD = 'range-hood-760';
const base = (mm: 450 | 600) => `base-${mm}x560x720`;
/** The corner cabinet's depth and width: its centre sits half of it from the corner. */
const CORNER_CENTRE_MM = 450;
const MAX_PROPOSALS = 3;

interface Candidate {
  shape: LayoutShape;
  commands: Command[];
  /** The wall the range is on, where its hood goes. */
  rangeWall: string;
}

const wallLength = (room: Project['room'], i: number): number => {
  const [a, b] = [room.polygon[i], room.polygon[(i + 1) % room.polygon.length]];
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
};

/** Four corners, every edge horizontal or vertical. */
function isRectangle(room: Project['room']): boolean {
  if (room.polygon.length !== 4) return false;
  return room.polygon.every(([x, y], i) => {
    const [nx, ny] = room.polygon[(i + 1) % 4];
    return (x === nx) !== (y === ny);
  });
}

type RunFrom = 'start' | 'end' | 'centre';

/**
 * Every candidate for a rectangular room. For each wall `p` taken as the main
 * wall, and each direction (`mirror`), the shapes are described relative to it:
 * the "near" end of the main wall is where an L's corner is.
 */
function candidates(room: Project['room']): Candidate[] {
  const out: Candidate[] = [];
  for (let p = 0; p < 4; p++) {
    for (const mirror of [false, true]) {
      const wall = (k: number) => `w${((p + k) % 4) + 1}`;
      const main = wall(0);
      const mainLen = wallLength(room, p);
      const nearAlong = mirror ? mainLen - CORNER_CENTRE_MM : CORNER_CENTRE_MM;
      const farAlong = mainLen - nearAlong;
      const corner = (alongMm: number): Command => ({ type: 'addItem', catalogId: CORNER, wall: main, alongMm });

      /** `items` on the main wall, listed from its near end. */
      const mainRun = (items: string[], from: 'near' | 'centre' = 'near'): Command => {
        const [list, side]: [string[], RunFrom] = mirror ? [[...items].reverse(), 'end'] : [items, 'start'];
        return { type: 'addRun', wall: main, items: list, from: from === 'centre' ? 'centre' : side };
      };
      /** `items` on the wall at an end of the main wall, listed outward from the shared corner. */
      const sideRun = (k: 1 | 3, outward: string[]): Command =>
        k === 3 ? { type: 'addRun', wall: wall(3), items: [...outward].reverse(), from: 'end' } : { type: 'addRun', wall: wall(1), items: outward, from: 'start' };
      const nearSide = (outward: string[]) => sideRun(mirror ? 1 : 3, outward);
      const farSide = (outward: string[]) => sideRun(mirror ? 3 : 1, outward);
      const nearWall = mirror ? wall(1) : wall(3);

      // One wall: fridge, sink and range 1.2–2.7 m apart on a line.
      const longRun = [FRIDGE, base(600), 'sink-base-900', 'dishwasher-450', 'range-760', base(450)];
      const shortRun = [FRIDGE, 'sink-base-800', 'dishwasher-450', 'range-600'];
      for (const run of [longRun, shortRun]) {
        for (const from of ['near', 'centre'] as const) {
          out.push({ shape: 'one-wall', commands: [mainRun(run, from)], rangeWall: main });
        }
      }

      // Galley: sink side, and the range opposite, either lined up or centred.
      const sinkSide = [base(450), 'sink-base-900', 'dishwasher-600', FRIDGE];
      const rangeSide = [base(450), 'range-760', base(450)];
      const opposite = wall(2);
      // The opposite wall runs the other way, so "near the start of the main wall" is its end.
      const oppositeRun = (centre: boolean): Command => {
        const list = mirror ? rangeSide : [...rangeSide].reverse();
        return { type: 'addRun', wall: opposite, items: list, from: centre ? 'centre' : mirror ? 'start' : 'end' };
      };
      for (const centre of [false, true]) {
        out.push({ shape: 'galley', commands: [mainRun(sinkSide), oppositeRun(centre)], rangeWall: opposite });
      }

      // L: a corner cabinet at the near end, sink along the main wall, range down the side.
      for (const [along, side] of [
        [['sink-base-900', 'dishwasher-600', FRIDGE], ['range-760', base(450), base(600)]],
        [['sink-base-800', 'dishwasher-450', FRIDGE], ['range-600', base(450), base(600)]],
      ] as const) {
        out.push({
          shape: 'l-shape',
          commands: [corner(nearAlong), mainRun([...along]), nearSide([...side])],
          rangeWall: nearWall,
        });
      }

      // U: corner cabinets at both ends of the main wall, a run on each side.
      for (const [middle, near, far] of [
        [['sink-base-900', base(450)], ['dishwasher-600', 'range-760', base(450), base(600)], [FRIDGE, base(450), base(600)]],
        [['sink-base-800'], ['dishwasher-450', 'range-600', base(450)], [FRIDGE, base(450)]],
      ] as const) {
        out.push({
          shape: 'u-shape',
          commands: [corner(nearAlong), corner(farAlong), mainRun([...middle]), nearSide([...near]), farSide([...far])],
          rangeWall: nearWall,
        });
      }
    }
  }
  return out;
}

/** The candidate built on an empty copy of `project`, with a hood over the range if one fits. Null if it can't be built. */
function build(project: Project, c: Candidate, catalog: Catalog, makeId: () => string): Project | null {
  const empty: Project = { ...project, items: [] };
  try {
    const built = compileCommands(empty, c.commands, catalog, makeId).project;
    const range = built.items.find((it) => it.tag === 'range');
    if (!range || !catalog.byId.has(HOOD)) return built;
    const wallIndex = Number(c.rangeWall.slice(1)) - 1;
    const hood: Command = { type: 'addItem', catalogId: HOOD, wall: c.rangeWall, alongMm: alongWallMm(built.room, wallIndex, [range.position.x, range.position.y]) };
    try {
      return compileCommands(built, [hood], catalog, makeId).project;
    } catch {
      return built; // e.g. a window over the range
    }
  } catch {
    return null;
  }
}

/** The same layout however it was reached: shapes and positions, not ids. */
const layoutKey = (p: Project): string =>
  p.items
    .map((it) => `${it.catalogId}@${Math.round(it.position.x)},${Math.round(it.position.y)},${Math.round(it.rotationDeg)}`)
    .sort()
    .join('|');

/**
 * Up to three layouts for `project`'s room, best first: the best of each shape,
 * ranked by layout-check rules failed, then by validation warnings. Only layouts
 * that pass at least half the counted rules are offered.
 */
export function proposeLayouts(project: Project, catalog: Catalog, makeId: () => string): LayoutProposals {
  if (projectKind(project) !== 'kitchen') return { proposals: [], reason: 'Layouts can only be suggested for a kitchen.' };
  if (!isRectangle(project.room)) {
    return { proposals: [], reason: 'Layouts can only be suggested for a rectangular room. Ask the chat for a layout instead.' };
  }

  const seen = new Set<string>();
  const best = new Map<LayoutShape, LayoutProposal>();
  for (const c of candidates(project.room)) {
    const built = build(project, c, catalog, makeId);
    if (!built) continue;
    const key = layoutKey(built);
    if (seen.has(key)) continue;
    seen.add(key);
    const validation = validatePlan(built);
    if (!validation.valid) continue;
    const { passed, counted } = layoutSummary(checkLayout(built));
    const proposal: LayoutProposal = { shape: c.shape, label: SHAPE_LABEL[c.shape], project: built, passed, counted, warnings: validation.warnings.length };
    const kept = best.get(c.shape);
    if (!kept || rank(proposal) < rank(kept)) best.set(c.shape, proposal);
  }

  const proposals = [...best.values()]
    .filter((p) => p.passed * 2 >= p.counted)
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, MAX_PROPOSALS);
  return proposals.length
    ? { proposals }
    : { proposals: [], reason: 'No standard layout fits this room well. Try the chat, or a larger room.' };
}

/** Lower is better: failed rules dominate, then warnings. */
const rank = (p: LayoutProposal): number => (p.counted - p.passed) * 1000 + p.warnings;
