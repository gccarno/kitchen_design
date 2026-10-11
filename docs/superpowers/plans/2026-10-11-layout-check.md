# Layout Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Check a kitchen against the main NKBA guidelines and show the result as a checklist panel. Failed rules are also fed to the chat.

**Architecture:** A new pure module, `src/lib/plan/layout-check.ts`, turns a `Project` into a list of `LayoutRule`s, recognising items by `PlacedItem.tag`. A new presentational component, `LayoutCheckPanel`, renders the list in `ProjectEditor`. `describePlanForLLM` appends the failed rules.

**Tech Stack:** TypeScript, React 19, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-10-layout-check-design.md`

## Global Constraints

- All lengths are in mm. Details write lengths as `<integer> mm` so the UI can convert them with `formatLength`.
- Only floor items count (`mount` unset or `'floor'`), and only items with a `tag`.
- Closet projects return `[]`.
- Existing warnings (`validatePlan`) stay unchanged.
- Guideline numbers: triangle legs 1200–2700, total 4000–7900, sink landing 600 + 450, range landing 380 + 300, fridge landing 380 (or an island within 1200 in front), dishwasher ≤900 from the sink, aisle ≥1067, frontage ≥3350 (info).
- Side neighbours: same rotation within 1°, fronts **or backs** lined up within 50 mm, and a gap of ≤100 mm between them. The gap allowance is wider than the spec's original 10 mm because runs keep a fridge's 50 mm side gap and the sample kitchen leaves 80 mm. The spec is updated to match.

## Review Focus

1. **Run that isn't axis-aligned** (rotated 90° along the left wall): landing lengths must equal the unrotated case. → Task 2 test.
2. **Rotation 0 vs 360** on items in the same run must count as the same rotation. → Task 2 test.
3. **Several sinks or ranges:** a rule passes if any one of them passes. → Task 2 test.
4. **Items without a tag** (older projects): they're ignored rather than crashing. → Task 1 test.
5. **Inch display:** details convert every length, e.g. 1200 mm → `3' 11 1/4"`. → Task 4 test.

---

### Task 1: Module skeleton and work-triangle rules

**Files:**
- Create: `src/lib/plan/layout-check.ts`
- Test: `src/lib/plan/layout-check.test.ts`

**Interfaces:**
- Produces: `type RuleStatus`, `interface LayoutRule { id; title; status; detail; info? }`, `GUIDE`, `checkLayout(project: Project): LayoutRule[]`, `counterBeside(it, floor): [number, number]`
- Rule ids in this order: `triangle-legs`, `triangle-total`, `triangle-clear`, `sink-landing`, `range-landing`, `fridge-landing`, `dishwasher-sink`, `work-aisle`, `counter-frontage`.

- [ ] Step 1: Write the triangle tests (pass, legs fail, total fail, island in the way, n/a without a range, closet gives `[]`, untagged items ignored).
- [ ] Step 2: Run `npx vitest run src/lib/plan/layout-check.test.ts`. Expected: FAIL because the module is missing.
- [ ] Step 3: Implement the whole module (code below). Tasks 2 and 3 only add tests against it.
- [ ] Step 4: Run the tests. Expected: PASS.
- [ ] Step 5: Commit `feat(plan): layout check — work triangle`.

Module code (complete):

```ts
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

/** The guideline numbers (NKBA, in mm). */
export const GUIDE = {
  legMin: 1200,
  legMax: 2700,
  totalMin: 4000,
  totalMax: 7900,
  sinkLanding: [600, 450],
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
 * walking through side neighbours until something that isn't counter.
 */
export function counterBeside(it: PlacedItem, floor: PlacedItem[]): [number, number] {
  const walk = (dir: 1 | -1) => {
    let total = 0;
    let current = it;
    const seen = new Set([it]);
    for (;;) {
      const next = floor.find((o) => !seen.has(o) && sideNeighbour(current, o, dir));
      if (!next || !COUNTER.has(next.tag ?? '')) return total;
      total += next.sizeMm.w;
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
function landing(id: string, what: string, items: PlacedItem[], floor: PlacedItem[], [big, small]: readonly [number, number]): LayoutRule {
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
  return { ...rule, status: ok ? 'pass' : 'fail', detail: `${mm(best.gap)} from ${label(best.dw)} to ${label(best.sink)} (at most ${mm(GUIDE.dishwasher)})` };
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
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

/** `b` stands beside `a` on side `dir` of `a`'s frame, in the same run. */
function sideNeighbour(a: PlacedItem, b: PlacedItem, dir: 1 | -1): boolean {
  if (angleDiff(a.rotationDeg, b.rotationDeg) > ROTATION_DEG) return false;
  const [u, n] = [axis(a), normal(a)];
  const [ca, cb] = [centre(a), centre(b)];
  const [da, db] = [a.sizeMm.d / 2, b.sizeMm.d / 2];
  const fronts = Math.abs(dot(cb, n) + db - (dot(ca, n) + da));
  const backs = Math.abs(dot(cb, n) - db - (dot(ca, n) - da));
  if (Math.min(fronts, backs) > ALIGN_MM) return false;
  const gap = dir * (dot(cb, u) - dot(ca, u)) - (a.sizeMm.w + b.sizeMm.w) / 2;
  return gap >= -ALIGN_MM && gap <= GAP_MM;
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
  const edges = (p: Point[]) => p.map((v, i) => [v, p[(i + 1) % p.length]] as const);
  let best = Infinity;
  for (const [p, q] of [[a, b], [b, a]] as const) {
    for (const v of p) for (const [s, e] of edges(q)) best = Math.min(best, pointToSegmentDistance(v, s, e));
  }
  return best;
}
```

Test helpers and triangle tests (`src/lib/plan/layout-check.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { checkLayout, counterBeside, type LayoutRule } from './layout-check';
import { ProjectSchema, type PlacedItem, type Project } from './schemas';

let n = 0;
/** A floor item with its centre at (x, y), front facing +y when rot is 0. */
function item(tag: string | undefined, w: number, d: number, x: number, y: number, rotationDeg = 0, h = 900): PlacedItem {
  n += 1;
  return { id: `i${n}`, catalogId: `${tag ?? 'thing'}-${w}`, sizeMm: { w, d, h }, position: { x, y }, rotationDeg, ...(tag ? { tag } : {}) };
}

/** Items packed left to right against the top wall (y = 0), from `x0`; spec = [tag, w, d?, h?]. */
function run(specs: Array<[string, number, number?, number?]>, x0 = 0, gap = 0): PlacedItem[] {
  let x = x0;
  return specs.map(([tag, w, d = 560, h = 900]) => {
    const it = item(tag, w, d, x + w / 2, d / 2, 0, h);
    x += w + gap;
    return it;
  });
}

function kitchen(items: PlacedItem[], kind: 'kitchen' | 'closet' = 'kitchen'): Project {
  return ProjectSchema.parse({
    id: 'p', name: 'k', units: 'mm', createdAt: 'x', updatedAt: 'x', revision: 0, photos: [], kind,
    room: {
      polygon: [[0, 0], [6000, 0], [6000, 5000], [0, 5000]],
      walls: ['a', 'b', 'c', 'd'].map((id) => ({ id, thicknessMm: 100 })),
      openings: [],
    },
    items,
    history: [],
    ...(kind === 'closet' ? { closet: { widthMm: 1830, heightMm: 2438, depthMm: 610, opening: { style: 'bifold' }, components: [] } } : {}),
  });
}

const rule = (rules: LayoutRule[], id: string) => rules.find((r) => r.id === id)!;
const status = (items: PlacedItem[], id: string) => rule(checkLayout(kitchen(items)), id).status;

// A comfortable triangle: sink and range 1800 apart on the top wall, fridge facing them.
const sink = () => item('sink', 900, 560, 1500, 280);
const range = () => item('range', 760, 650, 3300, 325);
const fridge = (x = 2400, y = 1900) => item('fridge', 910, 700, x, y, 180, 1780);

describe('work triangle', () => {
  it('passes a triangle with every side 1200–2700 mm and nothing in the way', () => {
    const rules = checkLayout(kitchen([sink(), range(), fridge()]));
    expect(rule(rules, 'triangle-legs').status).toBe('pass');
    expect(rule(rules, 'triangle-total').status).toBe('pass');
    expect(rule(rules, 'triangle-clear').status).toBe('pass');
    expect(rule(rules, 'triangle-legs').detail).toContain('sink ↔ range 1800 mm');
  });

  it('fails a side that is too long, and a total that is too long', () => {
    const rules = checkLayout(kitchen([sink(), range(), fridge(5500, 4500)]));
    expect(rule(rules, 'triangle-legs').status).toBe('fail');
    expect(rule(rules, 'triangle-total').status).toBe('fail');
  });

  it('fails when an island stands across a side', () => {
    expect(status([sink(), range(), fridge(), item('island', 1200, 600, 2000, 1100)], 'triangle-clear')).toBe('fail');
  });

  it('uses the closest of several fridges', () => {
    expect(status([sink(), range(), fridge(5500, 4500), fridge()], 'triangle-legs')).toBe('pass');
  });

  it('does not apply without all three', () => {
    const rules = checkLayout(kitchen([sink(), fridge()]));
    for (const id of ['triangle-legs', 'triangle-total', 'triangle-clear']) expect(rule(rules, id).status).toBe('n/a');
  });
});

describe('checkLayout', () => {
  it('returns every rule, in order, for a kitchen', () => {
    expect(checkLayout(kitchen([])).map((r) => r.id)).toEqual([
      'triangle-legs', 'triangle-total', 'triangle-clear', 'sink-landing', 'range-landing',
      'fridge-landing', 'dishwasher-sink', 'work-aisle', 'counter-frontage',
    ]);
    expect(checkLayout(kitchen([])).every((r) => r.status === 'n/a')).toBe(true);
  });

  it('returns nothing for a closet', () => {
    expect(checkLayout(kitchen([], 'closet'))).toEqual([]);
  });

  it('ignores items without a tag and wall-mounted items', () => {
    const wallSink = { ...sink(), mount: 'wall' as const };
    expect(checkLayout(kitchen([item(undefined, 900, 560, 1500, 280), wallSink])).every((r) => r.status === 'n/a')).toBe(true);
  });
});
```

(The closet fixture must satisfy `ClosetSchema`. Copy the shape from `src/lib/closet/validate.test.ts` if it differs.)

### Task 2: Landing and dishwasher rules

**Files:** Test: `src/lib/plan/layout-check.test.ts` (append).

- [ ] Step 1: Add these tests:

```ts
describe('counter beside', () => {
  it('walks through counter neighbours and stops at an appliance', () => {
    const items = run([['range', 760, 650], ['base', 600], ['sink', 900], ['dishwasher', 600], ['base', 450], ['fridge', 910, 700, 1780], ['base', 600]]);
    expect(counterBeside(items[2], items)).toEqual([600, 1050]);
  });

  it('counts across a fridge-sized side gap but not a 200 mm one', () => {
    const spaced = run([['fridge', 910, 700, 1780], ['base', 600]], 0, 50);
    expect(counterBeside(spaced[0], spaced)).toEqual([0, 600]);
    const apart = run([['sink', 900], ['base', 600]], 0, 200);
    expect(counterBeside(apart[0], apart)).toEqual([0, 0]);
  });

  it('gives the same lengths for a run turned 90° along the left wall, and for rotation 360', () => {
    const items = run([['base', 600], ['sink', 900], ['base', 450]]);
    // Rotate the run about the origin by 90° (CCW), then shift it inside the room.
    const turned = items.map((it) => ({ ...it, rotationDeg: 90, position: { x: -it.position.y + 560, y: it.position.x } }));
    // The run's +x now points down the wall (+y), so the 600 is still on the −x side.
    expect(counterBeside(turned[1], turned)).toEqual([600, 450]);
    const mixed = items.map((it, i) => (i === 0 ? { ...it, rotationDeg: 360 } : it));
    expect(counterBeside(mixed[1], mixed)).toEqual([600, 450]);
  });
});

describe('landing space', () => {
  it('sink: 600 one side and 450 the other passes; 300 one side fails', () => {
    expect(status(run([['base', 600], ['sink', 900], ['dishwasher', 450]]), 'sink-landing')).toBe('pass');
    expect(status(run([['base', 300], ['sink', 900], ['base', 900]]), 'sink-landing')).toBe('fail');
  });

  it('range: needs counter on both sides; a range at the end of a run fails', () => {
    expect(status(run([['base', 300], ['range', 760, 650], ['base', 450]]), 'range-landing')).toBe('pass');
    expect(status(run([['range', 760, 650], ['base', 900]]), 'range-landing')).toBe('fail');
  });

  it('passes when any one of several sinks has the space', () => {
    const items = [...run([['sink', 900]]), ...run([['base', 600], ['sink', 900], ['base', 600]], 2000)];
    expect(status(items, 'sink-landing')).toBe('pass');
  });

  it('fridge: counter beside it, or an island in front of it', () => {
    expect(status(run([['fridge', 910, 700, 1780], ['base', 450]], 0, 50), 'fridge-landing')).toBe('pass');
    expect(status(run([['fridge', 910, 700, 1780], ['tall', 600, 560, 2100]]), 'fridge-landing')).toBe('fail');
    const f = run([['fridge', 910, 700, 1780]]);
    expect(status([...f, item('island', 1200, 900, 455, 700 + 500 + 450)], 'fridge-landing')).toBe('pass');
  });

  it('does not apply without the appliance', () => {
    expect(status(run([['base', 600]]), 'sink-landing')).toBe('n/a');
  });
});

describe('dishwasher next to the sink', () => {
  it('passes when beside the sink, fails 1200 mm away, n/a without one', () => {
    expect(status(run([['sink', 900], ['dishwasher', 600]]), 'dishwasher-sink')).toBe('pass');
    expect(status(run([['sink', 900], ['base', 1200], ['dishwasher', 600]]), 'dishwasher-sink')).toBe('fail');
    expect(status(run([['sink', 900]]), 'dishwasher-sink')).toBe('n/a');
  });
});
```

- [ ] Step 2: Run the tests. Expected: PASS, since the module is already complete. Fix the module if any fail.
- [ ] Step 3: Commit `test(plan): layout check — landing space and dishwasher`.

### Task 3: Aisle and frontage rules

**Files:** Test: `src/lib/plan/layout-check.test.ts` (append).

- [ ] Step 1: Add these tests:

```ts
describe('work aisle', () => {
  /** A base run on the top wall and a facing one whose fronts are `gap` apart. */
  const galley = (gap: number) => [
    ...run([['base', 600], ['sink', 900]]),
    item('base', 1500, 560, 750, 560 + gap + 280, 180),
  ];

  it('fails facing counters 1000 mm apart and passes at 1200 mm', () => {
    expect(status(galley(1000), 'work-aisle')).toBe('fail');
    expect(rule(checkLayout(kitchen(galley(1000))), 'work-aisle').detail).toMatch(/^1000 mm from/);
    expect(status(galley(1200), 'work-aisle')).toBe('pass');
  });

  it('passes a single run with nothing across from it', () => {
    expect(rule(checkLayout(kitchen(run([['base', 600], ['sink', 900]]))), 'work-aisle').detail).toBe('no counters face each other');
  });

  it('counts an island across from the run', () => {
    expect(status([...run([['sink', 900]]), item('island', 1800, 900, 450, 560 + 900 + 450)], 'work-aisle')).toBe('fail');
  });
});

describe('counter frontage', () => {
  it('adds up counter widths, as information', () => {
    const r = rule(checkLayout(kitchen(run([['base', 1200], ['sink', 900], ['dishwasher', 600], ['range', 760, 650]]))), 'counter-frontage');
    expect(r).toMatchObject({ status: 'fail', info: true, detail: '2700 mm of counter (guideline 3350 mm)' });
  });
});
```

- [ ] Step 2: Run the tests. Expected: PASS.
- [ ] Step 3: Commit `test(plan): layout check — aisle and frontage`.

### Task 4: Checklist panel in the editor

**Files:**
- Create: `src/components/LayoutCheckPanel.tsx`
- Test: `src/components/LayoutCheckPanel.test.tsx`
- Modify: `src/components/ProjectEditor.tsx` (import, a `useMemo` beside `warnings`, and render after the warnings block)

**Interfaces:** Consumes `LayoutRule` and `checkLayout` from Task 1, and `formatLength(mm, units)` from `src/lib/plan/viewport.ts`.

- [ ] Step 1: Failing test:

```tsx
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import React from 'react';
import LayoutCheckPanel from './LayoutCheckPanel';
import type { LayoutRule } from '@/lib/plan/layout-check';

const rules: LayoutRule[] = [
  { id: 'a', title: 'Passing rule', status: 'pass', detail: '1200 mm' },
  { id: 'b', title: 'Not applicable', status: 'n/a', detail: 'no sink' },
  { id: 'c', title: 'Info rule', status: 'fail', detail: '2700 mm of counter', info: true },
  { id: 'd', title: 'Failing rule', status: 'fail', detail: '1000 mm from "base-600" to "base-1500"' },
];

describe('LayoutCheckPanel', () => {
  it('counts passes among pass/fail rules that are not info', () => {
    render(<LayoutCheckPanel rules={rules} units="mm" />);
    expect(screen.getByRole('heading', { name: 'Layout check — 1 of 2 passed' })).toBeInTheDocument();
  });

  it('lists fails first, then passes, then info and n/a', () => {
    render(<LayoutCheckPanel rules={rules} units="mm" />);
    const items = within(screen.getByRole('list', { name: 'Layout check' })).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining('Failing rule'),
      expect.stringContaining('Passing rule'),
      expect.stringContaining('Info rule'),
      expect.stringContaining('Not applicable'),
    ]);
  });

  it('shows lengths in inches for an inch project', () => {
    render(<LayoutCheckPanel rules={rules} units="in" />);
    expect(screen.getByText(/3' 11 1\/4"/)).toBeInTheDocument();
  });

  it('asks for the main appliances when nothing can be checked yet', () => {
    render(<LayoutCheckPanel rules={[rules[1]]} units="mm" />);
    expect(screen.getByRole('heading', { name: /Layout check — place a fridge, sink and range/ })).toBeInTheDocument();
  });
});
```

- [ ] Step 2: Run `npx vitest run src/components/LayoutCheckPanel.test.tsx`. Expected: FAIL because the module is missing.
- [ ] Step 3: Implement:

```tsx
import React from 'react';
import type { LayoutRule } from '@/lib/plan/layout-check';
import { formatLength } from '@/lib/plan/viewport';

const ORDER = (r: LayoutRule) => (r.status === 'n/a' ? 3 : r.info ? 2 : r.status === 'fail' ? 0 : 1);
const MARK: Record<LayoutRule['status'], string> = { pass: '✓', fail: '✗', 'n/a': '–' };

/** The kitchen against the NKBA guidelines: what passes, what fails, what doesn't apply yet. */
export default function LayoutCheckPanel({ rules, units }: { rules: LayoutRule[]; units: 'mm' | 'in' }) {
  const counted = rules.filter((r) => !r.info && r.status !== 'n/a');
  const passed = counted.filter((r) => r.status === 'pass').length;
  const sorted = [...rules].sort((a, b) => ORDER(a) - ORDER(b));
  const detail = (text: string) => text.replace(/(\d+) mm/g, (_, n: string) => formatLength(Number(n), units));
  return (
    <div className="rounded border border-gray-200 p-2 text-sm">
      <h3 className="font-medium">
        {counted.length > 0 ? `Layout check — ${passed} of ${counted.length} passed` : 'Layout check — place a fridge, sink and range to start'}
      </h3>
      <ul aria-label="Layout check" className="mt-1 flex flex-col gap-0.5">
        {sorted.map((r) => (
          <li key={r.id} className={r.status === 'n/a' || r.info ? 'text-gray-500' : r.status === 'fail' ? 'text-red-800' : 'text-green-800'}>
            <span aria-hidden="true" className="inline-block w-4">{r.info && r.status !== 'n/a' ? 'i' : MARK[r.status]}</span>
            <span className="font-medium">{r.title}</span>: {detail(r.detail)}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

In `ProjectEditor.tsx`:
- `import LayoutCheckPanel from './LayoutCheckPanel';`
- `import { checkLayout } from '@/lib/plan/layout-check';`
- After line 52: `const layout = useMemo(() => checkLayout(project), [project]);`
- After the warnings block, inside the "Current room" section: `<LayoutCheckPanel rules={layout} units={project.units} />`

- [ ] Step 4: Run `npx vitest run src/components`. Expected: PASS, including the existing ProjectEditor tests.
- [ ] Step 5: Commit `feat: layout check panel in the kitchen editor`.

### Task 5: Chat sees the failed rules

**Files:**
- Modify: `src/lib/llm/plan-context.ts` (append to `describePlanForLLM` before `return`)
- Test: `src/lib/llm/plan-context.test.ts`

- [ ] Step 1: Failing tests (append to `describe('describePlanForLLM')`):

```ts
  it('adds the layout check failures, and leaves them out when nothing fails', () => {
    // A sink jammed against a wall with nothing beside it.
    const failing: Project = {
      ...project,
      items: [{ id: 's', catalogId: 'sink-base-900', tag: 'sink', sizeMm: { w: 900, d: 560, h: 870 }, position: { x: 450, y: 280 }, rotationDeg: 0 }],
    };
    expect(describePlanForLLM(failing, catalog)).toMatch(/Layout check failures[^\n]*:\n- Counter beside the sink: 0 mm and 0 mm beside "sink-base-900"/);
    expect(text).not.toContain('Layout check failures');
  });
```

(The existing `project` fixture has untagged items, so it has no failures.)

- [ ] Step 2: Run the tests. Expected: FAIL.
- [ ] Step 3: Implement it in `describePlanForLLM`, before `return`:

```ts
  const failures = checkLayout(project).filter((rule) => rule.status === 'fail' && !rule.info);
  if (failures.length > 0) {
    lines.push('', 'Layout check failures (kitchen planning guidelines the plan misses):');
    for (const rule of failures) lines.push(`- ${rule.title}: ${rule.detail}`);
  }
```

Also add `import { checkLayout } from '../plan/layout-check';`.

- [ ] Step 4: Run the tests. Expected: PASS. Also run `npx vitest run src/lib/llm` to make sure the prompt and refine tests are unaffected.
- [ ] Step 5: Commit `feat(chat): the plan context lists failed layout checks`.

### Task 6: Gallery, sample kitchen, e2e and docs

**Files:**
- Modify: `tests/integration/example-layouts.test.ts` (in the kitchen `it.each`, after `expectClean`)
- Modify: `src/lib/plan/sample-kitchen.test.ts` (one test)
- Create: `tests/e2e/layout-check.spec.ts`
- Modify: `docs/superpowers/specs/2026-10-10-layout-check-design.md` (the neighbour rule: fronts or backs, gap ≤100 mm), `docs/plan.md` (Phase 8 section and status line), `README.md` (one sentence)

- [ ] Step 1: Gallery. In the kitchen `it.each`, after `expectClean(saved, knownWarnings)`:

```ts
    const layout = checkLayout(saved);
    const statuses = Object.fromEntries(layout.map((r) => [r.id, r.status]));
    const tags = new Set(saved.items.map((it) => it.tag));
    if (tags.has('fridge') && tags.has('sink') && tags.has('range')) expect(statuses['triangle-legs']).not.toBe('n/a');
    expect(statuses).toMatchSnapshot();
```

Also import `checkLayout` from `@/lib/plan/layout-check`.

- [ ] Step 2: Sample kitchen, in `sample-kitchen.test.ts`. Assert the rule list has 9 entries, no n/a triangle rules, and snapshot the statuses. Reuse that file's existing fixture-building code.
- [ ] Step 3: Run `npx vitest run tests/integration src/lib/plan/sample-kitchen.test.ts`. This writes the snapshots. Read the `.snap` file and sanity-check each kitchen's results against its layout, for example that the galley's aisle is 1100 mm and passes. If a result is clearly wrong, fix the module and add a unit test for it.
- [ ] Step 4: E2E, `tests/e2e/layout-check.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('the sample kitchen shows the layout check', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a sample kitchen' }).click();
  await page.waitForURL(/\/project\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: /^Layout check — \d+ of \d+ passed$/ })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Layout check' }).getByRole('listitem')).toHaveCount(9);
});
```

- [ ] Step 5: Run `npx playwright test tests/e2e/layout-check.spec.ts`. Expected: PASS.
- [ ] Step 6: Docs. Update the spec's neighbour rule. Add a `## Phase 8 — Layout check (tasks 40–45)` section to `docs/plan.md` that points to this plan and the spec, plus a Status line. Add a sentence to the README about the layout check.
- [ ] Step 7: Run all the checks: `npm test`, `npm run e2e`, `npx tsc --noEmit`, `npm run lint`.
- [ ] Step 8: Commit `test: layout check over the example kitchens; docs`.
