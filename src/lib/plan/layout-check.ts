/**
 * Layout check: a kitchen against the main NKBA planning guidelines — the
 * work triangle, counter beside the sink, range and fridge, the dishwasher's
 * distance from the sink, aisle width and total counter — as a checklist.
 * Unlike `validatePlan`'s warnings it also says what passed and what doesn't
 * apply yet. Items are recognised by their tag (the first catalog tag); only
 * floor items count. Pure functions; lengths in mm.
 */

import { convexPolygonsOverlap, distance, pointToSegmentDistance, rotateAround, rotatedRectFootprint, type Point } from './geometry';
import { TALL_ITEM_MM } from './runs';
import { projectKind, type PlacedItem, type Project } from './schemas';
import { formatLength } from './viewport';

export type RuleStatus = 'pass' | 'fail' | 'n/a';

export interface LayoutRule {
  id: string;
  title: string;
  status: RuleStatus;
  /** What was measured. Lengths are written "<n> mm" so the UI can convert them. */
  detail: string;
  /** Shown, but never counted as a failure. */
  info?: boolean;
}

/** Fails first, then passes, then information, then what doesn't apply yet. */
const displayOrder = (r: LayoutRule) => (r.status === 'n/a' ? 3 : r.info ? 2 : r.status === 'fail' ? 0 : 1);

/** How many counted rules pass (information and n/a rules aren't counted), and the rules in display order. */
export function layoutSummary(rules: LayoutRule[]): { passed: number; counted: number; ordered: LayoutRule[] } {
  const counted = rules.filter((r) => !r.info && r.status !== 'n/a');
  return {
    passed: counted.filter((r) => r.status === 'pass').length,
    counted: counted.length,
    ordered: [...rules].sort((a, b) => displayOrder(a) - displayOrder(b)),
  };
}

/** A rule's detail with its "<n> mm" lengths in the project's units. */
export function layoutDetail(detail: string, units: 'mm' | 'in'): string {
  return detail.replace(/(\d+) mm/g, (_, n: string) => formatLength(Number(n), units));
}

/** The guideline numbers (NKBA, in mm). */
export const GUIDE = {
  legMin: 1200,
  legMax: 2700,
  totalMin: 4000,
  totalMax: 7900,
  sinkLanding: [600, 450],
  /** Landing: [one side, the other side], larger first. */
  rangeLanding: [380, 300],
  fridgeLanding: 380,
  fridgeIsland: 1200,
  dishwasher: 900,
  aisle: 1067,
  frontage: 3350,
} as const;

/** Tags whose top is usable counter. */
const COUNTER = new Set(['base', 'corner', 'dishwasher', 'filler', 'sink']);
/** Tags with a working front that opens onto an aisle. */
const WORKING_FRONT = new Set(['base', 'sink', 'dishwasher', 'range']);
/** Tags that can stand across an aisle from a working front. */
const AISLE_SIDE = new Set([...COUNTER, 'range', 'island', 'fridge', 'tall']);

/** Side neighbours: fronts or backs in line within this… */
const ALIGN_MM = 50;
/** …and at most this far apart (a fridge's side gap doesn't break the counter). */
const GAP_MM = 100;
const ROTATION_DEG = 1;
/** How far in front of a counter to look for the other side of an aisle. */
const AISLE_LOOK_MM = 3000;

export function checkLayout(project: Project): LayoutRule[] {
  if (projectKind(project) === 'closet') return [];
  const floor = project.items.filter((it) => (it.mount ?? 'floor') === 'floor' && it.tag);
  const tagged = (tag: string) => floor.filter((it) => it.tag === tag);
  const triangle = workTriangle(tagged('fridge'), tagged('sink'), tagged('range'));
  return [
    triangleLegs(triangle),
    triangleTotal(triangle),
    triangleClear(triangle, floor),
    landing('sink-landing', 'sink', tagged('sink'), floor, GUIDE.sinkLanding),
    landing('range-landing', 'range', tagged('range'), floor, GUIDE.rangeLanding),
    fridgeLanding(tagged('fridge'), floor),
    dishwasherSink(tagged('dishwasher'), tagged('sink')),
    workAisle(floor),
    counterFrontage(floor),
  ];
}

/**
 * Counter length beside `it` on each side — [−x, +x] in its own frame —
 * walking through side neighbours until something that isn't counter. A
 * corner cabinet joins the runs on both its walls; the counter turns there,
 * so the walk counts it and stops.
 */
export function counterBeside(it: PlacedItem, floor: PlacedItem[]): [number, number] {
  const walk = (dir: 1 | -1) => {
    let total = 0;
    let current = it;
    const seen = new Set([it]);
    for (;;) {
      const next = floor.find((o) => !seen.has(o) && sideNeighbour(current, o, dir));
      if (!next || !COUNTER.has(next.tag ?? '')) return Math.round(total);
      total += extent(footprint(next), axis(current)).size;
      if (next.tag === 'corner') return Math.round(total);
      seen.add(next);
      current = next;
    }
  };
  return [walk(-1), walk(1)];
}

// --- rules ---

interface Triangle {
  fridge: PlacedItem;
  sink: PlacedItem;
  range: PlacedItem;
  /** fridge ↔ sink, sink ↔ range, range ↔ fridge. */
  legs: [number, number, number];
}

const NO_TRIANGLE = 'needs a fridge, a sink and a range';
const LEG_NAMES = ['fridge ↔ sink', 'sink ↔ range', 'range ↔ fridge'];

/** The fridge, sink and range with the shortest triangle, or null without all three. */
function workTriangle(fridges: PlacedItem[], sinks: PlacedItem[], ranges: PlacedItem[]): Triangle | null {
  let best: Triangle | null = null;
  for (const fridge of fridges) {
    for (const sink of sinks) {
      for (const range of ranges) {
        const [f, s, r] = [fridge, sink, range].map(centre);
        const legs: Triangle['legs'] = [distance(f, s), distance(s, r), distance(r, f)];
        if (!best || sum(legs) < sum(best.legs)) best = { fridge, sink, range, legs };
      }
    }
  }
  return best;
}

function triangleLegs(t: Triangle | null): LayoutRule {
  const rule = { id: 'triangle-legs', title: 'Work triangle sides' };
  if (!t) return { ...rule, status: 'n/a', detail: NO_TRIANGLE };
  const ok = t.legs.every((l) => l >= GUIDE.legMin && l <= GUIDE.legMax);
  const legs = t.legs.map((l, i) => `${LEG_NAMES[i]} ${mm(l)}`).join(', ');
  return { ...rule, status: ok ? 'pass' : 'fail', detail: `${legs} (each ${mm(GUIDE.legMin)} to ${mm(GUIDE.legMax)})` };
}

function triangleTotal(t: Triangle | null): LayoutRule {
  const rule = { id: 'triangle-total', title: 'Work triangle total' };
  if (!t) return { ...rule, status: 'n/a', detail: NO_TRIANGLE };
  const total = sum(t.legs);
  const ok = total >= GUIDE.totalMin && total <= GUIDE.totalMax;
  return { ...rule, status: ok ? 'pass' : 'fail', detail: `${mm(total)} (${mm(GUIDE.totalMin)} to ${mm(GUIDE.totalMax)})` };
}

/** No island, table or tall item stands across a side of the triangle. */
function triangleClear(t: Triangle | null, floor: PlacedItem[]): LayoutRule {
  const rule = { id: 'triangle-clear', title: 'Work triangle unobstructed' };
  if (!t) return { ...rule, status: 'n/a', detail: NO_TRIANGLE };
  const own = new Set([t.fridge, t.sink, t.range]);
  const corners = [t.fridge, t.sink, t.range].map(centre);
  for (const other of floor) {
    if (own.has(other) || !(other.tag === 'island' || other.tag === 'table' || other.sizeMm.h >= TALL_ITEM_MM)) continue;
    const fp = footprint(other);
    // A two-point "polygon" is the leg itself; the separating-axis test handles it.
    const leg = corners.findIndex((a, i) => convexPolygonsOverlap([a, corners[(i + 1) % 3]], fp));
    if (leg >= 0) return { ...rule, status: 'fail', detail: `${label(other)} is in the way (${LEG_NAMES[leg]})` };
  }
  return { ...rule, status: 'pass', detail: 'nothing in the way' };
}

/** Counter on both sides of a sink or range: `big` on one side and `small` on the other. */
function landing(
  id: string,
  what: string,
  items: PlacedItem[],
  floor: PlacedItem[],
  [big, small]: readonly [number, number]
): LayoutRule {
  const rule = { id, title: `Counter beside the ${what}` };
  if (items.length === 0) return { ...rule, status: 'n/a', detail: `no ${what}` };
  const results = items.map((it) => {
    const [a, b] = counterBeside(it, floor);
    const ok = Math.max(a, b) >= big && Math.min(a, b) >= small;
    return { ok, detail: `${mm(a)} and ${mm(b)} beside ${label(it)} (needs ${mm(big)} and ${mm(small)})` };
  });
  const best = results.find((x) => x.ok) ?? results[0];
  return { ...rule, status: best.ok ? 'pass' : 'fail', detail: best.detail };
}

/** Counter beside the fridge on either side, or an island just in front of it. */
function fridgeLanding(fridges: PlacedItem[], floor: PlacedItem[]): LayoutRule {
  const rule = { id: 'fridge-landing', title: 'Counter beside the fridge' };
  if (fridges.length === 0) return { ...rule, status: 'n/a', detail: 'no fridge' };
  const islands = floor.filter((it) => it.tag === 'island');
  const results = fridges.map((it) => {
    const beside = Math.max(...counterBeside(it, floor));
    if (beside >= GUIDE.fridgeLanding) return { ok: true, detail: `${mm(beside)} beside ${label(it)}` };
    const zone = frontZone(it, GUIDE.fridgeIsland);
    if (islands.some((isl) => convexPolygonsOverlap(zone, footprint(isl)))) return { ok: true, detail: `island in front of ${label(it)}` };
    return {
      ok: false,
      detail: `${mm(beside)} beside ${label(it)} (needs ${mm(GUIDE.fridgeLanding)}, or an island within ${mm(GUIDE.fridgeIsland)} in front)`,
    };
  });
  const best = results.find((x) => x.ok) ?? results[0];
  return { ...rule, status: best.ok ? 'pass' : 'fail', detail: best.detail };
}

function dishwasherSink(dishwashers: PlacedItem[], sinks: PlacedItem[]): LayoutRule {
  const rule = { id: 'dishwasher-sink', title: 'Dishwasher next to the sink' };
  if (dishwashers.length === 0 || sinks.length === 0) return { ...rule, status: 'n/a', detail: 'needs a dishwasher and a sink' };
  let best = { gap: Infinity, dw: dishwashers[0], sink: sinks[0] };
  for (const dw of dishwashers) {
    for (const sink of sinks) {
      const gap = polygonGap(footprint(dw), footprint(sink));
      if (gap < best.gap) best = { gap, dw, sink };
    }
  }
  const ok = best.gap <= GUIDE.dishwasher;
  return {
    ...rule,
    status: ok ? 'pass' : 'fail',
    detail: `${mm(best.gap)} from ${label(best.dw)} to ${label(best.sink)} (at most ${mm(GUIDE.dishwasher)})`,
  };
}

/** The narrowest gap from a working front to whatever stands across from it. */
function workAisle(floor: PlacedItem[]): LayoutRule {
  const rule = { id: 'work-aisle', title: 'Work aisle width' };
  const fronts = floor.filter((it) => WORKING_FRONT.has(it.tag ?? ''));
  if (fronts.length === 0) return { ...rule, status: 'n/a', detail: 'no counters' };
  let narrowest: { gap: number; from: PlacedItem; to: PlacedItem } | null = null;
  for (const it of fronts) {
    // Inset so the items beside it in its own run don't count.
    const zone = frontZone(it, AISLE_LOOK_MM, 10);
    const n = normal(it);
    const frontLine = dot(centre(it), n) + it.sizeMm.d / 2;
    for (const other of floor) {
      if (other === it || !AISLE_SIDE.has(other.tag ?? '')) continue;
      const fp = footprint(other);
      if (!convexPolygonsOverlap(zone, fp)) continue;
      const gap = Math.max(0, Math.min(...fp.map((p) => dot(p, n))) - frontLine);
      if (!narrowest || gap < narrowest.gap) narrowest = { gap, from: it, to: other };
    }
  }
  if (!narrowest) return { ...rule, status: 'pass', detail: 'no counters face each other' };
  const ok = narrowest.gap >= GUIDE.aisle;
  return {
    ...rule,
    status: ok ? 'pass' : 'fail',
    detail: `${mm(narrowest.gap)} from ${label(narrowest.from)} to ${label(narrowest.to)} (needs ${mm(GUIDE.aisle)})`,
  };
}

function counterFrontage(floor: PlacedItem[]): LayoutRule {
  const rule = { id: 'counter-frontage', title: 'Total counter frontage', info: true };
  const counters = floor.filter((it) => COUNTER.has(it.tag ?? '') || it.tag === 'island');
  if (counters.length === 0) return { ...rule, status: 'n/a', detail: 'no counters' };
  const total = sum(counters.map((it) => it.sizeMm.w));
  return { ...rule, status: total >= GUIDE.frontage ? 'pass' : 'fail', detail: `${mm(total)} of counter (guideline ${mm(GUIDE.frontage)})` };
}

// --- geometry ---

const centre = (it: PlacedItem): Point => [it.position.x, it.position.y];
const footprint = (it: PlacedItem) => rotatedRectFootprint(centre(it), it.sizeMm.w, it.sizeMm.d, it.rotationDeg);
/** Unit vector along the item's width (+x in its frame). */
const axis = (it: PlacedItem) => rotateAround([1, 0], [0, 0], it.rotationDeg);
/** Unit vector out of the item's front (+y in its frame). */
const normal = (it: PlacedItem) => rotateAround([0, 1], [0, 0], it.rotationDeg);
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const mm = (n: number) => `${Math.round(n)} mm`;
const label = (it: PlacedItem) => `"${it.catalogId}"`;

/** Smallest difference between two angles, in degrees (0–180). */
function angleDiff(a: number, b: number): number {
  return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}

/**
 * `b` stands beside `a` on side `dir` of `a`'s frame, in the same run. A
 * corner cabinet (square, facing either run) may have any rotation.
 */
function sideNeighbour(a: PlacedItem, b: PlacedItem, dir: 1 | -1): boolean {
  if (b.tag !== 'corner' && angleDiff(a.rotationDeg, b.rotationDeg) > ROTATION_DEG) return false;
  const [u, n] = [axis(a), normal(a)];
  const ca = centre(a);
  const [along, across] = [extent(footprint(b), u), extent(footprint(b), n)];
  const fronts = Math.abs(across.max - (dot(ca, n) + a.sizeMm.d / 2));
  const backs = Math.abs(across.min - (dot(ca, n) - a.sizeMm.d / 2));
  if (Math.min(fronts, backs) > ALIGN_MM) return false;
  const gap = dir > 0 ? along.min - (dot(ca, u) + a.sizeMm.w / 2) : dot(ca, u) - a.sizeMm.w / 2 - along.max;
  return gap >= -ALIGN_MM && gap <= GAP_MM;
}

/** A polygon's span along a unit vector. */
function extent(poly: Point[], dir: Point): { min: number; max: number; size: number } {
  const ds = poly.map((p) => dot(p, dir));
  const [min, max] = [Math.min(...ds), Math.max(...ds)];
  return { min, max, size: max - min };
}

/** A rectangle `depth` deep straight out of the item's front, `inset` narrower at each side. */
function frontZone(it: PlacedItem, depth: number, inset = 0): Point[] {
  const c = centre(it);
  const at = rotateAround([c[0], c[1] + it.sizeMm.d / 2 + depth / 2], c, it.rotationDeg);
  return rotatedRectFootprint(at, it.sizeMm.w - 2 * inset, depth, it.rotationDeg);
}

/** Distance between two convex polygons; 0 when they touch or overlap. */
function polygonGap(a: Point[], b: Point[]): number {
  if (convexPolygonsOverlap(a, b)) return 0;
  let best = Infinity;
  for (const [p, q] of [
    [a, b],
    [b, a],
  ]) {
    for (const v of p) {
      for (let i = 0; i < q.length; i++) best = Math.min(best, pointToSegmentDistance(v, q[i], q[(i + 1) % q.length]));
    }
  }
  return best;
}
